// 마감 공정표 간트 (2026-10-30, 사용자 요청: 하남교산OT 「건축 예정공정표(실적관리)」 처럼 동 × 공종 줄에 「5~6F 단열재」 막대).
//
// 공종 = 택트 인원과 같은 14개로 고정 (2026-10-31 사용자): PL창틀, 내장단열, 내장경량벽체, 내장합지, 방수공사, 기포방통, 내장천장,
//   벽타일, 바닥타일, 가구공사, 내장몰딩, 천장도배, 벽도배, 마루공사. 스마트웍스 공종이 없는 것도 줄을 두고 예정만 낸다.
// 스마트웍스 공종 → 14개 연결은 현장 설정 「공종 연결」(settings.finishMap, 스마트웍스 공종 id → 공종 키, null = 제외)이 우선,
//   없으면 이름 규칙(finishTradeOf, 자동 추천). 스마트웍스는 현장마다 공종을 자유롭게 만들기 때문(1차 「기본 욕실벽」 / 2차 「타일공사」).
//
// 세대 완료 = 그 동에서 쓰인 세부 공종(타일 거실·욕실…)이 모두 끝난 날.
// 실적 막대: 그 공종을 끝낸 세대의 완료일을 날짜순으로 이어 붙이고, 3일 넘게 끊기면 새 막대. 막대 이름 = 그 세대들의 층 범위("5~6F").
// 코어 단위 (2026-10-30 사용자: 「마감작업은 코어 단위로 움직인다」): 동의 라인(호)을 코어로 나눠 공종 줄도 코어마다.
//   코어 나누기 = 설정 동 목록의 코어별 세대수(합 = 라인 수일 때). 비었으면 스마트웍스 라인 높이 규칙(groupLinesToCoreGroups,
//   「스마트웍스에서 불러오기」와 같음) — 그 코어 수가 동 목록 코어 수와 다르면 동 전체 한 줄.
// 예정 막대: 남은 세대가 있고 최근 4주 속도가 주당 1세대 이상이면, 내일부터 남은 세대 ÷ 속도까지. 층 범위 = 아직 다 끝나지 않은 층.
import { addDays, type IsoDate } from "../calendar/date.ts"
import { groupLinesToCoreGroups } from "../rules/smartworks.ts"
import type { FinishBuildingIn, FinishRoomIn, FinishTypeIn, FinishWorkIn } from "./aggregate.ts"

/** 마감 간트 동 입력: 설정 동 목록의 코어 수·코어별 세대수(모르면 0) */
export type FinishGanttBuildingIn = FinishBuildingIn & { cores?: number; coreUnits?: number[] }
export type FinishCore = { core: number; lines: string[]; source: "settings" | "smartworks" }

/** 동 라인 → 코어. 코어 1개(또는 못 나누면) 빈 배열 */
export function splitLinesToCores(lines: string[], lineTops: number[], cores?: number, coreUnits?: number[]): FinishCore[] {
  let units: number[] | null = null
  let source: FinishCore["source"] = "settings"
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
  if (coreUnits && coreUnits.length > 1 && coreUnits.every((u) => u > 0) && sum(coreUnits) === lines.length) units = coreUnits
  else if (lines.length) {
    const g = groupLinesToCoreGroups(lineTops).map((x) => x.units)
    if (g.length > 1 && (cores == null || cores === g.length)) {
      units = g
      source = "smartworks"
    }
  }
  if (!units) return []
  const out: FinishCore[] = []
  let i = 0
  units.forEach((u, k) => {
    out.push({ core: k + 1, lines: lines.slice(i, i + u), source })
    i += u
  })
  return out
}

export type FinishTradeKey =
  | "wallTile"
  | "floorTile"
  | "ceilingWallpaper"
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
  | "waterproof"
  | "screed"
  | "kitchen"
  | "furniture"
  | "wallpaper"
  | "flooring"

export type FinishTrade = { key: FinishTradeKey; group: string; label: string }

/**
 * 화면 순서 = 공종 목록 (2026-10-31 사용자 지정 14개, 택트 인원과 같은 이름). group 은 색 묶음.
 * 예전 키(pvcAll·tile·baseboard·kitchen·interiorAll·windowSash·glass)는 저장된 설정을 읽으려고 타입에만 남긴다.
 */
