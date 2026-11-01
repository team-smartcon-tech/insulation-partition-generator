// 택트 인원 ↔ 마감 예정 규칙 연동 (2026-10-31 사용자: 택트 투입 인원을 마감 예정 규칙 인원과 연동, 팀 → 명).
//
// 마감 공종 14개와 택트 공종은 이름으로 짝짓는다(FINISH_TRADES label = 택트 공종명). 짝이 있으면:
//   인원 = 택트 투입 인원(직접 정한 값, 없으면 자동 인원)
//   묶음당 작업일 = 올림(묶음 층수 × 층당 인·일 ÷ 인원), 층당 인·일 = 세대당 물량 × 층당 세대수 ÷ 1인1일 생산성
//   고정 일수 공종(기포방통) = 올림(택트 구간 일수 × 묶음 층수 ÷ 구간 층수) — 인원은 표시만
//   동시 묶음 = 코어 수 (2026-10-31 사용자: 공종당 여러 명이면 여러 코어로 나눠 작업) — 택트 인원은 한 층 전체 세대(모든 코어)를
//     구간 일수에 끝내는 인원이라, 그 인원이 동의 코어들에 세대 비율로 나뉘어 동시에 한다. 코어마다 묶음당 작업일은 위 식 그대로
//     (코어 물량 ÷ 코어 인원 = 층 전체 물량 ÷ 전체 인원), 동과 동 사이는 차례로.
// 짝이 없거나(택트에서 이름을 바꿈·지움) 택트 입력이 잘못됐으면 마감 규칙의 「묶음당 작업일」 입력값을 그대로 쓴다.
import type { FinishPlanSettings } from "../contracts/index.ts"
import { FINISH_TRADES, type FinishTradeKey } from "../finish/gantt.ts"
import { finishPlanOf } from "../finish/plan.ts"
import { computeTakt, validateTaktInput, type TaktInput } from "./crew.ts"

export type TaktLink = {
  /** 택트 공종 줄 번호 */
  index: number
  name: string
  /** 투입 인원 (직접 정한 값 또는 자동) */
  crew: number
  autoCrew: number
  /** 인원을 직접 정했는가 */
  manual: boolean
  fixed: boolean
  /** 층당 인·일 (인원 산정 공종) */
  perFloorManDays: number | null
  /** 층당 작업일 (고정 일수 공종) */
  fixedDaysPerFloor: number | null
}

/** 택트 입력 → 마감 공종 키별 연동 정보. 택트 입력에 오류가 있으면 빈 맵 */
export function taktLinks(input: TaktInput): Map<FinishTradeKey, TaktLink> {
  const out = new Map<FinishTradeKey, TaktLink>()
  if (Object.keys(validateTaktInput(input)).length) return out
  const r = computeTakt(input)
  for (const ft of FINISH_TRADES) {
    const index = input.trades.findIndex((t) => t.name.trim() === ft.label)
    if (index < 0) continue
    const t = input.trades[index]
    const res = r.trades[index]
    const fixed = t.mode === "fixed"
    out.set(ft.key, {
      index,
      name: t.name,
      crew: res.crew,
      autoCrew: res.autoCrew,
      manual: !fixed && t.crew != null,
      fixed,
      perFloorManDays: fixed ? null : (t.qtyPerUnit * input.unitsPerFloor) / t.productivity,
      fixedDaysPerFloor: fixed ? t.fixedDays! / input.zoneFloors : null,
    })
  }
  return out
}

/** 부동소수 오차로 3.0000001 이 4 로 올라가지 않게 */
const ceil = (x: number) => Math.ceil(x - 1e-9)

/** 연동된 공종의 묶음당 작업일 (최소 1일) */
export function linkedBatchDays(link: TaktLink, floorsPerBatch: number): number {
  const days = link.fixed ? link.fixedDaysPerFloor! * floorsPerBatch : (link.perFloorManDays! * floorsPerBatch) / link.crew
  return Math.max(1, ceil(days))
}

/**
 * 마감 예정 규칙에 택트 연동을 입힌다: 짝이 있는 공종은 묶음당 작업일 = 인원으로 계산, 동시 묶음(teams) = 코어 수.
 * cores = 동의 코어 수(현장에서 가장 큰 값, 코어로 안 나뉘면 1) — 인원이 코어들에 나뉘어 동시에 한다.
 */
export function finishSettingsWithTakt(
  settings: FinishPlanSettings | undefined,
  links: Map<FinishTradeKey, TaktLink>,
  cores = 1,
): FinishPlanSettings {
  const out: FinishPlanSettings = { ...(settings ?? {}) }
  for (const [key, link] of links) {
    const rule = finishPlanOf(settings, key)
    // 겹쳐 이동 공종은 코어당 작업일·간격·팀을 직접 넣은 값 그대로 (2026-11-01 사용자: 인원은 표시만)
    if (rule.moveDays != null) continue
    out[key] = { ...rule, daysPerBatch: linkedBatchDays(link, rule.floorsPerBatch), teams: Math.max(1, Math.min(5, cores)) }
  }
  return out
}

/** 겹쳐 이동 공종의 택트 구간 (2026-11-01) */
export type TaktFlow = {
  /** 한 곳(코어·동)의 구간 작업일 = 묶음당 작업일 × 구간 층수 ÷ 묶음 층수 */
  placeDays: number
  moveDays: number
  moveBy: "core" | "building"
  /** 구간 하나에서 차례로 시작하는 곳 수 (코어 단위 = 코어 수, 동 단위 = 1 — 구간은 한 동 안) */
  stops: number
  /** 구간 일수 = placeDays + (stops − 1) × moveDays */
  zoneDays: number
}

/**
 * 마감 예정 규칙의 겹쳐 이동(moveDays)을 택트에 입힌다 (2026-11-01 사용자: 택트 인원 탭도 겹쳐 이동을 알게).
 * 짝(이름이 같은 마감 공종)이 겹쳐 이동이면 그 택트 공종을 고정 일수로 바꿔 계산한다 — 구간 일수 = 위 TaktFlow.zoneDays,
 * 인원 = 지금 인원(직접 정한 값, 없으면 자동 인원, 표시만). 택트보다 길면 병목.
 * 4코어 · 5개층 5일 · 간격 1일 · 구간 5개층 → 5 + 3 × 1 = 8일.
 */
export function taktWithFlows(
  input: TaktInput,
  settings: FinishPlanSettings | undefined,
  cores = 1,
): { input: TaktInput; flows: Map<number, TaktFlow> } {
  const flows = new Map<number, TaktFlow>()
  if (Object.keys(validateTaktInput(input)).length) return { input, flows }
  let base: ReturnType<typeof computeTakt> | null = null
  const trades = input.trades.map((t, i) => {
    const ft = FINISH_TRADES.find((x) => x.label === t.name.trim())
    const rule = ft ? finishPlanOf(settings, ft.key) : null
    if (!rule || rule.moveDays == null) return t
    const moveBy = rule.moveBy ?? "core"
    const stops = moveBy === "core" ? Math.max(1, cores) : 1
    const placeDays = (rule.daysPerBatch * input.zoneFloors) / rule.floorsPerBatch
    const zoneDays = placeDays + (stops - 1) * rule.moveDays
    flows.set(i, { placeDays, moveDays: rule.moveDays, moveBy, stops, zoneDays })
    base ??= computeTakt(input)
    return { ...t, mode: "fixed" as const, fixedDays: zoneDays, crew: t.crew ?? base.trades[i].crew }
  })
  return { input: flows.size ? { ...input, trades } : input, flows }
}
