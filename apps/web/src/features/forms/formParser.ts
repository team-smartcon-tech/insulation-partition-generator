/**
 * 엑셀(.xlsx) → 화면에 그릴 격자 구조로 변환한다.
 *
 * exceljs 는 무거워서(약 1MB) 최상단에서 import 하지 않고 파싱할 때만 동적으로 불러온다.
 * 양식 화면에 들어오지 않는 사용자가 이 비용을 내지 않게 하기 위해서다.
 */
import type {
  FormBorder,
  FormBorderStyle,
  FormCell,
  FormCellBorders,
  FormCellStyle,
  FormSheet,
} from "./types";

/** 엑셀 열 너비 1단위(=기본 글꼴 숫자 하나 폭)에 해당하는 픽셀 */
const COL_UNIT_PX = 7;
/** 엑셀이 열에 항상 더하는 좌우 여백 */
const COL_PADDING_PX = 5;
/** 엑셀 기본 열 너비(문자 단위) */
const DEFAULT_COL_WIDTH = 8.43;
/** 엑셀 기본 행 높이(pt) */
const DEFAULT_ROW_HEIGHT_PT = 15;
/** pt → px (96dpi 기준) */
const PT_TO_PX = 96 / 72;

const BORDER_STYLES: Record<string, FormBorderStyle> = {
  thin: "thin",
  hair: "thin",
  medium: "medium",
  thick: "thick",
  dashed: "dashed",
  dashDot: "dashed",
  dashDotDot: "dashed",
  mediumDashed: "dashed",
  dotted: "dotted",
  double: "double",
};

function colWidthToPx(width: number | undefined): number {
  const w = width ?? DEFAULT_COL_WIDTH;
  return Math.round(w * COL_UNIT_PX + COL_PADDING_PX);
}

function rowHeightToPx(heightPt: number | undefined): number {
  return Math.round((heightPt ?? DEFAULT_ROW_HEIGHT_PT) * PT_TO_PX);
}

/**
 * 엑셀 ARGB("FF4472C4") → CSS "#4472C4".
 * 테마색만 지정된 칸은 argb 가 없어 undefined 를 돌려주고, 화면에서 기본값을 쓴다.
 */
function argbToHex(argb: unknown): string | undefined {
  if (typeof argb !== "string") return undefined;
  const value = argb.trim();
  if (value.length === 8) {
    // 완전 투명은 "색 없음"으로 본다.
    if (value.slice(0, 2).toUpperCase() === "00") return undefined;
    return `#${value.slice(2).toUpperCase()}`;
  }
  if (value.length === 6) return `#${value.toUpperCase()}`;
  return undefined;
}

/** 셀 값은 문자열·숫자·날짜·서식글자·수식결과 등 여러 모양으로 온다. 화면에 쓸 문자열로 좁힌다. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((run) => (run as { text?: unknown }).text ?? "")
        .join("");
    }
    // 수식 셀은 계산된 결과를 보여준다. 결과가 없으면 빈 칸으로 둔다.
    if ("result" in record) return cellText(record.result);
    if ("text" in record) return cellText(record.text);
    if ("error" in record) return "";
  }
  return "";
}

function readBorder(side: unknown): FormBorder | undefined {
  if (!side || typeof side !== "object") return undefined;
  const record = side as { style?: unknown; color?: { argb?: unknown } };
  if (typeof record.style !== "string") return undefined;
  const style = BORDER_STYLES[record.style];
  if (!style) return undefined;
  return { style, color: argbToHex(record.color?.argb) };
}

function readBorders(border: unknown): FormCellBorders {
  if (!border || typeof border !== "object") return {};
  const record = border as Record<string, unknown>;
  const borders: FormCellBorders = {};
  const top = readBorder(record.top);
  const right = readBorder(record.right);
  const bottom = readBorder(record.bottom);
  const left = readBorder(record.left);
  if (top) borders.top = top;
  if (right) borders.right = right;
  if (bottom) borders.bottom = bottom;
  if (left) borders.left = left;
  return borders;
}

function readAlign(horizontal: unknown): FormCellStyle["align"] {
  if (horizontal === "center" || horizontal === "centerContinuous") return "center";
  if (horizontal === "right") return "right";
  if (horizontal === "left") return "left";
  return undefined;
}

function readValign(vertical: unknown): FormCellStyle["valign"] {
  if (vertical === "middle") return "middle";
  if (vertical === "bottom") return "bottom";
  if (vertical === "top") return "top";
  return undefined;
}

function readStyle(cell: {
  font?: Record<string, unknown> | null;
  fill?: Record<string, unknown> | null;
  alignment?: Record<string, unknown> | null;
  border?: unknown;
}): FormCellStyle {
  const font = cell.font ?? {};
  const alignment = cell.alignment ?? {};

  let background: string | undefined;
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    background = argbToHex((fill.fgColor as { argb?: unknown } | undefined)?.argb);
  }

  const style: FormCellStyle = { borders: readBorders(cell.border) };
  if (font.bold === true) style.bold = true;
  if (font.italic === true) style.italic = true;
  if (font.underline) style.underline = true;
  if (typeof font.size === "number") style.fontSize = font.size;
  if (typeof font.name === "string") style.fontFamily = font.name;
  const color = argbToHex((font.color as { argb?: unknown } | undefined)?.argb);
  if (color) style.color = color;
  if (background) style.background = background;
  const align = readAlign(alignment.horizontal);
  if (align) style.align = align;
  const valign = readValign(alignment.vertical);
  if (valign) style.valign = valign;
  if (alignment.wrapText === true) style.wrap = true;

  return style;
}

/** 값도 테두리도 채우기도 없는 칸은 시트 범위를 넓히지 않는다(엑셀이 남긴 빈 껍데기 칸 배제). */
function isMeaningful(cell: {
  value?: unknown;
  border?: unknown;
  fill?: Record<string, unknown> | null;
}): boolean {
  if (cellText(cell.value).trim() !== "") return true;
  const borders = readBorders(cell.border);
  if (borders.top || borders.right || borders.bottom || borders.left) return true;
  const fill = cell.fill;
  return Boolean(fill && fill.type === "pattern" && fill.pattern !== "none");
}

