/**
 * 동절기 열원검토 — 엑셀 보고서.
 *
 * 현장에서 쓰던 「단위세대 동절기 열원검토」 엑셀과 같은 구성·모양으로 낸다.
 *   동절기 열원            : 한 장 요약 (열원별 비교 · 현장 의견)
 *   첨부2. 산출서및금액비교 : 열원별 대수·연료비·임대료·인건비
 *   첨부3-n. 열원검토(구역) : 구역마다 한 장. 정밀식은 원본 검토서 양식, 간이식은 주차장 산정툴 양식
 *   첨부4. 배치도           : 도면 위 구역과 적용 열원 배치
 *
 * 셀에는 **수식**을 넣는다(원본처럼 엑셀에서 값을 고치면 다시 계산된다). 수식의 결과값은 화면과 같은
 * 엔진(engine/calc.ts)에서 미리 넣어 두므로, 다시 계산하지 않는 뷰어에서도 화면과 같은 숫자가 보인다.
 * exceljs 는 버튼을 누를 때 불러온다(첫 화면 번들에 넣지 않는다).
 */
import type ExcelJS from "exceljs";
import { appliedHeater, uniformHeaterId, ZONE_KIND_LABEL, zoneColor, zoneSheet } from "./defaults";
import {
  edgeLossShare,
  heaterNeed,
  heaterOutput,
  summarize,
  zoneLoss,
  type HeaterCost,
  type ZoneLoss,
} from "./engine/calc";
import type { LiteDxf } from "./engine/dxfLite";
import {
  EDGE_BAND_M,
  EDGE_INSET_M,
  EDGE_SPACING_M,
  labelPoint,
  offsetPolygon,
  placeHeaters,
  placeHeatersEdge,
  polygonBounds,
} from "./engine/geometry";
import { loadDrawing } from "./store";
import type { Heater, HeatProject, Zone, ZoneKind } from "./types";

// ── 양식 색 (원본 엑셀) ──
const YELLOW = "FFFFFF00"; // 현장여건 입력
const GREEN = "FF92D050"; // 한중콘크리트 적용지침 참조 입력
const RED = "FFFF0000"; // 결과
const ORANGE = "FFFFC000"; // 소계 · 필요대수
const CREAM = "FFFFF2CC";
const HEAD = "FFD9D9D9";
const LABEL_GREEN = "FFA9D08E";
const SALMON = "FFF4B084";
const PURPLE = "FF7030A0";
const PALE_GREEN = "FFE2EFDA";
const PALE_BLUE = "FFD9E1F2";
const FONT = "맑은 고딕";

const N0 = "#,##0_ ;[Red]\\-#,##0\\ ";
const N1 = "#,##0.0_ ;[Red]\\-#,##0.0\\ ";
const N2 = "#,##0.00_ ;[Red]\\-#,##0.00\\ ";
const DIFF = "\\(\\+\\)#,##0;[Red]\\(\\-\\)#,##0";

type Val = string | number | null | { f: string; v: number | string };
interface Sty {
  bold?: boolean;
  size?: number;
  fill?: string;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  fmt?: string;
  wrap?: boolean;
  border?: "thin" | "none";
  underline?: boolean;
  indent?: number;
}

function colName(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function parseAddr(a: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(`셀 주소 오류: ${a}`);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [c, Number(m[2])];
}

/** 셀(또는 병합 범위)에 값과 서식을 넣는다. 테두리는 범위의 모든 칸에 건다 */
function put(ws: ExcelJS.Worksheet, range: string, value: Val, sty: Sty = {}): void {
  const [a, b] = range.split(":");
  const [c1, r1] = parseAddr(a);
  const [c2, r2] = b ? parseAddr(b) : [c1, r1];
  if (b) ws.mergeCells(range);
  const line = { style: "thin" as const, color: { argb: "FF000000" } };
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.font = {
        name: FONT,
        size: sty.size ?? 10,
        bold: sty.bold,
        underline: sty.underline,
        color: sty.color ? { argb: sty.color } : undefined,
      };
      cell.alignment = {
        horizontal: sty.align ?? "center",
        vertical: sty.valign ?? "middle",
        wrapText: sty.wrap ?? true,
        indent: sty.indent,
      };
      if (sty.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sty.fill } };
      if (sty.border !== "none") cell.border = { top: line, bottom: line, left: line, right: line };
      if (sty.fmt) cell.numFmt = sty.fmt;
    }
  }
  const first = ws.getCell(r1, c1);
  if (value !== null && typeof value === "object") first.value = { formula: value.f, result: value.v } as ExcelJS.CellValue;
  else first.value = value;
}

/** 범위 바깥 테두리를 굵게 (원본 표의 외곽선) */
function frame(ws: ExcelJS.Worksheet, range: string): void {
  const [a, b] = range.split(":");
  const [c1, r1] = parseAddr(a);
  const [c2, r2] = parseAddr(b);
  const thick = { style: "medium" as const, color: { argb: "FF000000" } };
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (r !== r1 && r !== r2 && c !== c1 && c !== c2) continue;
      const cell = ws.getCell(r, c);
      cell.border = {
        ...cell.border,
        ...(r === r1 ? { top: thick } : {}),
        ...(r === r2 ? { bottom: thick } : {}),
        ...(c === c1 ? { left: thick } : {}),
        ...(c === c2 ? { right: thick } : {}),
      };
    }
  }
}

const text = (ws: ExcelJS.Worksheet, addr: string, v: string, sty: Sty = {}) =>
  put(ws, addr, v, { align: "left", border: "none", wrap: false, ...sty });

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/?*[\]:']/g, " ").trim();
  let name = clean.slice(0, 31);
  for (let i = 2; used.has(name); i++) {
    const tail = ` (${i})`;
    name = clean.slice(0, 31 - tail.length) + tail;
  }
  used.add(name);
  return name;
}
/** 다른 시트 셀 참조 */
const ref = (sheet: string, addr: string) => `'${sheet.replace(/'/g, "''")}'!${addr}`;
/** 숫자 서식 — 정수면 소수점 없이, 아니면 소수 둘째 자리까지 */
const numFmt = (v?: number) => (v !== undefined && !Number.isInteger(v) ? "#,##0.0#" : "#,##0");
/** 단위가 붙는 숫자 서식 */
const unitFmt = (unit: string, v?: number) => `${numFmt(v)} "${unit.replace(/"/g, "")}"`;

