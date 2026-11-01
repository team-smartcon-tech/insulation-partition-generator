// 마감 공종 택트 인원 계산 (2026-10-31) — 명세의 기본값 검증표
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_TAKT_INPUT, FINISH_TRADES, computeTakt, parseBuildingFloors, taktForDeadline, validateTaktInput, type TaktInput } from "../src/index.ts"

// 명세(2026-10-31 택트 프롬프트) 그대로의 입력 — 9개 공종, 방통도 인원 산정. 화면 기본값(DEFAULT_TAKT_INPUT)은 공종 14개로 바뀌어 따로 본다
const SPEC: TaktInput = {
  unitsPerFloor: 4,
  zoneFloors: 5,
  taktDays: 10,
  buildingFloors: [20, 20, 25, 15, 18],
  trades: [
    { stage: 1, name: "단열재부착", unit: "㎡", qtyPerUnit: 70, productivity: 25, waitDays: 0 },
    { stage: 2, name: "경량벽체 틀", unit: "㎡", qtyPerUnit: 60, productivity: 30, waitDays: 0 },
    { stage: 3, name: "경량벽체 석고", unit: "㎡", qtyPerUnit: 120, productivity: 35, waitDays: 0 },
    { stage: 4, name: "합지", unit: "㎡", qtyPerUnit: 300, productivity: 60, waitDays: 0 },
    { stage: 5, name: "방수", unit: "㎡", qtyPerUnit: 25, productivity: 20, waitDays: 2 },
    { stage: 6, name: "방통", unit: "㎡", qtyPerUnit: 70, productivity: 50, waitDays: 5 },
    { stage: 7, name: "타일", unit: "㎡", qtyPerUnit: 60, productivity: 12, waitDays: 0 },
    { stage: 7, name: "천장", unit: "㎡", qtyPerUnit: 90, productivity: 25, waitDays: 0 },
    { stage: 8, name: "가구", unit: "세대", qtyPerUnit: 1, productivity: 0.5, waitDays: 0 },
  ],
}

