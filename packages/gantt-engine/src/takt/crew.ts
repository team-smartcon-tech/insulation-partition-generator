// 마감 공종 택트 인원 계산 (2026-10-31). 화면과 분리된 순수 함수 — 스마트 공정표 「택트 인원」 탭(apps/web/src/features/gantt/takt)이 쓰고, Worker 가 저장 전 검증에 쓴다.
//
// 목적: 마감 공종이 N개 층 구간을 같은 일수(택트)에 끝내고 다음 구간으로 넘어가도록, 공종별 유휴 없는 적정 인원을 낸다.
//
// 공종마다
//   구간 물량 = 세대당 물량 × 층당 세대수 × 구간 층수
//   구간 인·일 = 구간 물량 ÷ 1인1일 생산성
//   필요 인원 = max(1, 올림(구간 인·일 ÷ 택트))
//   가동률 = 구간 인·일 ÷ (필요 인원 × 택트)
// 전체
//   총 구간 수 = Σ 올림(동별 층수 ÷ 구간 층수) — 팀은 한 동을 끝내면 다음 동 첫 구간으로 이어 간다
//   단계 오프셋: 단계 번호를 오름차순으로 놓고 k번째(0부터) = k × 택트 + 앞 단계들의 후속 대기일 합
//     (같은 단계 공종은 같은 구간에 동시에 — 후속 대기일은 그 단계에서 가장 긴 값)
//   전체 기간(작업일) = (총 구간 수 − 1) × 택트 + 마지막 단계 오프셋 + 택트
//   동시 투입 인원 = 모든 공종 필요 인원 합
// 인원 직접 지정(crew, 2026-10-31 사용자: 인원을 줄였다 늘렸다): 그 공종 인원 = 지정값, 구간 일수 = 구간 인·일 ÷ 인원.
// 흐름(공종마다 제 속도, 2026-10-31 사용자: 다 평행이더라 → 느린 공종은 눕고 뒤 공종은 기다리게):
//   공종 속도(구간당 일수) = 인원 지정이 있으면 구간 일수, 없으면 택트(택트에 맞춘 인원이라 택트 페이스로 간다)
//   구간 j 착수 = max(같은 공종이 구간 j−1 을 끝낸 날, 앞 단계 공종들이 구간 j 를 끝낸 날 + 앞 단계 후속 대기일)
//   완료 = 착수 + 구간당 일수. 전체 기간 = 가장 늦은 완료. 가동률 = 총 인·일 ÷ (인원 × 첫 착수~마지막 완료) — 기다린 날만큼 내려간다.
//   지정이 없으면 위 오프셋·전체 기간 공식과 같은 값이 나온다(모든 공종이 택트 페이스).
// 고정 일수 공종(mode "fixed", 2026-10-31 사용자: 방바닥통미장처럼 인당 생산성이 중요하지 않은 공종):
//   구간당 일수 = fixedDays 그대로, 인원 = crew(팀 규모, 자동 없음). 물량·생산성은 쓰지 않는다. 구간 인·일 = 인원 × 일수.
//   양생은 지금처럼 후속 대기일. fixedDays 가 택트보다 길면 병목.

/** 산정 방식: rate = 물량 ÷ 생산성으로 인원 산정(기본), fixed = 구간당 일수·팀 인원을 직접 */
export type TaktMode = "rate" | "fixed"

export type TaktTrade = {
  /** 단계 번호 (같은 번호 = 같은 구간에 동시 투입) */
  stage: number
  name: string
  unit: string
  /** 세대당 물량 */
  qtyPerUnit: number
  /** 1인 1일 생산성 (단위/인·일) */
  productivity: number
  /** 후속 대기일 (방수 담수시험·방통 양생처럼 다음 단계가 기다리는 작업일) */
  waitDays: number
  /** 인원 직접 지정. 없거나 null 이면 자동(택트에 맞춘 최소 인원). 고정 일수 공종은 팀 인원(필수) */
  crew?: number | null
  /** 산정 방식. 없으면 rate */
  mode?: TaktMode
  /** 고정 일수 공종의 구간당 작업일 */
  fixedDays?: number | null
}

export type TaktInput = {
  /** 층당 세대수 */
  unitsPerFloor: number
  /** 구간 층수 */
  zoneFloors: number
  /** 택트 = 구간당 작업일수 */
  taktDays: number
  /** 동별 층수 */
  buildingFloors: number[]
  trades: TaktTrade[]
}

