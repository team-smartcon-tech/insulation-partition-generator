// 마감 간트 (2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildFinishGantt, finishTradeOf, floorRangeText } from "../src/index.ts"

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
  })
  const row = g.buildings[0].rows[0]
  it("완료일이 3일 넘게 끊기면 새 막대, 막대 층 범위", () => {
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
