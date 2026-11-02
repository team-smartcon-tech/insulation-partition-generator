// 지하·저층(재래식 거푸집) 예정 계산 (설계 §8-2, 2026-10-30 2안).
//
// 한 층(사이클) 순서 — 남원주역세권 2차 일보 실적에서 본 순서:
//   먹매김  →  (갱폼)  →  W철근 ∥ W기전  →  W거푸집  →  (W타설: 분리 타설일 때)  →  시스템  →  S거푸집  →  S철근 ∥ S기전  →  S타설
//   먹매김: 타설 다음 날 기본 (2026-11-01 사용자, underground.markDays, 기본 1일).
//   갱폼: 저층에서 갱폼 셋팅층 이상이면 — 셋팅층 첫 사이클은 설치 기간(gangformSetupDays) 막대, 그 위는 인양 1일 (지하는 없음)
//   (∥ = 같은 날 시작해 병행. 두 공종이 겹치는 날은 오전 = 앞 공종, 오후 = 뒤 공종으로 그린다)
// 층은 「사이클 층」 — S타설은 그 층 천장(일보의 「위층 바닥」)이다. B1 사이클의 S타설 = 일보 「1F 바닥 타설」.
// 지하 맨 아래층부터 기준층 시작 바로 아래 층까지 이 사이클을 돈다. 그 뒤 전환 작업일을 두고 기준층 엔진(simulate)에 넘긴다.
//
// 팀 용량 (2026-11-01 사용자: 지하층·저층부는 같은 팀을 이어서 쓰고, 기준층 자원과는 따로):
//   형틀팀 — W거푸집·시스템·S거푸집. 동이 속한 지하 구역(settings.zones)의 팀(A·B …)이 맡고, 같은 팀 동들은 그 팀이 비어야 시작.
//   철근팀 — W철근·S철근. 지하·저층 철근팀 수(underground.rebarTeams)만큼 동시에.
//   구역에 없는 동·철근팀 수가 비었으면 제한 없음(예전처럼 동마다 자기 작업조). 기전(병행)은 팀을 따지지 않는다.
//   타설 — 「1일 타설 N동」(pourPerDay) 한도. S타설·W타설 모두 센다 (2026-11-02 사용자: 타설은 하루 1개 동).
//   배정: 가장 먼저 시작할 수 있는 동의 다음 공종부터 (같으면 구역 순서, 동 번호). 팀은 그 공종 자기 일수만큼 묶인다.
// 작업일 = 일요일 제외. 타설은 타설 가능일(평일, 공휴일 제외)만.
import { addDays, dateRange, type IsoDate } from "../calendar/date.ts"
import { getDayInfo, type CalendarConfig } from "../calendar/calendar.ts"
import { DEFAULT_UNDERGROUND_SETTINGS, type UndergroundSettings } from "../contracts/index.ts"
import type { Stage } from "../rules/stages.ts"
import type { Half } from "./simulator.ts"

export type UgStep = { stage: Stage; days: number; parallel?: boolean; pour?: boolean }

/** 설정 → 한 층 순서표 */
/**
 * 설정 → 한 층 순서표. story 가 1 이상이면 저층(lowRise) 값, 지하(B층)면 지하 값.
 * 저층 설정이 없으면 지하 값을 쓴다.
 */
export function undergroundSequence(
  settings: UndergroundSettings = DEFAULT_UNDERGROUND_SETTINGS,
  story = -1,
  gangformFloor: number | null = null,
  gangformSetupDays = 1,
): UgStep[] {
  const low = story >= 1 && settings.lowRise ? settings.lowRise : null
  const d = low ? low.durations : settings.durations
  const separateWallPour = low ? low.separateWallPour : settings.separateWallPour
  const gang = gangformFloor != null && story >= 1 && story >= gangformFloor
  const steps: UgStep[] = [
    { stage: "MARK", days: settings.markDays ?? 1 },
    // 저층에서도 갱폼을 쓸 수 있다(2026-11-01 사용자): 셋팅층은 설치 기간, 그 위는 인양 1일
    ...(gang ? [{ stage: "GANGFORM" as const, days: story === gangformFloor ? Math.max(1, gangformSetupDays) : 1 }] : []),
    { stage: "WALL_REBAR", days: d.wallRebar },
    { stage: "WALL_MEP", days: d.wallMep, parallel: true },
    { stage: "FORM_WALL", days: d.formWall },
  ]
  if (separateWallPour) steps.push({ stage: "POUR_WALL", days: 1, pour: true })
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
  /** 갱폼 셋팅층 (저층에서도 이 층 이상이면 갱폼인양). 없으면 저층은 갱폼 없음 */
  gangformFloor?: number | null
}

