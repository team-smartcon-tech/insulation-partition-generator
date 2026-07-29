# -*- coding: utf-8 -*-
"""
레이어 분석 · 역할 자동 판별 · 프리셋.

핵심 교훈 (실측 도면 기준)
  · **개수로 벽체를 판별하면 틀린다.** 문 레이어(24,116선)와 단열재 해칭
    레이어(20,357선)가 실제 벽체 레이어(3,748선)보다 훨씬 많았다.
  · 가르는 지표는 **선분 길이 중앙값**이다.
      벽선   : 350~522mm
      해칭선 : 14~47mm
  · XREF 를 바인드한 도면은 레이어명이 `XREF_주동 평면도$0$AA-WAXM-CONC`
    처럼 오염된다. 프리셋 매칭 전에 접두어를 제거해야 한다.
"""
from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from statistics import median
from typing import Iterable, Optional

from ezdxf.document import Drawing

from ..constants import (
    ROOM_LABEL_MIN_HITS,
    WALL_LINE_MEDIAN_MIN_MM,
    XREF_LAYER_PREFIX_SEP,
)
from ..models import LayerPreset, LayerRole, LayerStat

log = logging.getLogger(__name__)

LINE_TYPES = frozenset({"LINE", "LWPOLYLINE", "POLYLINE"})
TEXT_TYPES = frozenset({"TEXT", "MTEXT"})

#: 실명 판정 사전 — 이 단어가 텍스트에 있어야 '실명 레이어'로 본다.
#: 수량 표기 레이어(예: "000_50T 갯수" 의 1,2,3...)를 실명으로 오인하는 것을 막는다.
ROOM_NAME_WORDS = (
    "거실", "침실", "안방", "주방", "식당", "욕실", "화장실", "현관", "드레스",
    "팬트리", "발코니", "다용도", "알파", "서재", "복도", "전실", "창고", "실",
)

#: 벽체 후보 가점 키워드 (레이어명)
_WALL_HINTS = ("WALL", "WAXM", "WAL", "벽", "CONC", "ASMB", "구조")
#: 감점 키워드 — 치수·문자·해치·가구는 실 경계가 아니다
_NOISE_HINTS = ("DIM", "치수", "TEXT", "MTEXT", "HATCH", "해치", "PATT", "PAT1",
                "FUR", "가구", "MKXH", "DEFPOINT", "-INS")


def normalize_layer_name(name: str) -> str:
    """
    XREF 바인드 접두어를 제거한다.

    >>> normalize_layer_name("XREF_주동 평면도$0$AA-WAXM-CONC")
    'AA-WAXM-CONC'
    >>> normalize_layer_name("AA-MKXS")
    'AA-MKXS'
    """
    if XREF_LAYER_PREFIX_SEP not in name:
        return name
    return name.rsplit(XREF_LAYER_PREFIX_SEP, 1)[-1]


def _segment_lengths(entity, scale: float) -> list[float]:
    """엔티티의 선분 길이 목록 (mm). 길이 계산용 근사이며 정밀 이산화는 entities.py 담당."""
    t = entity.dxftype()
    try:
        if t == "LINE":
            s, e = entity.dxf.start, entity.dxf.end
            return [math.dist((s.x, s.y), (e.x, e.y)) * scale]
        if t == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in entity.get_points()]
        elif t == "POLYLINE":
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
        else:
            return []
        if getattr(entity, "closed", False) and len(pts) > 2:
            pts = pts + [pts[0]]
        return [math.dist(pts[i], pts[i + 1]) * scale for i in range(len(pts) - 1)]
    except Exception:  # 깨진 엔티티는 통계에서 제외
        return []


