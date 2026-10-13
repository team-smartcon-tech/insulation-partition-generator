/**
 * 엑셀(.xlsx) → 화면에 그릴 격자 구조로 변환한다.
 *
 * exceljs 는 무거워서(약 1MB) 최상단에서 import 하지 않고 파싱할 때만 동적으로 불러온다.
 * 양식 화면에 들어오지 않는 사용자가 이 비용을 내지 않게 하기 위해서다.
 */
import { DEFAULT_THEME, excelColor, parseThemeXml } from "./colors.ts";
import type { ThemeColors } from "./colors.ts";
import { parseWorkbookShapes } from "./formShapes.ts";
import { parseWorkbookCharts } from "./formCharts.ts";
import { readZipIndex, readZipText } from "./zip.ts";
import { formatValue } from "./numberFormat.ts";
import type {
  FormBorder,
  FormBorderStyle,
  FormCell,
  FormCellBorders,
  FormCellStyle,
  FormImage,
  FormTextRun,
  FormSheet,
} from "./types";

/**
 * 파싱 결과의 판 번호.
 *
 * 저장해 둔 양식은 파싱 결과를 그대로 담고 있어서, 여기 로직이 좋아져도 예전에 올린
 * 양식은 옛 모양 그대로 남는다. 규칙을 고칠 때 이 번호를 올리면 저장소가 원본 엑셀에서
 * 다시 읽어 반영한다. 열 너비·테두리·줄바꿈처럼 화면 모양이 달라지는 변경이 대상이다.
 */
export const PARSER_VERSION = 24; // 24: 한국어 날짜, 숫자 오른쪽 정렬, 차트 눈금 형식·고정 범위

/**
 * 엑셀 열 너비 1단위(=기본 글꼴 숫자 하나 폭, MDW)에 해당하는 픽셀.
 *
 * 흔히 쓰는 값 7 은 Calibri 11pt 기준이다. 국내 양식의 기본 글꼴인 맑은 고딕 11pt 는 8 이다
 * (실제 파일에서 확인: 저장된 너비 6.75 → 엑셀이 말하는 40.5pt = 54px = 6.75 × 8).
 */
const COL_UNIT_PX = 8;
/**
  * 열 너비가 적혀 있지 않은 시트에서 쓸 기본 너비(**파일에 적히는 단위** — 좌우 여백 포함).
  *
  * 엑셀 화면에 "8.38자"로 보이는 표준 너비가 파일에는 9 로 적힌다(여백 5px = 0.625자). 실제
  * 파일에서 확인: `<cols>` 가 없는 시트의 열이 엑셀에서 72px = 9 × 8 이었다. 8.43 은 화면 단위의
  * Calibri 기본값이라 여기에 그대로 쓰면 열마다 5px 씩 좁아진다.
  */
const DEFAULT_COL_WIDTH = 9;
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

/**
 * 저장된 열 너비 → 픽셀. **엑셀의 셈법 그대로 쓴다.**
 *
 * 엑셀이 파일에 적는 너비에는 칸 좌우 여백이 **이미 들어 있다.** 여기에 여백 5px 를 한 번 더
 * 더하고 있어서 열마다 5px 씩(약 9%) 넓었고, 그만큼 인쇄 배율이 달라져 엑셀로 뽑은 종이와
 * 글자 위치가 어긋났다(아래로 갈수록 최대 7mm).
 *
 * `width` 가 없는 열은 그 시트의 기본 너비를 따른다(`defaultColWidth`).
 */
function colWidthToPx(width: number | undefined, defaultWidth: number | undefined): number {
  const w = width ?? defaultWidth ?? DEFAULT_COL_WIDTH;
  return Math.trunc(((256 * w + Math.trunc(128 / COL_UNIT_PX)) / 256) * COL_UNIT_PX);
}

/**
 * 저장된 행 높이(pt) → 픽셀. 높이가 안 적힌 줄은 **그 시트의 기본 행 높이**를 따른다
 * (`defaultRowHeight`). 엑셀 기본값 15pt 로 못 박으면 맑은 고딕 양식(13.5pt)에서 8% 씩 길어진다.
 */
