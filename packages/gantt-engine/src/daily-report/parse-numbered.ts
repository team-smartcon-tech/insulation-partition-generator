// 번호 붙은 공사 구간 양식의 작업일보 (스마트웍스 남원주역세권 2차 AC5, 2026-08~10 지하·저층 골조).
//
// 입력 예:
//   1. 형틀 공사 (133)
//   * 형틀(100)
//   - 501동 RF 바닥 거푸집 설치(8)
//   - 503동 B1F 벽체 및 1F 바닥 거푸집 설치(10)
//   - 503동 주변주차장 B1F 바닥 거푸집 설치(4)        ← "주변 …" 은 그 동이 아니라 옆 부대시설 → 뺀다
//   * 시스템(7)
//   - 503동 B1F 시스템 동바리 설치(7)        ← 동바리는 시스템 동바리만 (화면 「시스템」)
//   * 해체/정리(19)                           ← 거푸집 해체는 공정 단계가 아니다 (2026-10-30 사용자 결정)
//   - 503동 주변 램프#2 및 전기실 B2F 벽체 거푸집 해체 및 정리(19)
//   2. 철근 공사 (24)
//   - 501동 1F 바닥 철근 조립(10)
//   3. 콘크리트 공사 (1)
//   4. 전기 공사 (7)
//   - 504동 B1F 바닥 박스 설치(2)
//   6. 설비 공사 (4)
//   - 504동, 505동 1F 바닥 슬리브 설치(2)
//
// 읽는 것: 형틀(벽·바닥 거푸집 설치, 시스템 동바리)·철근·콘크리트(타설: 벽체·합벽 W / 기둥 C / 바닥 S)·전기/설비(벽·바닥 박스·슬리브·배관 → 기전).
// 줄 끝 "(8)" 은 투입 인원이라 버린다. "502동, 503동", "501동~504동" 은 동마다 한 줄씩.
// "B1F 벽체 및 1F 바닥 거푸집 설치" 처럼 「및」 으로 묶인 것은 벽·바닥을 나눠 각자의 층으로 읽는다.
import type { Stage, WorkEntry } from "../contracts/index.ts"
import { NOT_POURED, pourStage, type ParsedWorkText } from "./parse-work-text.ts"

type Kind = "form" | "rebar" | "concrete" | "mep"

/** "1. 형틀 공사 (133)", "2. 철근공사", "3. 전기" */
const NUMBERED_HEADER = /^\s*\d+\s*\.\s*(.+?)\s*(?:\(\s*\d+\s*\))?\s*$/
/** "* 형틀(100)" 같은 하위 제목 */
const SUB_HEADER = /^\s*\*\s*(.+?)\s*(?:\(\s*[\d+\s]+\))?\s*$/
const ITEM = /^\s*-\s*(.+?)\s*$/
const HEADCOUNT_TAIL = /\s*\(\s*\d+\s*\)\s*$/
/** 층: B1F, 1F, 37층, RF, PH, PIT */
const FLOOR_TOKEN = /(?:^|[\s~,])(B?\d{1,3}\s*(?:F\b|층)|RF\b|PH\d*F?\b|PIT\b)/i
/** 줄 앞 동 목록: "501동", "502동, 503동", "501동~504동", "501,502동" */
const LEADING_BUILDINGS = /^((?:\d{3,4}\s*동?\s*[,~∼]\s*)*\d{3,4}\s*동)\s*/

/** 이 양식인가: 줄 앞에 "1. … 공사" 같은 번호 제목이 둘 이상 */
export function isNumberedFormat(rawText: string): boolean {
  let n = 0
  for (const line of rawText.split(/\r?\n/)) {
    const m = NUMBERED_HEADER.exec(line)
    if (m && /공사|형틀|철근|전기|설비|콘크리트/.test(m[1])) n++
    if (n >= 2) return true
  }
  return false
}

