// 마감 공정표 예정 (2026-10-30, 사용자: 「최근 속도」 예정은 전혀 도움이 안 된다 → 골조처럼 규칙으로).
//
// 공종마다 (설정 「마감 예정」):
//   pred           선행 공종 — 선행이 그 층을 끝낸 날 + gapDays 이후에 그 층 시작
//   floorsPerBatch 한 번에 하는 층 수 ("5~6F 단열재" 처럼 2개 층씩)
//   daysPerBatch   한 묶음 작업일 (일요일 제외)
// 아래층부터, 같은 공종은 앞 묶음이 끝나야 다음 묶음. 이미 다 끝난 층은 건너뛴다(덜 끝난 층은 다시 한 묶음).
// 선행 층 완료일 = 실적(그 층 마지막 세대 완료일)이 있으면 실적, 없으면 선행 공종의 예정.
// 선행이 없는 공종(창틀 등)은 그 동에서 이미 시작했을 때만 예정을 낸다 — 골조 중인 동에 마감 예정이 나오지 않게.
// 선행 공종이 이 현장에 없으면(스마트웍스 공종 없음) 그 선행의 선행으로 올라간다.
// 코어 단위 (2026-10-30): 동이 코어로 나뉘어 있으면 코어마다 따로 — 선행도 같은 코어의 그 층을 본다.
import { addDays, type IsoDate } from "../calendar/date.ts"
import { getDayInfo, type CalendarConfig } from "../calendar/calendar.ts"
import type { FinishPlanSettings, FinishTradePlan } from "../contracts/index.ts"
import type { FinishBar, FinishGanttBuilding, FinishTradeKey } from "./gantt.ts"

