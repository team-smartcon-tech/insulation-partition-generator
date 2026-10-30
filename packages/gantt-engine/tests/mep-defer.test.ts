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
