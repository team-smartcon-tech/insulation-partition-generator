// 기준층 엔진: 지하·저층이 이미 잡은 타설 날은 「1일 타설」 한도에 같이 센다 (2026-11-02)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { KR_HOLIDAYS_2026_Q4, SCENARIO_2026_10, simulate } from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const run = (reservedPours?: Map<string, number>) =>
  simulate({ settings: SCENARIO_2026_10.halfDayOnGangformPerSlot, calendar, from: "2026-11-02", to: "2026-11-30", reservedPours })
    .assignments.filter((a) => a.stage === "POUR" && a.roof == null)
    .map((a) => a.date)

describe("지하·저층 타설과 같이 센다", () => {
  it("이미 잡힌 날에는 기준층 타설을 넣지 않는다", () => {
    const first = run()[0]
    const after = run(new Map([[first, 1]]))
    assert.ok(!after.includes(first))
  })
  it("잡힌 날이 없으면 그대로", () => {
    assert.deepEqual(run(new Map()), run())
  })
})
