/**
 * 엑셀(.xlsx) → 화면에 그릴 격자 구조로 변환한다.
 *
 * exceljs 는 무거워서(약 1MB) 최상단에서 import 하지 않고 파싱할 때만 동적으로 불러온다.
 * 양식 화면에 들어오지 않는 사용자가 이 비용을 내지 않게 하기 위해서다.
 */
import { parseWorkbookShapes } from "./formShapes.ts";
import type {
  FormBorder,
  FormBorderStyle,
  FormCell,
  FormCellBorders,
  FormCellStyle,
  FormImage,
  FormSheet,
} from "./types";

/**
 * 파싱 결과의 판 번호.
 *
 * 저장해 둔 양식은 파싱 결과를 그대로 담고 있어서, 여기 로직이 좋아져도 예전에 올린
 * 양식은 옛 모양 그대로 남는다. 규칙을 고칠 때 이 번호를 올리면 저장소가 원본 엑셀에서
 * 다시 읽어 반영한다. 열 너비·테두리·줄바꿈처럼 화면 모양이 달라지는 변경이 대상이다.
 */
export const PARSER_VERSION = 8;

/**
 * 엑셀 열 너비 1단위(=기본 글꼴 숫자 하나 폭)에 해당하는 픽셀.
 *
 * 흔히 쓰는 값 7 은 Calibri 11pt 기준이다. 국내 공문서 양식은 바탕·굴림 계열을
 * 쓰고 숫자가 더 넓어, 7 로 환산하면 실제보다 좁아져 글자가 원본보다 더 접힌다.
 * 좁아서 줄이 깨지는 쪽이 넓어서 여백이 남는 쪽보다 훨씬 눈에 띄므로 8 을 쓴다.
 */
const COL_UNIT_PX = 8;
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

/** `N29` 같은 셀 주소를 행·열 번호로. 못 읽으면 null. */
function parseCellRef(ref: string | undefined): { row: number; col: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec((ref ?? "").trim());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]), col };
}

/**
 * 시트의 인쇄 영역(끝 행·열).
 *
 * 업무 양식에는 인쇄 영역 **밖에** 메모용 도형이나 다 쓴 껍데기 줄이 남아 있는 일이
 * 흔하다. 엑셀에서는 회색으로 가려져 안 보이지만 그대로 옮기면 화면에 딸려 온다.
 * "인쇄했을 때 나오는 것"이 곧 양식이라고 보는 게 사용자의 감각에 맞다.
 *
 * 시작점은 보지 않고 **끝만** 자른다. 시작을 옮기면 행·열 번호가 밀려 이미 적어 둔
 * 글자(셀 좌표로 붙어 있다)가 엉뚱한 칸으로 간다. 실제 양식은 거의 A1 에서 시작한다.
 */
function readPrintArea(worksheet: any): { maxRow: number; maxCol: number } | null {
  const area: string | undefined = worksheet.pageSetup?.printArea;
  if (!area) return null;

  let maxRow = 0;
  let maxCol = 0;
  // 인쇄 영역이 여러 조각일 수 있다(`A1:N29,P1:R9`). 전부 감싸는 크기로 잡는다.
  for (const part of area.split(",")) {
    const [start, end] = part.split(":");
    for (const ref of [parseCellRef(end), parseCellRef(start)]) {
      if (!ref) continue;
      if (ref.row > maxRow) maxRow = ref.row;
      if (ref.col > maxCol) maxCol = ref.col;
    }
  }
  return maxRow > 0 && maxCol > 0 ? { maxRow, maxCol } : null;
}

interface SpanBox {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * 병합된 칸의 바깥 테두리를 네 모서리 칸에서 각각 읽는다.
 *
 * 엑셀은 테두리를 칸마다 따로 저장한다. `B11:G11` 병합이라면 오른쪽 선은 대표 칸인
 * `B11` 이 아니라 맨 오른쪽 `G11` 에 들어 있다. 대표 칸만 보면 병합 줄의 오른쪽·아래
 * 선이 통째로 사라진다.
 */
function readMergedBorders(worksheet: any, box: SpanBox): FormCellBorders {
  const topLeft = worksheet.getCell(box.minRow, box.minCol);
  const topRight = worksheet.getCell(box.minRow, box.maxCol);
  const bottomLeft = worksheet.getCell(box.maxRow, box.minCol);

  const borders: FormCellBorders = {};
  const top = readBorder(topLeft.border?.top);
  const left = readBorder(topLeft.border?.left);
  const right = readBorder(topRight.border?.right);
  const bottom = readBorder(bottomLeft.border?.bottom);
  if (top) borders.top = top;
  if (left) borders.left = left;
  if (right) borders.right = right;
  if (bottom) borders.bottom = bottom;
  return borders;
}

/** 엑셀 도면 좌표 단위(EMU) → px. 914400 EMU = 1인치, 화면은 96dpi. */
const EMU_PER_PX = 914400 / 96;

/**
 * exceljs 가 주는 그림 바이트를 Uint8Array 로 맞춘다.
 *
 * 실행 환경마다 모양이 다르다 — Node 는 Buffer, 브라우저 번들은 Buffer 폴리필이나
 * 순수 Uint8Array, 직렬화를 거치면 `{ type:'Buffer', data:[...] }` 로도 온다.
 * 모르는 모양을 `new Uint8Array(x)` 에 그냥 넣으면 **길이 0 짜리가 조용히 만들어져**
 * 깨진 그림이 되고, `alt=""` 라 화면에서는 아무것도 없는 것처럼 보인다.
 */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  if (data && typeof data === "object" && Array.isArray((data as any).data)) {
    return Uint8Array.from((data as any).data as number[]);
  }
  return null;
}

