/**
 * 공정표 엑셀 저장 (공정표 탭 「엑셀」 버튼, 2026-10-30). 화면 간트와 같은 규칙으로 그린다.
 * - 「공정표」 시트: 날짜마다 오전·오후 2칸. 같은 작업이면 2칸 병합. 공종 글자·색, 층 라벨 줄, 유휴 줄(이달 몇 번째), 타설 없음 줄.
 *   실적(작업일보, asOf 까지)은 보통 글씨, 예정(엔진)은 기울임. 일요일 회색, 공휴일 빨간 날짜. A3 가로 인쇄 설정.
 * - 「목록」 시트: 날짜·동·실적/예정·반일·층·공종 한 줄씩 (거르기·피벗용).
 * exceljs 는 무거워서 누를 때 불러온다.
 */
import type ExcelJS from "exceljs";
import type { ActualWork, Assignment, Stage } from "@ipg/gantt-engine";
import type { GanttData } from "./components/GanttChart";
import { GROUP_FILL, GROUP_LABEL, STAGE_GROUP, STAGE_INDEX, STAGE_TEXT, STAGE_TITLE, actualFloorText, floorLabel, isPour, type Group } from "./ganttLabels";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const IDLE_TEAMS: { label: string; group: Group; stages: Stage[] }[] = [
  { label: "갱폼 유휴", group: "gangform", stages: ["GANGFORM"] },
  { label: "철근 유휴", group: "rebar", stages: ["WALL_REBAR", "SLAB_REBAR"] },
  { label: "알폼 유휴", group: "alform", stages: ["ALFORM"] },
];

const isRoofForm = (a: { stage: Stage; roof?: number }) => a.stage === "ALFORM" && a.roof != null;
const planText = (a: Assignment) => (isRoofForm(a) ? "거푸집" : STAGE_TEXT[a.stage]);
const planTitle = (a: Assignment) => (isRoofForm(a) ? "거푸집(옥탑)" : STAGE_TITLE[a.stage]);

type Cell = { text: string; group: Group; planned: boolean };

