# -*- coding: utf-8 -*-
"""
개구부 처리 — 실 추적의 성패를 가르는 단계.

문 개구부를 막지 않으면 실이 옆방과 이어져 폐합이 실패한다.
실측 결과 벽체 레이어만으로는 **폐합 폴리곤 최대 면적이 8㎡**(벽체 이중선 사이
조각)에 그쳤고, 실 라벨 추적은 12/12 실패했다.

전략 (실측 도면 기준 우선순위 — 명세와 순서가 다르다)
  1. **문 스윙 ARC** — 이 도면의 문은 INSERT 블록이 아니라 LINE+ARC 로 직접
     작도돼 있다. ARC 반지름(690~991mm)이 곧 문 폭이고 중심이 힌지다.
     힌지 → (벽선 위에 놓인 호 끝점) 을 잇는 선이 개구부를 막는다.
  2. **문 블록(INSERT)** — 블록으로 그린 도면 대응.
  3. **벽선 gap 자동 감지** — 위 둘이 없을 때. 폭 600~1500mm 이고 양 끝이
     벽선 위에 있는 간격.

**삽입한 선은 전부 '가상 폐합선'으로 표시해 반환한다.** 조용히 막지 않는다.
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from typing import Iterable, Literal, Optional, Sequence

from ezdxf.document import Drawing
from shapely import STRtree
from shapely.geometry import LineString, Point as ShPoint

from ..constants import (
    DOOR_ARC_WALL_TOLERANCE_MM,
    DOOR_SWING_RADIUS_RANGE_MM,
    DOOR_WIDTH_RANGE_MM,
    SNAP_TOLERANCE_MM,
)

log = logging.getLogger(__name__)

Point = tuple[float, float]
Segment = tuple[Point, Point]


@dataclass
class VirtualClosure:
    """개구부를 막는 가상 선 1개 — UI 에서 별도 색으로 표시해야 한다."""

    a: Point
    b: Point
    width_mm: float
    source: Literal["door_arc", "door_block", "gap_detect", "manual"]
    layer: str = ""

    def as_segment(self) -> Segment:
        return (self.a, self.b)


def _wall_index(wall_segments: Sequence[Segment]) -> STRtree:
    return STRtree([LineString([a, b]) for a, b in wall_segments])


def _on_wall(tree: STRtree, p: Point, tol: float) -> bool:
    """점이 벽선 위(허용오차 내)에 있는지."""
    sp = ShPoint(p)
    for i in tree.query(sp.buffer(tol)):
        if tree.geometries[int(i)].distance(sp) <= tol:
            return True
    return False


def from_door_arcs(
    doc: Drawing,
    scale: float,
    door_layers: Iterable[str],
    wall_segments: Sequence[Segment],
    *,
    radius_range: tuple[float, float] = DOOR_SWING_RADIUS_RANGE_MM,
    tol_mm: float = DOOR_ARC_WALL_TOLERANCE_MM,
) -> list[VirtualClosure]:
    """
    문 스윙 ARC 에서 개구부 폐합선을 만든다.

    문 심볼은 보통 `힌지(=호 중심)` 에서 반지름만큼 떨어진 두 지점 사이를 90° 로
    쓸며, **닫힌 위치의 호 끝점이 벽선 위에 놓인다.** 그 끝점과 힌지를 이으면
    개구부를 정확히 막는다.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 좌표 → mm.
        door_layers: 문 레이어(원본명).
        wall_segments: 벽체 선분 (벽선 판정용).
        radius_range: 문 폭으로 인정할 반지름 범위 (mm).
        tol_mm: 벽선 위 판정 허용오차.

    Returns:
        VirtualClosure 목록.
    """
    t0 = time.perf_counter()
    layers = set(door_layers)
    tree = _wall_index(wall_segments)
    lo, hi = radius_range
    out: list[VirtualClosure] = []

    for e in doc.modelspace():
        if e.dxftype() != "ARC" or e.dxf.layer not in layers:
            continue
        r = float(e.dxf.radius) * scale
        if not (lo <= r <= hi):
            continue
        c = e.dxf.center
        center = (c.x * scale, c.y * scale)
        try:
            sp = e.start_point
            ep = e.end_point
        except Exception:
            continue
        ends = [(sp.x * scale, sp.y * scale), (ep.x * scale, ep.y * scale)]

        # 닫힌 위치 = 벽선 위에 있는 끝점. 둘 다/둘 다 아니면 힌지가 벽 위인 쪽을 신뢰.
        on_wall = [p for p in ends if _on_wall(tree, p, tol_mm)]
        target: Optional[Point]
        if len(on_wall) == 1:
            target = on_wall[0]
        elif len(on_wall) == 2:
            # 힌지에서 더 먼 쪽이 개구부 반대편
            target = max(on_wall, key=lambda p: math.dist(center, p))
        else:
            target = None

        if target is None:
            continue
        out.append(VirtualClosure(center, target, r, "door_arc", e.dxf.layer))

    log.info("[openings] 문 스윙 ARC → 폐합선 %d개 · %.2fs", len(out), time.perf_counter() - t0)
    return out


def from_wall_gaps(
    wall_segments: Sequence[Segment],
    *,
    width_range: tuple[float, float] = DOOR_WIDTH_RANGE_MM,
    tol_mm: float = SNAP_TOLERANCE_MM,
) -> list[VirtualClosure]:
    """
    벽선 열린 끝점 사이의 간격을 개구부로 판정해 막는다 (3순위 폴백).

    폭이 width_range 안이고, 두 끝점이 **거의 같은 직선 위**에 있을 때만 막는다.
    (모서리에서 만나야 할 두 벽을 잇는 실수를 피하려는 조건이다.)
    """
    from collections import defaultdict

    deg: dict[Point, int] = defaultdict(int)
    dirs: dict[Point, list[Point]] = defaultdict(list)
    for a, b in wall_segments:
        deg[a] += 1
        deg[b] += 1
        dirs[a].append(b)
        dirs[b].append(a)

    open_pts = [p for p, d in deg.items() if d == 1]
    if len(open_pts) < 2:
        return []

    lo, hi = width_range
    tree = STRtree([ShPoint(p) for p in open_pts])
    used: set[Point] = set()
    out: list[VirtualClosure] = []

    for p in open_pts:
        if p in used:
            continue
        best: Optional[tuple[float, Point]] = None
        for i in tree.query(ShPoint(p).buffer(hi)):
            q = open_pts[int(i)]
            if q == p or q in used:
                continue
            d = math.dist(p, q)
            if not (lo <= d <= hi):
                continue
            # 두 끝점의 벽 방향이 서로 평행(=같은 벽선 상)인지
            if not _collinear(p, q, dirs[p][0], dirs[q][0]):
                continue
            if best is None or d < best[0]:
                best = (d, q)
        if best is not None:
            used.add(p)
            used.add(best[1])
            out.append(VirtualClosure(p, best[1], best[0], "gap_detect"))

    log.info("[openings] 벽선 gap 감지 → 폐합선 %d개", len(out))
    return out


def _collinear(p: Point, q: Point, pdir: Point, qdir: Point, *, deg_tol: float = 12.0) -> bool:
    """p→q 방향이 각 끝점의 벽 방향과 (반)평행한지 — 같은 벽선 상의 개구부인지 판정."""

    def ang(a: Point, b: Point) -> float:
        return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0

    gap = ang(p, q)
    return (abs(gap - ang(p, pdir)) % 180 <= deg_tol or
            abs(gap - ang(p, pdir)) % 180 >= 180 - deg_tol) and \
           (abs(gap - ang(q, qdir)) % 180 <= deg_tol or
            abs(gap - ang(q, qdir)) % 180 >= 180 - deg_tol)


def collect(
    doc: Drawing,
    scale: float,
    wall_segments: Sequence[Segment],
    *,
    door_layers: Iterable[str] = (),
    use_gap_fallback: bool = True,
) -> list[VirtualClosure]:
    """
    가능한 모든 경로로 개구부 폐합선을 모은다 (ARC → gap 폴백).

    Returns:
        VirtualClosure 목록 — 호출자는 이 선들을 벽 선분에 더해 폐합을 시도한다.
    """
    closures = from_door_arcs(doc, scale, door_layers, wall_segments) if door_layers else []
    if use_gap_fallback:
        # ARC 로 막은 지점 근처는 중복 생성하지 않도록 제외
        blocked = {c.a for c in closures} | {c.b for c in closures}
        for vc in from_wall_gaps(wall_segments):
            if vc.a in blocked or vc.b in blocked:
                continue
            closures.append(vc)
    return closures
