/**
 * 마감 공정표 탭 (2026-10-30). 스마트웍스 옵션마감의 세대별 마감 완료 기록(읽기 전용)을 동별로 보여 준다.
 * ① 진척표: 층 × 공종 칸에 그 층 세대의 완료 수 (색 = 완료 비율). 공종은 스마트웍스 작업순서대로.
 * ② 공종별 요약: 완료 세대·선두층·후미층·최근 4주 속도·예상 완료 (정체·선행 정체 표시).
 * 동은 설정 탭 동 목록 기준 — 목록이 없으면 안내.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FinishResponse, FinishStat } from "../api";
import { useFinish, useFrameReady, useSettings, useTaktLink } from "../hooks";
import { finishSettingsWithTakt, planFinishSite, type FinishPlanSettings } from "@ipg/gantt-engine";
import { RotateCcw } from "lucide-react";
import FinishPlanForm from "./FinishPlanForm";
import { shiftMonth, todayKst } from "../dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FinishGantt from "./FinishGantt";
import { ExcelIcon, PrintIcon } from "./icons";

type Building = FinishResponse["buildings"][number];

/** 완료 비율 → 칸 색 */
const cellTone = (done: number, units: number) => {
  if (!units) return "bg-transparent";
  if (done >= units) return "bg-emerald-500 text-white";
  if (done === 0) return "bg-muted/40 text-muted-foreground/50";
  const r = done / units;
  return r >= 0.5 ? "bg-emerald-200 text-emerald-900" : "bg-amber-100 text-amber-900";
};

