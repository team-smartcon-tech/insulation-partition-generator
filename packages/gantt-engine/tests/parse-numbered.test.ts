// 번호 붙은 공사 구간 양식 (남원주역세권 2차 AC5, 2026-10-29 실제 일보 모양) — 지하·저층 골조
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isNumberedFormat, parseWorkText } from "../src/index.ts"

const TEXT = `1. 형틀 공사 (133)
* 형틀(100)
- 현장 관리(8)
- 501동 RF 바닥 거푸집 설치(8)
- 501동 주변 저수조 RF 바닥 거푸집 설치(4)
- 503동 B1F 벽체 및 1F 바닥 거푸집 설치(10)
- 503동 주변주차장 B1F 바닥 거푸집 설치(4)
- 504동 RF 바닥 및 주변 부대시설 벽체 거푸집 설치(11)

* 시스템(7)
- 503동 B1F 시스템 동바리 설치(7)

* 해체/정리(19)
- 502동 B2F 벽체 거푸집 해체 및 정리(19)

* 미장/견출(7)
- 501동~504동 B2F~B3F 벽체 면 보수(7)

2. 철근 공사 (24)
- 현장 관리 및 철근 반입(4)
- 501동 1F 바닥 철근 조립(10)

3. 콘크리트 공사 (1)
- 504동 RF 바닥 타설 (1)

4. 전기 공사 (7)
- 503동 B3F 배선 및 가설등 설치(3)
- 504동 B1F 바닥 박스 설치(2)

6. 설비 공사 (4)
- 504동, 505동 1F 바닥 슬리브 설치(2)

총인원: 171명`

const rows = () =>
  parseWorkText(TEXT).entries.map((e) => [e.buildingNo, e.floorLabel ?? e.floor, e.stage])

