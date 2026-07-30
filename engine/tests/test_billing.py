# -*- coding: utf-8 -*-
"""기성 관리 단위 테스트 (9~15단계)."""
from __future__ import annotations

from datetime import date

import pytest

from finish_takeoff.billing import parser as P
from finish_takeoff.billing.progress import (
    BillingPeriod,
    Progress,
    ProgressStore,
    UnitQuantity,
    compute_billing,
    lock_period,
    unlock_period,
)
from finish_takeoff.billing.validator import Severity, validate
from finish_takeoff.registry.units import UnitInstance, UnitRegistry


def make_registry() -> UnitRegistry:
    """101동 1~15F, 01=84A / 02=84B → 30세대."""
    return UnitRegistry.from_rule(["101"], 1, 15, {"01": "84A", "02": "84B"})


def make_quantities() -> dict[str, UnitQuantity]:
    return {
        "84A": UnitQuantity("84A", by_work={"WALLPAPER": 100.0, "SHEET_FLOOR": 60.0},
                            contract_by_work={"WALLPAPER": 100.0, "SHEET_FLOOR": 60.0}),
        "84B": UnitQuantity("84B", by_work={"WALLPAPER": 90.0, "SHEET_FLOOR": 55.0},
                            contract_by_work={"WALLPAPER": 90.0, "SHEET_FLOOR": 55.0}),
    }


# ═══════════════════════════════════════════════════════
# 세대 대장
# ═══════════════════════════════════════════════════════


class TestRegistry:
    def test_rule_generation(self):
        reg = make_registry()
        assert len(reg) == 30
        assert reg.type_counts() == {"84A": 15, "84B": 15}

    def test_exclude_piloti_floor(self):
        """필로티층(1F) 제외."""
        reg = UnitRegistry.from_rule(["101"], 1, 15, {"01": "84A"}, exclude_floors=[1])
        assert len(reg) == 14
        assert 1 not in reg.floors_of("101")

    def test_exclude_missing_unit_no(self):
        """결번 호수 제외 (4층 없는 동)."""
        reg = UnitRegistry.from_rule(["101"], 1, 5, {"01": "84A"}, exclude_units=["401"])
        assert len(reg) == 4

    def test_paste_parsing(self):
        text = "동\t층\t호\t타입\n101\t15\t1501\t84A\n101\t15\t1502\t84B"
        reg, errs = UnitRegistry.from_paste(text)
        assert len(reg) == 2 and not errs
        assert reg.by_key("101-1501").unit_type == "84A"

    def test_paste_reports_errors(self):
        """오류 행을 조용히 버리지 않는다."""
        reg, errs = UnitRegistry.from_paste("101\t15\t1501\t84A\n101\tXX\t1502")
        assert len(reg) == 1 and len(errs) == 1

    def test_duplicate_rejected(self):
        reg = UnitRegistry()
        u = UnitInstance("101", 15, "1501", "01", "84A")
        assert reg.add(u) and not reg.add(u)


# ═══════════════════════════════════════════════════════
# 범위 파서
# ═══════════════════════════════════════════════════════


