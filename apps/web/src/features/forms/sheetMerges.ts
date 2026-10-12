/**
 * 칸 합치기·나누기 — 화면에서 고른 범위를 합치고, 합친 것을 도로 나눈다.
 *
 * 원본 엑셀은 건드리지 않고 **"어디를 합쳤다/나눴다"는 기록만** 남긴다(`values` 와 같은 방식).
 * 내려받을 때 그 기록대로 엑셀의 `<mergeCells>` 를 고친다(`sheetMergesExport.ts`).
 *
 * 규칙 하나가 중요하다: **이미 합쳐진 자리에 겹쳐서 합칠 수 없다.** 엑셀도 거부하고, 엑셀 파일을
 * 읽는 라이브러리도 `Cannot merge already merged cells` 로 막는다(실제로 막혔다). 그래서 겹치는
 * 것이 있으면 **먼저 풀고** 합친다 — 엑셀에서 사람이 하는 동작과 같다.
 */
import type { FormCell, FormSheet } from "./types";

/** 화면 좌표로 잡은 네모 범위(1부터). */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 한 시트에서 사용자가 손댄 합치기 기록 */
export interface MergeEdits {
  /** 새로 합친 범위 */
  add: CellRange[];
  /** 원본에 있던 합치기 중 사용자가 푼 것(왼쪽 위 칸의 `행:열`) */
  remove: string[];
}

export const emptyMergeEdits = (): MergeEdits => ({ add: [], remove: [] });

export const rangeKey = (range: CellRange) => `${range.top}:${range.left}:${range.bottom}:${range.right}`;
export const topLeftKey = (range: CellRange) => `${range.top}:${range.left}`;

/** 두 점으로 네모를 만든다(어느 쪽으로 끌든 같게). */
export function makeRange(a: { row: number; col: number }, b: { row: number; col: number }): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export const isSingleCell = (range: CellRange) => range.top === range.bottom && range.left === range.right;

const overlaps = (a: CellRange, b: CellRange) =>
  a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;

/** 칸 하나가 차지하는 네모(병합 포함) */
export const cellRangeOf = (cell: FormCell): CellRange => ({
  top: cell.row,
  left: cell.col,
  bottom: cell.row + cell.rowSpan - 1,
  right: cell.col + cell.colSpan - 1,
});

/** 이 범위와 겹치는 **이미 합쳐진 칸**들(합치기 전에 풀어야 하는 것). */
export function mergedCellsIn(sheet: FormSheet, range: CellRange): FormCell[] {
  return sheet.cells.filter((cell) => (cell.rowSpan > 1 || cell.colSpan > 1) && overlaps(cellRangeOf(cell), range));
}

/** 이 범위 안에서 **글자가 있는 칸**(합치면 왼쪽 위만 남고 나머지는 사라진다 — 엑셀과 같다). */
export function textCellsIn(
  sheet: FormSheet,
  range: CellRange,
  values: Record<string, string> | undefined,
): string[] {
  const found: string[] = [];
  for (const cell of sheet.cells) {
    if (cell.row === range.top && cell.col === range.left) continue; // 왼쪽 위는 남는다
    if (!overlaps(cellRangeOf(cell), range)) continue;
    const text = values?.[cell.key] ?? cell.text;
    if (text.trim() !== "") found.push(text.trim());
  }
  return found;
}

/**
 * 합치기 기록을 시트에 입혀 **화면에 그릴 시트**를 만든다.
 *
 * 먼저 푼 것을 풀고(가려져 있던 칸을 되살린다), 그다음 합친다(가려지는 칸을 뺀다).
 * 순서가 반대면 방금 푼 자리를 도로 합치게 된다.
 */