describe("번호 양식 해석", () => {
  it("양식 판별: 번호 제목이 있으면 이 양식, 1차 양식은 아니다", () => {
    assert.equal(isNumberedFormat(TEXT), true)
    assert.equal(isNumberedFormat("* 골조(91)\n- 403동: 35F 바닥 먹매김"), false)
  })

  it("거푸집·동바리·해체·철근·타설·기전을 동·층별로", () => {
    assert.deepEqual(rows(), [
      [501, "RF", "FORM_SLAB"],
      [503, -1, "FORM_WALL"],
      [503, -1, "FORM_SLAB"], // 1F 바닥 → B1F 사이클
      [504, "RF", "FORM_SLAB"],
      [503, -1, "SHORING"], // 동바리는 원문 층
      [502, -2, null],
      [501, -1, "SLAB_REBAR"], // 1F 바닥 철근 → B1F
      [504, "RF", "POUR"],
      [504, -2, "SLAB_MEP"], // B1F 바닥 박스 → B2F
      [504, -1, "SLAB_MEP"],
      [505, -1, "SLAB_MEP"],
    ])
  })

  it("「주변 …」 부대시설·현장 관리·미장/견출·배선은 넣지 않는다", () => {
    const e = parseWorkText(TEXT).entries
    assert.ok(!e.some((x) => /주변|부대시설|저수조/.test(x.text)))
    assert.ok(!e.some((x) => /면 보수|배선/.test(x.text)))
  })

  it("동바리는 시스템 동바리만, 해체는 공정 단계 아님", () => {
    const t = (s: string) => parseWorkText(`1. 형틀 공사 (10)
${s}
2. 철근 공사 (1)`).entries.map((e) => e.stage)
    assert.deepEqual(t("* 시스템(7)\n- 503동 B1F 동바리 설치(7)"), ["SHORING"])
    assert.deepEqual(t("* 형틀(7)\n- 503동 B1F 시스템 동바리 설치(7)"), ["SHORING"])
    assert.deepEqual(t("* 형틀(7)\n- 503동 B1F 강관 동바리 설치(7)"), [null])
    assert.deepEqual(t("* 해체/정리(7)\n- 503동 B1F 시스템 동바리 해체(7)"), [null])
  })

  it("바닥은 아래층 사이클: 2F 바닥 → 1F, 1F 바닥 → B1F, B2F 바닥 → B3F", () => {
    const f = (s: string) => parseWorkText(`1. 형틀 공사 (10)
* 형틀(5)
- ${s}(5)
2. 철근 공사 (1)`).entries.map((e) => e.floor)
    assert.deepEqual(f("505동 2F 바닥 거푸집 설치"), [1])
    assert.deepEqual(f("505동 1F 바닥 거푸집 설치"), [-1])
    assert.deepEqual(f("505동 B2F 바닥 거푸집 설치"), [-3])
    assert.deepEqual(f("505동 B2F 벽체 거푸집 설치"), [-2])
  })

  it("타설 구분: 벽체·합벽 W타설, 기둥 C타설, 바닥 S타설(아래층 사이클)", () => {
    const f = (s: string) =>
      parseWorkText(`1. 형틀 공사 (1)\n2. 콘크리트 공사 (5)\n- ${s}(5)`).entries.map((e) => [e.floor, e.stage])
    assert.deepEqual(f("502동 B1F 벽체 및 1F 바닥 타설"), [[-1, "POUR_WALL"], [-1, "POUR"]])
    assert.deepEqual(f("503동 B2F 기둥 타설"), [[-2, "POUR_COLUMN"]])
    assert.deepEqual(f("504동 B1F 합벽 타설"), [[-1, "POUR_WALL"]])
    assert.deepEqual(f("505동 1F 바닥 타설"), [[-1, "POUR"]])
    assert.deepEqual(f("504동 B1F 바닥거푸집 타설대기"), [[-2, null]])
  })

  it("층 표기: 지하1층·지상1층·붙여 쓴 B2F, 거푸집 제작은 설치 아님", () => {
    const f = (s: string) =>
      parseWorkText(`1. 형틀 공사 (10)\n* 형틀(5)\n- ${s}\n2. 철근 공사 (1)`).entries.map((e) => [e.floor, e.stage])
    assert.deepEqual(f("505동 지하1층 벽체 거푸집 설치(12)"), [[-1, "FORM_WALL"]])
    assert.deepEqual(f("504동 지상1층 바닥 거푸집설치(4)"), [[-1, "FORM_SLAB"]]) // 1F 바닥 → B1F
    assert.deepEqual(f("502동: 2동B2F 벽체거푸집 설치 및 스라브거푸집제작 (18)"), [[-2, "FORM_WALL"], [-3, null]])
    assert.deepEqual(f("501동 지하1층 거푸집 제작(20)"), [[-1, null]])
  })

  it("기준층 공종 (화성남양1차 2026-10 일보 모양): 알폼·갱폼 인상·벽체/바닥 철근·바닥 타설", () => {
    const f = (s: string) =>
      parseWorkText(`1. 철근콘크리트공사 (118+2)\n- 형틀 (9)\n\n- ${s}\n2. 견출공사 (7)`).entries.map((e) => [e.floor, e.stage])
    assert.deepEqual(f("104동 6층 알폼 설치"), [[6, "ALFORM"]])
    assert.deepEqual(f("103동 4층 갱폼 인상"), [[4, "GANGFORM"]])
    assert.deepEqual(f("105동 6층 벽체 철근 배근"), [[6, "WALL_REBAR"]])
    assert.deepEqual(f("101동 8층 바닥 철근 배근"), [[7, "SLAB_REBAR"]]) // 8층 바닥 = 7층 천장
    assert.deepEqual(f("106동 5층 바닥 타설"), [[4, "POUR"]])
    assert.deepEqual(f("101동 6층 세대내 알폼 타이 제거"), [[6, null]])
    assert.deepEqual(f("102동 갱폼 소음방지판넬 설치"), [])
  })

  it("「및」 구문은 각자 층과 벽/바닥, 공종 동사는 공유", () => {
    const e = parseWorkText(TEXT).entries.filter((x) => x.buildingNo === 503 && x.stage?.startsWith("FORM"))
    assert.deepEqual(e.map((x) => x.text), ["벽체 거푸집 설치", "슬래브 거푸집 설치 (원문 1F 바닥)"])
  })
})