interface SpanBox {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/** exceljs Worksheet 하나를 격자 구조로 바꾼다. */
export function parseFormSheet(worksheet: any): FormSheet {
  // 1) 실제로 내용이 있는 범위를 먼저 구한다.
  let maxRow = 0;
  let maxCol = 0;
  worksheet.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
    row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
      if (!isMeaningful(cell)) return;
      if (rowNumber > maxRow) maxRow = rowNumber;
      if (colNumber > maxCol) maxCol = colNumber;
    });
  });

  // 병합 범위가 내용 범위 밖으로 뻗어 있으면 거기까지 포함한다.
  const merges: string[] = worksheet.model?.merges ?? [];
  for (const range of merges) {
    const end = range.split(":")[1];
    if (!end) continue;
    const match = /^([A-Z]+)(\d+)$/.exec(end);
    if (!match) continue;
    const [, letters, digits] = match;
    let col = 0;
    for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = Number(digits);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }

  if (maxRow === 0 || maxCol === 0) {
    return { name: worksheet.name, rowCount: 0, colCount: 0, colWidths: [], rowHeights: [], cells: [] };
  }

  // 2) 병합 대표 칸별로 차지하는 사각형을 모은다.
  //    model.merges 문자열을 파싱하는 대신 각 칸이 알려주는 master 주소로 모아
  //    exceljs 내부 표현이 바뀌어도 흔들리지 않게 한다.
  const boxes = new Map<string, SpanBox>();
  const masterOf = new Map<string, string>();

  for (let row = 1; row <= maxRow; row++) {
    for (let col = 1; col <= maxCol; col++) {
      const cell = worksheet.getCell(row, col);
      const masterAddress: string = cell.master?.address ?? cell.address;
      masterOf.set(`${row}:${col}`, masterAddress);
      const box = boxes.get(masterAddress);
      if (box) {
        if (row < box.minRow) box.minRow = row;
        if (row > box.maxRow) box.maxRow = row;
        if (col < box.minCol) box.minCol = col;
        if (col > box.maxCol) box.maxCol = col;
      } else {
        boxes.set(masterAddress, { minRow: row, maxRow: row, minCol: col, maxCol: col });
      }
    }
  }

  // 3) 대표 칸만 내보낸다. 병합에 가려진 자리는 표에서 자리를 차지하지 않는다.
  const cells: FormCell[] = [];
  for (let row = 1; row <= maxRow; row++) {
    for (let col = 1; col <= maxCol; col++) {
      const masterAddress = masterOf.get(`${row}:${col}`);
      if (!masterAddress) continue;
      const box = boxes.get(masterAddress);
      if (!box || box.minRow !== row || box.minCol !== col) continue;

      const cell = worksheet.getCell(row, col);
      cells.push({
        key: `${row}:${col}`,
        row,
        col,
        rowSpan: box.maxRow - box.minRow + 1,
        colSpan: box.maxCol - box.minCol + 1,
        text: cellText(cell.value),
        style: readStyle(cell),
      });
    }
  }

  const colWidths: number[] = [];
  for (let col = 1; col <= maxCol; col++) {
    colWidths.push(colWidthToPx(worksheet.getColumn(col).width));
  }
  const rowHeights: number[] = [];
  for (let row = 1; row <= maxRow; row++) {
    rowHeights.push(rowHeightToPx(worksheet.getRow(row).height));
  }

  return { name: worksheet.name, rowCount: maxRow, colCount: maxCol, colWidths, rowHeights, cells };
}

/** .xlsx 파일 내용을 시트 목록으로 바꾼다. 시트가 여러 개면 전부 돌려준다. */
export async function parseFormWorkbook(data: ArrayBuffer): Promise<FormSheet[]> {
  // 브라우저용 exceljs 는 UMD 번들이라 default 로 감싸질 때와 아닐 때가 갈린다.
  const module = (await import("exceljs")) as unknown as Record<string, any>;
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  return workbook.worksheets.map((worksheet: any) => parseFormSheet(worksheet));
}
