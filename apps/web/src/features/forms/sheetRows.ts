/**
 * 시트 아래에 줄을 더한다.
 *
 * 현장마다 특이사항 줄 수가 달라, 원본 엑셀에 있는 줄 수로는 모자란다. 그렇다고 화면에서
 * 아무 칸이나 만들면 표 모양이 깨지므로 **바로 위 줄의 서식(테두리·글꼴·정렬·병합)을 그대로
 * 복사**해 한 줄씩 잇는다. 내용만 빈 줄이다.
 *
 * 더한 줄은 원본 엑셀을 건드리지 않는다 — 줄 수만 저장해 두고, 화면을 그릴 때마다 다시 만든다.
 * 그래야 파서가 좋아지면 더한 줄도 같이 새 모양이 된다.
 */
import type { FormCell, FormSheet } from "./types";

/** 마지막 줄에서 시작하는 칸들(그 줄의 서식 본보기). 없으면 빈 배열. */
function lastRowCells(sheet: FormSheet): FormCell[] {
  for (let row = sheet.rowCount; row >= 1; row--) {
    const cells = sheet.cells.filter((cell) => cell.row === row);
    if (cells.length > 0) return cells;
  }
  return [];
}

/**
 * 시트에 빈 줄 `count` 개를 이어 붙인 새 시트를 돌려준다(원본은 그대로 둔다).
 *
 * 병합(colSpan)은 본보기 줄을 따르고, 세로 병합(rowSpan)은 1 로 되돌린다 — 아래로 이어지는
 * 병합을 복사하면 더한 줄끼리 서로 겹쳐 표가 무너진다.
 */
export function withExtraRows(sheet: FormSheet, count: number): FormSheet {
  if (!(count > 0)) return sheet;

  const template = lastRowCells(sheet);
  const height = sheet.rowHeights[sheet.rowCount - 1] ?? 20;
  const cells = [...sheet.cells];
  const rowHeights = [...sheet.rowHeights];

  for (let index = 0; index < count; index++) {
    const row = sheet.rowCount + index + 1;
    rowHeights.push(height);
    for (const sample of template) {
      cells.push({
        key: `${row}:${sample.col}`,
        row,
        col: sample.col,
        rowSpan: 1,
        colSpan: sample.colSpan,
        text: "",
        style: sample.style,
      });
    }
  }

  return { ...sheet, rowCount: sheet.rowCount + count, rowHeights, cells };
}

/** 더한 줄에 적은 글자만 골라낸다(줄을 줄일 때 "지워질 내용이 있는지" 묻기 위해). */
export function textInExtraRows(
  values: Record<string, string> | undefined,
  baseRowCount: number,
): number {
  if (!values) return 0;
  let count = 0;
  for (const [key, text] of Object.entries(values)) {
    const row = Number(key.split(":")[0]);
    if (Number.isFinite(row) && row > baseRowCount && text.trim() !== "") count += 1;
  }
  return count;
}

// ─── 표 중간에 줄 끼우기 ────────────────────────────────────────────────────
//
// 맨 아래에 더하는 것(`withExtraRows`)만으로는 모자란다. 쓰다 보면 표 중간에 한 줄이 더
// 필요하다(사용자 요청). 원본 엑셀은 그대로 두고 **"어느 줄 앞에 빈 줄을 넣었다"는 기록**만
// 남긴다 — 그래야 파서가 좋아지면 끼운 줄도 새 모양을 따라간다.
//
// 기록은 **원본 줄 번호**로 한다. 화면 줄 번호로 적어 두면 위쪽에 줄을 하나 더 끼울 때마다
// 아래 기록이 전부 어긋난다.

/** 화면에 그릴 줄 하나가 어디서 왔나 */
export interface RowOrigin {
  /** 원본 줄 번호. 끼워 넣은 빈 줄이면 `null` */
  base: number | null;
  /** 이 줄 앞에 끼운 것이라면 그 원본 줄 번호(지울 때 쓴다) */
  insertedBefore?: number;
}

/** 끼운 자리 목록(원본 줄 번호, 같은 자리에 여러 줄이면 여러 번 들어간다) */
export type RowInserts = number[];

/**
 * 화면 줄 → 어디서 왔는지. 끼운 줄이 어디 있는지 한 번만 계산해 두고 여기저기서 쓴다.
 */
export function rowOrigins(baseRowCount: number, inserts: RowInserts): RowOrigin[] {
  const counts = new Map<number, number>();
  for (const at of inserts) counts.set(at, (counts.get(at) ?? 0) + 1);

  const origins: RowOrigin[] = [];
  for (let base = 1; base <= baseRowCount; base++) {
    for (let i = 0; i < (counts.get(base) ?? 0); i++) origins.push({ base: null, insertedBefore: base });
    origins.push({ base });
  }
  // 맨 끝(마지막 줄 다음)에 끼운 것
  for (let i = 0; i < (counts.get(baseRowCount + 1) ?? 0); i++) {
    origins.push({ base: null, insertedBefore: baseRowCount + 1 });
  }
  return origins;
}

