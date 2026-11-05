/**
 * 공정표 탭 — 월 이동, 요약 숫자, 간트(실적 + 예정), 오른쪽 "저장 없이 바꿔 보기" 설정.
 * 저장된 현장 설정을 기본으로 쓰고, 패널에서 바꾼 값은 이 화면에서만 적용된다.
 * 「저장」(2026-11-02) 을 누르면 바꾼 값을 현장 설정에 저장한다 — 설정 탭과 같은 값.
 */
import { useEffect, useState } from "react";
import { ExcelIcon, PrintIcon } from "./icons";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, RotateCcw, Save } from "lucide-react";
import { DEFAULT_SITE_SETTINGS, addDays, getDayInfo, type SiteSettings, type Stage } from "@ipg/gantt-engine";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { monthRange, shiftMonth, todayKst } from "../dates";
import { CALENDAR, usePlan, useSaveSettings, useSettings } from "../hooks";
import GanttChart from "./GanttChart";
import StageGantt from "./StageGantt";
import SettingsForm from "./SettingsForm";
import type { Override, StartOverrideCtx } from "./StartOverridePopup";

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
  const saveS = useSaveSettings(siteId);
  const onSave = async () => {
    if (!override) return;
    try {
      await saveS.mutateAsync(override);
      setOverride(null); // 저장값 = 지금 값
      toast.success("설정을 저장했습니다. 설정 탭에도 반영됩니다.");
    } catch (e) {
      toast.error(`설정 저장 실패: ${(e as Error).message}`);
    }
  };
  useEffect(() => setOverride(null), [siteId]);

  const { from, to } = monthRange(month);
  const plan = usePlan(siteId, from, to, settings, todayKst());
  const d = plan.data;
  const noBuildings = saved.data && saved.data.buildings.length === 0;
  // 지하·저층 공정 중이라 예정을 계산하지 않은 동 (실적만 표시)
  const unplanned = d?.unplanned ?? [];
  // 지하·저층 순서표(재래식)로 예정을 낸 동
  const ugPlanned = d?.underground ?? [];
  // 최상층을 몰라 기준층 예정을 그리지 않은 동 / 동 목록에 없어 뺀 동 번호(일보 오타 등)
  const noTop = d?.noTopFloor ?? [];
  const ignored = d?.ignoredBuildings ?? [];
  const roofPhase = d?.rooftopPhase ?? [];
  // 동별 예정 첫 공종 (보정 카드의 「일보 기준」 값) — 그 달에 예정 시작일이 보일 때
  // am·pm = 그 첫날 오전·오후 공종 (비어 있으면 없음 — 오후부터 시작하는 동이 있다)
  const firstPlanned = new Map<number, { stage: Stage; floor: number; am?: Stage; pm?: Stage }>();
  if (d?.asOf) {
    const start = addDays(d.asOf, 1);
    const sorted = [...d.assignments].sort((x, y) => x.date.localeCompare(y.date) || (x.half === "AM" ? -1 : 1));
    const firstDate = new Map<number, string>();
    for (const a of sorted)
      if (a.date >= start && !firstPlanned.has(a.buildingId) && a.roof == null) {
        firstPlanned.set(a.buildingId, { stage: a.stage, floor: a.floor });
        firstDate.set(a.buildingId, a.date);
      }
    // 그날 오전·오후 공종 (팝업의 「일보 기준」)
    for (const a of sorted) {
      const f = firstPlanned.get(a.buildingId);
      if (!f || a.date !== firstDate.get(a.buildingId) || a.roof != null) continue;
      if (a.half === "AM" && f.am == null) f.am = a.stage;
      if (a.half === "PM" && f.pm == null) f.pm = a.stage;
    }
  }
  // 출발 상태 보정 (2026-11-02): 간트 동 이름을 누르면 팝업. 일보가 있어 예정 시작일이 정해진 현장만
  const startOverrideCtx: StartOverrideCtx | null =
    d?.asOf && saved.data
      ? {
          value: settings,
          onChange: setOverride,
          planFrom: addDays(d.asOf, 1),
          firstWorkday: (() => {
            let x = addDays(d.asOf, 1);
            for (let i = 0; i < 14 && !getDayInfo(CALENDAR, x).workable; i++) x = addDays(x, 1);
            return x;
          })(),
          savedOf: (id) => ((saved.data!.settings.startOverrides ?? {})[String(id)] as Override | undefined) ?? null,
          saving: saveS.isPending,
          saveOne: async (id, o) => {
            // 저장값(서버) 위에 이 동 보정만 바꿔 저장 — 오른쪽 설정에서 바꾼 다른 값은 화면에만 남는다
            const base = saved.data!.settings;
            const next = { ...(base.startOverrides ?? {}) };
            if (o) next[String(id)] = o;
            else delete next[String(id)];
            try {
              const savedNow = { ...base, startOverrides: next };
              await saveS.mutateAsync(savedNow);
              // 오른쪽 설정에 다른 변경이 없었으면 「바꿔 보기」 상태도 끝 (저장값 = 지금 값)
              setOverride((cur) => (cur && JSON.stringify(cur) === JSON.stringify(savedNow) ? null : cur));
              toast.success(o ? `${id}동 출발 상태 보정을 저장했습니다.` : `${id}동을 일보대로 되돌렸습니다.`);
            } catch (e) {
              toast.error(`보정 저장 실패: ${(e as Error).message}`);
            }
          },
          baseFloorOf: (id) => saved.data!.buildings.find((x) => x.buildingNo === id)?.baseFloor ?? 2,
          computed: firstPlanned,
          stale: d.startOverride?.stale ?? [],
        }
      : null;
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
      {/* 인쇄 영역: 제목(인쇄만), 간트, 범례. 머리줄·요약 카드는 화면만 (index.css @media print 의 [data-print-root]) */}
      <div className="min-w-0 space-y-4" data-print-root>
        <h1 className="hidden text-center text-2xl font-bold print:block">
          {siteName} {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월 예정공정표
        </h1>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 print:hidden">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
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
            {noTop.length ? (
              <span className="ml-2 font-medium text-amber-700">
                최상층 미입력({noTop.map(labelOf).join("·")}): 기준층 예정을 그리지 않습니다. 설정 탭 동 목록에서 최상층을 넣어 주세요(「스마트웍스에서 불러오기」).
              </span>
            ) : null}
            {roofPhase.length ? (
              <span className="ml-2 text-sky-700">{roofPhase.map(labelOf).join("·")}: 옥탑 공사 중 — 작업일보 실적만 표시합니다.</span>
            ) : null}
            {ignored.length ? (
              <span className="ml-2 text-slate-500">
                동 목록에 없는 {ignored.map((n) => `${n}동`).join("·")} 기록은 공정표에서 뺐습니다(일보 오타일 수 있음, 작업일보 탭 원문에는 그대로).
              </span>
            ) : null}
            {unplanned.length && !nothing ? (
              <span className="ml-2 text-amber-700">
                {allUnplanned ? "모든 동이" : `${unplanned.map(labelOf).join("·")}은(는)`} 지하·저층 공정이라 작업일보 실적만 표시합니다(예정 계산은 기준층부터).
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-2">
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
            <div className={allUnplanned ? "hidden" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden"}>
              <Stat label={d.asOf ? "예정 타설" : "타설"} value={`${d.stats.pours}회`} sub={d.asOf ? `${d.stats.from}부터 월말까지` : undefined} />
              <Stat label="타설 공백" value={`${d.stats.pourGapDays}일`} />
              <Stat label="알폼 온종일 유휴" value={`${d.stats.idle.alform.fullDays}일`} sub={`반일 ${d.stats.idle.alform.halfDays}일`} />
              <Stat label="철근 / 갱폼 온종일 유휴" value={`${d.stats.idle.rebar.fullDays} / ${d.stats.idle.gangform.fullDays}일`} />
            </div>
            <div className={plan.isFetching ? "opacity-70" : ""}>
              <GanttChart data={d} siteId={siteId} startOverride={startOverrideCtx} />
              {/* 공정별 공정표 (2026-11-02): 줄 = 공종, 칸 = 동 번호 */}
              <div className="mt-3">
                <StageGantt data={d} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{siteId ? "계산 중…" : "현장을 먼저 고르세요."}</p>
        )}
      </div>

      <aside className="min-w-0 space-y-2">
        {/* 높이 고정(h-8 = 버튼 높이): 「저장값으로」 가 생겨도 아래 카드가 밀리지 않게. 폭 280px 에 맞게 되돌리기는 아이콘만 */}
        {/* 오른쪽 여백 없음: 저장 버튼 오른쪽 끝을 탭 줄 인쇄 버튼과 맞춘다 */}
        <div className="flex h-8 items-center justify-between gap-2 pl-1">
          <span className="text-sm font-semibold">설정 (저장 없이 바꿔 보기)</span>
          <div className="flex items-center gap-1">
            {override ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setOverride(null)}
                disabled={saveS.isPending}
                title="저장값으로 되돌리기"
                aria-label="저장값으로 되돌리기"
              >
                <RotateCcw />
              </Button>
            ) : null}
            <Button
              size="sm"
              // 인쇄 버튼(outline)과 같은 폭 — 테두리 1px 를 투명으로 둔다
              className="border border-transparent"
              onClick={onSave}
              disabled={!override || !siteId || saveS.isPending}
              title={override ? "바꾼 값을 현장 설정에 저장 (설정 탭에도 반영)" : "바꾼 값이 없습니다"}
            >
              <Save /> {saveS.isPending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
        <SettingsForm siteId={siteId} value={settings} onChange={setOverride} />
      </aside>
    </div>
  );
}
