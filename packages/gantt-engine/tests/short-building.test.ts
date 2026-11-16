// 부산장안 골조 일보 (2026-04~09 실제 모양): 「1동」 = 101동, 「형틀+철근 : … , 기타 : … , 마감 : …」, 「+」 로 이어 쓴 동, 층 없는 줄
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { expandShortBuildingNos, parseWorkText, progressFromReports, sectionOf, type DailyReport } from "../src/index.ts"

const NOS = [101, 102, 103, 104]
const rows = (text: string) =>
  parseWorkText(text, { buildingNos: NOS })
    .entries.filter((e) => e.stage)
    .map((e) => [e.buildingNo, e.floorLabel ?? e.floor, e.stage])
const frame = (line: string) => rows(`● 철근콘크리트공사 (71)\n[에이치이엔씨] (71)\n- ${line}\n● 전기공사 (16)\n- 1. 도면 검토`)

describe("줄여 쓴 동 번호", () => {
  it("동 목록 끝 두 자리로 푼다 (1동·04동·1~4동·101,2동)", () => {
    assert.equal(expandShortBuildingNos("1동 갱폼 / 04동 10층 / 1~4동 손보기 / 101,2동", NOS), "101동 갱폼 / 104동 10층 / 101~104동 손보기 / 101,102동")
  })
  it("목록에 그 번호 동이 있거나 둘 이상 맞으면 그대로", () => {
    assert.equal(expandShortBuildingNos("1동 갱폼", [1, 2, 101]), "1동 갱폼")
    assert.equal(expandShortBuildingNos("1동 갱폼", [101, 201]), "1동 갱폼")
    assert.equal(expandShortBuildingNos("1동 갱폼", []), "1동 갱폼")
  })
  it("동 목록 없이 읽으면 예전처럼 안 읽힌다", () => {
    assert.deepEqual(parseWorkText("● 철근콘크리트공사 (1)\n- 1동 13층 알폼 조립\n● 전기공사 (1)").entries.filter((e) => e.stage), [])
  })
})

describe("골조 공사 제목 (2026-11-05 사용자: 형틀·철근·콘크리트 공사도 골조)", () => {
  it("* 양식 제목도 형틀·철근·콘크리트를 골조로", () => {
    for (const h of ["골조", "철근콘크리트공사", "형틀공사", "철근", "콘크리트 공사", "거푸집"]) assert.equal(sectionOf(h), "structure", h)
    assert.equal(sectionOf("가설전기"), "electric")
    assert.equal(sectionOf("기계설비공사"), "mechanical")
    assert.equal(sectionOf("설비공사"), "mechanical")
  })
})