export const FINISH_TRADES: readonly FinishTrade[] = [
  { key: "windowFrame", group: "PL창호", label: "PL창틀" },
  { key: "insulation", group: "내장", label: "내장단열" },
  { key: "lightWall", group: "내장", label: "내장경량벽체" },
  { key: "wallGypsum", group: "내장", label: "내장합지" },
  { key: "waterproof", group: "방수", label: "방수공사" },
  { key: "screed", group: "기포+방통", label: "기포방통" },
  { key: "ceilingGypsum", group: "내장", label: "내장천장" },
  { key: "wallTile", group: "타일", label: "벽타일" },
  { key: "floorTile", group: "타일", label: "바닥타일" },
  { key: "furniture", group: "가구", label: "가구공사" },
  { key: "molding", group: "내장", label: "내장몰딩" },
  { key: "ceilingWallpaper", group: "도배", label: "천장도배" },
  { key: "wallpaper", group: "도배", label: "벽도배" },
  { key: "flooring", group: "마루", label: "마루공사" },
]

/** 스마트웍스에 맞는 공종이 없어도 줄을 두는 공종 — 세대(층·라인)로 줄을 만들어 예정만 낸다. 14개 모두 (2026-10-31) */
export const ALWAYS_FINISH_TRADES: ReadonlySet<FinishTradeKey> = new Set(FINISH_TRADES.map((t) => t.key))

/**
 * 공종 이름 → 14개 공종 (맞는 것이 없으면 null) — 현장 「공종 연결」 의 자동 추천. 먼저 맞는 규칙이 이긴다.
 * 남원주 1차(2026-10-31) 스마트웍스 이름 기준: 합지석고·경량석고 → 내장합지, 방통1차·2차 → 기포방통, 기본/옵션 욕실벽·주방벽체·아트월 → 벽타일,
 * 화장실바닥타일·세대 바닥 → 바닥타일, 일반·주방·욕실·시스템가구 → 가구공사, 도배공사 → 벽도배, 천정공사 → 내장천장.
 */
export function finishTradeOf(name: string): FinishTradeKey | null {
  const n = name.replace(/\s+/g, "")
  if (/몰딩|걸레받이/.test(n)) return "molding"
  if (/창짝|유리/.test(n)) return null
  if (/창틀|^PL창호(공사)?$/.test(n)) return /사춤|코킹|목창호/.test(n) ? null : "windowFrame"
  if (/가구/.test(n)) return "furniture"
  if (/마루/.test(n)) return "flooring"
  // 도배: 천장·천정이 붙으면 천장도배, 아니면 벽도배 (「도배공사」 처럼 하나뿐이면 벽도배 — 현장 연결에서 바꾼다)
  if (/도배|벽지|초배/.test(n)) return /천장|천정/.test(n) ? "ceilingWallpaper" : "wallpaper"
  // 기포+방통 한 줄 — 세대 완료 = 둘 다 끝난 날
  if (/방통|방바닥|기포/.test(n)) return /청소|타일/.test(n) ? null : "screed"
  if (/방수/.test(n)) return /외벽|옥상|지붕|지하|측벽|자재인양구/.test(n) ? null : "waterproof"
  if (/바닥타일|세대바닥|화장실바닥/.test(n)) return "floorTile"
  if (/벽타일|욕실벽|주방벽|아트월/.test(n)) return "wallTile"
  if (/타일/.test(n)) return "floorTile"
  if (/천정|천장/.test(n)) return /욕실|EV/.test(n) ? null : "ceilingGypsum"
  if (/석고|합지/.test(n)) return "wallGypsum"
  if (/단열/.test(n)) return /외벽|실외기|발코니/.test(n) ? null : "insulation"
  if (/경량|스터드|런너|내장틀/.test(n)) return /사춤/.test(n) ? null : "lightWall"
  return null
}

/** 현장 공종 연결(스마트웍스 공종 id → 공종 키, null = 제외)을 먼저 보고, 없으면 이름 규칙 */
export function finishTradeOfType(map: Record<string, string | null> | undefined, type: { id: string; name: string }): FinishTradeKey | null {
  if (map && type.id in map) {
    const k = map[type.id]
    return k && FINISH_TRADES.some((t) => t.key === k) ? (k as FinishTradeKey) : null
  }
  return finishTradeOf(type.name)
}

export type FinishBar = {
  start: IsoDate
  end: IsoDate
  floorFrom: number
  floorTo: number
  units: number
  /** 실적 막대: 층별 완료 세대 (높은 층부터). 스마트웍스 마감입력 칸과 그대로 맞춰 보려고 */
  floorUnits?: { floor: number; units: number }[]
}

