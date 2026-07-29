# -*- coding: utf-8 -*-
"""
DXF 로드 · 단위 정규화.

단위 결정 우선순위
  1) `$INSUNITS` 헤더 (명시돼 있으면 그대로 신뢰)
  2) 바운딩박스 크기 기반 추정 → **사용자 확인 필요**(unit_source="bbox_guess")

실측 메모: 주동 전체 평면 1장이 496,000 × 354,000 mm 였다.
"폭 100~100,000 이면 mm" 같은 좁은 규칙은 실무 도면에서 깨진다.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import ezdxf
from ezdxf import bbox
from ezdxf.document import Drawing

from ..constants import (
    INSUNITS_TO_MM,
    UNIT_GUESS_M_RANGE,
    UNIT_GUESS_MM_RANGE,
)
from ..models import DrawingInfo

log = logging.getLogger(__name__)

#: XREF 블록 플래그 비트 (ezdxf BlockLayout flags)
_XREF_FLAG = 4


class DxfLoadError(RuntimeError):
    """DXF 를 열 수 없거나 해석 불가할 때."""


def load(path: str, *, unit_override: Optional[str] = None) -> tuple[Drawing, DrawingInfo]:
    """
    DXF 파일을 열고 메타 정보를 함께 반환한다.

    Args:
        path: DXF 경로.
        unit_override: 사용자가 단위를 직접 지정한 경우 ("mm" | "m" | "in" | "ft").

    Returns:
        (ezdxf Drawing, DrawingInfo)

    Raises:
        DxfLoadError: 파일 손상·미지원 형식.
    """
    t0 = time.perf_counter()
    try:
        doc = ezdxf.readfile(path)
    except (IOError, ezdxf.DXFStructureError) as e:  # pragma: no cover - I/O
        raise DxfLoadError(f"DXF 로드 실패: {e}") from e

    msp = doc.modelspace()
    entities = list(msp)
    entity_count = len(entities)

    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    scale, source = _resolve_unit_scale(doc, insunits, unit_override)

    # 바운딩박스 (mm 환산)
    try:
        ext = bbox.extents(msp, fast=True)
        bbox_mm = (
            ext.extmin.x * scale, ext.extmin.y * scale,
            ext.extmax.x * scale, ext.extmax.y * scale,
        )
    except Exception:  # 빈 도면 등
        bbox_mm = (0.0, 0.0, 0.0, 0.0)

    info = DrawingInfo(
        path=path,
        insunits=insunits,
        unit_scale_to_mm=scale,
        unit_source=source,
        entity_count=entity_count,
        layer_count=len(doc.layers),
        bbox_mm=bbox_mm,
        has_unresolved_xref=_has_unresolved_xref(doc),
        max_insert_depth=_max_insert_depth(doc, entities),
        mirrored_insert_count=_count_mirrored_inserts(entities),
    )

    log.info(
        "[load] %s · 엔티티 %d · 레이어 %d · 단위 %s(×%g, %s) · %.2fs",
        path, entity_count, info.layer_count, _unit_label(insunits), scale, source,
        time.perf_counter() - t0,
    )
    if info.is_large:
        log.warning("[load] 대용량 도면(%d 엔티티) — 백그라운드 처리 필요", entity_count)
    if info.unit_source == "bbox_guess":
        log.warning("[load] $INSUNITS 미지정 — 크기로 단위를 추정했다. 사용자 확인 필요")
    if info.has_unresolved_xref:
        log.warning("[load] 미해결 XREF 존재 — 해당 도형은 제외된다")

    return doc, info


def _resolve_unit_scale(
    doc: Drawing, insunits: int, override: Optional[str]
) -> tuple[float, str]:
    """단위 환산 계수와 결정 근거를 반환한다."""
    if override:
        table = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4, "ft": 304.8}
        if override not in table:
            raise ValueError(f"지원하지 않는 단위: {override}")
        return table[override], "user"

    if insunits in INSUNITS_TO_MM and insunits != 0:
        return INSUNITS_TO_MM[insunits], "header"

    # $INSUNITS 미지정 — 바운딩박스 크기로 추정
    try:
        ext = bbox.extents(doc.modelspace(), fast=True)
        span = max(ext.size.x, ext.size.y)
    except Exception:
        return 1.0, "bbox_guess"

    lo_mm, hi_mm = UNIT_GUESS_MM_RANGE
    lo_m, hi_m = UNIT_GUESS_M_RANGE
    if lo_mm <= span <= hi_mm:
        return 1.0, "bbox_guess"
    if lo_m <= span <= hi_m:
        return 1000.0, "bbox_guess"
    # 판단 불가 — mm 로 두되 근거를 남긴다(사용자 확인 필수)
    log.warning("[load] 단위 추정 실패(바운딩박스 %g) — mm 로 가정", span)
    return 1.0, "bbox_guess"


def _unit_label(insunits: int) -> str:
    return {0: "미지정", 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}.get(insunits, str(insunits))


def _has_unresolved_xref(doc: Drawing) -> bool:
    """미해결 외부참조(XREF) 블록이 있는지."""
    for blk in doc.blocks:
        block_record = getattr(blk, "block", None)
        if block_record is None:
            continue
        flags = int(block_record.dxf.get("flags", 0) or 0)
        if flags & _XREF_FLAG:
            return True
    return False


def _max_insert_depth(doc: Drawing, entities: list) -> int:
    """INSERT 중첩 최대 깊이. 순환참조는 감지 후 중단한다."""

    def depth(name: str, seen: frozenset[str], d: int) -> int:
        if name in seen or d > 32:  # 순환참조 방어
            return d
        try:
            blk = doc.blocks[name]
        except Exception:
            return d
        best = d
        nxt = seen | {name}
        for e in blk:
            if e.dxftype() == "INSERT":
                best = max(best, depth(e.dxf.name, nxt, d + 1))
        return best

    best = 0
    for e in entities:
        if e.dxftype() == "INSERT":
            best = max(best, depth(e.dxf.name, frozenset(), 1))
    return best


def _count_mirrored_inserts(entities: list) -> int:
    """미러(음수 스케일) INSERT 개수 — 변환행렬 버그의 단골 원인."""
    n = 0
    for e in entities:
        if e.dxftype() != "INSERT":
            continue
        if float(e.dxf.xscale) < 0 or float(e.dxf.yscale) < 0 or float(e.dxf.zscale) < 0:
            n += 1
    return n