describe("부산장안 골조 줄", () => {
  it("「형틀+철근 : … , 기타 : … , 마감 : …」 — 마감 항목은 빼고, 「+」 로 이은 동을 나눈다", () => {
    assert.deepEqual(
      frame("형틀+철근 : 4동 갱폼인양+3동 알폼조립 / 1동 철근 작업준비, 기타 : 1동지하1층 해체정리 / 2동 6층바닥 타설, 마감 : 지하+1동~3동 활석 / 3동 세대청소"),
      [
        [104, null, "GANGFORM"],
        [103, null, "ALFORM"],
        [102, 5, "POUR"], // 6층 바닥 = 5층 사이클
      ],
    )
  })
  it("「+」 앞 조각은 뒤 조각의 동사를 빌린다", () => {
    assert.deepEqual(frame("형틀+철근 : 1동 갱폼인양 / 3동 바닥+4동벽체철근"), [
      [101, null, "GANGFORM"],
      [103, null, "SLAB_REBAR"],
      [104, null, "WALL_REBAR"],
    ])
    assert.deepEqual(frame("1동13층벽체+3동25층바닥철근, 주민시설거푸집해체정리"), [
      [101, 13, "WALL_REBAR"],
      [103, 24, "SLAB_REBAR"],
    ])
  })
  it("「철근 :」 항목은 철근 공사, 인원 (117) 은 지운다", () => {
    assert.deepEqual(frame("형틀 : 4동 갱폼인양+알폼해체 / 2동 알폼조립 (117), 철근 : 4동 12층 벽체 (117), 마감 : 2동 세대청소 (117)"), [
      [104, null, "GANGFORM"],
      [102, null, "ALFORM"],
      [104, 12, "WALL_REBAR"],
    ])
  })
  it("「벽체조립」 「바닥조립」 = 철근, 「갱폼설치」 = 갱폼 인양, 옆 시설(주차장지붕)은 뺀다", () => {
    assert.deepEqual(frame("2동22층벽체조립"), [[102, 22, "WALL_REBAR"]])
    assert.deepEqual(frame("1동23층바닥조립"), [[101, 22, "SLAB_REBAR"]])
    assert.deepEqual(frame("1동 19층 갱폼 설치"), [[101, 19, "GANGFORM"]])
    assert.deepEqual(frame("1동 갱폼수정"), [])
    assert.deepEqual(frame("기타 : 3동 16층 바닥 + 1동 주차장지붕 누름타설"), [[103, 15, "POUR"]])
  })
  it("지하·저층의 「벽체 조립」 은 거푸집 (울산다운3차), 「철근콘크리공사」 오타 제목의 거푸집은 철근 아님 (평택고덕)", () => {
    assert.deepEqual(frame("4동 B1F 벽체 조립 5"), [[104, -1, "FORM_WALL"]])
    assert.deepEqual(rows("● 철근콘크리공사 (75)\n- 104동 B1F 벽체 거푸집 설치\n● 전기공사 (6)\n- x"), [[104, -1, "FORM_WALL"]])  })
  it("인원 0·없음 인 줄은 그날 안 한 작업", () => {
    assert.deepEqual(frame("101동 15층 갱폼 점검 및 타설 관리(0)"), [])
    assert.deepEqual(frame("102동 17층 알폼 조립설치(없음)"), [])
  })
  it("기계설비 「1, 2동 건식벽체 수전구」 → 101·102동 W기전", () => {
    const e = rows("● 철근콘크리트공사 (1)\n▶ 기계설비공사(10)\n- 101,2동: 1, 2동 건식벽체 수전구, 2동 오배수입상 (7)")
    assert.ok(e.some(([b, , s]) => b === 101 && s === "WALL_MEP"))
  })
})

describe("층 없는 골조 줄 → 앞 실적에서 층을 잇는다", () => {
  const rep = (date: string, line: string): DailyReport => {
    const text = `● 철근콘크리트공사 (1)\n- ${line}\n● 전기공사 (1)\n- x`
    const { entries, unmatched } = parseWorkText(text, { buildingNos: NOS })
    return { id: date, siteId: "s", date, status: "pending", rawText: text, entries, unmatched }
  }
  const run = (...rs: DailyReport[]) =>
    progressFromReports(rs, "2026-12-31").actual.map((a) => `${a.date.slice(5)} ${a.buildingId} ${a.floorLabel ?? a.floor} ${a.stage}`)

  it("타설 뒤 갱폼은 다음 층, 그 전은 같은 층", () => {
    assert.deepEqual(run(rep("2026-04-01", "2동 6층바닥 타설"), rep("2026-04-03", "2동 갱폼인양"), rep("2026-04-06", "2동 알폼조립")), [
      "04-01 102 5 POUR",
      "04-03 102 6 GANGFORM",
      "04-06 102 6 ALFORM",
    ])
  })
  it("타설 일보가 빠져도 S철근 뒤 다른 날 갱폼이면 다음 층", () => {
    assert.deepEqual(run(rep("2026-04-01", "4동 12층 벽체철근"), rep("2026-04-02", "4동 바닥철근"), rep("2026-04-04", "4동 갱폼인양")), [
      "04-01 104 12 WALL_REBAR",
      "04-02 104 12 SLAB_REBAR",
      "04-04 104 13 GANGFORM",
    ])
  })
  it("앞에 층 실적이 없으면 공종만 적힌 줄은 뺀다 (벽/바닥이 있는 줄은 「층?」 그대로)", () => {
    assert.deepEqual(run(rep("2026-04-03", "2동 갱폼인양")), [])
    assert.deepEqual(run(rep("2026-04-03", "2동 바닥철근")), ["04-03 102 층? SLAB_REBAR"])
  })
  it("다른 말이 붙은 층 없는 줄은 기준층 공종이 아니다 (기초 타설·램프 타설·설치 전 준비)", () => {
    assert.deepEqual(frame("3611동 기초 타설, 3604동 버림 타설 (21)"), [])
    assert.deepEqual(frame("110동, 112동 장애인 램프 타설"), [])
    assert.deepEqual(frame("107동 1F 갱폼 설치 전 준비(2)"), [])
    assert.deepEqual(frame("103동 갱폼 인상 작업"), [[103, null, "GANGFORM"]])
  })
})
