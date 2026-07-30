# -*- coding: utf-8 -*-
"""
마감재별 물량 산출 규칙.

**모든 수치는 설정값이다. 코드에 박지 않는다.**
아래 기본값은 참고치이며 회사 적산 기준으로 반드시 덮어써야 한다.

공통 원칙
  · 결과는 **원면적**과 **할증 적용 면적**을 항상 함께 보유한다.
  · 타일 장수처럼 정수 단위는 **마지막에 올림**한다(중간 반올림 금지).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from shapely.geometry import Polygon


class FinishKind(str, Enum):
    """산출 대상 마감재."""

    SHEET_FLOOR = "sheet_floor"    # 장판/마루
    FLOOR_TILE = "floor_tile"      # 바닥 타일
    WALLPAPER = "wallpaper"        # 벽 도배
    CEILING_PAPER = "ceiling"      # 천장 도배
    BASEBOARD = "baseboard"        # 걸레받이


@dataclass
class OpeningSpec:
    """실에 접한 개구부 1개 — 도배/걸레받이 공제에 쓴다."""

    width_mm: float
    height_mm: float
    kind: str = "door"  # "door" | "window"

    @property
    def area_m2(self) -> float:
        return self.width_mm * self.height_mm / 1_000_000.0


@dataclass
class TakeoffSettings:
    """
    적산 기준 설정 — **회사 기준으로 덮어쓸 것**.

    JSON 으로 저장/로드해 코드 수정 없이 바꾼다.
    """

    ceiling_height_mm: float = 2300.0
    """천장고 기본값. 실별 개별 지정이 우선한다."""

    # 할증률 (0.05 = 5%)
    waste_sheet_floor: float = 0.05
    waste_floor_tile: float = 0.05
    waste_wallpaper: float = 0.10
    waste_ceiling: float = 0.10
    waste_baseboard: float = 0.05

    # 타일 규격
    tile_w_mm: float = 600.0
    tile_h_mm: float = 600.0

    # 개구부 공제 기준
    deduct_door_full: bool = True
    """문은 전체 공제."""
    window_deduct_over_m2: float = 0.5
    """창은 면적이 이 값을 넘는 부분만 공제."""

    # 단위 환산
    pyeong_per_m2: float = 3.3058
    wallpaper_roll_m2: float = 16.5
    """도배 1롤 시공면적(실크 기준)."""

    def waste_of(self, kind: FinishKind) -> float:
        return {
            FinishKind.SHEET_FLOOR: self.waste_sheet_floor,
            FinishKind.FLOOR_TILE: self.waste_floor_tile,
            FinishKind.WALLPAPER: self.waste_wallpaper,
            FinishKind.CEILING_PAPER: self.waste_ceiling,
            FinishKind.BASEBOARD: self.waste_baseboard,
        }[kind]


@dataclass
class QuantityLine:
    """마감재 1종의 산출 결과."""

    kind: FinishKind
    raw: float
    """원 수량 (면적 ㎡ 또는 길이 m)."""
    with_waste: float
    """할증 적용 수량."""
    unit: str
    """"㎡" | "m" | "장" | "롤" """
    count: Optional[int] = None
    """정수 단위 수량 (타일 장수 등). 마지막에 올림한다."""
    note: str = ""

    @property
    def waste_rate(self) -> float:
        return (self.with_waste / self.raw - 1.0) if self.raw else 0.0


@dataclass
class RoomTakeoff:
    """실 1개의 전체 물량."""

    room_name: str
    area_m2: float
    perimeter_m: float
    ceiling_height_mm: float
    lines: list[QuantityLine] = field(default_factory=list)
    is_approximate: bool = False
    """근사(래스터) 추적이면 True — 보고서에 반드시 표기한다."""

    def get(self, kind: FinishKind) -> Optional[QuantityLine]:
        return next((l for l in self.lines if l.kind is kind), None)

    @property
    def pyeong(self) -> float:
        return self.area_m2 / 3.3058


def _deduction_m2(openings: list[OpeningSpec], st: TakeoffSettings) -> float:
    """벽 도배에서 뺄 개구부 면적."""
    total = 0.0
    for o in openings:
        if o.kind == "door":
            if st.deduct_door_full:
                total += o.area_m2
        else:  # window
            over = o.area_m2 - st.window_deduct_over_m2
            if over > 0:
                total += over
    return total


def compute(
    *,
    room_name: str,
    polygon: Polygon,
    openings: Optional[list[OpeningSpec]] = None,
    settings: Optional[TakeoffSettings] = None,
    ceiling_height_mm: Optional[float] = None,
    kinds: Optional[list[FinishKind]] = None,
    is_approximate: bool = False,
) -> RoomTakeoff:
    """
    실 1개의 마감 물량을 산출한다.

    Args:
        room_name: 실명.
        polygon: 실 폴리곤 (mm 좌표).
        openings: 실에 접한 개구부 목록 (도배 공제용).
        settings: 적산 기준. None 이면 기본값(참고치).
        ceiling_height_mm: 실별 천장고. None 이면 설정 기본값.
        kinds: 산출할 마감재. None 이면 전체.
        is_approximate: 래스터 근사 추적 여부.

    Returns:
        RoomTakeoff
    """
    st = settings or TakeoffSettings()
    ops = openings or []
    h_mm = ceiling_height_mm or st.ceiling_height_mm
    kinds = kinds or list(FinishKind)

    area_m2 = polygon.area / 1_000_000.0
    perim_m = polygon.exterior.length / 1000.0

    out = RoomTakeoff(room_name, area_m2, perim_m, h_mm, is_approximate=is_approximate)

    for k in kinds:
        w = st.waste_of(k)

        if k is FinishKind.SHEET_FLOOR:
            out.lines.append(QuantityLine(k, area_m2, area_m2 * (1 + w), "㎡"))

        elif k is FinishKind.FLOOR_TILE:
            tile_m2 = st.tile_w_mm * st.tile_h_mm / 1_000_000.0
            need = area_m2 * (1 + w)
            # 장수는 마지막에 올림한다 (중간 반올림 금지)
            cnt = math.ceil(need / tile_m2) if tile_m2 > 0 else 0
            out.lines.append(QuantityLine(
                k, area_m2, need, "장", count=cnt,
                note=f"{st.tile_w_mm:.0f}×{st.tile_h_mm:.0f}mm"))

        elif k is FinishKind.WALLPAPER:
            gross = perim_m * (h_mm / 1000.0)
            ded = _deduction_m2(ops, st)
            raw = max(0.0, gross - ded)
            out.lines.append(QuantityLine(
                k, raw, raw * (1 + w), "㎡",
                note=f"둘레 {perim_m:.2f}m × 천장고 {h_mm:.0f}mm − 개구부 {ded:.2f}㎡"))

        elif k is FinishKind.CEILING_PAPER:
            out.lines.append(QuantityLine(k, area_m2, area_m2 * (1 + w), "㎡"))

        elif k is FinishKind.BASEBOARD:
            door_w = sum(o.width_mm for o in ops if o.kind == "door") / 1000.0
            raw = max(0.0, perim_m - door_w)
            out.lines.append(QuantityLine(
                k, raw, raw * (1 + w), "m",
                note=f"둘레 {perim_m:.2f}m − 문 {door_w:.2f}m"))

    return out


def summarize(rooms: list[RoomTakeoff]) -> dict[FinishKind, QuantityLine]:
    """여러 실을 마감재별로 합산한다."""
    agg: dict[FinishKind, QuantityLine] = {}
    for r in rooms:
        for l in r.lines:
            cur = agg.get(l.kind)
            if cur is None:
                agg[l.kind] = QuantityLine(l.kind, l.raw, l.with_waste, l.unit,
                                           count=l.count)
            else:
                cur.raw += l.raw
                cur.with_waste += l.with_waste
                if l.count is not None:
                    cur.count = (cur.count or 0) + l.count
    return agg