function kindOf(header: string): Kind | null {
  const h = header.replace(/\s+/g, "")
  if (/전기|설비|기계|소방/.test(h) && !/가설/.test(h)) return "mep"
  if (/형틀|거푸집|골조/.test(h)) return "form"
  if (/철근콘크리트/.test(h)) return "form"
  if (/철근/.test(h)) return "rebar"
  if (/콘크리트/.test(h)) return "concrete"
  return null
}

function parseFloorToken(tok: string): { floor: number | null; floorLabel?: string } {
  const t = tok.replace(/\s+/g, "").toUpperCase()
  const m = /^(B?)(\d{1,3})(?:F|층)$/.exec(t)
  if (m) return { floor: m[1] ? -Number(m[2]) : Number(m[2]) }
  return { floor: null, floorLabel: t }
}

/** "501동~504동" → [501..504], "502동, 503동" → [502, 503] */
function expandBuildings(s: string): number[] {
  const nums: number[] = []
  const parts = s.replace(/동/g, "").split(/\s*,\s*/)
  for (const p of parts) {
    const r = /^(\d{3,4})\s*[~∼]\s*(\d{3,4})$/.exec(p.trim())
    if (r) {
      const [a, b] = [Number(r[1]), Number(r[2])]
      for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 20; i++) nums.push(i)
    } else if (/^\d{3,4}$/.test(p.trim())) nums.push(Number(p.trim()))
  }
  return nums
}

/** 작업 문구 → 단계. part 는 벽/바닥 (구문에서 따로 넘긴다). */
function stageFor(kind: Kind, sub: string, text: string, part: "wall" | "slab" | null): Stage | null {
  const t = text.replace(/\s+/g, "")
  if (kind === "mep") {
    if (!/박스|슬리브|스리브|배관|이중관|매립|검측/.test(t)) return null
    return part === "slab" ? "SLAB_MEP" : part === "wall" ? "WALL_MEP" : null
  }
  if (/타설/.test(t)) return NOT_POURED.test(t) ? null : pourStage(t, part)
  if (kind === "concrete") return null // 면 보수·양생 등
  // 해체(거푸집·동바리 모두)는 공정 단계가 아니다
  if (/해체/.test(t) || /해체/.test(sub)) return null
  // 동바리는 시스템 동바리만 — 줄에 「시스템」 이 있거나 「* 시스템」 구간 아래. 그 외 동바리는 공정 단계로 보지 않는다
  if (/동바리|시스템/.test(t) || /시스템/.test(sub)) return /동바리/.test(t) && (/시스템/.test(t) || /시스템/.test(sub)) ? "SHORING" : null
  if (/철근/.test(t) || kind === "rebar") {
    if (!/철근|배근|조립/.test(t)) return null
    return part === "slab" ? "SLAB_REBAR" : part === "wall" ? "WALL_REBAR" : null
  }
  if (/거푸집|형틀|폼/.test(t)) return part === "slab" ? "FORM_SLAB" : part === "wall" ? "FORM_WALL" : null
  return null
}

/** 문구에서 층 표기를 모두 지운다 ("B2F~B1F 면 보수" → "면 보수") */
const stripFloors = (s: string) =>
  s.replace(/(?:B?\d{1,3}\s*(?:F\b|층)|RF\b|PH\d*F?\b|PIT\b)(?:\s*[~∼]\s*(?:B?\d{1,3}\s*(?:F\b|층)|RF\b))?/gi, " ").replace(/\s+/g, " ").trim()

/** 한 층 아래 (0층은 없다: 1F → B1F(-1), B1F → B2F, 2F → 1F) */
const storyBelow = (f: number) => (f === 1 ? -1 : f - 1)
const floorName = (f: number) => (f < 0 ? `B${-f}F` : `${f}F`)

const partOf = (s: string): "wall" | "slab" | null =>
  /바닥|슬라브|슬래브|슬랩|지붕/.test(s) ? "slab" : /벽/.test(s) ? "wall" : null

