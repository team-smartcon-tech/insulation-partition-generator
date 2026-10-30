// 날짜는 "YYYY-MM-DD" 문자열(IsoDate)로만 다룬다. 시간대 문제를 피하려고 내부 계산은 UTC 정오 기준.

export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(date)
  if (!m) throw new Error(`날짜 형식이 아닙니다: ${date}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function toUtc(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date)
  return Date.UTC(year, month - 1, day, 12)
}

function fromUtc(ms: number): IsoDate {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * 86_400_000)
}

/** 0 = 일요일 … 6 = 토요일 */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay()
}

export function monthOf(date: IsoDate): number {
  return parseIsoDate(date).month
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** start 이상 end 이하의 날짜 목록 */
export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = start; compareIsoDate(d, end) <= 0; d = addDays(d, 1)) out.push(d)
  return out
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