describe("택트 인원 계산", () => {
  const r = computeTakt(SPEC)
  const row = (name: string) => {
    const i = SPEC.trades.findIndex((t) => t.name === name)
    const t = r.trades[i]
    return [Number(t.manDays.toFixed(1)), t.crew, Math.round(t.utilization * 100)]
  }
  it("공종별 구간 인·일 · 필요 인원 · 가동률", () => {
    assert.deepEqual(row("단열재부착"), [56.0, 6, 93])
    assert.deepEqual(row("경량벽체 틀"), [40.0, 4, 100])
    assert.deepEqual(row("경량벽체 석고"), [68.6, 7, 98])
    assert.deepEqual(row("합지"), [100.0, 10, 100])
    assert.deepEqual(row("방수"), [25.0, 3, 83])
    assert.deepEqual(row("방통"), [28.0, 3, 93])
    assert.deepEqual(row("타일"), [100.0, 10, 100])
    assert.deepEqual(row("천장"), [72.0, 8, 90])
    assert.deepEqual(row("가구"), [40.0, 4, 100])
  })
  it("총 구간 20 · 동시 투입 55명 · 전체 277 작업일 (단계 8 오프셋 77)", () => {
    assert.equal(r.totalZones, 20)
    assert.equal(r.crewTotal, 55)
    assert.equal(r.stages.at(-1)!.offset, 77)
    assert.equal(r.totalDays, 277)
  })
  it("같은 단계 공종은 같은 오프셋, 후속 대기일은 그 단계의 가장 긴 값", () => {
    const tile = SPEC.trades.findIndex((t) => t.name === "타일")
    const ceil = SPEC.trades.findIndex((t) => t.name === "천장")
    assert.equal(r.trades[tile].offset, r.trades[ceil].offset)
    const two = computeTakt({
      ...SPEC,
      trades: [
        { stage: 1, name: "A", unit: "㎡", qtyPerUnit: 1, productivity: 1, waitDays: 2 },
        { stage: 1, name: "B", unit: "㎡", qtyPerUnit: 1, productivity: 1, waitDays: 5 },
        { stage: 2, name: "C", unit: "㎡", qtyPerUnit: 1, productivity: 1, waitDays: 0 },
      ],
    })
    assert.equal(two.stages[1].offset, 10 + 5)
  })
  it("물량이 아주 적어도 필요 인원은 최소 1명", () => {
    const one = computeTakt({ ...SPEC, trades: [{ stage: 1, name: "A", unit: "㎡", qtyPerUnit: 0.1, productivity: 100, waitDays: 0 }] })
    assert.equal(one.trades[0].crew, 1)
  })
  it("입력 검사: 0 이하·빈 값은 그 칸 오류, 후속 대기일 0 은 정상", () => {
    assert.deepEqual(validateTaktInput(SPEC), {})
    const bad = validateTaktInput({
      ...SPEC,
      taktDays: 0,
      unitsPerFloor: Number.NaN,
      trades: [{ stage: 1, name: "", unit: "㎡", qtyPerUnit: -1, productivity: 0, waitDays: -1 }],
    })
    assert.deepEqual(Object.keys(bad).sort(), [
      "taktDays",
      "trades.0.name",
      "trades.0.productivity",
      "trades.0.qtyPerUnit",
      "trades.0.waitDays",
      "unitsPerFloor",
    ])
  })
  it("동별 층수 읽기", () => {
    assert.deepEqual(parseBuildingFloors("20,20, 25 ,15,18"), [20, 20, 25, 15, 18])
    assert.equal(parseBuildingFloors("20,,0"), null)
    assert.equal(parseBuildingFloors("20,a"), null)
    assert.equal(parseBuildingFloors(""), null)
  })
  it("인원 직접 지정: 공종마다 제 속도 — 빠르면 앞서 나가고, 느리면 뒤 공종이 그 구간마다 기다린다", () => {
    const withCrew = (crew: number) =>
      computeTakt({ ...SPEC, trades: SPEC.trades.map((t, i) => (i === 0 ? { ...t, crew } : t)) })
    // 단열재 8명: 56 ÷ 8 = 7일/구간 → 140일에 다 끝내고 빠진다(가동률 100%). 경량벽체 틀은 7일에 시작 → 뒤 공종 모두 3일 당겨져 274일
    const up = withCrew(8)
    assert.deepEqual([up.trades[0].zoneDays, up.trades[0].zones.at(-1)!.finish, Math.round(up.trades[0].utilization * 100), up.trades[1].offset, up.totalDays, up.crewTotal], [7, 140, 100, 7, 274, 57])
    assert.equal(up.trades[0].autoCrew, 6)
    // 단열재 4명: 14일/구간(병목). 경량벽체 틀(10일)은 구간마다 단열재를 기다려 14일 간격: 착수 14, 28, …  → 4일씩 19번 = 76일 대기
    const down = withCrew(4)
    assert.deepEqual([down.trades[0].bottleneck, down.effectiveTakt, down.trades[1].zones[1].start, down.trades[1].waitIdle], [true, 14, 28, 76])
    // 마지막 구간: 단열재 280 완료 → 뒤 7개 단계가 10일씩 + 방수 2·방통 5 대기 → 가구 착수 347, 완료 357
    // (예전 「흐름 전체를 14일 택트로」 계산은 385일 — 빠른 공종까지 14일로 늘려 잡았다)
    assert.equal(down.totalDays, 357)
    assert.ok(down.trades[1].utilization < 0.8)
    assert.deepEqual(validateTaktInput({ ...SPEC, trades: [{ ...SPEC.trades[0], crew: 0 }] }), { "trades.0.crew": "1 이상의 정수" })
  })
  it("인원 지정이 없으면 모든 공종이 택트 페이스 — 흐름선이 평행, 기다림 없음", () => {
    const r0 = computeTakt(SPEC)
    assert.ok(r0.trades.every((t) => t.pace === 10 && Math.abs(t.waitIdle) < 1e-9))
    assert.deepEqual(r0.stages.map((s) => s.offset), [0, 10, 20, 30, 40, 52, 67, 77])
  })
  it("고정 일수 공종: 구간당 일수·팀 인원 그대로, 물량·생산성은 안 본다 (명세 입력의 방통을 기본값처럼 2일·4명, 양생 대기 3+14 로)", () => {
    const input: TaktInput = {
      ...SPEC,
      trades: SPEC.trades.map((t) => (t.name === "방통" ? { ...t, waitDays: 17, mode: "fixed" as const, fixedDays: 2, crew: 4 } : t)),
    }
    const d = computeTakt(input)
    const i = input.trades.findIndex((t) => t.name === "방통")
    assert.deepEqual([d.trades[i].pace, d.trades[i].crew, d.trades[i].manDays, d.trades[i].bottleneck], [2, 4, 8, false])
    // 기포+방통이 2일에 지나가 8일 당겨지고, 양생 대기가 5 → 17 로 12일 늘어난다: 277 − 8 + 12 = 281, 인원 55 − 3 + 4 = 56
    assert.deepEqual([d.totalDays, d.crewTotal], [281, 56])
    assert.deepEqual(validateTaktInput(input), {})
    // 물량·생산성이 비어도 고정 일수면 정상, 일수·팀 인원이 없으면 오류
    const fx = { stage: 1, name: "방통", unit: "㎡", qtyPerUnit: Number.NaN, productivity: Number.NaN, waitDays: 0, mode: "fixed" as const }
    assert.deepEqual(validateTaktInput({ ...DEFAULT_TAKT_INPUT, trades: [{ ...fx, fixedDays: 2, crew: 4 }] }), {})
    assert.deepEqual(Object.keys(validateTaktInput({ ...DEFAULT_TAKT_INPUT, trades: [fx] })).sort(), ["trades.0.crew", "trades.0.fixedDays"])
    // 고정 일수가 택트보다 길면 병목
    const slow = computeTakt({ ...DEFAULT_TAKT_INPUT, trades: [{ ...fx, fixedDays: 12, crew: 4 }] })
    assert.deepEqual([slow.trades[0].bottleneck, slow.totalDays], [true, 20 * 12])
  })
  it("화면 기본 공종 = 마감 공정표 공종 14개와 같은 이름·순서 (2026-10-31)", () => {
    assert.deepEqual(DEFAULT_TAKT_INPUT.trades.map((t) => t.name), FINISH_TRADES.map((t) => t.label))
    assert.deepEqual(validateTaktInput(DEFAULT_TAKT_INPUT), {})
  })
})

