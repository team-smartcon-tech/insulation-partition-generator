# -*- coding: utf-8 -*-
"""
S6 — 다중 시드 영역 분할 (Multi-seed Region Partition).

왜 단일 시드 확장으로는 안 되는가
    개방형 LDK(거실 ↔ 주방/식당)와 문 개구부 때문에 여러 실이 **물리적으로
    하나의 연결된 공간**이다. 어디서 멈춰야 하는지가 도면에 선으로 존재하지
    않으므로 시드 하나를 퍼뜨리는 방식은 원리적으로 분리할 수 없다.
    tolerance 조정으로 해결되는 문제가 아니다.

핵심
    실명 시드를 **전부 동시에** 확장시켜 영역끼리 충돌하는 지점을 경계로 삼는다.
    개구부에서는 두 영역이 가장 좁은 목(throat)에서 만나 자연히 갈라진다.

반드시 지킬 것
    · 모든 시드가 **같은 스텝 간격**으로 확장된다. 순차 처리하면 먼저 처리된
      실이 옆방을 먹는다.
    · 문·개방부에 가상 폐합선을 그리지 않는다. 충돌로 자동 분리되므로 불필요하고,
      임의로 막으면 실제 벽과 구분이 사라진다.
    · 충돌로 생긴 변은 `개방부 경계선`으로 표시한다. 실제 벽이 아니므로
      걸레받이·도배에서 제외해야 한다. 이 구분이 없으면 물량이 틀린다.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import MultiPolygon, Polygon

from ..config import loader as config

Point = tuple[float, float]


@dataclass
class RegionResult:
    """시드 하나에 대응하는 영역."""

    seed_index: int
    name: str
    category: str
    polygon: Optional[Polygon]
    area_mm2: float
    touched_unit_border: bool = False
    """세대 경계까지 확장됨 — 누출 의심. 사용자에게 알려야 한다."""
    has_open_edge: bool = False
    """다른 영역과 충돌한 변이 있음 → `개방부 분할` 배지."""
    open_edge_px: int = 0
    """충돌 경계 픽셀 수 — 개방부 길이 추정에 쓴다."""
    snap_miss_ratio: float = 1.0
    """벽면 스냅 실패 정점 비율. 0.2 이상이면 `근사` 배지를 붙인다."""

    @property
    def badge(self) -> str:
        """신뢰도 배지 — 정확 / 개방부 분할 / 근사 / 실패."""
        if self.polygon is None:
            return "실패"
        if self.snap_miss_ratio >= 0.2:
            return "근사"
        if self.has_open_edge:
            return "개방부 분할"
        return "정확"


@dataclass
class PartitionResult:
    regions: list[RegionResult] = field(default_factory=list)
    res_mm: float = 10.0
    origin_mm: Point = (0.0, 0.0)
    unassigned_px: int = 0
    """시드에 속하지 않은 빈 공간 픽셀 — 미지정 영역 후보."""


def unary_union_safe(geoms):
    """빈/무효 기하를 걸러 합친다."""
    from shapely.ops import unary_union
    ok = [g for g in geoms if g is not None and not g.is_empty]
    return unary_union(ok) if ok else Polygon()


def _rasterize_mask(mask, x0: float, y0: float, w: int, h: int,
                    res_mm: float, dilate_px: int) -> np.ndarray:
    """
    벽체 마스크를 **채워서** 렌더링한다.

    선 장벽이 아니라 면(fill)이라 영역이 벽 두께를 넘을 수 없다.
    dilate 는 1px 까지만 — 2px 이상이면 좁은 요철이 메워져 형상이 뭉개진다.
    """
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)

    geoms = mask.geoms if isinstance(mask, MultiPolygon) else [mask]
    for g in geoms:
        if g.is_empty:
            continue
        def to_px(coords):
            return [((x - x0) / res_mm, (y - y0) / res_mm) for x, y in coords]
        d.polygon(to_px(g.exterior.coords), fill=255)
        for ring in g.interiors:
            d.polygon(to_px(ring.coords), fill=0)

    arr = np.array(img) > 0
    if dilate_px > 0:
        # 4-이웃 팽창을 dilate_px 회 — scipy 없이 numpy 시프트로 처리
        for _ in range(min(dilate_px, 1)):
            grown = arr.copy()
            grown[1:, :] |= arr[:-1, :]
            grown[:-1, :] |= arr[1:, :]
            grown[:, 1:] |= arr[:, :-1]
            grown[:, :-1] |= arr[:, 1:]
            arr = grown
    return arr


def _relocate_seed(barrier: np.ndarray, r: int, c: int, radius_px: int
                   ) -> Optional[tuple[int, int]]:
    """시드가 벽체 위에 있으면 반경 안 최근접 공백 픽셀로 옮긴다."""
    h, w = barrier.shape
    if 0 <= r < h and 0 <= c < w and not barrier[r, c]:
        return r, c
    for rad in range(1, radius_px + 1):
        for dr in range(-rad, rad + 1):
            for dc in (-rad, rad) if abs(dr) != rad else range(-rad, rad + 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < h and 0 <= cc < w and not barrier[rr, cc]:
                    return rr, cc
    return None


def partition(mask, seeds: Sequence[tuple[str, str, Point]],
              unit_bbox_mm: tuple[float, float, float, float], *,
              res_mm: Optional[float] = None,
              dilate_px: Optional[int] = None,
              seed_radius_mm: Optional[float] = None,
              pad_mm: float = 2000.0,
              extra_barriers: Sequence = (),
              wall_edges: Sequence = ()) -> PartitionResult:
    """
    다중 시드 동시 확장으로 세대 내부를 실 단위로 분할한다.

    Args:
        mask: 벽체 솔리드 마스크 (shapely Polygon/MultiPolygon).
        seeds: [(실명, 카테고리, (x_mm, y_mm)), ...] — EXCLUDE 는 넣지 말 것.
        unit_bbox_mm: 세대 영역 (minx, miny, maxx, maxy).
        res_mm: 래스터 해상도. None 이면 설정값(10mm).
        dilate_px: 마스크 팽창 픽셀. None 이면 설정값(1). 2 이상 금지.
        seed_radius_mm: 시드가 벽 위일 때 옮길 반경. None 이면 설정값(500mm).
        pad_mm: 격자를 세대 영역보다 이만큼 넓게 잡는다.
            실명 범위로 만든 bbox 는 세대분리벽이 **격자 밖**에 놓여 벽이 장벽으로
            렌더되지 않는다. 그러면 영역이 박스 경계로 새어나가고 (실측: 12실 중
            8실이 누출 경고) 현관이 공용홀까지 먹어 20㎡ 가 된다.
            여유를 주면 외벽·세대분리벽이 격자 안에 들어와 물리적으로 막힌다.
        extra_barriers: 추가 장벽 폴리곤 (예: 현관문 개구부 폐합 — 세대 밖으로
            나가는 통로를 막는다). 실 사이 개구부에는 쓰지 않는다.
        wall_edges: 벽면 선분. 주면 결과 정점을 벽면에 스냅해 **안목치수**로
            맞추고 래스터 계단(정점 수백 개)을 정리한다.

    Returns:
        PartitionResult — 시드별 영역 폴리곤 + 개방부 충돌 여부 + 누출 경고.
    """
    g = config.takeoff().get("geometry", {})
    res = float(res_mm if res_mm is not None else g.get("raster_res_mm", 10))
    dil = int(dilate_px if dilate_px is not None else g.get("mask_dilate_px", 1))
    srad = float(seed_radius_mm if seed_radius_mm is not None
                 else g.get("seed_relocate_radius_mm", 500))

    ux0, uy0, ux1, uy1 = unit_bbox_mm
    x0, y0 = ux0 - pad_mm, uy0 - pad_mm
    x1, y1 = ux1 + pad_mm, uy1 + pad_mm
    w = max(2, int((x1 - x0) / res) + 1)
    h = max(2, int((y1 - y0) / res) + 1)

    barrier = _rasterize_mask(mask, x0, y0, w, h, res, dil)
    if extra_barriers:
        extra = _rasterize_mask(unary_union_safe(extra_barriers),
                                x0, y0, w, h, res, dil)
        barrier |= extra

    # 라벨 0 = 미할당, 1.. = 시드 순번
    labels = np.zeros((h, w), dtype=np.int32)
    q: deque[tuple[int, int, int]] = deque()
    placed: dict[int, tuple[int, int]] = {}

    for i, (_name, _cat, (sx, sy)) in enumerate(seeds, start=1):
        c = int((sx - x0) / res)
        r = int((sy - y0) / res)
        pos = _relocate_seed(barrier, r, c, int(srad / res))
        if pos is None:
            continue
        rr, cc = pos
        if labels[rr, cc] != 0:
            continue
        labels[rr, cc] = i
        placed[i] = (rr, cc)
        q.append((rr, cc, i))

    # ── 동시 확장 (multi-source BFS) ─────────────────────────
    # 큐를 시드별로 나누지 않고 하나로 쓰면 FIFO 특성상 모든 시드가 같은
    # 스텝 간격으로 퍼진다. 시드마다 순차 처리하면 먼저 돈 실이 옆방을 먹는다.
    open_edge = {i: 0 for i in placed}
    touched = {i: False for i in placed}

    while q:
        r, c, lab = q.popleft()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            rr, cc = r + dr, c + dc
            if rr < 0 or rr >= h or cc < 0 or cc >= w:
                touched[lab] = True          # 세대 경계 도달 → 누출 의심
                continue
            if barrier[rr, cc]:
                continue
            other = labels[rr, cc]
            if other == 0:
                labels[rr, cc] = lab
                q.append((rr, cc, lab))
            elif other != lab:
                # 다른 영역과 조우 → 여기가 개방부 경계다. 더 밀지 않는다.
                open_edge[lab] += 1

    # ── 라벨 → 폴리곤 ────────────────────────────────────────
    from .refine import orthogonalize, simplify_outline

    regions: list[RegionResult] = []
    for i, (name, cat, _pt) in enumerate(seeds, start=1):
        if i not in placed:
            regions.append(RegionResult(i - 1, name, cat, None, 0.0))
            continue
        poly = _label_to_polygon(labels == i, x0, y0, res)
        if poly is None:
            regions.append(RegionResult(i - 1, name, cat, None, 0.0,
                                        touched_unit_border=touched[i]))
            continue
        poly = simplify_outline(poly)
        miss = 1.0
        if wall_edges:
            from .refine import snap_to_walls
            poly, miss = snap_to_walls(poly, wall_edges)
        poly = orthogonalize(poly)
        regions.append(RegionResult(
            seed_index=i - 1, name=name, category=cat, polygon=poly,
            area_mm2=float(poly.area),
            touched_unit_border=touched[i],
            has_open_edge=open_edge[i] > 0,
            open_edge_px=open_edge[i],
            snap_miss_ratio=miss,
        ))

    unassigned = int(((labels == 0) & (~barrier)).sum())
    return PartitionResult(regions=regions, res_mm=res,
                           origin_mm=(x0, y0), unassigned_px=unassigned)


def _label_to_polygon(mask_bool: np.ndarray, x0: float, y0: float,
                      res_mm: float) -> Optional[Polygon]:
    """
    라벨 마스크 → 폴리곤. 픽셀 사각형을 합쳐 정확한 계단 윤곽을 만든다.

    marching squares 대비 정점이 많지만 S7 단순화·직교화가 정리한다.
    윤곽을 근사하지 않으므로 요철이 소실되지 않는다.
    """
    if not mask_bool.any():
        return None
    from shapely.geometry import box as shbox
    from shapely.ops import unary_union

    # 행 단위 런렝스로 사각형을 만들어 합친다 (픽셀마다 폴리곤을 만들지 않는다)
    rects = []
    h, w = mask_bool.shape
    for r in range(h):
        row = mask_bool[r]
        if not row.any():
            continue
        c = 0
        while c < w:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < w and row[c]:
                c += 1
            rects.append(shbox(x0 + start * res_mm, y0 + r * res_mm,
                               x0 + c * res_mm, y0 + (r + 1) * res_mm))
    if not rects:
        return None
    merged = unary_union(rects)
    if merged.is_empty:
        return None
    if isinstance(merged, MultiPolygon):
        merged = max(merged.geoms, key=lambda g: g.area)
    return merged if isinstance(merged, Polygon) else None
