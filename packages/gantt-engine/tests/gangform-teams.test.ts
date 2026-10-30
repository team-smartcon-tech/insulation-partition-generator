// 갱폼팀 수 + 팀당 N동/일 (2026-10-30)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { gangformCaps } from "../src/index.ts"

describe("갱폼 용량", () => {
  it("하루 = 팀 수 × 팀당 N동, 반일 = 팀 수 × ⌈N/2⌉", () => {
    assert.deepEqual(gangformCaps({ gangform: { per: "day", count: 1 } }), { perDay: 1, perSlot: 1, perTeamPerDay: 1 })
    assert.deepEqual(gangformCaps({ gangform: { per: "day", count: 2 }, gangformTeams: 2 }), { perDay: 4, perSlot: 2, perTeamPerDay: 2 })
    assert.deepEqual(gangformCaps({ gangform: { per: "day", count: 3 }, gangformTeams: 1 }), { perDay: 3, perSlot: 2, perTeamPerDay: 3 })
  })
  it("예전 「반일 c동」 = 팀당 하루 2c동 (반일 c · 하루 2c, 예전과 같은 결과)", () => {
    assert.deepEqual(gangformCaps({ gangform: { per: "slot", count: 1 } }), { perDay: 2, perSlot: 1, perTeamPerDay: 2 })
  })
})
