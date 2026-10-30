// 지하·저층(재래식 거푸집) 예정 계산 (설계 §8-2, 2026-10-30 2안).
//
// 한 층(사이클) 순서 — 남원주역세권 2차 일보 실적에서 본 순서:
//   W철근 ∥ W기전  →  W거푸집  →  (W타설: 분리 타설일 때)  →  시스템  →  S거푸집  →  S철근 ∥ S기전  →  S타설
//   (∥ = 같은 날 시작해 병행. 두 공종이 겹치는 날은 오전 = 앞 공종, 오후 = 뒤 공종으로 그린다)
// 층은 「사이클 층」 — S타설은 그 층 천장(일보의 「위층 바닥」)이다. B1 사이클의 S타설 = 일보 「1F 바닥 타설」.
// 지하 맨 아래층부터 기준층 시작 바로 아래 층까지 이 사이클을 돈다. 그 뒤 전환 작업일을 두고 기준층 엔진(simulate)에 넘긴다.
//
// 단순화(가정): 팀 용량을 따지지 않는다(동마다 자기 작업조). 작업일 = 일요일 제외. 타설은 타설 가능일(평일, 공휴일 제외)만.
import { addDays, dateRange, type IsoDate } from "../calendar/date.ts"
import { getDayInfo, type CalendarConfig } from "../calendar/calendar.ts"
import { DEFAULT_UNDERGROUND_SETTINGS, type UndergroundSettings } from "../contracts/index.ts"
import type { Stage } from "../rules/stages.ts"
import type { Half } from "./simulator.ts"

export type UgStep = { stage: Stage; days: number; parallel?: boolean; pour?: boolean }

/** 설정 → 한 층 순서표 */
export function undergroundSequence(settings: UndergroundSettings = DEFAULT_UNDERGROUND_SETTINGS): UgStep[] {
  const d = settings.durations
  const steps: UgStep[] = [
    { stage: "WALL_REBAR", days: d.wallRebar },
    { stage: "WALL_MEP", days: d.wallMep, parallel: true },
    { stage: "FORM_WALL", days: d.formWall },
  ]
  if (settings.separateWallPour) steps.push({ stage: "POUR_WALL", days: 1, pour: true })
  steps.push(
    { stage: "SHORING", days: d.shoring },
    { stage: "FORM_SLAB", days: d.formSlab },
    { stage: "SLAB_REBAR", days: d.slabRebar },
    { stage: "SLAB_MEP", days: d.slabMep, parallel: true },
    { stage: "POUR", days: 1, pour: true },
  )
  return steps.filter((s) => s.days > 0)
}

/** 다음 층 (0층은 없다: B1 → 1F) */
export const nextStory = (s: number) => (s === -1 ? 1 : s + 1)

export type UgBuilding = {
  id: number
  /** 지금 진행 중인 사이클 층 (B1 = -1) */
  story: number
  /** 그 층 순서표에서 지금 하는 공종 위치 */
  stepIndex: number
  /** 그 공종에 이미 쓴 작업일 */
  doneDays: number
  /** 기준층 시작 — 이 층부터는 기준층 엔진. 그 아래 층까지 이 사이클 */
  baseFloor: number
}

export type UgAssignment = { date: IsoDate; half: Half; buildingId: number; stage: Stage; floor: number }

export type UgResult = {
  assignments: UgAssignment[]
  /** 동별: 지하·저층 마지막 S타설 날 (기간 안에 끝나면). 없으면 기간 안에 안 끝남 */
  finishedOn: Map<number, IsoDate>
}

