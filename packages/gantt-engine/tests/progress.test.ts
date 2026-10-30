// 작업일보 → 출발 상태, 최상층 규칙
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  KR_HOLIDAYS_2026_Q4,
  SCENARIO_2026_10,
  parseWorkText,
  progressFromReports,
  simulate,
  type DailyReport,
} from "../src/index.ts"

const report = (date: string, text: string): DailyReport => {
  const { entries, unmatched } = parseWorkText(text)
  return { id: date, siteId: "s", date, status: "pending", rawText: text, entries, unmatched }
}

const R1028 = report(
  "2026-10-28",
  `* 골조(97)
- 401동: 38F 바닥 먹매김 / 38F 갱폼인양
- 402동: 38F 1-2호 단열재 설치
- 403동: 38F 바닥 타설
- 404동: 37F 벽체 철근배근
- 405동: 37F 바닥 알폼설치
* 전기(23)
- 403동 38F 바닥 배관작업 / 404동 37F 벽체 배관작업`,
)
const R1027 = report(
  "2026-10-27",
  `* 골조(96)
- 401동: 37F 바닥 타설
- 402동: 38F 바닥 알폼설치
- 403동: 38F 바닥 철근배근
- 404동: 37F 갱폼인양
- 405동: 37F 벽체 철근배근`,
)

describe("progressFromReports", () => {
  const p = progressFromReports([R1028, R1027], "2026-10-29")
  const state = (id: number) => p.initial.find((b) => b.id === id)!

  it("동 번호순, asOf 는 마지막 실적일", () => {
    assert.deepEqual(
      p.buildings.map((b) => b.label),
      ["401동", "402동", "403동", "404동", "405동"],
    )
    assert.equal(p.asOf, "2026-10-28")
  })
  it("먹매김+갱폼인양 → 다음 벽철근, 층 38", () => {
    assert.equal(state(401).stage, "WALL_REBAR")
    assert.equal(state(401).floor, 38)
    assert.equal(state(401).lastPourDate, "2026-10-27")
  })
  it("타설로 끝 → 먹매김, 층 +1", () => {
    assert.equal(state(403).stage, "MARK")
    assert.equal(state(403).floor, 39)
  })
  it("벽철근 + 벽체 배관 → 기전까지 끝 → 알폼", () => {
    assert.equal(state(404).stage, "ALFORM")
  })
  it("402동: 단열재(최상층) 끝 → 슬래브철근", () => {
    assert.equal(state(402).stage, "SLAB_REBAR")
    assert.equal(state(402).floor, 38)
  })
})

describe("최상층 규칙", () => {
  it("최상층 38F 로 주면 403동은 38F 타설로 끝(done), 다른 동은 38F 사이클에 단열재가 낀다", () => {
    const top = new Map([
      [401, 38],
      [402, 38],
      [403, 38],
      [404, 38],
      [405, 38],
    ])
    const p = progressFromReports([R1028, R1027], "2026-10-29", top)
    assert.equal(p.initial.find((b) => b.id === 403)!.done, true)
    const sim = simulate({
      settings: SCENARIO_2026_10.halfDayOnNoPMOnlyStart,
      calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
      from: "2026-10-29",
      to: "2026-11-30",
      initial: p.initial,
    })
    assert.ok(!sim.assignments.some((a) => a.buildingId === 403), "끝난 동은 배정이 없다")
    const b401 = sim.assignments.filter((a) => a.buildingId === 401)
    assert.ok(b401.some((a) => a.stage === "TOP_INSULATION"), "최상층 사이클에 단열재")
    const insul = b401.findIndex((a) => a.stage === "TOP_INSULATION")
    const slab = b401.findIndex((a) => a.stage === "SLAB_REBAR")
    assert.ok(insul < slab, "단열재는 슬래브철근 앞")
    assert.equal(b401.filter((a) => a.stage === "POUR").length, 1, "38F 타설 한 번으로 끝")
  })
  it("최상층을 모르면 끝없이 올라간다 (기존 동작)", () => {
    const p = progressFromReports([R1028, R1027], "2026-10-29")
    const sim = simulate({
      settings: SCENARIO_2026_10.halfDayOnNoPMOnlyStart,
      calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
      from: "2026-10-29",
      to: "2026-11-30",
      initial: p.initial,
    })
    assert.ok(sim.assignments.filter((a) => a.buildingId === 403 && a.stage === "POUR").length >= 3)
    assert.ok(!sim.assignments.some((a) => a.stage === "TOP_INSULATION"))
  })
})