const STATUS: Record<FinishStat["status"], { label: string; tone: string }> = {
  done: { label: "완료", tone: "bg-emerald-100 text-emerald-800" },
  progress: { label: "진행", tone: "bg-sky-100 text-sky-800" },
  stalled: { label: "정체", tone: "bg-amber-100 text-amber-800" },
  blocked: { label: "선행 대기", tone: "bg-rose-100 text-rose-800" },
  idle: { label: "시작 전", tone: "bg-muted text-muted-foreground" },
};

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const ymd = (d: string | null) => (d ? `${d.slice(0, 4)}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : "—");

export default function FinishPanel({
  siteId,
  siteName,
  actionsSlot = null,
  onGoSettings,
}: {
  siteId: string | null;
  siteName: string;
  actionsSlot?: HTMLElement | null;
  onGoSettings: () => void;
}) {
  const q = useFinish(siteId);
  const d = q.data;
  const [bno, setBno] = useState<number | null>(null);
  // 기본은 간트(골조 공정표와 같은 한 달 보기), 진척표는 보조
  const [view, setView] = useState<"gantt" | "matrix">("gantt");
  const [month, setMonth] = useState(todayKst().slice(0, 7));
  // 지난 작업은 스마트웍스 세대 완료만 그린다 — 작업일보 마감 줄(일보 작업 막대)은 읽지 않는다 (2026-10-31 사용자)
  // 예정 규칙: 저장값(설정 탭) 위에 이 화면에서만 바꿔 보기 (골조 공정표와 같은 방식)
  const saved = useSettings(siteId);
  const [override, setOverride] = useState<FinishPlanSettings | null>(null);
  // 택트 인원 연동 (2026-10-31): 여기서 바꾼 인원은 미리보기만 (저장은 설정 탭) — 택트 공종명 → 명
  const [crewEdits, setCrewEdits] = useState<Record<string, number>>({});
  useEffect(() => {
    setOverride(null);
    setCrewEdits({});
  }, [siteId]);
  const taktLink = useTaktLink(siteId, crewEdits);
  // 규칙 카드에 보이는 값(간격·층씩·선행) + 택트 연동(인원 → 묶음당 작업일, 팀 1)을 입힌 값으로 예정을 계산한다
  const ruleSettings = override ?? saved.data?.settings.finish;
  // 인원은 동의 코어들에 나뉘어 동시에 (2026-10-31 사용자) → 동시 묶음 = 현장에서 가장 많은 코어 수
  const coreCount = Math.max(1, ...(d?.gantt.buildings ?? []).map((b) => b.cores.length || 1));
  const finishSettings = useMemo(
    () => finishSettingsWithTakt(ruleSettings, taktLink.links, coreCount),
    [ruleSettings, taktLink.links, coreCount],
  );
  const edited = override != null || Object.keys(crewEdits).length > 0;
  // 골조 선행(창틀 = 골조 5개 층)용 층별 S타설일 — 골조 실적·예정. 받는 동안은 골조 선행 없이 계산
  const frame = useFrameReady(siteId, todayKst());
  const frameReady = frame?.ready;
  // 팀은 현장 전체가 나눠 쓰므로 모든 동을 한 번에 계산한다 (2026-10-31)
  const plans = useMemo(
    () => (d ? planFinishSite(d.gantt.buildings as never, finishSettings, d.asOf, undefined, frameReady) : new Map()),
    [d, finishSettings, frameReady],
  );
  useEffect(() => setBno(null), [siteId]);
  const b: Building | undefined = d?.buildings.find((x) => x.buildingNo === bno) ?? d?.buildings[0];
  const typeName = useMemo(() => new Map((d?.types ?? []).map((t) => [t.id, t.name])), [d]);

  const [saving, setSaving] = useState(false);
  const onExcel = async () => {
    if (!d) return;
    setSaving(true);
    try {
      const { exportFinishXlsx } = await import("../exportFinishXlsx");
      await exportFinishXlsx(d, siteName);
    } catch (e) {
      toast.error(`엑셀 저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const onPrint = () => {
    const prev = document.title;
    document.title = `${siteName} ${b?.name ?? ""} 마감 공정표 ${d?.asOf ?? ""}`;
    window.print();
    document.title = prev;
  };
  const actions = (
    <>
      <Button variant="outline" size="sm" onClick={onExcel} disabled={!d?.buildings.length || saving} title="마감 공정표 엑셀 저장 (동별 진척표 + 요약)">
        <ExcelIcon className="size-4 text-emerald-700" /> {saving ? "저장 중…" : "엑셀"}
      </Button>
      <Button variant="outline" size="sm" onClick={onPrint} disabled={!b} title="지금 보는 동 인쇄 (A3 가로)">
        <PrintIcon /> 인쇄
      </Button>
    </>
  );

  if (!siteId) return <p className="text-sm text-muted-foreground">현장을 먼저 고르세요.</p>;
  if (q.isError) return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(q.error as Error).message}</div>;
  if (!d) return <p className="text-sm text-muted-foreground">스마트웍스 마감 기록을 불러오는 중…</p>;

  if (d.needsBuildings)
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        마감 공정표는 설정 탭의 <b className="text-foreground">동 목록·규모</b>를 기준으로 그립니다. 먼저 동 목록을 넣어 주세요.
        <div className="mt-3">
          <Button size="sm" onClick={onGoSettings}>
            설정 탭으로 (「스마트웍스에서 불러오기」)
          </Button>
        </div>
      </div>
    );

  const cellOf = (typeId: string, floor: number) => b?.cells.find((c) => c.typeId === typeId && c.floor === floor);
  const totalUnits = b ? b.floors.reduce((s, f) => s + f.units, 0) : 0;
  const anyWork = d.buildings.some((x) => x.stats.some((s) => s.done > 0));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0 space-y-4" data-print-root>
      {actionsSlot ? createPortal(actions, actionsSlot) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <b className="text-foreground">{siteName}</b> · 스마트웍스 옵션마감 세대별 마감 완료 기록 ({ymd(d.asOf)} 기준). 공종은 스마트웍스 「마감 작업순서」 순.
          {!anyWork ? <span className="ml-2 text-amber-700">아직 마감 완료 기록이 없습니다.</span> : null}
          {d.missingInSmartworks.length ? (
            <span className="ml-2 text-slate-500">스마트웍스 동/라인 설정에 없는 동: {d.missingInSmartworks.map((n) => `${n}동`).join("·")}</span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5 print:hidden">
            {(["gantt", "matrix"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn("h-7 rounded px-2.5 text-sm", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "gantt" ? "간트" : "진척표"}
              </button>
            ))}
          </div>
          {view === "gantt" ? (
            <>
              <Button variant="outline" size="icon" aria-label="전달" className="print:hidden" onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-24 text-center text-sm font-medium tabular-nums">{month.replace("-", "년 ")}월</span>
              <Button variant="outline" size="icon" aria-label="다음달" className="print:hidden" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {view === "gantt" ? (
        // 공종 14개는 늘 줄이 있다(2026-10-31) — 스마트웍스에 연결된 공종이 하나도 없으면 실적 없이 예정만 보인다
        d.gantt.buildings.length ? (
          <FinishGantt
            gantt={d.gantt}
            plans={plans}
            month={month}
            asOf={d.asOf}
            siteId={siteId}
            topFloorOf={(no) => saved.data?.buildings.find((x) => x.buildingNo === no)?.topFloor ?? null}
            framePours={frame?.pours}
            finishSettings={finishSettings}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            스마트웍스에서 이 현장 세대(동·층·라인)를 찾지 못했습니다. 설정 탭 동 목록과 스마트웍스 동/라인 설정을 확인하세요.
          </p>
        )
      ) : !b ? (
        <p className="text-sm text-muted-foreground">스마트웍스 동/라인 설정에서 이 현장 동을 찾지 못했습니다.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 print:hidden">
            {d.buildings.map((x) => (
              <button
                key={x.buildingNo}
                type="button"
                onClick={() => setBno(x.buildingNo)}
                className={cn(
                  "h-8 rounded-md border px-2.5 text-sm tabular-nums",
                  x.buildingNo === b.buildingNo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50",
                )}
              >
                {x.name}
              </button>
            ))}
          </div>
          <section className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <h3 className="text-sm font-semibold">
                {b.name} 진척표 <span className="ml-1 font-normal text-muted-foreground">층 × 공종 · 칸 = 그 층 완료 세대 수 · 세대 {totalUnits}</span>
              </h3>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-block h-3 w-4 rounded-sm bg-emerald-500" /> 완료
                <span className="inline-block h-3 w-4 rounded-sm bg-emerald-200" /> 절반 이상
                <span className="inline-block h-3 w-4 rounded-sm bg-amber-100" /> 시작
                <span className="inline-block h-3 w-4 rounded-sm bg-muted/40" /> 없음
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 text-[11px] tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card px-1 text-left font-medium text-muted-foreground">층 (세대)</th>
                    {d.types.map((t) => (
                      <th key={t.id} className="h-28 w-8 align-bottom font-medium text-muted-foreground" title={t.name}>
                        <span className="inline-block max-h-28 overflow-hidden whitespace-nowrap [writing-mode:vertical-rl]">{t.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.floors.map((f) => (
                    <tr key={f.floor}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-1 text-muted-foreground">
                        {f.floor < 0 ? `B${-f.floor}F` : `${f.floor}F`} <span className="text-muted-foreground/60">({f.units})</span>
                      </td>
                      {d.types.map((t) => {
                        const c = cellOf(t.id, f.floor);
                        const done = c?.done ?? 0;
                        return (
                          <td
                            key={t.id}
                            className={cn("h-6 w-8 rounded-sm text-center", cellTone(done, f.units))}
                            title={`${b.name} ${f.floor}F · ${t.name} · ${done}/${f.units}세대${c?.last ? ` · 최근 완료 ${ymd(c.last)}` : ""}`}
                          >
                            {done >= f.units ? "✓" : done > 0 ? done : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <h3 className="mb-2 px-1 text-sm font-semibold">
              {b.name} 공종별 요약{" "}
              <span className="font-normal text-muted-foreground">
                속도 = 최근 4주 완료 세대 ÷ 4 · 예상 완료 = 남은 세대 ÷ 속도 (선행 공종보다 앞서지 않음, 주당 1세대 미만은 정체)
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-center text-xs text-muted-foreground">
                    <th className="px-2 pb-1 text-left">공종</th>
                    <th className="px-2 pb-1">상태</th>
                    <th className="px-2 pb-1">완료</th>
                    <th className="px-2 pb-1">선두층</th>
                    <th className="px-2 pb-1">후미층</th>
                    <th className="px-2 pb-1">최근 완료</th>
                    <th className="px-2 pb-1">주당</th>
                    <th className="px-2 pb-1 text-left">예상 완료(최근 속도)</th>
                  </tr>
                </thead>
                <tbody>
                  {b.stats.map((s) => {
                    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                    const st = STATUS[s.status];
                    return (
                      <tr key={s.typeId} className="border-t border-border/60">
                        <td className="px-2 py-1">{typeName.get(s.typeId)}</td>
                        <td className="px-2 py-1 text-center">
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", st.tone)}>{st.label}</span>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="whitespace-nowrap text-xs">
                              {s.done}/{s.total} ({pct}%)
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1 text-center">{s.lead != null ? `${s.lead}F` : "—"}</td>
                        <td className="px-2 py-1 text-center">{s.tail != null ? `${s.tail}F` : "—"}</td>
                        <td className="px-2 py-1 text-center">{md(s.last)}</td>
                        <td className="px-2 py-1 text-center">{s.perWeek || "—"}</td>
                        <td className="px-2 py-1">
                          {s.status === "done"
                            ? `완료 ${ymd(s.last)}`
                            : s.forecast
                              ? ymd(s.forecast)
                              : s.blockedBy
                                ? <span className="text-rose-700">미정 · 선행 「{typeName.get(s.blockedBy)}」 정체</span>
                                : s.status === "idle"
                                  ? "—"
                                  : <span className="text-amber-700">정체 (최근 4주 주당 1세대 미만)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
      <aside className="min-w-0 space-y-2 print:hidden">
        {/* 높이 고정(h-8 = 버튼 높이): 「저장값으로」 가 생겨도 아래 카드가 밀리지 않게 */}
        <div className="flex h-8 items-center justify-between gap-2 px-1">
          <span className="text-sm font-semibold">설정 (저장 없이 바꿔 보기)</span>
          {edited ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOverride(null);
                setCrewEdits({});
              }}
            >
              <RotateCcw /> 저장값으로
            </Button>
          ) : null}
        </div>
        <FinishPlanForm
          trades={d.gantt.trades}
          value={ruleSettings}
          onChange={setOverride}
          predEditable={false}
          links={taktLink.links}
          onCrew={(key, crew) => {
            const name = taktLink.links.get(key as never)?.name;
            if (name) setCrewEdits((e) => ({ ...e, [name]: crew }));
          }}
        />
        <p className="px-1 text-xs text-muted-foreground">선행 변경과 저장은 설정 탭 「마감 예정 규칙」에서 합니다. 인원은 택트 인원 탭과 같은 값입니다.</p>
      </aside>
    </div>
  );
}