export type TaktTradeResult = {
  zoneQty: number
  /** 구간 인·일 */
  manDays: number
  /** 투입 인원 (직접 지정이 있으면 그 값) */
  crew: number
  /** 자동 인원 = max(1, 올림(구간 인·일 ÷ 택트)) */
  autoCrew: number
  /** 이 인원으로 한 구간에 걸리는 작업일 (구간 인·일 ÷ 인원, 올림 안 함 — 택트가 소수여도 자동 인원이 병목으로 잡히지 않게) */
  zoneDays: number
  /** 구간 일수가 입력 택트보다 길다 — 이 공종이 흐름을 늦춘다 */
  bottleneck: boolean
  /** 가동률 0~1 = 총 인·일 ÷ (인원 × 첫 구간 착수~마지막 구간 완료) */
  utilization: number
  /** 첫 구간 착수(작업일) */
  offset: number
  /** 이 공종의 구간당 일수 (지정 인원이면 구간 일수, 자동이면 택트) */
  pace: number
  /** 구간마다 착수·완료 (작업일). 착수가 앞 구간 완료보다 늦으면 그 사이는 기다림 */
  zones: { start: number; finish: number }[]
  /** 앞 공종을 기다린 날 합 */
  waitIdle: number
}

export type TaktResult = {
  trades: TaktTradeResult[]
  /** 단계 번호 오름차순 + 오프셋(그 단계 공종의 가장 이른 첫 착수) + 그 단계의 후속 대기일(가장 긴 값) */
  stages: { stage: number; offset: number; waitDays: number }[]
  totalZones: number
  crewTotal: number
  /** 가장 느린 공종의 구간당 일수 (병목이 없으면 입력 택트) */
  effectiveTakt: number
  /** 첫 구간 착수(0) → 마지막 구간 완료 작업일 */
  totalDays: number
}

/** 오류: 필드 키 → 문구. 키는 "unitsPerFloor" · "zoneFloors" · "taktDays" · "buildingFloors" · "trades" · "trades.{i}.{필드}" */
export type TaktErrors = Record<string, string>

/** 가동률이 이보다 낮으면 화면이 경고색 */
export const TAKT_LOW_UTILIZATION = 0.8

/** 화면 기본값 — 전부 예시값(실행 내역·현장 실적 품셈으로 교체) */
export const DEFAULT_TAKT_INPUT: TaktInput = {
  unitsPerFloor: 4,
  zoneFloors: 5,
  taktDays: 10,
  buildingFloors: [20, 20, 25, 15, 18],
  // 공종 14개 = 마감 공정표와 같은 목록·순서 (2026-10-31 사용자). 단계는 목록 순서. 숫자는 예시값 — 명세에 있던 공종(단열·경량·합지(석고)·방수·
  // 기포방통·천장·가구)은 명세값, 나머지(PL창틀·벽/바닥타일·몰딩·도배·마루)는 가정값.
  trades: [
    { stage: 1, name: "PL창틀", unit: "세대", qtyPerUnit: 1, productivity: 1, waitDays: 0 },
    { stage: 2, name: "내장단열", unit: "㎡", qtyPerUnit: 70, productivity: 25, waitDays: 0 },
    { stage: 3, name: "내장경량벽체", unit: "㎡", qtyPerUnit: 60, productivity: 30, waitDays: 0 },
    { stage: 4, name: "내장합지", unit: "㎡", qtyPerUnit: 120, productivity: 35, waitDays: 0 },
    { stage: 5, name: "방수공사", unit: "㎡", qtyPerUnit: 25, productivity: 20, waitDays: 2 },
    // 기포방통: 펌프·장비 1조가 구간을 정해진 일수에 친다 → 고정 일수(물량·생산성은 참고값).
    // 구간 일수 = 사람이 붙는 날만(기포 타설 1 + 방통 타설 1). 양생은 후속 대기 = 기포 양생 3 + 방통 양생 14.
    // 구간 일수에 양생을 넣으면 택트보다 길어 병목이 되고 인·일이 부풀려진다.
    { stage: 6, name: "기포방통", unit: "㎡", qtyPerUnit: 70, productivity: 50, waitDays: 17, mode: "fixed", fixedDays: 2, crew: 4 },
    { stage: 7, name: "내장천장", unit: "㎡", qtyPerUnit: 90, productivity: 25, waitDays: 0 },
    { stage: 8, name: "벽타일", unit: "㎡", qtyPerUnit: 40, productivity: 12, waitDays: 0 },
    { stage: 9, name: "바닥타일", unit: "㎡", qtyPerUnit: 20, productivity: 12, waitDays: 0 },
    { stage: 10, name: "가구공사", unit: "세대", qtyPerUnit: 1, productivity: 0.5, waitDays: 0 },
    { stage: 11, name: "내장몰딩", unit: "m", qtyPerUnit: 80, productivity: 60, waitDays: 0 },
    { stage: 12, name: "천장도배", unit: "㎡", qtyPerUnit: 90, productivity: 60, waitDays: 0 },
    { stage: 13, name: "벽도배", unit: "㎡", qtyPerUnit: 210, productivity: 60, waitDays: 0 },
    { stage: 14, name: "마루공사", unit: "㎡", qtyPerUnit: 60, productivity: 30, waitDays: 0 },
  ],
}

