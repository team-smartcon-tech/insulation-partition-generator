// 작업일보 마감 줄 → 일보 작업 막대 (부산장안 2026-10 일보 모양)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildFinishReportBars, parseFinishReport } from "../src/index.ts"

const top = (no: number) => ({ 101: 24, 102: 24, 103: 25, 104: 23 })[no] ?? null
const TEXT = `▶ 철근콘크리트공사(38명)
     - 101동 옥탑 RF 바닥 타설(3명)
▶ 내장공사(15명)
     - 101동, 102동 11~15층 천정
     - 101동, 102동 16~20층 경량틀
     - 102동 1코어 16~20층 단열재
     - 104동 1코어 21~23층 합지
     - 26-30F 단열재 양중
▶ 방수공사(11명)
     - 103동, 104동 21~최상층 화장실 1차 우레탄
▶ 습식공사(14명)
     - 102동 1차 방통 타설
     - 101동 11~15층 세대 사춤
▶ PL창호공사(9명)
     - 101동 21~24층 PL창틀 시공
▶ 전기공사(3명)
     - 101동 11~15층 천정 배관`

describe("일보 마감 줄 해석", () => {
  const it2 = parseFinishReport(TEXT, top).map((x) => [x.buildingNo, x.trade, x.floorFrom, x.floorTo])
  it("동 목록·층 범위·공종, 골조·전기 구간과 양중은 뺀다", () => {
    assert.deepEqual(it2, [
      [101, "ceilingGypsum", 11, 15],
      [102, "ceilingGypsum", 11, 15],
      [101, "lightWall", 16, 20],
      [102, "lightWall", 16, 20],
      [102, "insulation", 16, 20],
      [104, "wallpaper", 21, 23],
      [101, "windowFrame", 21, 24],
    ])
  })
  it("「~최상층」 은 동 최상층으로", () => {
    const r = parseFinishReport("● 내장공사 (3)\n- 103동 21~최상층 경량틀", top)
    assert.deepEqual(r.map((x) => [x.floorFrom, x.floorTo]), [[21, 25]])
  })
  it("1차 양식(* 내장, 「동: 층 공종 / 층 공종」)", () => {
    const r = parseFinishReport("* 골조(91)\n- 402동: 38F 1-2호 단열재 설치\n* 내장(39)\n- 403동: 12F 1-3호 경량석고 / 24F 1-3호 단열재", top)
    assert.deepEqual(r.map((x) => [x.buildingNo, x.trade, x.floorFrom]), [[403, "wallGypsum", 12], [403, "insulation", 24]])
  })
})

describe("일보 작업 막대", () => {
  it("같은 동·공종·층 범위가 3일 안에 이어지면 하나", () => {
    const rows = buildFinishReportBars(
      [
        { date: "2026-10-26", rawText: "▶ 내장공사(1)\n - 101동 16~20층 경량틀" },
        { date: "2026-10-27", rawText: "▶ 내장공사(1)\n - 101동 16~20층 경량틀" },
        { date: "2026-10-29", rawText: "▶ 내장공사(1)\n - 101동 16~20층 경량틀\n - 101동 21~24층 경량틀" },
      ],
      top,
    )
    assert.deepEqual(rows[0].bars.map((b) => [b.floorFrom, b.floorTo, b.start, b.end, b.days]), [
      [16, 20, "2026-10-26", "2026-10-29", 3],
      [21, 24, "2026-10-29", "2026-10-29", 1],
    ])
  })
})

describe("마감 줄 코어", () => {
  it("「1코어」「1, 2코어」 는 그 코어만, 없으면 동 전체(null)", () => {
    const text = "▶ 내장공사(15명)\n- 102동 1코어 16~20층 단열재\n- 103동 1, 2코어 5~6층 천정\n- 104동 7층 경량"
    assert.deepEqual(
      parseFinishReport(text, () => 30).map((x) => [x.buildingNo, x.trade, x.core, x.floorFrom, x.floorTo]),
      [
        [102, "insulation", 1, 16, 20],
        [103, "ceilingGypsum", 1, 5, 6],
        [103, "ceilingGypsum", 2, 5, 6],
        [104, "lightWall", null, 7, 7],
      ],
    )
  })
})