function setupPage(ws: ExcelJS.Worksheet, printArea: string, landscape = false): void {
  ws.pageSetup = {
    paperSize: 9,
    orientation: landscape ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    printArea,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
}

/** 첨부3 시트가 첨부2 에 알려주는 셀 위치 */
interface ZoneRefs {
  sheet: string;
  /** heaterId → 필요대수 셀 */
  count: Record<string, string>;
}

function countFormula(loss: ZoneLoss, totalCell: string, outCell: string, min: number): string {
  const core =
    loss.countRule === "roundPlus1" ? `ROUND(${totalCell}/${outCell},0)+1` : `ROUNDUP(${totalCell}/${outCell},0)`;
  return min > 1 ? `MAX(${core},${min})` : core;
}

// ── 첨부3 (정밀식) — 원본 「동절기 열원 산출 검토서」 양식 ─────────────────────
function enclosureSheet(
  ws: ExcelJS.Worksheet,
  title: string,
  zone: Zone,
  loss: ZoneLoss,
  project: HeatProject,
): ZoneRefs {
  const c = project.conditions;
  const widths = [19.8, 18.1, 11.2, 9, 8.6, 11.5, 9.6, 9.6, 13, 14.9];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const item = (key: string) => loss.items.find((i) => i.key === key)?.value ?? 0;
  const shape = zone.kind === "parking" ? c.fShapeOpen : c.fShapeApt;
  const nIn = c.ventBaseInner * c.fSize * c.fJoint * shape * c.fOverlap;
  const nOut = c.ventBaseOuter * c.fSize * c.fJoint * shape * c.fOverlap;
  const upperVol = loss.area * c.upperHeight;
  const k = 1 + c.enclosureSafety / 100;

  text(ws, "A1", `${title}`, { bold: true, size: 16 });
  put(ws, "G1:J1", `[${zone.name} · 1구역 기준${zone.qty > 1 ? ` · 같은 구역 ${zone.qty}개` : ""}]`, {
    bold: true,
    size: 11,
    align: "right",
    border: "none",
  });
  ws.getRow(1).height = 24;
  put(ws, "B2", "※ 범례", { bold: true, align: "right", border: "none" });
  put(ws, "C2", null, { fill: YELLOW });
  text(ws, "D2", "현장여건 입력", { bold: true });
  put(ws, "F2", null, { fill: GREEN });
  text(ws, "G2", "한중콘크리트 적용지침 참조 입력", { bold: true });

  // 1. 기본조건
  text(ws, "A3", "1. 기본조건입력", { bold: true, size: 12 });
  put(ws, "A4:G4", "현장 입력", { bold: true, size: 11, fill: HEAD });
  put(ws, "H4:J4", "비 고", { bold: true, size: 11, fill: HEAD });
  put(ws, "A5:B5", "초기 외기 평균온도 (1시간) (a)");
  put(ws, "C5", c.outdoorTemp, { fmt: N1, fill: YELLOW, align: "right" });
  put(ws, "D5:F5", "내부-외기 온도차(A) = b-a", { bold: true, align: "left" });
  put(ws, "G5", { f: "C6-C5", v: loss.dA }, { fmt: N1, bold: true, align: "right" });
  put(ws, "A6:B6", "양생실 목표양생온도 (b)");
  put(ws, "C6", c.cureTemp, { fmt: N1, fill: YELLOW, align: "right" });
  put(ws, "D6:F6", "내부-상옥 온도차(B) = b-c", { bold: true, align: "left" });
  put(ws, "G6", { f: "C6-C7", v: loss.dB }, { fmt: N1, bold: true, align: "right" });
  put(ws, "A7:B7", "상옥 목표양생온도 (c)");
  put(ws, "C7", c.upperTemp, { fmt: N1, fill: YELLOW, align: "right" });
  put(ws, "D7:F7", "상옥-외기 온도차(C) = c-a", { bold: true, align: "left" });
  put(ws, "G7", { f: "C7-C5", v: loss.dC }, { fmt: N1, bold: true, align: "right" });
  put(
    ws,
    "H5:J13",
    `1. 현장 기준에 맞게 입력\n2. 상옥공간은 층고 +${c.upperHeight}M 기준\n   바닥면적은 양생실 면적과 동일\n3. 면적·둘레: ${zone.geometry.source === "cad" ? "도면에서 측정" : "직접 입력"}`,
    { align: "left" },
  );

  put(ws, "A8:A13", "양생실", { bold: true });
  put(ws, "D8:D13", "상옥\n공간", { bold: true });
  const rows8: [string, Val, string, string, Val, string?][] = [
    ["층고 (d)", loss.height, N2, "층고 (d')", c.upperHeight, YELLOW],
    ["바닥면적 (e)", loss.area, N1, "천장면적 (e')", { f: "C9", v: loss.area }],
    ["벽개구부면적 (f) ", loss.openingArea, N1, "벽개구부면적 (f') ", 0],
    ["벽면적 (g)", { f: "C12*C8-C10", v: loss.wallArea }, N1, "벽면적 (g')", { f: "G12*G8", v: loss.perimeter * c.upperHeight }],
    ["둘레 (h) ", loss.perimeter, N1, "둘레 (h') ", { f: "C12", v: loss.perimeter }],
    ["체적(d×e)", { f: "C8*C9", v: loss.volume }, N1, "체적(d'×e')", { f: "G9*G8", v: upperVol }],
  ];
  rows8.forEach(([l1, v1, f1, l2, v2, fill2], i) => {
    const r = 8 + i;
    const input = typeof v1 === "number";
    put(ws, `B${r}`, l1);
    put(ws, `C${r}`, v1, { fmt: f1, fill: input ? YELLOW : undefined, align: "right" });
    put(ws, `E${r}:F${r}`, l2);
    put(ws, `G${r}`, v2, { fmt: r === 8 ? N2 : N1, fill: fill2, align: "right" });
  });
  put(ws, "A14:A16", "열손실계수\n(kcal/m2h℃)");
  put(ws, "B14", "콘크리트 (i)");
  put(ws, "C14", c.uConcrete, { fmt: N2, fill: GREEN, align: "right" });
  put(ws, "B15", "버블시트(j)");
  put(ws, "C15", c.uOpening, { fmt: N2, fill: GREEN, align: "right" });
  put(ws, "B16", "천막지 (k)");
  put(ws, "C16", c.uTent, { fmt: N2, fill: GREEN, align: "right" });
  put(ws, "D14:G14", null);
  put(ws, "D15:E15", "같은 구역 수");
  put(ws, "F15", zone.qty, { fmt: N0, align: "right" });
  put(ws, "G15", "개", { align: "left" });
  put(ws, "D16:E16", "여유율");
  put(ws, "F16", c.enclosureSafety, { fmt: N1, fill: YELLOW, align: "right" });
  put(ws, "G16", "%", { align: "left" });
  put(ws, "H14:J16", "1. 한중콘크리트 적용지침 참조(첨부1)\n2. 현장여건에 맞게 수정 요망", { align: "left" });
  frame(ws, "A4:G16");
  frame(ws, "H4:J16");

  // 2. 전열손실
  text(ws, "A18", "2. 전열손실열량(kcal/hr)", { bold: true, size: 12 });
  put(ws, "A19", "구분", { bold: true, size: 11, fill: HEAD });
  put(ws, "B19", "부위", { bold: true, size: 11, fill: HEAD });
  put(ws, "C19", "값", { bold: true, size: 11, fill: HEAD });
  put(ws, "D19:E19", "산식", { bold: true, size: 11, fill: HEAD });
  put(ws, "F19", "합계", { bold: true, size: 11, fill: HEAD });
  put(ws, "G19:J19", "비고", { bold: true, size: 11, fill: HEAD });
  put(ws, "A20:A23", "콘크리트\n(양생실)", { bold: true });
  put(ws, "A24:A25", "양생 천막\n(양생실+상옥공간)", { bold: true });
  const cond: [number, string, string, number, string, boolean][] = [
    [20, "벽체", "C11*C14*G5", item("wall"), " g × i × A", false],
    [21, "바닥", "C9*C14*G5", item("floor"), "e × i × A", false],
    [22, "천장", "C9*C14*G6", item("ceiling"), "e × i × B", false],
    [23, "벽개구부(양생실)", "C10*C15*G5", item("open"), "f × j × A", false],
    [24, "벽체(상옥공간)", "G11*C16*G7", item("tentWall"), "g' × k × C", true],
    [25, "천장(상옥공간)", "G9*C16*G7", item("tentRoof"), "e' × k × C", true],
  ];
  for (const [r, part, f, v, expr, bold] of cond) {
    put(ws, `B${r}`, part);
    put(ws, `C${r}`, { f, v }, { fmt: N1, align: "right", bold });
    put(ws, `D${r}:E${r}`, expr);
  }
  put(ws, "F20:F22", { f: "SUM(C20:C22)", v: item("wall") + item("floor") + item("ceiling") }, { fmt: N1 });
  put(ws, "F23", { f: "C23", v: item("open") }, { fmt: N1 });
  put(ws, "F24:F25", { f: "C24+C25", v: item("tentWall") + item("tentRoof") }, { fmt: N1 });
  put(ws, "G20:J25", "1. 전열손실열량=면적*열손실계수*온도차\n2. 현장여건에 맞게 수정요망", { align: "left" });
  put(ws, "A26:B26", "[합 계]", { bold: true, size: 11, fill: HEAD });
  put(ws, "C26", { f: "SUM(C20:C25)", v: loss.conduction }, { fmt: N1, bold: true, fill: RED, align: "right" });
  put(ws, "D26:E26", null);
  put(ws, "F26", null);
  put(ws, "G26:J26", null);
  frame(ws, "A19:J26");

  // 3. 환기손실
  text(ws, "A28", "3. 환기손실열량(kcal/hr)", { bold: true, size: 12 });
  put(ws, "A29:B29", "구분", { bold: true, size: 11, fill: HEAD });
  put(ws, "C29:D29", "내부공간", { bold: true, size: 11, fill: HEAD });
  put(ws, "E29:F29", "상옥공간", { bold: true, size: 11, fill: HEAD });
  put(ws, "G29:J29", "비고", { bold: true, size: 11, fill: HEAD });
  put(ws, "A30:B30", "기준환기횟수 (가)");
  put(ws, "C30:D30", c.ventBaseInner, { fmt: N1, bold: true, fill: GREEN, align: "right" });
  put(ws, "E30:F30", c.ventBaseOuter, { fmt: N1, bold: true, fill: GREEN, align: "right" });
  put(ws, "G30:J30", "한중콘크리트 적용지침 참조(첨부1)", { bold: true, align: "left" });
  put(ws, "A31:A34", "보정계수\n(한중콘크리트\n적용지침 참조)");
  const factors: [number, string, number, string, boolean][] = [
    [31, "(나)", c.fSize, "양생포의 크기 계수", false],
    [32, "(다)", c.fJoint, "양생포의 이음상태 계수", false],
    [33, "(라)", shape, "평면형상 계수 (아파트 1.8, 오피스/주차장 1.2)", true],
    [34, "(마)", c.fOverlap, "겹침과 이음매 양부 계수", false],
  ];
  for (const [r, tag, v, note, key] of factors) {
    put(ws, `B${r}`, tag);
    put(ws, `C${r}:D${r}`, v, { fmt: N1, align: "right", bold: key, fill: key ? GREEN : undefined });
    put(ws, `E${r}:F${r}`, v, { fmt: N1, align: "right", bold: key, fill: key ? GREEN : undefined });
    put(ws, `G${r}:J${r}`, note, { align: "left", bold: key });
  }
  put(ws, "A35:B35", "환기횟수(F) (바)");
  put(ws, "C35:D35", { f: "C30*C31*C32*C33*C34", v: nIn }, { fmt: N1, align: "right" });
  put(ws, "E35:F35", { f: "E30*E31*E32*E33*E34", v: nOut }, { fmt: N1, align: "right" });
  put(ws, "G35:J35", "가×나×다×라×마", { align: "left" });
  put(ws, "A36:B36", "열손실(W/℃) (사)");
  put(ws, "C36:D36", { f: "0.35*C35*C13", v: 0.35 * nIn * loss.volume }, { fmt: N1, align: "right" });
  put(ws, "E36:F36", { f: "0.35*E35*G13", v: 0.35 * nOut * upperVol }, { fmt: N1, align: "right" });
  put(ws, "G36:J36", "열손실=0.35*환기횟수*체적", { align: "left" });
  put(ws, "A37:B37", "열손실량(kcal/hr) (아)", { bold: true, fill: PALE_BLUE });
  put(ws, "C37:D37", { f: "0.86*C36*G6", v: item("ventInner") }, { fmt: N1, bold: true, fill: RED, align: "right" });
  put(ws, "E37:F37", { f: "0.86*E36*G7", v: item("ventOuter") }, { fmt: N1, bold: true, fill: RED, align: "right" });
  put(
    ws,
    "G37:J37",
    "열손실량=0.86*열손실*온도차\n1) 내부공간 : 내부-상옥 온도차(B)\n2) 상옥공간 : 상옥-외기 온도차(C)",
    { align: "left", bold: true },
  );
  ws.getRow(37).height = 52;
  frame(ws, "A29:J37");

  // 4. 총손실
  text(ws, "A39", "4. 총손실열량(kcal/hr) = 2.전열손실량 + 3. 환기손실량(내부공간+상옥공간)", { bold: true, size: 12 });
  put(ws, "G39", "등유/갈탄", { bold: true, color: RED, border: "none" });
  put(ws, "H39:I39", { f: "SUM(C26,C37,E37)*(1+F16/100)", v: loss.total }, { fmt: N1, bold: true, size: 14, fill: RED, align: "left" });
  text(ws, "J39", "kcal/hr", { bold: true, size: 11 });
  put(ws, "G40", "전기", { bold: true, color: RED, border: "none" });
  put(
    ws,
    "H40:I40",
    { f: "(C26+C37*0.1+E37*0.1)*(1+F16/100)", v: (loss.conduction + loss.ventilation * 0.1) * k },
    { fmt: N1, bold: true, size: 14, fill: RED, align: "left" },
  );
  text(ws, "J40", "kcal/hr", { bold: true, size: 11 });
  ws.getRow(39).height = 21;
  ws.getRow(40).height = 21;

  // 5. 급열열량
  text(ws, "A41", "5. 급열열량(kcal/hr) (IF 총급열열량 > 총손실열량 ⇒ O.K)", { bold: true, size: 12 });
  put(ws, "A42", "구분", { bold: true, size: 11, fill: HEAD });
  put(ws, "B42:C42", "규격", { bold: true, size: 11, fill: HEAD });
  put(ws, "D42", "단위", { bold: true, size: 11, fill: HEAD });
  put(ws, "E42:F42", "값", { bold: true, size: 11, fill: HEAD });
  put(ws, "G42:H42", "검토", { bold: true, size: 11, fill: HEAD });
  put(ws, "I42:J42", "비고", { bold: true, size: 11, fill: HEAD });

  let r = 43;
  const out: Record<string, string> = {};
  for (const h of project.heaters) {
    const start = r;
    const line = (label: string, unit: string, v: Val, opt: Sty = {}) => {
      put(ws, `B${r}:C${r}`, label, { fill: opt.fill === CREAM ? CREAM : undefined });
      put(ws, `D${r}`, unit);
      put(ws, `E${r}:F${r}`, v, { fmt: N0, bold: true, fill: YELLOW, ...opt });
      put(ws, `G${r}:H${r}`, null, { fill: opt.fill === CREAM ? CREAM : PALE_GREEN });
      r++;
    };
    if (h.mode === "rated") {
      line("1대당 1시간당 급열열량(정격)", "kcal/h", h.ratedKcal);
      line("가열효율", "", h.efficiency, { fmt: "0.000", fill: undefined, bold: false });
      line("1대당 1시간당 급열열량", "kcal/h", { f: `E${start}*E${start + 1}`, v: heaterOutput(h) }, { fill: CREAM });
    } else {
      line(`${h.fuelUnit}당 열량`, `kcal/${h.fuelUnit}`, h.kcalPerUnit);
      line("투입량 (1대당)", h.fuelUnit, h.loadPerFill, { fmt: numFmt(h.loadPerFill) });
      line("작동시간", "hr", h.burnHours, { fmt: numFmt(h.burnHours) });
      line("1대당 1시간당 급열열량", "kcal/h", { f: `(E${start}*E${start + 1})/E${start + 2}`, v: heaterOutput(h) }, { fill: CREAM });
    }
    out[h.id] = `E${r - 1}`;
    put(ws, `A${start}:A${r - 1}`, h.name, { bold: true });
    put(ws, `I${start}:J${r - 1}`, h.note, { align: "left", size: 9 });
  }
  frame(ws, `A42:J${r - 1}`);

  const needStart = r;
  const count: Record<string, string> = {};
  const applied = appliedHeater(project, zone);
  for (const h of project.heaters) {
    const need = heaterNeed(loss, h, zone);
    const total = h.electric ? "H40" : "H39";
    put(ws, `B${r}:C${r + 1}`, h.id === applied.id ? `${h.name}\n★ 적용` : h.name, { bold: true });
    put(ws, `D${r}`, "필요대수", { bold: h.id === applied.id });
    put(
      ws,
      `E${r}:F${r}`,
      need.overridden ? need.applied : { f: countFormula(loss, total, out[h.id], Math.round(h.minCount)), v: need.count },
      { fmt: N0, bold: true, fill: ORANGE },
    );
    put(ws, `G${r}:H${r}`, need.overridden ? `직접 지정 (산정 ${need.count}대)` : null, { fill: PALE_GREEN, size: 9 });
    put(ws, `D${r + 1}`, "급열열량", { bold: h.id === applied.id });
    put(ws, `E${r + 1}:F${r + 1}`, { f: `E${r}*${out[h.id]}`, v: need.supply }, { fmt: N0, bold: true });
    put(ws, `G${r + 1}:H${r + 1}`, { f: `IF(E${r + 1}>=${total},"OK","부족")`, v: need.ok ? "OK" : "부족" }, { fill: PALE_GREEN });
    count[h.id] = `E${r}`;
    r += 2;
  }
  put(ws, `A${needStart}:A${r - 1}`, "필요대수", { bold: true });
  put(
    ws,
    `I${needStart}:J${r - 1}`,
    loss.countRule === "roundPlus1"
      ? "1. 필요대수 = 반올림(총손실열량 ÷ 1대당 급열열량) + 1\n2. 세대는 벽으로 칸이 나뉘므로 여유 1대를 둔다\n3. 급열열량 ≥ 총손실열량 ⇒ OK"
      : "1. 필요대수 = 올림(총손실열량 ÷ 1대당 급열열량)\n2. 급열열량 ≥ 총손실열량 ⇒ OK",
    { align: "left", size: 9 },
  );
  frame(ws, `A${needStart}:J${r - 1}`);
  setupPage(ws, `A1:J${r - 1}`);
  return { sheet: ws.name, count };
}

// ── 첨부3 (간이식) — 「주차장 열풍기 대수 산정툴」 양식 ────────────────────────
function simpleSheet(ws: ExcelJS.Worksheet, title: string, zone: Zone, loss: ZoneLoss, project: HeatProject): ZoneRefs {
  const c = project.conditions;
  [19.8, 18.1, 11.2, 9, 8.6, 11.5, 9.6, 9.6, 13, 14.9].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const item = (key: string) => loss.items.find((i) => i.key === key)?.value ?? 0;
  const surface = loss.area * 2 + loss.perimeter * loss.height;

  text(ws, "A1", title, { bold: true, size: 16 });
  put(ws, "G1:J1", `[${zone.name} · 1구역 기준${zone.qty > 1 ? ` · 같은 구역 ${zone.qty}개` : ""}]`, {
    bold: true,
    size: 11,
    align: "right",
    border: "none",
  });
  ws.getRow(1).height = 24;
  put(ws, "B2", "※ 범례", { bold: true, align: "right", border: "none" });
  put(ws, "C2", null, { fill: YELLOW });
  text(ws, "D2", "현장여건 입력", { bold: true });

  text(ws, "A3", "1. 기본현장 조건(입력)", { bold: true, size: 12 });
  const head = (r: number, last: string) => {
    put(ws, `A${r}:C${r}`, "항 목", { bold: true, size: 11, fill: HEAD });
    put(ws, `D${r}:E${r}`, "값", { bold: true, size: 11, fill: HEAD });
    put(ws, `F${r}`, "단위", { bold: true, size: 11, fill: HEAD });
    put(ws, `G${r}:J${r}`, last, { bold: true, size: 11, fill: HEAD });
  };
  const row = (r: number, label: string, v: Val, unit: string, note: string, sty: Sty = {}) => {
    put(ws, `A${r}:C${r}`, label, { bold: sty.bold });
    put(ws, `D${r}:E${r}`, v, { fmt: N2, align: "right", ...sty });
    put(ws, `F${r}`, unit);
    put(ws, `G${r}:J${r}`, note, { align: "left", size: 9 });
    ws.getRow(r).height = 19;
  };
  head(4, "비 고");
  const src = zone.geometry.source === "cad" ? "도면에서 측정" : "직접 입력";
  row(5, "보양구획 바닥면적", loss.area, "㎡", src, { fill: YELLOW });
  row(6, "보양구획 둘레", loss.perimeter, "m", src, { fill: YELLOW });
  row(7, "층고(H)", loss.height, "m", "", { fill: YELLOW });
  row(8, "실내 목표 양생온도", c.cureTemp, "℃", "", { fill: YELLOW, fmt: N1 });
  row(9, "외기 최저온도", c.outdoorTemp, "℃", "", { fill: YELLOW, fmt: N1 });
  row(10, "평균 열관류율", c.simpleU, "kcal/㎡·h·℃", "보양 천막·콘크리트 평균", { fill: YELLOW });
  row(11, "시간당 환기 횟수", c.simpleAch, "회/h", "", { fill: YELLOW });
  row(12, "안전율", c.simpleSafety, "%", "", { fill: YELLOW, fmt: N1 });
  row(13, "같은 구역 수", zone.qty, "개", `동절기 보양 ${zone.repeats}회 · 장비 임대 ${zone.rentalMonths}개월`, { fmt: N0 });
  frame(ws, "A4:J13");

  text(ws, "A15", "2. 열량 산출(자동)", { bold: true, size: 12 });
  head(16, "산 식");
  row(17, "내외부 온도차", { f: "D8-D9", v: loss.dA }, "℃", "목표 양생온도 − 외기 최저온도", { fmt: N1 });
  row(18, "보양공간 체적", { f: "D5*D7", v: loss.volume }, "㎥", "바닥면적 × 층고");
  row(19, "보양 총 표면적", { f: "D5*2+D6*D7", v: surface }, "㎡", "바닥 + 천장 + 벽(둘레 × 층고)");
  row(20, "전도 열손실", { f: "D19*D10*D17", v: item("cond") }, "kcal/h", "표면적 × 열관류율 × 온도차", { fmt: N0 });
  row(21, "환기 열손실", { f: "D18*D11*0.24*1.2*D17", v: item("vent") }, "kcal/h", "체적 × 환기횟수 × 0.24 × 1.2 × 온도차", { fmt: N0 });
  row(22, "총 소요 열량", { f: "(D20+D21)*(1+D12/100)", v: loss.total }, "kcal/h", "(전도 + 환기) × (1 + 안전율)", {
    fmt: N0,
    bold: true,
    fill: RED,
    size: 12,
  });
  frame(ws, "A16:J22");

  text(ws, "A24", "3. 급열열량 및 필요 대수 (IF 총급열열량 > 총소요열량 ⇒ O.K)", { bold: true, size: 12 });
  put(ws, "A25:C25", "열 원", { bold: true, size: 11, fill: HEAD });
  put(ws, "D25:E25", "1대당 급열열량 (kcal/h)", { bold: true, size: 10, fill: HEAD });
  put(ws, "F25", "필요대수", { bold: true, size: 11, fill: HEAD });
  put(ws, "G25:H25", "급열열량 (kcal/h)", { bold: true, size: 10, fill: HEAD });
  put(ws, "I25:J25", "검토", { bold: true, size: 11, fill: HEAD });
  ws.getRow(25).height = 30;
  let r = 26;
  const count: Record<string, string> = {};
  const applied = appliedHeater(project, zone);
  for (const h of project.heaters) {
    const need = heaterNeed(loss, h, zone);
    put(ws, `A${r}:C${r}`, h.id === applied.id ? `${h.name}  ★ 적용` : h.name, { bold: h.id === applied.id });
    put(ws, `D${r}:E${r}`, Math.round(heaterOutput(h) * 100) / 100, { fmt: N0, align: "right" });
    put(
      ws,
      `F${r}`,
      need.overridden ? need.applied : { f: countFormula(loss, "D22", `D${r}`, Math.round(h.minCount)), v: need.count },
      { fmt: N0, bold: true, fill: ORANGE },
    );
    put(ws, `G${r}:H${r}`, { f: `F${r}*D${r}`, v: need.supply }, { fmt: N0, bold: true, align: "right" });
    put(ws, `I${r}:J${r}`, { f: `IF(G${r}>=D22,"OK","부족")`, v: need.ok ? "OK" : "부족" }, { fill: PALE_GREEN });
    ws.getRow(r).height = 19;
    count[h.id] = `F${r}`;
    r++;
  }
  frame(ws, `A25:J${r - 1}`);
  text(ws, `A${r + 1}`, "※ 필요대수 = 올림(총 소요 열량 ÷ 1대당 급열열량). 안전율이 총 소요 열량에 들어 있다.", { size: 9 });
  setupPage(ws, `A1:J${r + 1}`);
  return { sheet: ws.name, count };
}

// ── 배치도 그림 ──────────────────────────────────────────────────────────────

/** 도면 일부 + 구역 + 열원 배치점을 흰 바탕 그림으로 그린다 (base64 PNG) */
function renderLayout(dxf: LiteDxf | null, zones: Zone[], project: HeatProject): { base64: string; w: number; h: number } | null {
  const polys = zones.map((z) => z.geometry.polygon!).filter((p) => p && p.length >= 3);
  if (polys.length === 0 || typeof document === "undefined") return null;
  const b = polygonBounds(polys.flat());
  const padX = (b.maxX - b.minX) * 0.08 + 1e-6;
  const padY = (b.maxY - b.minY) * 0.08 + 1e-6;
  const minX = b.minX - padX;
  const maxX = b.maxX + padX;
  const minY = b.minY - padY;
  const maxY = b.maxY + padY;
  const W = 2000;
  const scale = Math.min(W / (maxX - minX), 1300 / (maxY - minY));
  const w = Math.round((maxX - minX) * scale);
  const h = Math.round((maxY - minY) * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const X = (x: number) => (x - minX) * scale;
  const Y = (y: number) => (maxY - y) * scale;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  if (dxf) {
    ctx.strokeStyle = "rgba(70,80,96,0.75)";
    ctx.lineWidth = 1;
    const { segs } = dxf;
    let n = 0;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i];
      const ay = segs[i + 1];
      const bx = segs[i + 2];
      const by = segs[i + 3];
      if ((ax < minX && bx < minX) || (ax > maxX && bx > maxX) || (ay < minY && by < minY) || (ay > maxY && by > maxY)) continue;
      ctx.moveTo(X(ax), Y(ay));
      ctx.lineTo(X(bx), Y(by));
      if (++n % 4000 === 0) {
        ctx.stroke();
        ctx.beginPath();
      }
    }
    ctx.stroke();
  }

  const fontPx = Math.max(18, Math.round(w / 85));
  for (const z of zones) {
    const poly = z.geometry.polygon!;
    const color = zoneColor(z.color);
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    const heater = appliedHeater(project, z);
    const need = heaterNeed(zoneLoss(z, project.conditions), heater, z);
    const rr = Math.max(7, fontPx * 0.42);
    // 화면 배치도와 같은 규칙 — 지하주차장은 외곽 띠를 따라, 나머지는 고르게
    const uf = (project.drawings[zoneSheet(z)]?.unit ?? "mm") === "mm" ? 0.001 : 1;
    // 외곽 여유(옵셋)를 줬으면 옵셋 구간 한가운데에 놓는다
    const off = (z.geometry.offset ?? 0) > 0 ? z.geometry.offset! / uf : 0;
    const marks =
      z.kind === "parking"
        ? placeHeatersEdge(
            off ? offsetPolygon(poly, off) : poly,
            Math.min(need.applied, 120),
            off ? off / 2 : EDGE_INSET_M / uf,
            EDGE_SPACING_M / uf,
          )
        : placeHeaters(poly, Math.min(need.applied, 120), undefined, {
            poly,
            share: edgeLossShare(zoneLoss(z, project.conditions)),
            band: EDGE_BAND_M / uf,
          });
    for (const m of marks) {
      ctx.beginPath();
      ctx.arc(X(m.x), Y(m.y), rr, 0, Math.PI * 2);
      ctx.fillStyle = heater.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      // 점선 테두리 — 원본 배치도의 난로 표시
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#d11";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(m.x) - rr * 1.6, Y(m.y) - rr * 1.6, rr * 3.2, rr * 3.2);
      ctx.setLineDash([]);
    }

    const lp = labelPoint(poly);
    const l1 = z.qty > 1 ? `${z.name} ×${z.qty}` : z.name;
    const l2 = `${heater.name} ${need.applied}대`;
    ctx.font = `700 ${fontPx}px 'Malgun Gothic', sans-serif`;
    const tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + fontPx;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(X(lp.x) - tw / 2, Y(lp.y) - fontPx * 1.35, tw, fontPx * 2.7);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(X(lp.x) - tw / 2, Y(lp.y) - fontPx * 1.35, tw, fontPx * 2.7);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111827";
    ctx.fillText(l1, X(lp.x), Y(lp.y) - fontPx * 0.6);
    ctx.fillStyle = "#b91c1c";
    ctx.fillText(l2, X(lp.x), Y(lp.y) + fontPx * 0.65);
  }
  return { base64: canvas.toDataURL("image/png").split(",")[1], w, h };
}