describe("준공일 역산 (2026-11-01)", () => {
  it("기간 안에 끝나는 가장 긴 택트 = 가장 적은 인원", () => {
    const f = taktForDeadline(DEFAULT_TAKT_INPUT, 250)
    assert.ok(f.taktDays != null)
    assert.ok(f.result.totalDays <= 250)
    // 하루 더 길면 넘친다
    const over = computeTakt({ ...DEFAULT_TAKT_INPUT, taktDays: f.taktDays + 1, trades: DEFAULT_TAKT_INPUT.trades.map((t) => (t.mode === "fixed" ? t : { ...t, crew: null })) })
    assert.ok(over.totalDays > 250)
  })
  it("직접 정한 인원은 무시하고 자동 인원으로", () => {
    const input = { ...DEFAULT_TAKT_INPUT, trades: DEFAULT_TAKT_INPUT.trades.map((t) => (t.mode === "fixed" ? t : { ...t, crew: 1 })) }
    assert.deepEqual(taktForDeadline(input, 300).taktDays, taktForDeadline(DEFAULT_TAKT_INPUT, 300).taktDays)
  })
  it("택트 1일로도 넘치면 null + 택트 1일 계산", () => {
    const f = taktForDeadline(DEFAULT_TAKT_INPUT, 10)
    assert.equal(f.taktDays, null)
    assert.ok(f.result.totalDays > 10)
  })
  it("고정 일수 공종은 구간 층수에 비례 — 작은 구간에서 고정 공종이 전체를 끌지 않는다", () => {
    // 기포방통을 5개층 20일로(양생까지 넣은 경우): 2개층이면 8일
    const input = { ...DEFAULT_TAKT_INPUT, trades: DEFAULT_TAKT_INPUT.trades.map((t) => (t.mode === "fixed" ? { ...t, fixedDays: 20 } : t)) }
    const f = taktForDeadline(input, 700, 2)
    const i = input.trades.findIndex((t) => t.mode === "fixed")
    assert.equal(f.result.trades[i].zoneDays, 8)
  })
  it("구간 층수를 바꿔 볼 수 있다", () => {
    assert.equal(taktForDeadline(DEFAULT_TAKT_INPUT, 300, 3).zoneFloors, 3)
  })
})
