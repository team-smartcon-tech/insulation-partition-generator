// 반일 슬롯 시뮬레이터 (설계 문서 §7). 하루 = 오전·오후 2칸. 각 동은 §3 단계를 순서대로 진행하고,
// 칸마다 자원 용량(크레인·철근팀·알폼팀·타설)과 §4·§5 제약을 확인해 배정한다.
// 결정적(같은 입력 → 같은 결과) 탐욕 배정. 최적안 탐색은 이 위에 따로 얹는다.
import { addDays, dateRange, type IsoDate } from "../calendar/date.ts"
import { getDayInfo, type CalendarConfig, type DayInfo } from "../calendar/calendar.ts"
import type { SiteSettings } from "../rules/settings.ts"
import { ROOFTOP_SEQUENCE, STAGES, STAGE_TEAM, nextStage, type Stage, type Team } from "../rules/stages.ts"

export type Half = "AM" | "PM"

export type Slot = { index: number; date: IsoDate; half: Half; day: DayInfo }

export type Assignment = {
  slotIndex: number
  date: IsoDate
  half: Half
  buildingId: number
  stage: Stage
  /** 그 동의 몇 번째 층 사이클인가 (1부터). 옥탑이면 최상층 + 옥탑 층 */
  floor: number
  /** 옥탑 몇 번째 층인가 (1 = PH1). 기준층 사이클이면 없음 */
  roof?: number
}

export type BuildingState = {
  id: number
  /** 다음에 할 단계 */
  stage: Stage
  /** 이 단계를 시작할 수 있는 가장 이른 슬롯 index */
  readySlot: number
  /** 이 단계를 시작할 수 있는 가장 이른 날짜 (타설 뒤 먹매김·갱폼 등 날짜 단위 제약) */
  readyDate: IsoDate
  /** 직전 단계가 끝난 슬롯 (같은 날 오후 연계 판정용) */
  prevEndSlot: number
  /** 마지막 타설일. 양생일 판정용 */
  lastPourDate: IsoDate | null
  /** 완료한 타설 수 */
  pours: number
  /** 지금 진행 중인 층. 타설하면 +1. 작업일보에서 시작하면 실제 층(38F 등), 아니면 1부터 */
  floor: number
  /** 최상층. 이 층 타설이 끝나면 사이클에서 빠진다. null 이면 끝없이 올라간다(현장 규모 미설정) */
  topFloor?: number | null
  /** 최상층 타설까지 끝남 */
  done?: boolean
  /** 옥탑 층수. 최상층 타설 다음 날부터 옥탑 순서표(ROOFTOP_SEQUENCE)를 층마다 붙인다. 0/없음 = 옥탑 없음 */
  rooftopFloors?: number
}

export type SimulationInput = {
  settings: SiteSettings
  calendar: CalendarConfig
  from: IsoDate
  to: IsoDate
  /** 출발 상태. 없으면 모든 동이 from 날 아침 "먹매김 대기" */
  initial?: BuildingState[]
}

export type SimulationResult = {
  slots: Slot[]
  assignments: Assignment[]
  buildings: BuildingState[]
}

export function buildSlots(calendar: CalendarConfig, from: IsoDate, to: IsoDate): Slot[] {
  const slots: Slot[] = []
  for (const date of dateRange(from, to)) {
    const day = getDayInfo(calendar, date)
    if (!day.workable) continue
    slots.push({ index: slots.length, date, half: "AM", day })
    slots.push({ index: slots.length, date, half: "PM", day })
  }
  return slots
}

export function initialBuildings(count: number, from: IsoDate): BuildingState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    stage: "MARK",
    readySlot: 0,
    readyDate: from,
    prevEndSlot: -1,
    lastPourDate: null,
    pours: 0,
    floor: 1,
    topFloor: null,
    done: false,
  }))
}

function stageOrder(stage: Stage): number {
  return STAGES.indexOf(stage)
}

