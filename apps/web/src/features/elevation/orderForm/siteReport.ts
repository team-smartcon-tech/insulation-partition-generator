/**
 * 현장산출서 — 단위세대 타입별 수량 + 동별 집계표.
 *
 * 페이지가 입면·매트릭스에서 **구조화된 보고서(SiteReport)** 를 만들고, 여기서는 그것을
 *   · CSV(기존 「현장식 산출서 CSV」 와 같은 모양) 로 펼치거나
 *   · 발주의뢰서 맨 뒤 「현장산출검토」 시트(ExcelJS, 보고서 꼴) 로 그린다.
 * 같은 숫자가 두 출력에 나가야 하므로 계산은 한 곳(페이지 `buildSiteReport`)에서만 한다.
 */
import type ExcelJS from "exceljs";

/** 실면적(나누기 전 전개면 − 오프닝) 대비 산출면적(주문 판수 × 정척면적) 비교 — 두께별 + 합계 */
export interface SiteReportCmp {
  /** 두께별 실면적(㎡) — `thks` 순서 */
  net: number[];
  /** 두께별 로스율(%) — 실면적 0 이면 null */
  loss: (number | null)[];
  netSum: number;
  grossSum: number;
  diff: number;
  lossAll: number | null;
}

/** ① 단위세대 타입 × 층 그룹 한 줄 (대표 입면 1세대 기준). 대표 입면이 없으면 group 이하 null */
export interface SiteReportTypeRow {
  type: string;
  group: string | null;
  floorHeight: number | null;
  /** 두께별 주문 판수(EA) */
  ea: number[] | null;
  /** 두께별 산출면적(㎡) */
  area: number[] | null;
  cmp: SiteReportCmp | null;
}

/** ② 동 × 타입 한 줄 (층 그룹별 1세대 물량 × 세대수) */
export interface SiteReportBuildingRow {
  building: string;
  type: string;
  low: number;
  roof: number;
  base: number;
  total: number;
  /** 소스 입면이 있으면 [1~3F, 지붕, 기준] 층고, 없으면 null */
  floorHeights: number[] | null;
  /** 두께별 산출면적(㎡). 소스 입면이 없으면 null(표시는 대시, 합계에는 0) */
  area: number[] | null;
  cmp: SiteReportCmp | null;
}

export interface SiteReport {
  /** 등장하는 두께(mm) 오름차순 — 모든 두께별 배열이 이 순서를 따른다 */
  thks: number[];
  typeRows: SiteReportTypeRow[];
  buildingRows: SiteReportBuildingRow[];
  total: { units: number; area: number[]; cmp: SiteReportCmp };
  /** 대표 입면이 없는 타입 이름 */
  missing: string[];
}

/** 두께별 실면적·산출면적 → 비교 묶음 */
export function makeCmp(thks: number[], net: Map<number, number> | null, gross: Map<number, number>): SiteReportCmp {
  const n = thks.map((t) => net?.get(t) ?? 0);
  const g = thks.map((t) => gross.get(t) ?? 0);
  const loss = n.map((v, i) => (v > 0 ? ((g[i] - v) / v) * 100 : null));
  const netSum = n.reduce((a, b) => a + b, 0);
  const grossSum = g.reduce((a, b) => a + b, 0);
  return {
    net: n,
    loss,
    netSum,
    grossSum,
    diff: grossSum - netSum,
    lossAll: netSum > 0 ? ((grossSum - netSum) / netSum) * 100 : null,
  };
}

// ── CSV (기존 「현장식 산출서 CSV」 와 같은 배치) ──

const esc = (s: string) => (s ?? "").replace(/,/g, " ");

function cmpCsv(c: SiteReportCmp): string {
  return [
    ...c.net.map((v) => v.toFixed(2)),
    ...c.loss.map((v) => (v == null ? "-" : v.toFixed(1))),
    c.netSum.toFixed(2),
    c.grossSum.toFixed(2),
    c.diff.toFixed(2),
    c.lossAll == null ? "-" : c.lossAll.toFixed(1),
  ].join(",");
}