/** 화면 줄 번호(1부터) → 원본 줄 번호. 끼운 줄이면 null. */
export const baseRowOf = (origins: RowOrigin[], displayRow: number) => origins[displayRow - 1]?.base ?? null;

/**
 * 화면 줄 `displayRow` **앞에** 빈 줄을 하나 끼운다. 기록은 원본 줄 번호로 남긴다.
 *
 * 끼운 줄 앞에 또 끼우는 경우도 같은 원본 줄 번호를 쓴다 — 같은 자리에 두 줄이 들어갈 뿐이다.
 */
export function insertAt(baseRowCount: number, inserts: RowInserts, displayRow: number): RowInserts {
  const origins = rowOrigins(baseRowCount, inserts);
  // 그 자리부터 아래로 내려가며 처음 만나는 원본 줄이 "이 앞에 넣어라"의 기준이다.
  let at = baseRowCount + 1;
  for (let index = displayRow - 1; index < origins.length; index++) {
    const origin = origins[index];
    if (origin.base !== null) {
      at = origin.base;
      break;
    }
    if (origin.insertedBefore !== undefined) {
      at = origin.insertedBefore;
      break;
    }
  }
  return [...inserts, at].sort((a, b) => a - b);
}

/**
 * 끼워 넣었던 줄 하나를 뺀다. **원본 줄은 지우지 않는다** — 양식의 뼈대를 현장에서 지우면
 * 같은 서식이 현장마다 달라진다(지우려면 엑셀에서 고쳐 새 판으로 배포한다).
 */
export function removeInsertedAt(baseRowCount: number, inserts: RowInserts, displayRow: number): RowInserts {
  const origins = rowOrigins(baseRowCount, inserts);
  const origin = origins[displayRow - 1];
  if (!origin || origin.base !== null || origin.insertedBefore === undefined) return inserts;
  const next = [...inserts];
  next.splice(next.indexOf(origin.insertedBefore), 1);
  return next;
}

/**
 * 끼운 줄을 넣어 화면에 그릴 시트를 만든다(원본은 그대로 둔다).
 *
 * 끼운 줄은 **바로 위 줄의 서식**을 물려받는다(테두리·글꼴·가로 병합). 세로 병합은 1 로 되돌린다 —
 * 아래로 이어지는 병합을 복사하면 끼운 줄끼리 겹쳐 표가 무너진다.
 */
export function withInsertedRows(sheet: FormSheet, inserts: RowInserts): FormSheet {
  if (inserts.length === 0) return sheet;

  const origins = rowOrigins(sheet.rowCount, inserts);
  const byBaseRow = new Map<number, FormCell[]>();
  for (const cell of sheet.cells) {
    const list = byBaseRow.get(cell.row);
    if (list) list.push(cell);
    else byBaseRow.set(cell.row, [cell]);
  }

  const cells: FormCell[] = [];
  const rowHeights: number[] = [];
  origins.forEach((origin, index) => {
    const row = index + 1;
    if (origin.base !== null) {
      rowHeights.push(sheet.rowHeights[origin.base - 1] ?? 20);
      for (const cell of byBaseRow.get(origin.base) ?? []) {
        cells.push({ ...cell, key: `${row}:${cell.col}`, row });
      }
      return;
    }
    // 끼운 줄 — 바로 위(원본 기준으로 앞) 줄을 본보기로 삼는다.
    const sampleBase = Math.max(1, (origin.insertedBefore ?? 1) - 1);
    const sample = byBaseRow.get(sampleBase) ?? [];
    rowHeights.push(sheet.rowHeights[sampleBase - 1] ?? 20);
    for (const cell of sample) {
      cells.push({
        ...cell,
        key: `${row}:${cell.col}`,
        row,
        rowSpan: 1,
        text: "",
      });
    }
  });

  return { ...sheet, rowCount: origins.length, rowHeights, cells };
}

/**
 * 줄이 끼워지거나 빠지면 **적어 둔 글자와 결재 기록의 줄 번호도 함께 움직여야 한다.**
 * 안 그러면 글자가 한 줄씩 밀려 엉뚱한 칸에 앉는다.
 */
export function shiftCellKeys<T>(
  record: Record<string, T> | undefined,
  fromRow: number,
  delta: number,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    // 칸 맞춤(`align:줄:칸`)도 그 칸을 따라 밀린다.
    if (key.startsWith("align:")) {
      const [rowText, colText] = key.slice("align:".length).split(":");
      const row = Number(rowText);
      next[Number.isFinite(row) && row >= fromRow ? `align:${row + delta}:${colText}` : key] = value;
      continue;
    }
    const [rowText, colText] = key.split(":");
    const row = Number(rowText);
    if (!Number.isFinite(row)) {
      next[key] = value;
      continue;
    }
    next[row >= fromRow ? `${row + delta}:${colText}` : key] = value;
  }
  return next;
}