function rowHeightToPx(heightPt: number | undefined, defaultPt: number | undefined): number {
  return Math.round((heightPt ?? defaultPt ?? DEFAULT_ROW_HEIGHT_PT) * PT_TO_PX);
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

/**
 * 칸에 **보이는** 글자 — 숫자·날짜에는 엑셀 표시 형식을 입힌다(100%, 58,607,000, 22년 4월).
 * 수식은 계산해 둔 결과를, 오류 결과(#DIV/0! 등)는 그 글자를 보여 준다 — 엑셀도 그렇게 보인다.
 */
function displayText(value: unknown, numFmt: string | undefined): string {
  if (typeof value === "number" || value instanceof Date) return formatValue(value, numFmt);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if ("result" in record) {
      const result = record.result;
      if (result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string") {
        return (result as { error: string }).error;
      }
      return displayText(result, numFmt);
    }
  }
  return cellText(value);
}

/**
 * 부분 서식 조각을 읽는다. 조각이 하나뿐이거나 모두 같은 서식이면 칸 서식으로 충분해 없다고 본다.
 * 조각의 빈 항목은 칸 서식을 따른다(엑셀도 그렇다).
 */
function readRuns(value: unknown, theme: ThemeColors): FormTextRun[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const richText = (value as { richText?: unknown }).richText;
  if (!Array.isArray(richText) || richText.length < 2) return undefined;
  const runs: FormTextRun[] = richText.map((raw) => {
    const run = raw as { text?: unknown; font?: Record<string, unknown> };
    const font = run.font ?? {};
    const color = excelColor(font.color, theme);
    return {
      text: typeof run.text === "string" ? run.text : String(run.text ?? ""),
      // 조각에 제 서식(rPr)이 있으면 굵기·기울임은 "없으면 보통"이다 — 칸 전체가 굵어도 따라가지 않는다.
      ...(run.font ? { bold: font.bold === true, italic: font.italic === true } : {}),
      ...(font.underline ? { underline: true } : {}),
      ...(typeof font.size === "number" ? { fontSize: font.size } : {}),
      ...(color ? { color } : {}),
    };
  });
  const signature = (run: FormTextRun) => `${run.bold}|${run.italic}|${run.underline}|${run.fontSize}|${run.color}`;
  return runs.every((run) => signature(run) === signature(runs[0])) ? undefined : runs;
}

