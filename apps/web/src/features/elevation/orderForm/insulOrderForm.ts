/**
 * 단열재 자재 발주의뢰서 — 회사 표준 양식(엑셀)을 **그대로 채워서** 내보낸다.
 *
 * 타워크레인 발주의뢰서(`tcRental/tcOrderForm.ts`)와 같은 방식이다. 시트를 코드로 그리지 않고
 * 원본 양식 `public/templates/insul-order-template.xlsx`(표지 · 자재청구서 · 발주수량 검토)을
 * 싣고 셀 값만 바꾼다. 결재가 도는 문서라 테두리·병합·인쇄 설정이 판박이여야 한다.
 *
 * 양식의 시트 사이 수식 연결도 원본과 같게 다시 쓴다:
 *   실행예산 내역서(업로드한 2-2 · 11-3) D열(수량)
 *     → 발주수량 검토 E/F열(가실행 기본/확장)      ← 수식으로 내역서 행을 가리킨다
 *     → 자재청구서 I열(실행예산 수량) · N열(청구 누계)
 * 내역서 두 장은 업로드한 통합 문서에서 **값만** 옮겨 싣는다 — 내역서 안의 수식은 다른 파일
 * (`[57]공사개요` 같은 외부 연결)을 가리켜 그대로 두면 열 때마다 연결 갱신을 묻는다.
 *
 * 행 번호는 양식 원본 기준이다. 품목이 양식 칸수보다 많으면 줄을 끼워 넣고 인쇄 영역을 늘린다.
 */
// 타입만 정적으로 쓴다 — 라이브러리 본체는 실제로 만들 때만 받는다(첫 화면 무게).
import type ExcelJS from "exceljs";
import JSZip from "jszip";
import type { InsulBudget } from "./budgetParser.ts";
import { effectiveRows, type OrderLine } from "./orderLines.ts";

const TEMPLATE_URL = "/templates/insul-order-template.xlsx";
const KEEP_SHEETS = ["표지", "자재청구서", "발주수량 검토"];

/** 발주수량 검토 — 양식 원본 행 배치 */
const QTY = {
  /** 데이터 첫 줄·마지막 줄 (6~24), 인쇄 영역 끝 25 */
  first: 6,
  last: 24,
  printLast: 25,
  /** 서식 본보기 — 공종 머리줄 · 소제목 줄 · 품목 줄 */
  modelSection: 6,
  modelSub: 7,
  modelItem: 8,
  cols: [1, 18] as [number, number],
} as const;

/** 자재청구서 — 양식 원본 행 배치 */
const REQ = {
  first: 10,
  last: 30,
  /** 바닥글(양식 번호·용지) — 이 줄 앞에 끼워 넣는다 */
  footer: 31,
  modelSection: 10,
  modelItem: 11,
  cols: [1, 23] as [number, number],
  /** 품목 줄마다 병합되는 칸 */
  merges: ["A:B", "C:E", "F:G", "N:O", "P:Q", "R:S", "T:V"],
} as const;

export interface InsulOrderInput {
  siteName: string;
  /** 업로드한 실행예산 통합 문서 — 내역서 두 장을 여기서 옮겨 싣는다 */
  budgetWorkbook: ExcelJS.Workbook;
  budget: InsulBudget;
  lines: OrderLine[];
}

// ── 공용 보조 (tcOrderForm 과 같은 규칙 — 그쪽 파일은 타워크레인 전용이라 가져오지 않는다) ──

/** 공유 수식을 셀마다 제 수식으로 펼친다 — 셀을 건드리기 전에 해야 저장 때 터지지 않는다 */
function unshareFormulas(ws: ExcelJS.Worksheet) {
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value as { formula?: string; sharedFormula?: string; result?: unknown } | null;
      if (!v || typeof v !== "object") return;
      if (!("sharedFormula" in v) && !("formula" in v)) return;
      const own = cell.formula;
      if (!own) return;
      cell.value = { formula: own, result: v.result as never };
    });
  });
}

