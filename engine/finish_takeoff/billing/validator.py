# -*- coding: utf-8 -*-
"""
기성 검증 — **오류는 확정을 차단하고, 경고는 확인 후 진행**한다.

| 상황 | 등급 | 처리 |
|---|---|---|
| 금회 누계 < 전회 누계 (진도 역행) | 오류 | 확정 차단 |
| 금회 누계 > 100% | 오류 | 확정 차단 |
| 누계 > 계약물량 | 경고 | 설계변경 확인 유도 |
| 산출 데이터 없는 타입 | 경고 | 도면 산출 필요 안내 |
| 대장에 없는 세대 지정 | 경고 | 스킵 목록 표시 |
| 중간 층 건너뜀 | 알림 | **차단하지 않음** (실제로 가능한 상황) |
| 확정 차수 수정 시도 | 오류 | 차단 |
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Optional

from ..registry.units import UnitRegistry
from .progress import (
    BillingPeriod,
    BillingResult,
    ProgressStore,
    UnitQuantity,
    WorkType,
    DEFAULT_WORK_TYPES,
)


class Severity(str, Enum):
    ERROR = "error"      # 확정 차단
    WARNING = "warning"  # 확인 후 진행
    INFO = "info"        # 알림만


@dataclass
class Issue:
    severity: Severity
    code: str
    message: str
    unit_key: str = ""
    work_code: str = ""

    def __str__(self) -> str:  # pragma: no cover
        tag = {"error": "오류", "warning": "경고", "info": "알림"}[self.severity.value]
        loc = f" [{self.unit_key}{'/' + self.work_code if self.work_code else ''}]" if self.unit_key else ""
        return f"{tag}{loc}: {self.message}"


@dataclass
class ValidationReport:
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity is Severity.ERROR]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity is Severity.WARNING]

    @property
    def infos(self) -> list[Issue]:
        return [i for i in self.issues if i.severity is Severity.INFO]

    @property
    def can_lock(self) -> bool:
        """오류가 하나라도 있으면 차수를 확정할 수 없다."""
        return not self.errors

    def summary(self) -> str:
        return (f"오류 {len(self.errors)} · 경고 {len(self.warnings)} · 알림 {len(self.infos)}"
                + ("  → 확정 가능" if self.can_lock else "  → 확정 차단"))


def validate(
    *,
    period: BillingPeriod,
    result: BillingResult,
    registry: UnitRegistry,
    store: ProgressStore,
    quantities: dict[str, UnitQuantity],
    works: Iterable[WorkType] = DEFAULT_WORK_TYPES,
    prev_period: Optional[BillingPeriod] = None,
) -> ValidationReport:
    """기성 확정 전 전수 검증."""
    rep = ValidationReport()

    if period.is_locked:
        rep.issues.append(Issue(
            Severity.ERROR, "locked",
            f"{period.seq}차는 이미 확정되었습니다. 수정하려면 확정을 해제하세요."))

    prev_seq = prev_period.seq if prev_period else -1

    # ── 세대 × 공종 검사 ──
    for line in result.lines:
        key = line.unit.key
        # 1) 진도 역행
        if line.cum_ratio < line.prev_ratio - 1e-9:
            rep.issues.append(Issue(
                Severity.ERROR, "regression",
                f"진도 역행 — 금회 누계 {line.cum_ratio:.0%} < 전회 누계 {line.prev_ratio:.0%}",
                key, line.work.code))
        # 2) 100% 초과
        if line.cum_ratio > 1.0 + 1e-9:
            rep.issues.append(Issue(
                Severity.ERROR, "over_100",
                f"누계 진도율 {line.cum_ratio:.0%} — 100%를 초과했습니다",
                key, line.work.code))
        # 3) 계약물량 초과
        base = line.contract_qty
        if base > 0 and line.cum_qty > base * (1 + 1e-9):
            over = (line.cum_qty / base - 1) * 100
            rep.issues.append(Issue(
                Severity.WARNING, "over_contract",
                f"누계 물량이 계약물량을 {over:.1f}% 초과 — 설계변경 여부를 확인하세요",
                key, line.work.code))
        # 4) 산출 데이터 없는 타입
        if line.unit_qty <= 0:
            rep.issues.append(Issue(
                Severity.WARNING, "no_quantity",
                f"'{line.unit.unit_type}' 타입의 {line.work.name} 단위물량이 없습니다 — 도면 산출이 필요합니다",
                key, line.work.code))

    # ── 5) 대장에 없는 진도 데이터 ──
    keys = {u.key for u in registry}
    for p in store.period_items(period.seq):
        if p.unit_key not in keys:
            rep.issues.append(Issue(
                Severity.WARNING, "unknown_unit",
                f"대장에 없는 세대 — 스킵됨", p.unit_key, p.work_code))

    # ── 6) 중간 층 건너뜀 (알림만) ──
    done: dict[tuple[str, str], set[int]] = defaultdict(set)
    for line in result.lines:
        if line.cum_ratio >= 1.0 - 1e-9:
            done[(line.unit.building, line.work.code)].add(line.unit.floor)
    for (bld, work), floors in done.items():
        if len(floors) < 2:
            continue
        lo, hi = min(floors), max(floors)
        gaps = sorted(set(range(lo, hi + 1)) - floors)
        # 대장에 실제로 존재하는 층만 '건너뜀'으로 본다
        real = {u.floor for u in registry if u.building == bld}
        gaps = [g for g in gaps if g in real]
        if gaps:
            rep.issues.append(Issue(
                Severity.INFO, "floor_gap",
                f"{bld}동 {work}: 중간 층 미완료 {gaps} (실제로 가능한 상황 — 차단하지 않음)"))

    return rep
