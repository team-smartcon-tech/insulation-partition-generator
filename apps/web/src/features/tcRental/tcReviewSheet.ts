/**
 * 현장산출검토 — 발주의뢰서 맨 뒤에 붙는 **설득용 한 장**.
 *
 * 앞의 탭들은 "얼마를 발주한다"를 적는 자리다. 이 탭은 그 숫자가 왜 그렇게 나왔는지,
 * 특히 **실행기준보다 왜 긴지**를 본사가 검산할 수 있게 펼쳐 놓는다.
 *
 * 그래서 결론을 맨 위에 놓고, 그 아래에 근거를 순서대로 쌓는다.
 *   1. 검토 결론 — 몇 대·몇 개월·실행기준 대비 얼마
 *   2. 동별 골조 공정 — 기간이 어디서 나오는지
 *   3. 호기별 임대 구간 — 반입~반출을 달력 위에
 *   4. 월별 동시 투입 — 겹치는 구간(현장 관리 부하)
 *   5. 실행기준 대비 검토 — 호기별 차이와 산출근거
 *   6. 임대일수 분해 — 차이의 출처를 일 단위로
 *
 * 엑셀에는 차트를 넣을 수 없어(ExcelJS 미지원) 막대는 **셀 자체를 칠해서** 그린다.
 * 인쇄하면 화면의 간트와 같은 모양이 나오고, 셀이라 본사에서 그 위에 메모를 달 수 있다.
 */
import type ExcelJS from "exceljs";
import type { BuildingFrameProfile, RentalParams, RentalSpan, TcRentalPlan } from "./types";
import { diffDays, maxYmd, minYmd, shortYmd } from "./engine/dates";
import { frameFinish, frameStart, frameTotalDays } from "./engine/profile";
import { buildCompareRows } from "./components/BudgetCompare";
import { monthlyLoad } from "./engine/rental";
import { unitColor } from "./theme";

/** 월 칸이 시작하는 열 (H) */
const MONTH_COL = 8;
/** 표 왼쪽 고정 칸 수 (A~G) */
const HEAD_COLS = 7;

const NAVY = "FF0F2A4A";
const BLUE = "FF0A63B8";
const GRAY = "FF5C6E82";
const LINE = "FFD7DEE7";
const HEAD_BG = "FFEFF5FD";
const ZEBRA = "FFF7FAFD";

