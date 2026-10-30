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
      [503, 1, "FORM_SLAB"],
      [504, "RF", "FORM_SLAB"],
      [503, -1, "SHORING"],
      [502, -2, null],
      [501, 1, "SLAB_REBAR"],
      [504, "RF", "POUR"],
      [504, -1, "SLAB_MEP"],
      [504, 1, "SLAB_MEP"],
      [505, 1, "SLAB_MEP"],
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

  it("「및」 구문은 각자 층과 벽/바닥, 공종 동사는 공유", () => {
    const e = parseWorkText(TEXT).entries.filter((x) => x.buildingNo === 503 && x.stage?.startsWith("FORM"))
    assert.deepEqual(e.map((x) => x.text), ["벽체 거푸집 설치", "바닥 거푸집 설치"])
  })
})
