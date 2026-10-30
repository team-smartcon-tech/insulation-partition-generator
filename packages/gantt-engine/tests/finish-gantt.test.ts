// 마감 간트 (2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildFinishGantt, finishTradeOf, floorListText, floorRangeText, splitLinesToCores } from "../src/index.ts"

describe("공종 이름 맞추기", () => {
  it("현장마다 다른 이름을 공종으로", () => {
    const m = (n: string) => finishTradeOf(n)
    assert.equal(m("내장-단열재"), "insulation")
    assert.equal(m("외벽 단열재"), null)
    assert.equal(m("내장-경량틀"), "lightWall")
    assert.equal(m("내장-경량석고"), "wallGypsum")
    assert.equal(m("합지석고"), "wallGypsum")
    assert.equal(m("내장-천정"), "ceilingGypsum")
    assert.equal(m("욕실천정"), null)
    assert.equal(m("PL창호(창틀)공사"), "windowFrame")
    assert.equal(m("PL창호(코킹+사춤)공사"), null)
    assert.equal(m("PL창호(창짝)공사"), "windowSash")
    assert.equal(m("내장-창짝폼사춤"), null)
    assert.equal(m("PL창호공사"), "pvcAll")
    assert.equal(m("유리공사"), "glass")
    assert.equal(m("타일-욕실벽타일"), "tile")
    assert.equal(m("방통2차"), "screed")
    assert.equal(m("1차 방통청소"), null)
    assert.equal(m("주방가구공사"), "kitchen")
    assert.equal(m("일반가구(침실1)"), "furniture")
    assert.equal(m("가구공사"), "furniture")
    assert.equal(m("내장-합지"), "wallpaper")
    assert.equal(m("도배공사"), "wallpaper")
    assert.equal(m("마루공사"), "flooring")
    assert.equal(m("내장공사"), "interiorAll")
    assert.equal(m("견출-내부"), null)
  })
})

describe("실적·예정 막대", () => {
  const rooms = [5, 6, 7, 8].flatMap((f) => [1, 2].map((l) => ({ id: `${f}-${l}`, buildingId: "b", floor: f, line: String(l) })))
  const works = [
    { roomId: "5-1", typeId: "T", date: "2026-10-01" },
    { roomId: "5-2", typeId: "T", date: "2026-10-02" },
    { roomId: "6-1", typeId: "T", date: "2026-10-05" }, // 10/2 → 10/5 = 3일, 이어짐
    { roomId: "6-2", typeId: "T", date: "2026-10-06" },
    { roomId: "7-1", typeId: "T", date: "2026-10-20" }, // 끊김 → 새 막대
    { roomId: "7-2", typeId: "T", date: "2026-10-21" },
  ]
  const g = buildFinishGantt({
    types: [{ id: "T", name: "내장-단열재", index: 0 }],
    buildings: [{ id: "b", buildingNo: 101, name: "101동" }],
    rooms,
    works,
    today: "2026-10-30",
    gapDays: 3,
  })
  const row = g.buildings[0].rows[0]
  it("기본은 완료일마다 따로, 층별 세대", () => {
    const daily = buildFinishGantt({
      types: [{ id: "T", name: "내장-단열재", index: 0 }],
      buildings: [{ id: "b", buildingNo: 101, name: "101동" }],
      rooms,
      works: [...works, { roomId: "8-1", typeId: "T", date: "2026-10-01" }],
      today: "2026-10-30",
    }).buildings[0].rows[0]
    assert.equal(daily.actual.length, 6)
    assert.deepEqual(daily.actual[0].floorUnits, [
      { floor: 8, units: 1 },
      { floor: 5, units: 1 },
    ])
    assert.equal(floorListText(daily.actual[0].floorUnits!.map((x) => x.floor)), "5·8F")
    assert.equal(floorListText([12, 14, 15, -1]), "B1·12·14~15F")
  })
  it("gapDays 3: 완료일이 3일 넘게 끊기면 새 막대, 막대 층 범위", () => {
    assert.deepEqual(
      row.actual.map((b) => [b.start, b.end, floorRangeText(b.floorFrom, b.floorTo), b.units]),
      [
        ["2026-10-01", "2026-10-06", "5~6F", 4],
        ["2026-10-20", "2026-10-21", "7F", 2],
      ],
    )
  })
  it("예정: 남은 층 범위, 최근 4주 속도로", () => {
    assert.equal(row.perWeek, 1) // 최근 4주(10/2 이후) 4세대 ÷ 4
    assert.deepEqual(row.forecast, { start: "2026-10-31", end: "2026-11-13", floorFrom: 8, floorTo: 8, units: 2 })
  })
  it("간트 공종은 맞춘 것만", () => {
    assert.deepEqual(g.trades.map((t) => t.label), ["단열"])
  })
})

