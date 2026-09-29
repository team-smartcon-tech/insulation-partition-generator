/**
 * 합친 칸을 **엑셀 파일에 실제로 반영한다.**
 *
 * 엑셀에서 칸 합치기는 시트 XML 의 한 줄이다 — `<mergeCell ref="B7:D7"/>`. 좌표가 밀리지 않으니
 * 줄 끼워 넣기(`sheetRowsExport.ts`)보다 손댈 곳이 적다. 대신 세 가지를 지켜야 엑셀이 받아들인다:
 *
 * 1. `<mergeCells count="...">` 의 개수를 맞춘다(안 맞으면 엑셀이 "복구했습니다"를 띄운다).
 * 2. `<mergeCells>` 블록의 **자리**가 정해져 있다 — `</sheetData>` 뒤, `pageMargins` 앞.
 *    없는 파일에 새로 만들 때 아무 데나 넣으면 파일이 깨진다.
 * 3. 합치면 **왼쪽 위 글자만 남는다.** 엑셀이 하는 것과 같이 나머지 칸의 글자를 지운다
 *    (안 지우면 숨은 글자가 남아, 나중에 나누면 되살아난다).
 *
 * 좌표는 화면 좌표를 그대로 쓴다. 줄을 끼운 시트는 **줄 끼우기를 먼저** 한 뒤 여기를 부르므로
 * 그 시점의 엑셀 좌표와 화면 좌표가 같다(`values` 와 같은 규칙).
 */
import type { CellRange, MergeEdits } from "./sheetMerges.ts";

/** 1 → A, 27 → AA */
function columnName(col: number): string {
  let name = "";
  let rest = col;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

/** A → 1, AA → 27 */
function columnNumber(letters: string): number {
  let num = 0;
  for (const ch of letters) num = num * 26 + (ch.charCodeAt(0) - 64);
  return num;
}

export const rangeRef = (range: CellRange) =>
  `${columnName(range.left)}${range.top}:${columnName(range.right)}${range.bottom}`;

/** `B7:D7` → 네모. 한 칸짜리(`B7`)도 받는다. */
export function parseRef(ref: string): CellRange | null {
  const parts = ref.replace(/\$/g, "").split(":");
  const first = /^([A-Z]+)(\d+)$/.exec(parts[0] ?? "");
  if (!first) return null;
  const last = /^([A-Z]+)(\d+)$/.exec(parts[1] ?? parts[0]);
  if (!last) return null;
  return {
    top: Math.min(Number(first[2]), Number(last[2])),
    left: Math.min(columnNumber(first[1]), columnNumber(last[1])),
    bottom: Math.max(Number(first[2]), Number(last[2])),
    right: Math.max(columnNumber(first[1]), columnNumber(last[1])),
  };
}

const overlaps = (a: CellRange, b: CellRange) =>
  a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;

/**
 * `<mergeCells>` 블록이 들어갈 자리. 엑셀 시트는 태그 순서가 정해져 있어서
 * `</sheetData>` 바로 뒤가 늘 맞는 것은 아니다(자동 필터·시트 보호가 그 사이에 온다).
 * 그래서 **mergeCells 보다 뒤에 와야 하는 태그** 중 처음 것 앞에 넣는다.
 */
const AFTER_MERGE_CELLS = [
  "<phoneticPr",
  "<conditionalFormatting",
  "<dataValidations",
  "<hyperlinks",
  "<printOptions",
  "<pageMargins",
  "<pageSetup",
  "<headerFooter",
  "<rowBreaks",
  "<colBreaks",
  "<drawing",
  "<legacyDrawing",
  "<tableParts",
  "<extLst",
];

function insertPosition(xml: string): number {
  let best = -1;
  for (const tag of AFTER_MERGE_CELLS) {
    const at = xml.indexOf(tag);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  if (best >= 0) return best;
  const close = xml.indexOf("</sheetData>");
  return close >= 0 ? close + "</sheetData>".length : xml.length;
}

/** 합치기 목록을 다시 써 넣는다(개수까지). 목록이 비면 블록을 없앤다. */
function writeMergeCells(xml: string, refs: string[]): string {
  const block = /<mergeCells\b[^>]*?(?:\/>|>[\s\S]*?<\/mergeCells>)/.exec(xml);
  if (refs.length === 0) return block ? xml.replace(block[0], "") : xml;

  const body = refs.map((ref) => `<mergeCell ref="${ref}"/>`).join("");
  const next = `<mergeCells count="${refs.length}">${body}</mergeCells>`;
  if (block) return xml.replace(block[0], next);
  const at = insertPosition(xml);
  return xml.slice(0, at) + next + xml.slice(at);
}

/** 시트에 이미 있는 합치기 목록 */
export function readMergeRefs(xml: string): string[] {
  const block = /<mergeCells\b[^>]*?(?:\/>|>[\s\S]*?<\/mergeCells>)/.exec(xml);
  if (!block) return [];
  return [...block[0].matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map((match) => match[1]);
}

/**
 * 합친 범위에서 **왼쪽 위 말고** 나머지 칸의 글자를 지운다 — 엑셀이 합칠 때 하는 것과 같다.
 * 서식(`s`)은 남긴다. 테두리·배경이 사라지면 표가 달라 보인다.
 */
export function clearCoveredCells(xml: string, ranges: CellRange[]): string {
  if (ranges.length === 0) return xml;
  return xml.replace(/<c\b[^>]*?\br="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (whole, letters: string, row: string) => {
    const at = { row: Number(row), col: columnNumber(letters) };
    const inside = ranges.some(
      (range) =>
        at.row >= range.top &&
        at.row <= range.bottom &&
        at.col >= range.left &&
        at.col <= range.right &&
        !(at.row === range.top && at.col === range.left),
    );
    if (!inside) return whole;
    const style = / s="\d+"/.exec(whole)?.[0] ?? "";
    return `<c r="${letters}${row}"${style}/>`;
  });
}

/**
 * 합치기 기록을 시트 XML 에 반영한다.
 *
 * 지울 것을 먼저 빼고, 더할 것과 **겹치는 기존 합치기도 뺀다** — 겹친 채로 두면 엑셀이
 * 파일을 거부한다(실제로 `Cannot merge already merged cells` 로 막혔다).
 */
export function applyMergesToSheetXml(xml: string, edits: MergeEdits | undefined): string {
  if (!edits || (edits.add.length === 0 && edits.remove.length === 0)) return xml;

  const removedAnchors = new Set(edits.remove);
  const kept: string[] = [];
  for (const ref of readMergeRefs(xml)) {
    const range = parseRef(ref);
    if (!range) continue;
    if (removedAnchors.has(`${range.top}:${range.left}`)) continue;
    if (edits.add.some((added) => overlaps(added, range))) continue;
    kept.push(ref);
  }

  const out = writeMergeCells(xml, [...kept, ...edits.add.map(rangeRef)]);
  return clearCoveredCells(out, edits.add);
}
