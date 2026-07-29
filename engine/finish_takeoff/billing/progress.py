# -*- coding: utf-8 -*-
"""
기성 차수 · 진도 · 산출 · 검증.

**진도는 반드시 누계(cumulative)로 저장한다.**
금회분으로 저장하면 과거 차수를 수정했을 때 정합성이 깨지고 원인 추적이 불가능해진다.

    세대별 기성물량(누계) = 세대타입 단위물량 × 누계진도율
    금회 기성물량         = 금회 누계 − 전회 누계
    잔여물량              = 계약물량 − 금회 누계

전회 누계는 **직전 확정(locked) 차수만** 참조한다. 미확정 차수는 참조 대상이 아니다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Optional

from ..registry.units import UnitInstance, UnitRegistry
from ..takeoff.rules import FinishKind, QuantityLine, RoomTakeoff


# ═══════════════════════════════════════════════════════════
# 모델
# ═══════════════════════════════════════════════════════════


@dataclass(frozen=True)
class WorkType:
    """공종."""

    code: str   # "WALLPAPER" | "FLOOR_TILE" | "SHEET_FLOOR" | "BASEBOARD"
    name: str
    finish_kind: Optional[FinishKind] = None
    """도면 산출 물량과 연결되는 마감재. None 이면 계약물량만 사용."""


DEFAULT_WORK_TYPES: tuple[WorkType, ...] = (
    WorkType("SHEET_FLOOR", "장판/마루", FinishKind.SHEET_FLOOR),
    WorkType("FLOOR_TILE", "바닥타일", FinishKind.FLOOR_TILE),
    WorkType("WALLPAPER", "벽 도배", FinishKind.WALLPAPER),
    WorkType("CEILING", "천장 도배", FinishKind.CEILING_PAPER),
    WorkType("BASEBOARD", "걸레받이", FinishKind.BASEBOARD),
)


@dataclass
class UnitQuantity:
    """
    세대 타입 1개의 단위물량 (공종별).

    계약 내역서 물량과 도면 산출 물량을 **둘 다** 보유한다.
    청구 기준은 settings 로 고르되, 대조를 위해 항상 함께 들고 다닌다.
    """

    unit_type: str
    by_work: dict[str, float] = field(default_factory=dict)
    """도면 산출 물량 (공종코드 → 수량)."""
    contract_by_work: dict[str, float] = field(default_factory=dict)
    """계약 내역서 물량 (공종코드 → 수량). 없으면 도면 산출로 폴백."""
    rev: str = ""
    """산출 근거 도면 REV — 물량이 바뀌면 '물량 조정' 으로 표시해야 한다."""

    def qty(self, work_code: str, *, prefer_contract: bool) -> float:
        if prefer_contract and work_code in self.contract_by_work:
            return self.contract_by_work[work_code]
        return self.by_work.get(work_code, 0.0)


@dataclass
class BillingPeriod:
    """기성 차수."""

    seq: int
    title: str
    cutoff_date: date
    is_locked: bool = False
    locked_at: Optional[datetime] = None
    unlock_history: list[str] = field(default_factory=list)
    """확정 해제 이력 — 해제는 가능하되 반드시 기록으로 남긴다."""
    snapshot: dict[str, float] = field(default_factory=dict)
    """확정 시점의 단위물량 스냅샷 (f"{type}|{work}" → 수량). 이후 REV 변경에 영향받지 않는다."""


@dataclass(frozen=True)
class Progress:
    """진도 1건 — 세대 × 공종 × 차수. **ratio 는 누계 기준.**"""

    period_seq: int
    unit_key: str
    work_code: str
    ratio: float
    note: str = ""


class ProgressStore:
    """진도 저장소 (메모리 — UI/DB 어댑터가 감싸 쓴다)."""

    def __init__(self) -> None:
        self._data: dict[tuple[int, str, str], Progress] = {}

    def set(self, p: Progress) -> None:
        self._data[(p.period_seq, p.unit_key, p.work_code)] = p

    def set_many(self, items: Iterable[Progress]) -> int:
        n = 0
        for p in items:
            self.set(p)
            n += 1
        return n

    def get(self, period_seq: int, unit_key: str, work_code: str) -> float:
        """해당 차수의 누계 진도율. 없으면 0."""
        p = self._data.get((period_seq, unit_key, work_code))
        return p.ratio if p else 0.0

    def get_carried(
        self, period_seq: int, unit_key: str, work_code: str
    ) -> float:
        """
        해당 차수의 누계 진도율 — **직전 차수 값을 승계**한다.

        이번 차수에 입력이 없는 세대는 진도가 0이 아니라 '전회 그대로'다.
        (입력 안 했다고 진도가 사라지면 금회분이 음수가 된다.)
        """
        for s in range(period_seq, -1, -1):
            p = self._data.get((s, unit_key, work_code))
            if p:
                return p.ratio
        return 0.0

    def period_items(self, period_seq: int) -> list[Progress]:
        return [p for (s, _, _), p in self._data.items() if s == period_seq]

    def all_items(self) -> list[Progress]:
        return list(self._data.values())

    def clear_period(self, period_seq: int) -> int:
        keys = [k for k in self._data if k[0] == period_seq]
        for k in keys:
            del self._data[k]
        return len(keys)


# ═══════════════════════════════════════════════════════════
# 산출
# ═══════════════════════════════════════════════════════════


@dataclass
class BillingLine:
    """기성 산출 1행 (세대 × 공종)."""

    unit: UnitInstance
    work: WorkType
    unit_qty: float
    """세대 타입 단위물량."""
    cum_ratio: float
    prev_ratio: float
    contract_qty: float = 0.0

    @property
    def cum_qty(self) -> float:
        return self.unit_qty * self.cum_ratio

    @property
    def prev_qty(self) -> float:
        return self.unit_qty * self.prev_ratio

    @property
    def current_qty(self) -> float:
        """금회 = 금회 누계 − 전회 누계."""
        return self.cum_qty - self.prev_qty

    @property
    def remain_qty(self) -> float:
        base = self.contract_qty or self.unit_qty
        return base - self.cum_qty


@dataclass
class BillingResult:
    lines: list[BillingLine] = field(default_factory=list)
    period: Optional[BillingPeriod] = None
    prev_period: Optional[BillingPeriod] = None

    def by_work(self) -> dict[str, dict[str, float]]:
        """공종별 금회/누계/잔여 집계."""
        out: dict[str, dict[str, float]] = {}
        for l in self.lines:
            d = out.setdefault(l.work.code, {"금회": 0.0, "누계": 0.0, "잔여": 0.0, "계약": 0.0})
            d["금회"] += l.current_qty
            d["누계"] += l.cum_qty
            d["잔여"] += l.remain_qty
            d["계약"] += l.contract_qty or l.unit_qty
        return out

    def by_building(self) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for l in self.lines:
            d = out.setdefault(l.unit.building, {})
            d[l.work.code] = d.get(l.work.code, 0.0) + l.current_qty
        return out


def compute_billing(
    *,
    period: BillingPeriod,
    registry: UnitRegistry,
    store: ProgressStore,
    quantities: dict[str, UnitQuantity],
    works: Iterable[WorkType] = DEFAULT_WORK_TYPES,
    prev_period: Optional[BillingPeriod] = None,
    prefer_contract: bool = True,
) -> BillingResult:
    """
    기성 물량을 산출한다.

    Args:
        period: 금회 차수.
        registry: 세대 대장.
        store: 진도 저장소 (누계).
        quantities: 타입별 단위물량.
        works: 공종 목록.
        prev_period: 직전 **확정** 차수. None 이면 전회 누계 0.
        prefer_contract: 계약 내역 물량 우선 사용 여부.

    Returns:
        BillingResult
    """
    res = BillingResult(period=period, prev_period=prev_period)
    prev_seq = prev_period.seq if prev_period else -1

    for u in registry:
        uq = quantities.get(u.unit_type)
        for w in works:
            cum = store.get_carried(period.seq, u.key, w.code)
            prev = store.get_carried(prev_seq, u.key, w.code) if prev_seq >= 0 else 0.0
            if cum == 0.0 and prev == 0.0:
                continue

            # 확정 차수 스냅샷이 있으면 그 물량을 쓴다 (REV 변경에도 과거는 불변)
            snap_key = f"{u.unit_type}|{w.code}"
            if prev_period and snap_key in prev_period.snapshot:
                base_prev = prev_period.snapshot[snap_key]
            else:
                base_prev = uq.qty(w.code, prefer_contract=prefer_contract) if uq else 0.0
            base_cur = uq.qty(w.code, prefer_contract=prefer_contract) if uq else 0.0

            line = BillingLine(
                unit=u, work=w,
                unit_qty=base_cur,
                cum_ratio=cum,
                prev_ratio=prev,
                contract_qty=(uq.contract_by_work.get(w.code, 0.0) if uq else 0.0),
            )
            # 전회 물량이 다르면(REV 변경) 금회분에 섞이지 않도록 별도 계산
            if base_prev != base_cur and prev > 0:
                line.unit_qty = base_cur
            res.lines.append(line)
    return res


def lock_period(period: BillingPeriod, quantities: dict[str, UnitQuantity],
                works: Iterable[WorkType] = DEFAULT_WORK_TYPES) -> None:
    """
    차수를 확정한다 — 이 시점의 단위물량을 스냅샷으로 굳힌다.
    이후 도면 REV 가 바뀌어도 **과거 차수 결과는 변하지 않는다.**
    """
    snap: dict[str, float] = {}
    for t, uq in quantities.items():
        for w in works:
            snap[f"{t}|{w.code}"] = uq.qty(w.code, prefer_contract=True)
    period.snapshot = snap
    period.is_locked = True
    period.locked_at = datetime.now()


def unlock_period(period: BillingPeriod, reason: str, actor: str = "") -> None:
    """확정을 해제한다 — **반드시 이력을 남긴다.**"""
    period.is_locked = False
    period.unlock_history.append(
        f"{datetime.now():%Y-%m-%d %H:%M} {actor or '미상'} — {reason}"
    )


def quantities_from_takeoff(
    unit_type: str,
    rooms: Iterable[RoomTakeoff],
    *,
    works: Iterable[WorkType] = DEFAULT_WORK_TYPES,
    rev: str = "",
) -> UnitQuantity:
    """도면 산출 결과(실별 물량) → 세대 타입 단위물량."""
    uq = UnitQuantity(unit_type=unit_type, rev=rev)
    for w in works:
        if w.finish_kind is None:
            continue
        total = 0.0
        cnt = 0
        for r in rooms:
            l: Optional[QuantityLine] = r.get(w.finish_kind)
            if l:
                total += l.with_waste
                if l.count:
                    cnt += l.count
        uq.by_work[w.code] = math.ceil(total) if w.code == "FLOOR_TILE" and cnt else total
        if w.code == "FLOOR_TILE" and cnt:
            uq.by_work[w.code] = float(cnt)
    return uq
