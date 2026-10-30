// 설계 문서 §8 — 2026년 10월 5개 동 검증. 9월 1일부터 예열 후 10월만 집계. ±1 허용.
// 메모와 어긋나는 3건은 현재 엔진 값으로 고정해 퇴보를 잡는다 (Smart-Gantt-Chart 저장소 결정, 2026-10-29).
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  KR_HOLIDAYS_2026_Q4,
  SCENARIO_2026_10,
  periodStats,
  simulate,
  type SiteSettings,
} from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const near = (a: number, b: number) => Math.abs(a - b) <= 1

function october(settings: SiteSettings) {
  const r = simulate({ settings, calendar, from: "2026-09-01", to: "2026-10-31" })
  return periodStats(r, calendar, "2026-10-01", "2026-10-31")
}

const rows: [string, SiteSettings, number, number, number | null][] = [
  ["철근 2팀(참고)", SCENARIO_2026_10.rebarTwoTeams, 20, 0, null],
  ["철근 1팀, 벽·슬래브 각 하루 (메모 17/3/10)", SCENARIO_2026_10.rebarOnePerDay, 15, 5, 12],
  ["반일 옵션 전부 끔", SCENARIO_2026_10.halfDayOff, 18, 2, 9],
  ["반일 전부 켬, 갱폼 하루 1동 (메모 유휴 6)", SCENARIO_2026_10.halfDayOnGangformPerDay, 20, 0, 4],
  ["반일 전부 켬, 갱폼 반일 1동", SCENARIO_2026_10.halfDayOnGangformPerSlot, 20, 0, 3],
  ["+ 오후 단독투입 불가", SCENARIO_2026_10.halfDayOnNoPMOnlyStart, 20, 0, 6],
]

describe("§8 2026년 10월", () => {
  for (const [name, settings, pours, gaps, alform] of rows) {
    it(`${name} → 타설 ${pours}, 공백 ${gaps}, 알폼 유휴 ${alform ?? "-"}`, () => {
      const s = october(settings)
      assert.ok(near(s.pours, pours), `타설 ${s.pours} ≠ ${pours}`)
      assert.ok(near(s.pourGapDays, gaps), `공백 ${s.pourGapDays} ≠ ${gaps}`)
      if (alform !== null) assert.ok(near(s.idle.alform.fullDays, alform), `알폼 유휴 ${s.idle.alform.fullDays} ≠ ${alform}`)
    })
  }
})
