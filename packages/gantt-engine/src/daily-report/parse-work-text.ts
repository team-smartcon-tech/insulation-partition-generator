// 스마트웍스(DCR) 작업일보 글에서 골조 공정에 해당하는 작업을 읽어낸다.
//
// 입력 예 (CTPA "주요작업 LIST" 와 같은 모양):
//   * 골조(97)
//   - 401동: 38F 바닥 먹매김 / 38F 갱폼인양
//   - 404동: 37F 벽체 철근배관            ← 골조 구간의 "철근배관" 은 철근 배근이다 (기전은 아래 구간에 따로)
//   * 전기(24)
//   - 401동 38F 벽체 배관작업 / 405동 37F 바닥 배관작업 / 근생#2 2F 벽체 배관작업
//   * 기계 설비(18)
//   - 401동 38F 벽체 배관 설치 / 402동 38F 바닥 이중관 설치 / 지하주차장 B4F 전기실 및 펌프실 덕트설치
//
// 읽는 구간: 골조(먹매김·갱폼·철근·알폼·타설), 전기·기계 설비(벽체/바닥 배관 → 기전·검측).
// 줄 모양 둘 다 지원: "- <동>: <작업> / <작업>" (동이 줄 앞에 한 번) 와 "- <동> <작업> / <동> <작업>" (작업마다 동).
// 요약 글은 AI 가 쓴 것이라 날마다 모양이 조금씩 다를 수 있다 — 못 읽은 줄은 버리지 않고 unmatched 로 돌려준다.
import type { Stage, WorkEntry } from "../contracts/index.ts"

export type ParsedWorkText = { entries: WorkEntry[]; unmatched: string[] }

export type Section = "structure" | "electric" | "mechanical"

