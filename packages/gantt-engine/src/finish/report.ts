// 작업일보 마감 줄 → 마감 간트 「일보 작업」 막대 (2026-10-30, 사용자 요청 1번).
//
//   ▶ 내장공사(15명)
//     - 101동, 102동 11~15층 천정            → 101동·102동 천장석고 11~15F
//     - 102동 1코어 16~20층 단열재            → 102동 단열 16~20F
//     - 101동 21~24층 PL창틀 시공             → 101동 창틀설치 21~24F
//     - 103동, 104동 21~최상층 화장실 1차 우레탄 → (간트 공종 아님)
//     - 401동, 403동 26-30F 단열재 양중        → 양중은 시공이 아니라 뺀다
// 골조 구간(골조·철근콘크리트·형틀·철근·콘크리트)은 읽지 않는다 — 최상층 「단열재 설치」 같은 골조 줄과 섞이지 않게.
// 같은 동·공종·같은 층 범위가 gap 일 안에 이어지면 막대 하나(작업 기간). 「~최상층」 은 동 최상층으로.
import type { IsoDate } from "../calendar/date.ts"
import { finishTradeOf, type FinishBar, type FinishTradeKey } from "./gantt.ts"

export type FinishReportItem = { buildingNo: number; trade: FinishTradeKey; floorFrom: number; floorTo: number; text: string }

const HEADER = /^\s*(?:[*●■◆○▶◎▣]|\d+\s*\.)\s*(.+)$/
// 읽지 않는 구간: 골조(최상층 단열재 설치 등과 섞임)·전기/설비(「천정 배관」 이 천장석고로 잡힘)·토목·관리 인원
const FRAMING = /골조|철근콘크리트|형틀|철근|콘크리트|토공|토목|파일|흙막이|가설|직원|직영|안전|장비|타워|경비|미화|전기|설비|기계|소방|통신|환기|배관|가스/
const NOT_WORK = /양중|반입|운반|인양|정리|청소|보수|해체|철거|검측|측량|먹매김|잔손|보양/
const BUILDINGS = /(\d{3,4})\s*동/g
// 층 범위: "11~15층", "16-20F", "21~최상층", "7F" … (B 층 포함)
const RANGE = /(B?\d{1,3})\s*(?:F|층)?\s*[~∼-]\s*(B?\d{1,3}\s*(?:F|층)|최상층|옥탑)|(?:^|[^\dA-Za-z])(B?\d{1,3})\s*(?:F\b|층)/gi

const num = (s: string) => {
  const t = s.replace(/\s|F|층/gi, "").toUpperCase()
  return t.startsWith("B") ? -Number(t.slice(1)) : Number(t)
}

/** 일보 원문에서 마감 줄을 읽는다. topFloorOf 로 「~최상층」 을 바꾼다(모르면 그 줄은 버린다) */
export function parseFinishReport(rawText: string, topFloorOf: (buildingNo: number) => number | null): FinishReportItem[] {
  const out: FinishReportItem[] = []
  let framing = false
  for (const line of rawText.split(/\r?\n/)) {
    const h = HEADER.exec(line)
    if (h && !/^\s*-/.test(line)) {
      framing = FRAMING.test(h[1])
      continue
    }
    if (framing || !/^\s*-/.test(line)) continue
    // "/" 로 나뉜 조각마다 (동 번호가 없으면 앞 조각 동을 이어받는다)
    let lastNos: number[] = []
    for (const seg of line.replace(/^\s*-\s*/, "").split(/\s*\/\s*/)) {
      const nos = [...seg.matchAll(BUILDINGS)].map((m) => Number(m[1]))
      if (nos.length) lastNos = nos
      if (!lastNos.length) continue
      if (NOT_WORK.test(seg)) continue
      const body = seg.replace(BUILDINGS, " ").replace(/\d+\s*코어/g, " ")
      const trade = finishTradeOf(body.replace(/\(\d+명?\)/g, "").replace(/(B?\d{1,3}\s*(?:F|층)?\s*[~∼-]\s*)?(B?\d{1,3}\s*(?:F|층)|최상층)/gi, " ").trim())
      if (!trade) continue
      // 층 범위: 조각 안의 모든 층 표기를 모아 최소~최대
      const floors: (number | "top")[] = []
      for (const m of body.matchAll(RANGE)) {
        if (m[1]) {
          floors.push(num(m[1]))
          floors.push(/최상층|옥탑/.test(m[2]) ? "top" : num(m[2]))
        } else if (m[3]) floors.push(num(m[3]))
      }
      if (!floors.length) continue
      for (const no of lastNos) {
        const fs = floors.map((f) => (f === "top" ? topFloorOf(no) : f)).filter((f): f is number => f != null && Number.isFinite(f))
        if (!fs.length) continue
        out.push({ buildingNo: no, trade, floorFrom: Math.min(...fs), floorTo: Math.max(...fs), text: seg.trim() })
      }
    }
  }
  return out
}

export type FinishReportBar = FinishBar & { days: number; texts: string[] }
export type FinishReportRow = { buildingNo: number; trade: FinishTradeKey; bars: FinishReportBar[] }

const dayDiff = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/** 날짜별 일보 → 동·공종별 「일보 작업」 막대. 같은 층 범위가 gapDays 안에 이어지면 하나로 */
export function buildFinishReportBars(
  reports: { date: IsoDate; rawText: string }[],
  topFloorOf: (buildingNo: number) => number | null,
  gapDays = 3,
): FinishReportRow[] {
  const rows = new Map<string, FinishReportRow>()
  for (const r of [...reports].sort((a, b) => a.date.localeCompare(b.date))) {
    const seen = new Set<string>()
    for (const it of parseFinishReport(r.rawText, topFloorOf)) {
      const key = `${it.buildingNo}|${it.trade}`
      const row = rows.get(key) ?? { buildingNo: it.buildingNo, trade: it.trade, bars: [] }
      rows.set(key, row)
      const dup = `${key}|${it.floorFrom}|${it.floorTo}`
      if (seen.has(dup)) continue // 같은 날 같은 범위 두 번(전기·설비 등)
      seen.add(dup)
      const open = [...row.bars]
        .reverse()
        .find((b) => b.floorFrom === it.floorFrom && b.floorTo === it.floorTo && dayDiff(b.end, r.date) <= gapDays)
      if (open) {
        if (r.date > open.end) {
          open.end = r.date
          open.days++
        }
        if (!open.texts.includes(it.text)) open.texts.push(it.text)
      } else row.bars.push({ start: r.date, end: r.date, floorFrom: it.floorFrom, floorTo: it.floorTo, units: 0, days: 1, texts: [it.text] })
    }
  }
  return [...rows.values()].sort((a, b) => a.buildingNo - b.buildingNo)
}
