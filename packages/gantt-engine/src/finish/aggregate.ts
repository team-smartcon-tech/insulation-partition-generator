// 마감 공정표 집계 (2026-10-30). 스마트웍스 옵션마감의 세대별 마감 완료 기록 → 동 × 층 × 공종 진척과 공종별 요약.
//
// 원천 (dcr-app Supabase, 읽기 전용):
//   golgudo_finish_types     공종 (index 순, is_deleted, include_in_progress)
//   golgudo_finish_sequences 공종 선후행 (prerequisite_key → successor_key = 공종 id)
//   golgudo_rooms            세대 (동·층·라인, is_void)
//   golgudo_works            세대별 공종 완료일 (room_id, work_type_id, finished_at)
//
// - 공종 순서: 작업순서(선후행)를 위상 정렬, 같은 단계는 index 순. 지운 공종은 뺀다.
// - 칸: 그 층 세대 중 그 공종을 끝낸 세대 수 / 그 층 세대 수 (빈 세대 is_void 제외).
// - 요약: 완료 세대, 선두층(완료가 있는 가장 높은 층), 후미층(다 끝나지 않은 가장 낮은 층),
//   최근 4주 속도(세대/주), 예상 완료일 = 오늘 + 남은 세대 ÷ 속도. 선행 공종의 예상 완료보다 앞서지 않게 맞춘다.
import { addDays, type IsoDate } from "../calendar/date.ts"

export type FinishTypeIn = { id: string; name: string; index: number; deleted?: boolean; inProgress?: boolean }
export type FinishSeqIn = { prerequisite: string; successor: string }
export type FinishRoomIn = { id: string; buildingId: string; floor: number; line: string; isVoid?: boolean }
export type FinishWorkIn = { roomId: string; typeId: string; date: IsoDate }
export type FinishBuildingIn = { id: string; buildingNo: number; name: string }

export type FinishType = { id: string; name: string; inProgress: boolean }
export type FinishCell = { typeId: string; floor: number; done: number; last: IsoDate | null }
export type FinishTypeStat = {
  typeId: string
  done: number
  total: number
  /** 완료가 있는 가장 높은 층 */
  lead: number | null
  /** 다 끝나지 않은 가장 낮은 층 (다 끝났으면 null) */
  tail: number | null
  first: IsoDate | null
  last: IsoDate | null
  /** 최근 4주 완료 세대 ÷ 4 */
  perWeek: number
  /** 예상 완료일 (다 끝났으면 last, 정체·선행 대기면 null) */
  forecast: IsoDate | null
  /** done 완료 · progress 진행 · stalled 정체(최근 4주 주당 1세대 미만) · blocked 선행 공종 정체로 멈춤 · idle 시작 전.
   *  progress 라도 blockedBy 가 있으면 선행 정체로 완료 시점 미정 */
  status: "done" | "progress" | "stalled" | "blocked" | "idle"
  /** 완료를 막고 있는 맨 앞 선행 공종 (정체) */
  blockedBy?: string
}
export type FinishBuilding = {
  buildingNo: number
  name: string
  /** 층별 세대 수 (높은 층부터) */
  floors: { floor: number; units: number }[]
  cells: FinishCell[]
  stats: FinishTypeStat[]
}
export type FinishResult = { types: FinishType[]; sequences: { from: string; to: string }[]; buildings: FinishBuilding[] }

/** 작업순서 위상 정렬 (같은 단계는 index 순). 순환이 있으면 남은 것은 index 순으로 뒤에 */
export function orderFinishTypes(types: FinishTypeIn[], seqs: FinishSeqIn[]): FinishTypeIn[] {
  const live = types.filter((t) => !t.deleted)
  const ids = new Set(live.map((t) => t.id))
  const edges = seqs.filter((s) => ids.has(s.prerequisite) && ids.has(s.successor) && s.prerequisite !== s.successor)
  const indeg = new Map(live.map((t) => [t.id, 0]))
  for (const e of edges) indeg.set(e.successor, (indeg.get(e.successor) ?? 0) + 1)
  const byIndex = (a: FinishTypeIn, b: FinishTypeIn) => a.index - b.index
  const out: FinishTypeIn[] = []
  const ready = live.filter((t) => indeg.get(t.id) === 0).sort(byIndex)
  const done = new Set<string>()
  while (ready.length) {
    const t = ready.shift()!
    out.push(t)
    done.add(t.id)
    for (const e of edges.filter((x) => x.prerequisite === t.id)) {
      indeg.set(e.successor, (indeg.get(e.successor) ?? 1) - 1)
      if (indeg.get(e.successor) === 0) {
        ready.push(live.find((x) => x.id === e.successor)!)
        ready.sort(byIndex)
      }
    }
  }
  return [...out, ...live.filter((t) => !done.has(t.id)).sort(byIndex)]
}