export function simulate(input: SimulationInput): SimulationResult {
  const { settings, calendar } = input
  const slots = buildSlots(calendar, input.from, input.to)
  const buildings = (input.initial ?? initialBuildings(settings.buildingCount, input.from)).map(
    (b) => ({ ...b }),
  )
  const assignments: Assignment[] = []
  // 슬롯별 배정 목록 (예약 포함). 알폼은 2칸을 한 번에 잡는다.
  const bySlot: Assignment[][] = slots.map(() => [])

  // 철근 병행이 꺼진 모드(벽·슬래브 각 하루)에서는 벽 작업조와 슬래브 작업조가 따로 돈다고 보고
  // 용량을 단계별로 센다. 그래야 §8 2행처럼 한 달에 17회 타설이 가능하다 (1팀이 하루 1작업이면 13회가 상한).
  const sameLane = (a: Assignment, team: Team, stage?: Stage) =>
    STAGE_TEAM[a.stage] === team &&
    (team !== "rebar" ||
      settings.rebarWallAndSlabSameDay ||
      stage === undefined ||
      a.stage === stage)

  const countTeam = (slotIndex: number, team: Team, stage?: Stage) =>
    bySlot[slotIndex]?.filter((a) => sameLane(a, team, stage)).length ?? 0

  const countTeamOnDate = (date: IsoDate, team: Team, stage?: Stage) =>
    slots.filter((s) => s.date === date).reduce((n, s) => n + countTeam(s.index, team, stage), 0)

  const teamCapacityPerSlot = (team: Team): number => {
    switch (team) {
      case "rebar":
        return settings.rebarTeams
      case "alform":
        return settings.alformTeams
      case "gangform":
        return settings.gangform.count
      case "pour":
        return settings.pourPerDay
    }
  }

  // 팀 용량: 반일 칸 기준 + 하루 기준(갱폼 "하루 N동", 타설 "1일 N동")
  const hasCapacity = (slot: Slot, team: Team, stage: Stage): boolean => {
    if (countTeam(slot.index, team, stage) >= teamCapacityPerSlot(team)) return false
    const perDayLimit =
      team === "pour"
        ? settings.pourPerDay
        : team === "gangform" && settings.gangform.per === "day"
          ? settings.gangform.count
          : null
    if (perDayLimit !== null && countTeamOnDate(slot.date, team, stage) >= perDayLimit) return false
    return true
  }

  // 단계가 차지하는 반일 칸 수. 알폼은 1일(2칸). 철근 병행이 꺼지면 벽·슬래브도 각 하루(2칸).
  const stageSpan = (stage: Stage): number => {
    if (stage === "ALFORM") return 2
    if (stage === "TOP_INSULATION") return 4 // 바닥단열재 2일
    if ((stage === "WALL_REBAR" || stage === "SLAB_REBAR") && !settings.rebarWallAndSlabSameDay)
      return 2
    return 1
  }

  // 오후 단독 투입 불가: 그날 오전에 그 팀 작업이 없으면 오후에 새로 시작하지 않는다.
  const pmOnlyStartBlocked = (slot: Slot, team: Team): boolean => {
    if (slot.half !== "PM") return false
    const rule =
      team === "rebar"
        ? settings.noPMOnlyStart.rebar
        : team === "alform"
          ? settings.noPMOnlyStart.alform
          : false
    if (!rule) return false
    return countTeam(slot.index - 1, team) === 0
  }

  const curingDay = (b: BuildingState): IsoDate | null => {
    if (!b.lastPourDate) return null
    return getDayInfo(calendar, b.lastPourDate).curingDays === 1 ? addDays(b.lastPourDate, 1) : null
  }

  // 이 동이 이 칸에서 다음 단계를 시작할 수 있는가 (용량 제외, 규칙만).
  //
  // §5 "반일 투입 가능 여부" 네 가지는 모두 **같은 동이 같은 날 오전 단계를 마치고 오후에 다음 단계로
  // 이어가도 되는가**(같은 날 연계)로 해석한다. 꺼져 있으면 다음 단계는 다음 날부터다.
  // - 갱폼: 먹매김 오전 완료 → 오후 갱폼 (gangformPMAfterMarking)
  // - 벽철근: 갱폼 오전 완료 → 오후 벽철근 (wallRebarPM). 벽철근은 6h 라 그 외에는 오전 칸만 쓴다.
  // - 알폼: 벽 검측 오전 완료 → 오후 투입 (alformPMStart). 꺼지면 오전 시작만.
  // - 슬래브철근: 알폼 오전 완료 → 오후 슬래브철근 (slabRebarPM). 슬래브는 4h 라 다른 날이면 오후도 쓴다
  //   ("철근팀 하루 = 벽 오전 + 슬래브 오후", §3).
  const stageAllowedAt = (b: BuildingState, slot: Slot): boolean => {
    if (slot.index < b.readySlot) return false
    if (slot.date < b.readyDate) return false
    const prev = b.prevEndSlot >= 0 ? slots[b.prevEndSlot] : undefined
    const sameDay = prev !== undefined && prev.date === slot.date
    const h = settings.halfDay
    const span = stageSpan(b.stage)
    if (slot.index + span > slots.length) return false

    switch (b.stage) {
      case "MARK":
        return true // 양생일과 같은 날 가능
      case "GANGFORM":
        if (!slot.day.craneAllowed) return false
        if (curingDay(b) === slot.date) return false // 동절기 양생일에는 갱폼인양 불가 (§8-1)
        if (sameDay && !h.gangformPMAfterMarking) return false
        return true
      case "WALL_REBAR":
        if (sameDay && !h.wallRebarPM) return false
        if (slot.half === "PM" && !h.wallRebarPM) return false
        if (span === 2 && slot.half !== "AM") return false
        return true
      case "WALL_MEP":
      case "SLAB_MEP":
      case "TOP_INSULATION":
        return true
      case "ALFORM":
        if (sameDay && !h.alformPMStart) return false
        if (slot.half === "PM" && !h.alformPMStart) return false
        return true
      case "SLAB_REBAR":
        if (sameDay && !h.slabRebarPM) return false
        if (span === 2 && slot.half !== "AM") return false
        return true
      case "POUR":
        return slot.half === "AM" && slot.day.pourAllowed
      case "CURE":
      case "FORM_WALL":
      case "FORM_SLAB":
      case "SHORING":
        return false // 옥탑 순서표·지하 실적 전용 (기준층 사이클 밖)
    }
  }

  const assign = (b: BuildingState, slot: Slot) => {
    const stage = b.stage
    const floor = b.floor
    const span = stageSpan(stage)
    let endSlot = slot.index
    for (let k = 0; k < span; k++) {
      const s = slots[slot.index + k]
      const a: Assignment = {
        slotIndex: s.index,
        date: s.date,
        half: s.half,
        buildingId: b.id,
        stage,
        floor,
      }
      assignments.push(a)
      bySlot[s.index].push(a)
      endSlot = s.index
    }

    b.prevEndSlot = endSlot
    b.readySlot = endSlot + 1
    b.readyDate = slots[endSlot].date

    if (stage === "POUR") {
      b.pours += 1
      b.lastPourDate = slot.date
      // 최상층 타설이면 끝. 아니면 한 층 위로
      if (b.topFloor != null && b.floor >= b.topFloor) b.done = true
      else b.floor += 1
      // 그날은 타설로 끝. 먹매김은 다음날부터 (양생일에도 가능)
      b.readyDate = addDays(slot.date, 1)
      b.readySlot = slots.findIndex((s) => s.date >= b.readyDate)
      if (b.readySlot < 0) b.readySlot = slots.length
    } else if (stage === "SLAB_MEP") {
      // 검측 통과 다음날 타설 (§3 5번: 오전 검측이든 오후 검측이든 "다음날")
      b.readyDate = addDays(slot.date, 1)
    }
    b.stage = nextStage(stage, b.topFloor != null && b.floor === b.topFloor)
  }

  for (const slot of slots) {
    // 타설에 가까운 동부터, 같으면 오래 기다린 동부터
    // 오전 칸에서는 벽철근(6h, 오전 전용)을 슬래브철근보다 먼저 배정한다 — "철근팀 하루 = 벽 오전 + 슬래브 오후"(§3).
    // 슬래브가 오전을 차지하면 벽이 하루를 통째로 밀리고, 그 동의 사이클 전체가 늦어진다.
    const priority = (b: BuildingState) =>
      slot.half === "AM" && b.stage === "WALL_REBAR" ? STAGES.length : stageOrder(b.stage)
    const order = [...buildings].sort(
      (a, b) => priority(b) - priority(a) || a.readySlot - b.readySlot || a.id - b.id,
    )
    for (const b of order) {
      if (b.done) continue
      if (!stageAllowedAt(b, slot)) continue
      const team = STAGE_TEAM[b.stage]
      if (team) {
        if (!hasCapacity(slot, team, b.stage)) continue
        if (pmOnlyStartBlocked(slot, team)) continue
        if (stageSpan(b.stage) === 2 && !hasCapacity(slots[slot.index + 1], team, b.stage)) continue
      }
      assign(b, slot)
    }
  }

  // 옥탑: 최상층 타설이 끝난 동마다 그 다음 날부터 옥탑 순서표를 일 단위로 붙인다.
  // 기준층 자원(팀 용량)과 따로 돈다고 보고 bySlot 에 넣지 않는다 — 다른 동의 배정을 막지 않는다.
  // 출발 상태에서 이미 끝난 동(실적상 최상층 타설 완료)도 마지막 타설일에서 이어 붙이고, 기간 안 것만 남긴다.
  const slotsByDate = new Map<IsoDate, Slot[]>()
  for (const s of slots) slotsByDate.set(s.date, [...(slotsByDate.get(s.date) ?? []), s])
  for (const b of buildings) {
    const roofs = b.rooftopFloors ?? 0
    if (!b.done || roofs <= 0 || !b.lastPourDate || b.topFloor == null) continue
    let date = addDays(b.lastPourDate, 1)
    for (let roof = 1; roof <= roofs; roof++) {
      for (const step of ROOFTOP_SEQUENCE) {
        for (let k = 0; k < step.days; k++) {
          // 그 단계를 할 수 있는 다음 날까지 넘긴다 (일요일 휴무, 갱폼=크레인 운행일, 타설=타설 가능일)
          for (;;) {
            if (date > input.to) break
            const day = getDayInfo(calendar, date)
            const ok = day.workable && (step.stage !== "GANGFORM" || day.craneAllowed) && (step.stage !== "POUR" || day.pourAllowed)
            if (ok) break
            date = addDays(date, 1)
          }
          if (date > input.to) break
          for (const s of slotsByDate.get(date) ?? []) {
            if (step.stage === "POUR" && s.half === "PM") continue // 타설은 오전 칸(그날 전체)
            assignments.push({ slotIndex: s.index, date, half: s.half, buildingId: b.id, stage: step.stage, floor: b.topFloor + roof, roof })
          }
          date = addDays(date, 1)
        }
      }
    }
  }
  assignments.sort((x, y) => x.slotIndex - y.slotIndex || x.buildingId - y.buildingId)

  return { slots, assignments, buildings }
}
