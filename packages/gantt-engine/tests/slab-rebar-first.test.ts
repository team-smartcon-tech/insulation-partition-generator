// 슬래브철근 우선 작업 (2026-11-05 사용자): 켜면 W철근·S철근이 같은 칸에 겹칠 때 S철근 먼저 (오전에도)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, simulate } from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const run = (slabRebarFirst?: boolean) =>
  simulate({ settings: { ...DEFAULT_SITE_SETTINGS, slabRebarFirst }, calendar, from: "2026-11-02", to: "2026-12-31" }).assignments
const key = (as: ReturnType<typeof run>) => as.map((a) => `${a.date}${a.half} ${a.buildingId} ${a.stage}`)

describe("슬래브철근 우선 작업", () => {
  it("끄면(없으면) 같은 결과", () => assert.deepEqual(key(run(false)), key(run(undefined))))

  it("켜면 오전 S철근이 늘고, 오전에 S철근이 기다리는데 W철근이 철근팀을 잡는 날이 없다", () => {
    const off = run(false)
    const on = run(true)
    const amSlab = (as: typeof on) => as.filter((a) => a.stage === "SLAB_REBAR" && a.half === "AM").length
    assert.ok(amSlab(on) > amSlab(off), `${amSlab(off)} → ${amSlab(on)}`)
    // 철근팀 1: 오전 W철근이 있는 칸에, 같은 날 오후 S철근을 한 동이 그 전부터 기다렸다면(알폼이 전날 끝남) 우선 위반
    const alformEnd = new Map<number, string[]>()
    for (const a of on) if (a.stage === "ALFORM") alformEnd.set(a.buildingId, [...(alformEnd.get(a.buildingId) ?? []), a.date])
    for (const w of on.filter((a) => a.stage === "WALL_REBAR" && a.half === "AM")) {
      const slabPM = on.find((a) => a.stage === "SLAB_REBAR" && a.date === w.date && a.half === "PM" && a.buildingId !== w.buildingId)
      if (!slabPM) continue
      const ends = alformEnd.get(slabPM.buildingId) ?? []
      const lastAlform = ends.filter((d) => d <= w.date).at(-1)
      assert.ok(lastAlform === w.date, `${w.date} ${w.buildingId}동 W철근이 오전을 잡고 ${slabPM.buildingId}동 S철근이 오후로 밀림`)
    }
  })
})