describe("● 제목 양식 (평택고덕P1 1차 2026-10-30 일보 모양)", () => {
  const TEXT = `▣ 주요작업사항 (2026. 10. 30. 금, 날씨 : 흐림, 8~19℃)
총 인원 : 172 명

● 철근콘크리트공사 (124)
-  3606동 B2F 거푸집 하부마감
- 3611동 주변주차장 B1F 외벽 거푸집 마감, 3611동 주변주차장 RF 보 거푸집 설치, 3605동 B1F 벽체 거푸집 설치
- 3604동 B1F DH보 설치
- 3610-3611동 사이 기초 철근 배근, 3606동 B1F 슬래브 철근 배근, 3602동 주변주차장 기초 철근 배근, 3611동 1F 보 철근 배근, 3609동 기초 철근 배근
- 3608동 B1F 벽체 철근 배근
- 3608동 B1F 외부 비계 설치

● 파일항타 (12)
- 3601동, 3608동, 3609동 주변 주차장 터파기

* 장비 : 공기압축기(21.m) 1대, B/H(06w) 2대

● 토공사 (7)`
  const rows = () => parseWorkText(TEXT).entries.filter((e) => e.stage).map((e) => [e.buildingNo, e.floor, e.stage])

  it("● 철근콘크리트공사 를 골조로 읽고, 쉼표로 이어 쓴 동을 나눈다", () => {
    assert.equal(isNumberedFormat(TEXT), true)
    assert.deepEqual(rows(), [
      [3605, -1, "FORM_WALL"],
      [3606, -2, "SLAB_REBAR"], // B1F 슬래브 = B2 천장
      [3608, -1, "WALL_REBAR"],
    ])
  })
  it("주변주차장·두 동 사이·파일항타 구간은 넣지 않는다", () => {
    const e = parseWorkText(TEXT).entries
    assert.ok(!e.some((x) => /주변|사이|터파기/.test(x.text)))
    assert.ok(!e.some((x) => x.buildingNo === 3610 || x.buildingNo === 3601))
  })
  it("동 번호만 있는 쉼표 조각은 다음 조각과 붙인다 (504동, 505동 1F 바닥 슬리브)", () => {
    const e = parseWorkText("1. 형틀 공사 (1)\n6. 설비 공사 (4)\n- 504동, 505동 1F 바닥 슬리브 설치(2)").entries
    assert.deepEqual(e.map((x) => x.buildingNo), [504, 505])
  })
})

describe("옥탑·담당 범위 (부산장안 2026-10 일보 모양)", () => {
  const f = (line: string) =>
    parseWorkText(`▶ 철근콘크리트공사(38명)\n- ${line}\n▶ 내장공사(15명)\n- 101동 11~15층 천정`).entries.map((e) => [e.buildingNo, e.floorLabel ?? e.floor, e.stage])
  it("「옥탑 RF 바닥 타설」 → 옥탑RF S타설 (일반 층·아래 층 규칙 아님)", () => {
    assert.deepEqual(f("101동 옥탑 RF 바닥 타설(3명)"), [[101, "옥탑RF", "POUR"]])
  })
  it("「1코어 옥탑 2층 벽체 거푸집 해체정리」 → 옥탑2층 (해체라 공정 아님)", () => {
    assert.deepEqual(f("102동 1코어 옥탑 2층 벽체 거푸집 해체정리"), [[102, "옥탑2층", null]])
  })
  it("「옥탑 벽체 철근 배근」 → 옥탑 W철근", () => {
    assert.deepEqual(f("101동 옥탑 벽체 철근 배근(2명)"), [[101, "옥탑", "WALL_REBAR"]])
  })
  it("담당 범위 목록 뒤 「골조 : 102동 …」 은 102동만", () => {
    const e = parseWorkText(
      "▶ 철근콘크리트공사(3명)\n- 0동 관리\n▶ 전기공사(5명)\n- 101동, 102동, 103동, 104동, 지하주차장, 공용부: 골조 : 102동 2코어 옥탑 벽체 배관, 입선작업",
    ).entries
    assert.deepEqual(e.map((x) => [x.buildingNo, x.floorLabel ?? x.floor, x.stage]), [[102, "옥탑", "WALL_MEP"]])
  })
  it("「항목 : 내용」 이 이어진 줄은 「골조 :」 부분만 (부산장안 10/14 원문)", () => {
    const e = parseWorkText(
      "▶ 철근콘크리트공사(3명)\n- 0동 관리\n▶ 전기배관배선공사(1)\n  - 101동,102동,103동,104동,지하주차장,: 골조 : 102동 옥탑1층 슬라브배관 입선 : 102동 단위세대 전기입선, 통신입선작업 분전반설치: PK 분전반속판 설치 (1)",
    ).entries
    assert.deepEqual(e.map((x) => [x.buildingNo, x.floorLabel ?? x.floor, x.stage]), [[102, "옥탑1층", "SLAB_MEP"]])
  })
})