/** 삭제한 시트를 가리키는 명명된 범위를 걷어낸다 — 남기면 엑셀이 복구를 묻는다 */
function pruneDefinedNames(wb: ExcelJS.Workbook, keep: string[]) {
  const dn = (wb as unknown as { _definedNames?: { model?: Array<{ ranges?: string[] }> } })
    ._definedNames;
  const model = dn?.model;
  if (!Array.isArray(model)) return;
  const ok = new Set(keep);
  for (const entry of model) {
    if (!Array.isArray(entry.ranges)) continue;
    entry.ranges = entry.ranges.filter((r) => {
      const sheet = /^'?([^'!]+)'?!/.exec(r)?.[1];
      return sheet ? ok.has(sheet) : false;
    });
  }
  dn!.model = model.filter((e) => (e.ranges?.length ?? 0) > 0);
}

function clearRegion(ws: ExcelJS.Worksheet, r1: number, r2: number, c1: number, c2: number) {
  for (let r = r1; r <= r2; r += 1) {
    const row = ws.getRow(r);
    for (let c = c1; c <= c2; c += 1) row.getCell(c).value = null;
  }
}

function colName(c: number): string {
  let s = "";
  let n = c;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function mergeRanges(ws: ExcelJS.Worksheet): string[] {
  const raw =
    (ws as unknown as { _merges?: Record<string, { range?: string } | string> })._merges ?? {};
  return Object.values(raw)
    .map((m) => (typeof m === "string" ? m : m?.range))
    .filter((x): x is string => typeof x === "string");
}

function parseRange(range: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.replace(/\$/g, ""));
  if (!m) return null;
  const col = (t: string) => [...t].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

function unmerge(ws: ExcelJS.Worksheet, range: string) {
  try {
    ws.unMergeCells(range);
  } catch {
    /* 이미 병합이 아니면 무시 */
  }
}

function mergeSafe(ws: ExcelJS.Worksheet, range: string) {
  try {
    ws.mergeCells(range);
  } catch {
    /* 이미 병합돼 있으면 그대로 */
  }
}

/** 한 줄의 서식(열 범위)을 떠 둔다 — 줄을 지우고 다시 채울 때 입힌다 */
type RowStyle = { height: number | undefined; cells: Array<Partial<ExcelJS.Style>> };
function snapshotRow(ws: ExcelJS.Worksheet, r: number, cols: [number, number]): RowStyle {
  const row = ws.getRow(r);
  const cells: Array<Partial<ExcelJS.Style>> = [];
  for (let c = cols[0]; c <= cols[1]; c += 1) cells.push({ ...row.getCell(c).style });
  return { height: row.height, cells };
}
function applyRowStyle(ws: ExcelJS.Worksheet, r: number, st: RowStyle, cols: [number, number]) {
  const row = ws.getRow(r);
  if (st.height) row.height = st.height;
  for (let c = cols[0]; c <= cols[1]; c += 1) row.getCell(c).style = { ...st.cells[c - cols[0]] };
}

/**
 * `atRow` 앞에 빈 줄 `count` 개를 끼워 넣는다 (sheetRows.insertRows 와 같은 규칙).
 * 병합은 spliceRows 가 옮겨 주지 않아 직접 내리고, 새 줄은 `model` 서식을 입는다.
 */
function insertRows(
  ws: ExcelJS.Worksheet,
  atRow: number,
  count: number,
  model: RowStyle,
  cols: [number, number],
) {
  if (count <= 0) return;
  const moves: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
  for (const range of mergeRanges(ws)) {
    const g = parseRange(range);
    if (!g || g.r2 < atRow) continue;
    moves.push(
      g.r1 >= atRow ? { ...g, r1: g.r1 + count, r2: g.r2 + count } : { ...g, r2: g.r2 + count },
    );
    unmerge(ws, range);
  }
  ws.spliceRows(atRow, 0, ...Array.from({ length: count }, () => [] as never[]));
  for (let r = atRow; r < atRow + count; r += 1) applyRowStyle(ws, r, model, cols);
  for (const g of moves) mergeSafe(ws, `${colName(g.c1)}${g.r1}:${colName(g.c2)}${g.r2}`);
}

/** 시트 이름을 수식에 넣을 때 — 공백·괄호·점이 있으면 작은따옴표로 싼다 */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;

// ── 내역서 두 장 옮겨 싣기 ──

/** 수식 셀은 계산된 값으로, 나머지는 그대로 */
function plainValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  const v = cell.value;
  if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    const r = (v as { result?: unknown }).result;
    if (r && typeof r === "object" && "error" in (r as object))
      return String((r as { error: string }).error);
    return (r ?? null) as ExcelJS.CellValue;
  }
  return v;
}

