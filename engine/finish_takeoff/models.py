# -*- coding: utf-8 -*-
"""
공용 데이터 모델.

원칙
  · 좌표는 mm 기준 float (내부 계산은 mm 통일).
  · 물량은 **원면적**과 **할증 적용 면적**을 항상 함께 보유한다.
  · 기성 진도는 **누계(cumulative)** 로만 저장한다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Literal, Optional


# ═══════════════════════════════════════════════════════════
# DXF / 레이어
# ═══════════════════════════════════════════════════════════


class LayerRole(str, Enum):
    """레이어 용도 분류 — 프리셋으로 지정하며 코드에 하드코딩하지 않는다."""

    WALL = "wall"                # 벽체 (실 경계)
    WALL_FINISH = "wall_finish"  # 벽체 마감선 (안목치수 기준선 후보)
    DOOR = "door"                # 문 개구부
    WINDOW = "window"            # 창 개구부
    ROOM_LABEL = "room_label"    # 실명 텍스트
    IGNORE = "ignore"            # 산출에서 제외 (치수·해치·가구 등)


@dataclass(frozen=True)
class LayerStat:
    """레이어 1개의 통계 — 레이어 분석 리포트/자동 판별의 입력."""

    name: str
    """원본 레이어명 (XREF 접두어 포함)."""
    normalized: str
    """XREF 바인드 접두어를 제거한 이름 (프리셋 매칭용)."""
    entity_counts: dict[str, int]
    """엔티티 타입별 개수."""
    line_count: int
    """LINE/LWPOLYLINE/POLYLINE 개수."""
    median_line_length_mm: float
    """선분 길이 중앙값 — 벽선(수백mm)과 해칭선(수십mm)을 가르는 핵심 지표."""
    max_line_length_mm: float
    room_word_hits: int = 0
    """실명 사전(거실/침실/욕실…)에 걸린 텍스트 개수 — 실명 레이어 판별용."""

    @property
    def total(self) -> int:
        return sum(self.entity_counts.values())

    @property
    def line_ratio(self) -> float:
        return self.line_count / self.total if self.total else 0.0


@dataclass
class LayerPreset:
    """
    회사/도면 표준별 레이어 매핑.

    하드코딩 금지 원칙에 따라 이 객체는 JSON 으로 저장/로드한다.
    """

    name: str
    roles: dict[LayerRole, list[str]] = field(default_factory=dict)
    """역할 → 레이어명 패턴 목록 (normalized 이름 기준, 대소문자 무시 부분일치)."""

    def match(self, normalized_layer: str) -> Optional[LayerRole]:
        """정규화된 레이어명이 어느 역할에 해당하는지 반환 (없으면 None)."""
        up = normalized_layer.upper()
        for role, patterns in self.roles.items():
            for p in patterns:
                if p.upper() in up:
                    return role
        return None


@dataclass(frozen=True)
class DrawingInfo:
    """로드한 도면의 메타 정보."""

    path: str
    insunits: int
    unit_scale_to_mm: float
    """도면 좌표 → mm 환산 계수."""
    unit_source: Literal["header", "bbox_guess", "user"]
    """단위를 무엇으로 결정했는지 — 추정이면 사용자 확인이 필요하다."""
    entity_count: int
    layer_count: int
    bbox_mm: tuple[float, float, float, float]
    """(min_x, min_y, max_x, max_y) mm."""
    has_unresolved_xref: bool
    max_insert_depth: int
    mirrored_insert_count: int

    @property
    def is_large(self) -> bool:
        from .constants import LARGE_DRAWING_ENTITY_COUNT

        return self.entity_count >= LARGE_DRAWING_ENTITY_COUNT


# ═══════════════════════════════════════════════════════════
# 실(室) · 물량
# ═══════════════════════════════════════════════════════════


class TraceMethod(str, Enum):
    VECTOR = "vector"        # 1차 — shapely polygonize
    RASTER = "raster"        # 2차 — 래스터 flood fill (근사)
    MANUAL = "manual"        # 사용자가 직접 그림


@dataclass
class RoomWarning:
    """실 추적 경고 — UI 배지로 표시하며 조용히 삼키지 않는다."""

    code: Literal[
        "approximate", "virtual_closure", "area_out_of_range",
        "few_vertices", "shape_ratio", "overlap",
    ]
    message: str


@dataclass
class Room:
    """추적된 실 1개."""

    id: str
    polygon_mm: list[tuple[float, float]]
    """외곽 정점 (mm). 시계/반시계 무관."""
    holes_mm: list[list[tuple[float, float]]] = field(default_factory=list)
    """내부 중공(도넛형) — 면적에서 공제한다."""
    name: str = ""
    """실명 (자동 추출 또는 사용자 입력)."""
    unit_type: str = ""
    """소속 세대 타입 (예: 84A)."""
    click_point_mm: Optional[tuple[float, float]] = None
    """재추적용 클릭점 — 도면 REV 변경 시 이 좌표로 다시 추적한다."""
    method: TraceMethod = TraceMethod.VECTOR
    ceiling_height_mm: Optional[float] = None
    """실별 천장고. None 이면 전역 기본값 사용."""
    warnings: list[RoomWarning] = field(default_factory=list)

    @property
    def is_approximate(self) -> bool:
        """근사 추적 여부 — 정확 추적과 시각적으로 반드시 구분해야 한다."""
        return self.method is TraceMethod.RASTER
