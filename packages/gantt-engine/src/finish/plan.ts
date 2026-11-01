// 마감 공정표 예정 (2026-10-30, 사용자: 「최근 속도」 예정은 전혀 도움이 안 된다 → 골조처럼 규칙으로).
//
// 공종마다 (설정 「마감 예정」):
//   pred           선행 공종 — 선행이 그 층을 끝낸 날 + gapDays 이후에 그 층 시작
//   floorsPerBatch 한 번에 하는 층 수 ("5~6F 단열재" 처럼 2개 층씩)
//   daysPerBatch   한 묶음 작업일 (일요일·공휴일도 센다 — 2026-10-30 사용자: 마감은 일요일을 빼지 않는다)
// 팀(teams, 2026-10-31 사용자: 1팀인데 여러 코어에서 동시에 → 현장 전체 N팀): 공종마다 현장 전체(모든 동·코어)가 N팀을 나눠 쓴다.
//   가장 먼저 비는 팀이, 지금 가장 먼저 시작할 수 있는 묶음(선행·골조가 풀린 곳)을 맡는다 — 같으면 아래층, 앞 동·코어.
//   한 동·코어 안에서는 아래층 묶음부터. 이미 다 끝난 층은 건너뛴다(덜 끝난 층은 다시 한 묶음).
//   공종은 선행 사슬 순서(선행이 먼저)로 계산해, 뒤 공종이 볼 선행 예정이 먼저 정해지게 한다.
// 선행 층 완료일 = 실적(그 층 마지막 세대 완료일)이 있으면 실적, 없으면 선행 공종의 예정.
// 골조 선행(frameLead, 2026-10-30 사용자: 창틀은 골조 5개 층 선행 — 1~5층 창틀은 골조 10층 타설 후):
//   묶음 최고층 + frameLead 층의 S타설 다음 날(+ gapDays) 부터. 그 층 타설일을 모르면(골조 예정 밖) 거기서 멈춘다.
//   골조 타설일은 화면이 넘긴다(frameReady). 안 넘기면 골조 선행은 없는 것으로 본다.
// 선행이 없는 공종은 그 동에서 이미 시작했을 때만 예정을 낸다 — 골조 중인 동에 마감 예정이 나오지 않게(골조 선행이 있으면 그것이 대신 막는다).
// 선행 공종이 이 현장에 없으면(스마트웍스 공종 없음) 그 선행의 선행으로 올라간다.
// 코어 단위 (2026-10-30): 동이 코어로 나뉘어 있으면 코어마다 따로 — 선행도 같은 코어의 그 층을 본다.
// 겹쳐 이동(moveDays, 2026-11-01 사용자: PL창호 — 1코어 5일 중 하루 하고 2코어로, 4코어면 8일):
//   팀이 한 곳을 시작하고 moveDays 뒤에 다음 곳을 시작할 수 있다(막대는 묶음당 작업일 그대로). 한 곳 안에서는 앞 묶음이 끝나야 다음 묶음.
//   moveBy "core" = 곳이 동·코어(코어를 다 돌면 다음 동), "building" = 곳이 동(그 동 코어들의 다음 묶음을 같은 날 함께 시작).
// 공종은 14개 고정(2026-10-31, FINISH_TRADES). 예전 키로 저장된 규칙·선행은 FINISH_RULE_ALIAS 로 지금 공종에 잇는다.
import { addDays, type IsoDate } from "../calendar/date.ts"
import type { FinishPlanSettings, FinishTradePlan } from "../contracts/index.ts"
import type { FinishBar, FinishGanttBuilding, FinishTradeKey } from "./gantt.ts"

/**
 * 기본 예정 규칙 (가정값 — 현장에서 설정 카드로 고친다). 공종 14개(2026-10-31 사용자 지정, 택트 인원과 같은 목록).
 * 기본 선행 = 목록에서 바로 앞 공종(PL창틀은 골조 5개 층), 간격 2일 · 5개 층씩. 현장마다 설정 탭에서 바꾼다.
 */