export function planUnderground(input: {
  calendar: CalendarConfig
  settings?: UndergroundSettings
  from: IsoDate
  to: IsoDate
  buildings: UgBuilding[]
}): UgResult {
  const seq = undergroundSequence(input.settings)
  const workdays = dateRange(input.from, input.to).filter((d) => getDayInfo(input.calendar, d).workable)
  const pourOk = (d: IsoDate) => getDayInfo(input.calendar, d).pourAllowed
  const assignments: UgAssignment[] = []
  const finishedOn = new Map<number, IsoDate>()

  for (const b of input.buildings) {
    let w = 0 // workdays 인덱스: 다음 공종을 시작할 수 있는 날
    let story = b.story
    let stepIndex = b.stepIndex
    let doneDays = b.doneDays
    while (story < b.baseFloor && w < workdays.length) {
      // 그룹: 지금 공종 + 뒤에 붙은 병행 공종들
      const group: { step: UgStep; days: number }[] = []
      let i = stepIndex
      group.push({ step: seq[i], days: Math.max(1, seq[i].days - doneDays) })
      while (seq[i + 1]?.parallel) {
        i++
        group.push({ step: seq[i], days: seq[i].days })
      }
      // 타설은 타설 가능일까지 미룬다
      if (group[0].step.pour) while (w < workdays.length && !pourOk(workdays[w])) w++
      if (w >= workdays.length) break
      const span = Math.max(...group.map((g) => g.days))
      for (let k = 0; k < span && w + k < workdays.length; k++) {
        const date = workdays[w + k]
        const active = group.filter((g) => k < g.days).map((g) => g.step)
        if (active.length === 1) {
          const st = active[0]
          assignments.push({ date, half: "AM", buildingId: b.id, stage: st.stage, floor: story })
          if (!st.pour) assignments.push({ date, half: "PM", buildingId: b.id, stage: st.stage, floor: story })
        } else {
          assignments.push({ date, half: "AM", buildingId: b.id, stage: active[0].stage, floor: story })
          assignments.push({ date, half: "PM", buildingId: b.id, stage: active[1].stage, floor: story })
        }
      }
      const endW = w + span - 1
      w = endW + 1
      doneDays = 0
      stepIndex = i + 1
      if (stepIndex >= seq.length) {
        // 이 층 끝 (S타설)
        if (endW < workdays.length && nextStory(story) >= b.baseFloor) finishedOn.set(b.id, workdays[endW])
        story = nextStory(story)
        stepIndex = 0
      }
    }
  }
  assignments.sort((x, y) => x.date.localeCompare(y.date) || x.buildingId - y.buildingId || (x.half === "AM" ? -1 : 1))
  return { assignments, finishedOn }
}

/** date 다음 작업일부터 n 작업일 뒤 (n=0 이면 다음 작업일) */
export function addWorkdays(calendar: CalendarConfig, date: IsoDate, n: number): IsoDate {
  let d = addDays(date, 1)
  let left = n
  for (let guard = 0; guard < 400; guard++) {
    if (getDayInfo(calendar, d).workable) {
      if (left === 0) return d
      left--
    }
    d = addDays(d, 1)
  }
  return d
}

/**
 * 실적 → 지하 사이클 위치. 그 동의 최근 14일 실적에서 가장 높은 사이클 층, 그 층에서 순서표상 가장 뒤 공종.
 * 그 공종을 순서표 일수만큼 했으면 다음 공종부터. S타설까지 했으면 다음 층 처음부터.
 * RF 처럼 숫자 없는 층·순서표에 없는 공종(C타설 등)은 위치 판단에 쓰지 않는다. 판단할 실적이 없으면 null.
 */
export function undergroundStateFromActual(
  actual: { date: IsoDate; buildingId: number; stage: Stage; floor: number; floorLabel?: string }[],
  buildingId: number,
  baseFloor: number,
  settings?: UndergroundSettings,
): UgBuilding | null {
  const seq = undergroundSequence(settings)
  const idx = (s: Stage) => seq.findIndex((x) => x.stage === s)
  const mine = actual.filter((a) => a.buildingId === buildingId && a.floorLabel == null && idx(a.stage) >= 0)
  if (!mine.length) return null
  const last = mine.reduce((m, a) => (a.date > m ? a.date : m), mine[0].date)
  const recent = mine.filter((a) => a.date >= addDays(last, -14))
  const story = Math.max(...recent.map((a) => a.floor))
  const onStory = mine.filter((a) => a.floor === story)
  // 공종 위치는 최근 14일 실적으로만 — 구역별 일부 타설처럼 예전 실적이 앞서 나가 있으면 층을 건너뛴다(504동 9/23 일부 타설)
  let stepIndex = Math.max(...recent.filter((a) => a.floor === story).map((a) => idx(a.stage)))
  // 병행 공종(W기전·S기전)에 와 있으면 그 짝(배근)부터 본다
  while (stepIndex > 0 && seq[stepIndex].parallel) stepIndex--
  const doneDays = new Set(onStory.filter((a) => a.stage === seq[stepIndex].stage).map((a) => a.date)).size
  let s = story
  let i = stepIndex
  let done = doneDays
  if (done >= seq[i].days || seq[i].pour) {
    // 그 공종은 끝 → 다음 공종 (병행 공종은 건너뛴다)
    i++
    while (seq[i]?.parallel) i++
    done = 0
    if (i >= seq.length) {
      s = nextStory(s)
      i = 0
    }
  }
  return { id: buildingId, story: s, stepIndex: i, doneDays: done, baseFloor }
}
