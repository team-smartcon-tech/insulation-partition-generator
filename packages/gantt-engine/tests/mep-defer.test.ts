// 배근과 같은 날 적힌 기전이 다음 일보에도 이어지면 기전은 다음 날로 본다 (2026-10-30 사용자 확인, 403동 10/2·10/3 실제 일보)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseWorkText, progressFromReports, type DailyReport } from "../src/index.ts"

const report = (date: string, text: string): DailyReport => {
  const { entries, unmatched } = parseWorkText(text)
  return { id: date, siteId: "s", date, status: "pending", rawText: text, entries, unmatched }
}

describe("배근 뒤 기전 이월", () => {
  it("다음 일보에도 기전이 있으면 배근 날 기전은 뺀다", () => {
    const p = progressFromReports(
      [
        report("2026-10-02", "* 골조(91)\n- 403동: 35F 바닥 먹매김 / 35F 갱폼인양 / 35F 벽체 철근배근\n* 전기(20)\n- 403동 34F 벽체 배관작업"),
        report("2026-10-03", "* 골조(83)\n* 전기(18)\n- 403동 34F 벽체 배관작업"),
      ],
      "2026-10-30",
    )
    const day = (d: string) => p.actual.filter((a) => a.date === d).map((a) => a.stage)
    assert.deepEqual(day("2026-10-02"), ["MARK", "GANGFORM", "WALL_REBAR"])
    assert.deepEqual(day("2026-10-03"), ["WALL_MEP"])
  })

  it("그날로 끝나는 기전은 배근과 같은 날 그대로", () => {
    const p = progressFromReports(
      [
        report("2026-10-10", "* 골조(90)\n- 403동: 35F 갱폼인양 / 35F 벽체 철근배근\n* 전기(20)\n- 403동 35F 벽체 배관작업"),
        report("2026-10-12", "* 골조(90)\n- 403동: 36F 바닥 알폼조립"),
      ],
      "2026-10-30",
    )
    assert.ok(p.actual.some((a) => a.date === "2026-10-10" && a.stage === "WALL_MEP"))
  })
})

describe("순서 밖 기전 제외", () => {
  // 402동 2026-10-15~22 실제 일보 모양 (36F 타설 → 37F 사이클)
  const reports = [
    report("2026-10-15", "* 골조(90)\n- 402동: 36F 바닥 철근배근"),
    report("2026-10-16", "* 골조(90)\n- 402동: 36F 바닥 타설"),
    report("2026-10-19", "* 골조(90)\n- 402동: 37F 벽체 철근배근\n* 전기(20)\n- 402동 37F 벽체 배관작업"),
    report("2026-10-20", "* 골조(98)\n- 402동: 37F 바닥 알폼설치\n* 전기(22)\n- 402동 37F 바닥 배관작업 / 지하주차장 B3 몰드바 바디 설치 작업"),
    report("2026-10-21", "* 골조(98)\n- 402동: 37F 바닥 철근배근\n* 전기(22)\n- 402동 37F 바닥 배관작업"),
    report("2026-10-22", "* 골조(98)\n- 402동: 37F 바닥 타설\n* 전기(22)\n- 402동 37F 바닥 배관작업"),
  ]
  const p = progressFromReports(reports, "2026-10-30")
  const day = (d: string) => p.actual.filter((a) => a.date === d).map((a) => a.stage)

  it("알폼 날 바닥 배관(선행)은 뺀다", () => assert.deepEqual(day("2026-10-20"), ["ALFORM"]))
  it("S철근 날 바닥 배관은 남긴다", () => assert.deepEqual(day("2026-10-21"), ["SLAB_REBAR", "SLAB_MEP"]))
  it("타설 날 바닥 배관(마무리)은 뺀다", () => assert.deepEqual(day("2026-10-22"), ["POUR"]))
  it("W철근 날 벽 배관은 남긴다", () => assert.deepEqual(day("2026-10-19"), ["WALL_REBAR", "WALL_MEP"]))

  it("알폼 날이 마지막 일보여도 다음 단계는 S철근 (기전 때문에 타설로 건너뛰지 않음)", () => {
    const q = progressFromReports(reports.slice(0, 4), "2026-10-20")
    assert.equal(q.initial.find((b) => b.id === 402)?.stage, "SLAB_REBAR")
  })
})