/** 결과가 빠진 수식 값에 원본의 결과를 붙인다. */
function withSavedResult(value: unknown, saved: unknown): unknown {
  if (saved === undefined || !value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (!("formula" in record || "sharedFormula" in record) || record.result !== undefined) return value;
  return { ...record, result: saved };
}

function readBorder(side: unknown, theme: ThemeColors): FormBorder | undefined {
  if (!side || typeof side !== "object") return undefined;
  const record = side as { style?: unknown; color?: unknown };
  if (typeof record.style !== "string") return undefined;
  const style = BORDER_STYLES[record.style];
  if (!style) return undefined;
  return { style, color: excelColor(record.color, theme) };
}

function readBorders(border: unknown, theme: ThemeColors): FormCellBorders {
  if (!border || typeof border !== "object") return {};
  const record = border as Record<string, unknown>;
  const borders: FormCellBorders = {};
  const top = readBorder(record.top, theme);
  const right = readBorder(record.right, theme);
  const bottom = readBorder(record.bottom, theme);
  const left = readBorder(record.left, theme);
  if (top) borders.top = top;
  if (right) borders.right = right;
  if (bottom) borders.bottom = bottom;
  if (left) borders.left = left;
  Object.assign(borders, readDiagonals(record.diagonal, theme));
  return borders;
}

/** 대각선 테두리 — exceljs 는 `diagonal: { up, down, style, color }` 하나로 준다. */
function readDiagonals(diagonal: unknown, theme: ThemeColors): Pick<FormCellBorders, "diagonalUp" | "diagonalDown"> {
  if (!diagonal || typeof diagonal !== "object") return {};
  const record = diagonal as { up?: unknown; down?: unknown };
  const line = readBorder(diagonal, theme);
  if (!line) return {};
  return {
    ...(record.up ? { diagonalUp: line } : {}),
    ...(record.down ? { diagonalDown: line } : {}),
  };
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

function readStyle(
  cell: {
    font?: Record<string, unknown> | null;
    fill?: Record<string, unknown> | null;
    alignment?: Record<string, unknown> | null;
    border?: unknown;
  },
  theme: ThemeColors,
): FormCellStyle {
  const font = cell.font ?? {};
  const alignment = cell.alignment ?? {};

  let background: string | undefined;
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    background = excelColor(fill.fgColor, theme);
  }

  const style: FormCellStyle = { borders: readBorders(cell.border, theme) };
  if (font.bold === true) style.bold = true;
  if (font.italic === true) style.italic = true;
  if (font.underline) style.underline = true;
  if (typeof font.size === "number") style.fontSize = font.size;
  if (typeof font.name === "string") style.fontFamily = font.name;
  const color = excelColor(font.color, theme);
  if (color) style.color = color;
  if (background) style.background = background;
  const align = readAlign(alignment.horizontal);
  if (align) style.align = align;
  const valign = readValign(alignment.vertical);
  if (valign) style.valign = valign;
  if (alignment.wrapText === true) style.wrap = true;
  if (typeof alignment.indent === "number" && alignment.indent > 0) style.indent = alignment.indent;
  // 옆 띠에 세로로 적은 제목(QA-4.3-2 "고객 요구사항") — 빠뜨리면 한 글자씩 접혀 내려간다.
  const rotation = alignment.textRotation;
  if (rotation === "vertical") style.textDirection = "stacked";
  else if (typeof rotation === "number" && Math.abs(rotation) >= 45) style.textDirection = rotation > 0 ? "up" : "down";

  return style;
}

/** 값도 테두리도 채우기도 없는 칸은 시트 범위를 넓히지 않는다(엑셀이 남긴 빈 껍데기 칸 배제). */
function isMeaningful(cell: {
  value?: unknown;
  border?: unknown;
  fill?: Record<string, unknown> | null;
}): boolean {
  if (cellText(cell.value).trim() !== "") return true;
  const borders = readBorders(cell.border, DEFAULT_THEME);
  if (borders.top || borders.right || borders.bottom || borders.left || borders.diagonalUp || borders.diagonalDown) return true;
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
function readMergedBorders(worksheet: any, box: SpanBox, theme: ThemeColors): FormCellBorders {
  const topLeft = worksheet.getCell(box.minRow, box.minCol);
  const topRight = worksheet.getCell(box.minRow, box.maxCol);
  const bottomLeft = worksheet.getCell(box.maxRow, box.minCol);

  const borders: FormCellBorders = {};
  const top = readBorder(topLeft.border?.top, theme);
  const left = readBorder(topLeft.border?.left, theme);
  const right = readBorder(topRight.border?.right, theme);
  const bottom = readBorder(bottomLeft.border?.bottom, theme);
  if (top) borders.top = top;
  if (left) borders.left = left;
  if (right) borders.right = right;
  if (bottom) borders.bottom = bottom;
  // 합친 칸의 대각선은 대표 칸(왼쪽 위)에 적힌다.
  Object.assign(borders, readDiagonals(topLeft.border?.diagonal, theme));
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

  const defaultCol = colWidthToPx(undefined, worksheet.properties?.defaultColWidth);
  const defaultRow = rowHeightToPx(undefined, worksheet.properties?.defaultRowHeight);
  const images: FormImage[] = [];

  for (const item of worksheet.getImages() ?? []) {
    try {
      const media = workbook.getImage(Number(item.imageId));
      // EMF/WMF 는 윈도우 전용 그림 형식이라 브라우저가 못 연다. 그림 대신 자리 표시만 남긴다.
      const extension = String(media?.extension).toLowerCase();
      const unsupported = extension === "emf" || extension === "wmf" ? (extension as "emf" | "wmf") : undefined;
      // exceljs 판에 따라 바이트가 buffer/data 중 어디에 오는지 갈린다.
      const raw = media?.buffer ?? media?.data;
      const src = unsupported ? "" : toDataUrl(raw, media?.extension);
      // 못 읽은 그림을 넣으면 화면에 보이지 않는 <img> 만 남아 원인 찾기가 어려워진다.
      if (!src && !unsupported) continue;

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
        // exceljs 는 ext 를 **이미 px 로** 준다(1927411 EMU → 202.35). EMU 로 보고 한 번 더 나누면
        // 그림이 0.02px 로 줄어 사라졌다(8.11 견본·7.2 카메라의 로고).
        width = item.range?.ext?.width ?? 0;
        height = item.range?.ext?.height ?? 0;
      }
      if (!(width > 0) || !(height > 0)) continue;

      images.push({ src: src ?? "", left, top, width, height, ...(unsupported ? { unsupported } : {}) });
    } catch {
      // 그림 하나를 못 읽는다고 양식 전체를 못 열면 안 된다. 그 그림만 건너뛴다.
    }
  }
  return images;
}

/** exceljs Worksheet 하나를 격자 구조로 바꾼다. */
export function parseFormSheet(
  worksheet: any,
  workbook?: any,
  theme: ThemeColors = DEFAULT_THEME,
  /** 칸 주소 → 원본에 저장된 수식 결과(exceljs 가 버린 0 을 채운다) */
  formulaResults?: Map<string, unknown>,
): FormSheet {
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

  // 칸에 아무것도 없고 그림만 있는 시트(6.1-2 "리스크 평가기준" 은 표 전체가 그림 한 장)는
  // 그림이 닿는 칸까지를 범위로 삼는다. 안 그러면 "내용이 없는 시트"로 보고 그림까지 버린다.
  if (maxRow === 0 || maxCol === 0) {
    for (const item of typeof worksheet.getImages === "function" ? worksheet.getImages() ?? [] : []) {
      const corner = item.range?.br ?? item.range?.tl;
      if (!corner) continue;
      maxRow = Math.max(maxRow, (corner.nativeRow ?? 0) + 1);
      maxCol = Math.max(maxCol, (corner.nativeCol ?? 0) + 1);
    }
  }

  /**
   * 엑셀의 "시트 보호". 켜져 있으면 잠긴 칸은 엑셀에서도 못 고친다 —
   * 화면에서도 같게 막아야 양식이 흐트러지지 않는다.
   */
  const sheetLocked = Boolean(worksheet.sheetProtection ?? worksheet.model?.sheetProtection);

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

  // 2-1) "선택 영역의 가운데로"(centerContinuous) — 병합 없이 오른쪽 빈 칸들에 걸쳐 가운데 맞춘다.
  //      칸 하나 안에서만 가운데로 두면 머리글 "검사건수" 가 첫 칸에 몰리고 칸이 여덟 개로 쪼개져
  //      보였다(9.2). 글자 칸 + 오른쪽으로 이어진 빈 centerContinuous 칸을 합친 칸처럼 다룬다.
  const isSingle = (row: number, col: number) => {
    const box = boxes.get(masterOf.get(`${row}:${col}`) ?? "");
    return Boolean(box && box.minRow === box.maxRow && box.minCol === box.maxCol);
  };
  const centersAcross = (row: number, col: number) =>
    worksheet.getCell(row, col).alignment?.horizontal === "centerContinuous";
  for (let row = 1; row <= maxRow; row++) {
    for (let col = 1; col <= maxCol; col++) {
      if (!isSingle(row, col) || !centersAcross(row, col)) continue;
      if (cellText(worksheet.getCell(row, col).value).trim() === "") continue;
      let end = col;
      while (
        end + 1 <= maxCol &&
        isSingle(row, end + 1) &&
        centersAcross(row, end + 1) &&
        cellText(worksheet.getCell(row, end + 1).value).trim() === ""
      ) {
        end += 1;
      }
      if (end === col) continue;
      const masterAddress = masterOf.get(`${row}:${col}`)!;
      boxes.get(masterAddress)!.maxCol = end;
      for (let c = col + 1; c <= end; c++) {
        boxes.delete(masterOf.get(`${row}:${c}`)!);
        masterOf.set(`${row}:${c}`, masterAddress);
      }
      col = end;
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
      const style = readStyle(cell, theme);
      // 엑셀 "일반" 정렬은 숫자·날짜를 오른쪽에 붙인다(글자는 왼쪽). 정렬을 안 적은 숫자 칸을 왼쪽에
      // 두면 회계 형식의 "-" 와 금액이 칸 왼쪽에 몰렸다(8.4-2).
      if (!style.align) {
        const raw = cell.value as unknown;
        const result = raw && typeof raw === "object" && "result" in (raw as object) ? (raw as { result?: unknown }).result : raw;
        const saved = formulaResults?.get(cell.address);
        const shown = result === undefined ? saved : result;
        if (typeof shown === "number" || shown instanceof Date) style.align = "right";
      }
      // 병합된 칸은 바깥 테두리를 모서리 칸들에서 다시 읽는다.
      if (rowSpan > 1 || colSpan > 1) style.borders = readMergedBorders(worksheet, box, theme);

      // 엑셀의 잠금 기본값은 "잠김"이다. 푼 칸만 protection.locked === false 로 온다.
      const unlocked = (cell.protection as { locked?: unknown } | undefined)?.locked === false;
      // 차지한 열이 모두 숨었거나 줄이 모두 숨었으면 그리지 않는 칸이다.
      const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
      const hidden =
        span(box.minCol, box.maxCol).every((c) => worksheet.getColumn(c).hidden) ||
        span(box.minRow, box.maxRow).every((r) => worksheet.getRow(r).hidden);
      cells.push({
        key: `${row}:${col}`,
        row,
        col,
        rowSpan,
        colSpan,
        text: displayText(
          withSavedResult(cell.value, formulaResults?.get(cell.address)),
          typeof cell.numFmt === "string" ? cell.numFmt : undefined,
        ),
        // 보호가 안 걸린 시트에서는 잠금 표시를 달지 않는다(전부 고칠 수 있다).
        ...(sheetLocked && !unlocked ? { locked: true } : {}),
        // 수식이 있는 칸 — 줄을 끼울 때 범위가 어긋날 수 있다고 알리는 데 쓴다.
        ...(cell.formula || cell.sharedFormula ? { formula: true } : {}),
        ...(() => {
          const runs = readRuns(cell.value, theme);
          return runs ? { runs } : {};
        })(),
        ...(hidden ? { hidden: true } : {}),
        style,
      });
    }
  }

  // 시트마다 기본 너비·높이가 다르다(맑은 고딕 양식은 13.5pt, 엑셀 기본은 15pt).
  const defaultColWidth: number | undefined = worksheet.properties?.defaultColWidth;
  const defaultRowHeight: number | undefined = worksheet.properties?.defaultRowHeight;
  const colWidths: number[] = [];
  for (let col = 1; col <= maxCol; col++) {
    // 숨긴 열·줄은 폭·높이 0 — 엑셀 화면·인쇄에 안 나온다(7.6 문서보안기준안의 "문서양식 NO." 열).
    colWidths.push(worksheet.getColumn(col).hidden ? 0 : colWidthToPx(worksheet.getColumn(col).width, defaultColWidth));
  }
  const rowHeights: number[] = [];
  for (let row = 1; row <= maxRow; row++) {
    rowHeights.push(worksheet.getRow(row).hidden ? 0 : rowHeightToPx(worksheet.getRow(row).height, defaultRowHeight));
  }

  return {
    name: worksheet.name,
    rowCount: maxRow,
    colCount: maxCol,
    colWidths,
    rowHeights,
    cells,
    // 인쇄 영역 밖에 놓인 그림은 격자 밖으로 계산되므로 여기서 걸러진다. 인쇄 영역이 없으면
    // 거르지 않는다 — 표 오른쪽 빈 칸 위에 둔 그림(7.2 카메라의 복사본)까지 버려졌다. 그런 그림은
    // 나중에 격자를 늘려 자리를 잡는다(coverFloating).
    images: printArea
      ? withinGrid(readImages(worksheet, workbook, colWidths, rowHeights), colWidths, rowHeights)
      : readImages(worksheet, workbook, colWidths, rowHeights),
    // 도형은 exceljs 가 내주지 않아 원본 파일에서 따로 읽는다(parseFormWorkbook).
    shapes: [],
    // 실제로 잘라낸 경우에만 알린다. 인쇄 영역이 내용보다 넓으면 알릴 것이 없다.
    printArea: trimmed ? worksheet.pageSetup?.printArea : undefined,
    // 복합기로 뽑을 때 쓰려고 용지 설정을 들고 간다(A4 가로 등).
    page: {
      orientation: worksheet.pageSetup?.orientation === "landscape" ? "landscape" : "portrait",
      paperSize: worksheet.pageSetup?.paperSize,
      margins: worksheet.pageSetup?.margins,
      // 인쇄 배율 — 엑셀과 같은 장수로 뽑으려면 이 세 값이 필요하다(printSheet.ts 참고).
      scale: worksheet.pageSetup?.scale,
      fitToPage: worksheet.pageSetup?.fitToPage === true,
      fitToWidth: worksheet.pageSetup?.fitToWidth,
      fitToHeight: worksheet.pageSetup?.fitToHeight,
      // 바닥글 — 현장 양식은 여기에 서식 번호(QA-4.3-4)가 들어 있다.
      header: worksheet.headerFooter?.oddHeader,
      footer: worksheet.headerFooter?.oddFooter,
      headerMargin: worksheet.pageSetup?.margins?.header,
      footerMargin: worksheet.pageSetup?.margins?.footer,
      // 엑셀 [페이지 설정] → 페이지 가운데 맞춤. 켜져 있으면 종이 가운데에 찍힌다.
      horizontalCentered: worksheet.pageSetup?.horizontalCentered === true,
      verticalCentered: worksheet.pageSetup?.verticalCentered === true,
    },
    ...(sheetLocked ? { locked: true } : {}),
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

/**
 * 파일의 테마 색. 회색 제목줄·칸 배경 대부분이 테마 색으로 적혀 있다.
 * 못 읽으면 기본 Office 테마로 간다 — 색이 조금 다를 뿐 양식은 열린다.
 */
async function readTheme(data: ArrayBuffer): Promise<ThemeColors> {
  try {
    const index = readZipIndex(data);
    return parseThemeXml(await readZipText(data, index, "xl/theme/theme1.xml"));
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * 수식 칸의 저장된 결과를 원본 압축에서 직접 읽는다(시트 이름 → 칸 주소 → 결과).
 *
 * exceljs 는 결과가 **0** 인 수식(`<v>0</v>`)의 결과를 버린다 — 0 이 거짓으로 걸러진다. 그래서 소계·합계의
 * 0, 0.00 %, 회계 형식의 "-" 가 모두 빈칸으로 보였다(QA-8.6-1 등). 결과가 빠진 칸만 이것으로 채운다.
 */
async function readFormulaResults(data: ArrayBuffer): Promise<Map<string, Map<string, unknown>>> {
  const result = new Map<string, Map<string, unknown>>();
  const index = readZipIndex(data);
  const workbookXml = await readZipText(data, index, "xl/workbook.xml");
  const relsXml = await readZipText(data, index, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return result;
  const targets = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /\bId="([^"]+)"/.exec(rel)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel)?.[1];
    if (id && target) targets.set(id, target);
  }
  const unescape = (text: string) =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  for (const sheetTag of workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = /\bname="([^"]*)"/.exec(sheetTag)?.[1];
    const target = targets.get(/\br:id="([^"]+)"/.exec(sheetTag)?.[1] ?? "");
    if (!name || !target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await readZipText(data, index, path);
    if (!xml) continue;
    const cells = new Map<string, unknown>();
    for (const match of xml.matchAll(/<c\b([^>]*[^/>])>([\s\S]*?)<\/c>/g)) {
      const body = match[2];
      if (!body.includes("<f")) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const address = /\br="([A-Z]+\d+)"/.exec(match[1])?.[1];
      if (v === undefined || !address) continue;
      const type = /\bt="([^"]+)"/.exec(match[1])?.[1] ?? "n";
      cells.set(
        address,
        type === "e" ? { error: v } : type === "str" ? unescape(v) : type === "b" ? v === "1" : Number(v),
      );
    }
    if (cells.size > 0) result.set(unescape(name), cells);
  }
  return result;
}

