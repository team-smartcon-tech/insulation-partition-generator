// 마감 공정표 간트 (2026-10-30, 사용자 요청: 하남교산OT 「건축 예정공정표(실적관리)」 처럼 동 × 공종 줄에 「5~6F 단열재」 막대).
//
// 공종은 우선 아래만 (사용자 지정):
//   내장 — 단열, 경량벽체, 벽석고, 천장석고, 걸레받이, 몰딩 / PL창호 — 창틀설치, 창짝설치 / 유리 / 타일 / 방통 / 주방가구 / 일반가구 / 도배 / 마루
// 스마트웍스 공종 이름은 현장마다 달라 이름 규칙으로 맞춘다. 「내장공사」「PL창호공사」 처럼 한 덩어리 이름은 세부를 알 수 없어 「(구분 없음)」 줄.
//
// 세대 완료 = 그 동에서 쓰인 세부 공종(타일 거실·욕실…)이 모두 끝난 날.
// 실적 막대: 그 공종을 끝낸 세대의 완료일을 날짜순으로 이어 붙이고, 3일 넘게 끊기면 새 막대. 막대 이름 = 그 세대들의 층 범위("5~6F").
// 예정 막대: 남은 세대가 있고 최근 4주 속도가 주당 1세대 이상이면, 내일부터 남은 세대 ÷ 속도까지. 층 범위 = 아직 다 끝나지 않은 층.
import { addDays, type IsoDate } from "../calendar/date.ts"
import type { FinishBuildingIn, FinishRoomIn, FinishTypeIn, FinishWorkIn } from "./aggregate.ts"

export type FinishTradeKey =
  | "insulation"
  | "lightWall"
  | "wallGypsum"
  | "ceilingGypsum"
  | "baseboard"
  | "molding"
  | "interiorAll"
  | "windowFrame"
  | "windowSash"
  | "pvcAll"
  | "glass"
  | "tile"
  | "screed"
  | "kitchen"
  | "furniture"
  | "wallpaper"
  | "flooring"

export type FinishTrade = { key: FinishTradeKey; group: string; label: string }

/** 화면 순서 (사용자 지정 순) */
export const FINISH_TRADES: readonly FinishTrade[] = [
  { key: "insulation", group: "내장", label: "단열" },
  { key: "lightWall", group: "내장", label: "경량벽체" },
  { key: "wallGypsum", group: "내장", label: "벽석고" },
  { key: "ceilingGypsum", group: "내장", label: "천장석고" },
  { key: "baseboard", group: "내장", label: "걸레받이" },
  { key: "molding", group: "내장", label: "몰딩" },
  { key: "interiorAll", group: "내장", label: "내장(구분 없음)" },
  { key: "windowFrame", group: "PL창호", label: "창틀설치" },
  { key: "windowSash", group: "PL창호", label: "창짝설치" },
  { key: "pvcAll", group: "PL창호", label: "PL창호(구분 없음)" },
  { key: "glass", group: "유리", label: "유리" },
  { key: "tile", group: "타일", label: "타일" },
  { key: "screed", group: "방통", label: "방통" },
  { key: "kitchen", group: "가구", label: "주방가구" },
  { key: "furniture", group: "가구", label: "일반가구" },
  { key: "wallpaper", group: "도배", label: "도배" },
  { key: "flooring", group: "마루", label: "마루" },
]

/** 공종 이름 → 마감 간트 공종 (맞는 것이 없으면 null). 먼저 맞는 규칙이 이긴다 */
export function finishTradeOf(name: string): FinishTradeKey | null {
  const n = name.replace(/\s+/g, "")
  if (/걸레받이/.test(n)) return "baseboard"
  if (/몰딩/.test(n)) return "molding"
  if (/창짝/.test(n)) return /사춤|코킹/.test(n) ? null : "windowSash"
  if (/창틀/.test(n)) return /사춤|코킹|목창호/.test(n) ? null : "windowFrame"
  if (/^PL창호(공사)?$/.test(n)) return "pvcAll"
  if (/유리/.test(n)) return "glass"
  if (/주방가구/.test(n)) return "kitchen"
  if (/일반가구|시스템가구|^가구공사$/.test(n)) return "furniture"
  if (/마루/.test(n)) return "flooring"
  if (/방통|방바닥/.test(n)) return /청소|타일/.test(n) ? null : "screed"
  if (/타일/.test(n)) return "tile"
  if (/천정|천장/.test(n)) return /욕실|EV/.test(n) ? null : "ceilingGypsum"
  if (/석고/.test(n)) return "wallGypsum"
  if (/단열/.test(n)) return /외벽|실외기|발코니/.test(n) ? null : "insulation"
  if (/경량|스터드|런너|내장틀/.test(n)) return /사춤/.test(n) ? null : "lightWall"
  if (/도배|합지|초배/.test(n)) return "wallpaper"
  if (/^내장(공사)?$/.test(n)) return "interiorAll"
  return null
}

export type FinishBar = { start: IsoDate; end: IsoDate; floorFrom: number; floorTo: number; units: number }
export type FinishGanttRow = {
  trade: FinishTradeKey
  /** 이 공종으로 맞춘 스마트웍스 공종 이름들 */
  sources: string[]
  done: number
  total: number
  perWeek: number
  actual: FinishBar[]
  /** 예정 (남은 층, 최근 속도). 속도가 주당 1세대 미만이면 null */
  forecast: FinishBar | null
}
export type FinishGanttBuilding = { buildingNo: number; name: string; rows: FinishGanttRow[] }
export type FinishGantt = { trades: FinishTrade[]; buildings: FinishGanttBuilding[] }

