// 동절기 양생일 오후 갱폼인양 설정 (2026-11-02)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, getDayInfo, simulate } from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }
const run = (on: boolean) =>
  simulate({
    settings: { ...DEFAULT_SITE_SETTINGS, halfDay: { ...DEFAULT_SITE_SETTINGS.halfDay, curingDayGangformPM: on } },
    calendar,
    from: "2026-11-02",
    to: "2026-11-30",
  }).assignments
/** 양생일(동절기 타설 다음 날)에 잡힌 갱폼 */
const onCuringDay = (as: ReturnType<typeof run>) => {
  const pours = new Set(as.filter((a) => a.stage === "POUR" && a.roof == null).map((a) => `${a.buildingId}|${a.date}`))
  return as.filter((a) => {
    if (a.stage !== "GANGFORM") return false
    const prev = new Date(Date.parse(a.date) - 86_400_000).toISOString().slice(0, 10)
    return pours.has(`${a.buildingId}|${prev}`) && getDayInfo(calendar, prev).curingDays === 1
  })
}

describe("동절기 양생일 갱폼", () => {
  it("끄면(기본) 양생일에 갱폼 없음", () => {
    assert.equal(onCuringDay(run(false)).length, 0)
  })
  it("켜면 양생일 오후 갱폼이 생기고, 오전은 여전히 없음", () => {
    const xs = onCuringDay(run(true))
    assert.ok(xs.length > 0)
    assert.ok(xs.every((a) => a.half === "PM"))
  })
})