export const SITE_REPORT_NOTE_NET =
  "※ 실면적 = 전개면(전개길이×층고) − 오프닝. 나누기와 무관한 순수 시공면적. 변(면)마다의 두께로 나눠 집계.";
export const SITE_REPORT_NOTE_GROSS = "※ 산출면적 = 주문 판수 × 정척면적(현장식). 로스율 = (산출−실면적) ÷ 실면적.";

export function siteReportToCsv(r: SiteReport): string {
  const { thks } = r;
  const eaCols = thks.map((t) => `${t}T 개수(EA)`).join(",");
  const arCols = thks.map((t) => `${t}T 면적(M2)`).join(",");
  const netCols = thks.map((t) => `${t}T 실면적(M2)`).join(",");
  const lossCols = thks.map((t) => `${t}T 로스율(%)`).join(",");
  const cmpCols = `${netCols},${lossCols},실면적 계(M2),산출면적 계(M2),차이(M2),로스율(%)`;
  const dash = thks.map(() => "-").join(",");
  const cmpDash = [...thks.map(() => "-"), ...thks.map(() => "-"), "-", "-", "-", "-"].join(",");

  const rows: string[] = [];
  rows.push("[단위세대 타입별 단열재 수량]");
  rows.push(SITE_REPORT_NOTE_NET);
  rows.push(SITE_REPORT_NOTE_GROSS);
  rows.push(`단위세대 타입,층 그룹,층고(mm),${eaCols},${arCols},${cmpCols}`);
  for (const t of r.typeRows) {
    if (!t.ea || !t.area || !t.cmp) {
      rows.push(`${esc(t.type)},-,-,${dash},${dash},${cmpDash}`);
      continue;
    }
    rows.push(
      `${esc(t.type)},${t.group},${t.floorHeight == null ? "-" : Math.round(t.floorHeight)},${t.ea.join(",")},${t.area
        .map((v) => v.toFixed(2))
        .join(",")},${cmpCsv(t.cmp)}`,
    );
  }
  rows.push("");

  rows.push("[동별 단열재 집계표]");
  rows.push(`동,단위세대 타입,1~3F,지붕층,기준층,세대수,층고(1~3F/지붕/기준),${arCols},${cmpCols}`);
  for (const b of r.buildingRows) {
    const fh = (b.floorHeights ?? [null, null, null]).map((v) => (v == null ? "-" : Math.round(v))).join("/");
    const ar = thks.map((_, i) => (b.area ? b.area[i].toFixed(1) : "-")).join(",");
    rows.push(
      `${esc(b.building)},${esc(b.type)},${b.low},${b.roof},${b.base},${b.total},${fh},${ar},${b.cmp ? cmpCsv(b.cmp) : cmpDash}`,
    );
  }
  rows.push(`합계,,,,,${r.total.units},,${r.total.area.map((v) => v.toFixed(1)).join(",")},${cmpCsv(r.total.cmp)}`);
  return "﻿" + rows.join("\r\n");
}

// ── 발주의뢰서 맨 뒤 「현장산출검토」 시트 ──

const NAVY = "FF0F2A4A";
const GRAY = "FF5C6E82";
const LINE = "FFD7DEE7";
const HEAD_BG = "FFEFF5FD";
const SUB_BG = "FFF7FAFD";
const TOTAL_BG = "FFFFF4DC";
const SECTION_BG = "FF12365C";

interface CellOpt {
  bold?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  border?: boolean;
  numFmt?: string;
}

