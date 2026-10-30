/**
 * 마감 간트 칸(동·공종 × 날짜)을 누르면 뜨는 팝업 (2026-10-30). 골조 CellReportDialog 와 같은 모양.
 * - 이 칸 막대: 그날에 걸친 일보 작업 · 세대 완료(스마트웍스) · 예정 막대.
 * - 마감 줄 해석: 그날 일보를 parseFinishReport 로 읽어 이 동의 마감 줄 (이 공종 / 다른 공종).
 * - 일보 원문: 이 동 번호가 나오는 줄만, 구간 제목과 함께.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { FINISH_TRADES, floorRangeText, parseFinishReport } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";
import type { FinishBarT } from "../api";
import { koreanDate } from "../dates";
import { useDailyReports } from "../hooks";
import ReportMentionLines from "./ReportMentionLines";

export type FinishCellTarget = {
  date: string;
  buildingNo: number;
  buildingName: string;
  trade: { key: string; group: string; label: string };
  /** 그 날짜에 걸친 막대들 */
  report: (FinishBarT & { days?: number })[];
  actual: FinishBarT[];
  plan: FinishBarT[];
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const labelOf = new Map<string, string>(FINISH_TRADES.map((t) => [t.key, t.label]));

export default function FinishCellDialog({
  siteId,
  target,
  topFloorOf,
  onClose,
}: {
  siteId: string | null;
  target: FinishCellTarget;
  topFloorOf: (buildingNo: number) => number | null;
  onClose: () => void;
}) {
  const q = useDailyReports(siteId, target.date, target.date);
  const report = q.data?.reports[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = report ? parseFinishReport(report.rawText, topFloorOf).filter((x) => x.buildingNo === target.buildingNo) : [];
  const title = `${target.buildingName} · ${target.trade.label}`;
  const bars = [
    ...target.report.map((b) => ({ kind: "일보 작업", tone: "bg-violet-100 text-violet-800", b, note: b.days ? `일보 ${b.days}일` : "" })),
    ...target.actual.map((b) => ({ kind: "세대 완료", tone: "bg-slate-200 text-slate-800", b, note: `${b.units}세대 (스마트웍스)` })),
    ...target.plan.map((b) => ({ kind: "예정", tone: "bg-stone-100 text-stone-600", b, note: `남은 ${b.units}세대 (선행·층 묶음 규칙)` })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} ${target.date} 작업일보`}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {title} <span className="ml-1 font-normal text-muted-foreground">{koreanDate(target.date)}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            title="닫기 (Esc)"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">이 칸 막대</h3>
            {bars.length ? (
              <ul className="space-y-1">
                {bars.map(({ kind, tone, b, note }, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{kind}</span>
                    <span>
                      {floorRangeText(b.floorFrom, b.floorTo)} · {md(b.start)}~{md(b.end)}
                    </span>
                    <span className="text-xs text-muted-foreground">{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">이 날 이 공종 막대는 없습니다.</p>
            )}
          </section>

          {q.isPending ? (
            <p className="text-muted-foreground">작업일보를 불러오는 중…</p>
          ) : q.isError ? (
            <p className="text-red-700">{(q.error as Error).message}</p>
          ) : !report ? (
            <p className="text-muted-foreground">이 날짜의 스마트웍스 작업일보가 없습니다.</p>
          ) : (
            <>
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">마감 줄 해석 ({target.buildingName})</h3>
                {items.length ? (
                  <ul className="space-y-1">
                    {items.map((it, i) => {
                      const mine = it.trade === target.trade.key;
                      return (
                        <li key={i} className="flex flex-wrap items-baseline gap-2">
                          <span
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                              mine ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600",
                            )}
                          >
                            {mine ? "이 공종" : (labelOf.get(it.trade) ?? it.trade)}
                          </span>
                          <span>
                            {floorRangeText(it.floorFrom, it.floorTo)} {it.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">이 날 일보에서 {target.buildingName} 마감 줄(층 표기 있는 줄)을 읽지 못했습니다.</p>
                )}
              </section>
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">작업일보 원문 ({target.buildingName} 나오는 줄)</h3>
                <ReportMentionLines rawText={report.rawText} buildingNo={target.buildingNo} label={target.buildingName} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
