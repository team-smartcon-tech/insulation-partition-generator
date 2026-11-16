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
/** "● 철근콘크리트공사 (124)" — 기호로 시작하는 공사 제목 (평택고덕P1 1차, 2026-10-30) */
const BULLET_HEADER = /^\s*[●■◆○▶◎]\s*(.+?)\s*(?:\(\s*[\d+\s]+\))?\s*$/
const headerOf = (line: string) => NUMBERED_HEADER.exec(line) ?? BULLET_HEADER.exec(line)
/** "* 형틀(100)" 같은 하위 제목 */
const SUB_HEADER = /^\s*\*\s*(.+?)\s*(?:\(\s*[\d+\s]+\))?\s*$/
const ITEM = /^\s*-\s*(.+?)\s*$/
const HEADCOUNT_TAIL = /\s*\(\s*\d+\s*\)\s*$/
/** 층: B1F, 1F, 37층, RF, PH, PIT */
// "지하1층"·"지상1층" 도, "2동B2F" 처럼 앞 글자에 붙은 층도 읽는다 (앞이 숫자·영문만 아니면)
const FLOOR_TOKEN = /(?:^|[^0-9A-Za-z])((?:지하|지상)\s*\d{1,3}\s*층|B?\d{1,3}\s*(?:F\b|층)|RF\b|PH\d*F?\b|PIT\b)/i
/** 줄 앞 동 목록: "501동", "502동, 503동", "501동~504동", "501,502동" */
const LEADING_BUILDINGS = /^((?:\d{3,4}\s*동?\s*[,~∼-]\s*)*\d{3,4}\s*동)\s*/
/** 동 번호만 있는 조각 ("504동", "3610-3611동") */
// 끝 「동」 없는 번호만(「101, 102동」 을 쉼표로 나눈 앞 조각 「101」)도 다음 조각과 붙인다
const ONLY_BUILDINGS = /^(?:\d{3,4}\s*동?\s*[,~∼-]\s*)*\d{3,4}\s*동?$/

/** 공종 동사가 있는 문구인가 (없으면 「+」 로 이어진 뒤 조각의 동사를 빌린다) */
const HAS_VERB = /거푸집|형틀|폼|철근|배근|조립|타설|동바리|인양|인상|먹매김|먹메김|배관|박스|슬리브|스리브|이중관|해체|정리|청소|손보기|면처리/
const PART_WORD = /벽체|벽|바닥|슬래브|슬라브|슬랩|스라브/

/**
 * 「+」 로 이어진 동별 조각 (부산장안: 「1동6층벽체+3동18층바닥철근」 「4동 갱폼인양+3동 알폼조립」 「1동13층+2동15층 벽체」).
 * 앞 조각에 공종 동사가 없으면 마지막 조각의 동사를 빌린다 — 벽/바닥이 있으면 동사만(「철근」), 없으면 벽/바닥까지(「벽체」).
 */
function splitPlus(part: string): string[] {
  const items = part.split(/\s*\+\s*(?=\d{3,4}\s*동)/)
  if (items.length < 2) return items
  const restOf = (s: string) => stripFloors(s.replace(LEADING_BUILDINGS, ""))
  const lastRest = restOf(items[items.length - 1])
  const lastVerb = (PART_WORD.exec(lastRest) ? lastRest.slice(PART_WORD.exec(lastRest)!.index).replace(PART_WORD, "") : lastRest).trim()
  return items.map((s, i) => {
    if (i === items.length - 1) return s
    const rest = restOf(s)
    if (HAS_VERB.test(rest)) return s
    if (PART_WORD.test(rest)) return lastVerb ? `${s} ${lastVerb}` : s
    return lastRest ? `${s} ${lastRest}` : s
  })
}