const dayDiff = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

export function buildFinishGantt(input: {
  types: FinishTypeIn[]
  buildings: FinishBuildingIn[]
  rooms: FinishRoomIn[]
  works: FinishWorkIn[]
  today: IsoDate
  /** 실적 막대를 끊는 간격(일). 기본 3 — 주말·하루 쉼은 이어 본다 */
  gapDays?: number
}): FinishGantt {
  const gap = input.gapDays ?? 3
  const tradeOfType = new Map<string, FinishTradeKey>()
  const namesOf = new Map<FinishTradeKey, Set<string>>()
  for (const t of input.types) {
    if (t.deleted) continue
    const k = finishTradeOf(t.name)
    if (!k) continue
    tradeOfType.set(t.id, k)
    namesOf.set(k, (namesOf.get(k) ?? new Set()).add(t.name))
  }
  const rooms = input.rooms.filter((r) => !r.isVoid)
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  // 세대 × 스마트웍스 공종 → 완료일 (여러 번이면 가장 늦은 날)
  const typeDone = new Map<string, IsoDate>()
  for (const w of input.works) {
    if (!tradeOfType.has(w.typeId) || !roomById.has(w.roomId) || !w.date) continue
    const key = `${w.roomId}|${w.typeId}`
    const prev = typeDone.get(key)
    if (!prev || w.date > prev) typeDone.set(key, w.date)
  }
  const typesOfTrade = new Map<FinishTradeKey, string[]>()
  for (const [id, k] of tradeOfType) typesOfTrade.set(k, [...(typesOfTrade.get(k) ?? []), id])
  // 세대 × 간트 공종 → 완료일: 그 동에서 쓰인 세부 공종(타일 거실·욕실·주방…, 일반가구 침실1·2·드레스룸…)이 모두 끝난 날.
  // 그 동에서 한 번도 기록이 없는 세부 공종은 안 쓰는 이름으로 보고 뺀다
  const doneAt = new Map<string, IsoDate>()
  for (const b of input.buildings) {
    const mine = rooms.filter((r) => r.buildingId === b.id)
    for (const [k, ids] of typesOfTrade) {
      const used = ids.filter((id) => mine.some((r) => typeDone.has(`${r.id}|${id}`)))
      if (!used.length) continue
      for (const r of mine) {
        const ds = used.map((id) => typeDone.get(`${r.id}|${id}`))
        if (ds.every(Boolean)) doneAt.set(`${r.id}|${k}`, (ds as IsoDate[]).reduce((m, d) => (d > m ? d : m)))
      }
    }
  }
  const trades = FINISH_TRADES.filter((t) => namesOf.has(t.key))
  const since = addDays(input.today, -28)

  const buildings = input.buildings
    .map((b) => {
      const mine = rooms.filter((r) => r.buildingId === b.id)
      const rows: FinishGanttRow[] = trades.map((t) => {
        const finished = mine
          .map((r) => ({ r, d: doneAt.get(`${r.id}|${t.key}`) }))
          .filter((x): x is { r: FinishRoomIn; d: IsoDate } => !!x.d)
          .sort((x, y) => x.d.localeCompare(y.d) || x.r.floor - y.r.floor)
        // 실적 막대: 완료일이 gap 일 넘게 끊기면 새 막대
        const actual: FinishBar[] = []
        for (const { r, d } of finished) {
          const cur = actual.at(-1)
          if (cur && dayDiff(cur.end, d) <= gap) {
            cur.end = d
            cur.floorFrom = Math.min(cur.floorFrom, r.floor)
            cur.floorTo = Math.max(cur.floorTo, r.floor)
            cur.units++
          } else actual.push({ start: d, end: d, floorFrom: r.floor, floorTo: r.floor, units: 1 })
        }
        const done = finished.length
        const total = mine.length
        const recent = finished.filter((x) => x.d > since).length
        const perWeek = Math.round((recent / 4) * 10) / 10
        let forecast: FinishBar | null = null
        const left = mine.filter((r) => !doneAt.has(`${r.id}|${t.key}`))
        if (left.length && perWeek >= 1) {
          const floors = left.map((r) => r.floor)
          forecast = {
            start: addDays(input.today, 1),
            end: addDays(input.today, Math.max(1, Math.ceil((left.length / perWeek) * 7))),
            floorFrom: Math.min(...floors),
            floorTo: Math.max(...floors),
            units: left.length,
          }
        }
        return { trade: t.key, sources: [...(namesOf.get(t.key) ?? [])], done, total, perWeek, actual, forecast }
      })
      return { buildingNo: b.buildingNo, name: b.name, rows }
    })
    .sort((x, y) => x.buildingNo - y.buildingNo)

  return { trades, buildings }
}

/** 막대 층 이름: "5~6F", 한 층이면 "7F" */
export const floorRangeText = (from: number, to: number) => {
  const f = (n: number) => (n < 0 ? `B${-n}F` : `${n}F`)
  return from === to ? f(from) : `${f(from).replace(/F$/, "")}~${f(to)}`
}
