/**
 * 공정표 탭 — 월 이동, 요약 숫자, 간트(실적 + 예정), 오른쪽 "저장 없이 바꿔 보기" 설정.
 * 저장된 현장 설정을 기본으로 쓰고, 패널에서 바꾼 값은 이 화면에서만 적용된다(저장은 설정 탭).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@ipg/gantt-engine";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { monthRange, shiftMonth, todayKst } from "../dates";
import { usePlan, useSettings } from "../hooks";
import GanttChart from "./GanttChart";
import SettingsForm from "./SettingsForm";

/** 프린터 아이콘 — Font Awesome Free 7.3.1 "print" (solid). License: https://fontawesome.com/license/free (CC BY 4.0 icons) */
function PrintIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className={className} fill="currentColor" aria-hidden="true">
      <path d="M128 128C128 92.7 156.7 64 192 64L405.5 64C422.5 64 438.8 70.7 450.8 82.7L493.3 125.2C505.3 137.2 512 153.5 512 170.5L512 208L128 208L128 128zM64 320C64 284.7 92.7 256 128 256L512 256C547.3 256 576 284.7 576 320L576 416C576 433.7 561.7 448 544 448L512 448L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 448L96 448C78.3 448 64 433.7 64 416L64 320zM192 480L192 512L448 512L448 416L192 416L192 480zM520 336C520 322.7 509.3 312 496 312C482.7 312 472 322.7 472 336C472 349.3 482.7 360 496 360C509.3 360 520 349.3 520 336z" />
    </svg>
  );
}

