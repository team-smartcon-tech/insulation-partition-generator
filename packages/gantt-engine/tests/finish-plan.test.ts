// 마감 예정 (선행·층 묶음 규칙, 2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { FINISH_TRADES, finishPlanOf, hasFinishPlan, planFinishBuilding, planFinishSite, type FinishGanttBuilding } from "../src/index.ts"

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
  it("선행 없는 공종: 이미 시작했으면 내일부터 남은 층을 묶음으로 (일요일은 빼고 센다 — 2026-11-02)", () => {
    // 10/31(토) 시작, 3일 → 11/3(화) (11/1 일요일 쉼)
    assert.deepEqual(bars("windowFrame"), [[3, 4, "2026-10-31", "2026-11-03"]])
  })
  it("선행 층 완료 + 간격 뒤, 같은 공종은 앞 묶음이 끝나야 다음", () => {
    assert.deepEqual(bars("insulation"), [
      [2, 2, "2026-10-31", "2026-11-02"], // 2층: 창틀 10/22 + 3일 → 10/27 이후, 내일(10/31)부터, 2일(10/31·11/2, 일요일 쉼)
      [3, 3, "2026-11-07", "2026-11-09"], // 3층: 창틀 예정 11/3 + 3일 → 11/7, 2일(11/7·11/9)
      [4, 4, "2026-11-10", "2026-11-11"], // 앞 묶음 끝난 다음 작업일
    ])
  })
  it("선행 없는 공종이 그 동에서 시작 전이면 예정 없음", () => {
    const b2: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({})), row("insulation", floors({}))] }
    const p2 = planFinishBuilding(b2, settings, "2026-10-30")
    assert.deepEqual(p2.map((x) => x.bars.length), [0, 0])
  })
  it("예전 키로 저장된 규칙도 읽는다: 「tile」 → 바닥타일, 「baseboard」 → 내장몰딩, 선행 「tile」 → floorTile (2026-10-31 공종 14개)", () => {
    const old = { tile: { pred: "screed", gapDays: 9, floorsPerBatch: 3, daysPerBatch: 6 }, baseboard: { pred: "tile", gapDays: 1, floorsPerBatch: 2, daysPerBatch: 1 } }
    assert.deepEqual([finishPlanOf(old, "floorTile").gapDays, finishPlanOf(old, "floorTile").daysPerBatch], [9, 6])
    assert.deepEqual([finishPlanOf(old, "molding").gapDays, finishPlanOf(old, "molding").pred], [1, "floorTile"])
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
    assert.deepEqual(ins(2)[0], [2, "2026-11-07"])
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
  it("공종 14개 모두 예정 규칙이 있고, 기본 선행은 목록에서 바로 앞 공종 (PL창틀은 골조 5개 층)", () => {
    const keys = FINISH_TRADES.map((t) => t.key)
    assert.equal(keys.length, 14)
    assert.ok(keys.every(hasFinishPlan))
    assert.deepEqual(keys.map((k) => finishPlanOf(undefined, k).pred), [null, ...keys.slice(0, -1)])
    assert.equal(finishPlanOf(undefined, "windowFrame").frameLead, 5)
  })
  it("팀 2개: 묶음 둘을 동시에, 다음 묶음은 먼저 빈 팀이", () => {
    const b6: FinishGanttBuilding = { ...b, rows: [row("windowFrame", floors({}))] }
    const s6 = { windowFrame: { pred: null, frameLead: 0, teams: 2, gapDays: 0, floorsPerBatch: 1, daysPerBatch: 3 } }
    const p6 = planFinishBuilding(b6, s6, "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(p6[0].bars.map((x) => [x.floorFrom, x.start, x.end]), [
      [1, "2026-10-31", "2026-11-03"],
      [2, "2026-10-31", "2026-11-03"],
      [3, "2026-11-04", "2026-11-06"],
      [4, "2026-11-04", "2026-11-06"],
    ])
    // 팀을 안 적으면 1팀 (예전과 같음)
    const p1 = planFinishBuilding(b6, { windowFrame: { ...s6.windowFrame, teams: undefined } }, "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(p1[0].bars.map((x) => x.start), ["2026-10-31", "2026-11-04", "2026-11-07", "2026-11-11"])
  })
  it("팀은 현장 전체가 나눠 쓴다: 1팀이면 두 동·두 코어가 동시에 하지 않고, 2팀이면 동시에", () => {
    const bld = (no: number): FinishGanttBuilding => ({
      buildingNo: no,
      name: `${no}동`,
      cores: [],
      rows: [row("windowFrame", floors({}), 1), row("windowFrame", floors({}), 2)],
    })
    const rule = (teams: number) => ({ windowFrame: { pred: null, frameLead: 0, teams, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 } })
    const all = (m: Map<number, { bars: { start: string; end: string }[] }[]>) =>
      [...m.values()].flatMap((rows) => rows.flatMap((r) => r.bars)).sort((x, y) => x.start.localeCompare(y.start))
    // 2개 동 × 2코어 × 묶음 2개 = 8묶음, 1팀이면 3일씩 이어서: 10/31 … 마지막 11/25 시작(일요일 쉼)
    const one = all(planFinishSite([bld(101), bld(102)], rule(1), "2026-10-30", 540, () => "2026-10-01"))
    assert.equal(one.length, 8)
    for (let k = 1; k < one.length; k++) assert.ok(one[k].start > one[k - 1].end, "1팀은 겹치지 않는다")
    assert.equal(one.at(-1)!.start, "2026-11-25")
    // 2팀이면 두 묶음씩 동시에 → 마지막 시작 11/11
    const two = all(planFinishSite([bld(101), bld(102)], rule(2), "2026-10-30", 540, () => "2026-10-01"))
    assert.deepEqual([two[0].start, two[1].start, two.at(-1)!.start], ["2026-10-31", "2026-10-31", "2026-11-11"])
  })
  it("예전 PL창틀(pvcAll) 줄은 창틀 규칙을 쓰고, 선행 「창틀」 은 그 코어의 PL창틀 줄을 본다 · 기본 간격 2일·5개 층", () => {
    assert.deepEqual(finishPlanOf({ windowFrame: { pred: null, frameLead: 3, gapDays: 1, floorsPerBatch: 4, daysPerBatch: 2 } }, "pvcAll").floorsPerBatch, 4)
    assert.deepEqual([finishPlanOf(undefined, "tile").gapDays, finishPlanOf(undefined, "tile").floorsPerBatch], [2, 5])
    // PL창틀 2층까지 끝(10/22) → 단열 2층은 PL창틀 완료 + 간격 3일 뒤
    const b7: FinishGanttBuilding = {
      ...b,
      rows: [row("pvcAll", floors({ 1: "2026-10-20", 2: "2026-10-22" })), row("insulation", floors({ 1: "2026-10-27" }))],
    }
    const s7 = { insulation: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 1, daysPerBatch: 2 } }
    const ins = planFinishBuilding(b7, s7, "2026-10-30").find((x) => x.trade === "insulation")!.bars
    // PL창틀 3~4층 예정 10/31~11/2 (기본 5개 층씩·3일) → 단열 3층은 11/2 + 3 + 1 = 11/6. 선행이 빠졌다면 11/2 에 시작했다
    assert.deepEqual(ins.map((x) => [x.floorFrom, x.start]), [[2, "2026-10-31"], [3, "2026-11-07"], [4, "2026-11-10"]])
  })
  it("스마트웍스 실적이 없는 공종도 선행이 있으면 예정을 낸다 (연결 없는 공종 = 예정만)", () => {
    const b8: FinishGanttBuilding = {
      ...b,
      rows: [row("ceilingWallpaper", floors({ 1: "2026-10-20", 2: "2026-10-22" })), row("wallpaper", floors({}))],
    }
    const s8 = { wallpaper: { pred: "ceilingWallpaper", gapDays: 0, floorsPerBatch: 1, daysPerBatch: 1 } }
    const bars = planFinishBuilding(b8, s8, "2026-10-30").find((x) => x.trade === "wallpaper")!.bars
    assert.deepEqual(bars.slice(0, 2).map((x) => x.floorFrom), [1, 2])
  })
  it("예정은 1년 반(540일)을 넘어도 이어진다 — 선행 사슬 끝 공종이 2028년 이후에도 (한도 5년)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ floor: i + 1, units: 2, done: 0, last: null }))
    const b9: FinishGanttBuilding = { ...b, rows: [{ ...row("wallpaper", floors({})), floors: many(40), done: 1 }] }
    // 40개 층 · 1층씩 · 20일 → 800일, 시작한 공종(done > 0)이라 선행 없이 내일부터
    const s9 = { wallpaper: { pred: null, gapDays: 0, floorsPerBatch: 1, daysPerBatch: 20 } }
    const bars = planFinishBuilding(b9, s9, "2026-10-30").find((x) => x.trade === "wallpaper")!.bars
    assert.equal(bars.length, 40)
    assert.ok(bars.at(-1)!.start > "2028-05-01")
  })
})

