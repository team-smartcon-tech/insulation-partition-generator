// 오후 W철근이면 W기전 함께 시공 (2026-11-05 사용자)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, simulate } from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const run = (wallMepWithPMRebar?: boolean) =>
  simulate({
    settings: { ...DEFAULT_SITE_SETTINGS, halfDay: { ...DEFAULT_SITE_SETTINGS.halfDay, wallMepWithPMRebar } },
    calendar,
    from: "2026-11-02",
    to: "2026-12-31",
  }).assignments
const key = (as: ReturnType<typeof run>) => as.map((a) => `${a.slotIndex} ${a.buildingId} ${a.stage}`)

describe("오후 W철근 + W기전 함께", () => {
  it("끄면(없으면) 같은 결과, 같은 칸 W기전 없음", () => {
    const off = run(false)
    assert.deepEqual(key(off), key(run(undefined)))
    assert.ok(!off.some((m) => m.stage === "WALL_MEP" && off.some((r) => r.stage === "WALL_REBAR" && r.slotIndex === m.slotIndex && r.buildingId === m.buildingId)))
  })
  it("켜면 오후 W철근마다 같은 칸에 W기전, 오전 W철근은 그대로", () => {
    const on = run(true)
    const pm = on.filter((a) => a.stage === "WALL_REBAR" && a.half === "PM")
    assert.ok(pm.length > 0)
    for (const r of pm) assert.ok(on.some((m) => m.stage === "WALL_MEP" && m.slotIndex === r.slotIndex && m.buildingId === r.buildingId), `${r.date} ${r.buildingId}동`)
    for (const r of on.filter((a) => a.stage === "WALL_REBAR" && a.half === "AM"))
      assert.ok(!on.some((m) => m.stage === "WALL_MEP" && m.slotIndex === r.slotIndex && m.buildingId === r.buildingId))
  })
  it("같은 동 W기전은 층마다 한 번", () => {
    const on = run(true)
    const k = on.filter((a) => a.stage === "WALL_MEP").map((a) => `${a.buildingId}|${a.floor}`)
    assert.equal(new Set(k).size, k.length)
  })
})
