# -*- coding: utf-8 -*-
"""레이어 분석/판별 단위 테스트 (1단계)."""
from __future__ import annotations

import pytest

from finish_takeoff.constants import WALL_LINE_MEDIAN_MIN_MM
from finish_takeoff.dxf.layers import (
    normalize_layer_name,
    suggest_preset,
    wall_candidates,
)
from finish_takeoff.models import LayerRole, LayerStat


def stat(
    name: str,
    *,
    lines: int = 0,
    median_mm: float = 0.0,
    texts: int = 0,
    room_hits: int = 0,
    arcs: int = 0,
) -> LayerStat:
    counts: dict[str, int] = {}
    if lines:
        counts["LINE"] = lines
    if texts:
        counts["TEXT"] = texts
    if arcs:
        counts["ARC"] = arcs
    return LayerStat(
        name=name,
        normalized=normalize_layer_name(name),
        entity_counts=counts,
        line_count=lines,
        median_line_length_mm=median_mm,
        max_line_length_mm=median_mm * 3,
        room_word_hits=room_hits,
    )


class TestNormalizeLayerName:
    def test_xref_prefix_removed(self) -> None:
        assert normalize_layer_name("XREF_주동 평면도$0$AA-WAXM-CONC") == "AA-WAXM-CONC"

    def test_nested_xref_prefix(self) -> None:
        assert normalize_layer_name("XREF_A$0$xref_84A$0$FURN") == "FURN"

    def test_plain_name_unchanged(self) -> None:
        assert normalize_layer_name("AA-MKXS") == "AA-MKXS"

    def test_empty(self) -> None:
        assert normalize_layer_name("") == ""


class TestWallCandidates:
    """실측 도면에서 얻은 교훈: 개수가 아니라 선분 길이 중앙값으로 갈린다."""

    def test_hatch_layer_excluded_even_if_huge(self) -> None:
        """단열재 해칭(20,357선, 중앙 14mm)은 벽체가 아니다."""
        stats = [
            stat("AA-XXXX-INS", lines=20_357, median_mm=14),
            stat("AA-WAXM-CONC", lines=3_576, median_mm=370),
        ]
        top = wall_candidates(stats, top=3)
        names = [s.normalized for s, _, _ in top]
        assert "AA-XXXX-INS" not in names
        assert names[0] == "AA-WAXM-CONC"

    def test_door_layer_excluded(self) -> None:
        """문 레이어(24,116선, 중앙 40mm)를 1위로 뽑던 버그 회귀 방지."""
        stats = [
            stat("AA-DWXM-DOOR", lines=24_116, median_mm=40, arcs=224),
            stat("AA-WAXM-ASMB", lines=6_339, median_mm=522),
        ]
        top = wall_candidates(stats, top=3)
        assert [s.normalized for s, _, _ in top] == ["AA-WAXM-ASMB"]

    def test_threshold_boundary(self) -> None:
        below = stat("X-BELOW", lines=100, median_mm=WALL_LINE_MEDIAN_MIN_MM - 1)
        at = stat("X-AT", lines=100, median_mm=WALL_LINE_MEDIAN_MIN_MM)
        names = [s.normalized for s, _, _ in wall_candidates([below, at], top=5)]
        assert names == ["X-AT"]

    def test_reason_included(self) -> None:
        top = wall_candidates([stat("AA-WAXM-CONC", lines=100, median_mm=370)])
        assert "중앙길이" in top[0][2] and "벽체 키워드" in top[0][2]

    def test_no_candidate_returns_empty(self) -> None:
        assert wall_candidates([stat("HATCH-ONLY", lines=999, median_mm=5)]) == []


class TestSuggestPreset:
    def test_roles_assigned(self) -> None:
        stats = [
            stat("XREF_A$0$AA-WAXM-CONC", lines=3_576, median_mm=370),
            stat("AA-DWXM-DOOR", lines=24_116, median_mm=40),
            stat("AA-DWXM-WIND", lines=8_714, median_mm=50),
            stat("AA-WAXS-FINL2", lines=508, median_mm=120),
            stat("AA-MKXS", texts=509, room_hits=308),
        ]
        p = suggest_preset(stats)
        assert "AA-WAXM-CONC" in p.roles[LayerRole.WALL]
        assert "AA-DWXM-DOOR" in p.roles[LayerRole.DOOR]
        assert "AA-DWXM-WIND" in p.roles[LayerRole.WINDOW]
        assert "AA-WAXS-FINL2" in p.roles[LayerRole.WALL_FINISH]
        assert "AA-MKXS" in p.roles[LayerRole.ROOM_LABEL]

    def test_quantity_text_layer_not_room_label(self) -> None:
        """'000_50T 갯수'(1,2,3…)는 텍스트가 많아도 실명 레이어가 아니다."""
        stats = [stat("000_50T 갯수", texts=96, room_hits=0)]
        p = suggest_preset(stats)
        assert LayerRole.ROOM_LABEL not in p.roles

    def test_dedupe_normalized_names(self) -> None:
        """XREF 접두어 유무로 같은 이름이 두 번 들어가지 않는다."""
        stats = [
            stat("XREF_A$0$AA-DWXM-WIND", lines=8_714, median_mm=50),
            stat("AA-DWXM-WIND", lines=987, median_mm=930),
        ]
        p = suggest_preset(stats)
        assert p.roles[LayerRole.WINDOW].count("AA-DWXM-WIND") == 1

    def test_empty_roles_pruned(self) -> None:
        p = suggest_preset([stat("ONLY-NOISE", lines=10, median_mm=5)])
        assert all(v for v in p.roles.values())


class TestLayerPresetMatch:
    def test_match_and_miss(self) -> None:
        p = suggest_preset([stat("AA-WAXM-CONC", lines=100, median_mm=370)])
        assert p.match("XREF$0$AA-WAXM-CONC".rsplit("$", 1)[-1]) is LayerRole.WALL
        assert p.match("AA-DRAIN") is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
