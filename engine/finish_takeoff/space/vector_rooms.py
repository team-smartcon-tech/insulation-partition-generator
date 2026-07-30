# -*- coding: utf-8 -*-
"""
벡터 폐합면 기반 실 인식 — 이 도면에서 **가장 정확한** 경로.

왜 이 방식인가 (실측 근거, 28세대 전수)
    래스터 채움·다중시드 확장은 빈 공간에 경쟁자가 없으면 계속 퍼지고, 결과가
    시드 위치에 민감해 같은 타입 세대끼리 최대 98% 까지 어긋났다.
    반면 벡터 폐합면은 **경계가 닫혀 있으면 오차가 사실상 0** 이다:
      · 욕실2  3.39㎡ — 84A 17세대 편차 0.0%
      · 발코니-1 2.30㎡ — 84A 17세대 편차 0.0%
      · 욕실1  3.56㎡ — 편차 1.3%
      · 침실2  9.79㎡ — 편차 1.6%

폐합에 필요한 세 가지 (하나라도 빠지면 실이 전부 한 덩어리가 된다)
    1) **토막 이어붙이기** — 벽선이 400~500mm 조각이다(중앙값 CONC 370/ASMB 522).
    2) **코너 연장** — 벽선 끝이 직교벽에 닿지 않아 고리가 열린다. 양단을 늘려
       겉보기 교차를 만든다. 연장 없이는 최대 폴리곤이 0.83㎡ 였다.
    3) **문틀 선 포함** — 문틀은 벽 두께(약 150mm) 짧이라 최소길이 200mm 필터에
       걸려 버려졌다. 문틀이 개구부를 막아주므로 최소길이를 60mm 로 낮춘다.

닫히지 않은 곳(문 없는 개방형 LDK, 워크인 드레스룸)은 이어진 채로 나오며
`merged_labels` 에 어떤 실들이 한 면에 들어갔는지 그대로 담는다.
**임의로 쪼개거나 근사 면적을 만들지 않는다.**
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from ..config import loader as config
from . import wall_mask

log = logging.getLogger(__name__)

Segment = tuple[tuple[float, float], tuple[float, float]]

#: 기본값 — 전부 인자로 덮어쓸 수 있다 (하드코딩 금지)
DEFAULT_MIN_LEN_MM = 60.0      # 문틀(벽두께 ~150mm)이 살아남아야 한다
DEFAULT_MERGE_GAP_MM = 30.0    # 끝점 벌어짐만 잇는다. 문 폭까지 올리지 않는다
DEFAULT_EXTEND_MM = 250.0      # 코너 겉보기 교차용 연장
MIN_FACE_M2 = 0.5
MAX_FACE_M2 = 200.0


@dataclass
class VectorRoom:
    """폐합면 하나 + 그 면에 들어간 실명들."""

    labels: list[str] = field(default_factory=list)
    """이 면에 들어간 실명. 2개 이상이면 벽 없이 이어진 공간이다."""
    categories: list[str] = field(default_factory=list)
    polygon: Optional[Polygon] = None
    area_m2: float = 0.0

    @property
    def name(self) -> str:
        return "+".join(self.labels) if self.labels else "(미지정)"

    @property
    def is_merged(self) -> bool:
        return len(self.labels) > 1

    @property
    def badge(self) -> str:
        """
        신뢰도 배지.

        벡터 폐합으로 잡혔으면 `정확`, 여러 실이 한 면이면 `개방부 분할`.
        근사값을 만들지 않으므로 `근사` 는 이 경로에서 나오지 않는다.
        """
        if self.polygon is None:
            return "실패"
        return "개방부 분할" if self.is_merged else "정확"


def build_boundary(segments: Sequence[Segment], *,
                   min_len_mm: float = DEFAULT_MIN_LEN_MM,
                   merge_gap_mm: float = DEFAULT_MERGE_GAP_MM,
                   extend_mm: float = DEFAULT_EXTEND_MM,
                   extra: Sequence[Segment] = ()) -> list[Segment]:
    """
    실 경계선을 만든다 — 축정렬 정규화 → 토막 이어붙이기 → 코너 연장.

    Args:
        segments: 벽·창호·난간·문틀 선분 (mm).
        min_len_mm: 이보다 짧은 선분은 버린다. 문틀이 살아야 하므로 낮게 둔다.
        merge_gap_mm: 같은 좌표선에서 이 이내로 떨어진 조각을 잇는다.
        extend_mm: 선분 양단을 이만큼 늘려 코너에서 교차시킨다.
        extra: 문 스윙 호 현 등 추가 폐합선 (연장하지 않는다).

    Returns:
        폐합 후보 선분 목록.
    """
    v: list[tuple[float, float, float]] = []
    h: list[tuple[float, float, float]] = []
    diag: list[Segment] = []

    for (x1, y1), (x2, y2) in segments:
        dx, dy = abs(x1 - x2), abs(y1 - y2)
        if dx <= 1.0 and dy >= min_len_mm:
            v.append(((x1 + x2) / 2.0, min(y1, y2), max(y1, y2)))
        elif dy <= 1.0 and dx >= min_len_mm:
            h.append(((y1 + y2) / 2.0, min(x1, x2), max(x1, x2)))
        elif max(dx, dy) >= min_len_mm:
            diag.append(((x1, y1), (x2, y2)))    # 사선벽 — 그대로 유지

    v = wall_mask.merge_collinear(v, gap_tol_mm=merge_gap_mm)
    h = wall_mask.merge_collinear(h, gap_tol_mm=merge_gap_mm)

    out: list[Segment] = []
    out += [((c, a - extend_mm), (c, b + extend_mm)) for c, a, b in v]
    out += [((a - extend_mm, c), (b + extend_mm, c)) for c, a, b in h]
    out += diag
    out += list(extra)
    return out


def trace(segments: Sequence[Segment],
          seeds: Sequence[tuple[str, str, tuple[float, float]]], *,
          min_len_mm: float = DEFAULT_MIN_LEN_MM,
          merge_gap_mm: float = DEFAULT_MERGE_GAP_MM,
          extend_mm: float = DEFAULT_EXTEND_MM,
          extra: Sequence[Segment] = (),
          min_face_m2: float = MIN_FACE_M2,
          max_face_m2: float = MAX_FACE_M2) -> tuple[list[VectorRoom], list[str]]:
    """
    폐합면을 만들고 실명 시드를 담는 면을 찾는다.

    같은 면에 여러 실명이 들어가면 하나의 `VectorRoom` 으로 묶어 **면적을 한 번만**
    계상한다. 같은 바닥을 실명 수만큼 중복 계상하는 것이 최악의 오류다.

    Args:
        segments: 벽·창호·난간·문틀 선분.
        seeds: [(실명, 카테고리, (x, y)), ...] — EXCLUDE 는 넣지 말 것.
        min_face_m2, max_face_m2: 실로 인정할 면적 범위. 벽 공동·기호 셀을 걸러낸다.

    Returns:
        (실 목록, 어떤 면에도 못 들어간 실명들)
    """
    lines = build_boundary(segments, min_len_mm=min_len_mm,
                           merge_gap_mm=merge_gap_mm, extend_mm=extend_mm,
                           extra=extra)
    if not lines:
        return [], [s[0] for s in seeds]

    merged = unary_union([LineString(s) for s in lines])
    faces = [f for f in polygonize(merged)
             if min_face_m2 * 1e6 <= f.area <= max_face_m2 * 1e6]
    if not faces:
        return [], [s[0] for s in seeds]

    tree = STRtree(faces)
    #: 면 인덱스 → 그 면에 들어간 시드들
    hits: dict[int, list[int]] = {}
    missed: list[str] = []

    for si, (name, _cat, (x, y)) in enumerate(seeds):
        p = Point(x, y)
        best_i, best_area = None, float("inf")
        for fi in tree.query(p):
            f = faces[int(fi)]
            if f.contains(p) and f.area < best_area:
                best_i, best_area = int(fi), f.area
        if best_i is None:
            missed.append(name)
            continue
        hits.setdefault(best_i, []).append(si)

    rooms: list[VectorRoom] = []
    for fi, sidx in hits.items():
        rooms.append(VectorRoom(
            labels=[seeds[i][0] for i in sidx],
            categories=[seeds[i][1] for i in sidx],
            polygon=faces[fi],
            area_m2=round(faces[fi].area / 1e6, 3),
        ))
    rooms.sort(key=lambda r: -r.area_m2)

    log.info("[벡터] 폐합면 %d개 · 실 %d개 · 미배정 %d개",
             len(faces), len(rooms), len(missed))
    return rooms, missed
