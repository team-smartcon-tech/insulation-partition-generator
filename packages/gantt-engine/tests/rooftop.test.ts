// 최상층 바닥단열재 2일, 옥탑 층당 15일 순서표 (2026-10-30 사용자 기준).
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_SITE_SETTINGS,
  KR_HOLIDAYS_2026_Q4,
  ROOFTOP_SEQUENCE,
  getDayInfo,
  periodStats,
  simulate,
  type BuildingState,
} from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }

/** 최상층 사이클 첫 단계(먹매김)에서 출발하는 동 하나 */
const atTopFloor = (rooftopFloors: number): BuildingState => ({
  id: 401,
  stage: "MARK",
  readySlot: 0,
  readyDate: "2026-11-02",
  prevEndSlot: -1,
  lastPourDate: null,
  pours: 0,
  floor: 42,
  topFloor: 42,
  done: false,
  rooftopFloors,
})

const run = (rooftopFloors: number, to = "2027-01-31") =>
  simulate({
    settings: { ...DEFAULT_SITE_SETTINGS, buildingCount: 1 },
    calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
    from: "2026-11-02",
    to,
    initial: [atTopFloor(rooftopFloors)],
  })

describe("최상층 바닥단열재", () => {
  it("알폼 뒤·슬래브철근 앞에 반일 4칸(2일)", () => {
    const r = run(0)
    const stages = r.assignments.map((a) => a.stage)
    const ins = r.assignments.filter((a) => a.stage === "TOP_INSULATION")
    assert.equal(ins.length, 4)
    assert.ok(stages.lastIndexOf("ALFORM") < stages.indexOf("TOP_INSULATION"))
    assert.ok(stages.lastIndexOf("TOP_INSULATION") < stages.indexOf("SLAB_REBAR"))
  })
  it("옥탑이 없으면 최상층 타설로 끝", () => {
    const r = run(0)
    assert.equal(r.assignments.filter((a) => a.roof != null).length, 0)
    assert.equal(r.buildings[0].done, true)
  })
})

describe("옥탑 순서표", () => {
  it("합계 15일", () => {
    assert.equal(ROOFTOP_SEQUENCE.reduce((n, s) => n + s.days, 0), 15)
  })

  it("층마다 작업일 15일, 순서대로, 최상층 타설 다음 날부터", () => {
    const r = run(2)
    const topPour = r.assignments.find((a) => a.stage === "POUR" && a.roof == null && a.floor === 42)
    assert.ok(topPour)
    for (const roof of [1, 2]) {
      const mine = r.assignments.filter((a) => a.roof === roof)
      const days = [...new Set(mine.map((a) => a.date))]
      assert.equal(days.length, 15, `PH${roof} 은 15일`)
      assert.ok(mine.every((a) => a.floor === 42 + roof))
      // 단계 순서: 날짜별 단계가 순서표 그대로
      const perDay = days.map((d) => mine.find((a) => a.date === d)!.stage)
      const expected = ROOFTOP_SEQUENCE.flatMap((s) => Array(s.days).fill(s.stage))
      assert.deepEqual(perDay, expected)
    }
    const first = r.assignments.find((a) => a.roof === 1)!
    assert.ok(first.date > topPour.date)
    const ph1Last = r.assignments.filter((a) => a.roof === 1).at(-1)!.date
    const ph2First = r.assignments.find((a) => a.roof === 2)!.date
    assert.ok(ph2First > ph1Last, "PH2 는 PH1 양생 뒤")
  })

  it("일요일 휴무, 갱폼은 크레인 운행일, 타설은 타설 가능일", () => {
    const r = run(2)
    for (const a of r.assignments.filter((x) => x.roof != null)) {
      const day = getDayInfo(calendar, a.date)
      assert.ok(day.workable, `${a.date} 작업일`)
      if (a.stage === "GANGFORM") assert.ok(day.craneAllowed, `${a.date} 갱폼`)
      if (a.stage === "POUR") assert.ok(day.pourAllowed, `${a.date} 타설`)
    }
  })

  it("옥탑 갱폼·철근 날은 갱폼·철근 유휴가 아니다", () => {
    const r = run(1)
    const days = (stage: string) => [...new Set(r.assignments.filter((a) => a.roof === 1 && a.stage === stage).map((a) => a.date))]
    for (const d of days("GANGFORM")) assert.equal(periodStats(r, calendar, d, d).idle.gangform.fullDays, 0, `${d} 갱폼`)
    for (const d of [...days("WALL_REBAR"), ...days("SLAB_REBAR")]) assert.equal(periodStats(r, calendar, d, d).idle.rebar.fullDays, 0, `${d} 철근`)
  })

  it("옥탑 거푸집 날은 알폼 유휴가 아니다 (알폼팀 몫)", () => {
    const r = run(1)
    const formDays = [...new Set(r.assignments.filter((a) => a.roof === 1 && a.stage === "ALFORM").map((a) => a.date))]
    assert.equal(formDays.length, 6)
    for (const d of formDays) {
      const s = periodStats(r, calendar, d, d)
      assert.equal(s.idle.alform.fullDays, 0, `${d} 알폼 유휴 아님`)
    }
  })

  it("옥탑은 기준층 타설·팀 유휴 집계에 들어가지 않는다", () => {
    const r = run(1)
    const s = periodStats(r, calendar, "2026-11-02", "2027-01-31")
    const basePours = r.assignments.filter((a) => a.stage === "POUR" && a.roof == null).length
    assert.equal(s.pours, basePours)
  })

  it("출발 상태에서 이미 최상층이 끝난 동도 마지막 타설일에서 이어 붙인다", () => {
    const done: BuildingState = { ...atTopFloor(1), done: true, lastPourDate: "2026-10-30", stage: "MARK" }
    const r = simulate({
      settings: { ...DEFAULT_SITE_SETTINGS, buildingCount: 1 },
      calendar,
      from: "2026-11-05",
      to: "2026-12-31",
      initial: [done],
    })
    const mine = r.assignments.filter((a) => a.roof === 1)
    // 10/31(토)부터 시작해 기간 시작(11/5) 전 날짜는 잘려 나간다 → 15일보다 적다
    assert.ok(mine.length > 0)
    assert.ok(mine.every((a) => a.date >= "2026-11-05"))
    assert.ok(new Set(mine.map((a) => a.date)).size < 15)
  })
})