export function parseNumbered(rawText: string): ParsedWorkText {
  const entries: WorkEntry[] = []
  const unmatched: string[] = []
  let kind: Kind | null = null
  let sub = ""

  for (const line of rawText.split(/\r?\n/)) {
    const h = NUMBERED_HEADER.exec(line)
    if (h && !ITEM.test(line)) {
      kind = kindOf(h[1])
      sub = ""
      continue
    }
    const sh = SUB_HEADER.exec(line)
    if (sh) {
      sub = sh[1]
      if (/미장|견출|정리정돈|비계|장비/.test(sub)) sub = "skip"
      continue
    }
    const it = ITEM.exec(line)
    if (!it || !kind || sub === "skip") continue
    const body = it[1].replace(HEADCOUNT_TAIL, "").trim()

    for (const seg of body.split(/\s*\/\s*/)) {
      const lb = LEADING_BUILDINGS.exec(seg)
      if (!lb) continue // 현장 관리, 반입 등 동이 없는 줄
      const nos = expandBuildings(lb[1])
      const rest = seg.slice(lb[0].length).trim()
      // "501동 주변 저수조 …", "503동 주변주차장 …" — 그 동이 아니라 옆 부대시설
      if (/^주변/.test(rest)) continue

      // 「및」 으로 묶인 구문: 각 구문의 벽/바닥·층을 따로. 공종 동사(거푸집 설치·철근 조립…)는 마지막 구문에서 공유
      const phrases = rest.split(/\s*및\s*/)
      // 마지막 구문에서 벽/바닥 뒤의 공종 동사만 ("주변 부대시설 벽체 거푸집 설치" → "거푸집 설치")
      const last = phrases[phrases.length - 1]
      const verbTail = (/(?:벽체|벽|바닥|슬래브|슬라브|슬랩)\s*(.*)$/.exec(last)?.[1] ?? last).trim()
      let lastFloor: { floor: number | null; floorLabel?: string } | null = null
      const picked: { floor: number | null; floorLabel?: string; part: "wall" | "slab" | null; text: string }[] = []
      phrases.forEach((ph, i) => {
        if (/주변/.test(ph)) return // 옆 부대시설
        const ft = FLOOR_TOKEN.exec(ph)
        if (ft) lastFloor = parseFloorToken(ft[1])
        const part = partOf(ph)
        if (!part && !ft) return // "정리" 같은 꼬리 구문
        const own = stripFloors(ph)
        const text = i === phrases.length - 1 ? own : `${own} ${verbTail}`.trim()
        picked.push({ ...(lastFloor ?? { floor: null }), part, text })
      })
      if (!picked.length) continue

      for (const p of picked) {
        const stage = stageFor(kind, sub, p.text, p.part)
        if (kind === "mep" && !stage) continue // 배선·가설등 같은 것은 골조와 무관
        // 이 양식의 「NF 바닥」 은 그 층 바닥 슬래브 = 아래층 천장 → 아래층 사이클 (1F 바닥 → B1F, B1F 바닥 → B2F).
        // 바닥 거푸집·철근·기전·타설만. 벽·시스템 동바리는 원문 층 그대로, RF 처럼 숫자 없는 층도 그대로 (2026-10-30 사용자 확인)
        const toStoryBelow = p.part === "slab" && stage !== "SHORING" && p.floor != null
        const floor = toStoryBelow ? storyBelow(p.floor!) : p.floor
        const text = toStoryBelow ? `${p.text} (원문 ${floorName(p.floor!)})` : p.text
        for (const no of nos) {
          entries.push({
            building: `${no}동`,
            buildingNo: no,
            floor,
            ...(p.floorLabel ? { floorLabel: p.floorLabel } : {}),
            text,
            stage,
          })
        }
      }
    }
  }
  return { entries, unmatched }
}
