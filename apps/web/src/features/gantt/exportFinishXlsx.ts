/**
 * 마감 공정표 엑셀 저장 (2026-10-30). 「요약」 시트(전체 동 × 공종) + 동마다 「진척표」 시트(층 × 공종, 칸 = 완료 세대 수, 색 = 완료 비율).
 * exceljs 는 누를 때 불러온다. 화면(FinishPanel)과 같은 기준.
 */
import type ExcelJS from "exceljs";
import type { FinishResponse, FinishStat } from "./api";

const STATUS: Record<FinishStat["status"], string> = { done: "완료", progress: "진행", stalled: "정체", blocked: "선행 대기", idle: "시작 전" };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const tone = (done: number, units: number) =>
  !units ? null : done >= units ? "FF10B981" : done === 0 ? null : done / units >= 0.5 ? "FFA7F3D0" : "FFFEF3C7";

export async function buildFinishWorkbook(d: FinishResponse, siteName: string): Promise<ExcelJS.Workbook> {
  const XL = (await import("exceljs")).default;
  const wb = new XL.Workbook();
  wb.creator = "스마트 공정표";
  const typeName = new Map(d.types.map((t) => [t.id, t.name]));

  // 요약 시트
  const sum = wb.addWorksheet("요약", { views: [{ state: "frozen", ySplit: 2 }] });
  sum.mergeCells(1, 1, 1, 10);
  sum.getCell(1, 1).value = `${siteName}  마감 공정표 (${d.asOf} 기준, 스마트웍스 옵션마감 세대별 완료 기록)`;
  sum.getCell(1, 1).font = { bold: true, size: 13 };
  const head = ["동", "공종", "상태", "완료 세대", "전체 세대", "완료율", "선두층", "후미층", "최근 완료", "주당(최근 4주)", "예상 완료"];
  sum.addRow([]);
  sum.getRow(2).values = head;
  sum.getRow(2).font = { bold: true };
  for (const b of d.buildings)
    for (const s of b.stats)
      sum.addRow([
        b.name,
        typeName.get(s.typeId) ?? s.typeId,
        STATUS[s.status],
        s.done,
        s.total,
        s.total ? Math.round((s.done / s.total) * 100) / 100 : 0,
        s.lead != null ? `${s.lead}F` : "",
        s.tail != null ? `${s.tail}F` : "",
        s.last ?? "",
        s.perWeek,
        s.status === "done" ? `완료 ${s.last ?? ""}` : s.forecast ?? (s.blockedBy ? `미정 (선행 ${typeName.get(s.blockedBy)} 정체)` : s.status === "idle" ? "" : "정체"),
      ]);
  sum.getColumn(6).numFmt = "0%";
  [8, 24, 9, 9, 9, 7, 7, 7, 11, 12, 28].forEach((w, i) => (sum.getColumn(i + 1).width = w));
  sum.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: head.length } };

  // 동별 진척표 시트
  for (const b of d.buildings) {
    const ws = wb.addWorksheet(b.name.slice(0, 28), {
      views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
      pageSetup: { orientation: "landscape", paperSize: 8 as unknown as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    });
    ws.mergeCells(1, 1, 1, 2 + d.types.length);
    ws.getCell(1, 1).value = `${siteName} ${b.name} 마감 진척표 — 칸 = 그 층 완료 세대 수 (${d.asOf} 기준)`;
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).value = "층";
    ws.getCell(2, 2).value = "세대";
    d.types.forEach((t, i) => {
      const c = ws.getCell(2, 3 + i);
      c.value = t.name;
      c.alignment = { textRotation: 90, vertical: "bottom", horizontal: "center" };
      c.font = { size: 9 };
    });
    ws.getRow(2).height = 110;
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 5;
    for (let i = 0; i < d.types.length; i++) ws.getColumn(3 + i).width = 4.2;
    const cell = new Map(b.cells.map((c) => [`${c.typeId}|${c.floor}`, c]));
    b.floors.forEach((f, r) => {
      const row = 3 + r;
      ws.getCell(row, 1).value = f.floor < 0 ? `B${-f.floor}F` : `${f.floor}F`;
      ws.getCell(row, 2).value = f.units;
      d.types.forEach((t, i) => {
        const c = cell.get(`${t.id}|${f.floor}`);
        const done = c?.done ?? 0;
        const x = ws.getCell(row, 3 + i);
        x.value = done >= f.units ? "✓" : done || null;
        x.alignment = { horizontal: "center" };
        x.font = { size: 9, color: { argb: done >= f.units ? "FFFFFFFF" : "FF0F172A" } };
        const tn = tone(done, f.units);
        if (tn) x.fill = fill(tn);
        x.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
      });
    });
  }
  return wb;
}

export async function exportFinishXlsx(d: FinishResponse, siteName: string): Promise<void> {
  const wb = await buildFinishWorkbook(d, siteName);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${siteName}_마감공정표_${d.asOf}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