export function withMerges(sheet: FormSheet, edits: MergeEdits | undefined): FormSheet {
  if (!edits || (edits.add.length === 0 && edits.remove.length === 0)) return sheet;

  const removed = new Set(edits.remove);
  let cells: FormCell[] = [];

  // ① 푼 것 — 합쳐져 있던 칸을 한 칸씩으로 되돌린다. 서식은 그대로 물려준다.
  for (const cell of sheet.cells) {
    if (!removed.has(cell.key) || (cell.rowSpan === 1 && cell.colSpan === 1)) {
      cells.push(cell);
      continue;
    }
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (let col = cell.col; col < cell.col + cell.colSpan; col++) {
        const first = row === cell.row && col === cell.col;
        cells.push({
          ...cell,
          key: `${row}:${col}`,
          row,
          col,
          rowSpan: 1,
          colSpan: 1,
          // 글자는 왼쪽 위 칸에만 남긴다(엑셀에서 나눌 때와 같다).
          text: first ? cell.text : "",
        });
      }
    }
  }

  // ② 합친 것 — 왼쪽 위 칸이 범위를 차지하고, 가려지는 칸은 뺀다.
  for (const range of edits.add) {
    const covered = cells.filter((cell) => overlaps(cellRangeOf(cell), range));
    const anchor =
      covered.find((cell) => cell.row === range.top && cell.col === range.left) ?? covered[0];
    if (!anchor) continue;
    cells = cells.filter((cell) => !covered.includes(cell));
    cells.push({
      ...anchor,
      key: `${range.top}:${range.left}`,
      row: range.top,
      col: range.left,
      rowSpan: range.bottom - range.top + 1,
      colSpan: range.right - range.left + 1,
      // 엑셀의 [병합하고 가운데 맞춤]과 같이 글자를 가운데로 보낸다.
      // 내려받은 파일에서도 같게 보이도록 서식까지 바꾼다(`sheetMergesExport.ts`).
      style: { ...anchor.style, align: "center" },
    });
  }

  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { ...sheet, cells };
}

/**
 * 합치기를 기록에 더한다. 겹치는 합치기는 **먼저 푼다**(엑셀과 같다).
 * 원본에 있던 합치기와 겹치면 `remove` 에, 내가 만든 것과 겹치면 `add` 에서 뺀다.
 */
export function addMerge(sheet: FormSheet, edits: MergeEdits, range: CellRange): MergeEdits {
  const add = edits.add.filter((existing) => !overlaps(existing, range));
  const remove = new Set(edits.remove);
  for (const cell of mergedCellsIn(sheet, range)) remove.add(cell.key);
  return { add: [...add, range], remove: [...remove] };
}

/**
 * 합쳐진 칸 하나를 나눈다.
 * 내가 합친 것이면 기록에서 빼고, 원본에 있던 것이면 "풀었다"고 적는다.
 */
export function splitMerge(edits: MergeEdits, cell: { key: string; row: number; col: number }): MergeEdits {
  const mine = edits.add.find((range) => range.top === cell.row && range.left === cell.col);
  if (mine) return { ...edits, add: edits.add.filter((range) => range !== mine) };
  if (edits.remove.includes(cell.key)) return edits;
  return { ...edits, remove: [...edits.remove, cell.key] };
}

/**
 * 줄을 끼우거나 뺄 때 합치기 기록도 같이 민다 — 안 밀면 합친 자리가 한 줄씩 어긋난다.
 * 끼운 자리를 **걸치는** 합치기는 밀리지 않고 **늘어난다**(엑셀과 같다).
 */
export function shiftMergeEdits(edits: MergeEdits | undefined, fromRow: number, delta: number): MergeEdits {
  if (!edits) return emptyMergeEdits();
  const add: CellRange[] = [];
  for (const range of edits.add) {
    // 빼는 줄 **안에만** 있던 합치기는 함께 없어진다. 안 없애면 그 자리에 올라온 아랫줄이 합쳐진다.
    if (delta < 0 && range.top === fromRow - 1 && range.bottom === fromRow - 1) continue;
    if (range.top >= fromRow) add.push({ ...range, top: range.top + delta, bottom: range.bottom + delta });
    else if (range.bottom >= fromRow) add.push({ ...range, bottom: range.bottom + delta });
    else add.push(range);
  }
  const remove: string[] = [];
  for (const key of edits.remove) {
    const [row, col] = key.split(":").map(Number);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    if (delta < 0 && row === fromRow - 1) continue; // 그 줄이 사라졌다
    remove.push(row >= fromRow ? `${row + delta}:${col}` : key);
  }
  return { add, remove };
}
