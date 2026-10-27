/**
 * 단열재 자재 발주의뢰서 — 실행예산 내역서를 올리고, 단열 Layout 산출과 맞춰 본 뒤 양식으로 내보낸다.
 *
 * 흐름: ① 실행예산 통합 문서(2-2 건축(기) · 11-3 건축(확+옵) 시트가 든 xlsx) 업로드
 *       ② 지급자재 단열재 품목이 자동으로 잡히고, 세대 외벽 품목(09.내장목공사)은 Layout 두께별 물량으로
 *          겹 세분화(T150 → T95 + T55) 제안 — 줄마다 켜고 끄고 수량을 고칠 수 있다
 *       ③ 회사 양식(표지 · 자재청구서 · 발주수량 검토 + 내역서 2장)으로 내려받기
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ExcelJS from "exceljs";
import { FileSpreadsheet, Upload, X, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildInsulBudget, type InsulBudget } from "./budgetParser.ts";
import {
  effectiveRows,
  proposeOrderLines,
  sumLines,
  type LayoutTotals,
  type OrderLine,
  type OrderPreset,
} from "./orderLines.ts";
import { generateInsulOrderForm, loadBudgetWorkbook } from "./insulOrderForm.ts";
import type { SiteReport } from "./siteReport.ts";

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function InsulOrderDialog({
  open,
  onClose,
  defaultSiteName,
  totals,
  presets,
  siteReport,
  boardSpec,
}: {
  open: boolean;
  onClose: () => void;
  /** 프로젝트 이름 — 표지·제목의 [현장명] 기본값 */
  defaultSiteName: string;
  /** 단열 Layout 현장 합계 (노출·겹별) */
  totals: LayoutTotals;
  presets: OrderPreset[];
  /** 현장산출서 — 있으면 맨 뒤에 「현장산출검토」 시트로 붙는다 */
  siteReport: SiteReport | null;
  boardSpec: { boardLength: number; boardHeight: number };
}) {
  const [siteName, setSiteName] = useState(defaultSiteName);
  const [fileName, setFileName] = useState<string | null>(null);
  const [budget, setBudget] = useState<InsulBudget | null>(null);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSiteName((s) => s || defaultSiteName);
  }, [open, defaultSiteName]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.xlsx$/i.test(file.name)) {
        toast.error("엑셀(.xlsx) 파일만 올릴 수 있습니다.");
        return;
      }
      setLoading(true);
      try {
        const { workbook: wb, grids } = await loadBudgetWorkbook(await file.arrayBuffer());
        const b = buildInsulBudget(grids);
        if (!b.baseSheet && !b.extSheet)
          throw new Error("내역서 시트를 찾지 못했습니다 — 시트 이름에 '건축(기)' 또는 '건축(확' 이 있어야 합니다.");
        if (b.items.length === 0)
          throw new Error("내역서에서 품명이 '단열재' 인 지급자재 줄을 찾지 못했습니다.");
        setWorkbook(wb);
        setBudget(b);
        setLines(proposeOrderLines(b, totals, presets));
        setFileName(file.name);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "내역서를 읽지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [totals, presets],
  );

  const updateLine = (idx: number, patch: (l: OrderLine) => OrderLine) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? patch(l) : l)));

  const updateRow = (idx: number, rowIdx: number, key: "orderBase" | "orderExt", value: number) =>
    updateLine(idx, (l) => {
      const rows = l.useLayout && l.layoutRows.length > 0 ? [...l.layoutRows] : [{ ...l.budgetRow }];
      rows[rowIdx] = { ...rows[rowIdx], [key]: value };
      return l.useLayout && l.layoutRows.length > 0 ? { ...l, layoutRows: rows } : { ...l, budgetRow: rows[0] };
    });

  const sums = useMemo(() => sumLines(lines), [lines]);
  const layoutLabel = useMemo(
    () =>
      totals.plies
        .map((p) => {
          const preset = presets.find((x) => x.exposure === p.exposure);
          return `${preset?.label ?? p.exposure} ${p.ply}P ${p.thickness}T ${fmt(p.areaM2)}㎡`;
        })
        .join(" · "),
    [totals, presets],
  );

  const handleExport = async () => {
    if (!budget || !workbook) return;
    setExporting(true);
    try {
      const warn = await generateInsulOrderForm({
        siteName,
        budgetWorkbook: workbook,
        budget,
        lines,
        siteReport: siteReport ?? undefined,
        boardSpec,
      });
      toast.success("단열재 자재 발주의뢰서를 내려받았습니다.", {
        description:
          warn.length > 0
            ? warn.join(" · ")
            : `표지 · 자재청구서 · 발주수량 검토 + 내역서 2장${siteReport ? " + 현장산출검토" : ""}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "발주의뢰서 생성에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-[16px] font-bold text-slate-800">
            단열재 자재 발주의뢰서
            <span className="ml-2 text-[13px] font-medium text-slate-500">회사 표준 양식으로 내보내기</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            title="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[13.5px]">
          {/* ① 현장명 · 내역서 업로드 */}
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-bold uppercase tracking-wide text-slate-400">현장명</span>
              <input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="예) 부산장안"
                className="h-9 w-full rounded-md border border-slate-300 px-3 outline-none focus:border-[#004791]"
              />
            </label>
            <div>
              <span className="mb-1 block text-[12.5px] font-bold uppercase tracking-wide text-slate-400">
                실행예산 내역서 (2-2 건축(기) · 11-3 건축(확+옵) 시트가 든 xlsx)
              </span>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-slate-600 hover:border-[#004791] hover:bg-slate-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="truncate">
                  {fileName ?? "여기에 끌어다 놓거나 클릭해서 선택"}
                </span>
                {budget && (
                  <span className="ml-auto shrink-0 text-[12px] text-slate-500">
                    기본 {budget.baseSheet ? "✓" : "—"} · 확장 {budget.extSheet ? "✓" : "—"} · 단열재 {budget.items.length}품목
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Layout 합계 */}
          <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
            <span className="font-bold text-slate-700">단열 Layout 현장 합계</span>
            {totals.plies.length === 0 ? (
              <span className="ml-2 text-amber-700">
                산출된 물량이 없습니다 — 동·타입 설정에서 세대수를 넣고 입면에 타입을 지정하면 겹별 물량이 잡힙니다.
              </span>
            ) : (
              <span className="ml-2">
                세대수 {fmt(totals.units)} · {layoutLabel}
              </span>
            )}
          </div>

          {/* ② 품목 표 */}
          {budget && (
            <table className="mt-4 w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-100 text-left text-[12px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">공종</th>
                  <th className="px-2 py-2">예산 규격</th>
                  <th className="px-2 py-2 text-right">가실행 기본</th>
                  <th className="px-2 py-2 text-right">확장</th>
                  <th className="px-2 py-2 text-right">합계</th>
                  <th className="px-2 py-2 text-center">Layout 적용</th>
                  <th className="px-2 py-2">발주 규격</th>
                  <th className="px-2 py-2 text-right">발주 기본</th>
                  <th className="px-2 py-2 text-right">확장</th>
                  <th className="px-2 py-2 text-right">증감</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const rows = effectiveRows(l);
                  const budgetTotal = l.item.baseQty + l.item.extQty;
                  const canLayout = !!l.preset && l.layoutRows.length > 0;
                  return rows.map((r, ri) => (
                    <tr key={`${l.item.key}-${ri}`} className="border-b border-slate-100 align-middle">
                      {ri === 0 && (
                        <>
                          <td rowSpan={rows.length} className="px-2 py-1.5 font-medium text-slate-700">
                            {l.item.section}
                          </td>
                          <td rowSpan={rows.length} className="px-2 py-1.5 text-slate-700">
                            {l.item.spec}
                          </td>
                          <td rowSpan={rows.length} className="px-2 py-1.5 text-right tabular-nums">
                            {fmt(l.item.baseQty)}
                          </td>
                          <td rowSpan={rows.length} className="px-2 py-1.5 text-right tabular-nums">
                            {fmt(l.item.extQty)}
                          </td>
                          <td rowSpan={rows.length} className="px-2 py-1.5 text-right font-medium tabular-nums">
                            {fmt(budgetTotal)}
                          </td>
                          <td rowSpan={rows.length} className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              className="accent-[#004791]"
                              checked={l.useLayout}
                              disabled={!canLayout}
                              onChange={(e) => updateLine(idx, (x) => ({ ...x, useLayout: e.target.checked }))}
                              title={
                                canLayout
                                  ? `${l.preset!.label} (${l.preset!.ply1}+${l.preset!.ply2}T) 겹별 세분화`
                                  : "두께 합이 맞는 노출 프리셋이 없어 예산 그대로 발주합니다"
                              }
                            />
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-slate-700">{r.spec}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          value={r.orderBase}
                          onChange={(e) => updateRow(idx, ri, "orderBase", Number(e.target.value) || 0)}
                          className="h-7 w-24 rounded border border-slate-200 px-1 text-right tabular-nums focus:border-[#004791]"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          value={r.orderExt}
                          onChange={(e) => updateRow(idx, ri, "orderExt", Number(e.target.value) || 0)}
                          className="h-7 w-20 rounded border border-slate-200 px-1 text-right tabular-nums focus:border-[#004791]"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                        {ri === 0 ? fmt(r.orderBase + r.orderExt - budgetTotal) : fmt(r.orderBase + r.orderExt)}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
          {!budget && !loading && (
            <div className="mt-8 flex flex-col items-center gap-2 py-10 text-slate-400">
              <FileSpreadsheet className="h-8 w-8" />
              <p>실행예산 내역서를 올리면 지급자재 단열재 품목이 여기에 나타납니다.</p>
              <p className="text-[12px]">
                세대 외벽(09.내장목공사) 품목은 Layout 겹별 물량(예: T150 → T95 + T55)으로 자동 세분화됩니다.
              </p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <div className="text-[12.5px] text-slate-500">
            {budget ? (
              <>
                가실행 합계 <b className="text-slate-700">{fmt(sums.budget)}㎡</b> · 발주 합계{" "}
                <b className="text-slate-700">{fmt(sums.order)}㎡</b> · Layout 산출 줄은 기본 칸에 넣고 확장은 0 으로 둡니다 — 엑셀에서 나눠 적을 수 있습니다
              </>
            ) : (
              "내려받은 파일은 열 때 수식이 다시 계산됩니다."
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={!budget || exporting}
              className="gap-1 bg-[#004791] hover:bg-[#003a78]"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              발주의뢰서 내려받기
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
