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

describe("한중 기간을 켜면 양생일 오후 갱폼 설정은 쓰지 않는다 (2026-11-05)", () => {
  it("한중 기간 시작 전 11~3월 양생일에도 오후 갱폼이 없다", () => {
    const as = simulate({
      settings: { ...DEFAULT_SITE_SETTINGS, halfDay: { ...DEFAULT_SITE_SETTINGS.halfDay, curingDayGangformPM: true } },
      calendar: { ...calendar, winterCuringRange: { start: "11-24", end: "03-04" } },
      from: "2026-11-02",
      to: "2026-11-23",
    }).assignments
    assert.equal(onCuringDay(as).length, 0)
  })
})

describe("동절기 보온양생 2일 (갱폼인양 타설일+3일)", () => {
  const runW = (on: boolean) =>
    simulate({ settings: { ...DEFAULT_SITE_SETTINGS, winterCuring2Days: on }, calendar, from: "2026-11-02", to: "2026-11-30" }).assignments
  /** 동별 타설일 → 그 뒤 첫 갱폼까지 달력일 */
  const gaps = (as: ReturnType<typeof runW>) => {
    const out: number[] = []
    for (const p of as.filter((a) => a.stage === "POUR" && a.roof == null)) {
      const g = as.find((a) => a.buildingId === p.buildingId && a.stage === "GANGFORM" && a.date > p.date)
      if (g) out.push(Math.round((Date.parse(g.date) - Date.parse(p.date)) / 86_400_000))
    }
    return out
  }
  it("끄면 타설 이틀 뒤 갱폼이 있다", () => {
    assert.ok(gaps(runW(false)).some((d) => d === 2))
  })
  it("예전에 저장된 winterCuring2Days 는 무시한다 (2026-11-05 한중 기간으로 합침)", () => {
    assert.deepEqual(runW(true), runW(false))
  })
  it("한중 기간 타설은 「보온양생 2일」 을 꺼도 +3일 (2026-11-05)", () => {
    const as = simulate({
      settings: DEFAULT_SITE_SETTINGS,
      calendar: { ...calendar, winterCuringRange: { start: "11-01", end: "03-31" } },
      from: "2026-11-02",
      to: "2026-11-30",
    }).assignments
    const g = gaps(as)
    assert.ok(g.length > 0)
    assert.ok(g.every((d) => d >= 3))
  })
  it("한중 기간 타설은 먹매김도 타설일 +2일부터 (2026-11-05)", () => {
    const as = simulate({
      settings: DEFAULT_SITE_SETTINGS,
      calendar: { ...calendar, winterCuringRange: { start: "11-01", end: "03-31" } },
      from: "2026-11-02",
      to: "2026-11-30",
    }).assignments
    const g: number[] = []
    for (const p of as.filter((a) => a.stage === "POUR" && a.roof == null)) {
      const m = as.find((a) => a.buildingId === p.buildingId && a.stage === "MARK" && a.date > p.date)
      if (m) g.push(Math.round((Date.parse(m.date) - Date.parse(p.date)) / 86_400_000))
    }
    assert.ok(g.length > 0)
    assert.ok(g.every((d) => d >= 2), `${g}`)
  })
  it("한중 기간 시작 전·끝 뒤 타설은 +3일을 적용하지 않는다", () => {
    const range = { start: "11-24", end: "01-05" }
    const as = simulate({
      settings: DEFAULT_SITE_SETTINGS,
      calendar: { ...calendar, winterCuringRange: range },
      from: "2026-11-02",
      to: "2027-01-31",
    }).assignments
    const byPour = (inRange: (d: string) => boolean) =>
      as
        .filter((a) => a.stage === "POUR" && a.roof == null && inRange(a.date))
        .map((p) => {
          const g = as.find((a) => a.buildingId === p.buildingId && a.stage === "GANGFORM" && a.date > p.date)
          return g ? Math.round((Date.parse(g.date) - Date.parse(p.date)) / 86_400_000) : null
        })
        .filter((d): d is number => d != null)
    const before = byPour((d) => d < "2026-11-24")
    const inside = byPour((d) => d >= "2026-11-24" && d <= "2027-01-05")
    const after = byPour((d) => d > "2027-01-05")
    assert.ok(before.length && inside.length && after.length)
    assert.ok(before.some((d) => d < 3), `시작 전 ${before}`)
    assert.ok(inside.every((d) => d >= 3), `기간 안 ${inside}`)
    assert.ok(after.some((d) => d < 3), `끝 뒤 ${after}`)
  })
  it("한중 기간 시작 전은 한중 기간을 켜지 않은 것과 똑같다", () => {
    const run = (calendarX: typeof calendar & { winterCuringRange?: { start: string; end: string } }) =>
      simulate({ settings: DEFAULT_SITE_SETTINGS, calendar: calendarX, from: "2026-11-02", to: "2026-12-31" })
        .assignments.filter((a) => a.date < "2026-11-25")
        .map((a) => `${a.date}${a.half} ${a.buildingId} ${a.stage} ${a.floor}`)
    assert.deepEqual(run({ ...calendar, winterCuringRange: { start: "11-24", end: "03-04" } }), run(calendar))
  })
})
