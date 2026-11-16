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

describe("옥탑·층 없는 기전도 배근 뒤에만", () => {
  // 남원주역세권 1차 401동 2026-10-29~11-05 일보 모양 (2026-11-05 사용자: W철근 전 W기전은 걸러야). 공종 수 규칙과 따로 보려고 설비 한 구간만
  const p = progressFromReports(
    [
      report("2026-10-29", "* 골조(90)\n- 401동: 38F 벽체 철근배근\n* 설비(10)\n- 401동 38F 벽체 배관작업"),
      report("2026-10-31", "* 골조(90)\n- 401동: 38F 알폼 설치"),
      report("2026-11-03", "* 골조(90)\n- 401동: 39F 1-3호 바닥 타설"),
      report("2026-11-04", "* 골조(90)\n- 401동: 39F 갱폼인양 / 39F 바닥 먹메김\n* 설비(10)\n- 401동 3-5호 옥탑 벽체 배관작업 / 402동 28F 벽체 배관작업"),
      report("2026-11-05", "* 골조(90)\n- 401동: 39F 벽체 철근배근\n* 설비(10)\n- 401동 39F 벽체 배관작업"),
    ],
    "2026-11-05",
  )
  const day = (d: string) => p.actual.filter((a) => a.date === d && a.buildingId === 401).map((a) => a.stage)
  it("알폼 뒤·W철근 전 옥탑 벽체 배관은 뺀다", () => assert.ok(!day("2026-11-04").includes("WALL_MEP")))
  it("39F W철근 날 벽 배관은 남긴다", () => assert.deepEqual(day("2026-11-05"), ["WALL_REBAR", "WALL_MEP"]))
})

describe("기전은 두 공종 이상 적어야 (2026-11-05 사용자)", () => {
  // 직전 날 W철근이 있어 순서 규칙으로는 둘 다 기전 창 안
  const base = report("2026-11-05", "* 골조(90)\n- 401동: 39F 벽체 철근배근\n- 402동: 38F 벽체 철근배근")
  const mep = (text: string) =>
    progressFromReports([base, report("2026-11-06", text)], "2026-11-06").actual.filter((a) => a.date === "2026-11-06")

  it("남원주 11/4 모양: 전기만 적은 401동은 빼고, 세 공종 적은 402동은 남긴다", () => {
    const a = mep(
      "* 전기(22)\n- 401동 39F 벽체 배관작업 / 402동 38F 벽체 배관작업\n" +
        "* 기계 설비(18)\n- 402동 38F 벽체 수전구 설치 / 지하주차장 B4F 전기실 및 펌프실 덕트설치\n" +
        "* 소방(20)\n- 402동 38F 벽체 BOX취부 및 CD관 매립배관",
    )
    assert.deepEqual(a.map((x) => `${x.buildingId} ${x.stage}`), ["402 WALL_MEP", "402 WALL_MEP", "402 WALL_MEP"])
  })
  it("그날 기전을 적은 공종이 하나뿐인 일보는 예전처럼 둔다", () => {
    assert.deepEqual(mep("* 전기(20)\n- 401동 39F 벽체 배관작업").map((x) => x.buildingId), [401])
  })
  it("소방 구간도 읽는다", () => {
    const e = parseWorkText("* 소방(20)\n- 401동 39F 벽체 BOX취부 및 CD관 매립배관").entries
    assert.deepEqual(e.map((x) => [x.stage, x.trade]), [["WALL_MEP", "fire"]])
  })
})