describe("겹쳐 이동 (2026-11-01 사용자: PL창호 1코어 하루 하고 2코어로 — 4코어 5일씩이면 8일)", () => {
  // 4층짜리 4코어 동 2개, 골조는 다 됨
  const bld = (no: number): FinishGanttBuilding => ({
    buildingNo: no,
    name: `${no}동`,
    cores: [],
    rows: [1, 2, 3, 4].map((c) => row("windowFrame", floors({}), c)),
  })
  const rule = (extra: object) => ({ windowFrame: { pred: null, frameLead: 0, gapDays: 0, floorsPerBatch: 4, daysPerBatch: 5, ...extra } })
  const starts = (p: Map<number, { core: number | null; bars: { start: string; end: string }[] }[]>, no: number) =>
    p.get(no)!.map((r) => [r.core, r.bars[0]?.start, r.bars[0]?.end])
  it("코어마다 1일 간격: 1코어 10/31 → 4코어 11/3 시작, 4코어가 끝나는 11/7 까지 8일", () => {
    const p = planFinishSite([bld(101)], rule({ moveDays: 1 }), "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(starts(p, 101), [
      [1, "2026-10-31", "2026-11-05"],
      [2, "2026-11-02", "2026-11-06"],
      [3, "2026-11-03", "2026-11-07"],
      [4, "2026-11-04", "2026-11-09"],
    ])
  })
  it("코어를 다 돌면 다음 동으로 (같은 코어는 앞 묶음이 끝나야)", () => {
    const p = planFinishSite([bld(101), bld(102)], rule({ moveDays: 1 }), "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(starts(p, 102).map((x) => x[1]), ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09"])
  })
  it("동마다 1일 간격: 그 동 코어들은 같은 날, 다음 동은 하루 뒤", () => {
    const p = planFinishSite([bld(101), bld(102)], rule({ moveDays: 1, moveBy: "building" }), "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(starts(p, 101).map((x) => x[1]), ["2026-10-31", "2026-10-31", "2026-10-31", "2026-10-31"])
    assert.deepEqual(starts(p, 102).map((x) => x[1]), ["2026-11-02", "2026-11-02", "2026-11-02", "2026-11-02"])
  })
  it("간격이 없으면 지금처럼: 1팀이 한 코어를 끝내야 다음", () => {
    const p = planFinishSite([bld(101)], rule({}), "2026-10-30", 540, () => "2026-10-01")
    assert.deepEqual(starts(p, 101).map((x) => x[1]), ["2026-10-31", "2026-11-06", "2026-11-12", "2026-11-18"])
  })
})
