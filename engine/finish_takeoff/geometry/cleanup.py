# -*- coding: utf-8 -*-
"""
지오메트리 정리 — 실무 도면을 폐합 가능한 상태로 만든다.

순서 (명세 STEP 2)
  1. 중복 선분 제거
  2. 끝점 스냅 (격자 양자화 — STRtree 이중루프 대신 O(n))
  3. 교차점 분할 (unary_union)
  4. 미세 갭 봉합 (≤ MICRO_GAP_MAX_MM 만. 문 개구부는 손대지 않는다)

**문 개구부(600~1500mm)를 여기서 자동으로 막지 않는다.** 개구부 처리는 별도 단계다.
"""
from __future__ import annotations

import logging
import math
import time
from collections import defaultdict
from typing import Iterable, Optional, Sequence

from shapely import STRtree
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge, unary_union

from ..constants import (
    DUPLICATE_TOLERANCE_MM,
    MICRO_GAP_MAX_MM,
    SNAP_TOLERANCE_MM,
)

log = logging.getLogger(__name__)

Point = tuple[float, float]
Segment = tuple[Point, Point]


class CleanupResult:
    """정리 결과 + 무엇을 얼마나 손댔는지."""

    def __init__(self) -> None:
        self.lines: list[LineString] = []
        self.removed_duplicates = 0
        self.snapped_points = 0
        self.bridged_gaps: list[tuple[Point, Point, float]] = []
        """봉합한 미세 갭 (a, b, 거리mm) — UI 에서 별도 색으로 표시해야 한다."""

    @property
    def bridge_count(self) -> int:
        return len(self.bridged_gaps)


def _quantize(p: Point, grid: float) -> Point:
    """좌표를 격자에 스냅. 근접 끝점을 같은 좌표로 모은다."""
    return (round(p[0] / grid) * grid, round(p[1] / grid) * grid)


def dedupe_and_snap(
    segments: Sequence[Segment],
    *,
    snap_mm: float = SNAP_TOLERANCE_MM,
    dup_mm: float = DUPLICATE_TOLERANCE_MM,
) -> tuple[list[Segment], int, int]:
    """
    중복 선분 제거 + 끝점 스냅.

    격자 양자화를 쓴다 — 이중 루프(O(n²)) 없이 18만 선분도 즉시 처리된다.

    Returns:
        (선분, 제거된 중복 수, 스냅으로 이동한 끝점 수)
    """
    grid = max(snap_mm, 1e-6)
    seen: set[tuple[Point, Point]] = set()
    out: list[Segment] = []
    dup = 0
    moved = 0

    for a, b in segments:
        qa, qb = _quantize(a, grid), _quantize(b, grid)
        if qa != a:
            moved += 1
        if qb != b:
            moved += 1
        if qa == qb:
            dup += 1  # 스냅으로 길이 0이 된 선분
            continue
        # 방향 무관 중복 판정
        key = (qa, qb) if qa <= qb else (qb, qa)
        if key in seen:
            dup += 1
            continue
        seen.add(key)
        out.append((qa, qb))

    # dup_mm 는 격자보다 작을 때만 의미가 있어 별도 처리하지 않는다(격자에 흡수됨).
    return out, dup, moved


def _endpoint_degrees(lines: Iterable[LineString]) -> dict[Point, int]:
    """끝점별 연결 차수 — 차수 1인 점이 '열린 끝'이다."""
    deg: dict[Point, int] = defaultdict(int)
    for ls in lines:
        cs = list(ls.coords)
        deg[(cs[0][0], cs[0][1])] += 1
        deg[(cs[-1][0], cs[-1][1])] += 1
    return deg


def bridge_micro_gaps(
    lines: list[LineString],
    *,
    max_gap_mm: float = MICRO_GAP_MAX_MM,
) -> tuple[list[LineString], list[tuple[Point, Point, float]]]:
    """
    열린 끝점끼리의 **미세 갭만** 가상 선분으로 잇는다.

    max_gap_mm 를 넘는 간격은 개구부일 수 있으므로 **절대 자동으로 막지 않는다.**

    Returns:
        (선분들 + 가상선, 봉합 목록[(a, b, 거리)])
    """
    deg = _endpoint_degrees(lines)
    open_pts = [p for p, d in deg.items() if d == 1]
    if len(open_pts) < 2:
        return lines, []

    from shapely.geometry import Point as ShPoint

    tree = STRtree([ShPoint(p) for p in open_pts])
    used: set[Point] = set()
    bridges: list[tuple[Point, Point, float]] = []

    for p in open_pts:
        if p in used:
            continue
        idxs = tree.query(ShPoint(p).buffer(max_gap_mm))
        best: Optional[tuple[float, Point]] = None
        for i in idxs:
            q = open_pts[int(i)]
            if q == p or q in used:
                continue
            d = math.dist(p, q)
            if 0 < d <= max_gap_mm and (best is None or d < best[0]):
                best = (d, q)
        if best is not None:
            used.add(p)
            used.add(best[1])
            bridges.append((p, best[1], best[0]))

    out = list(lines) + [LineString([a, b]) for a, b, _ in bridges]
    return out, bridges


def clean(
    segments: Sequence[Segment],
    *,
    snap_mm: float = SNAP_TOLERANCE_MM,
    max_gap_mm: float = MICRO_GAP_MAX_MM,
    bridge: bool = True,
) -> CleanupResult:
    """
    선분 집합을 폐합 추적 가능한 라인 집합으로 정리한다.

    Args:
        segments: mm 좌표 선분.
        snap_mm: 끝점 스냅 허용오차.
        max_gap_mm: 미세 갭 봉합 상한.
        bridge: False 면 갭 봉합을 건너뛴다(원본 그대로 폐합성 확인용).

    Returns:
        CleanupResult
    """
    t0 = time.perf_counter()
    res = CleanupResult()
    if not segments:
        return res

    snapped, dup, moved = dedupe_and_snap(segments, snap_mm=snap_mm)
    res.removed_duplicates = dup
    res.snapped_points = moved

    lines = [LineString([a, b]) for a, b in snapped]

    # 교차점 분할 — unary_union 이 교차점에서 자동으로 쪼갠다
    merged = unary_union(lines)
    if isinstance(merged, MultiLineString):
        lines = [g for g in merged.geoms]
    elif isinstance(merged, LineString):
        lines = [merged]
    else:  # GeometryCollection 등
        lines = [g for g in getattr(merged, "geoms", []) if isinstance(g, LineString)]

    if bridge:
        lines, bridges = bridge_micro_gaps(lines, max_gap_mm=max_gap_mm)
        res.bridged_gaps = bridges

    res.lines = lines
    log.info(
        "[cleanup] 선분 %d → 라인 %d (중복제거 %d · 스냅이동 %d · 갭봉합 %d) · %.2fs",
        len(segments), len(lines), dup, moved, res.bridge_count,
        time.perf_counter() - t0,
    )
    if res.bridge_count:
        log.warning("[cleanup] 가상 폐합선 %d개 삽입 — UI 에 별도 색으로 표시할 것",
                    res.bridge_count)
    return res