class TestRangeParser:
    def test_basic_all(self):
        r = P.parse("101동 1~15F 전체", make_registry())
        assert r.ok and r.count == 30

    def test_single_floor_units(self):
        r = P.parse("101동 16F 01,02호", make_registry())
        assert r.ok and r.count == 0  # 16F 는 대장에 없다

    def test_multi_building(self):
        reg = UnitRegistry.from_rule(["101", "102"], 1, 5, {"01": "84A"})
        r = P.parse("101,102동 1~5F 전체", reg)
        assert r.count == 10

    def test_building_range(self):
        reg = UnitRegistry.from_rule(["101", "102", "103"], 1, 2, {"01": "84A"})
        r = P.parse("101~103동 전층 01라인", reg)
        assert r.count == 6

    def test_exclude_floor(self):
        r = P.parse("101동 1~15F 전체 -12F", make_registry())
        assert r.count == 28  # 12층 2세대 제외

    def test_ratio(self):
        r = P.parse("101동 1~10F 전체 @50%", make_registry())
        assert r.count == 20
        assert all(abs(ratio - 0.5) < 1e-9 for _, ratio in r.matched)

    def test_type_filter(self):
        r = P.parse("101동 전층 84A타입", make_registry())
        assert r.count == 15

    def test_line_filter(self):
        r = P.parse("101동 전층 01라인", make_registry())
        assert r.count == 15

    def test_later_line_overrides(self):
        r = P.parse("101동 1~5F 전체 @30%\n101동 1~5F 전체 @70%", make_registry())
        assert all(abs(x - 0.7) < 1e-9 for _, x in r.matched)

    @pytest.mark.parametrize("bad", [
        "1~15F 전체",            # 동 없음
        "101동 15~1F 전체",      # 층 거꾸로
        "101동 1~15F 전체 @150%",  # 진도율 초과
        "101동 1~15F 알수없는토큰",
        "101동 ??? 전체",
        "동 전층",
        "101동 1~15F 전체 @-10%",
        "101 1~15F 전체",        # '동' 누락
        "101동 F 전체",
        "@50%",
    ])
    def test_invalid_inputs_report_error(self, bad):
        r = P.parse(bad, make_registry())
        assert not r.ok, f"오류를 잡아야 한다: {bad}"
        assert r.errors[0].line_no >= 1

    def test_error_points_to_token(self):
        r = P.parse("101동 1~15F 이상한거", make_registry())
        assert r.errors[0].token == "이상한거"

    def test_unknown_building_warns_not_silent(self):
        """대장에 없는 동은 조용히 무시하지 않는다."""
        r = P.parse("999동 전층 전체", make_registry())
        assert r.missing


# ═══════════════════════════════════════════════════════
# 진도 · 기성 산출
# ═══════════════════════════════════════════════════════


class TestBilling:
    def _setup(self):
        reg = make_registry()
        q = make_quantities()
        store = ProgressStore()
        return reg, q, store

    def test_three_periods_sum_equals_cumulative(self):
        """1차+2차+3차 금회 합 = 3차 누계 — 기성의 기본 항등식."""
        reg, q, store = self._setup()
        periods = []
        ratios = [0.3, 0.6, 1.0]
        prev = None
        totals = []
        for i, ratio in enumerate(ratios, 1):
            per = BillingPeriod(i, f"{i}차", date(2026, i, 28))
            store.set_many(
                Progress(i, u.key, "WALLPAPER", ratio) for u in reg
            )
            res = compute_billing(period=per, registry=reg, store=store,
                                  quantities=q, prev_period=prev)
            totals.append(res.by_work()["WALLPAPER"]["금회"])
            lock_period(per, q)
            periods.append(per)
            prev = per
        final = compute_billing(period=periods[-1], registry=reg, store=store,
                                quantities=q, prev_period=periods[-2])
        assert abs(sum(totals) - final.by_work()["WALLPAPER"]["누계"]) < 1e-6

    def test_current_is_cum_minus_prev(self):
        reg, q, store = self._setup()
        p1 = BillingPeriod(1, "1차", date(2026, 1, 31))
        store.set_many(Progress(1, u.key, "WALLPAPER", 0.4) for u in reg)
        compute_billing(period=p1, registry=reg, store=store, quantities=q)
        lock_period(p1, q)

        p2 = BillingPeriod(2, "2차", date(2026, 2, 28))
        store.set_many(Progress(2, u.key, "WALLPAPER", 0.7) for u in reg)
        res = compute_billing(period=p2, registry=reg, store=store,
                              quantities=q, prev_period=p1)
        d = res.by_work()["WALLPAPER"]
        assert abs(d["금회"] - (d["누계"] - (0.4 * (100 * 15 + 90 * 15)))) < 1e-6

    def test_carried_ratio_when_no_input(self):
        """이번 차수에 입력 없는 세대는 진도가 0이 아니라 전회 그대로다."""
        reg, q, store = self._setup()
        store.set(Progress(1, "101-101", "WALLPAPER", 0.5))
        assert store.get_carried(2, "101-101", "WALLPAPER") == 0.5

    def test_locked_snapshot_survives_rev_change(self):
        """확정 후 도면 REV 로 물량이 바뀌어도 과거 차수는 불변."""
        reg, q, store = self._setup()
        p1 = BillingPeriod(1, "1차", date(2026, 1, 31))
        store.set_many(Progress(1, u.key, "WALLPAPER", 1.0) for u in reg)
        lock_period(p1, q)
        snap_before = p1.snapshot["84A|WALLPAPER"]

        q["84A"].by_work["WALLPAPER"] = 200.0          # REV 변경
        q["84A"].contract_by_work["WALLPAPER"] = 200.0
        assert p1.snapshot["84A|WALLPAPER"] == snap_before == 100.0

    def test_unlock_records_history(self):
        p = BillingPeriod(1, "1차", date(2026, 1, 31))
        lock_period(p, make_quantities())
        unlock_period(p, "물량 정정", actor="김진욱")
        assert not p.is_locked and len(p.unlock_history) == 1
        assert "물량 정정" in p.unlock_history[0]


