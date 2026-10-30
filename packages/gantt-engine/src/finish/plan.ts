// 마감 공정표 예정 (2026-10-30, 사용자: 「최근 속도」 예정은 전혀 도움이 안 된다 → 골조처럼 규칙으로).
//
// 공종마다 (설정 「마감 예정」):
//   pred           선행 공종 — 선행이 그 층을 끝낸 날 + gapDays 이후에 그 층 시작
//   floorsPerBatch 한 번에 하는 층 수 ("5~6F 단열재" 처럼 2개 층씩)
//   daysPerBatch   한 묶음 작업일 (일요일·공휴일도 센다 — 2026-10-30 사용자: 마감은 일요일을 빼지 않는다)
// 아래층부터, 같은 공종은 앞 묶음이 끝나야 다음 묶음 — 팀이 N 개(teams, 2026-10-31 사용자)면 묶음 N 개를 동시에, 가장 먼저 비는 팀이 다음 묶음. 이미 다 끝난 층은 건너뛴다(덜 끝난 층은 다시 한 묶음).
// 선행 층 완료일 = 실적(그 층 마지막 세대 완료일)이 있으면 실적, 없으면 선행 공종의 예정.
// 골조 선행(frameLead, 2026-10-30 사용자: 창틀은 골조 5개 층 선행 — 1~5층 창틀은 골조 10층 타설 후):
//   묶음 최고층 + frameLead 층의 S타설 다음 날(+ gapDays) 부터. 그 층 타설일을 모르면(골조 예정 밖) 거기서 멈춘다.
//   골조 타설일은 화면이 넘긴다(frameReady). 안 넘기면 골조 선행은 없는 것으로 본다.
// 선행이 없는 공종은 그 동에서 이미 시작했을 때만 예정을 낸다 — 골조 중인 동에 마감 예정이 나오지 않게(골조 선행이 있으면 그것이 대신 막는다).
// 선행 공종이 이 현장에 없으면(스마트웍스 공종 없음) 그 선행의 선행으로 올라간다.
// 코어 단위 (2026-10-30): 동이 코어로 나뉘어 있으면 코어마다 따로 — 선행도 같은 코어의 그 층을 본다.
// 예정 규칙이 없는 공종(창짝설치·유리, 몰딩·주방가구·일반가구 — 2026-10-30 사용자: 마감 규칙·공정표에서 뺀다)은
// 예정을 내지 않고 간트 줄·규칙 카드에도 나오지 않는다(hasFinishPlan). 공종 이름 맞추기(finishTradeOf)는 남겨 다른 공종에 섞이지 않게 한다.
import { addDays, type IsoDate } from "../calendar/date.ts"
import type { FinishPlanSettings, FinishTradePlan } from "../contracts/index.ts"
import type { FinishBar, FinishGanttBuilding, FinishTradeKey } from "./gantt.ts"