/**
 * 한 줄을 작업 조각으로: 「/」 로 나누고, 「,」 뒤에 동 번호가 오면 거기서도 나눈다
 * ("3611동 … 마감, 3605동 … 설치"). 동 번호만 있는 조각은 다음 조각과 다시 붙인다 ("504동, 505동 1F 바닥 슬리브").
 * 「+」 뒤에 동 번호가 오면 거기서도 나눈다(splitPlus).
 * 골조 줄(everyComma)은 쉼표마다 나눈다 — 「1동13층벽체+3동25층바닥철근, 주민시설거푸집해체정리」 처럼 쉼표 뒤는 다른 작업이다.
 */
function splitSegments(body: string, everyComma = false): string[] {
  const out: string[] = []
  const comma = everyComma ? /\s*,\s*/ : /\s*,\s*(?=\d{3,4}\s*동|\d{3,4}\s*[~∼-]\s*\d{3,4}\s*동)/
  for (const part of body.split(/\s*\/\s*/)) {
    // 쉼표 뒤가 동 번호로 시작하지 않고 앞 조각에 공종 동사가 없으면 한 작업이다 (「107동 및 주차장 슬래브, 계단 거푸집 설치」)
    const raw = part.split(comma).reduce<string[]>((acc, p) => {
      const prev = acc.at(-1)
      if (everyComma && prev != null && !LEADING_BUILDINGS.test(p) && !HAS_VERB.test(stripFloors(prev.replace(LEADING_BUILDINGS, "")))) acc[acc.length - 1] = `${prev}, ${p}`
      else acc.push(p)
      return acc
    }, [])
    const pieces = raw.flatMap(splitPlus)
    let carry = ""
    for (const p of pieces) {
      const cur = carry ? `${carry}, ${p}` : p
      if (ONLY_BUILDINGS.test(cur.trim())) carry = cur
      else {
        out.push(cur)
        carry = ""
      }
    }
    if (carry) out.push(carry)
  }
  return out
}

/** 층 없이 써도 기준층 공종으로 보는 구문 — 공종 단어만 (공백 지운 뒤) */
const VERB_ONLY = /^(?:(?:갱폼|갱품)(?:인양|인상)(?:설치)?|(?:갱폼|갱품)설치|알폼(?:조립|설치)?|먹매김|먹메김|(?:바닥)?타설(?:관리)?)(?:작업)?$/

/** 골조 줄 안의 「항목 :」 (부산장안 「형틀+철근 : … , 기타 : … , 마감 : …」 「갱알폼: 2동갱폼인양」 「전동: …」) */
const LABEL = /(?:^|[,/]\s*)([가-힣+]{1,8})\s*[:：]\s*/g
/** 골조 공정이 아닌 항목 — 통째로 뺀다 */
const SKIP_LABEL = /마감|견출|할석|활석|미장|청소|해체|정리/

/** 골조 줄을 「항목 :」 별로 나눈다. 항목이 없으면 줄 전체 하나 */
function labeledChunks(body: string): { label: string | null; text: string }[] {
  const marks = [...body.matchAll(LABEL)]
  if (!marks.length) return [{ label: null, text: body }]
  const out: { label: string | null; text: string }[] = []
  const head = body.slice(0, marks[0].index).trim()
  if (head) out.push({ label: null, text: head })
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length
    out.push({ label: m[1], text: body.slice(m.index! + m[0].length, end).trim() })
  })
  return out
}

/** 이 양식인가: 줄 앞에 "1. … 공사" / "● … 공사" 같은 공사 제목이 둘 이상 */
export function isNumberedFormat(rawText: string): boolean {
  let n = 0
  for (const line of rawText.split(/\r?\n/)) {
    const m = headerOf(line)
    if (m && /공사|형틀|철근|전기|설비|콘크리트/.test(m[1])) n++
    if (n >= 2) return true
  }
  return false
}