/**
 * 표 아래·오른쪽으로 삐져나간 차트·그림까지 보이도록 빈 줄·열을 덧붙인다.
 *
 * 엑셀은 차트를 표 밖 빈 칸 위에 두어도 시트의 일부로 보여 준다. 여기서는 표 크기만큼만 자리를
 * 잡아, 표 아래에 둔 경영검토 차트 세 개가 통째로 잘려 안 보였다(9.4).
 */
function coverFloating(sheet: FormSheet, defaultRow: number, defaultCol: number): void {
  if (sheet.rowCount === 0) return;
  const floating = [...(sheet.charts ?? []), ...sheet.images];
  if (floating.length === 0) return;
  const bottom = Math.max(...floating.map((item) => item.top + item.height));
  const right = Math.max(...floating.map((item) => item.left + item.width));
  let height = sheet.rowHeights.reduce((sum, h) => sum + h, 0);
  while (height < bottom - 0.5) {
    sheet.rowHeights.push(defaultRow);
    sheet.rowCount += 1;
    height += defaultRow;
  }
  let width = sheet.colWidths.reduce((sum, w) => sum + w, 0);
  while (width < right - 0.5) {
    sheet.colWidths.push(defaultCol);
    sheet.colCount += 1;
    width += defaultCol;
  }
}

