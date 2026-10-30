// 마감 예정 (선행·층 묶음 규칙, 2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { KR_HOLIDAYS_2026_Q4, planFinishBuilding, type FinishGanttBuilding } from "../src/index.ts"

const cal = { holidays: [...KR_HOLIDAYS_2026_Q4] }
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
  const p = planFinishBuilding(b, settings, cal, "2026-10-30")
  const bars = (t: string) => p.find((x) => x.trade === t)!.bars.map((x) => [x.floorFrom, x.floorTo, x.start, x.end])
  it("선행 없는 공종: 이미 시작했으면 내일부터 남은 층을 묶음으로 (일요일 제외)", () => {
    // 10/31(토) 시작, 3작업일 → 11/3(화) (11/1 일요일 제외)
    assert.deepEqual(bars("windowFrame"), [[3, 4, "2026-10-31", "2026-11-03"]])
  })
  it("선행 층 완료 + 간격 뒤, 같은 공종은 앞 묶음이 끝나야 다음", () => {
    assert.deepEqual(bars("insulation"), [
      [2, 2, "2026-10-31", "2026-11-02"], // 2층: 창틀 10/22 + 3일 → 10/26 이후, 내일(10/31)부터, 2작업일(10/31·11/2)
      [3, 3, "2026-11-07", "2026-11-09"], // 3층: 창틀 예정 11/3 + 3일 → 11/7(토)
      [4, 4, "2026-11-10", "2026-11-11"], // 앞 묶음 끝난 다음 날
    ])
  })
  it("선행 없는 공종이 그 동에서 시작 전이면 예정 없음", () => {
    const b2: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({})), row("insulation", floors({}))] }
    const p2 = planFinishBuilding(b2, settings, cal, "2026-10-30")
    assert.deepEqual(p2.map((x) => x.bars.length), [0, 0])
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
    const p3 = planFinishBuilding(b3, settings, cal, "2026-10-30")
    assert.deepEqual(p3.map((x) => [x.trade, x.core]), [["windowFrame", 1], ["insulation", 1], ["windowFrame", 2], ["insulation", 2]])
    const ins = (core: number) => p3.find((x) => x.trade === "insulation" && x.core === core)!.bars.map((x) => [x.floorFrom, x.start])
    // 1코어: 창틀 다 끝남 → 2층부터 바로. 2코어: 2층 창틀 예정(11/3) + 3일 뒤
    assert.deepEqual(ins(1)[0], [2, "2026-10-31"])
    assert.deepEqual(ins(2)[0], [2, "2026-11-07"])
  })
})