/** 바이트 뭉치를 `<img src>` 에 바로 넣을 수 있는 data: URL 로 만든다. 못 만들면 빈 문자열. */
function toDataUrl(data: unknown, extension: string): string {
  const bytes = toBytes(data);
  if (!bytes || bytes.length === 0) return "";
  // 한 번에 넘기면 인자 개수 제한에 걸려 큰 그림에서 터진다. 잘라서 붙인다.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = extension === "jpg" ? "jpeg" : extension || "png";
  return `data:image/${mime};base64,${btoa(binary)}`;
}

/**
 * 그림의 모서리 좌표(몇 번째 칸 + 그 칸 안에서의 치우침)를 px 로 바꾼다.
 *
 * 내용 범위 밖을 가리킬 수 있어(그림이 표보다 오른쪽·아래로 삐져나온 경우)
 * 모르는 칸은 기본 크기로 친다.
 */
function anchorToPx(sizes: number[], fallback: number, index: number, offsetEmu: number): number {
  let px = 0;
  for (let i = 0; i < index; i++) px += sizes[i] ?? fallback;
  return px + (offsetEmu ?? 0) / EMU_PER_PX;
}

/**
 * 시트에 얹힌 그림을 꺼낸다.
 *
 * 엑셀의 "그림"과 "도형"은 다르다 — 여기서 나오는 건 붙여넣은 **그림**(로고·도장·
 * 캡처)뿐이고, 도형으로 그린 순서도는 exceljs 가 아예 내주지 않아 담기지 않는다.
 */
function readImages(
  worksheet: any,
  workbook: any,
  colWidths: number[],
  rowHeights: number[],
): FormImage[] {
  if (!workbook || typeof worksheet.getImages !== "function") return [];

  const defaultCol = colWidthToPx(undefined);
  const defaultRow = rowHeightToPx(undefined);
  const images: FormImage[] = [];

  for (const item of worksheet.getImages() ?? []) {
    try {
      const media = workbook.getImage(Number(item.imageId));
      // EMF/WMF 는 윈도우 전용 그림 형식이라 브라우저가 못 연다. 넣어 봐야 깨진
      // 그림이 되고, alt 가 비어 있어 화면에서는 "아무것도 없는 것"으로 보인다.
      if (["emf", "wmf"].includes(String(media?.extension).toLowerCase())) continue;
      // exceljs 판에 따라 바이트가 buffer/data 중 어디에 오는지 갈린다.
      const raw = media?.buffer ?? media?.data;
      const src = toDataUrl(raw, media?.extension);
      // 못 읽은 그림을 넣으면 화면에 보이지 않는 <img> 만 남아 원인 찾기가 어려워진다.
      if (!src) continue;

      const tl = item.range?.tl;
      if (!tl) continue;
      const left = anchorToPx(colWidths, defaultCol, tl.nativeCol ?? 0, tl.nativeColOff ?? 0);
      const top = anchorToPx(rowHeights, defaultRow, tl.nativeRow ?? 0, tl.nativeRowOff ?? 0);

      // 두 모서리로 잡힌 그림(twoCellAnchor)이면 br 로, 크기가 고정된 그림이면 ext 로 잰다.
      const br = item.range?.br;
      let width: number;
      let height: number;
      if (br) {
        width = anchorToPx(colWidths, defaultCol, br.nativeCol ?? 0, br.nativeColOff ?? 0) - left;
        height = anchorToPx(rowHeights, defaultRow, br.nativeRow ?? 0, br.nativeRowOff ?? 0) - top;
      } else {
        width = (item.range?.ext?.width ?? 0) / EMU_PER_PX;
        height = (item.range?.ext?.height ?? 0) / EMU_PER_PX;
      }
      if (!(width > 0) || !(height > 0)) continue;

      images.push({ src, left, top, width, height });
    } catch {
      // 그림 하나를 못 읽는다고 양식 전체를 못 열면 안 된다. 그 그림만 건너뛴다.
    }
  }
  return images;
}