function put(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, opt: CellOpt = {}) {
  const cell = ws.getRow(row).getCell(col);
  cell.value = value;
  cell.font = { name: "맑은 고딕", size: opt.size ?? 9, bold: opt.bold ?? false, color: { argb: opt.color ?? NAVY } };
  cell.alignment = { horizontal: opt.align ?? "left", vertical: "middle", wrapText: opt.wrap ?? false };
  if (opt.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
  if (opt.border !== false) {
    const side = { style: "thin" as const, color: { argb: LINE } };
    cell.border = { top: side, left: side, bottom: side, right: side };
  }
  if (opt.numFmt) cell.numFmt = opt.numFmt;
  return cell;
}

function section(ws: ExcelJS.Worksheet, row: number, text: string, lastCol: number) {
  ws.getRow(row).height = 22;
  for (let c = 1; c <= lastCol; c += 1)
    put(ws, row, c, c === 1 ? text : null, { bold: true, size: 11, color: "FFFFFFFF", fill: SECTION_BG, border: false });
  ws.mergeCells(row, 1, row, lastCol);
}

function note(ws: ExcelJS.Worksheet, row: number, text: string, lastCol: number) {
  ws.getRow(row).height = 15;
  put(ws, row, 1, text, { size: 8.5, color: GRAY, border: false });
  ws.mergeCells(row, 1, row, lastCol);
}

const FMT_INT = "#,##0";
const FMT_AREA = "#,##0.0";
const FMT_PCT = '0.0"%"';

/** 두 줄 머리글 — 위 줄은 묶음 이름(병합), 아래 줄은 열 이름 */
function header2(
  ws: ExcelJS.Worksheet,
  row: number,
  groups: { title: string; cols: string[] }[],
): number {
  let c = 1;
  ws.getRow(row).height = 18;
  ws.getRow(row + 1).height = 18;
  for (const g of groups) {
    const c0 = c;
    for (const name of g.cols) {
      put(ws, row, c, c === c0 ? g.title : null, { bold: true, align: "center", fill: HEAD_BG });
      put(ws, row + 1, c, name, { bold: true, align: "center", fill: HEAD_BG, wrap: true });
      c += 1;
    }
    if (g.cols.length > 1) ws.mergeCells(row, c0, row, c - 1);
    else ws.mergeCells(row, c0, row + 1, c0);
  }
  return c - 1;
}

/** 비교 칸(실면적·로스율·합계) 값을 열 순서대로 */
function cmpValues(thks: number[], c: SiteReportCmp | null): { v: number | string | null; fmt: string }[] {
  if (!c)
    return [...thks.map(() => ({ v: "-", fmt: FMT_AREA })), ...thks.map(() => ({ v: "-", fmt: FMT_PCT })), { v: "-", fmt: FMT_AREA }, { v: "-", fmt: FMT_AREA }, { v: "-", fmt: FMT_AREA }, { v: "-", fmt: FMT_PCT }];
  return [
    ...c.net.map((v) => ({ v, fmt: FMT_AREA })),
    ...c.loss.map((v) => ({ v: v ?? "-", fmt: FMT_PCT })),
    { v: c.netSum, fmt: FMT_AREA },
    { v: c.grossSum, fmt: FMT_AREA },
    { v: c.diff, fmt: FMT_AREA },
    { v: c.lossAll ?? "-", fmt: FMT_PCT },
  ];
}

function cmpGroups(thks: number[]) {
  return [
    { title: "실면적(㎡)", cols: thks.map((t) => `${t}T`) },
    { title: "로스율(%)", cols: thks.map((t) => `${t}T`) },
    { title: "합계", cols: ["실면적 계", "산출면적 계", "차이", "로스율"] },
  ];
}

export interface SiteReportSheetOpts {
  siteName: string;
  /** 정척 규격(mm) — 머리말에 적는다 */
  boardLength: number;
  boardHeight: number;
  /** 오늘 날짜 (시험에서 고정) */
  now?: Date;
}

/** 발주의뢰서 맨 뒤에 「현장산출검토」 한 장을 그린다 */
export function addSiteReportSheet(wb: ExcelJS.Workbook, r: SiteReport, opts: SiteReportSheetOpts): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("현장산출검토", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  const { thks } = r;
  const now = opts.now ?? new Date();
  const dateLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const cmpCount = thks.length * 2 + 4;
  const lastCol = Math.max(3 + thks.length * 2 + cmpCount, 7 + thks.length + cmpCount);

  // 머리말
  let row = 1;
  ws.getRow(row).height = 28;
  put(ws, row, 1, `[${opts.siteName}] 세대 단열재 현장산출 검토`, { bold: true, size: 15, border: false });
  ws.mergeCells(row, 1, row, lastCol);
  row += 1;
  note(
    ws,
    row,
    `단열 Layout 산출 · 정척 ${opts.boardLength}×${opts.boardHeight}mm · 세대수 ${r.total.units.toLocaleString("ko-KR")} · 작성 ${dateLabel}`,
    lastCol,
  );
  row += 1;
  note(ws, row, "발주수량 검토의 세대 단열재(09.내장목공사) 수량은 아래 ② 동별 집계표의 두께별 산출면적을 노출타입·겹별로 나눈 값이다.", lastCol);
  row += 1;
  // 용어 설명은 머리말에 — 표 아래에 두면 마지막 두 줄만 다음 장으로 넘어간다
  note(ws, row, SITE_REPORT_NOTE_NET, lastCol);
  row += 1;
  note(ws, row, SITE_REPORT_NOTE_GROSS, lastCol);
  row += 1;
  if (r.missing.length > 0) {
    note(ws, row, `※ 대표 입면이 없는 타입: ${r.missing.join(", ")} — 물량 0/대시. 입면에서 해당 타입을 지정한 뒤 다시 산출한다.`, lastCol);
    row += 1;
  }
  row += 1;

  // 결론 — 두께별 합계
  section(ws, row, "검토 결론 — 두께별 현장산출 합계", lastCol);
  row += 1;
  header2(ws, row, [
    { title: "두께", cols: ["규격"] },
    { title: "산출면적(㎡)", cols: ["주문 판수 기준"] },
    { title: "실면적(㎡)", cols: ["전개면 − 오프닝"] },
    { title: "차이(㎡)", cols: ["산출 − 실면적"] },
    { title: "로스율(%)", cols: ["차이 ÷ 실면적"] },
  ]);
  row += 2;
  thks.forEach((t, i) => {
    const gross = r.total.area[i];
    const net = r.total.cmp.net[i];
    put(ws, row, 1, `${t}T`, { bold: true, align: "center" });
    put(ws, row, 2, gross, { align: "right", numFmt: FMT_AREA });
    put(ws, row, 3, net, { align: "right", numFmt: FMT_AREA });
    put(ws, row, 4, gross - net, { align: "right", numFmt: FMT_AREA });
    put(ws, row, 5, r.total.cmp.loss[i] ?? "-", { align: "right", numFmt: FMT_PCT });
    row += 1;
  });
  put(ws, row, 1, "합계", { bold: true, align: "center", fill: TOTAL_BG });
  put(ws, row, 2, r.total.cmp.grossSum, { bold: true, align: "right", numFmt: FMT_AREA, fill: TOTAL_BG });
  put(ws, row, 3, r.total.cmp.netSum, { bold: true, align: "right", numFmt: FMT_AREA, fill: TOTAL_BG });
  put(ws, row, 4, r.total.cmp.diff, { bold: true, align: "right", numFmt: FMT_AREA, fill: TOTAL_BG });
  put(ws, row, 5, r.total.cmp.lossAll ?? "-", { bold: true, align: "right", numFmt: FMT_PCT, fill: TOTAL_BG });
  row += 2;

  // ① 단위세대 타입별
  section(ws, row, "① 단위세대 타입별 단열재 수량 — 대표 입면 1세대 기준", lastCol);
  row += 1;
  header2(ws, row, [
    { title: "단위세대", cols: ["타입"] },
    { title: "층", cols: ["그룹"] },
    { title: "층고", cols: ["mm"] },
    { title: "주문 판수(EA)", cols: thks.map((t) => `${t}T`) },
    { title: "산출면적(㎡)", cols: thks.map((t) => `${t}T`) },
    ...cmpGroups(thks),
  ]);
  row += 2;
  let zebra = false;
  let prevType = "";
  for (const t of r.typeRows) {
    if (t.type !== prevType) {
      zebra = !zebra;
      prevType = t.type;
    }
    const fill = zebra ? SUB_BG : undefined;
    let c = 1;
    put(ws, row, c++, t.type, { bold: true, fill });
    put(ws, row, c++, t.group ?? "-", { align: "center", fill });
    put(ws, row, c++, t.floorHeight == null ? "-" : Math.round(t.floorHeight), { align: "right", numFmt: FMT_INT, fill });
    for (let i = 0; i < thks.length; i += 1) put(ws, row, c++, t.ea ? t.ea[i] : "-", { align: "right", numFmt: FMT_INT, fill });
    for (let i = 0; i < thks.length; i += 1) put(ws, row, c++, t.area ? t.area[i] : "-", { align: "right", numFmt: FMT_AREA, fill });
    for (const x of cmpValues(thks, t.cmp)) put(ws, row, c++, x.v, { align: "right", numFmt: x.fmt, fill });
    row += 1;
  }
  row += 1;

  // ② 동별 집계표
  section(ws, row, "② 동별 단열재 집계표 — 층 그룹별 1세대 물량 × 세대수", lastCol);
  row += 1;
  header2(ws, row, [
    { title: "동", cols: ["동"] },
    { title: "단위세대", cols: ["타입"] },
    { title: "세대수", cols: ["1~3F", "지붕층", "기준층", "계"] },
    { title: "층고(mm)", cols: ["1~3F/지붕/기준"] },
    { title: "산출면적(㎡)", cols: thks.map((t) => `${t}T`) },
    ...cmpGroups(thks),
  ]);
  row += 2;
  zebra = false;
  let prevB = "";
  for (const b of r.buildingRows) {
    if (b.building !== prevB) {
      zebra = !zebra;
      prevB = b.building;
    }
    const fill = zebra ? SUB_BG : undefined;
    let c = 1;
    put(ws, row, c++, b.building, { bold: true, fill });
    put(ws, row, c++, b.type, { fill });
    for (const n of [b.low, b.roof, b.base, b.total]) put(ws, row, c++, n, { align: "right", numFmt: FMT_INT, fill });
    put(ws, row, c++, (b.floorHeights ?? [null, null, null]).map((v) => (v == null ? "-" : Math.round(v))).join("/"), { align: "center", fill });
    for (let i = 0; i < thks.length; i += 1) put(ws, row, c++, b.area ? b.area[i] : "-", { align: "right", numFmt: FMT_AREA, fill });
    for (const x of cmpValues(thks, b.cmp)) put(ws, row, c++, x.v, { align: "right", numFmt: x.fmt, fill });
    row += 1;
  }
  {
    let c = 1;
    put(ws, row, c++, "합계", { bold: true, fill: TOTAL_BG });
    put(ws, row, c++, null, { fill: TOTAL_BG });
    for (let i = 0; i < 3; i += 1) put(ws, row, c++, null, { fill: TOTAL_BG });
    put(ws, row, c++, r.total.units, { bold: true, align: "right", numFmt: FMT_INT, fill: TOTAL_BG });
    put(ws, row, c++, null, { fill: TOTAL_BG });
    for (let i = 0; i < thks.length; i += 1) put(ws, row, c++, r.total.area[i], { bold: true, align: "right", numFmt: FMT_AREA, fill: TOTAL_BG });
    for (const x of cmpValues(thks, r.total.cmp)) put(ws, row, c++, x.v, { bold: true, align: "right", numFmt: x.fmt, fill: TOTAL_BG });
    row += 1;
  }

  // 열 너비 — 앞 두 열은 이름, 7열은 ② 의 층고(1~3F/지붕/기준) 라벨, 나머지는 숫자
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 12;
  for (let c = 3; c <= lastCol; c += 1) ws.getColumn(c).width = 10;
  ws.getColumn(7).width = 17;
  // 마지막 내용 줄까지만 — 빈 줄 하나가 더 들어가면 그 줄만 다음 장으로 넘어가 빈 쪽이 생긴다
  ws.pageSetup.printArea = `A1:${colLetter(lastCol)}${row - 1}`;
  ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  return ws;
}

function colLetter(c: number): string {
  let s = "";
  let n = c;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