export type UgAssignment = { date: IsoDate; half: Half; buildingId: number; stage: Stage; floor: number }

export type UgResult = {
  assignments: UgAssignment[]
  /** 동별: 지하·저층 마지막 S타설 날 (기간 안에 끝나면). 없으면 기간 안에 안 끝남 */
  finishedOn: Map<number, IsoDate>
}

/** 형틀팀이 맡는 공종 / 철근팀이 맡는 공종 */
const FORM_STAGES: ReadonlySet<Stage> = new Set<Stage>(["FORM_WALL", "SHORING", "FORM_SLAB"])
const REBAR_STAGES: ReadonlySet<Stage> = new Set<Stage>(["WALL_REBAR", "SLAB_REBAR"])

export function planUnderground(input: {
  calendar: CalendarConfig
  settings?: UndergroundSettings
  from: IsoDate
  to: IsoDate
  buildings: UgBuilding[]
  /** 동 → 형틀팀 이름 (지하 구역의 팀). 없는 동은 형틀팀 제한 없음 */
  formTeamOf?: ReadonlyMap<number, string>
  /** 지하·저층 철근팀 수. 없으면 제한 없음 */
  rebarTeams?: number | null
  /** 동 → 우선순위(작을수록 먼저, 구역 순서). 시작일이 같을 때만 */
  priority?: ReadonlyMap<number, number>
  /** 갱폼 설치 기간(작업일). 저층 갱폼 셋팅층 첫 사이클의 갱폼 막대 길이 (2026-11-01) */
  gangformSetupDays?: number
  /** 1일 타설 가능 동수. 없으면 제한 없음 */
  pourPerDay?: number | null
}): UgResult {
  const seqOf = (story: number, gangformFloor?: number | null) =>
    undergroundSequence(input.settings, story, gangformFloor ?? null, input.gangformSetupDays ?? 1)
  const workdays = dateRange(input.from, input.to).filter((d) => getDayInfo(input.calendar, d).workable)
  const pourOk = (d: IsoDate) => getDayInfo(input.calendar, d).pourAllowed
  const assignments: UgAssignment[] = []
  const finishedOn = new Map<number, IsoDate>()

  // 동마다 지금 위치. w = 다음 공종을 시작할 수 있는 날(workdays 인덱스)
  const states = input.buildings.map((b) => ({ b, w: 0, story: b.story, stepIndex: b.stepIndex, doneDays: b.doneDays }))
  const formFree = new Map<string, number>() // 형틀팀 → 비는 날
  const rebarFree = input.rebarTeams && input.rebarTeams > 0 ? Array.from({ length: input.rebarTeams }, () => 0) : null
  const pourLimit = input.pourPerDay && input.pourPerDay > 0 ? input.pourPerDay : null
  const poursOn = new Map<number, number>() // 작업일 인덱스 → 잡힌 타설 수
  const pourFull = (w: number) => pourLimit != null && (poursOn.get(w) ?? 0) >= pourLimit

  for (let guard = 0; guard < 200_000; guard++) {
    let best: {
      s: (typeof states)[number]
      start: number
      group: { step: UgStep; days: number }[]
      last: number
      seq: UgStep[]
      team?: string
      rebar: number
      prio: number
    } | null = null
    for (const st of states) {
      if (st.story >= st.b.baseFloor || st.w >= workdays.length) continue
      const seq = seqOf(st.story, st.b.gangformFloor) // 지하·저층 순서표가 다르다
      // 그룹: 지금 공종 + 뒤에 붙은 병행 공종들
      const group: { step: UgStep; days: number }[] = []
      let i = st.stepIndex
      group.push({ step: seq[i], days: Math.max(1, seq[i].days - st.doneDays) })
      while (seq[i + 1]?.parallel) {
        i++
        group.push({ step: seq[i], days: seq[i].days })
      }
      const lead = group[0].step.stage
      let start = st.w
      const team = FORM_STAGES.has(lead) ? input.formTeamOf?.get(st.b.id) : undefined
      if (team) start = Math.max(start, formFree.get(team) ?? 0)
      let rebar = -1
      if (rebarFree && REBAR_STAGES.has(lead)) {
        rebar = rebarFree.indexOf(Math.min(...rebarFree))
        start = Math.max(start, rebarFree[rebar])
      }
      // 타설은 타설 가능일까지 미룬다
      if (group[0].step.pour) while (start < workdays.length && (!pourOk(workdays[start]) || pourFull(start))) start++
      if (start >= workdays.length) {
        st.w = workdays.length // 기간 안에 못 한다 — 이 동은 여기서 멈춤
        continue
      }
      const prio = input.priority?.get(st.b.id) ?? Number.MAX_SAFE_INTEGER
      if (
        !best ||
        start < best.start ||
        (start === best.start && (prio < best.prio || (prio === best.prio && st.b.id < best.s.b.id)))
      )
        best = { s: st, start, group, last: i, seq, team, rebar, prio }
    }
    if (!best) break

    const { s: st, start, group, last, seq, team, rebar } = best
    const span = Math.max(...group.map((g) => g.days))
    for (let k = 0; k < span && start + k < workdays.length; k++) {
      const date = workdays[start + k]
      const active = group.filter((g) => k < g.days).map((g) => g.step)
      if (active.length === 1) {
        const step = active[0]
        assignments.push({ date, half: "AM", buildingId: st.b.id, stage: step.stage, floor: st.story })
        if (!step.pour) assignments.push({ date, half: "PM", buildingId: st.b.id, stage: step.stage, floor: st.story })
      } else {
        assignments.push({ date, half: "AM", buildingId: st.b.id, stage: active[0].stage, floor: st.story })
        assignments.push({ date, half: "PM", buildingId: st.b.id, stage: active[1].stage, floor: st.story })
      }
    }
    const endW = start + span - 1
    // 팀은 그 공종 자기 일수만큼 (병행 기전이 더 길어도 팀은 먼저 빠진다)
    if (team) formFree.set(team, start + group[0].days)
    if (rebar >= 0) rebarFree![rebar] = start + group[0].days
    if (group[0].step.pour) poursOn.set(start, (poursOn.get(start) ?? 0) + 1)
    st.w = endW + 1
    st.doneDays = 0
    st.stepIndex = last + 1
    if (st.stepIndex >= seq.length) {
      // 이 층 끝 (S타설)
      if (endW < workdays.length && nextStory(st.story) >= st.b.baseFloor) finishedOn.set(st.b.id, workdays[endW])
      st.story = nextStory(st.story)
      st.stepIndex = 0
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
  gangformFloor: number | null = null,
): UgBuilding | null {
  const known = new Set([...undergroundSequence(settings, -1), ...undergroundSequence(settings, 1, gangformFloor ?? 1)].map((x) => x.stage))
  const mine = actual.filter((a) => a.buildingId === buildingId && a.floorLabel == null && known.has(a.stage))
  if (!mine.length) return null
  const last = mine.reduce((m, a) => (a.date > m ? a.date : m), mine[0].date)
  const recent = mine.filter((a) => a.date >= addDays(last, -14))
  const story = Math.max(...recent.map((a) => a.floor))
  const onStory = mine.filter((a) => a.floor === story)
  const seq = undergroundSequence(settings, story, gangformFloor)
  const idx = (s: Stage) => seq.findIndex((x) => x.stage === s)
  // 공종 위치는 최근 14일 실적으로만 — 구역별 일부 타설처럼 예전 실적이 앞서 나가 있으면 층을 건너뛴다(504동 9/23 일부 타설)
  let stepIndex = Math.max(...recent.filter((a) => a.floor === story).map((a) => idx(a.stage)))
  if (stepIndex < 0) stepIndex = 0 // 그 층 순서표에 없는 공종뿐(예: 분리 타설 설정이 지하·저층에서 다름)
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
  return { id: buildingId, story: s, stepIndex: i, doneDays: done, baseFloor, ...(gangformFloor != null ? { gangformFloor } : {}) }
}