/** "#0a63b8" → "FF0A63B8" */
function argb(hex: string): string {
  const h = hex.replace("#", "").toUpperCase();
  return `FF${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

interface CellOpt {
  bold?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  border?: boolean;
  indent?: number;
}

function put(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opt: CellOpt = {},
) {
  const cell = ws.getRow(row).getCell(col);
  cell.value = value;
  cell.font = {
    name: "맑은 고딕",
    size: opt.size ?? 9,
    bold: opt.bold ?? false,
    color: { argb: opt.color ?? NAVY },
  };
  cell.alignment = {
    horizontal: opt.align ?? "left",
    vertical: "middle",
    wrapText: opt.wrap ?? false,
    indent: opt.indent ?? 0,
  };
  if (opt.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
  }
  if (opt.border !== false) {
    const side = { style: "thin" as const, color: { argb: LINE } };
    cell.border = { top: side, left: side, bottom: side, right: side };
  }
  return cell;
}

/** 표 제목 줄 — "■ 2. 동별 골조 공정" */
function section(ws: ExcelJS.Worksheet, row: number, text: string, lastCol: number) {
  ws.getRow(row).height = 22;
  for (let c = 1; c <= lastCol; c += 1) {
    put(ws, row, c, c === 1 ? text : null, {
      bold: true,
      size: 11,
      color: "FFFFFFFF",
      fill: argb("#12365c"),
      border: false,
      indent: c === 1 ? 1 : 0,
    });
  }
  ws.mergeCells(row, 1, row, lastCol);
}

/** 여러 칸을 묶어 문단 하나를 적는다 */
function paragraph(
  ws: ExcelJS.Worksheet,
  row: number,
  lastCol: number,
  text: string,
  height = 16,
) {
  ws.getRow(row).height = height;
  put(ws, row, 1, text, { size: 9.5, color: GRAY, wrap: true, border: false, indent: 1 });
  ws.mergeCells(row, 1, row, lastCol);
}

/** 달력 축 — from~to 사이의 달 목록 */
function monthAxis(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  for (let guard = 0; guard < 600; guard += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** 달력 머리글(연도 밴드 + 월) 두 줄 */
function monthHeader(ws: ExcelJS.Worksheet, row: number, months: string[]) {
  let i = 0;
  while (i < months.length) {
    const year = months[i].slice(0, 4);
    let j = i;
    while (j + 1 < months.length && months[j + 1].slice(0, 4) === year) j += 1;
    put(ws, row, MONTH_COL + i, `${year}년`, {
      bold: true,
      size: 9,
      align: "center",
      fill: HEAD_BG,
    });
    for (let k = i + 1; k <= j; k += 1) {
      put(ws, row, MONTH_COL + k, null, { fill: HEAD_BG });
    }
    if (j > i) ws.mergeCells(row, MONTH_COL + i, row, MONTH_COL + j);
    i = j + 1;
  }
  months.forEach((ym, k) => {
    put(ws, row + 1, MONTH_COL + k, Number(ym.slice(5, 7)), {
      size: 8.5,
      align: "center",
      color: GRAY,
      fill: HEAD_BG,
    });
  });
}

/** 한 줄에 막대를 칠한다 — 구간이 걸치는 달을 색으로 */
function bar(
  ws: ExcelJS.Worksheet,
  row: number,
  months: string[],
  from: string,
  to: string,
  fill: string,
  label?: string,
) {
  if (!from || !to) return;
  const first = months.findIndex((ym) => ym >= from.slice(0, 7));
  let last = -1;
  months.forEach((ym, i) => {
    if (ym <= to.slice(0, 7)) last = i;
  });
  if (first < 0 || last < first) return;
  for (let i = first; i <= last; i += 1) {
    put(ws, row, MONTH_COL + i, null, { fill, border: false });
  }
  if (label && last - first >= 3) {
    put(ws, row, MONTH_COL + first, label, {
      size: 8,
      bold: true,
      color: "FFFFFFFF",
      fill,
      align: "center",
      border: false,
    });
    ws.mergeCells(row, MONTH_COL + first, row, MONTH_COL + last);
  }
}

/** 표 머리글 한 줄 */
function tableHead(ws: ExcelJS.Worksheet, row: number, labels: string[], months: string[]) {
  labels.forEach((t, i) => {
    put(ws, row, i + 1, t, { bold: true, size: 9, align: "center", fill: HEAD_BG });
  });
  // 연도 밴드는 머리글 바로 위 줄, 월 숫자는 머리글과 같은 줄에 온다
  monthHeader(ws, row - 1, months);
}

const fmt = (ymd: string | null) => (ymd ? shortYmd(ymd) : "—");

/** 동 한 채의 규모 표기 — "B2·25F·옥1" */
function scale(b: BuildingFrameProfile): string {
  return [b.belowFloors > 0 ? `B${b.belowFloors}` : null, `${b.aboveFloors}F`, b.phFloors > 0 ? `옥${b.phFloors}` : null]
    .filter(Boolean)
    .join("·");
}

export interface ReviewInput {
  plan: TcRentalPlan;
  /** 타워·호이스트 전부 — 검토 자료는 현장 전체를 본다 */
  spans: RentalSpan[];
  params: RentalParams;
}

export function addReviewSheet(wb: ExcelJS.Workbook, { plan, spans, params }: ReviewInput) {
  const valid = spans.filter((s) => !s.problem && s.mobilizeStart && s.demobEnd);
  if (valid.length === 0) return;

  const byId = new Map(plan.buildings.map((b) => [b.id, b]));
  const tc = valid.filter((s) => s.kind === "tc").sort((a, b) => a.no - b.no);
  const hc = valid.filter((s) => s.kind === "hc").sort((a, b) => a.no - b.no);

  const from =
    minYmd([...plan.buildings.map(frameStart), ...valid.map((s) => s.mobilizeStart)]) ??
    valid[0].mobilizeStart;
  const to = maxYmd([...plan.buildings.map(frameFinish), ...valid.map((s) => s.demobEnd)]) ?? from;
  const months = monthAxis(from, to);
  const lastCol = MONTH_COL + months.length - 1;

  const ws = wb.addWorksheet("현장산출검토");
  ws.properties.defaultRowHeight = 15;
  ws.pageSetup = {
    paperSize: 8 as ExcelJS.PaperSize, // A3
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  ws.getColumn(1).width = 11;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 10;
  for (let i = 0; i < months.length; i += 1) ws.getColumn(MONTH_COL + i).width = 3.4;

  let r = 1;

  // ── 표제 ──────────────────────────────────────────────
  ws.getRow(r).height = 30;
  put(ws, r, 1, `[${plan.siteName}] 타워크레인·건설용리프트 임대기간 현장산출 검토`, {
    bold: true,
    size: 16,
    align: "center",
    border: false,
  });
  ws.mergeCells(r, 1, r, lastCol);
  r += 1;
  paragraph(
    ws,
    r,
    lastCol,
    `산출 근거: ${plan.sourceLabel} · 동별 골조 공정 실측 구간 기준` +
      `  |  T/C 설치 ${params.tc.installDays}일 · 여유 ${params.tc.leadDays}일 · 골조완료 +${params.tc.postFrameMonths}개월 · 해체 ${params.tc.dismantleDays}일` +
      `  |  H/C 설치 ${params.hc.installDays}일 · 골조완료 +${params.hc.postFrameMonths}개월 · 해체 ${params.hc.dismantleDays}일`,
    28,
  );
  r += 2;

  // ── 1. 검토 결론 ──────────────────────────────────────
  const compare = buildCompareRows(valid, plan.buildings, params);
  const sumSite = compare.reduce((a, x) => a + x.site, 0);
  const sumBudget = compare.reduce((a, x) => a + x.budget, 0);
  const totalMonths = valid.reduce((a, s) => a + s.rentalMonths, 0);
  const load = monthlyLoad(valid);
  const peak = load.reduce((a, x) => Math.max(a, x.tc + x.hc), 0);
  const idleDays = valid.reduce((a, s) => a + s.idleGaps.reduce((b, g) => b + g.days, 0), 0);

  section(ws, r, "■ 1. 검토 결론", lastCol);
  r += 1;

  const cards: Array<[string, string, string]> = [
    ["투입 장비", `${valid.length}대`, `타워크레인 ${tc.length} · 건설용리프트 ${hc.length}`],
    ["총 임대", `${totalMonths}개월`, "장비별 임대개월 합계"],
    ["최대 동시 투입", `${peak}대`, "현장 관리 부하의 정점"],
    ["유휴", `${idleDays}일`, idleDays === 0 ? "담당 동 사이 공백 없음" : "담당 동 사이 공백"],
    [
      "실행기준 대비",
      `${sumSite - sumBudget >= 0 ? "+" : ""}${sumSite - sumBudget}개월`,
      `현장 ${sumSite} / 기준 ${sumBudget}`,
    ],
  ];
  ws.getRow(r).height = 20;
  ws.getRow(r + 1).height = 24;
  ws.getRow(r + 2).height = 16;
  cards.forEach(([title, value, note], i) => {
    const c1 = 1 + i * 3;
    if (c1 + 2 > lastCol) return;
    put(ws, r, c1, title, { bold: true, size: 9, color: GRAY, fill: HEAD_BG, align: "center" });
    put(ws, r + 1, c1, value, { bold: true, size: 15, color: BLUE, align: "center" });
    put(ws, r + 2, c1, note, { size: 8.5, color: GRAY, align: "center" });
    for (const [rr, cc] of [
      [r, c1 + 1],
      [r, c1 + 2],
      [r + 1, c1 + 1],
      [r + 1, c1 + 2],
      [r + 2, c1 + 1],
      [r + 2, c1 + 2],
    ]) {
      put(ws, rr, cc, null, { fill: rr === r ? HEAD_BG : undefined });
    }
    ws.mergeCells(r, c1, r, c1 + 2);
    ws.mergeCells(r + 1, c1, r + 1, c1 + 2);
    ws.mergeCells(r + 2, c1, r + 2, c1 + 2);
  });
  r += 3;

  const gap = sumSite - sumBudget;
  paragraph(
    ws,
    r,
    lastCol,
    gap > 0
      ? `▶ 현장산출이 실행기준보다 ${gap}개월 깁니다. 실행기준은 호기가 맡은 동 중 ` +
          `가장 긴 동 하나의 골조공기만 개월로 환산하는 반면, 현장산출은 ` +
          `반입·설치부터 담당 동을 모두 이어 붙인 뒤 해체·반출까지의 실제 달력 구간입니다. ` +
          `아래 6항에 그 차이를 일 단위로 분해했습니다.`
      : `▶ 현장산출이 실행기준 범위 안에 있습니다(차이 ${gap}개월).`,
    30,
  );
  r += 1;
  paragraph(
    ws,
    r,
    lastCol,
    idleDays === 0
      ? `▶ 담당 동 사이 유휴가 0일입니다 — 늘어난 기간은 노는 기간이 아니라 실제 양중이 도는 기간입니다.`
      : `▶ 담당 동 사이 유휴가 ${idleDays}일입니다. 배정을 조정하면 이 구간만큼 줄일 수 있습니다.`,
    18,
  );
  r += 2;

  // ── 2. 동별 골조 공정 ─────────────────────────────────
  section(ws, r, "■ 2. 동별 골조 공정 (공정표 실측)", lastCol);
  r += 2; // 연도 밴드 한 줄을 머리글 위에 둔다
  tableHead(ws, r, ["동", "규모", "골조 착수", "골조 완료", "소요일수", "타워", "리프트"], months);
  r += 1;

  const unitOf = (bid: string, kind: "tc" | "hc") =>
    valid
      .filter((s) => s.kind === kind && s.buildingIds.includes(bid))
      .map((s) => `${s.no}호기`)
      .join(",") || "—";

  for (const b of plan.buildings) {
    const s = frameStart(b);
    const f = frameFinish(b);
    const zebra = (r % 2 === 0 ? ZEBRA : undefined) as string | undefined;
    put(ws, r, 1, b.name, { bold: true, size: 9, align: "center", fill: zebra });
    put(ws, r, 2, scale(b), { size: 9, align: "center", color: GRAY, fill: zebra });
    put(ws, r, 3, fmt(s), { size: 9, align: "center", fill: zebra });
    put(ws, r, 4, fmt(f), { size: 9, align: "center", fill: zebra });
    put(ws, r, 5, frameTotalDays(b) > 0 ? `${frameTotalDays(b)}일` : "—", {
      size: 9,
      align: "center",
      bold: true,
      fill: zebra,
    });
    put(ws, r, 6, unitOf(b.id, "tc"), { size: 9, align: "center", color: BLUE, fill: zebra });
    put(ws, r, 7, unitOf(b.id, "hc"), { size: 9, align: "center", color: GRAY, fill: zebra });
    for (let i = 0; i < months.length; i += 1) put(ws, r, MONTH_COL + i, null, { fill: zebra });
    if (s && f) bar(ws, r, months, s, f, argb("#9cc4ea"), `${b.name} 골조 ${frameTotalDays(b)}일`);
    r += 1;
  }
  r += 1;

  // ── 3. 호기별 임대 구간 ───────────────────────────────
  section(ws, r, "■ 3. 호기별 임대 구간 (반입 ~ 반출)", lastCol);
  r += 2;
  tableHead(ws, r, ["호기", "담당 동", "반입", "반출", "임대", "가동률", "유휴"], months);
  r += 1;

  for (const [title, list] of [
    ["타워크레인", tc],
    ["건설용리프트", hc],
  ] as Array<[string, RentalSpan[]]>) {
    if (list.length === 0) continue;
    put(ws, r, 1, title, { bold: true, size: 9, color: GRAY, fill: HEAD_BG });
    for (let c = 2; c <= lastCol; c += 1) put(ws, r, c, null, { fill: HEAD_BG });
    ws.mergeCells(r, 1, r, HEAD_COLS);
    r += 1;
    for (const s of list) {
      const color = argb(unitColor(s.no, s.kind));
      const idle = s.idleGaps.reduce((a, g) => a + g.days, 0);
      const active = s.rentalDays > 0 ? Math.round(((s.rentalDays - idle) / s.rentalDays) * 100) : 0;
      put(ws, r, 1, `${s.kind === "tc" ? "T/C" : "H/C"} ${s.no}`, {
        bold: true,
        size: 9,
        align: "center",
        color: "FFFFFFFF",
        fill: color,
      });
      put(ws, r, 2, s.buildingNames.join(", "), { size: 9, align: "center" });
      put(ws, r, 3, fmt(s.mobilizeStart), { size: 9, align: "center" });
      put(ws, r, 4, fmt(s.demobEnd), { size: 9, align: "center" });
      put(ws, r, 5, `${s.rentalMonths}개월`, { size: 9, align: "center", bold: true });
      put(ws, r, 6, `${active}%`, { size: 9, align: "center", color: GRAY });
      put(ws, r, 7, idle > 0 ? `${idle}일` : "—", {
        size: 9,
        align: "center",
        color: idle > 0 ? argb("#b3322c") : GRAY,
      });
      for (let i = 0; i < months.length; i += 1) put(ws, r, MONTH_COL + i, null, {});
      // 반입·설치 / 해체·반출은 옅게, 가동은 진하게
      bar(ws, r, months, s.mobilizeStart, s.activeStart, argb("#dbe6f2"));
      bar(ws, r, months, s.activeEnd, s.demobEnd, argb("#dbe6f2"));
      bar(
        ws,
        r,
        months,
        s.activeStart,
        s.activeEnd,
        color,
        `${fmt(s.mobilizeStart)} ~ ${fmt(s.demobEnd)} · ${s.rentalMonths}개월`,
      );
      r += 1;
    }
  }
  r += 1;

  // ── 4. 월별 동시 투입 ─────────────────────────────────
  section(ws, r, "■ 4. 월별 동시 투입 대수 (현장 관리 부하)", lastCol);
  r += 2;
  tableHead(ws, r, ["구분", "", "", "", "", "최대", "평균"], months);
  r += 1;

  const byYm = new Map(load.map((x) => [x.ym, x]));
  const rows: Array<[string, (x: { tc: number; hc: number }) => number, string]> = [
    ["타워크레인", (x) => x.tc, argb("#0a63b8")],
    ["건설용리프트", (x) => x.hc, argb("#d97a2b")],
    ["계", (x) => x.tc + x.hc, argb("#12365c")],
  ];
  for (const [label, pick, color] of rows) {
    const values = months.map((ym) => {
      const x = byYm.get(ym);
      return x ? pick(x) : 0;
    });
    const max = values.reduce((a, v) => Math.max(a, v), 0);
    const avg = values.length > 0 ? values.reduce((a, v) => a + v, 0) / values.length : 0;
    const bold = label === "계";
    put(ws, r, 1, label, { bold, size: 9, align: "center", fill: bold ? HEAD_BG : undefined });
    for (let c = 2; c <= 5; c += 1) put(ws, r, c, null, { fill: bold ? HEAD_BG : undefined });
    ws.mergeCells(r, 1, r, 5);
    put(ws, r, 6, `${max}대`, { bold, size: 9, align: "center", fill: bold ? HEAD_BG : undefined });
    put(ws, r, 7, `${Math.round(avg * 10) / 10}대`, {
      size: 9,
      align: "center",
      color: GRAY,
      fill: bold ? HEAD_BG : undefined,
    });
    values.forEach((v, i) => {
      // 값이 클수록 진하게 — 셀 자체가 막대 구실을 한다
      const ratio = max > 0 ? v / max : 0;
      const shade =
        v === 0 ? undefined : ratio > 0.8 ? color : ratio > 0.5 ? argb("#9cc4ea") : argb("#dbe6f2");
      put(ws, r, MONTH_COL + i, v || null, {
        size: 8.5,
        align: "center",
        bold,
        color: ratio > 0.8 && v > 0 ? "FFFFFFFF" : NAVY,
        fill: shade,
      });
    });
    r += 1;
  }
  r += 1;

  // ── 5. 실행기준 대비 검토 ─────────────────────────────
  section(ws, r, "■ 5. 실행기준 대비 검토", lastCol);
  r += 1;
  put(ws, r, 1, "호기", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 2, "현장산출", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 3, "실행기준", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 4, "차이", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 5, "산출근거", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  for (let c = 6; c <= lastCol; c += 1) put(ws, r, c, null, { fill: HEAD_BG });
  ws.mergeCells(r, 5, r, lastCol);
  r += 1;

  for (const row of compare) {
    const diff = row.site - row.budget;
    put(ws, r, 1, row.label, {
      bold: true,
      size: 9,
      align: "center",
      color: "FFFFFFFF",
      fill: argb(unitColor(row.unitNo, row.kind)),
    });
    put(ws, r, 2, `${row.site}개월`, { bold: true, size: 9, align: "center" });
    put(ws, r, 3, `${row.budget}개월`, { size: 9, align: "center", color: GRAY });
    put(ws, r, 4, `${diff > 0 ? "+" : ""}${diff}`, {
      bold: true,
      size: 9,
      align: "center",
      color: diff > 0 ? argb("#b3322c") : diff < 0 ? argb("#0f7a53") : GRAY,
      fill: diff > 0 ? argb("#fdeaea") : diff < 0 ? argb("#e8f7f0") : undefined,
    });
    put(ws, r, 5, row.basis, { size: 8.5, color: GRAY, indent: 1 });
    for (let c = 6; c <= lastCol; c += 1) put(ws, r, c, null, {});
    ws.mergeCells(r, 5, r, lastCol);
    r += 1;
  }
  put(ws, r, 1, "합계", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 2, `${sumSite}개월`, { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 3, `${sumBudget}개월`, { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 4, `${gap > 0 ? "+" : ""}${gap}`, {
    bold: true,
    size: 9,
    align: "center",
    fill: HEAD_BG,
    color: gap > 0 ? argb("#b3322c") : GRAY,
  });
  put(ws, r, 5, "실행기준은 담당 동 중 가장 긴 동 하나만, 현장산출은 담당 동 전체를 이어 붙인 실제 구간", {
    size: 8.5,
    color: GRAY,
    fill: HEAD_BG,
    indent: 1,
  });
  for (let c = 6; c <= lastCol; c += 1) put(ws, r, c, null, { fill: HEAD_BG });
  ws.mergeCells(r, 5, r, lastCol);
  r += 2;

  // ── 6. 임대일수 분해 ──────────────────────────────────
  section(ws, r, "■ 6. 임대일수 분해 — 차이가 어디서 생기는가", lastCol);
  r += 1;
  const heads = [
    "호기",
    "담당 동",
    "반입·설치",
    "골조 구간",
    "골조완료 후",
    "해체·반출",
    "합계",
  ];
  heads.forEach((t, i) => put(ws, r, i + 1, t, { bold: true, size: 9, align: "center", fill: HEAD_BG }));
  put(ws, r, 8, "현장산출", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 9, "실행기준", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 10, "차이", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  put(ws, r, 11, "비고", { bold: true, size: 9, align: "center", fill: HEAD_BG });
  for (let c = 12; c <= lastCol; c += 1) put(ws, r, c, null, { fill: HEAD_BG });
  if (lastCol > 11) ws.mergeCells(r, 11, r, lastCol);
  r += 1;

  for (const s of [...tc, ...hc]) {
    const targets = s.buildingIds.map((id) => byId.get(id)).filter((b): b is BuildingFrameProfile => !!b);
    const lastFinish = maxYmd(targets.map(frameFinish));
    const install = diffDays(s.mobilizeStart, s.activeStart);
    const frame = lastFinish ? diffDays(s.activeStart, lastFinish) : 0;
    const post = lastFinish ? diffDays(lastFinish, s.activeEnd) : 0;
    const demob = diffDays(s.activeEnd, s.demobEnd);
    const cmp = compare.find((x) => x.kind === s.kind && x.unitNo === s.no);
    const diff = cmp ? cmp.site - cmp.budget : 0;

    put(ws, r, 1, `${s.kind === "tc" ? "T/C" : "H/C"} ${s.no}`, {
      bold: true,
      size: 9,
      align: "center",
      color: "FFFFFFFF",
      fill: argb(unitColor(s.no, s.kind)),
    });
    put(ws, r, 2, s.buildingNames.join(", "), { size: 9, align: "center" });
    put(ws, r, 3, `${install}일`, { size: 9, align: "center", color: GRAY });
    put(ws, r, 4, `${frame}일`, { size: 9, align: "center", bold: true });
    put(ws, r, 5, `${post}일`, { size: 9, align: "center", color: GRAY });
    put(ws, r, 6, `${demob}일`, { size: 9, align: "center", color: GRAY });
    put(ws, r, 7, `${s.rentalDays}일`, { size: 9, align: "center", bold: true });
    put(ws, r, 8, `${s.rentalMonths}개월`, { size: 9, align: "center", bold: true });
    put(ws, r, 9, cmp ? `${cmp.budget}개월` : "—", { size: 9, align: "center", color: GRAY });
    put(ws, r, 10, `${diff > 0 ? "+" : ""}${diff}`, {
      size: 9,
      align: "center",
      bold: true,
      color: diff > 0 ? argb("#b3322c") : GRAY,
    });
    put(
      ws,
      r,
      11,
      targets.length > 1
        ? `담당 ${targets.length}개 동을 이어받아 골조 구간이 ${frame}일로 늘어남 (기준은 최장 1개 동만 계상)`
        : "담당 1개 동",
      { size: 8.5, color: GRAY, indent: 1 },
    );
    for (let c = 12; c <= lastCol; c += 1) put(ws, r, c, null, {});
    if (lastCol > 11) ws.mergeCells(r, 11, r, lastCol);
    r += 1;
  }
  r += 1;

  // ── 맺음 ──────────────────────────────────────────────
  const multi = [...tc, ...hc].filter((s) => s.buildingIds.length > 1).length;
  paragraph(
    ws,
    r,
    lastCol,
    `※ 반입·설치(T/C ${params.tc.installDays}일 · H/C ${params.hc.installDays}일)와 해체·반출` +
      `(T/C ${params.tc.dismantleDays}일 · H/C ${params.hc.dismantleDays}일)은 ` +
      `실행기준의 개월 환산에 들어가지 않는 구간입니다. ` +
      (multi > 0
        ? `또한 ${multi}개 호기가 2개 동 이상을 이어받고 있어, 기준이 계상하는 "최장 1개 동"보다 실제 가동 구간이 깁니다.`
        : ""),
    30,
  );
  r += 1;
  paragraph(
    ws,
    r,
    lastCol,
    `※ 기간을 줄이려면 ① 호기당 담당 동을 줄이거나(대수 증가) ② 동별 골조 착수 간격을 좁히는 두 가지뿐이며, ` +
      `①은 임대 대수가, ②는 골조 투입이 늘어납니다. 위 4항의 월별 동시 투입이 그 판단 자료입니다.`,
    30,
  );
}