/**
 * 업로드한 통합 문서의 시트 한 장을 값·서식·병합·열 너비째 복사한다.
 * ExcelJS 는 통합 문서 사이 시트 복사가 없어 셀 단위로 옮긴다(1,500행 × 14열 수준이라 충분히 빠르다).
 */
function copySheetValues(src: ExcelJS.Worksheet, wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const dst = wb.addWorksheet(name);
  // 시트 속성(그룹 요약 행 위치 등)·인쇄 설정 — 사용자가 접어 둔 그룹과 인쇄 영역이 그대로 따라온다
  dst.properties = { ...src.properties };
  dst.pageSetup = { ...src.pageSetup };
  src.columns?.forEach((col, i) => {
    if (!col) return;
    const d = dst.getColumn(i + 1);
    if (col.width) d.width = col.width;
    if (col.hidden) d.hidden = true;
    if (col.outlineLevel) d.outlineLevel = col.outlineLevel;
  });
  // 빈 줄도 돈다 — 접힌(숨김) 줄·그룹 수준은 값이 없는 줄에도 붙어 있다
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const drow = dst.getRow(r);
    if (row.height) drow.height = row.height;
    if (row.hidden) drow.hidden = true;
    if (row.outlineLevel) drow.outlineLevel = row.outlineLevel;
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const d = drow.getCell(c);
      d.value = plainValue(cell);
      d.style = { ...cell.style };
    });
  });
  for (const range of mergeRanges(src)) mergeSafe(dst, range);
  if (src.views?.length) dst.views = src.views.map((v) => ({ ...v }));
  return dst;
}

// ── 시트별 채우기 ──

function fillCover(wb: ExcelJS.Workbook, siteName: string, now: Date) {
  const ws = wb.getWorksheet("표지");
  if (!ws) return;
  const y = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  ws.getCell("A1").value = `[${siteName}] 단열재 자재 청구서`;
  ws.getCell("A12").value = `${y}년   ${mm}월      일`;
  for (const c of ["J15", "J16", "J17"]) ws.getCell(c).value = ` ${y}년  ${mm}월     일`;
  ws.getCell("A20").value = siteName;
}

/** 발주수량 검토에 쓴 줄의 종류 — 자재청구서가 이 줄들을 가리킨다 */
type QtyRowKind = "section" | "sub" | "item";
interface QtyRowRef {
  kind: QtyRowKind;
  row: number;
  /** 품목 줄: 왼쪽(가실행)이 있는 첫 줄이면 true, 겹별 추가 줄이면 false */
  hasBudget: boolean;
  /** Layout 세분화 품목이면 true — 청구서에 예산 규격 줄을 하나 더 낸다 */
  split: boolean;
}

/**
 * 발주수량 검토 — 공종 → [지급자재] → 품목 순으로 다시 쓴다.
 * 왼쪽(B~G)은 내역서 행을 가리키는 수식, 오른쪽(H~O)은 발주 결정.
 * 원본 양식처럼 예산 그대로 발주하는 줄은 `=E`,`=F` 수식으로 두고, Layout 산출 줄은 숫자를 적는다.
 */