/** 기본 예정 규칙 (가정값 — 현장에서 설정 카드로 고친다). 일반적인 아파트 마감 순서 */
export const DEFAULT_FINISH_PLAN: Partial<Record<FinishTradeKey, FinishTradePlan>> = {
  windowFrame: { pred: null, frameLead: 5, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 },
  pvcAll: { pred: null, frameLead: 5, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 },
  insulation: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 3 },
  interiorAll: { pred: "windowFrame", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 6 },
  lightWall: { pred: "insulation", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  wallGypsum: { pred: "lightWall", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  ceilingGypsum: { pred: "wallGypsum", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 4 },
  waterproof: { pred: "lightWall", gapDays: 2, floorsPerBatch: 2, daysPerBatch: 3 },
  screed: { pred: "waterproof", gapDays: 5, floorsPerBatch: 3, daysPerBatch: 2 },
  tile: { pred: "screed", gapDays: 14, floorsPerBatch: 2, daysPerBatch: 5 },
  wallpaper: { pred: "ceilingGypsum", gapDays: 7, floorsPerBatch: 2, daysPerBatch: 4 },
  flooring: { pred: "wallpaper", gapDays: 3, floorsPerBatch: 2, daysPerBatch: 4 },
  baseboard: { pred: "flooring", gapDays: 2, floorsPerBatch: 3, daysPerBatch: 2 },
}

/** 마감 예정 규칙을 쓰는 공종인가 (규칙 카드·예정 막대) */
export const hasFinishPlan = (key: string): boolean => key in DEFAULT_FINISH_PLAN

// 저장된 규칙에 없는 항목(골조 선행이 생기기 전에 저장한 현장)은 기본값으로 채운다. 「없음」 은 frameLead: null 로 저장된다
export const finishPlanOf = (settings: FinishPlanSettings | undefined, key: string): FinishTradePlan => {
  const base = DEFAULT_FINISH_PLAN[key as FinishTradeKey] ?? { pred: null, gapDays: 0, floorsPerBatch: 2, daysPerBatch: 3 }
  const saved = settings?.[key]
  return saved ? { ...base, ...saved } : base
}

/** 동 → (층 → 그 층 S타설일). 최상층보다 높은 층은 최상층 날짜, 모르면 null. 화면이 골조 실적·예정으로 만든다 */
export type FrameReady = (buildingNo: number, floor: number) => IsoDate | null

export type FinishPlanRow = { trade: string; core: number | null; bars: FinishBar[] }

/** 한 동의 예정 (공종별 묶음 막대). 계획 기간은 today 다음 날부터 horizonDays 까지 */
export function planFinishBuilding(
  building: FinishGanttBuilding,
  settings: FinishPlanSettings | undefined,
  today: IsoDate,
  horizonDays = 540,
  frameReady?: FrameReady,
): FinishPlanRow[] {
  const cores = [...new Set(building.rows.map((r) => r.core))]
  const frame = frameReady ? (floor: number) => frameReady(building.buildingNo, floor) : undefined
  return cores.flatMap((core) => planRows(building.rows.filter((r) => r.core === core), settings, today, horizonDays, frame))
}

/** 한 코어(또는 동 전체) 공종 줄들의 예정 */
function planRows(
  rows: FinishGanttBuilding["rows"],
  settings: FinishPlanSettings | undefined,
  today: IsoDate,
  horizonDays: number,
  frame?: (floor: number) => IsoDate | null,
): FinishPlanRow[] {
  const core = rows[0]?.core ?? null
  const present = new Set<string>(rows.map((r) => r.trade))
  const rowOf = new Map<string, FinishGanttBuilding["rows"][number]>(rows.map((r) => [r.trade, r]))
  const limit = addDays(today, horizonDays)
  /** 선행 공종 (이 현장에 없으면 그 선행의 선행으로) */
  const predOf = (key: string): string | null => {
    let p = finishPlanOf(settings, key).pred
    // 이 현장에 없거나 규칙 없는 공종(창짝설치·유리)이면 그 선행으로
    const ok = (x: string) => present.has(x) && hasFinishPlan(x)
    for (let guard = 0; p && !ok(p) && guard < 20; guard++) p = finishPlanOf(settings, p).pred
    return p && ok(p) && p !== key ? p : null
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
    const frameLead = frame && rule.frameLead != null ? rule.frameLead : null
    // 선행(공종·골조)이 없는 공종은 이 동에서 이미 시작한 경우만
    if (hasFinishPlan(key) && (pred || frameLead != null || row.done > 0)) {
      const left = row.floors.filter((f) => f.units > 0 && f.done < f.units).map((f) => f.floor)
      // 팀마다 다음에 비는 날. 1팀이면 예전처럼 앞 묶음이 끝나야 다음 묶음
      const teamFree = Array.from({ length: Math.max(1, rule.teams ?? 1) }, () => addDays(today, 1))
      for (let i = 0; i < left.length; i += rule.floorsPerBatch) {
        const batch = left.slice(i, i + rule.floorsPerBatch)
        const team = teamFree.indexOf([...teamFree].sort()[0])
        let ready = teamFree[team]
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
        if (!blocked && frameLead != null) {
          const poured = frame!(Math.max(...batch) + frameLead)
          if (!poured) blocked = true // 골조가 그 층을 언제 타설할지 모른다
          else {
            const r = addDays(poured, rule.gapDays + 1)
            if (r > ready) ready = r
          }
        }
        if (blocked) break
        const start = ready
        if (start > limit) break
        const end = addDays(start, rule.daysPerBatch - 1)
        for (const fl of batch) ends.set(fl, end)
        const units = row.floors.filter((f) => batch.includes(f.floor)).reduce((s, f) => s + (f.units - f.done), 0)
        bars.push({ start, end, floorFrom: Math.min(...batch), floorTo: Math.max(...batch), units })
        teamFree[team] = addDays(end, 1)
      }
    }
    visiting.delete(key)
    out.push({ trade: key, core, bars })
    return ends
  }

  for (const r of rows) plan(r.trade)
  return rows.map((r) => out.find((o) => o.trade === r.trade) ?? { trade: r.trade, core, bars: [] })
}