function kindOf(header: string): Kind | null {
  const h = header.replace(/\s+/g, "")
  if (/전기|설비|기계|소방/.test(h) && !/가설/.test(h)) return "mep"
  if (/형틀|거푸집|골조/.test(h)) return "form"
  if (/철근콘크리|철콘/.test(h)) return "form" // 「철근콘크리공사」 오타도 (평택고덕)
  if (/철근/.test(h)) return "rebar"
  if (/콘크리트/.test(h)) return "concrete"
  return null
}

function parseFloorToken(tok: string): { floor: number | null; floorLabel?: string } {
  const t = tok.replace(/\s+/g, "").toUpperCase()
  const ug = /^(지하|지상)(\d{1,3})층$/.exec(t)
  if (ug) return { floor: ug[1] === "지하" ? -Number(ug[2]) : Number(ug[2]) }
  const m = /^(B?)(\d{1,3})(?:F|층)$/.exec(t)
  if (m) return { floor: m[1] ? -Number(m[2]) : Number(m[2]) }
  return { floor: null, floorLabel: t }
}

/** "501동~504동" → [501..504], "502동, 503동" → [502, 503] */
function expandBuildings(s: string): number[] {
  const nums: number[] = []
  const parts = s.replace(/동/g, "").split(/\s*,\s*/)
  for (const p of parts) {
    const r = /^(\d{3,4})\s*[~∼-]\s*(\d{3,4})$/.exec(p.trim())
    if (r) {
      const [a, b] = [Number(r[1]), Number(r[2])]
      for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 20; i++) nums.push(i)
    } else if (/^\d{3,4}$/.test(p.trim())) nums.push(Number(p.trim()))
  }
  return nums
}

/** 작업 문구 → 단계. part 는 벽/바닥 (구문에서 따로 넘긴다). */
function stageFor(kind: Kind, sub: string, text: string, part: "wall" | "slab" | null, floor: number | null = null): Stage | null {
  const t = text.replace(/\s+/g, "")
  if (kind === "mep") {
    if (!/박스|슬리브|스리브|배관|이중관|매립|수전구|검측/.test(t)) return null
    return part === "slab" ? "SLAB_MEP" : part === "wall" ? "WALL_MEP" : null
  }
  if (/타설/.test(t)) return NOT_POURED.test(t) ? null : pourStage(t, part)
  if (kind === "concrete") return null // 면 보수·양생 등
  // 해체(거푸집·동바리 모두)는 공정 단계가 아니다
  if (/해체/.test(t) || /해체/.test(sub)) return null
  // 기준층 공종 (화성남양1차 「- 104동 6층 알폼 설치」 「- 103동 4층 갱폼 인상」) — 거푸집(폼) 규칙보다 먼저
  if (/먹매김|먹메김/.test(t)) return "MARK"
  // 「갱폼 설치」 「갱폼인양설치」 도 인양 (부산장안). 탈형·수정·점검·보강은 아님
  if (/갱폼|갱품/.test(t)) return /인상|인양|설치/.test(t) && !/판넬|패널|소음|탈형|탕형|해체|수정|점검|보강|준비/.test(t) ? "GANGFORM" : null
  if (/알폼|알루미늄폼|알루미늄거푸집/.test(t)) return /타이|정리|제거|반입|양중/.test(t) ? null : "ALFORM"
  // 동바리는 시스템 동바리만 — 줄에 「시스템」 이 있거나 「* 시스템」 구간 아래. 그 외 동바리는 공정 단계로 보지 않는다
  if (/동바리|시스템/.test(t) || /시스템/.test(sub)) return /동바리/.test(t) && (/시스템/.test(t) || /시스템/.test(sub)) ? "SHORING" : null
  const formWord = /거푸집|형틀|폼/.test(t)
  if (/철근/.test(t) || (kind === "rebar" && !formWord)) {
    // 「철근 : 4동 12층 벽체」 처럼 철근 공사 아래에서는 동사가 없어도 철근
    if ((!/철근|배근|조립/.test(t) && kind !== "rebar") || /준비|정리|보수|반입|양중|가공|운반/.test(t)) return null
    return part === "slab" ? "SLAB_REBAR" : part === "wall" ? "WALL_REBAR" : null
  }
  // 거푸집 단어 없는 「벽체조립」 「바닥조립」: 기준층(2층 이상)은 알폼이라 철근 조립 (부산장안 「2동22층벽체조립」 → 「2동23층바닥조립」 → 「2동23층바닥타설」),
  // 지하·저층은 거푸집 조립 (울산다운3차 「6동 B1F 벽체 조립」)
  if (/조립/.test(t) && !formWord && floor != null) {
    if (floor >= 2) return part === "slab" ? "SLAB_REBAR" : part === "wall" ? "WALL_REBAR" : null
    return part === "slab" ? "FORM_SLAB" : part === "wall" ? "FORM_WALL" : null
  }
  // 거푸집 제작·반입·운반은 설치가 아니다
  if (/거푸집|형틀|폼/.test(t) && /제작|반입|운반|양중/.test(t)) return null
  if (/거푸집|형틀|폼/.test(t)) return part === "slab" ? "FORM_SLAB" : part === "wall" ? "FORM_WALL" : null
  return null
}