function fillQty(ws: ExcelJS.Worksheet, input: InsulOrderInput): QtyRowRef[] {
  const { budget, lines, siteName } = input;
  const stSection = snapshotRow(ws, QTY.modelSection, QTY.cols);
  const stSub = snapshotRow(ws, QTY.modelSub, QTY.cols);
  const stItem = snapshotRow(ws, QTY.modelItem, QTY.cols);

  // 필요한 줄 수를 먼저 센다 — 값을 채운 뒤 늘리면 방금 쓴 수식까지 밀린다
  const sections = new Map<string, OrderLine[]>();
  for (const l of lines) {
    const arr = sections.get(l.item.section) ?? [];
    arr.push(l);
    sections.set(l.item.section, arr);
  }
  let need = 0;
  for (const arr of sections.values()) {
    need += 2;
    for (const l of arr) need += effectiveRows(l).length;
  }
  const avail = QTY.last - QTY.first + 1;
  clearRegion(ws, QTY.first, QTY.last, QTY.cols[0], QTY.cols[1]);
  if (need > avail) {
    insertRows(ws, QTY.last + 1, need - avail, stItem, QTY.cols);
    ws.pageSetup.printArea = `A1:Q${QTY.printLast + (need - avail)}`;
  }

  ws.getCell("B2").value = `[${siteName}]`;

  const refs: QtyRowRef[] = [];
  let r = QTY.first;
  const baseRef = budget.baseSheet ? sheetRef(budget.baseSheet) : null;
  const extRef = budget.extSheet ? sheetRef(budget.extSheet) : null;

  for (const [section, arr] of sections) {
    applyRowStyle(ws, r, stSection, QTY.cols);
    ws.getCell(`B${r}`).value = section;
    ws.getCell(`H${r}`).value = { formula: `B${r}` };
    refs.push({ kind: "section", row: r, hasBudget: false, split: false });
    r += 1;

    applyRowStyle(ws, r, stSub, QTY.cols);
    ws.getCell(`B${r}`).value = "[지급자재]";
    ws.getCell(`H${r}`).value = { formula: `B${r}` };
    refs.push({ kind: "sub", row: r, hasBudget: false, split: false });
    r += 1;

    for (const line of arr) {
      const { item } = line;
      const rows = effectiveRows(line);
      const split = line.useLayout && line.layoutRows.length > 0;
      rows.forEach((orow, i) => {
        applyRowStyle(ws, r, stItem, QTY.cols);
        const first = i === 0;
        if (first) {
          // 왼쪽 — 가실행(내역서 행 참조). 기본/확장 어느 쪽이든 있는 줄에서 품명·규격·단위를 끈다
          const src = item.base ?? item.ext;
          const srcRef = item.base ? baseRef : extRef;
          if (src && srcRef) {
            ws.getCell(`B${r}`).value = { formula: `${srcRef}!A${src.excelRow}` };
            ws.getCell(`C${r}`).value = { formula: `${srcRef}!B${src.excelRow}` };
            ws.getCell(`D${r}`).value = { formula: `${srcRef}!C${src.excelRow}` };
          } else {
            ws.getCell(`B${r}`).value = item.name;
            ws.getCell(`C${r}`).value = item.spec;
            ws.getCell(`D${r}`).value = item.unit;
          }
          ws.getCell(`E${r}`).value =
            item.base && baseRef ? { formula: `${baseRef}!D${item.base.excelRow}` } : 0;
          ws.getCell(`F${r}`).value =
            item.ext && extRef ? { formula: `${extRef}!D${item.ext.excelRow}` } : 0;
          ws.getCell(`G${r}`).value = { formula: `E${r}+F${r}` };
        }
        // 오른쪽 — 발주
        ws.getCell(`H${r}`).value = first ? { formula: `B${r}` } : item.name;
        if (split) {
          ws.getCell(`I${r}`).value = orow.spec;
          ws.getCell(`J${r}`).value = first ? { formula: `D${r}` } : orow.unit;
          ws.getCell(`K${r}`).value = orow.orderBase;
          ws.getCell(`L${r}`).value = orow.orderExt;
        } else {
          ws.getCell(`I${r}`).value = { formula: `C${r}` };
          ws.getCell(`J${r}`).value = { formula: `D${r}` };
          // 예산 그대로면 수식으로 묶어 두고, 사용자가 고쳤으면 숫자를 적는다
          ws.getCell(`K${r}`).value =
            orow.orderBase === item.baseQty ? { formula: `E${r}` } : orow.orderBase;
          ws.getCell(`L${r}`).value =
            orow.orderExt === item.extQty ? { formula: `F${r}` } : orow.orderExt;
        }
        ws.getCell(`M${r}`).value = { formula: `K${r}+L${r}` };
        ws.getCell(`N${r}`).value = { formula: `M${r}-G${r}` };
        ws.getCell(`O${r}`).value = { formula: `IFERROR(N${r}/M${r},0)` };
        if (orow.reason) ws.getCell(`P${r}`).value = orow.reason;
        if (orow.where) ws.getCell(`R${r}`).value = orow.where;
        refs.push({ kind: "item", row: r, hasBudget: first, split });
        r += 1;
      });
    }
  }
  return refs;
}