def analyze(doc: Drawing, scale: float) -> list[LayerStat]:
    """
    모델스페이스를 훑어 레이어별 통계를 만든다.

    Args:
        doc: ezdxf Drawing.
        scale: 도면 좌표 → mm 환산 계수.

    Returns:
        엔티티 수 내림차순 LayerStat 목록.
    """
    counts: dict[str, Counter] = defaultdict(Counter)
    lengths: dict[str, list[float]] = defaultdict(list)
    room_word_hits: dict[str, int] = defaultdict(int)

    for e in doc.modelspace():
        lay = e.dxf.layer
        t = e.dxftype()
        counts[lay][t] += 1
        if t in LINE_TYPES:
            lengths[lay].extend(_segment_lengths(e, scale))
        elif t in TEXT_TYPES:
            try:
                txt = (e.dxf.text if t == "TEXT" else e.text) or ""
            except Exception:
                txt = ""
            if any(w in txt for w in ROOM_NAME_WORDS):
                room_word_hits[lay] += 1

    stats: list[LayerStat] = []
    for lay, c in counts.items():
        ls = lengths.get(lay, [])
        stats.append(
            LayerStat(
                name=lay,
                normalized=normalize_layer_name(lay),
                entity_counts=dict(c),
                line_count=sum(v for k, v in c.items() if k in LINE_TYPES),
                median_line_length_mm=float(median(ls)) if ls else 0.0,
                max_line_length_mm=max(ls) if ls else 0.0,
                room_word_hits=room_word_hits.get(lay, 0),
            )
        )
    stats.sort(key=lambda s: -s.total)
    log.info("[layers] 레이어 %d개 분석 완료", len(stats))
    return stats


def wall_candidates(stats: Iterable[LayerStat], top: int = 3) -> list[tuple[LayerStat, float, str]]:
    """
    벽체 후보 레이어를 점수순으로 반환한다.

    점수 = 선분 개수 × 선비중 × 길이가점 × 키워드가중
    **선분 길이 중앙값이 임계값 미만이면 후보에서 제외한다**(해칭·문선 배제).

    Returns:
        [(stat, score, 판단근거), ...]
    """
    out: list[tuple[LayerStat, float, str]] = []
    for s in stats:
        if s.line_count == 0:
            continue
        reasons: list[str] = []
        if s.median_line_length_mm < WALL_LINE_MEDIAN_MIN_MM:
            continue  # 해칭/패턴/문선 — 벽체 아님
        reasons.append(f"중앙길이 {s.median_line_length_mm:.0f}mm")

        score = s.line_count * s.line_ratio
        up = s.normalized.upper()
        if any(k in up for k in _WALL_HINTS):
            score *= 3.0
            reasons.append("벽체 키워드")
        if any(k in up for k in _NOISE_HINTS):
            score *= 0.1
            reasons.append("노이즈 키워드 감점")
        reasons.append(f"선비중 {s.line_ratio*100:.0f}%")
        out.append((s, score, " · ".join(reasons)))

    out.sort(key=lambda x: -x[1])
    return out[:top]


def suggest_preset(stats: list[LayerStat], name: str = "자동 감지") -> LayerPreset:
    """
    분석 결과로 레이어 프리셋 초안을 만든다.
    **자동 결과는 초안일 뿐이며 사용자 확인 후 저장한다.**
    """
    preset = LayerPreset(name=name, roles={r: [] for r in LayerRole})

    for stat, _score, _why in wall_candidates(stats, top=3):
        preset.roles[LayerRole.WALL].append(stat.normalized)

    for s in stats:
        up = s.normalized.upper()
        if "DOOR" in up or "DWXM-DOOR" in up:
            preset.roles[LayerRole.DOOR].append(s.normalized)
        elif "WIND" in up:
            preset.roles[LayerRole.WINDOW].append(s.normalized)
        elif "FINL" in up or "FINISH" in up or "마감" in s.normalized:
            preset.roles[LayerRole.WALL_FINISH].append(s.normalized)
        elif s.room_word_hits >= ROOM_LABEL_MIN_HITS:
            # 실명 사전에 걸린 텍스트가 일정 수 이상인 레이어만 채택.
            # 개수만 보면 "000_50T 갯수"(1,2,3…) 같은 수량 레이어가 잡힌다.
            preset.roles[LayerRole.ROOM_LABEL].append(s.normalized)

    # 정규화 후 같은 이름이 겹칠 수 있다(XREF 접두어 유무) — 순서 유지 중복 제거
    for role in list(preset.roles):
        preset.roles[role] = list(dict.fromkeys(preset.roles[role]))
        if not preset.roles[role]:
            del preset.roles[role]
    return preset


def find_role_layers(
    stats: list[LayerStat], preset: LayerPreset, role: LayerRole
) -> list[str]:
    """프리셋에 매칭되는 **원본 레이어명** 목록 (XREF 접두어 포함)."""
    return [s.name for s in stats if preset.match(s.normalized) is role]


def unmatched_layers(stats: list[LayerStat], preset: LayerPreset) -> list[LayerStat]:
    """프리셋에 걸리지 않은 레이어 — UI 에서 사용자가 직접 지정하게 노출한다."""
    return [s for s in stats if preset.match(s.normalized) is None]