/** 층 목록 → "12·14~15F" (이어진 층은 묶고, 끊긴 층은 · 로) */
export function floorListText(floors: number[]): string {
  const fs = [...new Set(floors)].sort((a, b) => a - b)
  const parts: string[] = []
  const f = (n: number) => (n < 0 ? `B${-n}` : String(n))
  for (let i = 0; i < fs.length; ) {
    let j = i
    while (j + 1 < fs.length && fs[j + 1] === fs[j] + 1) j++
    parts.push(i === j ? f(fs[i]) : `${f(fs[i])}~${f(fs[j])}`)
    i = j + 1
  }
  return parts.length ? `${parts.join("·")}F` : ""
}
export type FinishGanttRow = {
  trade: FinishTradeKey
  /** 코어 번호(1부터). 동을 코어로 못 나누면 null = 동 전체 */
  core: number | null
  /** 이 공종으로 맞춘 스마트웍스 공종 이름들 */
  sources: string[]
  done: number
  total: number
  perWeek: number
  actual: FinishBar[]
  /** (참고) 최근 속도만으로 낸 예정 — 화면 예정은 planFinish(선행·층 묶음 규칙)를 쓴다 */
  forecast: FinishBar | null
  /** 층별 완료 (낮은 층부터). last = 그 층 마지막 완료일 (다 끝났으면 그 층 완료일) */
  floors: { floor: number; units: number; done: number; last: IsoDate | null }[]
}
export type FinishGanttBuilding = { buildingNo: number; name: string; cores: FinishCore[]; rows: FinishGanttRow[] }
export type FinishGantt = { trades: FinishTrade[]; buildings: FinishGanttBuilding[] }

const dayDiff = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

export function buildFinishGantt(input: {
  types: FinishTypeIn[]
  buildings: FinishGanttBuildingIn[]
  rooms: FinishRoomIn[]
  works: FinishWorkIn[]
  today: IsoDate
  /** 실적 막대를 끊는 간격(일). 기본 0 = 완료일마다 따로 (스마트웍스 마감입력 날짜와 그대로 맞게, 2026-10-30) */
  gapDays?: number
  /** 현장 공종 연결 (settings.finishMap). 없으면 이름 규칙만 */
  finishMap?: Record<string, string | null>
}): FinishGantt {
  const gap = input.gapDays ?? 0
  const tradeOfType = new Map<string, FinishTradeKey>()
  const namesOf = new Map<FinishTradeKey, Set<string>>()
  for (const t of input.types) {
    if (t.deleted) continue
    const k = finishTradeOfType(input.finishMap, t)
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
  const trades = FINISH_TRADES.filter((t) => namesOf.has(t.key) || ALWAYS_FINISH_TRADES.has(t.key))
  const since = addDays(input.today, -28)

  const buildings = input.buildings
    .map((b) => {
      const all = rooms.filter((r) => r.buildingId === b.id)
      const lines = [...new Set(all.map((r) => r.line))].sort((x, y) => x.localeCompare(y, "ko", { numeric: true }))
      const lineTops = lines.map((l) => Math.max(...all.filter((r) => r.line === l).map((r) => r.floor)))
      const cores = splitLinesToCores(lines, lineTops, b.cores, b.coreUnits)
      const slices: { core: number | null; mine: FinishRoomIn[] }[] = cores.length
        ? cores.map((c) => ({ core: c.core, mine: all.filter((r) => c.lines.includes(r.line)) }))
        : [{ core: null, mine: all }]
      const rows: FinishGanttRow[] = trades.flatMap((t) => slices.map(({ core, mine }): FinishGanttRow => {
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
            const fu = cur.floorUnits!.find((x) => x.floor === r.floor)
            if (fu) fu.units++
            else cur.floorUnits!.push({ floor: r.floor, units: 1 })
          } else actual.push({ start: d, end: d, floorFrom: r.floor, floorTo: r.floor, units: 1, floorUnits: [{ floor: r.floor, units: 1 }] })
        }
        for (const a of actual) a.floorUnits!.sort((x, y) => y.floor - x.floor)
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
        const floorNos = [...new Set(mine.map((r) => r.floor))].sort((x, y) => x - y)
        const floors = floorNos.map((f) => {
          const fr = mine.filter((r) => r.floor === f)
          const ds = fr.map((r) => doneAt.get(`${r.id}|${t.key}`)).filter((d): d is IsoDate => !!d)
          return { floor: f, units: fr.length, done: ds.length, last: ds.length ? ds.reduce((m, d) => (d > m ? d : m)) : null }
        })
        return { trade: t.key, core, sources: [...(namesOf.get(t.key) ?? [])], done, total, perWeek, actual, forecast, floors }
      }))
      return { buildingNo: b.buildingNo, name: b.name, cores, rows }
    })
    .sort((x, y) => x.buildingNo - y.buildingNo)

  return { trades, buildings }
}

/** 막대 층 이름: "5~6F", 한 층이면 "7F" */
export const floorRangeText = (from: number, to: number) => {
  const f = (n: number) => (n < 0 ? `B${-n}F` : `${n}F`)
  return from === to ? f(from) : `${f(from).replace(/F$/, "")}~${f(to)}`
}
