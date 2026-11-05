// 마감 공정표 집계 (2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { aggregateFinish, orderFinishTypes } from "../src/index.ts"

const types = [
  { id: "A", name: "경량틀", index: 3 },
  { id: "B", name: "경량석고", index: 1 },
  { id: "C", name: "합지", index: 2 },
  { id: "X", name: "지운공종", index: 0, deleted: true },
  { id: "D", name: "견출", index: 0 },
]
const sequences = [
  { prerequisite: "A", successor: "B" },
  { prerequisite: "B", successor: "C" },
]

describe("공종 순서", () => {
  it("작업순서(선후행) 위상 정렬, 같은 단계는 index 순, 지운 공종 제외", () => {
    assert.deepEqual(orderFinishTypes(types, sequences).map((t) => t.name), ["견출", "경량틀", "경량석고", "합지"])
  })
})

describe("동 × 층 × 공종 집계", () => {
  // 101동: 2개 층 × 2세대, 빈 세대 1개
  const rooms = [
    { id: "r11", buildingId: "b1", floor: 1, line: "1" },
    { id: "r12", buildingId: "b1", floor: 1, line: "2" },
    { id: "r21", buildingId: "b1", floor: 2, line: "1" },
    { id: "r22", buildingId: "b1", floor: 2, line: "2" },
    { id: "v", buildingId: "b1", floor: 2, line: "3", isVoid: true },
  ]
  const works = [
    { roomId: "r11", typeId: "A", date: "2026-10-01" },
    { roomId: "r12", typeId: "A", date: "2026-10-10" },
    { roomId: "r21", typeId: "A", date: "2026-10-20" },
    { roomId: "r21", typeId: "A", date: "2026-10-22" }, // 같은 세대 두 번 → 한 번으로
    { roomId: "r11", typeId: "B", date: "2026-10-25" },
    { roomId: "v", typeId: "A", date: "2026-10-25" }, // 빈 세대는 빼기
  ]
  const r = aggregateFinish({ types, sequences, buildings: [{ id: "b1", buildingNo: 101, name: "101동" }], rooms, works, today: "2026-10-30" })
  const b = r.buildings[0]
  it("층별 세대 수 (빈 세대 제외, 높은 층부터)", () => {
    assert.deepEqual(b.floors, [{ floor: 2, units: 2 }, { floor: 1, units: 2 }])
  })
  it("칸 = 그 층 완료 세대 수", () => {
    const cell = (t: string, f: number) => b.cells.find((c) => c.typeId === t && c.floor === f)
    assert.deepEqual([cell("A", 1)?.done, cell("A", 2)?.done, cell("B", 1)?.done], [2, 1, 1])
    assert.equal(cell("A", 2)?.last, "2026-10-22")
  })
  it("요약: 완료·선두층·후미층·속도·예상 완료 (선행 공종보다 앞서지 않음)", () => {
    const st = (t: string) => b.stats.find((s) => s.typeId === t)!
    assert.deepEqual([st("A").done, st("A").total, st("A").lead, st("A").tail], [3, 4, 2, 2])
    assert.equal(st("A").perWeek, 0.5) // 최근 4주 2세대(10/10, 10/22) ÷ 4
    assert.equal(st("A").status, "stalled") // 주당 1세대 미만 = 정체 (날짜를 내지 않는다)
    assert.equal(st("A").forecast, null)
    assert.equal(st("B").status, "blocked") // 선행(경량틀) 정체, B 자신도 속도 없음 → 멈춤
    assert.equal(st("B").blockedBy, "A")
    assert.equal(st("C").status, "blocked")
    assert.equal(st("C").blockedBy, "A") // 맨 앞에서 막은 공종을 이어 받는다
  })
})

describe("예상 완료", () => {
  it("진행 중이면 남은 세대 ÷ 주당 속도, 선행 예상보다 앞서지 않음", () => {
    const rooms = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, buildingId: "b", floor: 1 + Math.floor(i / 2), line: String(i % 2) }))
    const works = [
      ...rooms.slice(0, 8).map((r, i) => ({ roomId: r.id, typeId: "A", date: `2026-10-${String(10 + i).padStart(2, "0")}` })),
      ...rooms.slice(0, 6).map((r, i) => ({ roomId: r.id, typeId: "B", date: `2026-10-${String(12 + i).padStart(2, "0")}` })),
    ]
    const r = aggregateFinish({ types, sequences, buildings: [{ id: "b", buildingNo: 1, name: "1동" }], rooms, works, today: "2026-10-30" })
    const st = (t: string) => r.buildings[0].stats.find((s) => s.typeId === t)!
    assert.equal(st("A").status, "progress")
    assert.equal(st("A").perWeek, 2) // 8세대 ÷ 4주
    assert.equal(st("A").forecast, "2026-11-06") // 남은 2세대 ÷ 2/주 = 1주
    assert.equal(st("B").status, "progress")
    assert.ok(st("B").forecast! >= st("A").forecast!)
  })
})

describe("선행 정체 중에도 진행하는 공종", () => {
  it("자기 속도가 있으면 「진행」, 완료 시점만 미정(blockedBy)", () => {
    const rooms = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, buildingId: "b", floor: 1 + Math.floor(i / 2), line: String(i % 2) }))
    const works = [
      ...rooms.slice(0, 8).map((r) => ({ roomId: r.id, typeId: "A", date: "2026-08-01" })), // A 는 오래 전에 멈춤
      ...rooms.slice(0, 6).map((r, i) => ({ roomId: r.id, typeId: "B", date: `2026-10-${String(12 + i).padStart(2, "0")}` })),
    ]
    const r = aggregateFinish({ types, sequences, buildings: [{ id: "b", buildingNo: 1, name: "1동" }], rooms, works, today: "2026-10-30" })
    const st = (t: string) => r.buildings[0].stats.find((s) => s.typeId === t)!
    assert.equal(st("A").status, "stalled")
    assert.equal(st("B").status, "progress")
    assert.equal(st("B").blockedBy, "A")
    assert.equal(st("B").forecast, null)
  })
})