/** 엑셀 아이콘 — Font Awesome Free 7.3.1 "file-excel" (solid). License: https://fontawesome.com/license/free (CC BY 4.0 icons) */
function ExcelIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className={className} fill="currentColor" aria-hidden="true">
      <path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM292 330.7C284.6 319.7 269.7 316.7 258.7 324C247.7 331.3 244.7 346.3 252 357.3L291.2 416L252 474.7C244.6 485.7 247.6 500.6 258.7 508C269.8 515.4 284.6 512.4 292 501.3L320 459.3L348 501.3C355.4 512.3 370.3 515.3 381.3 508C392.3 500.7 395.3 485.7 388 474.7L348.8 416L388 357.3C395.4 346.3 392.4 331.4 381.3 324C370.2 316.6 355.4 319.6 348 330.7L320 372.7L292 330.7z" />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function SchedulePanel({
  siteId,
  siteName,
  actionsSlot = null,
}: {
  siteId: string | null;
  siteName: string;
  /** 탭 줄 오른쪽 자리 — 엑셀·인쇄 버튼을 여기에 그린다 (GanttPage) */
  actionsSlot?: HTMLElement | null;
}) {
  const [month, setMonth] = useState(todayKst().slice(0, 7));
  const saved = useSettings(siteId);
  const [override, setOverride] = useState<SiteSettings | null>(null);
  const settings = override ?? saved.data?.settings ?? DEFAULT_SITE_SETTINGS;
  useEffect(() => setOverride(null), [siteId]);

  const { from, to } = monthRange(month);
  const plan = usePlan(siteId, from, to, settings, todayKst());
  const d = plan.data;
  const noBuildings = saved.data && saved.data.buildings.length === 0;
  // 지하·저층 공정 중이라 예정을 계산하지 않은 동 (실적만 표시)
  const unplanned = d?.unplanned ?? [];
  // 지하·저층 순서표(재래식)로 예정을 낸 동
  const ugPlanned = d?.underground ?? [];
  const allUnplanned = d != null && unplanned.length > 0 && unplanned.length === d.buildingIds.length;
  // 이 달에 그릴 것이 없다 (일보가 있는 현장인데 첫 일보 이전 달 등)
  // (동 목록이 있어도 실적·예정이 하나도 없으면 빈 줄만 남으므로 같이 안내)
  const nothing = d != null && d.assignments.length === 0 && (d.actual ?? []).length === 0;
  // 인쇄: 파일 이름(PDF 저장 시)이 「현장 월 공정표」 가 되도록 잠깐 제목을 바꾼다
  // 엑셀 저장: 화면 공정표와 같은 규칙 (exportXlsx)
  const [saving, setSaving] = useState(false);
  const onExcel = async () => {
    if (!d) return;
    setSaving(true);
    try {
      const { exportGanttXlsx } = await import("../exportXlsx");
      await exportGanttXlsx(d, siteName, month);
    } catch (e) {
      toast.error(`엑셀 저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const onPrint = () => {
    const prev = document.title;
    document.title = `${siteName} ${month.replace("-", "년 ")}월 공정표`;
    window.print();
    document.title = prev;
  };
  const labelOf = (id: number) => d?.buildings?.find((b) => b.id === id)?.label ?? `${id}동`;

  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={onExcel} disabled={!d || saving} title="공정표 엑셀 저장 (.xlsx)">
        <ExcelIcon className="size-4 text-emerald-700" /> {saving ? "저장 중…" : "엑셀"}
      </Button>
      <Button variant="outline" size="sm" onClick={onPrint} disabled={!d} title="공정표 인쇄 (A3 가로)">
        <PrintIcon /> 인쇄
      </Button>
    </>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      {actionsSlot ? createPortal(actions, actionsSlot) : null}
      {/* 인쇄 영역: 현장·월 머리줄, 요약 카드, 간트, 범례 (index.css @media print 의 [data-print-root]) */}
      <div className="min-w-0 space-y-4" data-print-root>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">{siteName}</b>
            {nothing && unplanned.length
              ? ` · ${d?.asOf}까지 작업일보 실적이 있지만, 지하·저층 공정이라 이후 예정은 계산하지 않습니다.`
              : nothing
              ? ` · 이 달에는 작업일보 실적이 없습니다${d?.firstReportDate ? ` (첫 일보 ${d.firstReportDate})` : ""}.`
              : d?.asOf
              ? d.asOf < d.from
                ? ` · ${d.asOf}까지의 작업일보 실적에서 이어서 계산한 예정입니다.`
                : ` · 작업일보 실적은 ${d.asOf}까지, 그 다음 날부터는 엔진 예정입니다.`
              : d && noBuildings
                ? " · 작업일보와 동 목록이 없어 예시 시뮬레이션을 보여줍니다."
                : d
                  ? " · 작업일보가 없어 설정 탭의 동 목록(현재 층)에서 출발한 예정입니다."
                  : ""}
            {noBuildings && !unplanned.length && !nothing ? (
              <span className="ml-2 text-amber-700">설정 탭에서 동별 최상층을 넣으면 사이클 종료·단열재 단계가 반영됩니다.</span>
            ) : null}
            {ugPlanned.length && !nothing ? (
              <span className="ml-2 text-sky-700">
                {ugPlanned.map(labelOf).join("·")}: 지하·저층은 설정의 재래식 순서표로 예정, 기준층 시작부터 기준층 사이클.
              </span>
            ) : null}
            {unplanned.length && !nothing ? (
              <span className="ml-2 text-amber-700">
                {allUnplanned ? "모든 동이" : `${unplanned.map(labelOf).join("·")}은(는)`} 지하·저층 공정이라 작업일보 실적만 표시합니다(예정 계산은 기준층부터).
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="전달" className="print:hidden" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium tabular-nums">{month.replace("-", "년 ")}월</span>
            <Button variant="outline" size="icon" aria-label="다음달" className="print:hidden" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        {plan.isError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(plan.error as Error).message}</div>
        ) : d && nothing ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {unplanned.length ? (
              <>
                이 달에는 작업일보 실적이 없고, 지하·저층 공정({unplanned.map(labelOf).join("·")})은 예정을 계산하지 않습니다.
                {d.asOf ? ` 마지막 실적은 ${d.asOf} 입니다.` : ""}
              </>
            ) : (
              <>
                이 달에는 공정표에 그릴 작업일보 실적이 없습니다.
                {d.firstReportDate ? ` 이 현장의 첫 작업일보는 ${d.firstReportDate} 입니다.` : ""}
              </>
            )}
          </div>
        ) : d ? (
          <>
            <div className={allUnplanned ? "hidden" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
              <Stat label={d.asOf ? "예정 타설" : "타설"} value={`${d.stats.pours}회`} sub={d.asOf ? `${d.stats.from}부터 월말까지` : undefined} />
              <Stat label="타설 공백" value={`${d.stats.pourGapDays}일`} />
              <Stat label="알폼 온종일 유휴" value={`${d.stats.idle.alform.fullDays}일`} sub={`반일 ${d.stats.idle.alform.halfDays}일`} />
              <Stat label="철근 / 갱폼 온종일 유휴" value={`${d.stats.idle.rebar.fullDays} / ${d.stats.idle.gangform.fullDays}일`} />
            </div>
            <div className={plan.isFetching ? "opacity-70" : ""}>
              <GanttChart data={d} siteId={siteId} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{siteId ? "계산 중…" : "현장을 먼저 고르세요."}</p>
        )}
      </div>

      <aside className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-sm font-semibold">설정 (저장 없이 바꿔 보기)</span>
          <div className="flex items-center gap-1">
            {override ? (
              <Button variant="ghost" size="sm" onClick={() => setOverride(null)}>
                <RotateCcw /> 저장값으로
              </Button>
            ) : null}
          </div>
        </div>
        <SettingsForm value={settings} onChange={setOverride} />
      </aside>
    </div>
  );
}
