/**
 * 공정표 탭 — 월 이동, 요약 숫자, 간트(실적 + 예정), 오른쪽 "저장 없이 바꿔 보기" 설정.
 * 저장된 현장 설정을 기본으로 쓰고, 패널에서 바꾼 값은 이 화면에서만 적용된다(저장은 설정 탭).
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import { monthRange, shiftMonth, todayKst } from "../dates";
import { usePlan, useSettings } from "../hooks";
import GanttChart from "./GanttChart";
import SettingsForm from "./SettingsForm";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function SchedulePanel({ siteId, siteName }: { siteId: string | null; siteName: string }) {
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
  const allUnplanned = d != null && unplanned.length > 0 && unplanned.length === d.buildingIds.length;
  const labelOf = (id: number) => d?.buildings?.find((b) => b.id === id)?.label ?? `${id}동`;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">{siteName}</b>
            {d?.asOf
              ? d.asOf < d.from
                ? ` · ${d.asOf}까지의 작업일보 실적에서 이어서 계산한 예정입니다.`
                : ` · 작업일보 실적은 ${d.asOf}까지, 그 다음 날부터는 엔진 예정입니다.`
              : d && noBuildings
                ? " · 작업일보와 동 목록이 없어 예시 시뮬레이션을 보여줍니다."
                : d
                  ? " · 작업일보가 없어 설정 탭의 동 목록(현재 층)에서 출발한 예정입니다."
                  : ""}
            {noBuildings && !unplanned.length ? (
              <span className="ml-2 text-amber-700">설정 탭에서 동별 최상층을 넣으면 사이클 종료·단열재 단계가 반영됩니다.</span>
            ) : null}
            {unplanned.length ? (
              <span className="ml-2 text-amber-700">
                {allUnplanned ? "모든 동이" : `${unplanned.map(labelOf).join("·")}은(는)`} 지하·저층 공정이라 작업일보 실적만 표시합니다(예정 계산은 기준층부터).
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="전달" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium tabular-nums">{month.replace("-", "년 ")}월</span>
            <Button variant="outline" size="icon" aria-label="다음달" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        {plan.isError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(plan.error as Error).message}</div>
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
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold">설정 (저장 없이 바꿔 보기)</span>
          {override ? (
            <Button variant="ghost" size="sm" onClick={() => setOverride(null)}>
              <RotateCcw /> 저장값으로
            </Button>
          ) : null}
        </div>
        <SettingsForm value={settings} onChange={setOverride} />
      </aside>
    </div>
  );
}
