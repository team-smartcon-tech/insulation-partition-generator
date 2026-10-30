// 마감 예정 (선행·층 묶음 규칙, 2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { finishPlanOf, hasFinishPlan, planFinishBuilding, type FinishGanttBuilding } from "../src/index.ts"

const floors = (done: Record<number, string | null>) =>
  [1, 2, 3, 4].map((f) => ({ floor: f, units: 2, done: done[f] ? 2 : 0, last: done[f] ?? null }))
const row = (trade: string, f: ReturnType<typeof floors>, core: number | null = null) => ({
  trade: trade as never,
  core,
  sources: [],
  done: f.reduce((s, x) => s + x.done, 0),
  total: 8,
  perWeek: 0,
  actual: [],
  forecast: null,
  floors: f,
})

describe("마감 예정", () => {
  const b: FinishGanttBuilding = {
    buildingNo: 101,
    name: "101동",
    cores: [],
    rows: [
      row("windowFrame", floors({ 1: "2026-10-20", 2: "2026-10-22", 3: null, 4: null })), // 3·4층 남음
      row("insulation", floors({ 1: "2026-10-27", 2: null, 3: null, 4: null })),
    ],
  }
  const settings = {
    windowFrame: { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 },
    insulation: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 1, daysPerBatch: 2 },
  }
  const p = planFinishBuilding(b, settings, "2026-10-30")
  const bars = (t: string) => p.find((x) => x.trade === t)!.bars.map((x) => [x.floorFrom, x.floorTo, x.start, x.end])
  it("선행 없는 공종: 이미 시작했으면 내일부터 남은 층을 묶음으로 (일요일도 센다)", () => {
    // 10/31(토) 시작, 3일 → 11/2(월) (11/1 일요일 포함)
    assert.deepEqual(bars("windowFrame"), [[3, 4, "2026-10-31", "2026-11-02"]])
  })
  it("선행 층 완료 + 간격 뒤, 같은 공종은 앞 묶음이 끝나야 다음", () => {
    assert.deepEqual(bars("insulation"), [
      [2, 2, "2026-10-31", "2026-11-01"], // 2층: 창틀 10/22 + 3일 → 10/26 이후, 내일(10/31)부터, 2일(10/31·11/1)
      [3, 3, "2026-11-06", "2026-11-07"], // 3층: 창틀 예정 11/2 + 3일 → 11/6
      [4, 4, "2026-11-08", "2026-11-09"], // 앞 묶음 끝난 다음 날 (11/8 일요일도 시작)
    ])
  })
  it("선행 없는 공종이 그 동에서 시작 전이면 예정 없음", () => {
    const b2: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({})), row("insulation", floors({}))] }
    const p2 = planFinishBuilding(b2, settings, "2026-10-30")
    assert.deepEqual(p2.map((x) => x.bars.length), [0, 0])
  })
  it("창짝설치·유리는 규칙이 없어 예정을 내지 않는다", () => {
    const b4: FinishGanttBuilding = { ...b, rows: [...b.rows, row("windowSash", floors({ 1: "2026-10-25" })), row("glass", floors({ 1: "2026-10-27" }))] }
    const p4 = planFinishBuilding(b4, settings, "2026-10-30")
    assert.deepEqual(p4.filter((x) => x.trade === "windowSash" || x.trade === "glass").map((x) => x.bars.length), [0, 0])
  })
  it("코어마다 따로: 선행도 같은 코어의 층을 본다", () => {
    const b3: FinishGanttBuilding = {
      buildingNo: 101,
      name: "101동",
      cores: [],
      rows: [
        row("windowFrame", floors({ 1: "2026-10-20", 2: "2026-10-20", 3: "2026-10-20", 4: "2026-10-20" }), 1),
        row("insulation", floors({ 1: "2026-10-27" }), 1),
        row("windowFrame", floors({ 1: "2026-10-20", 2: null, 3: null, 4: null }), 2),
        row("insulation", floors({ 1: "2026-10-27" }), 2),
      ],
    }
    const p3 = planFinishBuilding(b3, settings, "2026-10-30")
    assert.deepEqual(p3.map((x) => [x.trade, x.core]), [["windowFrame", 1], ["insulation", 1], ["windowFrame", 2], ["insulation", 2]])
    const ins = (core: number) => p3.find((x) => x.trade === "insulation" && x.core === core)!.bars.map((x) => [x.floorFrom, x.start])
    // 1코어: 창틀 다 끝남 → 2층부터 바로. 2코어: 2층 창틀 예정(11/2) + 3일 뒤
    assert.deepEqual(ins(1)[0], [2, "2026-10-31"])
    assert.deepEqual(ins(2)[0], [2, "2026-11-06"])
  })

  it("골조 선행: 묶음 최고층 + N 층 S타설 다음 날부터, 시작 전인 동도 예정을 낸다", () => {
    const b5: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({}))] }
    const s5 = { windowFrame: { pred: null, frameLead: 5, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 } }
    // 골조: 6층 11/2, 7층 11/9, 8층 11/16 타설, 9층은 모름
    const pours: Record<number, string> = { 6: "2026-11-02", 7: "2026-11-09", 8: "2026-11-16" }
    const p5 = planFinishBuilding(b5, s5, "2026-10-30", 540, (no, fl) => (no === 101 ? pours[fl] ?? null : null))
    // 1~2층: 2 + 5 = 7층 타설(11/9) 다음 날 11/10 시작, 3일. 3~4층: 9층 타설일을 몰라 멈춤
    assert.deepEqual(p5[0].bars.map((x) => [x.floorFrom, x.floorTo, x.start, x.end]), [[1, 2, "2026-11-10", "2026-11-12"]])
  })
  it("저장된 규칙에 골조 선행이 없으면 기본값(창틀 5층), 「없음」(null) 이면 골조를 안 본다", () => {
    assert.equal(finishPlanOf({ windowFrame: { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 } }, "windowFrame").frameLead, 5)
    assert.equal(finishPlanOf({ windowFrame: { pred: null, frameLead: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 } }, "windowFrame").frameLead, null)
  })
  it("창짝설치·유리·몰딩·주방가구·일반가구는 예정 규칙이 없다 (간트·규칙 카드에서 빠진다)", () => {
    assert.deepEqual(["windowSash", "glass", "molding", "kitchen", "furniture"].map(hasFinishPlan), [false, false, false, false, false])
    assert.deepEqual(["windowFrame", "pvcAll", "baseboard", "flooring"].map(hasFinishPlan), [true, true, true, true])
  })
  it("팀 2개: 묶음 둘을 동시에, 다음 묶음은 먼저 빈 팀이", () => {
    const b6: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({}))] }
    const s6 = { windowFrame: { pred: null, frameLead: 0, teams: 2, gapDays: 0, floorsPerBatch: 1, daysPerBatch: 3 } }
    const p6 = planFinishBuilding(b6, s6, "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(p6[0].bars.map((x) => [x.floorFrom, x.start, x.end]), [
      [1, "2026-10-31", "2026-11-02"],
      [2, "2026-10-31", "2026-11-02"],
      [3, "2026-11-03", "2026-11-05"],
      [4, "2026-11-03", "2026-11-05"],
    ])
    // 팀을 안 적으면 1팀 (예전과 같음)
    const p1 = planFinishBuilding(b6, { windowFrame: { ...s6.windowFrame, teams: undefined } }, "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(p1[0].bars.map((x) => x.start), ["2026-10-31", "2026-11-03", "2026-11-06", "2026-11-09"])
  })
})