/** 기본 예정 규칙 (가정값 — 현장에서 설정 카드로 고친다). 일반적인 아파트 마감 순서 */
export const DEFAULT_FINISH_PLAN: Record<FinishTradeKey, FinishTradePlan> = {
  windowFrame: { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 },
  pvcAll: { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 },
  insulation: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 3 },
  interiorAll: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 6 },
  lightWall: { pred: "insulation", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  wallGypsum: { pred: "lightWall", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  ceilingGypsum: { pred: "wallGypsum", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  screed: { pred: "wallGypsum", gapDays: 5, floorsPerBatch: 3, daysPerBatch: 2 },
  tile: { pred: "screed", gapDays: 14, floorsPerBatch: 2, daysPerBatch: 5 },
  windowSash: { pred: "windowFrame", gapDays: 14, floorsPerBatch: 3, daysPerBatch: 2 }, // 부산장안: 창짝이 창틀을 바로 따라감
  glass: { pred: "windowSash", gapDays: 2, floorsPerBatch: 3, daysPerBatch: 2 },
  wallpaper: { pred: "ceilingGypsum", gapDays: 7, floorsPerBatch: 2, daysPerBatch: 4 },
  flooring: { pred: "wallpaper", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 4 },
  molding: { pred: "wallpaper", gapDays: 2, floorsPerBatch: 3, daysPerBatch: 2 },
  baseboard: { pred: "flooring", gapDays: 2, floorsPerBatch: 3, daysPerBatch: 2 },
  kitchen: { pred: "flooring", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 3 },
  furniture: { pred: "kitchen", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 3 },
}

export const finishPlanOf = (settings: FinishPlanSettings | undefined, key: string): FinishTradePlan =>
  settings?.[key] ?? DEFAULT_FINISH_PLAN[key as FinishTradeKey] ?? { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 }

/** date 이후(그날 포함) 첫 작업일 */
function workdayOnOrAfter(cal: CalendarConfig, d: IsoDate): IsoDate {
  let x = d
  for (let i = 0; i < 14 && !getDayInfo(cal, x).workable; i++) x = addDays(x, 1)
  return x
}
/** start 를 첫날로 n 작업일째 날 */
function nthWorkday(cal: CalendarConfig, start: IsoDate, n: number): IsoDate {
  let x = start
  let left = n - 1
  while (left > 0) {
    x = addDays(x, 1)
    if (getDayInfo(cal, x).workable) left--
  }
  return x
}

export type FinishPlanRow = { trade: string; core: number | null; bars: FinishBar[] }

/** 한 동의 예정 (공종별 묶음 막대). 계획 기간은 today 다음 날부터 horizonDays 까지 */
export function planFinishBuilding(
  building: FinishGanttBuilding,
  settings: FinishPlanSettings | undefined,
  calendar: CalendarConfig,
  today: IsoDate,
  horizonDays = 540,
): FinishPlanRow[] {
  const cores = [...new Set(building.rows.map((r) => r.core))]
  return cores.flatMap((core) => planRows(building.rows.filter((r) => r.core === core), settings, calendar, today, horizonDays))
}

/** 한 코어(또는 동 전체) 공종 줄들의 예정 */
function planRows(
  rows: FinishGanttBuilding["rows"],
  settings: FinishPlanSettings | undefined,
  calendar: CalendarConfig,
  today: IsoDate,
  horizonDays: number,
): FinishPlanRow[] {
  const core = rows[0]?.core ?? null
  const present = new Set<string>(rows.map((r) => r.trade))
  const rowOf = new Map<string, FinishGanttBuilding["rows"][number]>(rows.map((r) => [r.trade, r]))
  const limit = addDays(today, horizonDays)
  /** 선행 공종 (이 현장에 없으면 그 선행의 선행으로) */
  const predOf = (key: string): string | null => {
    let p = finishPlanOf(settings, key).pred
    for (let guard = 0; p && !present.has(p) && guard < 20; guard++) p = finishPlanOf(settings, p).pred
    return p && present.has(p) && p !== key ? p : null
  }
  /** 공종 → 층 → 끝나는 날 (실적 또는 예정) */
  const finishOf = new Map<string, Map<number, IsoDate>>()
  const out: FinishPlanRow[] = []
  const visiting = new Set<string>()

  const plan = (key: string): Map<number, IsoDate> => {
    const known = finishOf.get(key)
    if (known) return known
    const ends = new Map<number, IsoDate>()
    finishOf.set(key, ends)
    if (visiting.has(key)) return ends // 순환 방지
    visiting.add(key)
    const row = rowOf.get(key)!
    const rule = finishPlanOf(settings, key)
    for (const f of row.floors) if (f.units > 0 && f.done >= f.units && f.last) ends.set(f.floor, f.last)
    const pred = predOf(key)
    const predEnds = pred ? plan(pred) : null
    const bars: FinishBar[] = []
    // 선행이 없는 공종은 이 동에서 이미 시작한 경우만
    if (pred || row.done > 0) {
      const left = row.floors.filter((f) => f.units > 0 && f.done < f.units).map((f) => f.floor)
      let free = addDays(today, 1)
      for (let i = 0; i < left.length; i += rule.floorsPerBatch) {
        const batch = left.slice(i, i + rule.floorsPerBatch)
        let ready = free
        let blocked = false
        if (predEnds) {
          for (const fl of batch) {
            const pe = predEnds.get(fl)
            if (!pe) {
              blocked = true // 선행이 이 층을 언제 끝낼지 모른다 → 여기서 멈춤
              break
            }
            const r = addDays(pe, rule.gapDays + 1)
            if (r > ready) ready = r
          }
        }
        if (blocked) break
        const start = workdayOnOrAfter(calendar, ready)
        if (start > limit) break
        const end = nthWorkday(calendar, start, rule.daysPerBatch)
        for (const fl of batch) ends.set(fl, end)
        const units = row.floors.filter((f) => batch.includes(f.floor)).reduce((s, f) => s + (f.units - f.done), 0)
        bars.push({ start, end, floorFrom: Math.min(...batch), floorTo: Math.max(...batch), units })
        free = addDays(end, 1)
      }
    }
    visiting.delete(key)
    out.push({ trade: key, core, bars })
    return ends
  }

  for (const r of rows) plan(r.trade)
  return rows.map((r) => out.find((o) => o.trade === r.trade) ?? { trade: r.trade, core, bars: [] })
}
