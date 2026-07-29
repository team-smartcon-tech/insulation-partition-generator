# -*- coding: utf-8 -*-
"""
폐합영역 추적 (1차 — 벡터).

    라인 집합 → unary_union → polygonize → 폴리곤
    클릭점 → 포함 폴리곤 검색(STRtree)

결과가 0개면 **폐합 실패로 확정**한다. 임의 면적을 만들어내지 않는다.
2개 이상(중첩)이면 최소 폴리곤을 고르고 경고를 붙인다.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional, Sequence

from shapely import STRtree
from shapely.geometry import LineString, Point as ShPoint, Polygon
from shapely.ops import polygonize, unary_union

from ..constants import (
    ROOM_AREA_MAX_M2,
    ROOM_AREA_MIN_M2,
    ROOM_MIN_VERTICES,
    ROOM_SHAPE_RATIO_MAX,
)
from ..models import RoomWarning

log = logging.getLogger(__name__)

Point = tuple[float, float]


@dataclass
class PolygonIndex:
    """폐합 폴리곤 집합 + 공간 인덱스. 클릭 때마다 재계산하지 않는다."""

    polygons: list[Polygon]
    tree: STRtree

    @property
    def count(self) -> int:
        return len(self.polygons)


def build(lines: Sequence[LineString]) -> PolygonIndex:
    """라인 집합에서 폐합 폴리곤을 만들고 공간 인덱스를 구성한다."""
    t0 = time.perf_counter()
    if not lines:
        return PolygonIndex([], STRtree([]))
    merged = unary_union(list(lines))
    polys = [p for p in polygonize(merged) if p.is_valid and not p.is_empty]
    log.info("[polygonize] 폐합 폴리곤 %d개 · %.2fs", len(polys), time.perf_counter() - t0)
    return PolygonIndex(polys, STRtree(polys))


@dataclass
class TraceResult:
    """클릭 1회의 추적 결과."""

    polygon: Optional[Polygon]
    warnings: list[RoomWarning]
    candidates: int
    """클릭점을 포함한 폴리곤 개수 (0이면 폐합 실패, 2+ 면 중첩)."""

    @property
    def ok(self) -> bool:
        return self.polygon is not None

    @property
    def area_m2(self) -> float:
        return (self.polygon.area / 1_000_000.0) if self.polygon else 0.0


def sanity_check(poly: Polygon) -> list[RoomWarning]:
    """
    실(室)로 보기에 이상한 형상을 잡아낸다.
    **경고일 뿐 차단은 아니다** — 실제로 작은 실/큰 실이 존재한다.
    """
    w: list[RoomWarning] = []
    area_m2 = poly.area / 1_000_000.0
    if area_m2 < ROOM_AREA_MIN_M2:
        w.append(RoomWarning("area_out_of_range",
                             f"면적 {area_m2:.2f}㎡ — 최소({ROOM_AREA_MIN_M2}㎡) 미만"))
    elif area_m2 > ROOM_AREA_MAX_M2:
        w.append(RoomWarning("area_out_of_range",
                             f"면적 {area_m2:.1f}㎡ — 최대({ROOM_AREA_MAX_M2}㎡) 초과"))

    n = len(poly.exterior.coords) - 1
    if n < ROOM_MIN_VERTICES:
        w.append(RoomWarning("few_vertices", f"정점 {n}개 — 실 형상으로 보기 어렵다"))

    if poly.area > 0:
        ratio = (poly.exterior.length ** 2) / poly.area  # 정사각형=16
        if ratio > ROOM_SHAPE_RATIO_MAX:
            w.append(RoomWarning("shape_ratio",
                                 f"둘레²/면적 {ratio:.0f} — 가늘고 긴 비정상 형상"))
    return w


def trace_at(index: PolygonIndex, click_mm: Point) -> TraceResult:
    """
    클릭점을 포함하는 실 폴리곤을 찾는다.

    Args:
        index: build() 결과.
        click_mm: 클릭 좌표 (mm).

    Returns:
        TraceResult — 실패 시 polygon=None. **근사값을 만들지 않는다.**
    """
    if index.count == 0:
        return TraceResult(None, [RoomWarning("area_out_of_range", "폐합 폴리곤이 없다")], 0)

    pt = ShPoint(click_mm)
    hits = [index.polygons[int(i)] for i in index.tree.query(pt)]
    hits = [p for p in hits if p.contains(pt)]

    if not hits:
        return TraceResult(None, [], 0)

    # 중첩이면 최소 폴리곤 — 큰 폴리곤은 보통 여러 실을 감싼 외곽이다
    poly = min(hits, key=lambda p: p.area)
    warns = sanity_check(poly)
    if len(hits) > 1:
        warns.append(RoomWarning(
            "overlap", f"중첩 영역 {len(hits)}개 감지 — 최소 폴리곤을 선택했다"))
    return TraceResult(poly, warns, len(hits))


def polygon_to_points(poly: Polygon) -> tuple[list[Point], list[list[Point]]]:
    """shapely Polygon → (외곽 정점, 내부 홀 목록). 도넛형 실의 중공을 보존한다."""
    ext = [(float(x), float(y)) for x, y in poly.exterior.coords[:-1]]
    holes = [
        [(float(x), float(y)) for x, y in ring.coords[:-1]] for ring in poly.interiors
    ]
    return ext, holes
