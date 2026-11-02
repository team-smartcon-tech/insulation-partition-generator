// 출발 상태 보정 — 첫날 오전·오후 고정 (2026-11-02)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, pinFirstDay, simulate } from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const pin = (am: string, pm: string, floor = 38) =>
  pinFirstDay({ calendar, from: "2026-11-02", buildingId: 402, floor, topFloor: 42, am: am as never, pm: pm as never, lastPourDate: "2026-10-30" })
const cells = (p: ReturnType<typeof pin>) => p.fixed.map((a) => `${a.date.slice(5)}${a.half} ${a.stage}`)

describe("첫날 오전·오후 고정", () => {
  it("오전 W철근 · 오후 W기전 → 다음 날 알폼부터", () => {
    const p = pin("WALL_REBAR", "WALL_MEP")
    assert.deepEqual(cells(p), ["11-02AM WALL_REBAR", "11-02PM WALL_MEP"])
    assert.equal(p.state.stage, "ALFORM")
    assert.equal(p.state.readyDate, "2026-11-03")
  })
  it("오후 알폼 투입은 다음 날 오전까지", () => {
    const p = pin("WALL_MEP", "ALFORM")
    assert.deepEqual(cells(p), ["11-02AM WALL_MEP", "11-02PM ALFORM", "11-03AM ALFORM"])
    assert.equal(p.state.stage, "SLAB_REBAR")
    assert.equal(p.state.readySlot, 3) // 11/3 오후
  })
  it("오전 타설 → 다음 날 한 층 위 먹매김, 마지막 타설일 = 그날", () => {
    const p = pin("POUR", "POUR")
    assert.deepEqual(cells(p), ["11-02AM POUR"])
    assert.equal(p.state.stage, "MARK")
    assert.equal(p.state.floor, 39)
    assert.equal(p.state.lastPourDate, "2026-11-02")
  })
  it("슬래브 기전으로 끝나면 타설은 다음 날부터", () => {
    const p = pin("SLAB_REBAR", "SLAB_MEP")
    assert.equal(p.state.stage, "POUR")
    assert.equal(p.state.readyDate, "2026-11-03")
  })
  it("엔진이 고정한 칸 다음부터 이어 간다", () => {
    const p = pin("WALL_REBAR", "WALL_MEP")
    const r = simulate({
      settings: { ...DEFAULT_SITE_SETTINGS, buildingCount: 1 },
      calendar,
      from: "2026-11-02",
      to: "2026-11-20",
      initial: [{ id: 402, pours: 0, topFloor: 42, ...p.state }],
    })
    const first = r.assignments.find((a) => a.buildingId === 402)!
    assert.equal(first.stage, "ALFORM")
    assert.ok(first.date >= "2026-11-03")
  })
})

describe("오전만 고정", () => {
  it("오후를 안 정하면 오전만, 오후부터 다음 공종", () => {
    const p = pinFirstDay({ calendar, from: "2026-11-02", buildingId: 401, floor: 38, topFloor: 42, am: "SLAB_REBAR", lastPourDate: null })
    assert.deepEqual(p.fixed.map((a) => `${a.half} ${a.stage}`), ["AM SLAB_REBAR"])
    assert.equal(p.state.stage, "SLAB_MEP")
    assert.equal(p.state.readySlot, 1)
  })
  it("오전 알폼은 하루(오전·오후) 고정", () => {
    const p = pinFirstDay({ calendar, from: "2026-11-02", buildingId: 401, floor: 38, topFloor: 42, am: "ALFORM", lastPourDate: null })
    assert.deepEqual(p.fixed.map((a) => `${a.half} ${a.stage}`), ["AM ALFORM", "PM ALFORM"])
    assert.equal(p.state.stage, "SLAB_REBAR")
  })
})
