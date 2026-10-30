// 지하·저층 예정 계산 (설계 §8-2, 2026-10-30 2안)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_UNDERGROUND_SETTINGS,
  KR_HOLIDAYS_2026_Q4,
  getDayInfo,
  parseWorkText,
  planUnderground,
  progressFromReports,
  undergroundSequence,
  undergroundStateFromActual,
} from "../src/index.ts"

const calendar = { holidays: [...KR_HOLIDAYS_2026_Q4] }

describe("지하 순서표", () => {
  it("기본: W철근∥W기전 → W거푸집 → 시스템 → S거푸집 → S철근∥S기전 → S타설", () => {
    assert.deepEqual(
      undergroundSequence().map((s) => s.stage),
      ["WALL_REBAR", "WALL_MEP", "FORM_WALL", "SHORING", "FORM_SLAB", "SLAB_REBAR", "SLAB_MEP", "POUR"],
    )
  })
  it("분리 타설이면 W거푸집 뒤 W타설", () => {
    const seq = undergroundSequence({ ...DEFAULT_UNDERGROUND_SETTINGS, separateWallPour: true }).map((s) => s.stage)
    assert.equal(seq[seq.indexOf("FORM_WALL") + 1], "POUR_WALL")
  })
})

describe("지하 예정", () => {
  const run = (story: number, baseFloor = 2) =>
    planUnderground({ calendar, from: "2026-11-02", to: "2027-03-31", buildings: [{ id: 501, story, stepIndex: 0, doneDays: 0, baseFloor }] })

  it("한 층: 병행 공종은 같은 날 오전·오후, 일수는 순서표대로", () => {
    const r = run(-1, 1) // B1 한 층만
    const days = (st: string) => new Set(r.assignments.filter((a) => a.stage === st).map((a) => a.date)).size
    const d = DEFAULT_UNDERGROUND_SETTINGS.durations
    assert.equal(days("WALL_REBAR"), d.wallRebar)
    assert.equal(days("WALL_MEP"), d.wallMep)
    assert.equal(days("FORM_WALL"), d.formWall)
    assert.equal(days("SLAB_MEP"), d.slabMep)
    assert.equal(days("POUR"), 1)
    const first = r.assignments.filter((a) => a.date === r.assignments[0].date)
    assert.deepEqual(first.map((a) => a.stage), ["WALL_REBAR", "WALL_MEP"])
  })

  it("층 순서 B2 → B1 → 1F, 기준층 시작(2F) 전에서 끝나고 끝난 날을 알려 준다", () => {
    const r = run(-2, 2)
    const floors = [...new Set(r.assignments.map((a) => a.floor))]
    assert.deepEqual(floors, [-2, -1, 1])
    const lastPour = r.assignments.filter((a) => a.stage === "POUR").at(-1)!
    assert.equal(r.finishedOn.get(501), lastPour.date)
  })

  it("작업일만(일요일 제외), 타설은 타설 가능일만", () => {
    const r = run(-2, 2)
    for (const a of r.assignments) {
      const day = getDayInfo(calendar, a.date)
      assert.ok(day.workable, a.date)
      if (a.stage === "POUR") assert.ok(day.pourAllowed, a.date)
    }
  })
})

describe("지하·저층 순서표 분리", () => {
  const settings = {
    ...DEFAULT_UNDERGROUND_SETTINGS,
    lowRise: { durations: { ...DEFAULT_UNDERGROUND_SETTINGS.durations, formWall: 3 }, separateWallPour: true },
  }
  it("B층은 지하 값, 1층부터 저층 값", () => {
    assert.equal(undergroundSequence(settings, -1).find((s) => s.stage === "FORM_WALL")?.days, DEFAULT_UNDERGROUND_SETTINGS.durations.formWall)
    assert.equal(undergroundSequence(settings, 1).find((s) => s.stage === "FORM_WALL")?.days, 3)
    assert.ok(!undergroundSequence(settings, -1).some((s) => s.stage === "POUR_WALL"))
    assert.ok(undergroundSequence(settings, 1).some((s) => s.stage === "POUR_WALL"))
  })
  it("예정: B1 은 지하 일수, 1F 는 저층 일수", () => {
    const r = planUnderground({ calendar, settings, from: "2026-11-02", to: "2027-03-31", buildings: [{ id: 1, story: -1, stepIndex: 0, doneDays: 0, baseFloor: 2 }] })
    const days = (floor: number, st: string) => new Set(r.assignments.filter((a) => a.floor === floor && a.stage === st).map((a) => a.date)).size
    assert.equal(days(-1, "FORM_WALL"), DEFAULT_UNDERGROUND_SETTINGS.durations.formWall)
    assert.equal(days(1, "FORM_WALL"), 3)
    assert.equal(days(1, "POUR_WALL"), 1)
    assert.equal(days(-1, "POUR_WALL"), 0)
  })
})

