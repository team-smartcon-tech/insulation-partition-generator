# -*- coding: utf-8 -*-
"""
S3 — 벽체 솔리드 마스크 생성. **정확도의 8할이 여기서 결정된다.**

벽체를 선이 아니라 두께를 가진 면(폴리곤)으로 다룬다.

왜 선 장벽이 아니라 마스크인가
    선 장벽 방식은 이중선 중 한쪽만 수집되면 영역이 벽 속으로 팽창해 면적이
    틀어진다. 마스크는 영역이 벽 두께를 물리적으로 넘을 수 없으므로 결과
    경계가 자동으로 **안목치수**(벽체 내부 마감면)가 된다.

우선순위
    A. 벽체 레이어의 HATCH 경계 (PolylinePath / EdgePath)
    B. SOLID / TRACE 4정점
    C. 이중선 페어링 — 간격 80~400mm, 겹침이 짧은 선분의 50% 이상
    D. 창호·문틀 구간은 벽체와 동일하게 채우되 개구부 속성을 따로 둔다

이 도면(실측): 벽체 레이어에 HATCH 0개 → **C 가 주 경로**다.
페어를 못 찾은 고립 선분은 기본 두께로 buffer 하고 `추정 벽체` 플래그를 세운다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union

from ..config import loader as config

Point = tuple[float, float]
Segment = tuple[Point, Point]


@dataclass
class MaskStats:
    """마스크 생성 결과 진단 — 게이트 판정에 그대로 쓴다."""

    paired: int = 0
    """이중선 페어로 만든 벽체 조각 수."""
    hatch: int = 0
    solid: int = 0
    estimated: int = 0
    """페어를 못 찾아 기본 두께로 추정한 조각 수 — 화면에 별색 표시 대상."""
    area_mm2: float = 0.0
    drawing_area_mm2: float = 0.0
    necks: list[Point] = field(default_factory=list)
    """두께 20mm 미만 병목(끊김) 좌표 — 여기서 반드시 누출이 생긴다."""

    @property
    def area_ratio(self) -> float:
        """마스크 면적 / 도면 면적. 아파트 평면 통상 0.10~0.20."""
        if self.drawing_area_mm2 <= 0:
            return 0.0
        return self.area_mm2 / self.drawing_area_mm2


@dataclass
class WallMask:
    """벽체 마스크 + 개구부(창호·문) 조각 + 진단."""

    solid: Polygon | MultiPolygon
    """벽체 전체 마스크 (unary_union 결과)."""
    openings: list[Polygon] = field(default_factory=list)
    """창호·문틀 조각. 마스크에는 포함되지만 도배·걸레받이에서 공제 대상이다."""
    estimated: list[Polygon] = field(default_factory=list)
    """추정 두께로 만든 조각 — 사용자 확인이 필요한 부분."""
    stats: MaskStats = field(default_factory=MaskStats)

    def inner_edges(self) -> list[LineString]:
        """
        마스크의 경계선 — S7 벽면 스냅의 대상.

        외곽링과 홀 링을 모두 낸다. 실 경계는 마스크의 홀 쪽 링에 해당한다.
        """
        out: list[LineString] = []
        geoms = (self.solid.geoms if isinstance(self.solid, MultiPolygon)
                 else [self.solid])
        for g in geoms:
            if g.is_empty:
                continue
            out.append(LineString(g.exterior.coords))
            out.extend(LineString(r.coords) for r in g.interiors)
        return out


def _classify_axis(seg: Segment, tol_mm: float, min_len_mm: float
                   ) -> Optional[tuple[str, float, float, float]]:
    """
    선분을 축정렬 형태로 정규화한다.

    Returns:
        ("v", x, y0, y1) 또는 ("h", y, x0, x1). 축정렬이 아니거나 짧으면 None.
    """
    (x1, y1), (x2, y2) = seg
    dx, dy = abs(x1 - x2), abs(y1 - y2)
    if dx <= tol_mm and dy >= min_len_mm:
        return "v", (x1 + x2) / 2.0, min(y1, y2), max(y1, y2)
    if dy <= tol_mm and dx >= min_len_mm:
        return "h", (y1 + y2) / 2.0, min(x1, x2), max(x1, x2)
    return None


def clip_segments(segments: Sequence[Segment],
                  bbox_mm: tuple[float, float, float, float],
                  pad_mm: float = 1500.0) -> list[Segment]:
    """
    선분을 관심 영역에 **자른다**. 영역을 넘는 선분을 버리지 않는 것이 핵심이다.

    실측 사고: 세대 박스 필터를 "양 끝점이 모두 박스 안" 으로 만들었더니
    박스를 넘나드는 3~4m 짜리 벽선이 통째로 버려져 마스크가 벽 토막만 남았다.
    그 결과 모든 실이 한 공간으로 이어져 분할이 시드 충돌선에만 의존했고
    실별 면적이 최대 98% 까지 어긋났다. 클립으로 바꾸자 마스크 비율이
    11% → 17%, 세대 전체 면적 편차가 0.7% 로 떨어졌다.

    Args:
        segments: 원본 선분 (mm).
        bbox_mm: 관심 영역 (minx, miny, maxx, maxy).
        pad_mm: 영역 밖으로 이만큼 여유를 두고 자른다 — 경계 벽이 살아 있어야
            영역이 밖으로 새지 않는다.

    Returns:
        잘린 선분 목록. 영역과 겹치지 않는 선분은 제외된다.
    """
    x0, y0 = bbox_mm[0] - pad_mm, bbox_mm[1] - pad_mm
    x1, y1 = bbox_mm[2] + pad_mm, bbox_mm[3] + pad_mm
    out: list[Segment] = []
    for (ax, ay), (bx, by) in segments:
        if max(ax, bx) < x0 or min(ax, bx) > x1:
            continue
        if max(ay, by) < y0 or min(ay, by) > y1:
            continue
        nax, nbx = max(x0, min(ax, x1)), max(x0, min(bx, x1))
        nay, nby = max(y0, min(ay, y1)), max(y0, min(by, y1))
        if nax == nbx and nay == nby:
            continue
        out.append(((nax, nay), (nbx, nby)))
    return out


def merge_collinear(lines: list[tuple[float, float, float]],
                    coord_tol_mm: float = 2.0,
                    gap_tol_mm: float = 30.0) -> list[tuple[float, float, float]]:
    """
    같은 좌표선 위의 선분들을 하나로 이어붙인다. **페어링 전에 반드시 한다.**

    이 도면의 벽선은 400~500mm 토막으로 쪼개져 있다 (실측: `AA-WAXM-CONC`
    중앙값 370mm, `ASMB` 522mm — 방 벽 한 면은 3~4m 다). 토막 상태로 페어링하면
    겹침 조건(짧은 선분의 50%)이 산발적으로만 성립해 마스크가 구멍난 벽 토막이
    되고, 실이 전부 한 공간으로 이어져 분할이 시드 충돌선에만 의존하게 된다.

    Args:
        lines: (좌표, 시작, 끝) 형태의 축정렬 선분.
        coord_tol_mm: 이 이내면 같은 좌표선으로 본다.
        gap_tol_mm: 길이 방향으로 이 이내로 떨어져 있으면 이어붙인다
            (끝점 벌어짐 0.01~5mm 는 일상이고, 문틀 사이 30mm 정도도 잇는다).

    Returns:
        이어붙인 선분 목록.
    """
    if not lines:
        return []
    # 좌표를 tol 격자로 양자화해 묶는다 — 이중 루프를 쓰지 않는다
    buckets: dict[int, list[tuple[float, float, float]]] = {}
    for c, a, b in lines:
        buckets.setdefault(int(round(c / coord_tol_mm)), []).append((c, a, b))

    out: list[tuple[float, float, float]] = []
    for key, group in buckets.items():
        group.sort(key=lambda t: t[1])
        cur_c, cur_a, cur_b = group[0]
        csum, cnt = cur_c, 1
        for c, a, b in group[1:]:
            if a <= cur_b + gap_tol_mm:
                cur_b = max(cur_b, b)
                csum += c
                cnt += 1
            else:
                out.append((csum / cnt, cur_a, cur_b))
                cur_c, cur_a, cur_b = c, a, b
                csum, cnt = c, 1
        out.append((csum / cnt, cur_a, cur_b))
    return out


def _pair_axis(lines: list[tuple[float, float, float]],
               kind: str, t_min: float, t_max: float, overlap_ratio: float
               ) -> tuple[list[Polygon], set[int]]:
    """
    같은 방향 선분들을 좌표순으로 정렬해 **이웃만** 검사한다 (O(n log n)).

    이중 루프 O(n²) 는 쓰지 않는다. 겹침 길이가 짧은 선분의 `overlap_ratio`
    이상일 때만 같은 벽의 양면으로 본다.

    Returns:
        (벽체 조각 폴리곤들, 페어에 참여한 선분 인덱스 집합)
    """
    order = sorted(range(len(lines)), key=lambda i: lines[i][0])
    polys: list[Polygon] = []
    used: set[int] = set()

    for oi, i in enumerate(order):
        c0, a0, b0 = lines[i]
        for oj in range(oi + 1, len(order)):
            j = order[oj]
            c1, a1, b1 = lines[j]
            gap = c1 - c0
            if gap > t_max:
                break
            if gap < t_min:
                continue
            lo, hi = max(a0, a1), min(b0, b1)
            ov = hi - lo
            if ov <= 0:
                continue
            shorter = min(b0 - a0, b1 - a1)
            if shorter <= 0 or ov < shorter * overlap_ratio:
                continue
            if kind == "v":
                polys.append(box(c0, lo, c1, hi))
            else:
                polys.append(box(lo, c0, hi, c1))
            used.add(i)
            used.add(j)
    return polys, used


def _from_hatch(doc, scale: float, layers: set[str], chord_mm: float
                ) -> list[Polygon]:
    """
    방법 A — 벽체 레이어 HATCH 의 boundary path 를 폴리곤으로.

    PolylinePath 와 EdgePath 를 모두 처리한다. EdgePath 의 곡선 엣지는
    `chord_mm` 이하 현 길이로 이산화한다. external 은 외곽, inner/island 는 홀.
    """
    out: list[Polygon] = []
    for e in doc.modelspace():
        if e.dxftype() != "HATCH" or e.dxf.layer not in layers:
            continue
        shells: list[list[Point]] = []
        holes: list[list[Point]] = []
        try:
            paths = list(e.paths)
        except Exception:
            continue
        for p in paths:
            pts = _path_points(p, scale, chord_mm)
            if len(pts) < 3:
                continue
            # ezdxf: path_type_flags bit0=external, bit1=outermost
            try:
                external = bool(getattr(p, "path_type_flags", 1) & 1)
            except Exception:
                external = True
            (shells if external else holes).append(pts)
        for s in shells:
            try:
                poly = Polygon(s, holes)
                if poly.is_valid and not poly.is_empty:
                    out.append(poly)
            except Exception:
                continue
    return out


def _path_points(path, scale: float, chord_mm: float) -> list[Point]:
    """HATCH boundary path → 정점 목록 (곡선은 이산화)."""
    pts: list[Point] = []
    vertices = getattr(path, "vertices", None)
    if vertices:
        return [(v[0] * scale, v[1] * scale) for v in vertices]
    edges = getattr(path, "edges", None)
    if not edges:
        return pts
    for ed in edges:
        t = type(ed).__name__
        try:
            if t == "LineEdge":
                pts.append((ed.start[0] * scale, ed.start[1] * scale))
                pts.append((ed.end[0] * scale, ed.end[1] * scale))
            elif t == "ArcEdge":
                cx, cy = ed.center[0] * scale, ed.center[1] * scale
                r = ed.radius * scale
                a0, a1 = math.radians(ed.start_angle), math.radians(ed.end_angle)
                if a1 < a0:
                    a1 += 2 * math.pi
                steps = max(2, int(abs(a1 - a0) * r / max(chord_mm, 1.0)))
                for k in range(steps + 1):
                    a = a0 + (a1 - a0) * k / steps
                    pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            elif t in ("SplineEdge", "EllipseEdge"):
                ctrl = getattr(ed, "control_points", None) or []
                pts.extend((c[0] * scale, c[1] * scale) for c in ctrl)
        except Exception:
            continue
    return pts


def _from_solid(doc, scale: float, layers: set[str]) -> list[Polygon]:
    """방법 B — SOLID / TRACE 4정점을 폴리곤으로."""
    out: list[Polygon] = []
    for e in doc.modelspace():
        if e.dxftype() not in ("SOLID", "TRACE") or e.dxf.layer not in layers:
            continue
        try:
            v = [e.dxf.vtx0, e.dxf.vtx1, e.dxf.vtx2, e.dxf.vtx3]
            # SOLID 는 vtx2/vtx3 순서가 뒤집혀 있다 (DXF 규격)
            ring = [(v[0][0], v[0][1]), (v[1][0], v[1][1]),
                    (v[3][0], v[3][1]), (v[2][0], v[2][1])]
            ring = [(x * scale, y * scale) for x, y in ring]
            poly = Polygon(ring)
            if poly.is_valid and poly.area > 0:
                out.append(poly)
        except Exception:
            continue
    return out


def build(segments: Sequence[Segment], *,
          doc=None,
          scale: float = 1.0,
          wall_layers: Optional[Iterable[str]] = None,
          opening_segments: Sequence[Segment] = (),
          drawing_bbox_mm: Optional[tuple[float, float, float, float]] = None,
          thickness_min_mm: Optional[float] = None,
          thickness_max_mm: Optional[float] = None,
          default_thickness_mm: Optional[float] = None,
          overlap_ratio: float = 0.5,
          axis_tol_mm: float = 1.0,
          min_len_mm: float = 150.0,
          neck_threshold_mm: float = 20.0) -> WallMask:
    """
    벽체 솔리드 마스크를 만든다.

    Args:
        segments: 벽체 레이어 선분 (mm 좌표).
        doc: ezdxf Drawing. 주면 HATCH/SOLID 경로(A·B)도 시도한다.
        scale: 도면 단위 → mm 배율 (doc 을 줄 때 필요).
        wall_layers: HATCH/SOLID 를 찾을 벽체 레이어.
        opening_segments: 창호·문틀 선분. 마스크에 포함하되 개구부로 표시한다.
        drawing_bbox_mm: 면적 비율 계산용 도면 범위.
        thickness_min_mm, thickness_max_mm: 이중선 페어 인정 간격.
        default_thickness_mm: 페어를 못 찾은 고립 선분의 추정 두께.
        overlap_ratio: 겹침 길이 / 짧은 선분 길이 최소 비율.
        axis_tol_mm: 축정렬 판정 허용 편차.
        min_len_mm: 이보다 짧은 선분은 기호·해칭으로 보고 제외.
        neck_threshold_mm: 이 두께 미만 구간을 병목(끊김)으로 신고한다.

    Returns:
        WallMask — 마스크·개구부·추정조각·진단.
    """
    g = config.takeoff().get("geometry", {})
    t_min = float(thickness_min_mm if thickness_min_mm is not None
                  else g.get("wall_thickness_min_mm", 80))
    t_max = float(thickness_max_mm if thickness_max_mm is not None
                  else g.get("wall_thickness_max_mm", 400))
    t_def = float(default_thickness_mm if default_thickness_mm is not None
                  else g.get("wall_thickness_default_mm", 150))

    stats = MaskStats()
    pieces: list[Polygon] = []

    # A. HATCH — 이 도면에는 없지만 다른 도면에서는 1순위다
    if doc is not None and wall_layers:
        hp = _from_hatch(doc, scale, set(wall_layers), chord_mm=10.0)
        stats.hatch = len(hp)
        pieces.extend(hp)
        sp = _from_solid(doc, scale, set(wall_layers))
        stats.solid = len(sp)
        pieces.extend(sp)

    # C. 이중선 페어링 (주 경로)
    verts: list[tuple[float, float, float]] = []
    horis: list[tuple[float, float, float]] = []
    vmap: list[int] = []
    hmap: list[int] = []
    others: list[Segment] = []
    for idx, seg in enumerate(segments):
        cls = _classify_axis(seg, axis_tol_mm, min_len_mm)
        if cls is None:
            (x1, y1), (x2, y2) = seg
            if math.hypot(x2 - x1, y2 - y1) >= min_len_mm:
                others.append(seg)   # 사선벽 — 그대로 두께 부여
            continue
        kind, c, a, b = cls
        if kind == "v":
            vmap.append(idx)
            verts.append((c, a, b))
        else:
            hmap.append(idx)
            horis.append((c, a, b))

    # 토막난 벽선을 먼저 이어붙인다 — 이걸 빼면 마스크가 벽 토막이 된다
    verts = merge_collinear(verts)
    horis = merge_collinear(horis)
    vp, vused = _pair_axis(verts, "v", t_min, t_max, overlap_ratio)
    hp2, hused = _pair_axis(horis, "h", t_min, t_max, overlap_ratio)
    stats.paired = len(vp) + len(hp2)
    pieces.extend(vp)
    pieces.extend(hp2)

    # 페어 실패 선분 → 기본 두께로 buffer (추정 벽체)
    est: list[Polygon] = []
    for k, (c, a, b) in enumerate(verts):
        if k in vused:
            continue
        est.append(box(c - t_def / 2, a, c + t_def / 2, b))
    for k, (c, a, b) in enumerate(horis):
        if k in hused:
            continue
        est.append(box(a, c - t_def / 2, b, c + t_def / 2))
    for seg in others:
        est.append(LineString(seg).buffer(t_def / 2, cap_style=2, join_style=2))
    stats.estimated = len(est)
    pieces.extend(est)

    # D. 창호·문틀 — 실 경계이므로 마스크에 채우되 개구부로 표시
    openings: list[Polygon] = []
    if opening_segments:
        ov: list[tuple[float, float, float]] = []
        oh: list[tuple[float, float, float]] = []
        for seg in opening_segments:
            cls = _classify_axis(seg, axis_tol_mm, min_len_mm)
            if cls is None:
                continue
            kind, c, a, b = cls
            (ov if kind == "v" else oh).append((c, a, b))
        op_v, _ = _pair_axis(merge_collinear(ov), "v", t_min, t_max, overlap_ratio)
        op_h, _ = _pair_axis(merge_collinear(oh), "h", t_min, t_max, overlap_ratio)
        openings = op_v + op_h
        pieces.extend(openings)

    solid = unary_union([p for p in pieces if p.is_valid and not p.is_empty])
    if solid.is_empty:
        solid = Polygon()

    stats.area_mm2 = float(solid.area)
    if drawing_bbox_mm:
        x0, y0, x1, y1 = drawing_bbox_mm
        stats.drawing_area_mm2 = max(0.0, (x1 - x0) * (y1 - y0))
    stats.necks = find_necks(solid, neck_threshold_mm)

    return WallMask(solid=solid, openings=openings, estimated=est, stats=stats)


def find_necks(solid, threshold_mm: float) -> list[Point]:
    """
    두께 `threshold_mm` 미만인 병목(끊김) 구간을 찾는다.

    끊긴 곳에서는 반드시 누출이 생기므로 화면에 빨간색으로 표시해
    사용자가 보정하게 해야 한다.

    음의 buffer 로 얇은 부분을 지운 뒤 원본과 비교해 사라진 조각의
    대표점을 돌려준다 — 전수 거리계산보다 훨씬 싸다.
    """
    if solid.is_empty:
        return []
    try:
        eroded = solid.buffer(-threshold_mm / 2.0)
    except Exception:
        return []
    if eroded.is_empty:
        return []
    lost = solid.difference(eroded.buffer(threshold_mm / 2.0))
    if lost.is_empty:
        return []
    geoms = getattr(lost, "geoms", [lost])
    out: list[Point] = []
    for gg in geoms:
        if gg.is_empty or gg.area < threshold_mm * threshold_mm:
            continue
        p = gg.representative_point()
        out.append((round(float(p.x), 1), round(float(p.y), 1)))
    return out
