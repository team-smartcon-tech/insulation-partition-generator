# -*- coding: utf-8 -*-
"""
래스터 폴백 (2차 추적) — 벡터 폐합이 실패한 도면용.

벡터 polygonize 는 선이 **완전히 닫혀야** 면을 만든다. 실무 도면에는 벽선이
일부만 그려진 검토도가 흔해서, 그런 도면은 벡터로는 영원히 실을 못 잡는다.
이때 픽셀로 채워서라도 면적을 낸다.

절차 (명세 STEP 5)
  1. 클릭점 주변 RASTER_WINDOW_MM 를 RASTER_RESOLUTION_MM/px 로 래스터화
  2. 클릭점에서 flood fill (4-connectivity)
  3. **채운 영역이 이미지 경계에 닿으면 → 폐합 실패로 확정한다.**
     (열린 공간으로 새어나간 것이므로 면적을 내면 거짓말이 된다)
  4. 안 닿으면 외곽선 추출 → 폴리곤화 → 원본 벡터에 스냅
  5. `TraceMethod.RASTER` 로 표시 — UI 는 '근사추적' 배지를 반드시 붙인다

**래스터 결과는 벡터 결과와 시각적으로 구분되어야 한다.**
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Polygon
from shapely import STRtree

from ..constants import (
    RASTER_LINE_THICKNESS_PX,
    RASTER_RESOLUTION_MM,
    RASTER_WINDOW_MM,
)
from ..models import RoomWarning

log = logging.getLogger(__name__)

Point = tuple[float, float]
Segment = tuple[Point, Point]


@dataclass
class RasterResult:
    """래스터 추적 결과."""

    polygon: Optional[Polygon]
    warnings: list[RoomWarning]
    touched_border: bool
    """True 면 열린 공간으로 새어나간 것 — 면적을 신뢰할 수 없다."""
    filled_px: int
    resolution_mm: float

    @property
    def ok(self) -> bool:
        return self.polygon is not None

    @property
    def area_m2(self) -> float:
        return (self.polygon.area / 1_000_000.0) if self.polygon else 0.0


def _rasterize(
    segments: Sequence[Segment],
    origin: Point,
    size_px: int,
    res_mm: float,
    thickness: int,
) -> Image.Image:
    """선분들을 흑백 이미지로 굽는다 (선=검정, 배경=흰색)."""
    img = Image.new("L", (size_px, size_px), 255)
    d = ImageDraw.Draw(img)
    ox, oy = origin
    for a, b in segments:
        ax = (a[0] - ox) / res_mm
        ay = size_px - (a[1] - oy) / res_mm
        bx = (b[0] - ox) / res_mm
        by = size_px - (b[1] - oy) / res_mm
        # 창 밖으로 완전히 벗어난 선은 건너뛴다
        if max(ax, bx) < 0 or min(ax, bx) > size_px:
            continue
        if max(ay, by) < 0 or min(ay, by) > size_px:
            continue
        d.line([(ax, ay), (bx, by)], fill=0, width=thickness)
    return img


def _flood_fill_pil(img: Image.Image, seed_xy: tuple[int, int]) -> np.ndarray:
    """
    PIL 의 C 구현 flood fill — 파이썬 루프보다 수십 배 빠르다.

    빈 공간(255)을 128 로 칠한 뒤 그 픽셀만 뽑아 마스크로 만든다.
    """
    work = img.copy()
    ImageDraw.floodfill(work, seed_xy, 128, thresh=0)
    return np.array(work) == 128


def _flood_fill(mask: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    """4-연결 flood fill (스택 기반 — 순수 파이썬 폴백, 테스트용)."""
    h, w = mask.shape
    filled = np.zeros_like(mask, dtype=bool)
    sy, sx = seed
    if not (0 <= sy < h and 0 <= sx < w) or not mask[sy, sx]:
        return filled

    stack = [(sy, sx)]
    filled[sy, sx] = True
    while stack:
        y, x = stack.pop()
        # 같은 행을 좌우로 먼저 밀어 스캔라인처럼 처리 (스택 크기 절감)
        x0 = x
        while x0 > 0 and mask[y, x0 - 1] and not filled[y, x0 - 1]:
            x0 -= 1
            filled[y, x0] = True
        x1 = x
        while x1 < w - 1 and mask[y, x1 + 1] and not filled[y, x1 + 1]:
            x1 += 1
            filled[y, x1] = True
        for xx in range(x0, x1 + 1):
            for yy in (y - 1, y + 1):
                if 0 <= yy < h and mask[yy, xx] and not filled[yy, xx]:
                    filled[yy, xx] = True
                    stack.append((yy, xx))
    return filled


def _mask_to_polygon(filled: np.ndarray, origin: Point, res_mm: float) -> Optional[Polygon]:
    """
    채워진 마스크의 외곽을 폴리곤으로 만든다.

    marching squares 대신 **행 단위 런렝스 → 사각형 합집합**을 쓴다.
    (추가 의존성 없이 안정적이고, 이후 벡터 스냅으로 정밀도를 복원한다.)
    """
    from shapely.ops import unary_union
    from shapely.geometry import box

    h, w = filled.shape
    ox, oy = origin
    boxes = []
    for y in range(h):
        row = filled[y]
        if not row.any():
            continue
        idx = np.flatnonzero(row)
        # 연속 구간으로 묶기
        splits = np.flatnonzero(np.diff(idx) > 1)
        starts = np.concatenate(([idx[0]], idx[splits + 1]))
        ends = np.concatenate((idx[splits], [idx[-1]]))
        wy0 = oy + (h - y - 1) * res_mm
        wy1 = wy0 + res_mm
        for s, e in zip(starts, ends):
            boxes.append(box(ox + s * res_mm, wy0, ox + (e + 1) * res_mm, wy1))
    if not boxes:
        return None
    merged = unary_union(boxes)
    if merged.geom_type == "MultiPolygon":
        merged = max(merged.geoms, key=lambda g: g.area)
    return merged if merged.geom_type == "Polygon" else None


def _snap_to_vectors(poly: Polygon, segments: Sequence[Segment], tol_mm: float) -> Polygon:
    """
    폴리곤 정점을 원본 벡터 선분에 투영해 계단 현상을 줄인다.
    (래스터 해상도만큼 생기는 톱니를 원본 선 위로 끌어당긴다.)
    """
    if not segments:
        return poly
    lines = [LineString([a, b]) for a, b in segments]
    tree = STRtree(lines)
    from shapely.geometry import Point as ShPoint

    def snap(pt: tuple[float, float]) -> tuple[float, float]:
        sp = ShPoint(pt)
        idxs = tree.query(sp.buffer(tol_mm))
        best = None
        for i in idxs:
            ls = lines[int(i)]
            d = ls.distance(sp)
            if d <= tol_mm and (best is None or d < best[0]):
                best = (d, ls.interpolate(ls.project(sp)))
        return (best[1].x, best[1].y) if best else pt

    ext = [snap(p) for p in poly.exterior.coords[:-1]]
    try:
        out = Polygon(ext)
        return out if out.is_valid and not out.is_empty else poly
    except Exception:
        return poly


def trace(
    segments: Sequence[Segment],
    click_mm: Point,
    *,
    window_mm: float = RASTER_WINDOW_MM,
    res_mm: float = RASTER_RESOLUTION_MM,
    thickness: int = RASTER_LINE_THICKNESS_PX,
    simplify_mm: float = 30.0,
) -> RasterResult:
    """
    래스터 폴백으로 실 영역을 추적한다.

    Args:
        segments: 경계 선분 (mm).
        click_mm: 클릭 좌표 (mm).
        window_mm: 추적 창 한 변 (mm).
        res_mm: 해상도 (mm/px).
        thickness: 선 두께 (px). 얇으면 미세 틈으로 새어나간다.
        simplify_mm: 폴리곤 단순화 허용오차.

    Returns:
        RasterResult — 경계에 닿으면 polygon=None (폐합 실패 확정).
    """
    t0 = time.perf_counter()
    size_px = int(window_mm / res_mm)
    origin = (click_mm[0] - window_mm / 2, click_mm[1] - window_mm / 2)

    img = _rasterize(segments, origin, size_px, res_mm, thickness)
    arr = np.array(img)
    mask = arr > 127  # True = 빈 공간

    seed = (size_px // 2, size_px // 2)  # 클릭점 = 창 중앙
    if not mask[seed]:
        return RasterResult(
            None,
            [RoomWarning("virtual_closure", "클릭 지점이 선(벽체) 위입니다. 실 내부를 클릭하세요")],
            False, 0, res_mm,
        )

    # (row, col) → PIL 은 (x, y)
    filled = _flood_fill_pil(img, (seed[1], seed[0]))
    n = int(filled.sum())

    touched = bool(
        filled[0, :].any() or filled[-1, :].any()
        or filled[:, 0].any() or filled[:, -1].any()
    )
    if touched:
        log.warning("[raster] 채움 영역이 창 경계에 닿음 — 폐합 실패로 확정 (%d px)", n)
        return RasterResult(
            None,
            [RoomWarning("approximate",
                         "열린 공간으로 새어나갔습니다 — 경계가 닫히지 않았습니다. "
                         "벽 레이어를 확인하거나 수동으로 경계를 그어주세요")],
            True, n, res_mm,
        )

    poly = _mask_to_polygon(filled, origin, res_mm)
    if poly is None:
        return RasterResult(None, [RoomWarning("approximate", "래스터 영역을 폴리곤화하지 못했습니다")],
                            False, n, res_mm)

    poly = poly.simplify(simplify_mm, preserve_topology=True)
    poly = _snap_to_vectors(poly, segments, tol_mm=res_mm * 4)

    warns = [RoomWarning("approximate",
                         f"근사 추적 (래스터 {res_mm:g}mm/px) — 벡터 폐합 실패로 폴백")]
    log.info("[raster] 근사 추적 성공 %.2f㎡ (%d px) · %.2fs",
             poly.area / 1e6, n, time.perf_counter() - t0)
    return RasterResult(poly, warns, False, n, res_mm)


def dedupe_rooms(
    results: Sequence[tuple[str, Point, "RasterResult"]],
    *,
    area_tol: float = 0.02,
    centroid_tol_mm: float = 500.0,
) -> list[tuple[list[str], "RasterResult"]]:
    """
    **같은 영역을 잡은 클릭들을 하나로 묶는다 — 이중 계상 방지.**

    거실·주방·현관처럼 문 없이 트인 공간은 flood fill 이 하나로 채운다.
    각 라벨마다 따로 계상하면 같은 면적을 여러 번 세게 되어 물량이 부풀려진다.

    Args:
        results: [(실명, 클릭점, RasterResult), ...]
        area_tol: 면적 상대 차이가 이 이하이고
        centroid_tol_mm: 중심 거리가 이 이하이면 같은 영역으로 본다.

    Returns:
        [([묶인 실명들], 대표 결과), ...] — 실명이 2개 이상이면 트인 공간이다.
    """
    groups: list[tuple[list[str], RasterResult]] = []
    for name, _click, res in results:
        if not res.ok:
            groups.append(([name], res))
            continue
        placed = False
        for names, rep in groups:
            if not rep.ok:
                continue
            a1, a2 = res.area_m2, rep.area_m2
            if a2 <= 0:
                continue
            if abs(a1 - a2) / a2 > area_tol:
                continue
            c1, c2 = res.polygon.centroid, rep.polygon.centroid
            if c1.distance(c2) > centroid_tol_mm:
                continue
            names.append(name)
            placed = True
            break
        if not placed:
            groups.append(([name], res))

    merged = sum(1 for names, _ in groups if len(names) > 1)
    if merged:
        log.warning("[raster] 트인 공간 %d곳 병합 — 같은 영역 중복 계상을 막았다", merged)
    return groups
