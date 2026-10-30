// 달력·휴일 규칙 (설계 문서 §4). 현장 설정값은 CalendarConfig 로 받고, 여기서는 날짜를 판정만 한다.
import { addDays, dayOfWeek, monthOf, type IsoDate } from "./date.ts"

// 공용 계약(packages/shared calendarConfigSchema)과 같은 모양. rules/contract-check.ts 가 대조한다.
export type CalendarConfig = {
  /** 공휴일 목록 (YYYY-MM-DD). 대체공휴일 포함. */
  holidays: IsoDate[]
  /** 일요일 전체 휴무 (기본 true) */
  sundayOff?: boolean
  /** 토요일 타설 가능 여부 (기본 false — §4 "토요일 타설 불가") */
  saturdayPourAllowed?: boolean
  /** 동절기 양생 적용 월 (기본 11·12·1·2·3 — §3 "11월 초~3월 말") */
  winterCuringMonths?: number[]
}

export type DayInfo = {
  date: IsoDate
  dayOfWeek: number
  isSunday: boolean
  isSaturday: boolean
  isHoliday: boolean
  /** 어떤 작업이든 가능한 날 (일요일 휴무 제외) */
  workable: boolean
  /** 타설 가능 (토·일·공휴일 불가) */
  pourAllowed: boolean
  /** 타워크레인 운행 (일·공휴일 불가) → 갱폼인양·철근인양 */
  craneAllowed: boolean
  /** 이 날 타설하면 양생이 며칠인가 (동절기 1, 그 외 0) */
  curingDays: 0 | 1
}

const DEFAULT_WINTER_MONTHS: number[] = [11, 12, 1, 2, 3]

export function isWinterCuring(config: CalendarConfig, date: IsoDate): boolean {
  const months = config.winterCuringMonths ?? DEFAULT_WINTER_MONTHS
  return months.includes(monthOf(date))
}

export function getDayInfo(config: CalendarConfig, date: IsoDate): DayInfo {
  const dow = dayOfWeek(date)
  const isSunday = dow === 0
  const isSaturday = dow === 6
  const isHoliday = config.holidays.includes(date)
  const sundayOff = config.sundayOff ?? true
  const workable = !(isSunday && sundayOff)
  const saturdayPour = config.saturdayPourAllowed ?? false
  const pourAllowed = workable && !isHoliday && (!isSaturday || saturdayPour)
  const craneAllowed = workable && !isHoliday

  return {
    date,
    dayOfWeek: dow,
    isSunday,
    isSaturday,
    isHoliday,
    workable,
    pourAllowed,
    craneAllowed,
    curingDays: isWinterCuring(config, date) ? 1 : 0,
  }
}

/** date 이전(당일 제외)에서 가장 가까운 크레인 운행일. 공휴일 철근 선인양 날짜 계산용 (§4). */
export function previousCraneDay(config: CalendarConfig, date: IsoDate, maxLookback = 14): IsoDate {
  let d = date
  for (let i = 0; i < maxLookback; i++) {
    d = addDays(d, -1)
    if (getDayInfo(config, d).craneAllowed) return d
  }
  throw new Error(`${date} 이전 ${maxLookback}일 안에 크레인 운행일이 없습니다`)
}

/** 2026년 10월 공휴일: 3일(개천절, 토), 5일(대체공휴일, 월), 9일(한글날, 금). 11월은 없음 (§4). 화면도 쓰므로 공용 계약에 둔다. */
export { KR_HOLIDAYS_2026_Q4 } from "../contracts/schedule.schema.ts"
