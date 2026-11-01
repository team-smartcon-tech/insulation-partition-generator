// 갱폼 셋팅층 (2026-11-01): 기준층 시작(= 알폼 셋팅층)부터 갱폼 셋팅층 아래까지는 갱폼인양 없이 알폼 사이클
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, planUnderground, simulate, undergroundSequence, type BuildingState } from "../src/index.ts"

const start = (gangformFloor: number | null): BuildingState => ({
  id: 101,
  stage: "MARK",
  readySlot: 0,
  readyDate: "2026-11-02",
  prevEndSlot: -1,
  lastPourDate: null,
  pours: 0,
  floor: 3,
  topFloor: 7,
  done: false,
  gangformFloor,
})
const run = (g: number | null) =>
  simulate({ settings: DEFAULT_SITE_SETTINGS, calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] }, from: "2026-11-02", to: "2027-03-31", initial: [start(g)] })

describe("갱폼 셋팅층", () => {
  it("없으면 기준층 시작부터 층마다 갱폼인양 (예전과 같다)", () => {
    const floors = [...new Set(run(null).assignments.filter((a) => a.stage === "GANGFORM").map((a) => a.floor))]
    assert.deepEqual(floors, [3, 4, 5, 6, 7])
  })
  it("갱폼 셋팅층 5 면 3·4층은 갱폼인양 없이, 5층부터 갱폼", () => {
    const r = run(5)
    const floors = [...new Set(r.assignments.filter((a) => a.stage === "GANGFORM").map((a) => a.floor))]
    assert.deepEqual(floors, [5, 6, 7])
    // 갱폼을 건너뛴 층도 타설까지 간다
    assert.deepEqual(r.assignments.filter((a) => a.stage === "POUR").map((a) => a.floor), [3, 4, 5, 6, 7])
  })
  it("저층에서도 갱폼 셋팅층 이상이면 먹매김 다음 갱폼: 셋팅층은 설치 기간, 그 위는 인양 1일 (지하는 없음)", () => {
    const seq = (story: number, g: number | null) => undergroundSequence(undefined, story, g, 4).map((x) => [x.stage, x.days])
    assert.deepEqual(seq(1, 2).slice(0, 2), [["MARK", 1], ["WALL_REBAR", 6]]) // 1층 < 갱폼 셋팅 2층
    assert.deepEqual(seq(2, 2).slice(0, 3), [["MARK", 1], ["GANGFORM", 4], ["WALL_REBAR", 6]])
    assert.deepEqual(seq(3, 2).slice(0, 2), [["MARK", 1], ["GANGFORM", 1]])
    assert.equal(seq(-1, 1)[1][0], "WALL_REBAR") // 지하
  })
  it("기준층 갱폼 셋팅층: 타설 → 먹매김 → 갱폼 설치 기간 막대 → 벽철근, 그 위 층은 인양", () => {
    const r = simulate({
      settings: DEFAULT_SITE_SETTINGS,
      calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
      from: "2026-11-02",
      to: "2027-03-31",
      initial: [{ ...start(5), gangformSetupDays: 4 }],
    })
    const g5 = new Set(r.assignments.filter((a) => a.stage === "GANGFORM" && a.floor === 5).map((a) => a.date))
    assert.equal(g5.size, 4) // 설치 4일
    const mark5 = r.assignments.find((a) => a.stage === "MARK" && a.floor === 5)!.date
    const pour4 = r.assignments.find((a) => a.stage === "POUR" && a.floor === 4)!.date
    assert.ok(mark5 > pour4 && [...g5][0] >= mark5)
    assert.ok(r.assignments.find((a) => a.stage === "WALL_REBAR" && a.floor === 5)!.date > [...g5].at(-1)!)
    // 6층은 보통 인양(반일)
    assert.ok(r.assignments.filter((a) => a.stage === "GANGFORM" && a.floor === 6).length <= 2)
  })
  it("저층 갱폼 셋팅층: 설치 기간만큼 갱폼 막대", () => {
    const plan = (days: number) =>
      planUnderground({
        calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
        from: "2026-11-02",
        to: "2027-06-30",
        buildings: [{ id: 1, story: 1, stepIndex: 0, doneDays: 0, baseFloor: 4, gangformFloor: 2 }],
        gangformSetupDays: days,
      })
    const gDays = (r: ReturnType<typeof plan>, floor: number) => new Set(r.assignments.filter((a) => a.stage === "GANGFORM" && a.floor === floor).map((a) => a.date)).size
    assert.deepEqual([gDays(plan(5), 2), gDays(plan(5), 3), gDays(plan(5), 1)], [5, 1, 0])
  })
  it("알폼 셋팅: 기준층 시작(알폼 셋팅층) 첫 사이클의 알폼을 셋팅 기간만큼 막대로, 그 위 층은 보통 알폼", () => {
    const r = simulate({
      settings: DEFAULT_SITE_SETTINGS,
      calendar: { holidays: [...KR_HOLIDAYS_2026_Q4] },
      from: "2026-11-02",
      to: "2027-03-31",
      initial: [{ ...start(null), alformFloor: 3, alformSetupDays: 5 }],
    })
    const days = (floor: number) => new Set(r.assignments.filter((a) => a.stage === "ALFORM" && a.floor === floor).map((a) => a.date)).size
    assert.equal(days(3), 5)
    assert.ok(days(4) <= 2)
  })
})