/**
 * 자재청구서 — 발주수량 검토 줄을 순서대로 가리킨다.
 *  · 공종 줄: 품명 칸에 공종
 *  · Layout 세분화 품목: 예산 규격 줄(실행 수량만, 청구 0) + 겹별 줄(실행 0, 청구 누계)
 *  · 그 밖: 한 줄(실행 = 가실행 합계, 청구 누계 = 발주 합계)
 * 금액(K)=수량×단가, 금회(M)=누계−기청구, 차감(P)=누계−실행 은 양식 수식 그대로.
 */
function fillRequest(ws: ExcelJS.Worksheet, siteName: string, refs: QtyRowRef[]) {
  const Q = sheetRef("발주수량 검토");
  const stSection = snapshotRow(ws, REQ.modelSection, REQ.cols);
  const stItem = snapshotRow(ws, REQ.modelItem, REQ.cols);

  type ReqRow = { kind: "section" | "budget" | "order"; ref: QtyRowRef };
  const plan: ReqRow[] = [];
  for (const ref of refs) {
    if (ref.kind === "section") plan.push({ kind: "section", ref });
    else if (ref.kind === "sub") continue;
    else {
      if (ref.split && ref.hasBudget) plan.push({ kind: "budget", ref });
      plan.push({ kind: "order", ref });
    }
  }

  const avail = REQ.last - REQ.first + 1;
  clearRegion(ws, REQ.first, REQ.last, REQ.cols[0], REQ.cols[1]);
  if (plan.length > avail) {
    insertRows(ws, REQ.footer, plan.length - avail, stItem, REQ.cols);
    for (let r = REQ.last + 1; r < REQ.first + plan.length; r += 1)
      for (const m of REQ.merges) {
        const [a, b] = m.split(":");
        mergeSafe(ws, `${a}${r}:${b}${r}`);
      }
  }

  ws.getCell("G1").value = `[${siteName}] 단열재 자재 청구서`;

  let r = REQ.first;
  for (const p of plan) {
    const q = p.ref.row;
    if (p.kind === "section") {
      applyRowStyle(ws, r, stSection, REQ.cols);
      ws.getCell(`C${r}`).value = { formula: `${Q}!H${q}` };
      r += 1;
      continue;
    }
    applyRowStyle(ws, r, stItem, REQ.cols);
    const budgetSpec = p.kind === "budget";
    ws.getCell(`C${r}`).value = { formula: `${Q}!${budgetSpec ? "B" : "H"}${q}` };
    ws.getCell(`F${r}`).value = { formula: `${Q}!${budgetSpec ? "C" : "I"}${q}` };
    ws.getCell(`H${r}`).value = { formula: `${Q}!${budgetSpec ? "D" : "J"}${q}` };
    // 실행예산 수량 — 세분화 품목은 예산 규격 줄에만 적고 겹별 줄은 0, 그 밖은 첫 줄에
    const showBudget = budgetSpec || (p.ref.hasBudget && !p.ref.split);
    ws.getCell(`I${r}`).value = showBudget ? { formula: `${Q}!G${q}` } : 0;
    ws.getCell(`K${r}`).value = { formula: `I${r}*J${r}` };
    ws.getCell(`L${r}`).value = 0;
    ws.getCell(`M${r}`).value = { formula: `N${r}-L${r}` };
    ws.getCell(`N${r}`).value = budgetSpec ? 0 : { formula: `${Q}!M${q}` };
    ws.getCell(`P${r}`).value = { formula: `N${r}-I${r}` };
    r += 1;
  }
}

// ── 진입점 ──

/**
 * 양식 통합 문서를 만든다 — 브라우저 없이도 돌아가는 부분(시험용).
 * @param templateBuf `insul-order-template.xlsx` 의 내용
 * @param now 표지 날짜 (시험에서 고정하려고 받는다)
 */
