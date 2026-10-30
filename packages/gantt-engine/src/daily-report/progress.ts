// 작업일보(해석 결과) → 엔진 출발 상태. 설계 문서 §7 "매일 작업일보가 확정되면 그 시점의 동별 단계에서 앞으로 다시 돌린다".
//
// 일보에는 오전/오후 구분이 없다. 그래서 "그날 그 동이 끝낸 단계" 로 보고, 다음 날 아침부터 그 다음 단계를 시작한다.
// 같은 날 여러 단계(먹매김 + 갱폼인양)가 적히면 사이클 순서상 가장 뒤의 것이 끝난 단계다.
import type { DailyReport, Stage } from "../contracts/index.ts"
import { addDays, type IsoDate } from "../calendar/date.ts"
import { STAGES, nextStage } from "../rules/stages.ts"
import type { BuildingState } from "../simulator/simulator.ts"

/** 실적 한 칸: 그날 그 동이 한 단계 (반일 구분 없음) */
export type ActualWork = { date: IsoDate; buildingId: number; stage: Stage; floor: number }

export type BuildingLabel = { id: number; label: string }

export type Progress = {
  /** 일보에 나온 동. id = 동 번호(401), label = "401동" */
  buildings: BuildingLabel[]
  /** 기간의 실적 (단계로 읽힌 것만) */
  actual: ActualWork[]
  /** asOf 기준 동별 출발 상태. simulate({ from: asOf+1, initial }) 에 넣는다 */
  initial: BuildingState[]
  /** 실적이 있는 마지막 일보 날짜. 일보가 없으면 null */
  asOf: IsoDate | null
}

const order = (s: Stage) => STAGES.indexOf(s)

/** 배근 → 그 뒤 기전 (W철근 → 벽 기전, S철근 → 슬래브 기전) */
const MEP_AFTER: Partial<Record<Stage, Stage>> = { WALL_REBAR: "WALL_MEP", SLAB_REBAR: "SLAB_MEP" }

/**
 * 일보에는 배근과 기전이 같은 날 함께 적히는 일이 많다(배근 시작과 동시에 배관 착수).
 * 기전이 그 동의 다음 일보에도 이어지면 배근 날의 기전은 빼고 다음 날부터 기전으로 본다
 * — 순서는 배근 → 기전이다 (2026-10-30 사용자 확인: 403동 10/2 W철근·기전, 10/3 기전 → 기전은 10/3).
 * 그날로 끝나는 기전은 그대로 둔다(오전 배근 → 오후 기전, 설계 §3). 제자리에서 actual 을 고친다.
 */
function deferContinuedMep(actual: ActualWork[]): void {
  const dates = new Map<number, IsoDate[]>()
  for (const a of actual) {
    const list = dates.get(a.buildingId) ?? []
    if (list.at(-1) !== a.date) list.push(a.date)
    dates.set(a.buildingId, list)
  }
  const drop = new Set<ActualWork>()
  for (const [id, ds] of dates) {
    ds.forEach((date, i) => {
      const next = ds[i + 1]
      if (!next) return
      const today = actual.filter((a) => a.buildingId === id && a.date === date)
      const tomorrow = actual.filter((a) => a.buildingId === id && a.date === next)
      for (const [rebar, mep] of Object.entries(MEP_AFTER) as [Stage, Stage][]) {
        if (!today.some((a) => a.stage === rebar)) continue
        if (!tomorrow.some((a) => a.stage === mep)) continue
        for (const a of today) if (a.stage === mep) drop.add(a)
      }
    })
  }
  for (let i = actual.length - 1; i >= 0; i--) if (drop.has(actual[i])) actual.splice(i, 1)
}

/**
 * @param reports 날짜 오름차순이 아니어도 된다. 동 번호가 없는 줄(부대시설)은 뺀다.
 * @param upTo 이 날짜까지만 실적으로 본다 (보통 오늘). 그 뒤 일보는 무시.
 */
export function progressFromReports(
  reports: DailyReport[],
  upTo: IsoDate,
  /** 동 번호 → 최상층 (현장 규모 설정). 없으면 끝없이 올라간다 */
  topFloors: ReadonlyMap<number, number> = new Map(),
): Progress {
  const actual: ActualWork[] = []
  for (const r of reports) {
    if (r.date > upTo) continue
    for (const e of r.entries) {
      if (e.buildingNo === null || !e.stage) continue
      actual.push({ date: r.date, buildingId: e.buildingNo, stage: e.stage, floor: e.floor ?? 0 })
    }
  }
  actual.sort((a, b) => a.date.localeCompare(b.date) || a.buildingId - b.buildingId)
  deferContinuedMep(actual)

  const ids = [...new Set(actual.map((a) => a.buildingId))].sort((a, b) => a - b)
  const buildings = ids.map((id) => ({ id, label: `${id}동` }))
  const asOf = actual.length ? actual[actual.length - 1].date : null
  const startDate = asOf ? addDays(asOf, 1) : upTo

  const initial: BuildingState[] = ids.map((id) => {
    const mine = actual.filter((a) => a.buildingId === id)
    const lastDate = mine[mine.length - 1].date
    const lastDay = mine.filter((a) => a.date === lastDate)
    // 그날 가장 높은 층의, 사이클 순서상 가장 뒤 단계가 "끝난 단계"
    const dayTop = Math.max(...lastDay.map((a) => a.floor))
    const done = lastDay
      .filter((a) => a.floor === dayTop)
      .reduce((acc, a) => (order(a.stage) > order(acc.stage) ? a : acc))
    const lastPour = [...mine].reverse().find((a) => a.stage === "POUR")
    const topFloor = topFloors.get(id) ?? null
    const finished = done.stage === "POUR" && topFloor != null && done.floor >= topFloor
    return {
      id,
      stage: nextStage(done.stage, topFloor != null && topFloor === done.floor),
      readySlot: 0,
      readyDate: startDate,
      prevEndSlot: -1,
      lastPourDate: lastPour?.date ?? null,
      pours: 0,
      // 타설로 끝났으면 다음 사이클은 한 층 위 (최상층이었으면 끝)
      floor: done.stage === "POUR" && !finished ? done.floor + 1 : done.floor,
      topFloor,
      done: finished,
    }
  })

  return { buildings, actual, initial, asOf }
}