/** .xlsx 파일 내용을 시트 목록으로 바꾼다. 시트가 여러 개면 전부 돌려준다. */
export async function parseFormWorkbook(data: ArrayBuffer): Promise<FormSheet[]> {
  // 브라우저용 exceljs 는 UMD 번들이라 default 로 감싸질 때와 아닐 때가 갈린다.
  const module = (await import("exceljs")) as unknown as Record<string, any>;
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  // exceljs 가 버퍼를 소유·이관해 비워 버려도 도형을 읽을 수 있게 복사본을 넘긴다.
  await workbook.xlsx.load(data.slice(0));
  const theme = await readTheme(data);
  // 결과를 잃은 수식 칸(결과가 0 인 것)은 원본의 결과로 채운다. exceljs 에 되돌려 넣어도 0 은 또 버려져
  // 따로 넘긴다. 못 읽으면 빈칸으로 둔다 — 양식을 못 여는 것보다 가볍다.
  const saved = await readFormulaResults(data).catch(() => new Map<string, Map<string, unknown>>());
  const sheets: FormSheet[] = workbook.worksheets.map((worksheet: any) =>
    parseFormSheet(worksheet, workbook, theme, saved.get(worksheet.name)),
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
    const shapes = await parseWorkbookShapes(
      data,
      sizes,
      { col: colWidthToPx(undefined, undefined), row: rowHeightToPx(undefined, undefined) },
      theme,
    );
    for (const sheet of sheets) {
      sheet.shapes = withinGrid(shapes.get(sheet.name) ?? [], sheet.colWidths, sheet.rowHeights);
    }
    // 차트 — 빠뜨리면 경영검토 보고서의 공정·재검측율·NCR 차트 자리가 통째로 비었다(9.4).
    const charts = await parseWorkbookCharts(
      data,
      sizes,
      { col: colWidthToPx(undefined, undefined), row: rowHeightToPx(undefined, undefined) },
      theme,
    );
    for (const sheet of sheets) {
      const found = charts.get(sheet.name);
      if (found) sheet.charts = found;
      coverFloating(sheet, rowHeightToPx(undefined, undefined), colWidthToPx(undefined, undefined));
    }
  } catch {
    // 도형을 못 읽는 것은 양식을 못 여는 것보다 가볍다.
  }

  return sheets;
}