export const DEFAULT_FINISH_PLAN: Partial<Record<FinishTradeKey, FinishTradePlan>> = {
  windowFrame: { pred: null, frameLead: 5, gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 },
  insulation: { pred: "windowFrame", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 },
  lightWall: { pred: "insulation", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 4 },
  wallGypsum: { pred: "lightWall", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 4 },
  waterproof: { pred: "wallGypsum", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 },
  screed: { pred: "waterproof", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 2 },
  ceilingGypsum: { pred: "screed", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 4 },
  wallTile: { pred: "ceilingGypsum", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 5 },
  floorTile: { pred: "wallTile", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 5 },
  furniture: { pred: "floorTile", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 },
  molding: { pred: "furniture", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 2 },
  ceilingWallpaper: { pred: "molding", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 },
  wallpaper: { pred: "ceilingWallpaper", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 4 },
  flooring: { pred: "wallpaper", gapDays: 2, floorsPerBatch: 5, daysPerBatch: 4 },
}

/**
 * 예전 공종 키 → 지금 공종 (2026-10-31 14개로 통일). 저장된 규칙·선행을 읽을 때 쓴다:
 * PL창틀(pvcAll) → windowFrame, 타일(tile) → 바닥타일, 몰딩+걸레받이(baseboard) → 내장몰딩, 주방가구(kitchen) → 가구공사.
 * 창짝설치·유리·내장(구분 없음)은 이어 줄 공종이 없어 창틀로 (선행 사슬이 끊기지 않게).
 */
export const FINISH_RULE_ALIAS: Partial<Record<FinishTradeKey, FinishTradeKey>> = {
  pvcAll: "windowFrame",
  tile: "floorTile",
  baseboard: "molding",
  kitchen: "furniture",
  windowSash: "windowFrame",
  glass: "windowFrame",
  interiorAll: "windowFrame",
}
/** 지금 공종 → 예전 키들 (저장값을 찾을 때) */
const LEGACY_OF = new Map<string, string[]>()
for (const [old, now] of Object.entries(FINISH_RULE_ALIAS)) LEGACY_OF.set(now!, [...(LEGACY_OF.get(now!) ?? []), old])

/** 마감 예정 규칙을 쓰는 공종인가 (규칙 카드·예정 막대) */
export const hasFinishPlan = (key: string): boolean => key in DEFAULT_FINISH_PLAN || key in FINISH_RULE_ALIAS

// 저장된 규칙에 없는 항목(골조 선행이 생기기 전에 저장한 현장)은 기본값으로 채운다. 「없음」 은 frameLead: null 로 저장된다.
// 예전 키로 저장된 값(「tile」 「baseboard」 …)도 읽고, 선행이 예전 키면 지금 공종으로 바꾼다.
export const finishPlanOf = (settings: FinishPlanSettings | undefined, key: string): FinishTradePlan => {
  key = FINISH_RULE_ALIAS[key as FinishTradeKey] ?? key
  const base = DEFAULT_FINISH_PLAN[key as FinishTradeKey] ?? { pred: null, gapDays: 2, floorsPerBatch: 5, daysPerBatch: 3 }
  const saved = settings?.[key] ?? (LEGACY_OF.get(key) ?? []).map((k) => settings?.[k]).find(Boolean)
  const rule = saved ? { ...base, ...saved } : base
  const pred = rule.pred ? (FINISH_RULE_ALIAS[rule.pred as FinishTradeKey] ?? rule.pred) : rule.pred
  return pred === rule.pred ? rule : { ...rule, pred: pred === key ? null : pred }
}

/**
 * 마감 예정 계산 한도(일) — 끝없이 돌지 않게 하는 안전장치. 남은 층을 다 배정하면 그 전에 끝난다.
 * 예전 540일(오늘 + 약 1년 반)이라 남원주 1차 벽도배처럼 선행 사슬 끝 공종의 2028-05 이후 예정이 잘렸다 (2026-10-31) → 5년.
 */
export const FINISH_HORIZON_DAYS = 1825

/** 동 → (층 → 그 층 S타설일). 최상층보다 높은 층은 최상층 날짜, 모르면 null. 화면이 골조 실적·예정으로 만든다 */
export type FrameReady = (buildingNo: number, floor: number) => IsoDate | null

export type FinishPlanRow = { trade: string; core: number | null; bars: FinishBar[] }

/** 한 동의 예정 (공종별 묶음 막대) — 팀은 이 동 안에서만 나눠 쓴다. 현장 전체는 planFinishSite */
export function planFinishBuilding(
  building: FinishGanttBuilding,
  settings: FinishPlanSettings | undefined,
  today: IsoDate,
  horizonDays = FINISH_HORIZON_DAYS,
  frameReady?: FrameReady,
): FinishPlanRow[] {
  return planFinishSite([building], settings, today, horizonDays, frameReady).get(building.buildingNo) ?? []
}

