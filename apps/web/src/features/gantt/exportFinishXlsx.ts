/**
 * 마감 공정표 엑셀 저장 — 간트만 (2026-11-05 사용자: 진척표·요약 시트는 빼고 화면 간트 그대로).
 * 「마감 공정표」 시트 한 장: 보고 있는 달, 날짜 1칸씩. 동마다 동 이름 줄 → 골조 S타설 줄 → 공종(×코어) 줄.
 * 줄은 화면과 같은 finishRowsOf(「이 달 작업 없는 공종 숨기기」 체크도 같게). 막대 = 칸 병합 + 공종 색,
 * ✓ 세대 완료는 진하게, 예정은 흐린 색에 기울임. 겹치는 막대는 줄 안에서 아래 칸으로(화면 stackLanes 와 같다).
 * 일요일 회색, 공휴일·일요일 빨간 날짜, 오늘 날짜 칸 채움. A3 가로 인쇄. exceljs 는 누를 때 불러온다.
 */
import type ExcelJS from "exceljs";
import { dateRange, floorListText, floorRangeText, getDayInfo, type FinishPlanRow, type FinishPlanSettings } from "@ipg/gantt-engine";
import type { FinishResponse } from "./api";
import { finishRowsOf, stackLanes } from "./components/FinishGantt";
import { monthRange } from "./dates";
import type { FramePours } from "./framePours";
import { CALENDAR } from "./hooks";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 화면 공종 묶음 색(tailwind -100 바탕 / -500 테두리)과 같은 값 */
const GROUP_ARGB: Record<string, { bg: string; line: string }> = {
  내장: { bg: "EDE9FE", line: "8B5CF6" },
  PL창호: { bg: "D1FAE5", line: "10B981" },
  유리: { bg: "CFFAFE", line: "06B6D4" },
  타일: { bg: "FFEDD5", line: "F97316" },
  방수: { bg: "E0F2FE", line: "0EA5E9" },
  "기포+방통": { bg: "FFE4E6", line: "F43F5E" },
  가구: { bg: "FEF3C7", line: "F59E0B" },
  도배: { bg: "D9F99D", line: "65A30D" },
  마루: { bg: "F5F5F4", line: "A8A29E" },
};
const toneOf = (group: string) => GROUP_ARGB[group] ?? GROUP_ARGB["마루"];
/** 흰 바탕에 opacity 만큼 — 화면 예정 막대(opacity-60)와 비슷하게 */
const fade = (hex: string, opacity: number) =>
  [0, 2, 4]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * opacity + 255 * (1 - opacity)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

export type FinishGanttExport = {
  gantt: FinishResponse["gantt"];
  plans: Map<number, FinishPlanRow[]>;
  month: string;
  asOf: string;
  framePours?: FramePours;
  finishSettings?: FinishPlanSettings;
  hideIdle: boolean;
};

