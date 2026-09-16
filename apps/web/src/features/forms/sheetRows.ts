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
