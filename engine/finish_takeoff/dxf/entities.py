# -*- coding: utf-8 -*-
"""
엔티티 → 선분(segment) 변환.

핵심
  · INSERT 는 **재귀 전개**하며 변환행렬(이동·회전·스케일·**미러**)을 적용한다.
    미러(음수 스케일) 누락이 가장 흔한 버그라 ezdxf 의 virtual_entities() 를 쓴다
    (직접 행렬을 곱하면 미러+회전 조합에서 부호를 놓치기 쉽다).
  · 곡선(ARC/CIRCLE/ELLIPSE/SPLINE)은 **현 길이 ≤ CURVE_CHORD_MAX_MM** 로 이산화한다.
  · 순환참조는 방문 집합으로 감지해 중단한다.

좌표는 전부 mm 로 환산해 내보낸다.
"""
from __future__ import annotations

import logging
import time
from typing import Iterable, Iterator, Optional, Sequence

from ezdxf.document import Drawing
from ezdxf.entities import DXFEntity

from ..constants import CURVE_CHORD_MAX_MM

log = logging.getLogger(__name__)

Point = tuple[float, float]
Segment = tuple[Point, Point]

#: 선분으로 변환 가능한 엔티티
SUPPORTED = frozenset({
    "LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE",
})

_MAX_INSERT_DEPTH = 32


class ExtractStats:
    """추출 통계 — 로깅/리포트용."""

    def __init__(self) -> None:
        self.entities = 0
        self.segments = 0
        self.inserts_expanded = 0
        self.skipped: dict[str, int] = {}
        self.cyclic_blocks: set[str] = set()

    def skip(self, dxftype: str) -> None:
        self.skipped[dxftype] = self.skipped.get(dxftype, 0) + 1

    def __repr__(self) -> str:  # pragma: no cover
        return (f"<ExtractStats 엔티티={self.entities} 선분={self.segments} "
                f"INSERT전개={self.inserts_expanded} 스킵={self.skipped}>")


def _pts_to_segments(pts: Sequence[Point], closed: bool, scale: float) -> list[Segment]:
    """점열 → 선분. 길이 0 선분은 버린다."""
    if len(pts) < 2:
        return []
    seq = list(pts) + ([pts[0]] if closed and len(pts) > 2 else [])
    out: list[Segment] = []
    for i in range(len(seq) - 1):
        a = (seq[i][0] * scale, seq[i][1] * scale)
        b = (seq[i + 1][0] * scale, seq[i + 1][1] * scale)
        if a != b:
            out.append((a, b))
    return out


def entity_to_segments(
    e: DXFEntity, scale: float, *, chord_mm: float = CURVE_CHORD_MAX_MM
) -> list[Segment]:
    """
    단일 엔티티를 mm 좌표 선분 목록으로 변환한다 (INSERT 제외).

    Args:
        e: DXF 엔티티.
        scale: 도면 좌표 → mm 환산 계수.
        chord_mm: 곡선 이산화 최대 현 길이 (mm).

    Returns:
        [( (x1,y1), (x2,y2) ), ...] — mm 좌표.
    """
    t = e.dxftype()
    # 곡선 이산화는 도면 단위로 해야 하므로 허용오차를 역환산한다.
    sag = max(chord_mm / max(scale, 1e-9), 1e-6)

    try:
        if t == "LINE":
            s, en = e.dxf.start, e.dxf.end
            return _pts_to_segments([(s.x, s.y), (en.x, en.y)], False, scale)

        if t == "LWPOLYLINE":
            # 벌지(bulge)가 있으면 호를 포함하므로 flattening 사용
            pts = [(p.x, p.y) for p in e.flattening(sag)]
            return _pts_to_segments(pts, bool(e.closed), scale)

        if t == "POLYLINE":
            if e.is_2d_polyline:
                pts = [(p.x, p.y) for p in e.points()]
                return _pts_to_segments(pts, bool(e.is_closed), scale)
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            return _pts_to_segments(pts, bool(e.is_closed), scale)

        if t in ("ARC", "CIRCLE", "ELLIPSE", "SPLINE"):
            pts = [(p.x, p.y) for p in e.flattening(sag)]
            closed = t == "CIRCLE" or (t == "ELLIPSE" and getattr(e, "is_closed", False))
            return _pts_to_segments(pts, closed, scale)
    except Exception as exc:  # 깨진 엔티티 1개가 전체를 멈추면 안 된다
        log.debug("엔티티 변환 실패 %s(%s): %s", t, getattr(e.dxf, "handle", "?"), exc)
        return []
    return []


def _iter_expanded(
    e: DXFEntity, depth: int, seen: frozenset[str], stats: ExtractStats
) -> Iterator[DXFEntity]:
    """INSERT 를 재귀 전개해 실제 도형 엔티티만 흘려보낸다."""
    if e.dxftype() != "INSERT":
        yield e
        return

    name = str(e.dxf.name)
    if name in seen:
        stats.cyclic_blocks.add(name)
        log.warning("[entities] 순환참조 블록 감지 — 전개 중단: %s", name)
        return
    if depth >= _MAX_INSERT_DEPTH:
        log.warning("[entities] INSERT 중첩 한계(%d) 초과 — 중단: %s", _MAX_INSERT_DEPTH, name)
        return

    stats.inserts_expanded += 1
    nxt = seen | {name}
    try:
        # virtual_entities(): 변환행렬(이동·회전·스케일·미러)이 적용된 사본을 돌려준다
        for sub in e.virtual_entities():
            yield from _iter_expanded(sub, depth + 1, nxt, stats)
    except Exception as exc:
        log.warning("[entities] INSERT 전개 실패 %s: %s", name, exc)


def extract_segments(
    doc: Drawing,
    scale: float,
    *,
    layers: Optional[Iterable[str]] = None,
    chord_mm: float = CURVE_CHORD_MAX_MM,
) -> tuple[list[Segment], ExtractStats]:
    """
    모델스페이스에서 선분을 추출한다.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 좌표 → mm 환산 계수.
        layers: 대상 레이어(원본명). None 이면 전체.
        chord_mm: 곡선 이산화 최대 현 길이.

    Returns:
        (선분 목록[mm], 통계)
    """
    t0 = time.perf_counter()
    target = set(layers) if layers is not None else None
    stats = ExtractStats()
    out: list[Segment] = []

    for e in doc.modelspace():
        # INSERT 는 자기 레이어가 아니라 내부 엔티티 레이어를 따를 수 있어
        # 레이어 필터를 전개 후에 적용한다.
        is_insert = e.dxftype() == "INSERT"
        if target is not None and not is_insert and e.dxf.layer not in target:
            continue

        for sub in _iter_expanded(e, 0, frozenset(), stats):
            if target is not None and sub.dxf.layer not in target:
                continue
            if sub.dxftype() not in SUPPORTED:
                stats.skip(sub.dxftype())
                continue
            segs = entity_to_segments(sub, scale, chord_mm=chord_mm)
            if segs:
                stats.entities += 1
                out.extend(segs)

    stats.segments = len(out)
    log.info(
        "[entities] 선분 %d개 (엔티티 %d · INSERT전개 %d · 스킵 %s) · %.2fs",
        stats.segments, stats.entities, stats.inserts_expanded,
        stats.skipped or "-", time.perf_counter() - t0,
    )
    return out, stats
