// 스마트웍스 동/라인 → 코어 (2026-10-30 사용자 확인 규칙: 2세대마다 1코어, 높은 세대까지)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildingNoOf, groupLinesToCores } from "../src/index.ts"

describe("라인 → 코어 (2라인 = 1코어, 높이는 둘 중 높은 쪽)", () => {
  it("화성남양1차 101동: 5·6호 높이가 달라도 높은 5호까지 3코어", () => {
    assert.deepEqual(groupLinesToCores([18, 18, 21, 21, 17, 16]), [18, 21, 17])
  })
  it("남원주 2차 501동: 35,35,39,39,37,37 → 3코어", () => {
    assert.deepEqual(groupLinesToCores([35, 35, 39, 39, 37, 37]), [35, 39, 37])
  })
  it("같은 높이 코어가 이웃해도 따로 센다 (화성 101동 4라인 24층 → 2코어)", () => {
    assert.deepEqual(groupLinesToCores([24, 24, 24, 24]), [24, 24])
  })
  it("라인 수가 홀수면 마지막 라인 혼자 1코어 (남원주 1차 401동 42,42,42,37,37)", () => {
    assert.deepEqual(groupLinesToCores([42, 42, 42, 37, 37]), [42, 42, 37])
  })
  it("동 번호", () => {
    assert.equal(buildingNoOf("501동"), 501)
    assert.equal(buildingNoOf("근생동"), null)
  })
})