export async function buildFinishWorkbook(x: FinishGanttExport, siteName: string): Promise<ExcelJS.Workbook> {
  const XL = (await import("exceljs")).default;
  const wb = new XL.Workbook();
  wb.creator = "스마트 공정표";
  const ws = wb.addWorksheet("마감 공정표", {
    pageSetup: { orientation: "landscape", paperSize: 8 as unknown as ExcelJS.PaperSize /* A3 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
  });

  const { from, to } = monthRange(x.month);
  const days = dateRange(from, to).map((d) => getDayInfo(CALENDAR, d));
  const n = days.length;
  const col = (i: number) => 3 + i; // A = 동·공종, B = 코어·%, C.. = 날짜
  const lastCol = col(n - 1);
  const [y, m] = x.month.split("-");
  const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${argb}` } });
  const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb: `FF${argb}` } });
  const SUNDAY = "F1F5F9";
  const GRID = "E2E8F0";

  ws.getColumn(1).width = 13;
  ws.getColumn(2).width = 8;
  for (let i = 0; i < n; i++) ws.getColumn(col(i)).width = 4.6;

  // 1~2행 제목·설명
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${siteName}  ${y}년 ${Number(m)}월 마감 공정표`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value =
    `${x.asOf} 기준. ✓ = 스마트웍스 세대 완료(완료일에 끝, 시작은 앞 완료 다음 날로 추정), 흐린 기울임 = 예정(선행·간격·층 묶음 규칙). 상자 안 = 층.` +
    (x.hideIdle ? " 이 달 작업 없는 공종은 뺐습니다." : "");
  ws.getCell(2, 1).font = { size: 9, color: { argb: "FF64748B" } };

  // 3행 요일, 4행 날짜
  ws.getCell(4, 1).value = `${Number(m)}월`;
  ws.getCell(4, 1).font = { bold: true };
  days.forEach((d, i) => {
    const red = d.isSunday || d.isHoliday;
    const w = ws.getCell(3, col(i));
    w.value = WEEK[d.dayOfWeek];
    w.font = { size: 8, color: { argb: red ? "FFDC2626" : d.isSaturday ? "FF0284C7" : "FF64748B" } };
    w.alignment = { horizontal: "center" };
    const c = ws.getCell(4, col(i));
    c.value = Number(d.date.slice(8));
    c.alignment = { horizontal: "center" };
    if (d.date === x.asOf) {
      c.fill = fill("1D4ED8");
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    } else {
      c.font = { bold: red, color: { argb: red ? "FFDC2626" : "FF0F172A" } };
      if (d.isSunday) c.fill = fill(SUNDAY);
    }
    if (d.isSunday) w.fill = fill(SUNDAY);
    c.border = { bottom: thin("94A3B8") };
  });

  /** 줄 하나의 날짜 칸 바탕(일요일)·세로줄 */
  const paintDays = (row: number) => {
    days.forEach((d, i) => {
      const c = ws.getCell(row, col(i));
      if (d.isSunday) c.fill = fill(SUNDAY);
      c.border = { right: thin(GRID), bottom: thin(GRID) };
    });
  };
  /** 막대: start~end 를 이 달 칸으로 잘라 병합. 없으면 false */
  const bar = (row: number, start: string, end: string, text: string, style: { bg: string; line: string; font: string; italic?: boolean; bold?: boolean }) => {
    if (end < from || start > to) return false;
    const s = start < from ? 0 : days.findIndex((d) => d.date === start);
    const e = end > to ? n - 1 : days.findIndex((d) => d.date === end);
    if (s < 0 || e < 0) return false;
    if (e > s) ws.mergeCells(row, col(s), row, col(e));
    for (let i = s; i <= e; i++) {
      const c = ws.getCell(row, col(i));
      c.fill = fill(style.bg);
      c.border = { top: thin(style.line), bottom: thin(style.line), left: i === s ? thin(style.line) : undefined, right: i === e ? thin(style.line) : undefined };
    }
    const c = ws.getCell(row, col(s));
    c.value = text;
    c.font = { size: 8, italic: style.italic, bold: style.bold, color: { argb: `FF${style.font}` } };
    c.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
    return true;
  };

  let r = 5;
  for (const b of x.gantt.buildings) {
    // 동 이름 줄
    ws.getCell(r, 1).value = b.name;
    ws.getCell(r, 1).font = { bold: true, size: 11 };
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).fill = fill("E2E8F0");
      ws.getCell(r, c).border = { top: thin("94A3B8") };
    }
    r++;

    // 골조 S타설 줄
    if (x.framePours) {
      const pours = x.framePours.get(b.buildingNo) ?? [];
      const done = pours.filter((p) => !p.planned).map((p) => p.floor);
      ws.mergeCells(r, 1, r, 2);
      ws.getCell(r, 1).value = `골조 S타설${done.length ? ` (현재 ${Math.max(...done)}F)` : ""}`;
      ws.getCell(r, 1).font = { size: 9, color: { argb: "FF334155" } };
      paintDays(r);
      for (const p of pours) bar(r, p.date, p.date, `${p.floor}F`, p.planned ? { bg: "94A3B8", line: "64748B", font: "FFFFFF" } : { bg: "334155", line: "1E293B", font: "FFFFFF", bold: true });
      r++;
    }

    const { rows, allRows, cored } = finishRowsOf(b, x.plans, x.finishSettings, { from, to }, x.hideIdle);
    if (!rows.length) {
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = allRows ? "이 달에는 이 동의 마감 작업이 없습니다." : "이 동은 아직 해당 공종 마감 기록이 없습니다.";
      ws.getCell(r, 1).font = { size: 9, color: { argb: "FF64748B" } };
      r++;
      continue;
    }
    let tradeStart = r;
    rows.forEach((row, i) => {
      const tone = toneOf(row.trade.group);
      // 실적과 예정을 한 번에 칸 나누기 — 겹치면 아래 칸
      const bars = [
        ...row.done.map((d) => ({ start: d.start, end: d.end, kind: "done" as const, d })),
        ...row.plan.map((p) => ({ start: p.start, end: p.end, kind: "plan" as const, p })),
      ].filter((v) => !(v.end < from || v.start > to));
      const lanes = stackLanes(bars);
      const count = Math.max(1, lanes.count);
      for (let k = 0; k < count; k++) paintDays(r + k);
      bars.forEach((v, j) => {
        const row2 = r + lanes.laneOf[j];
        if (v.kind === "done") {
          const fu = v.d.floorUnits ?? [];
          const label = fu.length ? floorListText([...new Set(fu.map((f) => f.floor))].sort((p, q) => p - q)) : floorRangeText(v.d.floorFrom, v.d.floorTo);
          bar(row2, v.start, v.end, `✓${label}`, { bg: tone.bg, line: tone.line, font: "0F172A" });
        } else {
          bar(row2, v.start, v.end, floorRangeText(v.p.floorFrom, v.p.floorTo), { bg: fade(tone.bg, 0.6), line: fade(tone.line, 0.6), font: "475569", italic: true });
        }
      });
      // 왼쪽 칸: 코어 없는 동은 A = 공종, B = %. 코어 동은 A = 공종(코어 줄 합침), B = N코어 %
      const pct = row.sw?.total ? `${Math.round((row.sw.done / row.sw.total) * 100)}%` : "";
      if (count > 1) ws.mergeCells(r, 2, r + count - 1, 2);
      ws.getCell(r, 2).value = row.core != null ? `${row.core}코어 ${pct}`.trim() : pct;
      ws.getCell(r, 2).font = { size: 8, color: { argb: "FF64748B" } };
      ws.getCell(r, 2).alignment = { horizontal: "right", vertical: "middle" };
      const next = rows[i + 1];
      const groupEnds = !cored || !next || next.trade.key !== row.trade.key;
      if (groupEnds) {
        const end = r + count - 1;
        if (end > tradeStart) ws.mergeCells(tradeStart, 1, end, 1);
        ws.getCell(tradeStart, 1).value = row.trade.label;
        ws.getCell(tradeStart, 1).font = { size: 9 };
        ws.getCell(tradeStart, 1).alignment = { vertical: "middle", wrapText: true };
        for (let k = tradeStart; k <= end; k++) ws.getCell(k, 1).border = { bottom: k === end ? thin(GRID) : undefined };
        tradeStart = end + 1;
      }
      r += count;
    });
  }
  for (let i = 5; i < r; i++) if (!ws.getRow(i).height) ws.getRow(i).height = 18;
  return wb;
}

export async function exportFinishXlsx(x: FinishGanttExport, siteName: string): Promise<void> {
  const wb = await buildFinishWorkbook(x, siteName);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${siteName}_${x.month}_마감공정표.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
