# -*- coding: utf-8 -*-
"""
실 인식 파이프라인 — S1 → S3 → S4 → S6 → S7 을 한 함수로 묶는다.

서버·CLI 가 공통으로 쓰는 유일한 진입점이다. 각 단계의 근거와 실패 이력은
해당 모듈 docstring 에 있다. 여기서는 순서와 세대 단위 처리만 담당한다.

세대 단위로 도는 이유: 층 평면을 통째로 돌리면 평면 bbox 가 상세도·여백까지
삼켜 마스크 비율이 3.3% 로 떨어지고 건물 밖으로 영역이 퍼진다(실측).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from ..config import loader as config
from ..dxf import entities as entity_mod
from ..dxf import layers as layer_mod
from ..models import LayerRole
from . import entry_door, partition, unit_split, wall_mask

log = logging.getLogger(__name__)

#: 벽체로 쓸 요소코드 / 실 안쪽을 잘게 자르는 것들
WALL_ALLOW = ("WAXM", "골조", "WALL", "벽")
WALL_DENY = ("INS", "PATT", "PAT1", "HAT", "FUR", "SANI", "CLEN", "DRAIN",
             "치수", "TEXT", "DIM")
#: 실 경계이면서 개구부인 것 — 창호·문틀. 발코니 외곽은 난간이므로 반드시 포함.
EDGE_ALLOW = ("DWXM", "난간")


@dataclass
class RoomOut:
    """UI 로 나가는 실 하나."""

    name: str
    unit_index: int
    unit_type: Optional[str]
    category: str
    area_m2: float
    polygon: list[list[float]]
    badge: str
    merged_from: list[str] = field(default_factory=list)
    """LDK 통합 등으로 합쳐진 원래 실명들."""
    warnings: list[str] = field(default_factory=list)


@dataclass
class UnitOut:
    index: int
    unit_type: Optional[str]
    rooms: list[RoomOut] = field(default_factory=list)
    mask_ratio: float = 0.0
    necks: list[tuple[float, float]] = field(default_factory=list)
    unassigned_px: int = 0

    @property
    def area_m2(self) -> float:
        return sum(r.area_m2 for r in self.rooms)

    @property
    def net_area_m2(self) -> float:
        """SERVICE(발코니·다용도 등) 를 뺀 면적 — 전용면적 비교용."""
        return sum(r.area_m2 for r in self.rooms if r.category != "SERVICE")


def _pick_layers(stats, allow: Iterable[str], deny: Iterable[str] = ()) -> set[str]:
    out: set[str] = set()
    for s in stats:
        if s.line_count <= 0:
            continue
        n = s.normalized.upper()
        if any(d in n for d in deny):
            continue
        if any(a in n for a in allow):
            out.add(s.name)
    return out


def _merge_ldk(rooms: list[RoomOut]) -> list[RoomOut]:
    """
    개방형 LDK 를 하나의 실로 합친다 (설정 `ldk.mode == "merge"`).

    거실·주방/식당은 벽 없이 이어져 있어 시드 충돌 위치가 세대마다 달라진다
    (실측: 거실 20.3% / 주방·식당 14.3% 편차 → 통합 시 2.4%).
    사용자 확인(2026-07-30): "하나의 실 LDK 로 통합".
    """
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    cfg = config.rooms().get("ldk", {})
    if str(cfg.get("mode", "merge")) != "merge":
        return rooms
    members = {str(m) for m in cfg.get("members", [])}
    if not members:
        return rooms

    target = [r for r in rooms if any(m in r.name for m in members)]
    if len(target) < 2:
        return rooms

    merged_geom = unary_union([Polygon(r.polygon) for r in target if len(r.polygon) >= 3])
    if merged_geom.is_empty:
        return rooms
    if merged_geom.geom_type == "MultiPolygon":
        merged_geom = max(merged_geom.geoms, key=lambda g: g.area)

    first = target[0]
    out = [r for r in rooms if r not in target]
    out.append(RoomOut(
        name=str(cfg.get("merge_name", "LDK")),
        unit_index=first.unit_index, unit_type=first.unit_type,
        category="LIVING",
        area_m2=round(merged_geom.area / 1e6, 3),
        polygon=[[round(x, 1), round(y, 1)] for x, y in merged_geom.exterior.coords],
        badge="개방부 분할",
        merged_from=[r.name for r in target],
    ))
    return out


def recognize(doc, info, stats, preset, *,
              res_mm: Optional[float] = None,
              unit_indices: Optional[Sequence[int]] = None,
              clip_pad_mm: float = 1500.0,
              core_seed_pad_mm: float = 4000.0) -> list[UnitOut]:
    """
    도면 → 세대별 실 목록.

    Args:
        doc, info, stats, preset: 로더·레이어 분석 결과.
        res_mm: 래스터 해상도. None 이면 설정값.
        unit_indices: 특정 세대만 처리. None 이면 전체.
        clip_pad_mm: 세대 박스 밖으로 이만큼 여유를 두고 선분을 자른다.
            **버리지 않고 자르는 것이 중요하다** — 박스를 넘나드는 3~4m 벽선을
            버리면 마스크가 벽 토막이 되어 실이 전부 이어진다(실측).
        core_seed_pad_mm: 이 범위 안의 코어부 라벨을 경쟁 시드로 넣는다.
            공용홀에 시드가 없으면 현관이 홀까지 먹는다(실측 19.8㎡).

    Returns:
        세대 목록. 실패한 실도 badge="실패" 로 포함해 조용히 빠지지 않게 한다.
    """
    scale = info.unit_scale_to_mm
    wall_lay = _pick_layers(stats, WALL_ALLOW, WALL_DENY)
    edge_lay = _pick_layers(stats, EDGE_ALLOW)
    door_lay = {s.name for s in stats if "DWXM-DOOR" in s.normalized.upper()}
    label_lay = layer_mod.find_role_layers(stats, preset, LayerRole.ROOM_LABEL)

    t0 = time.perf_counter()
    wsegs, _ = entity_mod.extract_segments(doc, scale, layers=wall_lay)
    esegs, _ = entity_mod.extract_segments(doc, scale, layers=edge_lay)
    log.info("[인식] 벽 %d선 · 외곽 %d선 (%.1fs)",
             len(wsegs), len(esegs), time.perf_counter() - t0)

    units = unit_split.split(doc, scale, label_layers=label_lay)
    labels, _ = unit_split.collect_labels(doc, scale, label_lay)
    cores = [l for l in labels if l.category == "EXCLUDE"]
    log.info("[인식] 세대 %d개 · 코어부 라벨 %d개", len(units), len(cores))

    wanted = set(unit_indices) if unit_indices is not None else None
    out: list[UnitOut] = []

    for u in units:
        if wanted is not None and u.index not in wanted:
            continue
        t = time.perf_counter()
        mask = wall_mask.build(
            wall_mask.clip_segments(wsegs, u.bbox_mm, clip_pad_mm),
            doc=doc, scale=scale, wall_layers=wall_lay,
            opening_segments=wall_mask.clip_segments(esegs, u.bbox_mm, clip_pad_mm),
            drawing_bbox_mm=u.bbox_mm,
        )

        entry_pts = [(s.x, s.y) for s in u.seeds if s.category == "ENTRY"]
        closures = entry_door.find_entry_closures(
            doc, scale, entry_pts, door_layers=door_lay)

        seeds = [(s.text, s.category, (s.x, s.y)) for s in u.seeds]
        mine = [True] * len(seeds)
        bx0, by0, bx1, by1 = u.bbox_mm
        for c in cores:
            if (bx0 - core_seed_pad_mm <= c.x <= bx1 + core_seed_pad_mm
                    and by0 - core_seed_pad_mm <= c.y <= by1 + core_seed_pad_mm):
                seeds.append((c.text, "EXCLUDE", (c.x, c.y)))
                mine.append(False)

        pr = partition.partition(
            mask.solid, seeds, u.bbox_mm, pad_mm=0.0, res_mm=res_mm,
            extra_barriers=closures, wall_edges=mask.inner_edges())

        rooms: list[RoomOut] = []
        for r, is_mine in zip(pr.regions, mine):
            if not is_mine:
                continue                       # 코어부 — 경쟁만 시키고 결과에서 뺀다
            warns: list[str] = []
            if r.touched_unit_border:
                warns.append("세대 경계까지 확장됨 — 누출 의심")
            if r.category == "ENTRY" and r.area_mm2 / 1e6 > 6.0:
                warns.append("현관 면적 6㎡ 초과 — 복도 흡수 의심")
            rooms.append(RoomOut(
                name=r.name, unit_index=u.index, unit_type=u.unit_type,
                category=r.category,
                area_m2=round(r.area_mm2 / 1e6, 3),
                polygon=([[round(x, 1), round(y, 1)]
                          for x, y in r.polygon.exterior.coords]
                         if r.polygon else []),
                badge=r.badge, warnings=warns,
            ))

        rooms = _merge_ldk(rooms)
        rooms.sort(key=lambda r: -r.area_m2)
        out.append(UnitOut(index=u.index, unit_type=u.unit_type, rooms=rooms,
                           mask_ratio=mask.stats.area_ratio,
                           necks=mask.stats.necks,
                           unassigned_px=pr.unassigned_px))
        log.info("[인식] 세대 #%d %s 실 %d개 %.1f㎡ (%.2fs)",
                 u.index, u.unit_type, len(rooms), out[-1].area_m2,
                 time.perf_counter() - t)

    return out


def cross_check(units: Sequence[UnitOut], tolerance_pct: float = 1.0) -> dict:
    """
    타입 간 교차 검증 — 동일 타입 세대의 실별 면적을 비교한다.

    이 검증이 있으면 누출 버그를 사람이 화면으로 찾지 않아도 된다.

    Returns:
        {"by_type": {타입: {실명: {"values": [...], "dev_pct": x}}},
         "issues": [{"severity","message",...}], "worst_pct": x}
    """
    by_type: dict[str, dict[str, list[float]]] = {}
    for u in units:
        t = u.unit_type or "(미지정)"
        for r in u.rooms:
            by_type.setdefault(t, {}).setdefault(r.name, []).append(r.area_m2)

    issues: list[dict] = []
    worst = 0.0
    summary: dict[str, dict[str, dict]] = {}

    for t, rooms in by_type.items():
        n_units = len([u for u in units if (u.unit_type or "(미지정)") == t])
        summary[t] = {}
        for name, vals in rooms.items():
            lo, hi = min(vals), max(vals)
            dev = (hi - lo) / hi * 100 if hi > 0 else 100.0
            worst = max(worst, dev)
            summary[t][name] = {"values": vals, "dev_pct": round(dev, 2)}
            if dev > tolerance_pct:
                issues.append({
                    "severity": "warning", "type": t, "room": name,
                    "message": "%s %s 면적 편차 %.1f%% (%.2f~%.2f㎡)"
                               % (t, name, dev, lo, hi),
                })
            if len(vals) != n_units:
                issues.append({
                    "severity": "error", "type": t, "room": name,
                    "message": "%s %s 개수 불일치 — 세대 %d개 중 %d개만 인식"
                               % (t, name, n_units, len(vals)),
                })

    return {"by_type": summary, "issues": issues, "worst_pct": round(worst, 2)}
