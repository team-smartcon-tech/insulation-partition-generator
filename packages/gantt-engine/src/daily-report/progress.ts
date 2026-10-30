// 작업일보(해석 결과) → 엔진 출발 상태. 설계 문서 §7 "매일 작업일보가 확정되면 그 시점의 동별 단계에서 앞으로 다시 돌린다".
//
// 일보에는 오전/오후 구분이 없다. 그래서 "그날 그 동이 끝낸 단계" 로 보고, 다음 날 아침부터 그 다음 단계를 시작한다.
// 같은 날 여러 단계(먹매김 + 갱폼인양)가 적히면 사이클 순서상 가장 뒤의 것이 끝난 단계다.
import type { DailyReport, Stage } from "../contracts/index.ts"
import { addDays, type IsoDate } from "../calendar/date.ts"
import { STAGES, nextStage } from "../rules/stages.ts"
import type { BuildingState } from "../simulator/simulator.ts"

/** 실적 한 칸: 그날 그 동이 한 단계 (반일 구분 없음) */
export type ActualWork = { date: IsoDate; buildingId: number; stage: Stage; floor: number; floorLabel?: string }

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

/** 기전 규칙(순서 밖 제외·이월)은 기준층 사이클 전제 — 지하·저층(2층 미만, RF 등)은 일보 그대로 둔다 */
const isBaseFloor = (a: ActualWork) => a.floorLabel == null && a.floor >= 2

/** 배근 → 그 뒤 기전 (W철근 → 벽 기전, S철근 → 슬래브 기전) */
const MEP_AFTER: Partial<Record<Stage, Stage>> = { WALL_REBAR: "WALL_MEP", SLAB_REBAR: "SLAB_MEP" }

/** 기전 → (앞) 그 기전을 여는 배근, (뒤) 그 기전 창을 닫는 단계 */
const MEP_WINDOW: Partial<Record<Stage, { opens: Stage; closes: Stage }>> = {
  WALL_MEP: { opens: "WALL_REBAR", closes: "ALFORM" },
  SLAB_MEP: { opens: "SLAB_REBAR", closes: "POUR" },
}

/**
 * 순서 밖 기전은 뺀다 (2026-10-30 사용자 결정). 기전은 배근 뒤 · 다음 골조 단계 앞에서만 기전으로 본다.
 * - 벽 기전: 가장 최근 W철근 날 ~ 그 뒤 알폼 전날
 * - 슬래브 기전: 가장 최근 S철근 날 ~ 그 뒤 타설 전날
 * 알폼 날 데크 위 선행 배관(402동 10/20 「37F 바닥 배관」), 타설 날 마무리 배관(10/22)은 일보에 적혀도 공정 단계가 아니다.
 * 층 번호가 아니라 그 동의 시간 순서로 본다 — 전기 일보 층이 골조와 하나 틀리게 적힌 날(403동 10/2·3 「34F 벽체」)도 살린다.
 * 제자리에서 actual 을 고친다. actual 은 날짜순이어야 한다.
 */
function dropMepOutsideWindow(actual: ActualWork[]): void {
  const drop = new Set<ActualWork>()
  for (const a of actual) {
    const w = MEP_WINDOW[a.stage]
    if (!w || !isBaseFloor(a)) continue
    const mine = actual.filter((x) => x.buildingId === a.buildingId)
    const opened = mine.filter((x) => x.stage === w.opens && x.date <= a.date).at(-1)?.date
    const closed = opened !== undefined && mine.some((x) => x.stage === w.closes && x.date > opened && x.date <= a.date)
    if (opened === undefined || closed) drop.add(a)
  }
  for (let i = actual.length - 1; i >= 0; i--) if (drop.has(actual[i])) actual.splice(i, 1)
}

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
      const today = actual.filter((a) => a.buildingId === id && a.date === date && isBaseFloor(a))
      const tomorrow = actual.filter((a) => a.buildingId === id && a.date === next && isBaseFloor(a))
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
      actual.push({
        date: r.date,
        buildingId: e.buildingNo,
        stage: e.stage,
        floor: e.floor ?? 0,
        // 일보에 층이 없으면 0층이 아니라 「층?」 (근거 없는 층을 만들지 않는다)
        ...(e.floorLabel ? { floorLabel: e.floorLabel } : e.floor == null ? { floorLabel: "층?" } : {}),
      })
    }
  }
  actual.sort((a, b) => a.date.localeCompare(b.date) || a.buildingId - b.buildingId)
  dropMepOutsideWindow(actual)
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