/** 엑셀 저장: 통합문서를 만들어 내려받는다 */
export async function exportGanttXlsx(data: GanttData, siteName: string, month: string): Promise<void> {
  const wb = await buildGanttWorkbook(data, siteName, month);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${siteName}_${month}_공정표.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 통합문서 만들기 (브라우저 밖에서도 돈다 — 검증용) */
export async function buildGanttWorkbook(data: GanttData, siteName: string, month: string): Promise<ExcelJS.Workbook> {
  const XL = (await import("exceljs")).default;
  const wb = new XL.Workbook();
  wb.creator = "스마트 공정표";
  const ws = wb.addWorksheet("공정표", {
    pageSetup: { orientation: "landscape", paperSize: 8 as unknown as ExcelJS.PaperSize /* A3 — exceljs 타입 목록에 없지만 엑셀 용지 번호 8 = A3 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });

  const days = data.days;
  const asOf = data.asOf ?? null;
  const isActualDay = (date: string) => asOf !== null && date <= asOf;
  const labelOf = new Map((data.buildings ?? []).map((b) => [b.id, b.label]));
  const label = (id: number) => labelOf.get(id) ?? `${id}동`;
  const col = (dayIdx: number, half: 0 | 1) => 2 + dayIdx * 2 + half; // A = 동, B.. = 날짜(오전·오후)
  const lastCol = col(days.length - 1, 1);
  const [y, m] = month.split("-");

  // 열 너비
  ws.getColumn(1).width = 11;
  for (let c = 2; c <= lastCol; c++) ws.getColumn(c).width = 3.6;

  const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });
  const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const SUNDAY = "FFF1F5F9";
  const dayBg = (i: number) => (days[i].isSunday ? SUNDAY : undefined);
  const planStartIdx = asOf ? days.findIndex((d) => d.date > asOf) : -1;

  // 1~2행: 제목·설명
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${siteName}  ${y}년 ${Number(m)}월 공정표`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = asOf
    ? `작업일보 실적 ${asOf} 까지(보통 글씨), 이후 엔진 예정(기울임). 칸 왼쪽 오전 · 오른쪽 오후.`
    : "엔진 예정(기울임). 칸 왼쪽 오전 · 오른쪽 오후.";
  ws.getCell(2, 1).font = { size: 9, color: { argb: "FF64748B" } };

  // 3행 요일, 4행 날짜 (2칸 병합)
  ws.getCell(3, 1).value = "";
  ws.getCell(4, 1).value = `${Number(m)}월`;
  ws.getCell(4, 1).font = { bold: true };
  days.forEach((d, i) => {
    const c = col(i, 0);
    ws.mergeCells(3, c, 3, c + 1);
    ws.mergeCells(4, c, 4, c + 1);
    const w = ws.getCell(3, c);
    w.value = d.isSunday || d.isSaturday || d.isHoliday ? WEEK[d.dayOfWeek] : "";
    w.font = { size: 8, color: { argb: d.isSunday || d.isHoliday ? "FFDC2626" : d.isSaturday ? "FF0284C7" : "FF64748B" } };
    w.alignment = { horizontal: "center" };
    const n = ws.getCell(4, c);
    n.value = Number(d.date.slice(8));
    n.font = { bold: d.isSunday || d.isHoliday, color: { argb: d.isSunday || d.isHoliday ? "FFDC2626" : "FF0F172A" } };
    n.alignment = { horizontal: "center" };
    n.border = { bottom: thin("FF94A3B8") };
    if (dayBg(i)) [w, n].forEach((x) => (x.fill = fill(dayBg(i)!)));
  });

  // 데이터 색인
  const plan = new Map<string, Assignment>();
  for (const a of data.assignments) plan.set(`${a.date}|${a.half}|${a.buildingId}`, a);
  const actualBy = new Map<string, ActualWork[]>();
  for (const w of data.actual ?? []) actualBy.set(`${w.date}|${w.buildingId}`, [...(actualBy.get(`${w.date}|${w.buildingId}`) ?? []), w]);

  // 층 라벨: 실적은 사이클 층이 처음 올라간 날, 예정은 먹매김 날·새 층 첫날 (화면과 같은 규칙)
  const storyLabel = new Map<string, string>();
  for (const id of data.buildingIds) {
    let maxSeen = -Infinity;
    for (const d of days) {
      if (!isActualDay(d.date)) continue;
      const num = (actualBy.get(`${d.date}|${id}`) ?? []).filter((w) => w.floorLabel == null);
      if (!num.length) continue;
      const top = num.reduce((a, b) => (b.floor > a.floor ? b : a));
      if (top.floor > maxSeen) {
        storyLabel.set(`${d.date}|${id}`, actualFloorText(top));
        maxSeen = top.floor;
      }
    }
    const seen = new Set<string>();
    for (const a of data.assignments.filter((x) => x.buildingId === id).sort((p, q) => p.date.localeCompare(q.date) || p.half.localeCompare(q.half))) {
      if (isActualDay(a.date)) continue;
      const k = `${a.floor}|${a.roof ?? 0}`;
      if (a.stage === "MARK" || !seen.has(k)) storyLabel.set(`${a.date}|${id}`, storyLabel.get(`${a.date}|${id}`) ?? floorLabel(a));
      seen.add(k);
    }
  }

  // 칸 그리기
  const paint = (row: number, c1: number, c2: number, cell: Cell) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2);
    const x = ws.getCell(row, c1);
    const f = GROUP_FILL[cell.group];
    x.value = cell.text;
    x.font = { size: 8, italic: cell.planned, color: { argb: cell.planned ? "FF475569" : "FF0F172A" } };
    x.alignment = { horizontal: "center", vertical: "middle", wrapText: true, shrinkToFit: false };
    x.fill = fill(`FF${f.bg}`);
    const b = thin(`FF${f.border}`);
    x.border = { top: b, bottom: b, left: b, right: b };
  };

  let row = 5;
  const list: (string | number)[][] = [];
  for (const id of data.buildingIds) {
    // 층 라벨 줄
    const fr = ws.getRow(row);
    fr.height = 11;
    fr.getCell(1).value = "";
    days.forEach((d, i) => {
      const c = col(i, 0);
      const t = storyLabel.get(`${d.date}|${id}`);
      if (t) {
        ws.mergeCells(row, c, row, c + 1);
        ws.getCell(row, c).value = t;
        ws.getCell(row, c).font = { size: 7, color: { argb: "FF64748B" } };
      }
      if (dayBg(i)) [c, c + 1].forEach((cc) => (ws.getCell(row, cc).fill = fill(dayBg(i)!)));
    });
    row++;
    // 작업 줄
    const r = ws.getRow(row);
    r.height = 30;
    r.getCell(1).value = label(id);
    r.getCell(1).font = { bold: true };
    r.getCell(1).alignment = { vertical: "middle" };
    days.forEach((d, i) => {
      const c = col(i, 0);
      if (dayBg(i)) [c, c + 1].forEach((cc) => (ws.getCell(row, cc).fill = fill(dayBg(i)!)));
      if (i === planStartIdx) ws.getCell(row, c).border = { left: { style: "medium", color: { argb: "FF2563EB" } } };
      if (isActualDay(d.date)) {
        const works = actualBy.get(`${d.date}|${id}`) ?? [];
        if (!works.length) return;
        // 같은 공종은 한 칸(높은 층), 사이클 순서로
        const byStage = new Map<Stage, ActualWork>();
        for (const w of works) if (!byStage.has(w.stage) || w.floor > byStage.get(w.stage)!.floor) byStage.set(w.stage, w);
        const sorted = [...byStage.values()].sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage]);
        for (const w of sorted) list.push([d.date, WEEK[d.dayOfWeek], label(id), "실적", "하루", actualFloorText(w), STAGE_TITLE[w.stage]]);
        if (sorted.length === 2) {
          paint(row, c, c, { text: STAGE_TEXT[sorted[0].stage], group: STAGE_GROUP[sorted[0].stage], planned: false });
          paint(row, c + 1, c + 1, { text: STAGE_TEXT[sorted[1].stage], group: STAGE_GROUP[sorted[1].stage], planned: false });
        } else {
          paint(row, c, c + 1, { text: sorted.map((w) => STAGE_TEXT[w.stage]).join("·"), group: STAGE_GROUP[sorted[0].stage], planned: false });
        }
        return;
      }
      const am = plan.get(`${d.date}|AM|${id}`);
      const pm = plan.get(`${d.date}|PM|${id}`);
      for (const [a, h] of [[am, "오전"], [pm, "오후"]] as const)
        if (a) list.push([d.date, WEEK[d.dayOfWeek], label(id), "예정", h, floorLabel(a), planTitle(a)]);
      if (am && (!pm || pm.stage === am.stage) && (pm || isPour(am.stage))) {
        paint(row, c, c + 1, { text: planText(am), group: STAGE_GROUP[am.stage], planned: true });
      } else {
        if (am) paint(row, c, c, { text: planText(am), group: STAGE_GROUP[am.stage], planned: true });
        if (pm) paint(row, c + 1, c + 1, { text: planText(pm), group: STAGE_GROUP[pm.stage], planned: true });
      }
    });
    row++;
  }

  // 유휴 줄 (화면과 같은 규칙: 그달 그 팀 작업이 없는 날, 일요일·공휴일 포함. 그달 작업이 하루도 없는 팀은 뺀다)
  row++;
  const teamBusy = (date: string, stages: Stage[]) =>
    isActualDay(date)
      ? (data.actual ?? []).some((a) => a.date === date && stages.includes(a.stage))
      : data.assignments.some((a) => a.date === date && stages.includes(a.stage));
  for (const team of IDLE_TEAMS) {
    const idle = days.filter((d) => !teamBusy(d.date, team.stages)).map((d) => d.date);
    if (idle.length === days.length) continue;
    const nth = new Map(idle.map((d, i) => [d, i + 1]));
    ws.getCell(row, 1).value = `${team.label} ${idle.length}일`;
    ws.getCell(row, 1).font = { size: 9, color: { argb: "FF475569" } };
    days.forEach((d, i) => {
      const n = nth.get(d.date);
      if (n != null) paint(row, col(i, 0), col(i, 1), { text: String(n), group: team.group, planned: false });
      else if (dayBg(i)) [col(i, 0), col(i, 1)].forEach((cc) => (ws.getCell(row, cc).fill = fill(dayBg(i)!)));
    });
    ws.getRow(row).height = 16;
    row++;
  }
  // 타설 없음 줄
  const pourDates = new Set([
    ...data.assignments.filter((a) => isPour(a.stage)).map((a) => a.date),
    ...(data.actual ?? []).filter((a) => isPour(a.stage)).map((a) => a.date),
  ]);
  ws.getCell(row, 1).value = "타설 없음";
  ws.getCell(row, 1).font = { size: 9, color: { argb: "FF475569" } };
  days.forEach((d, i) => {
    const c = col(i, 0);
    if (d.isSunday) {
      [c, c + 1].forEach((cc) => (ws.getCell(row, cc).fill = fill(SUNDAY)));
    } else if (!d.pourAllowed) {
      ws.mergeCells(row, c, row, c + 1);
      ws.getCell(row, c).value = "불가";
      ws.getCell(row, c).font = { size: 7, color: { argb: "FF94A3B8" } };
      ws.getCell(row, c).alignment = { horizontal: "center" };
    } else if (!pourDates.has(d.date)) {
      paint(row, c, c + 1, { text: "", group: "pour", planned: false });
    }
  });
  ws.getRow(row).height = 16;
  row += 2;

  // 범례
  ws.getCell(row, 1).value = "범례";
  ws.getCell(row, 1).font = { bold: true, size: 9 };
  let c = 2;
  for (const g of Object.keys(GROUP_LABEL) as Group[]) {
    ws.mergeCells(row, c, row, c + 5);
    paint(row, c, c, { text: GROUP_LABEL[g], group: g, planned: false });
    c += 7;
    if (c + 5 > lastCol) {
      row++;
      c = 2;
    }
  }

  // 목록 시트
  const ls = wb.addWorksheet("목록", { views: [{ state: "frozen", ySplit: 1 }] });
  ls.columns = [
    { header: "날짜", key: "d", width: 12 },
    { header: "요일", key: "w", width: 5 },
    { header: "동", key: "b", width: 10 },
    { header: "구분", key: "k", width: 6 },
    { header: "반일", key: "h", width: 6 },
    { header: "층", key: "f", width: 7 },
    { header: "공종", key: "s", width: 24 },
  ];
  ls.getRow(1).font = { bold: true };
  list.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
  for (const r of list) ls.addRow(r);
  ls.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

  return wb;
}