# ═══════════════════════════════════════════════════════
# 검증
# ═══════════════════════════════════════════════════════


class TestValidator:
    def _run(self, cur_ratio: float, prev_ratio: float = 0.5):
        reg = UnitRegistry.from_rule(["101"], 1, 2, {"01": "84A"})
        q = make_quantities()
        store = ProgressStore()
        p1 = BillingPeriod(1, "1차", date(2026, 1, 31))
        store.set_many(Progress(1, u.key, "WALLPAPER", prev_ratio) for u in reg)
        lock_period(p1, q)
        p2 = BillingPeriod(2, "2차", date(2026, 2, 28))
        store.set_many(Progress(2, u.key, "WALLPAPER", cur_ratio) for u in reg)
        res = compute_billing(period=p2, registry=reg, store=store,
                              quantities=q, prev_period=p1)
        return validate(period=p2, result=res, registry=reg, store=store,
                        quantities=q, prev_period=p1)

    def test_regression_blocks_lock(self):
        rep = self._run(cur_ratio=0.3, prev_ratio=0.5)
        assert not rep.can_lock
        assert any(i.code == "regression" for i in rep.errors)

    def test_over_100_blocks_lock(self):
        rep = self._run(cur_ratio=1.2)
        assert not rep.can_lock
        assert any(i.code == "over_100" for i in rep.errors)

    def test_normal_passes(self):
        rep = self._run(cur_ratio=0.8)
        assert rep.can_lock

    def test_locked_period_edit_blocked(self):
        reg = UnitRegistry.from_rule(["101"], 1, 1, {"01": "84A"})
        q = make_quantities()
        store = ProgressStore()
        p = BillingPeriod(1, "1차", date(2026, 1, 31))
        lock_period(p, q)
        res = compute_billing(period=p, registry=reg, store=store, quantities=q)
        rep = validate(period=p, result=res, registry=reg, store=store, quantities=q)
        assert any(i.code == "locked" for i in rep.errors)

    def test_floor_gap_is_info_not_error(self):
        """중간 층 건너뜀은 실제로 가능한 상황 — 차단하지 않는다."""
        reg = UnitRegistry.from_rule(["101"], 1, 3, {"01": "84A"})
        q = make_quantities()
        store = ProgressStore()
        p = BillingPeriod(1, "1차", date(2026, 1, 31))
        store.set(Progress(1, "101-101", "WALLPAPER", 1.0))
        store.set(Progress(1, "101-301", "WALLPAPER", 1.0))  # 2층 건너뜀
        res = compute_billing(period=p, registry=reg, store=store, quantities=q)
        rep = validate(period=p, result=res, registry=reg, store=store, quantities=q)
        assert any(i.code == "floor_gap" for i in rep.infos)
        assert rep.can_lock

    def test_unknown_unit_warns(self):
        reg = UnitRegistry.from_rule(["101"], 1, 1, {"01": "84A"})
        q = make_quantities()
        store = ProgressStore()
        p = BillingPeriod(1, "1차", date(2026, 1, 31))
        store.set(Progress(1, "999-9999", "WALLPAPER", 1.0))
        res = compute_billing(period=p, registry=reg, store=store, quantities=q)
        rep = validate(period=p, result=res, registry=reg, store=store, quantities=q)
        assert any(i.code == "unknown_unit" for i in rep.warnings)
        assert rep.can_lock  # 경고는 차단하지 않는다


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