export function aggregateFinish(input: {
  types: FinishTypeIn[]
  sequences: FinishSeqIn[]
  buildings: FinishBuildingIn[]
  rooms: FinishRoomIn[]
  works: FinishWorkIn[]
  today: IsoDate
}): FinishResult {
  const ordered = orderFinishTypes(input.types, input.sequences)
  const typeIds = new Set(ordered.map((t) => t.id))
  const rooms = input.rooms.filter((r) => !r.isVoid)
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  // 세대 × 공종 → 완료일 (같은 세대·공종이 여러 번이면 가장 늦은 날)
  const doneAt = new Map<string, IsoDate>()
  for (const w of input.works) {
    if (!typeIds.has(w.typeId) || !roomById.has(w.roomId) || !w.date) continue
    const k = `${w.roomId}|${w.typeId}`
    const prev = doneAt.get(k)
    if (!prev || w.date > prev) doneAt.set(k, w.date)
  }
  const since = addDays(input.today, -28)
  const preds = new Map<string, string[]>()
  for (const s of input.sequences) preds.set(s.successor, [...(preds.get(s.successor) ?? []), s.prerequisite])

  const buildings: FinishBuilding[] = input.buildings
    .map((b) => {
      const mine = rooms.filter((r) => r.buildingId === b.id)
      const floorNos = [...new Set(mine.map((r) => r.floor))].sort((x, y) => y - x)
      const floors = floorNos.map((f) => ({ floor: f, units: mine.filter((r) => r.floor === f).length }))
      const cells: FinishCell[] = []
      const stats: FinishTypeStat[] = []
      const forecastOf = new Map<string, IsoDate | null>()
      const statusOf = new Map<string, FinishTypeStat["status"]>()
      const blockedOf = new Map<string, string>()
      for (const t of ordered) {
        let done = 0
        let first: IsoDate | null = null
        let last: IsoDate | null = null
        let recent = 0
        let lead: number | null = null
        let tail: number | null = null
        for (const fl of [...floors].reverse()) {
          const fr = mine.filter((r) => r.floor === fl.floor)
          let n = 0
          let fLast: IsoDate | null = null
          for (const r of fr) {
            const d = doneAt.get(`${r.id}|${t.id}`)
            if (!d) continue
            n++
            if (!fLast || d > fLast) fLast = d
            if (!first || d < first) first = d
            if (!last || d > last) last = d
            if (d > since) recent++
          }
          done += n
          if (n > 0 && (lead == null || fl.floor > lead)) lead = fl.floor
          if (n < fl.units && tail == null) tail = fl.floor
          cells.push({ typeId: t.id, floor: fl.floor, done: n, last: fLast })
        }
        const total = mine.length
        const perWeek = Math.round((recent / 4) * 10) / 10
        let forecast: IsoDate | null = null
        let status: FinishTypeStat["status"]
        let blockedBy: string | undefined
        if (total > 0 && done >= total) {
          status = "done"
          forecast = last
        } else if (perWeek < 1) {
          // 최근 4주 주당 1세대 미만 — 날짜를 내면 몇 년 뒤가 나와 뒤 공종까지 번진다. 정체로 표시
          status = done > 0 ? "stalled" : "idle"
        } else {
          status = "progress"
          forecast = addDays(input.today, Math.ceil(((total - done) / perWeek) * 7))
        }
        // 선행 공종보다 먼저 끝나지 않는다. 선행이 정체·대기면 이 공종은 선행 대기
        if (status !== "done") {
          for (const p of preds.get(t.id) ?? []) {
            const ps = statusOf.get(p)
            const pf = forecastOf.get(p)
            const pBlocked = blockedOf.get(p)
            if (ps === "stalled" || ps === "blocked" || ps === "idle" || (ps === "progress" && pBlocked)) {
              // 선행이 멈췄으면 완료 시점을 정할 수 없다. 이 공종이 지금 진행 중이면 「진행」 은 그대로 두고 완료만 미정
              if (status !== "progress") status = "blocked"
              blockedBy = pBlocked ?? p
              forecast = null
            } else if (forecast && pf && pf > forecast) forecast = pf
          }
        }
        forecastOf.set(t.id, forecast)
        statusOf.set(t.id, status)
        if (blockedBy) blockedOf.set(t.id, blockedBy)
        stats.push({ typeId: t.id, done, total, lead, tail, first, last, perWeek, forecast, status, ...(blockedBy ? { blockedBy } : {}) })
      }
      return { buildingNo: b.buildingNo, name: b.name, floors, cells, stats }
    })
    .sort((x, y) => x.buildingNo - y.buildingNo)

  return {
    types: ordered.map((t) => ({ id: t.id, name: t.name, inProgress: t.inProgress !== false })),
    sequences: input.sequences.filter((s) => typeIds.has(s.prerequisite) && typeIds.has(s.successor)).map((s) => ({ from: s.prerequisite, to: s.successor })),
    buildings,
  }
}
