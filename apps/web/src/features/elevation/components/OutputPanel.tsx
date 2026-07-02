/**
 * 입면도 생성기 — Output(통합 산출) 패널 (오버레이)
 *
 * 좌측 SCOPE 트리(현장 ▸ 동 ▸ 코어 ▸ 입면, 체크박스 선택) + 우측 선택범위 통합 물량표.
 * 다운로드: 통합 XLSX + 선택 입면 통합 DXF(ZIP).
 */

import { useMemo, useState } from "react";
import { X, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildScopeTree,
  mergeForSelected,
  type WallSummaryInput,
} from "../utils/elevationAggregate";
import {
  buildQuantityXlsx,
  downloadOutputZip,
  downloadXlsx,
} from "../utils/exportBundle";
import { toast } from "sonner";

export default function OutputPanel({
  items,
  base,
  buildDxf,
  onClose,
}: {
  items: WallSummaryInput[];
  base: string;
  /** 선택 입면 id → 통합 DXF 문자열(없으면 null) */
  buildDxf: (selectedIds: string[]) => string | null;
  onClose: () => void;
}) {
  const tree = useMemo(() => buildScopeTree(items), [items]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map(i => i.wallId))
  );

  const allIds = useMemo(() => items.map(i => i.wallId), [items]);
  const merged = useMemo(
    () => mergeForSelected(items, selected),
    [items, selected]
  );

  const toggle = (ids: string[], on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const allChecked = (ids: string[]) =>
    ids.length > 0 && ids.every(id => selected.has(id));

  const selectedCount = selected.size;
  const scopeLabel = `${tree.buildings.length}개 동 · ${items.filter(i => selected.has(i.wallId)).length}개 입면`;

  const handleZip = async () => {
    if (selectedCount === 0) {
      toast.error("선택된 입면이 없습니다.");
      return;
    }
    try {
      const xlsx = buildQuantityXlsx(merged, tree.buildings, scopeLabel);
      const dxf = buildDxf([...selected]);
      await downloadOutputZip({ base, xlsx, dxf });
      toast.success("ZIP 다운로드 시작");
    } catch (e) {
      toast.error(`다운로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const handleXlsx = () => {
    if (selectedCount === 0) {
      toast.error("선택된 입면이 없습니다.");
      return;
    }
    try {
      const xlsx = buildQuantityXlsx(merged, tree.buildings, scopeLabel);
      downloadXlsx(`${base}_통합산출서.xlsx`, xlsx);
    } catch (e) {
      toast.error(`다운로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
        <h2 className="text-[16px] font-bold text-slate-800">
          Output · 통합 물량 요약
          <span className="ml-2 text-[12px] font-medium text-slate-500">
            {scopeLabel}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleXlsx} className="gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5" /> XLSX
          </Button>
          <Button
            size="sm"
            onClick={handleZip}
            className="gap-1 bg-[#004791] hover:bg-[#003a78]"
          >
            <Download className="w-3.5 h-3.5" /> ZIP 다운로드
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 text-slate-500"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
        {/* SCOPE 트리 */}
        <div className="border-r border-slate-200 overflow-auto p-3 text-[13px]">
          <div className="text-[11px] font-bold tracking-wide text-slate-400 uppercase mb-2">
            산출 대상
          </div>
          <label className="flex items-center gap-2 font-bold text-slate-800 py-1">
            <input
              type="checkbox"
              checked={allChecked(allIds)}
              onChange={e => toggle(allIds, e.target.checked)}
              className="accent-[#004791]"
            />
            전체 현장
            <span className="ml-auto text-[11px] text-slate-400">
              {selectedCount}/{allIds.length}
            </span>
          </label>
          {tree.buildings.map(b => {
            const bIds = b.cores.flatMap(c => c.walls.map(w => w.wallId));
            return (
              <div key={b.building} className="ml-2 mt-1">
                <label className="flex items-center gap-2 font-semibold text-slate-700 py-0.5">
                  <input
                    type="checkbox"
                    checked={allChecked(bIds)}
                    onChange={e => toggle(bIds, e.target.checked)}
                    className="accent-[#004791]"
                  />
                  {b.building}
                </label>
                {b.cores.map(c => {
                  const cIds = c.walls.map(w => w.wallId);
                  return (
                    <div key={c.core} className="ml-4">
                      <label className="flex items-center gap-2 text-slate-600 py-0.5">
                        <input
                          type="checkbox"
                          checked={allChecked(cIds)}
                          onChange={e => toggle(cIds, e.target.checked)}
                          className="accent-[#004791]"
                        />
                        {c.core}
                        <span className="ml-auto text-[11px] text-slate-400">
                          {c.walls.length}개
                        </span>
                      </label>
                      {c.walls.map(w => (
                        <label
                          key={w.wallId}
                          className="ml-5 flex items-center gap-2 text-[12px] text-slate-500 py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(w.wallId)}
                            onChange={e => toggle([w.wallId], e.target.checked)}
                            className="accent-[#004791]"
                          />
                          {w.wallName}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* 통합 물량표 */}
        <div className="overflow-auto p-5">
          <div className="rounded-xl border border-slate-200 overflow-hidden max-w-3xl">
            <table className="w-full text-[14px] border-collapse">
              <thead>
                <tr className="bg-[#003F72] text-white text-center">
                  <th className="px-3 py-2 font-semibold">구분</th>
                  <th className="px-3 py-2 font-semibold">규격(가로×세로)</th>
                  <th className="px-3 py-2 font-semibold">수량(조각)</th>
                  <th className="px-3 py-2 font-semibold">면적(㎡)</th>
                </tr>
              </thead>
              <tbody>
                {merged.tallies.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      선택된 입면이 없거나 보드가 없습니다.
                    </td>
                  </tr>
                )}
                {merged.tallies.map((t, i) => (
                  <tr
                    key={`${t.w}x${t.h}x${t.remainder}`}
                    className={`text-center ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                  >
                    <td
                      className={`border-t border-slate-100 px-3 py-1.5 font-semibold ${t.remainder ? "text-amber-600" : "text-slate-700"}`}
                    >
                      {t.remainder ? "절단" : "정척"}
                    </td>
                    <td className="border-t border-slate-100 px-3 py-1.5 text-slate-600 tabular-nums">
                      {t.w}×{t.h}
                    </td>
                    <td className="border-t border-slate-100 px-3 py-1.5 text-slate-700 tabular-nums">
                      {t.count}
                    </td>
                    <td className="border-t border-slate-100 px-3 py-1.5 text-slate-500 tabular-nums">
                      {((t.w * t.h * t.count) / 1_000_000).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold text-center text-slate-800">
                  <td className="px-3 py-2" colSpan={2}>
                    합계 · 주문 {merged.orderBoardCount}판
                  </td>
                  <td className="px-3 py-2 tabular-nums">{merged.totalCount}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {merged.totalAreaM2.toFixed(2)}
                  </td>
                </tr>
                {merged.discardedCount > 0 && (
                  <tr className="bg-slate-50 text-center text-slate-500 text-[13px]">
                    <td className="px-3 py-1.5" colSpan={2}>
                      버림(폐기)
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {merged.discardedCount}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {merged.discardedAreaM2.toFixed(2)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
