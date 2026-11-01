// 택트 인원 ↔ 마감 예정 규칙 연동 (2026-10-31)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_TAKT_INPUT, computeTakt, finishSettingsWithTakt, linkedBatchDays, taktLinks, taktWithFlows } from "../src/index.ts"

describe("택트 ↔ 마감 규칙", () => {
  const links = taktLinks(DEFAULT_TAKT_INPUT)
  it("공종 14개가 이름으로 짝지어진다", () => {
    assert.equal(links.size, 14)
  })
  it("인원 산정: 묶음당 작업일 = 올림(묶음 층수 × 층당 인·일 ÷ 인원)", () => {
    // 내장단열: 층당 70 × 4 ÷ 25 = 11.2 인·일, 자동 6명 → 5개 층 = 56 ÷ 6 = 9.33 → 10일
    const ins = links.get("insulation")!
    assert.deepEqual([ins.crew, ins.autoCrew, ins.manual], [6, 6, false])
    assert.equal(linkedBatchDays(ins, 5), 10)
    // 인원을 8명으로 정하면 56 ÷ 8 = 7일
    const more = taktLinks({ ...DEFAULT_TAKT_INPUT, trades: DEFAULT_TAKT_INPUT.trades.map((t) => (t.name === "내장단열" ? { ...t, crew: 8 } : t)) })
    assert.deepEqual([more.get("insulation")!.crew, more.get("insulation")!.manual, linkedBatchDays(more.get("insulation")!, 5)], [8, true, 7])
  })
  it("고정 일수(기포방통 2일/5개 층): 묶음 층수 비율로, 인원은 표시만", () => {
    const sc = links.get("screed")!
    assert.deepEqual([sc.fixed, sc.crew, linkedBatchDays(sc, 5), linkedBatchDays(sc, 3)], [true, 4, 2, 2])
  })
  it("규칙에 입히기: 짝이 있는 공종은 작업일 계산·팀 1, 다른 값(간격·층씩·선행)은 그대로", () => {
    const s = finishSettingsWithTakt({ insulation: { pred: "windowFrame", gapDays: 4, floorsPerBatch: 5, daysPerBatch: 99, teams: 3 } }, links)
    assert.deepEqual([s.insulation.daysPerBatch, s.insulation.teams, s.insulation.gapDays, s.insulation.pred], [10, 1, 4, "windowFrame"])
  })
  it("택트에서 이름을 바꾼 공종·입력 오류면 짝이 없다 (규칙 입력값을 그대로 쓴다)", () => {
    const renamed = taktLinks({ ...DEFAULT_TAKT_INPUT, trades: DEFAULT_TAKT_INPUT.trades.map((t) => (t.name === "내장단열" ? { ...t, name: "단열재" } : t)) })
    assert.equal(renamed.has("insulation"), false)
    assert.equal(taktLinks({ ...DEFAULT_TAKT_INPUT, taktDays: 0 }).size, 0)
  })
  it("인원은 동의 코어에 나뉘어 동시에: 동시 묶음 = 코어 수 (최대 5)", () => {
    assert.equal(finishSettingsWithTakt(undefined, links, 2).insulation.teams, 2)
    assert.equal(finishSettingsWithTakt(undefined, links).insulation.teams, 1)
    assert.equal(finishSettingsWithTakt(undefined, links, 8).insulation.teams, 5)
  })
})

describe("겹쳐 이동 → 택트 구간 일수 (2026-11-01)", () => {
  const finish = { windowFrame: { pred: null, frameLead: 5, gapDays: 2, floorsPerBatch: 5, daysPerBatch: 5, moveDays: 1 } }
  it("코어 겹쳐 이동: 4코어 · 5개층 5일 · 간격 1일 → PL창틀 구간 8일, 고정 일수로 계산", () => {
    const { input, flows } = taktWithFlows(DEFAULT_TAKT_INPUT, finish, 4)
    const i = DEFAULT_TAKT_INPUT.trades.findIndex((t) => t.name === "PL창틀")
    assert.equal(flows.get(i)?.zoneDays, 8)
    assert.equal(input.trades[i].mode, "fixed")
    assert.equal(computeTakt(input).trades[i].zoneDays, 8)
  })
  it("동 겹쳐 이동은 구간 안에서 한 곳 → 5일", () => {
    const { flows } = taktWithFlows(DEFAULT_TAKT_INPUT, { windowFrame: { ...finish.windowFrame, moveBy: "building" as const } }, 4)
    assert.equal([...flows.values()][0].zoneDays, 5)
  })
  it("겹쳐 이동이 없으면 입력 그대로", () => {
    const r = taktWithFlows(DEFAULT_TAKT_INPUT, undefined, 4)
    assert.equal(r.flows.size, 0)
    assert.equal(r.input, DEFAULT_TAKT_INPUT)
  })
})