export async function buildInsulOrderWorkbook(
  input: InsulOrderInput,
  templateBuf: ArrayBuffer,
  now: Date = new Date(),
): Promise<{ workbook: ExcelJS.Workbook; warnings: string[] }> {
  const warnings: string[] = [];
  if (input.lines.length === 0)
    throw new Error("발주할 단열재 품목이 없습니다. 실행예산 내역서를 먼저 올리세요.");
  const siteName = input.siteName.trim() || "현장";

  const XL = (await import("exceljs")).default;
  const wb = new XL.Workbook();
  await wb.xlsx.load(templateBuf);

  for (const ws of [...wb.worksheets]) if (!KEEP_SHEETS.includes(ws.name)) wb.removeWorksheet(ws.id);
  for (const ws of wb.worksheets) unshareFormulas(ws);

  // 내역서 두 장 — 업로드 문서에서 값만 옮긴다 (검토 시트 수식이 이 이름·행을 가리킨다)
  const copied: string[] = [];
  for (const name of [input.budget.baseSheet, input.budget.extSheet]) {
    if (!name) continue;
    const src = input.budgetWorkbook.getWorksheet(name);
    if (!src) {
      warnings.push(`내역서 시트를 찾지 못했습니다: ${name}`);
      continue;
    }
    copySheetValues(src, wb, name);
    copied.push(name);
  }
  pruneDefinedNames(wb, [...KEEP_SHEETS, ...copied]);
  if (!input.budget.extSheet) warnings.push("확장(11-3) 내역서가 없어 확장 수량은 0 으로 두었습니다.");

  fillCover(wb, siteName, now);
  const qty = wb.getWorksheet("발주수량 검토");
  const refs = qty ? fillQty(qty, { ...input, siteName }) : [];
  const req = wb.getWorksheet("자재청구서");
  if (req) fillRequest(req, siteName, refs);

  // 수식만 써 두고 값은 비워 두므로, 파일을 열 때 엑셀이 다시 계산하게 한다
  wb.calcProperties.fullCalcOnLoad = true;
  return { workbook: wb, warnings };
}

/**
 * 통합 문서를 xlsx 바이트로 — ExcelJS 가 쓴 `<sheetPr>` 자식 순서를 바로잡는다.
 *
 * OOXML 은 `<sheetPr>` 안을 tabColor → outlinePr → pageSetUpPr 순으로 요구하는데, ExcelJS 는
 * pageSetUpPr(용지 맞춤) 을 outlinePr(그룹 요약 위치) 앞에 쓴다. 둘 다 있는 시트(접어 둔 내역서 +
 * 인쇄 설정)가 생기면 Excel 이 파일을 열지 못한다("Open 속성을 구할 수 없습니다"). 둘 중 하나만
 * 있으면 멀쩡해서 양식 3장에서는 드러나지 않았다. 저장된 zip 안의 시트 XML 에서 순서를 바꾼다.
 */
export async function writeInsulOrderXlsx(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const raw = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(raw);
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  for (const name of sheets) {
    const xml = await zip.file(name)!.async("string");
    const fixed = xml.replace(/(<pageSetUpPr\b[^>]*\/>)(<outlinePr\b[^>]*\/>)/g, "$2$1");
    if (fixed !== xml) zip.file(name, fixed);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 양식을 받아 채우고 내려받는다 (브라우저) */
export async function generateInsulOrderForm(input: InsulOrderInput): Promise<string[]> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("발주의뢰서 양식을 불러오지 못했습니다.");
  const { workbook: wb, warnings } = await buildInsulOrderWorkbook(input, await res.arrayBuffer());
  const siteName = input.siteName.trim() || "현장";

  const buf = await writeInsulOrderXlsx(wb);
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${siteName}_단열재 자재 발주의뢰서.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return warnings;
}

/** 업로드한 엑셀을 ExcelJS 로 읽어 파서용 2차원 배열로 (수식은 계산된 값, A~D 열만) */
export async function loadBudgetWorkbook(buf: ArrayBuffer): Promise<{
  workbook: ExcelJS.Workbook;
  grids: { name: string; rows: (string | number | null)[][] }[];
}> {
  const XL = (await import("exceljs")).default;
  const workbook = new XL.Workbook();
  await workbook.xlsx.load(buf);
  const grids = workbook.worksheets.map((ws) => {
    const rows: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const line: (string | number | null)[] = [];
      for (let c = 1; c <= 4; c += 1) {
        const v = plainValue(row.getCell(c));
        if (v == null) line.push(null);
        else if (typeof v === "number" || typeof v === "string") line.push(v);
        else if (typeof v === "object" && "richText" in v)
          line.push((v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join(""));
        else line.push(String(v));
      }
      rows[r - 1] = line;
    });
    return { name: ws.name, rows };
  });
  return { workbook, grids };
}
