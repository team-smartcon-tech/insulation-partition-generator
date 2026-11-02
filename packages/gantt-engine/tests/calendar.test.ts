// 달력 규칙 (설계 §4). Node 내장 러너: `pnpm --filter @ipg/gantt-engine test`
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  KR_HOLIDAYS_2026_Q4,
  addDays,
  coldRangeOf,
  dateRange,
  inMonthDayRange,
  dayOfWeek,
  getDayInfo,
  previousCraneDay,
  type CalendarConfig,
} from "../src/index.ts"

const config: CalendarConfig = { holidays: [...KR_HOLIDAYS_2026_Q4] }

describe("날짜 유틸", () => {
  it("2026-10-01 은 목요일, 10-04 는 일요일", () => {
    assert.equal(dayOfWeek("2026-10-01"), 4)
    assert.equal(dayOfWeek("2026-10-04"), 0)
  })
  it("월말을 넘겨 더한다", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01")
    assert.equal(addDays("2026-11-01", -1), "2026-10-31")
  })
  it("10월은 31일", () => {
    assert.equal(dateRange("2026-10-01", "2026-10-31").length, 31)
  })
})

describe("달력 규칙 §4", () => {
  it("일요일은 전체 휴무", () => {
    const d = getDayInfo(config, "2026-10-04")
    assert.equal(d.workable, false)
    assert.equal(d.pourAllowed, false)
    assert.equal(d.craneAllowed, false)
  })
  it("토요일은 작업 가능, 타설 불가, 크레인 가능", () => {
    const d = getDayInfo(config, "2026-10-10")
    assert.equal(d.workable, true)
    assert.equal(d.pourAllowed, false)
    assert.equal(d.craneAllowed, true)
  })
  it("공휴일(10/5, 10/9)은 작업 가능하지만 크레인·타설 불가", () => {
    for (const date of ["2026-10-05", "2026-10-09"]) {
      const d = getDayInfo(config, date)
      assert.equal(d.isHoliday, true)
      assert.equal(d.workable, true)
      assert.equal(d.craneAllowed, false)
      assert.equal(d.pourAllowed, false)
    }
  })
  it("10월 타설 가능일 20일, 11월 21일", () => {
    const count = (from: string, to: string) =>
      dateRange(from, to).filter((d) => getDayInfo(config, d).pourAllowed).length
    assert.equal(count("2026-10-01", "2026-10-31"), 20)
    assert.equal(count("2026-11-01", "2026-11-30"), 21)
  })
  it("동절기 양생: 10월 0일, 11월 1일", () => {
    assert.equal(getDayInfo(config, "2026-10-30").curingDays, 0)
    assert.equal(getDayInfo(config, "2026-11-02").curingDays, 1)
  })
  it("공휴일 월요일(10/5) 철근 선인양은 10/2 금", () => {
    assert.equal(previousCraneDay(config, "2026-10-05"), "2026-10-02")
  })
})

describe("한중 기간 (날짜 단위 동절기 양생)", () => {
  const ranged: CalendarConfig = { ...config, winterCuringRange: { start: "11-24", end: "03-05" } }
  it("해를 넘기는 기간: 11/23 아님, 11/24·1/15·3/5 동절기, 3/6 아님", () => {
    assert.equal(getDayInfo(ranged, "2026-11-23").curingDays, 0)
    assert.equal(getDayInfo(ranged, "2026-11-24").curingDays, 1)
    assert.equal(getDayInfo(ranged, "2027-01-15").curingDays, 1)
    assert.equal(getDayInfo(ranged, "2027-03-05").curingDays, 1)
    assert.equal(getDayInfo(ranged, "2027-03-06").curingDays, 0)
  })
  it("해를 넘지 않는 기간", () => {
    assert.equal(inMonthDayRange({ start: "01-05", end: "02-10" }, "2027-01-04"), false)
    assert.equal(inMonthDayRange({ start: "01-05", end: "02-10" }, "2027-02-10"), true)
  })
  it("설정: 꺼져 있으면 null, 직접 고친 기간이 관측소보다 먼저", () => {
    assert.equal(coldRangeOf(undefined), null)
    assert.equal(coldRangeOf({ enabled: false, range: { start: "12-01", end: "02-01" } }), null)
    assert.deepEqual(coldRangeOf({ enabled: true, stationId: 108, range: { start: "12-01", end: "02-01" } }), { start: "12-01", end: "02-01" })
  })
})
