# -*- coding: utf-8 -*-
"""지오메트리 정리/추적 단위 테스트 (2~4단계)."""
from __future__ import annotations

import math

import pytest
from shapely.geometry import LineString

from finish_takeoff.geometry import cleanup, polygonize


def rect_segments(w: float, h: float, *, gap: float = 0.0, x0: float = 0.0, y0: float = 0.0):
    """좌하단 (x0,y0) 사각형. gap>0 이면 상변 중앙을 그만큼 벌린다."""
    a, b, c, d = (x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)
    segs = [(a, b), (b, c), (d, a)]
    if gap <= 0:
        segs.append((c, d))
    else:
        mid = x0 + w / 2
        segs.append((c, (mid + gap / 2, y0 + h)))
        segs.append(((mid - gap / 2, y0 + h), d))
    return segs


def trace_rect(segs, click):
    res = cleanup.clean(segs)
    idx = polygonize.build(res.lines)
    return polygonize.trace_at(idx, click), res


class TestVectorTrace:
    def test_perfect_square_area_accuracy(self):
        """정사각형 3000×3000mm = 9㎡ — 오차 0.01% 이내."""
        r, _ = trace_rect(rect_segments(3000, 3000), (1500, 1500))
        assert r.ok
        assert abs(r.area_m2 - 9.0) / 9.0 < 0.0001

    def test_1mm_gap_snapped(self):
        """끝점 1mm 벌어짐 → 스냅(2mm)으로 정상 추적."""
        segs = rect_segments(3000, 3000)
        segs[0] = ((0, 0), (2999.0, 0))  # 우하단 1mm 미달
        r, _ = trace_rect(segs, (1500, 1500))
        assert r.ok
        assert abs(r.area_m2 - 9.0) < 0.02

    def test_100mm_gap_stays_open(self):
        """100mm 벌어짐 → 미세갭(50mm) 밖이라 억지 봉합하지 않는다."""
        r, res = trace_rect(rect_segments(3000, 3000, gap=100), (1500, 1500))
        assert not r.ok, "폐합 실패로 판정해야 한다"
        assert res.bridge_count == 0

    def test_900mm_door_opening_not_auto_closed(self):
        """문 개구부 900mm 는 정리 단계에서 막지 않는다 (개구부 처리 단계 담당)."""
        r, res = trace_rect(rect_segments(4000, 3000, gap=900), (2000, 1500))
        assert not r.ok
        assert res.bridge_count == 0

    def test_40mm_gap_bridged(self):
        """40mm 미세 갭은 봉합 대상 — 봉합 사실을 반드시 보고한다."""
        r, res = trace_rect(rect_segments(3000, 3000, gap=40), (1500, 1500))
        assert r.ok
        assert res.bridge_count == 1
        a, b, dist = res.bridged_gaps[0]
        assert 39 <= dist <= 41

    def test_click_outside_returns_failure(self):
        r, _ = trace_rect(rect_segments(3000, 3000), (9999, 9999))
        assert not r.ok
        assert r.candidates == 0

    def test_nested_rooms_no_double_count(self):
        """
        큰 방 안에 작은 방이 있어도 **면적이 이중 계상되지 않는다.**

        polygonize 는 평면 그래프의 '면(face)'을 만들기 때문에, 바깥 영역은
        안쪽 방을 홀로 갖는 도넛이 된다. 따라서 안쪽 클릭 시 포함 폴리곤은
        정확히 1개이고 그 면적은 안쪽 방 면적이다.
        (이 성질이 깨지면 물량이 두 번 잡혀 견적이 틀어진다.)
        """
        segs = rect_segments(10000, 10000) + rect_segments(3000, 3000, x0=1000, y0=1000)
        r, _ = trace_rect(segs, (2500, 2500))
        assert r.ok
        assert r.candidates == 1, "안쪽 클릭에 폴리곤이 2개 잡히면 이중 계상 위험"
        assert abs(r.area_m2 - 9.0) < 0.05

    def test_outer_face_excludes_inner_room(self):
        """바깥을 클릭하면 안쪽 방 면적이 빠진 도넛 면적이 나온다."""
        segs = rect_segments(10000, 10000) + rect_segments(3000, 3000, x0=1000, y0=1000)
        r, _ = trace_rect(segs, (9000, 9000))
        assert r.ok
        assert abs(r.area_m2 - (100.0 - 9.0)) < 0.05

    def test_donut_hole_subtracted(self):
        """도넛형 — 내부 중공은 면적에서 빠진다."""
        outer = rect_segments(10000, 10000)
        inner = rect_segments(2000, 2000, x0=4000, y0=4000)
        res = cleanup.clean(outer + inner)
        idx = polygonize.build(res.lines)
        # 바깥 링 안쪽(중공 밖) 클릭
        r = polygonize.trace_at(idx, (500, 500))
        assert r.ok
        # polygonize 는 중공을 별도 폴리곤으로 만들고 바깥은 홀을 가진 형태가 된다
        assert r.area_m2 < 100.0


class TestSanityCheck:
    def test_tiny_area_warns(self):
        r, _ = trace_rect(rect_segments(300, 300), (150, 150))
        assert r.ok
        assert any(w.code == "area_out_of_range" for w in r.warnings)

    def test_long_thin_shape_warns(self):
        r, _ = trace_rect(rect_segments(50000, 300), (25000, 150))
        assert r.ok
        assert any(w.code == "shape_ratio" for w in r.warnings)

    def test_normal_room_no_warning(self):
        r, _ = trace_rect(rect_segments(4000, 3500), (2000, 1750))
        assert r.ok and not r.warnings


class TestCleanup:
    def test_duplicate_segments_removed(self):
        segs = rect_segments(3000, 3000) * 3
        res = cleanup.clean(segs)
        assert res.removed_duplicates >= 8

    def test_empty_input(self):
        res = cleanup.clean([])
        assert res.lines == [] and res.bridge_count == 0

    def test_zero_length_dropped(self):
        res = cleanup.clean([((0, 0), (0, 0)), ((0, 0), (100, 0))])
        assert len(res.lines) == 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