const SECTION_HEADER = /^\s*\*\s*(.+?)\s*(?:\(\d+\))?\s*$/
const COLON_LINE = /^\s*-\s*([^:：/]+?)\s*[:：]\s*(.+)$/
const DASH_LINE = /^\s*-\s*(.+)$/
// 층: "37F", "B2F", "37층" (전기·설비 일보는 "층" 으로도 적는다)
const FLOOR = /(?:^|\s)(B?\d{1,3})\s*(?:F\b|층)/i
const BUILDING_NO = /(\d{2,4})\s*동/
/** 작업 문구 앞에 붙은 동·구역 이름. "401동", "근생#2", "부대시설", "지하주차장" */
const LEADING_BUILDING =
  /^\s*(\d{2,4}\s*동|근생\s*#?\s*\d+|부대시설|지하주차장|주민공동시설|상가)\s*/

export function sectionOf(header: string): Section | null {
  if (/골조|구조/.test(header)) return "structure"
  if (/전기/.test(header)) return "electric"
  if (/설비|기계/.test(header)) return "mechanical"
  return null
}

/** 작업 문구 → 기준층 단계. 구간에 따라 읽는 규칙이 다르다. */
export function stageOf(text: string, section: Section = "structure"): Stage | null {
  const t = text.replace(/\s+/g, "")
  const isSlab = /바닥|슬라브|슬래브|슬랩/.test(t)
  const isWall = /벽/.test(t)

  if (section === "structure") {
    if (/먹매김|먹메김/.test(t)) return "MARK"
    if (/갱폼|갱품/.test(t)) return "GANGFORM"
    if (/타설/.test(t)) return "POUR"
    if (/알폼|알루미늄폼|알루미늄거푸집/.test(t)) return "ALFORM"
    if (/단열재/.test(t)) return "TOP_INSULATION" // 최상층 전용 (설계 §8-2)
    // 골조 구간의 "철근배관" 은 철근 배근으로 본다 — 기전은 전기·설비 구간에 따로 적힌다.
    if (/철근|배근/.test(t)) return isSlab ? "SLAB_REBAR" : isWall ? "WALL_REBAR" : null
    if (/검측/.test(t)) return isSlab ? "SLAB_MEP" : isWall ? "WALL_MEP" : null
    return null
  }

  // 전기·기계 설비: 벽체/바닥 배관(이중관 포함)·검측만 기전 단계로. 덕트·전기실 같은 것은 골조 단계가 아니다.
  if (/배관|이중관|검측/.test(t)) return isSlab ? "SLAB_MEP" : isWall ? "WALL_MEP" : null
  return null
}

function parseFloor(s: string): number | null {
  const m = FLOOR.exec(s)
  if (!m) return null
  const v = m[1].toUpperCase()
  return v.startsWith("B") ? -Number(v.slice(1)) : Number(v)
}

/** 구간별 줄 목록. 읽는 구간(골조·전기·설비)만 돌려준다. */
export function extractSections(rawText: string): { section: Section; line: string }[] {
  const out: { section: Section; line: string }[] = []
  let current: Section | null = null
  for (const line of rawText.split(/\r?\n/)) {
    const h = SECTION_HEADER.exec(line)
    if (h) {
      current = sectionOf(h[1])
      continue
    }
    if (current && line.trim()) out.push({ section: current, line })
  }
  return out
}

/** 골조 구간의 줄만 (호환용) */
export function extractStructureSection(rawText: string): string[] {
  return extractSections(rawText)
    .filter((x) => x.section === "structure")
    .map((x) => x.line)
}

type Part = { building: string; text: string }

/**
 * 동이 아닌 장소로 시작하는 조각 ("근린생활시설#2 1F 바닥 배관작업", "지하주차장 B2F …").
 * 이런 조각은 앞 조각의 동을 이어받으면 안 된다 — 2026-09-19 남원주 일보에서
 * "404동 32F 벽체 배관작업 / 근린생활시설#2 1F 바닥 배관작업" 의 뒤 조각이 404동 1층 기전으로 읽혔다.
 */
const OTHER_PLACE =
  /^(근린생활시설|근생|지하\s*주차장|주차장|부대\s*(?:복리)?\s*시설|주민\s*공동\s*시설|관리동|경비실|상가|어린이집|커뮤니티|단지|외부|조경)\S*|^[^\s\d/]+#\d+/

/** 한 줄을 (동, 작업 문구) 묶음으로 쪼갠다. 못 쪼개면 null. */
function splitLine(line: string): Part[] | null {
  const colon = COLON_LINE.exec(line)
  if (colon) {
    const building = colon[1].trim()
    const parts = colon[2]
      .split(/\s*\/\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
    return parts.length ? parts.map((text) => ({ building, text })) : null
  }
  const dash = DASH_LINE.exec(line)
  if (!dash) return null
  const parts: Part[] = []
  let lastBuilding: string | null = null
  for (const raw of dash[1].split(/\s*\/\s*/)) {
    const p = raw.trim()
    if (!p) continue
    const b = LEADING_BUILDING.exec(p)
    if (b) {
      lastBuilding = b[1].replace(/\s+/g, "")
      parts.push({ building: lastBuilding, text: p.slice(b[0].length).trim() })
    } else if (lastBuilding && OTHER_PLACE.test(p)) {
      // 다른 장소: 그 장소를 건물로 둔다(동 번호 없음 → 공정표에서 빠짐). 뒤 조각도 이 장소를 이어받는다
      const place = OTHER_PLACE.exec(p)![0]
      lastBuilding = place
      parts.push({ building: place, text: p.slice(place.length).trim() })
    } else if (lastBuilding) {
      parts.push({ building: lastBuilding, text: p })
    } else {
      return null
    }
  }
  return parts.length ? parts : null
}

export function parseWorkText(rawText: string): ParsedWorkText {
  const entries: WorkEntry[] = []
  const unmatched: string[] = []

  for (const { section, line } of extractSections(rawText)) {
    const parts = splitLine(line)
    if (!parts) {
      // 전기·설비 구간은 골조와 무관한 줄이 많다. 골조 구간만 "못 읽음" 으로 알린다.
      if (section === "structure") unmatched.push(line.trim())
      continue
    }
    let lastFloor: number | null = null
    for (const { building, text: rawPart } of parts) {
      const own = parseFloor(rawPart)
      if (own !== null) lastFloor = own
      const floor: number | null = own ?? lastFloor
      const text = rawPart.replace(FLOOR, "").trim()
      const stage = stageOf(text, section)
      // 전기·설비 구간에서 기전 단계가 아닌 작업(덕트, 전기실 등)은 골조 공정과 무관하므로 싣지 않는다.
      if (section !== "structure" && !stage) continue
      const no = BUILDING_NO.exec(building)
      entries.push({ building, buildingNo: no ? Number(no[1]) : null, floor, text, stage })
    }
  }
  return { entries, unmatched }
}