describe("세부 공종이 여러 개인 공종 (울산다운2차 타일 거실·욕실…)", () => {
  it("그 동에서 쓰인 세부 공종이 모두 끝나야 세대 완료, 안 쓰인 세부 공종은 무시", () => {
    const rooms = [{ id: "a", buildingId: "b", floor: 1, line: "1" }, { id: "c", buildingId: "b", floor: 1, line: "2" }]
    const g = buildFinishGantt({
      types: [
        { id: "T1", name: "타일-거실바닥", index: 0 },
        { id: "T2", name: "타일-욕실벽타일", index: 1 },
        { id: "T3", name: "타일-아트월", index: 2 }, // 기록 없음 → 무시
      ],
      buildings: [{ id: "b", buildingNo: 1, name: "1동" }],
      rooms,
      works: [
        { roomId: "a", typeId: "T1", date: "2026-10-10" },
        { roomId: "a", typeId: "T2", date: "2026-10-12" },
        { roomId: "c", typeId: "T1", date: "2026-10-11" }, // 욕실 아직 → 미완료
      ],
      today: "2026-10-30",
    })
    const row = g.buildings[0].rows[0]
    assert.equal(row.done, 1)
    assert.equal(row.actual[0].start, "2026-10-12") // 둘 다 끝난 날
  })
})

describe("코어 단위", () => {
  it("설정 코어별 세대수(합 = 라인 수)대로, 비었으면 스마트웍스 라인 높이 규칙", () => {
    const lines = ["1", "2", "3", "4", "5"]
    const tops = [24, 24, 24, 24, 24]
    assert.deepEqual(splitLinesToCores(lines, tops, 2, [2, 3]).map((c) => [c.core, c.lines.join(""), c.source]), [
      [1, "12", "settings"],
      [2, "345", "settings"],
    ])
    // 부산장안 101동: 세대수 비어 있음 → 5세대 = 3+2
    assert.deepEqual(splitLinesToCores(lines, tops, 2, [0, 0]).map((c) => [c.core, c.lines.join(""), c.source]), [
      [1, "123", "smartworks"],
      [2, "45", "smartworks"],
    ])
    // 동 목록 코어 수와 다르면 동 전체
    assert.deepEqual(splitLinesToCores(lines, tops, 3, []), [])
    // 3세대 이하 = 1코어 → 나누지 않음
    assert.deepEqual(splitLinesToCores(["1", "2", "3"], [10, 10, 10], 1, [3]), [])
  })
  it("공종 줄이 코어마다, 완료도 그 코어 세대만", () => {
    const rooms = [1, 2].flatMap((f) => ["1", "2", "3", "4"].map((l) => ({ id: `${f}-${l}`, buildingId: "b", floor: f, line: l })))
    const g = buildFinishGantt({
      types: [{ id: "T", name: "내장-천정", index: 0 }],
      buildings: [{ id: "b", buildingNo: 101, name: "101동", cores: 2, coreUnits: [2, 2] }],
      rooms,
      works: [
        { roomId: "1-1", typeId: "T", date: "2026-10-16" },
        { roomId: "1-2", typeId: "T", date: "2026-10-16" },
        { roomId: "1-3", typeId: "T", date: "2026-10-18" },
      ],
      today: "2026-10-30",
    })
    const b = g.buildings[0]
    assert.deepEqual(b.rows.map((r) => [r.trade, r.core, r.done, r.total]), [
      ["ceilingGypsum", 1, 2, 4],
      ["ceilingGypsum", 2, 1, 4],
    ])
    assert.deepEqual(b.rows[0].floors.map((f) => [f.floor, f.done, f.units]), [[1, 2, 2], [2, 0, 2]])
  })
})
