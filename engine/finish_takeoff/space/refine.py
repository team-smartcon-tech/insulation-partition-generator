# -*- coding: utf-8 -*-
"""
S7 — 경계 후처리.

래스터 결과를 그대로 쓰면 경계가 들쭉날쭉해 실무에서 못 쓴다. 순서가 중요하다.

**직교화의 정의**: 폴리곤의 각 변을 *개별적으로* 가장 가까운 축에 정렬하는 것.
정점 수를 줄이거나 형상을 단순 도형으로 치환하는 것이 **아니다**.
L자형은 직교화 후에도 L자형이어야 한다.

금지: 실 형상 산출 경로에서 envelope / minimum_rotated_rectangle 사용.
(bbox 는 공간 인덱스·화면 클리핑 용도로만 쓴다)
"""
from __future__ import annotations

import math
from typing import Optional, Sequence

from shapely.geometry import LinearRing, Polygon
from shapely.ops import unary_union

from ..config import loader as config

Point = tuple[float, float]


def _ring_points(ring: LinearRing) -> list[Point]:
    """닫힘 중복점을 뺀 정점 목록."""
    pts = [(float(x), float(y)) for x, y in ring.coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def simplify_outline(poly: Polygon, epsilon_mm: Optional[float] = None) -> Polygon:
    """
    1차 단순화 — 래스터 계단 노이즈만 제거한다.

    epsilon 이 크면 실제 요철(50mm 단차 등)이 사라져 형상이 틀어진다.
    기본값은 config 의 `simplify_epsilon_mm`(5mm)이며 20mm 이상은 쓰지 않는다.

    Args:
        poly: 대상 폴리곤 (홀 포함 가능).
        epsilon_mm: Douglas-Peucker 허용오차(mm). None 이면 설정값.

    Returns:
        단순화된 폴리곤. 홀은 그대로 보존된다.
    """
    eps = epsilon_mm if epsilon_mm is not None else float(
        config.geometry("simplify_epsilon_mm", 5.0))
    eps = min(eps, 19.0)   # 20mm 이상 금지 — 형상 소실
    out = poly.simplify(eps, preserve_topology=True)
    if out.is_empty or not isinstance(out, Polygon):
        return poly
    return out


def _orthogonalize_ring(pts: Sequence[Point], deg: float) -> list[Point]:
    """
    변 단위 직교화 — 축과 `deg` 이내인 변만 축에 정렬한다.

    각 변의 **중점을 유지**하며 정렬하므로 형상 중심이 이동하지 않는다.
    사선(deg 초과)은 손대지 않는다 — 사선벽은 사선으로 남아야 한다.
    """
    n = len(pts)
    if n < 3:
        return list(pts)

    # 변별 목표: None(그대로) / ("h", y) 수평 / ("v", x) 수직
    targets: list[Optional[tuple[str, float]]] = []
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            targets.append(None)
            continue
        ang = math.degrees(math.atan2(abs(dy), abs(dx)))
        if ang <= deg:
            targets.append(("h", (y1 + y2) / 2.0))
        elif ang >= 90.0 - deg:
            targets.append(("v", (x1 + x2) / 2.0))
        else:
            targets.append(None)   # 사선 유지

    # 인접 변 연장·교차로 정점 재확정.
    # 정점 i 는 변 (i-1) 과 변 i 가 만나는 점이다.
    out: list[Point] = []
    for i in range(n):
        prev_t = targets[(i - 1) % n]
        cur_t = targets[i]
        x, y = pts[i]

        if prev_t and cur_t and prev_t[0] != cur_t[0]:
            # 수평·수직이 만나는 모서리 → 정확한 교점
            hx = cur_t[1] if cur_t[0] == "v" else prev_t[1]
            hy = cur_t[1] if cur_t[0] == "h" else prev_t[1]
            out.append((hx, hy))
            continue

        # 한쪽만 정렬 대상이면 그 축만 맞춘다 (사선 쪽 좌표는 보존)
        if cur_t:
            if cur_t[0] == "h":
                y = cur_t[1]
            else:
                x = cur_t[1]
        elif prev_t:
            if prev_t[0] == "h":
                y = prev_t[1]
            else:
                x = prev_t[1]
        out.append((x, y))
    return out


def _merge_collinear(pts: Sequence[Point], min_vertices: int) -> list[Point]:
    """
    동일선상(collinear) 정점만 병합한다.

    직교화 **이후에만** 수행하고, 정점 수가 `min_vertices` 아래로 떨어지면
    중단한다 — L자형이 사각형으로 붕괴하는 것을 막는다.
    """
    pts = list(pts)
    changed = True
    while changed and len(pts) > max(3, min_vertices):
        changed = False
        n = len(pts)
        for i in range(n):
            a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
            cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(cross) < 1e-6:
                del pts[i]
                changed = True
                break
    return pts


def orthogonalize(poly: Polygon,
                  deg: Optional[float] = None,
                  min_vertices: Optional[int] = None) -> Polygon:
    """
    변 단위 직교화 + 동일선상 정점 병합.

    Args:
        poly: 대상 폴리곤 (홀 포함 가능).
        deg: 축과 이 각도 이내인 변을 축에 정렬한다. None 이면 설정값(5°).
        min_vertices: 정점 병합 하한. None 이면 설정값(6).

    Returns:
        직교화된 폴리곤. 홀도 같은 규칙으로 처리한다.
        결과가 유효하지 않으면 원본을 돌려준다 — 형상을 망가뜨리지 않는다.
    """
    d = deg if deg is not None else float(config.geometry("orthogonalize_deg", 5.0))
    mv = int(min_vertices if min_vertices is not None
             else config.geometry("min_vertices_keep", 6))

    shell = _merge_collinear(_orthogonalize_ring(_ring_points(poly.exterior), d), mv)
    if len(shell) < 3:
        return poly
    holes = []
    for ring in poly.interiors:
        h = _merge_collinear(_orthogonalize_ring(_ring_points(ring), d), mv)
        if len(h) >= 3:
            holes.append(h)

    try:
        out = Polygon(shell, holes)
    except Exception:
        return poly
    if out.is_empty or not out.is_valid:
        fixed = out.buffer(0)
        if isinstance(fixed, Polygon) and not fixed.is_empty:
            return fixed
        return poly
    return out


def snap_to_walls(poly: Polygon, wall_edges: Sequence, tol_mm: Optional[float] = None
                  ) -> tuple[Polygon, float]:
    """
    벽체 마스크 내부 경계선에 정점을 스냅한다.

    Args:
        poly: 대상 폴리곤.
        wall_edges: 스냅 대상 선분 기하 (shapely LineString 시퀀스).
        tol_mm: 이 거리 안이면 벽면 위로 이동. None 이면 설정값(30mm).

    Returns:
        (스냅된 폴리곤, 스냅 실패 정점 비율 0.0~1.0)
        실패 비율이 20% 이상이면 호출부가 `근사` 배지를 붙여야 한다.
    """
    tol = tol_mm if tol_mm is not None else float(
        config.geometry("snap_tolerance_mm", 30.0))
    if not wall_edges:
        return poly, 1.0

    from shapely import STRtree
    from shapely.geometry import Point as ShPoint

    tree = STRtree(list(wall_edges))
    total = 0
    missed = 0

    def snap_ring(pts: Sequence[Point]) -> list[Point]:
        nonlocal total, missed
        out: list[Point] = []
        for x, y in pts:
            total += 1
            p = ShPoint(x, y)
            idx = tree.query(p.buffer(tol))
            best, best_d = None, tol
            for i in idx:
                geom = wall_edges[int(i)]
                d = geom.distance(p)
                if d <= best_d:
                    best, best_d = geom, d
            if best is None:
                missed += 1
                out.append((x, y))
                continue
            q = best.interpolate(best.project(p))
            out.append((float(q.x), float(q.y)))
        return out

    shell = snap_ring(_ring_points(poly.exterior))
    holes = [snap_ring(_ring_points(r)) for r in poly.interiors]
    try:
        out = Polygon(shell, [h for h in holes if len(h) >= 3])
        if out.is_empty or not out.is_valid:
            out = poly
    except Exception:
        out = poly
    return out, (missed / total if total else 1.0)


def refine(poly: Polygon, wall_edges: Sequence = (), *,
           epsilon_mm: Optional[float] = None,
           deg: Optional[float] = None,
           tol_mm: Optional[float] = None) -> tuple[Polygon, float]:
    """
    S7 전체 절차 — 단순화 → 직교화 → 벽면 스냅 → 동일선상 병합.

    Returns:
        (정리된 폴리곤, 스냅 실패 정점 비율)
    """
    out = simplify_outline(poly, epsilon_mm)
    out = orthogonalize(out, deg)
    if wall_edges:
        out, miss = snap_to_walls(out, wall_edges, tol_mm)
        out = orthogonalize(out, deg)   # 스냅으로 흔들린 변을 다시 정렬
        return out, miss
    return out, 1.0
