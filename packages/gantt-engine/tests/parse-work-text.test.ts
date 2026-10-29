// 작업일보 글 해석 (스마트웍스 남원주역세권 1차 2026-10-28 모양)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { extractSections, parseWorkText, stageOf } from "../src/index.ts"

const SAMPLE = `* 골조(97)
- 401동: 38F 바닥 먹매김 / 38F 갱폼인양
- 402동: 38F 1-2호 단열재 설치
- 403동: 38F 바닥 타설
- 404동: 37F 벽체 철근배관
- 405동: 37F 바닥 알폼설치
- 부대시설: 근생#2 2F 기둥 벽체철근 조립

* 내장(38)
- 401동: 2F 1-3호 천정석고

* 전기(24)
- 401동 38F 벽체 배관작업 / 405동 37F 바닥 배관작업 / 근생#2 2F 벽체 배관작업

* 기계 설비(18)
- 401동 38F 벽체 배관 설치 / 402동 38F 바닥 이중관 설치 / 지하주차장 B4F 전기실 및 펌프실 덕트설치`

describe("구간 추출", () => {
  it("골조·전기·기계 설비만 읽는다", () => {
    const s = extractSections(SAMPLE)
    assert.equal(s.filter((x) => x.section === "structure").length, 6)
    assert.equal(s.filter((x) => x.section === "electric").length, 1)
    assert.equal(s.filter((x) => x.section === "mechanical").length, 1)
    assert.ok(!s.some((x) => x.line.includes("천정석고")))
  })
})

describe("작업 문구 → 단계", () => {
  const cases: [string, string | null][] = [
    ["바닥 먹매김", "MARK"],
    ["갱폼인양", "GANGFORM"],
    ["바닥 타설", "POUR"],
    ["바닥 알폼설치", "ALFORM"],
    ["1-2호 단열재 설치", "TOP_INSULATION"],
    ["벽체 철근배관", "WALL_REBAR"],
    ["바닥 철근배근", "SLAB_REBAR"],
    ["기둥 벽체철근 조립", "WALL_REBAR"],
    ["지하주차장 데크 해체", null],
  ]
  for (const [text, stage] of cases) {
    it(`골조: ${text} → ${stage}`, () => assert.equal(stageOf(text, "structure"), stage))
  }
  it("전기·설비: 벽체 배관 → WALL_MEP, 바닥 이중관 → SLAB_MEP, 덕트 → null", () => {
    assert.equal(stageOf("벽체 배관작업", "electric"), "WALL_MEP")
    assert.equal(stageOf("바닥 이중관 설치", "mechanical"), "SLAB_MEP")
    assert.equal(stageOf("전기실 및 펌프실 덕트설치", "mechanical"), null)
  })
})

describe("parseWorkText", () => {
  const { entries, unmatched } = parseWorkText(SAMPLE)
  const find = (building: string, text: string) =>
    entries.find((e) => e.building === building && e.text === text)

  it("골조: 동·층·작업·단계", () => {
    assert.deepEqual(find("401동", "바닥 먹매김"), {
      building: "401동",
      buildingNo: 401,
      floor: 38,
      text: "바닥 먹매김",
      stage: "MARK",
    })
    assert.equal(find("403동", "바닥 타설")?.stage, "POUR")
    assert.equal(find("402동", "1-2호 단열재 설치")?.stage, "TOP_INSULATION")
  })
  it("전기·설비: 동이 작업마다 붙은 줄도 읽고 기전 단계로", () => {
    assert.equal(find("401동", "벽체 배관작업")?.stage, "WALL_MEP")
    assert.equal(find("402동", "바닥 이중관 설치")?.stage, "SLAB_MEP")
    assert.ok(!entries.some((e) => e.text.includes("덕트")))
  })
  it("부대시설은 동 번호 없음, 못 읽은 줄 없음", () => {
    assert.equal(entries.find((e) => e.building === "부대시설")?.buildingNo, null)
    assert.deepEqual(unmatched, [])
  })
})
