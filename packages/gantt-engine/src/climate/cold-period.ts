// 한중(寒中) 기간 — 일평균기온 4℃ 이하 예상 기간 (2026-11-02).
// 지점(현장 격자)별 최근 10겨울 평균은 kma-cold-normals.ts(자동 생성). 현장은 좌표로 가까운 지점을 고르고, 기간을 직접 고칠 수도 있다.
import { parseIsoDate, type IsoDate } from "../calendar/date.ts"
import type { ColdWeatherSettings } from "../contracts/schedule.schema.ts"
import { COLD_STATIONS } from "./kma-cold-normals.ts"

/** 기준 지점 — 스마트웍스 날씨 API 의 기상청 5km 격자 하나(그 격자의 현장 이름) */
export type ColdStation = {
  /** 격자 x*1000+y */
  id: number
  name: string
  lat: number
  lon: number
  /** 해발고도(m). 격자는 0 */
  ht: number
  /** 평균 낸 겨울 "2016/17~2025/26" */
  winters: string
  /** 7일 이동평균 4℃ 이하 시작·끝 "MM-DD". 내려가지 않으면 null */
  start: string | null
  end: string | null
  /** 7일 이동평균 최저 */
  minTemp: number
  /** 순 평균 36개 (1월 상순 … 12월 하순). 받지 않은 순은 null */
  dekads: (number | null)[]
}

/** 기간 "MM-DD" ~ "MM-DD". start > end 면 해를 넘긴다(11-24 ~ 03-05) */
export type MonthDayRange = { start: string; end: string }

/** 고지대(대관령·추풍령 등) 관측소는 자동 추천에서 뺀다 — 현장과 기온이 크게 다르다 */
const AUTO_MAX_HEIGHT = 300

export function coldStation(id: number | null | undefined): ColdStation | null {
  return id == null ? null : (COLD_STATIONS.find((s) => s.id === id) ?? null)
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/** 좌표에서 가까운 관측소 순서 (거리 km 포함). 고지대 관측소는 뒤로 */
export function nearestColdStations(lat: number, lon: number, limit = 5): (ColdStation & { km: number })[] {
  return COLD_STATIONS.map((s) => ({ ...s, km: Math.round(distanceKm(lat, lon, s.lat, s.lon)) }))
    .sort((a, b) => Number(a.ht > AUTO_MAX_HEIGHT) - Number(b.ht > AUTO_MAX_HEIGHT) || a.km - b.km)
    .slice(0, limit)
}

const mmdd = (date: IsoDate) => {
  const { month, day } = parseIsoDate(date)
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function inMonthDayRange(range: MonthDayRange, date: IsoDate): boolean {
  const d = mmdd(date)
  return range.start <= range.end ? d >= range.start && d <= range.end : d >= range.start || d <= range.end
}

/** 현장 설정 → 동절기 양생 기간. 꺼져 있거나 정할 수 없으면 null (= 11~3월) */
export function coldRangeOf(cw: ColdWeatherSettings | undefined): MonthDayRange | null {
  if (!cw?.enabled) return null
  if (cw.range) return cw.range
  const s = coldStation(cw.stationId)
  return s?.start && s.end ? { start: s.start, end: s.end } : null
}

/** "11-24" → "11/24" */
export const monthDayLabel = (v: string) => v.replace("-", "/")