/** "20,20,25" → [20,20,25]. 빈 칸·0 이하·소수·숫자 아님이 하나라도 있으면 null */
export function parseBuildingFloors(text: string): number[] | null {
  const parts = text.split(/[,，\s]+/).filter(Boolean)
  if (!parts.length) return null
  const nums = parts.map(Number)
  return nums.every((n) => Number.isInteger(n) && n > 0) ? nums : null
}

const positive = (n: number) => Number.isFinite(n) && n > 0
const positiveInt = (n: number) => Number.isInteger(n) && n > 0

/** 입력 검사. 오류가 없으면 빈 객체 — 하나라도 있으면 화면은 계산을 멈춘다 */
export function validateTaktInput(input: TaktInput): TaktErrors {
  const e: TaktErrors = {}
  if (!positiveInt(input.unitsPerFloor)) e.unitsPerFloor = "1 이상의 정수를 넣으세요."
  if (!positiveInt(input.zoneFloors)) e.zoneFloors = "1 이상의 정수를 넣으세요."
  if (!positive(input.taktDays)) e.taktDays = "0보다 큰 값을 넣으세요."
  if (!input.buildingFloors.length || !input.buildingFloors.every(positiveInt)) e.buildingFloors = "동별 층수를 1 이상의 정수로, 쉼표로 나눠 넣으세요."
  if (!input.trades.length) e.trades = "공종을 하나 이상 넣으세요."
  input.trades.forEach((t, i) => {
    if (!positiveInt(t.stage)) e[`trades.${i}.stage`] = "1 이상의 정수"
    if (!t.name.trim()) e[`trades.${i}.name`] = "공종명을 넣으세요"
    if (!(Number.isFinite(t.waitDays) && t.waitDays >= 0)) e[`trades.${i}.waitDays`] = "0 이상의 값"
    if (t.mode === "fixed") {
      // 물량·생산성은 쓰지 않는다
      if (!positive(t.fixedDays ?? Number.NaN)) e[`trades.${i}.fixedDays`] = "0보다 큰 값"
      if (!positiveInt(t.crew ?? Number.NaN)) e[`trades.${i}.crew`] = "팀 인원(1 이상의 정수)"
    } else {
      if (!positive(t.qtyPerUnit)) e[`trades.${i}.qtyPerUnit`] = "0보다 큰 값"
      if (!positive(t.productivity)) e[`trades.${i}.productivity`] = "0보다 큰 값"
      if (t.crew != null && !positiveInt(t.crew)) e[`trades.${i}.crew`] = "1 이상의 정수"
    }
  })
  return e
}

/** 부동소수 오차로 4.000000001 이 5 로 올라가지 않게 */
const ceil = (x: number) => Math.ceil(x - 1e-9)