type Unit = {
  buildingNo: number
  core: number | null
  rowOf: Map<string, FinishGanttBuilding["rows"][number]>
  predOf: (key: string) => string | null
  frame?: (floor: number) => IsoDate | null
  /** 공종 → 층 → 끝나는 날 (실적 또는 예정) */
  ends: Map<string, Map<number, IsoDate>>
  bars: Map<string, FinishBar[]>
}

/**
 * 현장 전체 예정 — 동마다 공종별 묶음 막대. 팀(teams)은 현장 전체가 나눠 쓴다.
 * 계획 기간은 today 다음 날부터 horizonDays 까지.
 */
export function planFinishSite(
  buildings: FinishGanttBuilding[],
  settings: FinishPlanSettings | undefined,
  today: IsoDate,
  horizonDays = FINISH_HORIZON_DAYS,
  frameReady?: FrameReady,
): Map<number, FinishPlanRow[]> {
  const limit = addDays(today, horizonDays)
  // 계산 단위 = 동 × 코어 (선행은 같은 코어의 그 층)
  const units: Unit[] = buildings.flatMap((b) =>
    [...new Set(b.rows.map((r) => r.core))].map((core) => {
      const rows = b.rows.filter((r) => r.core === core)
      const present = new Set<string>(rows.map((r) => r.trade))
      // 선행 공종이 이 코어에 없으면 그 공종 규칙을 쓰는 다른 공종 줄로(창틀설치 → PL창틀)
      const resolve = (x: string) =>
        present.has(x) ? x : (Object.entries(FINISH_RULE_ALIAS).find(([a, to]) => to === x && present.has(a))?.[0] ?? x)
      // 이 현장(코어)에 없거나 규칙 없는 공종(창짝설치·유리)이면 그 선행으로
      const ok = (x: string) => present.has(x) && hasFinishPlan(x)
      const predOf = (key: string): string | null => {
        let p = finishPlanOf(settings, key).pred
        if (p) p = resolve(p)
        for (let guard = 0; p && !ok(p) && guard < 20; guard++) {
          p = finishPlanOf(settings, p).pred
          if (p) p = resolve(p)
        }
        return p && ok(p) && p !== key ? p : null
      }
      const ends = new Map<string, Map<number, IsoDate>>()
      for (const r of rows) {
        const m = new Map<number, IsoDate>()
        for (const f of r.floors) if (f.units > 0 && f.done >= f.units && f.last) m.set(f.floor, f.last)
        ends.set(r.trade, m)
      }
      return {
        buildingNo: b.buildingNo,
        core,
        rowOf: new Map(rows.map((r) => [r.trade, r])),
        predOf,
        frame: frameReady ? (floor: number) => frameReady(b.buildingNo, floor) : undefined,
        ends,
        bars: new Map(),
      }
    }),
  )

  // 공종 순서: 선행 사슬 깊이(선행 없음 = 0) → 기본 규칙 순서. 현장에 없는 선행을 건너뛰어도 그 조상은 늘 더 얕다
  const order = Object.keys(DEFAULT_FINISH_PLAN)
  const depth = (key: string) => {
    let d = 0
    for (let p = finishPlanOf(settings, key).pred; p && d < 20; p = finishPlanOf(settings, p).pred) d++
    return d
  }
  const keys = [...new Set(units.flatMap((u) => [...u.rowOf.keys()]))]
    .filter(hasFinishPlan)
    .sort((a, b) => depth(a) - depth(b) || order.indexOf(a) - order.indexOf(b))

  for (const key of keys) {
    const rule = finishPlanOf(settings, key)
    // 동·코어마다 남은 묶음(아래층부터)
    const queues = units.flatMap((u, ui) => {
      const row = u.rowOf.get(key)
      if (!row) return []
      const pred = u.predOf(key)
      const frameLead = u.frame && rule.frameLead != null ? rule.frameLead : null
      // 선행(공종·골조)이 없는 공종은 이 동에서 이미 시작한 경우만
      if (!(pred || frameLead != null || row.done > 0)) return []
      const left = row.floors.filter((f) => f.units > 0 && f.done < f.units).map((f) => f.floor)
      const batches: number[][] = []
      for (let i = 0; i < left.length; i += rule.floorsPerBatch) batches.push(left.slice(i, i + rule.floorsPerBatch))
      return [{ ui, u, row, predEnds: pred ? u.ends.get(pred)! : null, frameLead, batches, next: 0, blocked: false, after: null as IsoDate | null }]
    })
    /** 그 묶음을 시작할 수 있는 가장 이른 날 (선행·골조). 모르면 null → 그 동·코어는 여기서 멈춘다 */
    const readyOf = (q: (typeof queues)[number], batch: number[]): IsoDate | null => {
      let ready = addDays(today, 1)
      if (q.predEnds) {
        for (const fl of batch) {
          const pe = q.predEnds.get(fl)
          if (!pe) return null // 선행이 이 층을 언제 끝낼지 모른다
          const r = addDays(pe, rule.gapDays + 1)
          if (r > ready) ready = r
        }
      }
      if (q.frameLead != null) {
        const poured = q.u.frame!(Math.max(...batch) + q.frameLead)
        if (!poured) return null // 골조가 그 층을 언제 타설할지 모른다
        const r = addDays(poured, rule.gapDays + 1)
        if (r > ready) ready = r
      }
      // 겹쳐 이동: 같은 곳의 앞 묶음이 끝난 다음 날부터
      if (q.after && q.after > ready) ready = q.after
      return ready
    }
    const move = rule.moveDays ?? null
    const teamFree = Array.from({ length: Math.max(1, rule.teams ?? 1) }, () => addDays(today, 1))
    for (;;) {
      const free = [...teamFree].sort()[0]
      const team = teamFree.indexOf(free)
      let best: { q: (typeof queues)[number]; start: IsoDate } | null = null
      for (const q of queues) {
        if (q.blocked || q.next >= q.batches.length) continue
        const batch = q.batches[q.next]
        const ready = readyOf(q, batch)
        if (!ready) {
          q.blocked = true
          continue
        }
        const start = ready > free ? ready : free
        const better =
          !best ||
          start < best.start ||
          (start === best.start && (batch[0] < best.q.batches[best.q.next][0] || (batch[0] === best.q.batches[best.q.next][0] && q.ui < best.q.ui)))
        if (better) best = { q, start }
      }
      if (!best || best.start > limit) break
      // 동마다 겹쳐 이동: 그 동의 다른 코어 다음 묶음도 같은 날(가장 늦게 풀리는 코어에 맞춰) 함께
      let group = [best.q]
      let start = best.start
      if (move != null && rule.moveBy === "building") {
        const pick = best.q
        group = queues.filter((x) => x.u.buildingNo === pick.u.buildingNo && !x.blocked && x.next < x.batches.length && readyOf(x, x.batches[x.next]))
        for (const x of group) {
          const rd = readyOf(x, x.batches[x.next])!
          if (rd > start) start = rd
        }
        if (start > limit) break
      }
      const end = addDays(start, rule.daysPerBatch - 1)
      for (const q of group) {
        const batch = q.batches[q.next++]
        const ends = q.u.ends.get(key)!
        for (const fl of batch) ends.set(fl, end)
        const units = q.row.floors.filter((f) => batch.includes(f.floor)).reduce((s, f) => s + (f.units - f.done), 0)
        const bars = q.u.bars.get(key) ?? []
        bars.push({ start, end, floorFrom: Math.min(...batch), floorTo: Math.max(...batch), units })
        q.u.bars.set(key, bars)
        if (move != null) q.after = addDays(end, 1)
      }
      teamFree[team] = move != null ? addDays(start, move) : addDays(end, 1)
    }
  }

  const out = new Map<number, FinishPlanRow[]>()
  for (const b of buildings) {
    out.set(
      b.buildingNo,
      b.rows.map((r) => {
        const u = units.find((x) => x.buildingNo === b.buildingNo && x.core === r.core)
        // 같은 동·코어 막대는 날짜순으로 (배정 순서가 날짜순이 아닐 수 있다)
        const bars = [...(u?.bars.get(r.trade) ?? [])].sort((x, y) => x.start.localeCompare(y.start) || x.floorFrom - y.floorFrom)
        return { trade: r.trade, core: r.core, bars }
      }),
    )
  }
  return out
}