/** 열원 사진 (원본 검토서의 사진). 못 불러오면 사진 줄을 뺀다 */
async function loadPhoto(url: string, crop?: [number, number, number, number]): Promise<{ base64: string; w: number; h: number } | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const [sx, sy, sw, sh] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return { base64: canvas.toDataURL("image/png").split(",")[1], w: sw, h: sh };
  } catch {
    return null;
  }
}

// ── 내보내기 ─────────────────────────────────────────────────────────────────

export async function exportHeatReviewXlsx(project: HeatProject): Promise<void> {
  const XL = (await import("exceljs")).default;
  const wb = new XL.Workbook();
  wb.creator = "스마트 툴박스 · 동절기 열원검토";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const { heaters, zones, cost, conditions: cnd } = project;
  const sum = summarize(project);
  const plan = sum.plan;
  const uniform = uniformHeaterId(project);
  const mixed = uniform === null;
  const costOf = (id: string) => sum.costs.find((x) => x.heaterId === id)!;
  const floorZones = zones.filter((z) => z.kind !== "parking");
  const parkingZones = zones.filter((z) => z.kind === "parking");
  const used = new Set<string>();
  const today = new Date();
  const dateText = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

  // 시트 순서를 원본과 맞추려고 요약·첨부2 를 먼저 만들고, 내용은 첨부3 을 만든 뒤 채운다
  const wsSum = wb.addWorksheet(sheetName("동절기 열원", used));
  const wsCost = wb.addWorksheet(sheetName("첨부2. 산출서및금액비교", used));

  // ── 첨부3: 구역별 ──
  const refs = new Map<string, ZoneRefs>();
  zones.forEach((z, i) => {
    const loss = zoneLoss(z, cnd);
    if (loss.issue) return;
    const ws = wb.addWorksheet(sheetName(`첨부3-${i + 1}. 열원검토(${z.name})`, used));
    const title = `첨부3-${i + 1}. ${z.method === "enclosure" ? "동절기 열원 산출 검토서" : "열풍기 대수 산정 검토서"}`;
    refs.set(z.id, z.method === "enclosure" ? enclosureSheet(ws, title, z, loss, project) : simpleSheet(ws, title, z, loss, project));
  });
  const cnt = (z: Zone, h: Heater) => {
    const r = refs.get(z.id);
    const need = heaterNeed(zoneLoss(z, cnd), h, z);
    return r ? { f: `${ref(r.sheet, r.count[h.id])}*${z.qty}`, v: need.applied * z.qty } : 0;
  };

  // ── 첨부2: 산출서 및 투입금액 비교 ──
  // 열: A:C 항목 | 열원별 | (섞어 쓰면) 적용 계획 | 대비 | 비고
  const hCol = heaters.map((_, i) => colName(4 + i));
  const planCol = mixed ? colName(4 + heaters.length) : null;
  const diffCol = colName(4 + heaters.length + (mixed ? 1 : 0));
  const noteCol = colName(4 + heaters.length + (mixed ? 2 : 1));
  // 대비 = (적용) − (기준). 기준은 적용이 아닌 첫 열원(원본: 펠릿 − 열풍기)
  const refIdx = heaters.findIndex((h) => h.id !== uniform);
  const targetCol = mixed ? planCol! : hCol[heaters.findIndex((h) => h.id === uniform)];
  const targetCost: HeaterCost = plan;
  const baseCol = refIdx >= 0 && heaters.length > 1 ? hCol[mixed ? 0 : refIdx] : null;
  const baseHeater = baseCol ? heaters[mixed ? 0 : refIdx] : null;
  const baseCost = baseHeater ? costOf(baseHeater.id) : null;
  const targetName = mixed ? "적용 계획" : (heaters.find((h) => h.id === uniform)?.name ?? "");
  const cells: { floorPer?: number; season: number } = { season: 0 };
  {
    const ws = wsCost;
    ws.getColumn(1).width = 14.5;
    ws.getColumn(2).width = 8.9;
    ws.getColumn(3).width = 18.6;
    hCol.forEach((_, i) => (ws.getColumn(4 + i).width = 21.5));
    if (planCol) ws.getColumn(4 + heaters.length).width = 21.5;
    ws.getColumn(parseAddr(`${diffCol}1`)[0]).width = 19;
    ws.getColumn(parseAddr(`${noteCol}1`)[0]).width = 26;
    text(ws, "A1", "첨부2. 산출서 및 투입금액 비교", { bold: true, size: 20 });
    ws.getRow(1).height = 30;

    let r = 3;
    const H = 30;
    const label = (range: string, v: string, sty: Sty = {}) => put(ws, range, v, { size: 12, ...sty });
    /** 한 줄: 열원별 값 + 적용 계획 값 + 대비 + 비고 */
    const line = (
      name: string | null,
      per: (h: Heater, col: string, i: number) => Val,
      opt: {
        fmt?: string | ((h: Heater) => string);
        planV?: Val;
        /** 대비 칸에 넣을 값을 비용에서 꺼내는 법. 있으면 대비 수식을 건다 */
        diff?: (c: HeaterCost) => number;
        note?: string;
        sty?: Sty;
        labelSty?: Sty;
      } = {},
    ) => {
      if (name !== null) label(`A${r}:C${r}`, name, opt.labelSty ?? opt.sty);
      heaters.forEach((h, i) =>
        put(ws, `${hCol[i]}${r}`, per(h, hCol[i], i), {
          size: 12,
          fmt: typeof opt.fmt === "function" ? opt.fmt(h) : opt.fmt,
          ...opt.sty,
        }),
      );
      if (planCol) {
        put(ws, `${planCol}${r}`, opt.planV === undefined ? "종류별" : opt.planV, {
          size: 12,
          fmt: typeof opt.fmt === "function" ? opt.fmt(heaters[0]) : opt.fmt,
          ...opt.sty,
          color: opt.planV === undefined ? "FF999999" : opt.sty?.color,
        });
      }
      const dv =
        opt.diff && baseCol && baseCost
          ? { f: `${targetCol}${r}-${baseCol}${r}`, v: opt.diff(targetCost) - opt.diff(baseCost) }
          : null;
      // 보라색 줄은 빨간 글자가 안 보인다 → 흰 글자, 부호만 표시
      const purple = opt.sty?.fill === PURPLE;
      put(ws, `${diffCol}${r}`, dv, {
        size: 12,
        fmt: purple ? "\\(\\+\\)#,##0;\\(\\-\\)#,##0" : DIFF,
        bold: true,
        ...opt.sty,
        color: purple ? "FFFFFFFF" : undefined,
      });
      put(ws, `${noteCol}${r}`, opt.note ?? null, { size: 11, ...opt.sty, bold: false, color: opt.sty?.fill === PURPLE ? "FFFFFFFF" : undefined });
      ws.getRow(r).height = H;
      return r++;
    };

    // 머리줄
    label(`A${r}:C${r}`, "항   목", { bold: true, size: 14, fill: HEAD });
    heaters.forEach((h, i) => put(ws, `${hCol[i]}${r}`, h.name, { bold: true, size: 14, fill: HEAD }));
    if (planCol) put(ws, `${planCol}${r}`, "적용 계획", { bold: true, size: 14, fill: HEAD });
    put(ws, `${diffCol}${r}`, baseHeater ? `대 비\n${targetName}\n− ${baseHeater.name}` : "대 비", { bold: true, size: baseHeater ? 10 : 14, fill: HEAD });
    put(ws, `${noteCol}${r}`, "비 고", { bold: true, size: 14, fill: HEAD });
    ws.getRow(r).height = 48;
    r++;

    const rLoad = line("1회 포장단위", (h) => h.loadPerFill, { fmt: (h) => unitFmt(h.fuelUnit, h.loadPerFill) });
    const rHeat = line("발열량", (h) => (h.mode === "rated" ? h.ratedKcal : h.kcalPerUnit), {
      fmt: (h) => unitFmt(h.mode === "rated" ? "kcal/hr" : `kcal/${h.fuelUnit}`),
      note: heaters
        .filter((h) => h.mode === "rated")
        .map((h) => `* ${h.name} 효율 : ${Math.round(h.efficiency * 1000) / 10}%`)
        .join("\n"),
    });
    const rBurn = line("1회지속시간", (h) => h.burnHours, {
      fmt: (h) => unitFmt("시간", h.burnHours),
      sty: { fill: YELLOW },
      labelSty: {},
    });
    line(
      "시간당 급열량",
      (h, col) => ({
        f: h.mode === "rated" ? `${col}${rHeat}*${h.efficiency}` : `${col}${rLoad}*${col}${rHeat}/${col}${rBurn}`,
        v: heaterOutput(h),
      }),
      { fmt: unitFmt("kcal/hr") },
    );

    let rFloorSeason: number | null = null;
    if (floorZones.length > 0) {
      const z0 = r;
      for (const z of floorZones) {
        const row = line(null, (h) => cnt(z, h), {
          fmt: N0,
          planV: plan.rows.find((x) => x.zoneId === z.id)?.units ?? 0,
          note: mixed ? `적용: ${appliedHeater(project, z).name}` : undefined,
        });
        label(`B${row}:C${row}`, `${z.name} × ${z.qty}${z.kind === "core" ? "코어" : "세대"}`);
      }
      label(`A${z0}:A${r - 1}`, "1개층\n필요개수");
      const zN = r - 1;
      const rUnits = line("1개층 난로 총 필요대수", (h, col) => ({ f: `SUM(${col}${z0}:${col}${zN})`, v: costOf(h.id).floor?.units ?? 0 }), {
        fmt: N0,
        planV: plan.floor?.units ?? 0,
        diff: (c) => c.floor?.units ?? 0,
        sty: { bold: true, fill: CREAM },
      });
      const rFuelQty = line(
        `${cost.cureHours}시간 급열시 총필요량`,
        (h, col) => ({ f: `${cost.cureHours}/${col}${rBurn}*${col}${rUnits}*${col}${rLoad}`, v: costOf(h.id).floor?.fuel ?? 0 }),
        { fmt: (h) => unitFmt(h.fuelUnit), labelSty: { bold: true, fill: LABEL_GREEN } },
      );
      const rPrice = line("연료 단가", (h) => h.fuelPrice, { fmt: (h) => unitFmt(`원/${h.fuelUnit}`), sty: { bold: true } });
      const rFuelCost = line(
        "1개층 연료비 소계",
        (h, col) => ({ f: `${col}${rPrice}*${col}${rFuelQty}`, v: costOf(h.id).floor?.fuelCost ?? 0 }),
        { fmt: N0, planV: plan.floor?.fuelCost ?? 0, diff: (c) => c.floor?.fuelCost ?? 0, sty: { bold: true, fill: ORANGE } },
      );
      const rRent = line("난로 개당 월 임대료", (h) => h.rentalMonthly, { fmt: N0, labelSty: { bold: true, fill: LABEL_GREEN } });
      const rRentB = line(
        "1개동 월 임대료",
        (h, col) => ({ f: `${col}${rRent}*${col}${rUnits}`, v: h.rentalMonthly * (costOf(h.id).floor?.units ?? 0) }),
        { fmt: N0 },
      );
      const rRentF = line(
        "1개층 난로 임대료",
        (h, col) => ({ f: `ROUND(${col}${rRentB}/${Math.max(1, cost.floorsPerMonth)},0)`, v: costOf(h.id).floor?.rental ?? 0 }),
        {
          fmt: N0,
          planV: plan.floor?.rental ?? 0,
          diff: (c) => c.floor?.rental ?? 0,
          note: `1개월 ${cost.floorsPerMonth}개층 공사시`,
          sty: { bold: true, fill: ORANGE },
        },
      );
      line(`${cost.cureHours}시간 난방시 인건비`, () => null, { planV: null, labelSty: { bold: true, fill: LABEL_GREEN } });
      const rMan = line("투입인원 소계", (h) => h.laborMandays, {
        fmt: (h) => unitFmt("품", h.laborMandays),
        planV: plan.floor?.mandays ?? 0,
        note: "인양·배치, 해체·하역,\n주·야간 급열관리",
        sty: { fill: CREAM },
      });
      const rWage = line(null, () => cost.wage, { fmt: N0, planV: cost.wage });
      label(`A${rWage}:B${rWage}`, "노임단가");
      label(`C${rWage}`, "식대포함");
      const rLabor = line("1개층 총투입 인건비", (h, col) => ({ f: `${col}${rMan}*${col}${rWage}`, v: costOf(h.id).floor?.labor ?? 0 }), {
        fmt: N0,
        planV: plan.floor?.labor ?? 0,
        diff: (c) => c.floor?.labor ?? 0,
        sty: { bold: true, fill: ORANGE },
      });
      cells.floorPer = line(
        "1개층 급열보양 자재+인건비 합계",
        (h, col) => ({ f: `${col}${rFuelCost}+${col}${rRentF}+${col}${rLabor}`, v: costOf(h.id).floor?.perPour ?? 0 }),
        { fmt: N0, planV: plan.floor?.perPour ?? 0, diff: (c) => c.floor?.perPour ?? 0, sty: { bold: true, fill: SALMON } },
      );
      const repeats = plan.floor?.repeats ?? 0;
      rFloorSeason = line(
        `동절기(${cost.floorsPerMonth}개층/월*${cost.months}개월*${cost.buildings}동) 보양시 투입금액`,
        (h, col) => ({ f: `${col}${cells.floorPer}*${repeats}`, v: costOf(h.id).floor?.season ?? 0 }),
        {
          fmt: N0,
          planV: plan.floor?.season ?? 0,
          diff: (c) => c.floor?.season ?? 0,
          note: `기준층 ${repeats}회`,
          sty: { bold: true, fill: PURPLE, color: "FFFFFFFF" },
          labelSty: { bold: true, fill: PURPLE, color: "FFFFFFFF", size: 11 },
        },
      );
    }

    const parkRows: number[] = [];
    if (parkingZones.length > 0) {
      label(`A${r}:${noteCol}${r}`, "주차장·지하 구역 — 구역별 (간이식)", { bold: true, fill: HEAD, align: "left" });
      ws.getRow(r).height = 24;
      r++;
      for (const z of parkingZones) {
        const u = line(`${z.name}${z.qty > 1 ? ` × ${z.qty}` : ""} 필요대수`, (h) => cnt(z, h), {
          fmt: N0,
          planV: plan.rows.find((x) => x.zoneId === z.id)?.units ?? 0,
          note: mixed ? `적용: ${appliedHeater(project, z).name}` : undefined,
        });
        parkRows.push(
          line(
            `${z.name} 동절기 금액`,
            (h, col) => ({
              f:
                `${col}${u}*(${cost.cureHours}/${col}${rBurn}*${col}${rLoad}*${h.fuelPrice})*${z.repeats}` +
                `+${col}${u}*${h.rentalMonthly}*${z.rentalMonths}+${h.laborMandays}*${cost.wage}*${z.repeats}`,
              v: costOf(h.id).parking.find((p) => p.zoneId === z.id)?.season ?? 0,
            }),
            {
              fmt: N0,
              planV: plan.parking.find((p) => p.zoneId === z.id)?.season ?? 0,
              diff: (c) => c.parking.find((p) => p.zoneId === z.id)?.season ?? 0,
              note: `보양 ${z.repeats}회 · 임대 ${z.rentalMonths}개월\n(연료+임대+인건비)`,
              sty: { bold: true, fill: CREAM },
            },
          ),
        );
      }
    }
    // 총계 — 기준층만 있으면 위의 보라색 줄이 곧 총계다
    if (parkRows.length > 0 || rFloorSeason === null) {
      cells.season = line(
        "동절기 총 투입금액",
        (h, col) => ({
          f: [rFloorSeason !== null ? `${col}${rFloorSeason}` : null, ...parkRows.map((p) => `${col}${p}`)].filter(Boolean).join("+") || "0",
          v: costOf(h.id).seasonTotal,
        }),
        {
          fmt: N0,
          planV: plan.seasonTotal,
          diff: (c) => c.seasonTotal,
          sty: { bold: true, fill: PURPLE, color: "FFFFFFFF" },
          labelSty: { bold: true, fill: PURPLE, color: "FFFFFFFF" },
        },
      );
    } else {
      cells.season = rFloorSeason;
    }
    frame(ws, `A3:${noteCol}${r - 1}`);
    setupPage(ws, `A1:${noteCol}${r - 1}`);
  }

  // ── 요약: 동절기 열원 ──
  {
    const ws = wsSum;
    const cols = [...heaters.map((h) => ({ id: h.id, name: h.name, col: "" })), ...(mixed ? [{ id: "plan", name: "적용 계획", col: "" }] : [])];
    const wEach = Math.max(18, Math.round(84 / cols.length));
    ws.getColumn(1).width = 16;
    cols.forEach((c, i) => {
      c.col = colName(2 + i);
      ws.getColumn(2 + i).width = wEach;
    });
    const last = colName(2 + cols.length);
    ws.getColumn(2 + cols.length).width = 16;
    const costRef = wsCost.name;
    const costCol = (id: string) => (id === "plan" ? planCol! : hCol[heaters.findIndex((h) => h.id === id)]);
    const costAt = (id: string): HeaterCost => (id === "plan" ? plan : costOf(id));
    const isTarget = (id: string) => (mixed ? id === "plan" : id === uniform);

    put(ws, `A1:${last}1`, `[${project.name}] 골조 동절기공사 열원공급 방법 검토`, { bold: true, size: 20, underline: true, border: "none" });
    ws.getRow(1).height = 38;
    put(ws, `A2:${last}2`, `(${dateText})`, { size: 11, border: "none" });
    text(ws, "A4", "1. 골조 동절기공사 열원방식에 따른 안전성 및 경제성 검토", { bold: true, size: 13 });
    text(ws, "A5", "    : 한중콘크리트 - 타설일의 일평균기온이 4℃이하, 타설 완료 후 24시간동안 일최저기온 0℃이하일 경우", { size: 11 });
    text(
      ws,
      "A6",
      `    : 검토 조건 - 외기 ${cnd.outdoorTemp}℃ / 양생 ${cnd.cureTemp}℃ / 급열 ${cost.cureHours}시간, 보양 구역 ${zones.length}개 (1회 타설 ${Math.round(sum.totalArea).toLocaleString("ko-KR")}㎡)`,
      { size: 11 },
    );
    [4, 5, 6].forEach((r) => (ws.getRow(r).height = 22));
    text(ws, "A8", "2. 열원별 비교", { bold: true, size: 13 });
    ws.getRow(8).height = 22;

    let r = 9;
    const rowOf = (name: string, per: (id: string) => Val, sty: Sty = {}, note: string | null = null, height = 26) => {
      put(ws, `A${r}`, name, { size: 11 });
      cols.forEach((c) => put(ws, `${c.col}${r}`, per(c.id), { size: 11, ...sty, bold: sty.bold ?? isTarget(c.id) }));
      put(ws, `${last}${r}`, note, { size: 10 });
      ws.getRow(r).height = height;
      return r++;
    };
    put(ws, `A${r}`, "구분", { bold: true, size: 12, fill: HEAD });
    cols.forEach((c) => put(ws, `${c.col}${r}`, isTarget(c.id) && !mixed ? `${c.name} (적용)` : c.name, { bold: true, size: 12, fill: HEAD }));
    put(ws, `${last}${r}`, "비고", { bold: true, size: 12, fill: HEAD });
    ws.getRow(r).height = 26;
    r++;

    // 사진 — 원본 검토서의 열원 사진 (기본 열원만)
    const photos: Record<string, Awaited<ReturnType<typeof loadPhoto>>> = {
      kerosene: heaters.some((h) => h.id === "kerosene") ? await loadPhoto("/heat-review/heater-kerosene.png", [440, 70, 380, 300]) : null,
      pellet: heaters.some((h) => h.id === "pellet") ? await loadPhoto("/heat-review/heater-pellet.png") : null,
    };
    if (photos.kerosene || photos.pellet) {
      const pr = rowOf("사진", () => null, {}, null, 130);
      cols.forEach((c, i) => {
        const p = photos[c.id];
        if (!p) return;
        // 칸(가로 wEach 글자 ≈ 7.3px/글자, 세로 130pt ≈ 173px) 안에 여백을 두고 맞춘다
        const colPx = wEach * 7.3;
        const rowPx = 173;
        const k = Math.min((colPx - 16) / p.w, (rowPx - 16) / p.h);
        const wPx = p.w * k;
        const hPx = p.h * k;
        const id = wb.addImage({ base64: p.base64, extension: "png" });
        ws.addImage(id, {
          tl: { col: 1 + i + (colPx - wPx) / 2 / colPx, row: pr - 1 + (rowPx - hPx) / 2 / rowPx },
          ext: { width: wPx, height: hPx },
        });
      });
    }
    if (mixed) {
      rowOf(
        "적용 범위",
        (id) =>
          id === "plan"
            ? (Object.keys(ZONE_KIND_LABEL) as ZoneKind[])
                .filter((k) => zones.some((z) => z.kind === k))
                .map((k) => `${ZONE_KIND_LABEL[k]}: ${appliedHeater(project, { kind: k }).name}`)
                .join("\n")
            : "전 구역",
        {},
        "종류별로 다른 열원",
        46,
      );
    }
    if (cells.floorPer) {
      rowOf("1개층 보양비용", (id) => ({ f: ref(costRef, `${costCol(id)}${cells.floorPer}`), v: costAt(id).floor?.perPour ?? 0 }), { fmt: N0, size: 12 }, "기준층(세대·코어)");
    }
    rowOf(
      "동절기 보양비용",
      (id) => ({ f: ref(costRef, `${costCol(id)}${cells.season}`), v: costAt(id).seasonTotal }),
      { fmt: N0, size: 12, bold: true },
      plan.floor ? `${cost.floorsPerMonth}개층*${cost.months}개월\n*${cost.buildings}개동` : null,
      34,
    );
    if (baseCost && baseHeater) {
      rowOf(
        `${baseHeater.name} 대비`,
        (id) => (id === baseHeater.id ? "기준" : { f: ref(costRef, `${costCol(id)}${cells.season}`) + "-" + ref(costRef, `${baseCol}${cells.season}`), v: costAt(id).seasonTotal - baseCost.seasonTotal }),
        { fmt: DIFF, size: 11 },
        "(+) 증가 / (-) 절감",
      );
      rowOf(
        "대비 비율",
        (id) =>
          id === baseHeater.id
            ? "100%"
            : {
                f: `IF(${ref(costRef, `${baseCol}${cells.season}`)}=0,0,${ref(costRef, `${costCol(id)}${cells.season}`)}/${ref(costRef, `${baseCol}${cells.season}`)})`,
                v: baseCost.seasonTotal > 0 ? costAt(id).seasonTotal / baseCost.seasonTotal : 0,
              },
        { fmt: "0.0%", size: 11 },
      );
    }
    rowOf("동시 배치 대수", (id) => costAt(id).peakUnits, { fmt: unitFmt("대") });
    rowOf(
      "1회\n지속시간",
      (id) => heaters.find((h) => h.id === id)?.burnHours ?? "종류별",
      { fmt: unitFmt("시간", heaters.every((h) => Number.isInteger(h.burnHours)) ? 1 : 0.5) },
      null,
      30,
    );
    rowOf("특징", (id) => heaters.find((h) => h.id === id)?.note ?? "구역 종류에 맞는 열원을 나눠 적용", { size: 10 }, null, 58);
    rowOf("급열량 검토", (id) => (costAt(id).allOk ? "O.K" : "부족 구역 있음"));
    rowOf("현장의견", (id) => (isTarget(id) ? "★" : null), { size: 14, bold: true });
    frame(ws, `A9:${last}${r - 1}`);

    r++;
    text(ws, `A${r}`, "3. 현장 의견", { bold: true, size: 14 });
    ws.getRow(r++).height = 24;
    const say = (s: string, sty: Sty = {}) => {
      text(ws, `A${r}`, s, { size: 12, ...sty });
      ws.getRow(r++).height = 26;
    };
    const eok = (n: number) => `${(Math.abs(n) / 1e8).toFixed(2)}억`;
    const planText = mixed
      ? (Object.keys(ZONE_KIND_LABEL) as ZoneKind[])
          .filter((k) => zones.some((z) => z.kind === k))
          .map((k) => `${ZONE_KIND_LABEL[k]} ${appliedHeater(project, { kind: k }).name}`)
          .join(", ")
      : targetName;
    say(`    - ${planText} 적용 시 동절기 보양비용 약 ${eok(targetCost.seasonTotal)}원 (동시 배치 ${Math.round(targetCost.peakUnits)}대)`);
    if (baseCost && baseHeater && baseCost.seasonTotal > 0) {
      const d = targetCost.seasonTotal - baseCost.seasonTotal;
      const pct = Math.round((targetCost.seasonTotal / baseCost.seasonTotal) * 1000) / 10;
      say(`    - ${baseHeater.name} 대비 사용금액 ${pct}%로 약 ${eok(d)}원 ${d <= 0 ? "절감" : "증가"}`);
    }
    if (!targetCost.allOk) say("    - 급열량이 손실열량에 못 미치는 구역이 있음 — 적용 대수 재검토 필요", { color: RED });
    say(`⇒ ${planText} 사용`, { bold: true, underline: true, indent: 3 });
    setupPage(ws, `A1:${last}${r - 1}`);
  }

  // ── 첨부4: 배치도 ──
  {
    const ws = wb.addWorksheet(sheetName("첨부4. 배치도", used));
    for (let c = 1; c <= 16; c++) ws.getColumn(c).width = 11;
    text(ws, "A1", "첨부4. 열원별 난로 배치도", { bold: true, size: 16 });
    ws.getRow(1).height = 26;
    let r = 3;
    let n = 0;
    for (const kind of Object.keys(ZONE_KIND_LABEL) as ZoneKind[]) {
      const drawn = zones.filter((z) => z.geometry.polygon && z.geometry.polygon.length >= 3 && zoneSheet(z) === kind);
      if (drawn.length === 0) continue;
      const dxf = project.drawings[kind] ? await loadDrawing(project.id, kind) : null;
      const img = renderLayout(dxf, drawn, project);
      if (!img) continue;
      n++;
      const names = Array.from(new Set(drawn.map((z) => appliedHeater(project, z).name))).join(" · ");
      text(ws, `A${r}`, `(${n}) ${ZONE_KIND_LABEL[kind]} 도면 — ${names}`, { bold: true, size: 12 });
      text(ws, `A${r + 1}`, drawn.map((z) => `${z.name}${z.qty > 1 ? `×${z.qty}` : ""} ${heaterNeed(zoneLoss(z, cnd), appliedHeater(project, z), z).applied}대`).join("   /   "), { size: 10 });
      const wPx = 1180;
      const hPx = Math.round((img.h / img.w) * wPx);
      ws.addImage(wb.addImage({ base64: img.base64, extension: "png" }), { tl: { col: 0, row: r + 1.3 }, ext: { width: wPx, height: hPx } });
      r += Math.ceil(hPx / 20) + 5;
    }
    const manual = zones.filter((z) => !z.geometry.polygon);
    if (manual.length > 0) {
      text(ws, `A${r}`, `※ 치수로 입력한 구역(도면 없음): ${manual.map((z) => `${z.name} ${heaterNeed(zoneLoss(z, cnd), appliedHeater(project, z), z).applied}대${z.qty > 1 ? ` × ${z.qty}` : ""}`).join(" / ")}`, { size: 10 });
      r++;
    }
    if (n === 0) text(ws, "A3", "도면에 그린 구역이 없어 배치도를 만들지 못했습니다. 「구역」 탭에서 도면 위에 구역을 그리면 여기에 배치도가 들어갑니다.", { size: 11 });
    ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:P${Math.max(r, 5)}` };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `${stamp} 동절기 열원검토_${project.name.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