/** 계산. 입력은 validateTaktInput 을 통과한 것이어야 한다 */
export function computeTakt(input: TaktInput): TaktResult {
  const { unitsPerFloor, zoneFloors } = input
  const base = input.trades.map((t) => {
    if (t.mode === "fixed") {
      const crew = t.crew!
      const days = t.fixedDays!
      return { zoneQty: 0, manDays: crew * days, autoCrew: crew, crew, zoneDays: days }
    }
    const zoneQty = t.qtyPerUnit * unitsPerFloor * zoneFloors
    const manDays = zoneQty / t.productivity
    const autoCrew = Math.max(1, ceil(manDays / input.taktDays))
    const crew = t.crew ?? autoCrew
    return { zoneQty, manDays, autoCrew, crew, zoneDays: manDays / crew }
  })
  const totalZones = input.buildingFloors.reduce((s, f) => s + ceil(f / zoneFloors), 0)
  // 부동소수 오차(10.0000001)로 병목이 아닌데 늦어지지 않게: 택트보다 확실히 길 때만 병목
  const bottleneck = base.map((b) => b.zoneDays > input.taktDays + 1e-9)
  // 고정 일수·인원 지정 공종은 제 일수, 자동 인원 공종은 택트 페이스
  const pace = base.map((b, i) => (input.trades[i].mode === "fixed" || input.trades[i].crew != null ? b.zoneDays : input.taktDays))
  const stageNos = [...new Set(input.trades.map((t) => t.stage))].sort((a, b) => a - b)
  const waitOf = new Map(stageNos.map((st) => [st, Math.max(...input.trades.filter((t) => t.stage === st).map((t) => t.waitDays))]))
  const zones: { start: number; finish: number }[][] = input.trades.map(() => [])
  stageNos.forEach((st, k) => {
    const prev = k > 0 ? input.trades.flatMap((t, i) => (t.stage === stageNos[k - 1] ? [i] : [])) : []
    const gap = k > 0 ? waitOf.get(stageNos[k - 1])! : 0
    input.trades.forEach((t, i) => {
      if (t.stage !== st) return
      for (let j = 0; j < totalZones; j++) {
        let start = j > 0 ? zones[i][j - 1].finish : 0
        for (const u of prev) start = Math.max(start, zones[u][j].finish + gap)
        zones[i].push({ start, finish: start + pace[i] })
      }
    })
  })
  const stages: TaktResult["stages"] = stageNos.map((st) => ({
    stage: st,
    offset: Math.min(...input.trades.flatMap((t, i) => (t.stage === st ? [zones[i][0]?.start ?? 0] : []))),
    waitDays: waitOf.get(st)!,
  }))

  const trades = base.map((b, i) => {
    const z = zones[i]
    const offset = z[0]?.start ?? 0
    const span = (z.at(-1)?.finish ?? 0) - offset
    return {
      ...b,
      bottleneck: bottleneck[i],
      pace: pace[i],
      zones: z,
      offset,
      waitIdle: span - totalZones * pace[i],
      utilization: span > 0 ? (b.manDays * totalZones) / (b.crew * span) : 1,
    }
  })
  return {
    trades,
    stages,
    totalZones,
    crewTotal: trades.reduce((s, t) => s + t.crew, 0),
    effectiveTakt: Math.max(input.taktDays, ...pace.filter((_, i) => bottleneck[i])),
    totalDays: Math.max(0, ...trades.map((t) => t.zones.at(-1)?.finish ?? 0)),
  }
}

/** 준공일 역산 결과 — 구간 층수 하나에 대해 */
export type TaktForDeadline = {
  zoneFloors: number
  /** 기간 안에 끝나는 가장 긴 택트(정수 일). 택트 1일로도 넘치면 null */
  taktDays: number | null
  /** 그 택트의 계산 (null 이면 택트 1일 계산 — 얼마나 넘치는지 보이려고) */
  result: TaktResult
}

/**
 * 준공일 역산 (2026-11-01 사용자: 준공일에 맞춰 택트·인원을 거꾸로). 마감에 쓸 수 있는 기간(일) 안에 끝나는 가장 긴 택트를 찾는다 —
 * 택트가 길수록 인원이 적으니, 기간을 지키는 택트 중 가장 긴 것 = 가장 적은 인원. 인원 산정 공종은 자동 인원(직접 정한 인원은 무시),
 * 고정 일수 공종은 구간 일수를 구간 층수에 비례해 바꾼다(입력 일수는 지금 구간 층수 기준 — 5개층 2일이면 2개층 0.8일). 전체 기간은 택트가 길수록
 * 늘어나므로(단조) 1일부터 올려 가며 넘기 직전 값.
 */
export function taktForDeadline(
  input: TaktInput,
  availableDays: number,
  zoneFloors = input.zoneFloors,
  maxTakt = 60,
  /** 그 구간 층수 입력을 계산 직전에 손본다 (겹쳐 이동 공종 → 고정 일수, takt/link taktWithFlows) */
  prepare: (zoneInput: TaktInput) => TaktInput = (x) => x,
): TaktForDeadline {
  const at = (taktDays: number) =>
    computeTakt(prepare({
      ...input,
      zoneFloors,
      taktDays,
      trades: input.trades.map((t) =>
        t.mode === "fixed" ? { ...t, fixedDays: ((t.fixedDays ?? 0) * zoneFloors) / input.zoneFloors } : { ...t, crew: null },
      ),
    }))
  let best: { taktDays: number; result: TaktResult } | null = null
  for (let d = 1; d <= maxTakt; d++) {
    const r = at(d)
    if (r.totalDays > availableDays + 1e-9) break
    best = { taktDays: d, result: r }
  }
  return best ? { zoneFloors, ...best } : { zoneFloors, taktDays: null, result: at(1) }
}