/** 문구에서 층 표기를 모두 지운다 ("B2F~B1F 면 보수" → "면 보수") */
const stripFloors = (s: string) =>
  s.replace(/(?:(?:지하|지상)\s*\d{1,3}\s*층|B?\d{1,3}\s*(?:F\b|층)|RF\b|PH\d*F?\b|PIT\b)(?:\s*[~∼]\s*(?:B?\d{1,3}\s*(?:F\b|층)|RF\b))?/gi, " ").replace(/\s+/g, " ").trim()

/** 한 층 아래 (0층은 없다: 1F → B1F(-1), B1F → B2F, 2F → 1F) */
const storyBelow = (f: number) => (f === 1 ? -1 : f - 1)
const floorName = (f: number) => (f < 0 ? `B${-f}F` : `${f}F`)

const partOf = (s: string): "wall" | "slab" | null =>
  /바닥|슬라브|슬래브|슬랩|스라브|지붕/.test(s) ? "slab" : /벽/.test(s) ? "wall" : null

export function parseNumbered(rawText: string): ParsedWorkText {
  const entries: WorkEntry[] = []
  const unmatched: string[] = []
  let kind: Kind | null = null
  let sub = ""

  for (const line of rawText.split(/\r?\n/)) {
    const h = headerOf(line)
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
    // 투입 인원 0 · 「없음」 은 그날 안 한 작업 (부산장안 9월 「101동 15층 … 타설 관리(0)」 가 날마다 남아 있다)
    if (/\(\s*(?:0\s*명?|없음)\s*\)\s*$/.test(it[1])) continue
    const body = it[1].replace(HEADCOUNT_TAIL, "").trim()

    // 골조 공사 줄: 「형틀+철근 : … , 기타 : … , 마감 : …」 처럼 항목별로 나눠 마감·견출 같은 항목은 빼고,
    // 「철근 :」 항목은 철근 공사로 읽는다 (부산장안 2026-04). 줄 중간의 인원 「(117)」 도 지운다
    const chunks: { kind: Kind; work: string }[] = []
    if (kind !== "mep") {
      for (const ch of labeledChunks(body.replace(/\(\s*\d+\s*명?\s*\)/g, " "))) {
        if (ch.label && SKIP_LABEL.test(ch.label)) continue
        const k: Kind = ch.label && /철근/.test(ch.label) && !/형틀|콘크리트/.test(ch.label) ? "rebar" : kind
        chunks.push({ kind: k, work: ch.text.replace(/[,/\s]+$/, "") })
      }
    } else {
      // "101동, 102동, 103동, 104동, 지하주차장, 공용부: 골조 : 102동 2코어 옥탑 벽체 배관" — 앞은 그 팀 담당 범위,
      // 실제 작업은 마지막 「:」 뒤. 뒤에 동 번호가 있으면 뒤만 읽는다 (부산장안 2026-10)
      // 「항목 : 내용」 이 여러 개 이어진 줄("…: 골조 : 102동 옥탑1층 슬라브배관 입선 : 102동 단위세대 …")은 「골조 :」 뒤 ~ 다음 「항목 :」 앞만
      const framing = /골조\s*[:：]\s*(.*?)(?=\s+[가-힣A-Za-z/]+\s*[:：]|$)/.exec(body)
      const lastColon = Math.max(body.lastIndexOf(":"), body.lastIndexOf("："))
      const work = framing
        ? framing[1].trim()
        : lastColon >= 0 && /\d{3,4}\s*동/.test(body.slice(lastColon + 1))
          ? body.slice(lastColon + 1).trim()
          : body
      chunks.push({ kind, work })
    }
    for (const { kind, work } of chunks)
    for (const seg of splitSegments(work, kind !== "mep")) {
      const lb = LEADING_BUILDINGS.exec(seg)
      if (!lb) continue // 현장 관리, 반입 등 동이 없는 줄
      const nos = expandBuildings(lb[1])
      const rest = seg.slice(lb[0].length).replace(/^[:：]\s*/, "").trim()
      // "501동 주변 저수조 …", "503동 주변주차장 …" — 그 동이 아니라 옆 부대시설
      if (/^주변/.test(rest)) continue
      // "101동 주차장지붕 누름타설", "1동 주출입구" — 동 이름이 붙은 옆 시설 (부산장안). 필로티는 그 동이라 둔다
      if (/^(?:주차장|주출입구|어린이집|주민|램프|엘리베이터|피트|세대)/.test(rest)) continue
      // "3610-3611동 사이 기초 …" — 두 동 사이 구역이지 그 동이 아니다
      if (/^사이/.test(rest)) continue

      // 「및」 으로 묶인 구문: 각 구문의 벽/바닥·층을 따로. 공종 동사(거푸집 설치·철근 조립…)는 마지막 구문에서 공유
      // 「4동 갱폼인양+알폼해체」 의 「+」 도 「및」 처럼
      const phrases = rest.split(/\s*(?:및|\+)\s*/)
      // 마지막 구문에서 벽/바닥 뒤의 공종 동사만 ("주변 부대시설 벽체 거푸집 설치" → "거푸집 설치")
      const last = phrases[phrases.length - 1]
      const verbTail = (/(?:벽체|벽|바닥|슬래브|슬라브|슬랩|스라브)\s*(.*)$/.exec(last)?.[1] ?? last).trim()
      let lastFloor: { floor: number | null; floorLabel?: string } | null = null
      const picked: { floor: number | null; floorLabel?: string; part: "wall" | "slab" | null; text: string; verbOnly?: boolean }[] = []
      // 옥탑: 「옥탑 2층」 「옥탑 RF」 「옥탑 슬라브」 는 일반 층이 아니다 — 「옥탑2층」 「옥탑RF」 「옥탑」 표기로 두고
      // 일반 층 규칙(아래 층 사이클)도 쓰지 않는다 (부산장안 2026-10: 「옥탑 2층」 이 2층, 「옥탑 슬라브(1F)」 가 B1 로 읽혔다)
      const roofOf = (ph: string): string | null => {
        if (!/옥탑/.test(ph)) return null
        const n = /옥탑\s*(\d{1,2})\s*(?:층|F\b)/i.exec(ph) ?? /(?:^|[^0-9A-Za-z])(\d{1,2})\s*(?:층|F\b)/i.exec(ph.slice(ph.indexOf("옥탑")))
        // 옥탑은 5층 이하 — 「1코어 옥탑 …, 2코어 22층 …」 의 22층은 옥탑 층이 아니다
        if (n && Number(n[1]) <= 5) return `옥탑${n[1]}층`
        if (/RF\b|지붕/.test(ph)) return "옥탑RF"
        return "옥탑"
      }
      const restRoof = roofOf(rest)
      phrases.forEach((ph, i) => {
        if (/주변/.test(ph)) return // 옆 부대시설
        const roof = roofOf(ph) ?? (restRoof && /층|F\b/.test(ph) ? null : restRoof)
        const ft = roof ? null : FLOOR_TOKEN.exec(ph)
        if (roof) lastFloor = { floor: null, floorLabel: roof }
        else if (ft) lastFloor = parseFloorToken(ft[1])
        const part = partOf(ph)
        // "정리" 같은 꼬리 구문은 버린다. 층·벽/바닥 없이 공종 단어만 있는 구문(「갱폼인양」 「알폼조립」 「타설」)은 남긴다
        // (부산장안 「4동 갱폼인양+3동 알폼조립」 — 층은 progress 가 앞 실적에서 잇고, 못 이으면 버린다).
        // 「기초 타설」 「장애인 램프 타설」 「갱폼 설치 전 준비」 처럼 다른 말이 붙으면 기준층 공종이 아니다
        const verbOnly = !part && !ft && !roof && VERB_ONLY.test(ph.replace(/\s+/g, ""))
        if (!part && !ft && !roof && !verbOnly) return
        const own = stripFloors(ph)
        // 구문에 공종 단어가 이미 있으면("B2F 벽체거푸집 설치") 뒤 구문의 동사를 붙이지 않는다
        const hasVerb = /거푸집|형틀|폼|철근|배근|타설|동바리|배관|박스|슬리브|스리브|이중관/.test(own)
        const text = i === phrases.length - 1 || hasVerb ? own : `${own} ${verbTail}`.trim()
        picked.push({ ...(lastFloor ?? { floor: null }), part, text, ...(verbOnly && !lastFloor ? { verbOnly } : {}) })
      })
      if (!picked.length) continue

      for (const p of picked) {
        const stage = stageFor(kind, sub, p.text, p.part, p.floor)
        if (kind === "mep" && !stage) continue // 배선·가설등 같은 것은 골조와 무관
        if (!stage && p.floor == null && p.floorLabel == null && !p.part) continue // 층·벽/바닥 없이 공종도 아닌 것 (「갱폼 소음방지판넬」)
        // 이 양식의 「NF 바닥」 은 그 층 바닥 슬래브 = 아래층 천장 → 아래층 사이클 (1F 바닥 → B1F, B1F 바닥 → B2F).
        // 바닥 거푸집·철근·기전·타설만. 벽·시스템 동바리는 원문 층 그대로, RF 처럼 숫자 없는 층도 그대로 (2026-10-30 사용자 확인)
        // 먹매김은 그 층 바닥 위 작업이라 옮기지 않는다
        const toStoryBelow = p.part === "slab" && stage !== "SHORING" && stage !== "MARK" && p.floor != null
        const floor = toStoryBelow ? storyBelow(p.floor!) : p.floor
        // 옮긴 줄은 「바닥」 을 「슬래브」 로 고쳐 쓰고 원문 층·단어를 붙인다: 「7F 바닥 철근 배근」 → 「6F 슬래브 철근 배근 (원문 7F 바닥)」 (2026-10-30 사용자)
        const word = /바닥|슬래브|슬라브/.exec(p.text)?.[0] ?? "바닥"
        const text = toStoryBelow
          ? `${p.text.replace(/바닥\s*/g, "슬래브 ").replace(/슬라브/g, "슬래브").trim()} (원문 ${floorName(p.floor!)} ${word})`
          : p.text
        for (const no of nos) {
          entries.push({
            building: `${no}동`,
            buildingNo: no,
            floor,
            ...(p.floorLabel ? { floorLabel: p.floorLabel } : {}),
            ...(p.verbOnly ? { floorFromPrev: true } : {}),
            text,
            stage,
          })
        }
      }
    }
  }
  return { entries, unmatched }
}