/** exceljs Worksheet 하나를 격자 구조로 바꾼다. */
export function parseFormSheet(worksheet: any, workbook?: any): FormSheet {
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
    const end = parseCellRef(range.split(":")[1]);
    if (!end) continue;
    if (end.row > maxRow) maxRow = end.row;
    if (end.col > maxCol) maxCol = end.col;
  }

  // 인쇄 영역이 정해져 있으면 거기까지만 옮긴다.
  const printArea = readPrintArea(worksheet);
  const trimmed = Boolean(printArea && (printArea.maxRow < maxRow || printArea.maxCol < maxCol));
  if (printArea) {
    maxRow = Math.min(maxRow, printArea.maxRow);
    maxCol = Math.min(maxCol, printArea.maxCol);
  }

  if (maxRow === 0 || maxCol === 0) {
    return {
      name: worksheet.name,
      rowCount: 0,
      colCount: 0,
      colWidths: [],
      rowHeights: [],
      cells: [],
      images: [],
      shapes: [],
    };
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
      const rowSpan = box.maxRow - box.minRow + 1;
      const colSpan = box.maxCol - box.minCol + 1;
      const style = readStyle(cell);
      // 병합된 칸은 바깥 테두리를 모서리 칸들에서 다시 읽는다.
      if (rowSpan > 1 || colSpan > 1) style.borders = readMergedBorders(worksheet, box);

      cells.push({
        key: `${row}:${col}`,
        row,
        col,
        rowSpan,
        colSpan,
        text: cellText(cell.value),
        style,
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

  return {
    name: worksheet.name,
    rowCount: maxRow,
    colCount: maxCol,
    colWidths,
    rowHeights,
    cells,
    // 인쇄 영역 밖에 놓인 그림은 격자 밖으로 계산되므로 여기서 걸러진다.
    images: withinGrid(
      readImages(worksheet, workbook, colWidths, rowHeights),
      colWidths,
      rowHeights,
    ),
    // 도형은 exceljs 가 내주지 않아 원본 파일에서 따로 읽는다(parseFormWorkbook).
    shapes: [],
    // 실제로 잘라낸 경우에만 알린다. 인쇄 영역이 내용보다 넓으면 알릴 것이 없다.
    printArea: trimmed ? worksheet.pageSetup?.printArea : undefined,
  };
}

/**
 * 격자 밖에 놓인 것을 걸러낸다.
 *
 * 인쇄 영역으로 표를 자르면 그 밖의 도형·그림은 좌표가 표 오른쪽·아래로 넘어간다.
 * 그대로 두면 화면 옆에 둥둥 떠서 보인다. 시작점이 표 안에 있는 것만 남긴다 —
 * 표에 걸쳐 있는 것은 원본에서도 걸쳐 있는 것이라 남겨야 한다.
 */
function withinGrid<T extends { left: number; top: number }>(
  items: T[],
  colWidths: number[],
  rowHeights: number[],
): T[] {
  const width = colWidths.reduce((a, b) => a + b, 0);
  const height = rowHeights.reduce((a, b) => a + b, 0);
  return items.filter((item) => item.left < width && item.top < height);
}

/** .xlsx 파일 내용을 시트 목록으로 바꾼다. 시트가 여러 개면 전부 돌려준다. */
export async function parseFormWorkbook(data: ArrayBuffer): Promise<FormSheet[]> {
  // 브라우저용 exceljs 는 UMD 번들이라 default 로 감싸질 때와 아닐 때가 갈린다.
  const module = (await import("exceljs")) as unknown as Record<string, any>;
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  // exceljs 가 버퍼를 소유·이관해 비워 버려도 도형을 읽을 수 있게 복사본을 넘긴다.
  await workbook.xlsx.load(data.slice(0));
  const sheets: FormSheet[] = workbook.worksheets.map((worksheet: any) =>
    parseFormSheet(worksheet, workbook),
  );

  // 도형은 exceljs 가 내주지 않으므로 원본 압축을 직접 열어 읽는다.
  // 실패해도 셀·그림은 이미 다 읽었으니 양식은 그대로 열어 준다.
  try {
    const sizes = new Map(
      sheets.map((sheet) => [
        sheet.name,
        { colWidths: sheet.colWidths, rowHeights: sheet.rowHeights },
      ]),
    );
    const shapes = await parseWorkbookShapes(data, sizes, {
      col: colWidthToPx(undefined),
      row: rowHeightToPx(undefined),
    });
    for (const sheet of sheets) {
      sheet.shapes = withinGrid(shapes.get(sheet.name) ?? [], sheet.colWidths, sheet.rowHeights);
    }
  } catch {
    // 도형을 못 읽는 것은 양식을 못 여는 것보다 가볍다.
  }

  return sheets;
}