describe("실적 → 지하 위치", () => {
  const A = (date: string, stage: string, floor: number) => ({ date, buildingId: 501, stage: stage as never, floor })
  it("최근 가장 높은 층의 가장 뒤 공종, 순서표 일수 다 했으면 다음 공종", () => {
    const st = undergroundStateFromActual(
      [A("2026-10-20", "FORM_WALL", -1), A("2026-10-26", "SLAB_REBAR", -1), A("2026-10-27", "SLAB_REBAR", -1), A("2026-10-28", "SLAB_REBAR", -1), A("2026-10-29", "SLAB_REBAR", -1)],
      501,
      2,
    )
    // S철근 4일(기본 4) 다 함 → S기전은 병행이라 건너뛰고 S타설
    assert.deepEqual(st, { id: 501, story: -1, stepIndex: 7, doneDays: 0, baseFloor: 2 })
  })
  it("S타설까지 했으면 다음 층 처음 (B1 → 1F)", () => {
    const st = undergroundStateFromActual([A("2026-10-29", "POUR", -1)], 501, 2)
    assert.deepEqual(st, { id: 501, story: 1, stepIndex: 0, doneDays: 0, baseFloor: 2 })
  })
  it("예전 일부 타설이 있어도 최근 실적 기준 (504동 9/23 1F 바닥 일부 타설 뒤 10월 B1 바닥 거푸집 계속)", () => {
    const st = undergroundStateFromActual([A("2026-09-23", "POUR", -1), A("2026-10-20", "FORM_SLAB", -1), A("2026-10-21", "FORM_SLAB", -1)], 501, 2)
    assert.equal(st?.story, -1)
    assert.equal(st?.stepIndex, 4) // S거푸집 진행 중
  })

  it("진행 중이면 남은 일수", () => {
    const st = undergroundStateFromActual([A("2026-10-28", "FORM_WALL", -1), A("2026-10-29", "FORM_WALL", -1)], 501, 2)
    assert.deepEqual(st, { id: 501, story: -1, stepIndex: 2, doneDays: 2, baseFloor: 2 })
  })
})

describe("시스템 동바리 층 맞추기", () => {
  const rep = (date: string, text: string) => {
    const { entries, unmatched } = parseWorkText(text)
    return { id: date, siteId: "s", date, status: "pending", rawText: text, entries, unmatched }
  }
  const H = "1. 형틀 공사 (10)\n* 형틀(5)\n"
  it("504동: 「1F 시스템」 앞날 「지상1층 바닥 거푸집」(=B1 사이클)이 있으면 B1F", () => {
    const p = progressFromReports(
      [rep("2026-10-05", H + "- 504동 지상1층 바닥 거푸집설치(4)\n2. 철근 공사 (1)"), rep("2026-10-06", H + "- 504동 1F 시스템 동바리 및 비계 설치,\n2. 철근 공사 (1)")],
      "2026-10-30",
    )
    assert.equal(p.actual.find((a) => a.stage === "SHORING")?.floor, -1)
  })
  it("503동: 「B1F 시스템」 은 아래(B2) 바닥 작업이 없으면 그대로 B1F", () => {
    const p = progressFromReports(
      [rep("2026-10-21", H + "- 503동 1F 바닥 거푸집 설치(10)\n2. 철근 공사 (1)"), rep("2026-10-26", H + "- 503동 B1F 시스템 동바리 설치(7)\n2. 철근 공사 (1)")],
      "2026-10-30",
    )
    assert.equal(p.actual.find((a) => a.stage === "SHORING")?.floor, -1)
  })
})
