/**
 * 칸 맞춤 바꾸기 — 엑셀 [맞춤]의 위·가운데·아래, 왼쪽·가운데·오른쪽(2026-10-17 사용자 요청).
 *
 * 원본 엑셀에 맞춤이 없는 칸(6.1-3 발생 가능성·영향도 등)은 적은 글자가 한쪽에 붙어 보였다. 고른 칸의
 * 맞춤을 바꿀 수 있게 한다. 바꾼 맞춤은 **칸 값과 같은 곳에** `align:줄:칸` 키로 담는다 — 그래야 저장·서버
 * 올리기·다른 PC 에서 받아 오기·Ctrl+Z 를 그대로 탄다(새 DB 칸이 필요 없다). 화면은 그릴 때 덮어 쓰고
 * (`withAlignOverrides`), 내려받을 때는 엑셀 서식에 적는다(`sheetMergesExport.ts` `alignCells`).
 */
import type { FormCellStyle, FormCellValues, FormSheet } from "./types";

export type HAlign = NonNullable<FormCellStyle["align"]>;
export type VAlign = NonNullable<FormCellStyle["valign"]>;
export interface CellAlign {
  h?: HAlign;
  v?: VAlign;
}

export const ALIGN_PREFIX = "align:";
export const alignKey = (cellKey: string) => `${ALIGN_PREFIX}${cellKey}`;
export const isAlignKey = (key: string) => key.startsWith(ALIGN_PREFIX);

const H: HAlign[] = ["left", "center", "right"];
const V: VAlign[] = ["top", "middle", "bottom"];

/** "center|middle" → { h, v }. 모르는 값은 버린다 */
export function parseAlign(text: string | undefined): CellAlign {
  const [h, v] = (text ?? "").split("|");
  return {
    ...(H.includes(h as HAlign) ? { h: h as HAlign } : {}),
    ...(V.includes(v as VAlign) ? { v: v as VAlign } : {}),
  };
}

export const formatAlign = (align: CellAlign) => `${align.h ?? ""}|${align.v ?? ""}`;

/** 화면에 그릴 시트 — 바꾼 맞춤을 칸 서식에 덮는다. 바꾼 것이 없으면 같은 시트를 그대로 돌려준다. */
export function withAlignOverrides(sheet: FormSheet, values: FormCellValues | undefined): FormSheet {
  if (!values || !Object.keys(values).some(isAlignKey)) return sheet;
  return {
    ...sheet,
    cells: sheet.cells.map((cell) => {
      const align = parseAlign(values[alignKey(cell.key)]);
      if (!align.h && !align.v) return cell;
      return {
        ...cell,
        style: { ...cell.style, ...(align.h ? { align: align.h } : {}), ...(align.v ? { valign: align.v } : {}) },
      };
    }),
  };
}

/**
 * 고른 칸들의 맞춤을 바꾼 값 묶음과, 되돌리기 기록에 쓸 [키, 전, 후] 목록.
 * 가로만 바꾸면 세로는 그대로 둔다(엑셀과 같다).
 */
export function setAlign(
  values: FormCellValues | undefined,
  cells: { key: string; style: FormCellStyle }[],
  patch: CellAlign,
): { values: FormCellValues; changes: [key: string, before: string | undefined, after: string][] } {
  const next: FormCellValues = { ...(values ?? {}) };
  const changes: [string, string | undefined, string][] = [];
  for (const cell of cells) {
    const key = alignKey(cell.key);
    const before = next[key];
    const current = parseAlign(before);
    const after = formatAlign({
      h: patch.h ?? current.h ?? cell.style.align,
      v: patch.v ?? current.v ?? cell.style.valign,
    });
    if (after === before) continue;
    next[key] = after;
    changes.push([key, before, after]);
  }
  return { values: next, changes };
}

/** 고른 칸들이 모두 이 맞춤인가(단추를 눌린 모양으로 보이려고) */
export function allAligned(cells: { style: FormCellStyle }[], patch: CellAlign): boolean {
  if (cells.length === 0) return false;
  return cells.every(
    (cell) => (!patch.h || (cell.style.align ?? "left") === patch.h) && (!patch.v || (cell.style.valign ?? "middle") === patch.v),
  );
}
