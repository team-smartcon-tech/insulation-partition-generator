// 시뮬레이션 결과 집계 (설계 문서 §8 의 세 열 + 팀별 유휴).
import { dateRange, type IsoDate } from "../calendar/date.ts"
import { getDayInfo, type CalendarConfig } from "../calendar/calendar.ts"
import { STAGE_TEAM, type Team } from "../rules/stages.ts"
import type { Assignment, SimulationResult } from "./simulator.ts"

export type TeamIdle = {
  /** 그 팀이 일할 수 있는 날인데 오전·오후 모두 비어 있던 날 수 */
  fullDays: number
  /** 반일만 비어 있던 날 수 */
  halfDays: number
}

export type PeriodStats = {
  from: IsoDate
  to: IsoDate
  /** 타설 횟수 */
  pours: number
  /** 타설 가능일인데 타설이 없던 날 수 */
  pourGapDays: number
  idle: Record<Exclude<Team, "pour">, TeamIdle>
}

/** 팀이 규칙상 일할 수 있는 날인가. 갱폼은 크레인 운행일, 그 외는 일요일 아닌 날. */
function teamCanWork(calendar: CalendarConfig, team: Team, date: IsoDate): boolean {
  const day = getDayInfo(calendar, date)
  if (team === "gangform") return day.craneAllowed
  if (team === "pour") return day.pourAllowed
  return day.workable
}

export function periodStats(
  result: SimulationResult,
  calendar: CalendarConfig,
  from: IsoDate,
  to: IsoDate,
): PeriodStats {
  // 타설 횟수·타설 공백은 기준층 사이클만 센다(옥탑 타설은 뺀다).
  // 팀 유휴는 옥탑 작업도 그 팀 작업일로 센다 — 옥탑 갱폼·철근·거푸집도 갱폼·철근·알폼팀 몫 (2026-10-30 사용자 결정)
  const base = result.assignments.filter((a) => a.roof == null)
  const teamWork = (_team: Exclude<Team, "pour">) => result.assignments
  const inRange = (a: Assignment) => a.date >= from && a.date <= to
  const days = dateRange(from, to)

  const pours = base.filter((a) => inRange(a) && a.stage === "POUR").length
  const pourDates = new Set(base.filter((a) => a.stage === "POUR").map((a) => a.date))
  const pourGapDays = days.filter(
    (d) => getDayInfo(calendar, d).pourAllowed && !pourDates.has(d),
  ).length

  const idleFor = (team: Exclude<Team, "pour">): TeamIdle => {
    let fullDays = 0
    let halfDays = 0
    for (const d of days) {
      if (!teamCanWork(calendar, team, d)) continue
      const halves = new Set(
        teamWork(team)
          .filter((a) => a.date === d && STAGE_TEAM[a.stage] === team)
          .map((a) => a.half),
      )
      if (halves.size === 0) fullDays += 1
      else if (halves.size === 1) halfDays += 1
    }
    return { fullDays, halfDays }
  }

  return {
    from,
    to,
    pours,
    pourGapDays,
    idle: { rebar: idleFor("rebar"), alform: idleFor("alform"), gangform: idleFor("gangform") },
  }
}
