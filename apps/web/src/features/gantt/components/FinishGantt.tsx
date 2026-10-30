/**
 * 마감 공정표 간트 (2026-10-30, 골조 공정표와 같은 방식). 한 달, 날짜 칸 × 동·공종 줄.
 * - 실적 막대(진함): 스마트웍스 세대 완료일을 이어 붙인 구간, 위에 층 범위("5~6F").
 * - 예정 막대(연한 점선): 남은 층을 선행 공종·간격·층 묶음 규칙으로 (엔진 planFinishBuilding, 오른쪽 설정 카드).
 * - 오늘 세로선. 일요일 띠, 공휴일 빨간 날짜, 날짜 세로줄은 골조 간트와 같다.
 */
import { FINISH_TRADES, dateRange, floorRangeText, getDayInfo, type FinishPlanRow } from "@ipg/gantt-engine";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FinishBarT, FinishReportsResponse, FinishResponse } from "../api";
import { monthRange } from "../dates";
import { CALENDAR } from "../hooks";
import FinishCellDialog, { type FinishCellTarget } from "./FinishCellDialog";

type Gantt = FinishResponse["gantt"];

/** 공종 묶음 색 (실적 / 예정) */
const GROUP_TONE: Record<string, { solid: string; light: string; legend: string }> = {
  내장: { solid: "bg-violet-400 border-violet-600", light: "bg-violet-100 border-violet-400", legend: "bg-violet-400" },
  PL창호: { solid: "bg-emerald-400 border-emerald-600", light: "bg-emerald-100 border-emerald-400", legend: "bg-emerald-400" },
  유리: { solid: "bg-cyan-400 border-cyan-600", light: "bg-cyan-100 border-cyan-400", legend: "bg-cyan-400" },
  타일: { solid: "bg-orange-400 border-orange-600", light: "bg-orange-100 border-orange-400", legend: "bg-orange-400" },
  방통: { solid: "bg-rose-400 border-rose-600", light: "bg-rose-100 border-rose-400", legend: "bg-rose-400" },
  가구: { solid: "bg-amber-400 border-amber-600", light: "bg-amber-100 border-amber-400", legend: "bg-amber-400" },
  도배: { solid: "bg-lime-400 border-lime-600", light: "bg-lime-100 border-lime-400", legend: "bg-lime-400" },
  마루: { solid: "bg-stone-400 border-stone-600", light: "bg-stone-100 border-stone-400", legend: "bg-stone-400" },
};
const toneOf = (group: string) => GROUP_TONE[group] ?? GROUP_TONE["마루"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function FinishGantt({
  gantt,
  plans,
  reports,
  month,
  asOf,
  siteId,
  topFloorOf,
}: {
  gantt: Gantt;
  /** 동 → 공종별 예정 막대 (planFinishBuilding: 선행·층 묶음 규칙) */
  plans: Map<number, FinishPlanRow[]>;
  /** 작업일보 마감 줄 → 동·공종별 일보 작업 막대 (그 달) */
  reports: FinishReportsResponse["rows"];
  month: string;
  asOf: string;
  siteId: string | null;
  /** 「~최상층」 해석용 (설정 탭 동 목록) */
  topFloorOf: (buildingNo: number) => number | null;
}) {
  const [target, setTarget] = useState<FinishCellTarget | null>(null);
  const { from, to } = monthRange(month);
  const days = dateRange(from, to).map((d) => getDayInfo(CALENDAR, d));
  const n = days.length;
  const idx = (d: string) => days.findIndex((x) => x.date === d);
  const todayIdx = idx(asOf);
  const gridCols = { gridTemplateColumns: `9rem repeat(${n}, minmax(0, 1fr))` };
  const dayCell = (d: (typeof days)[number]) => cn("border-r border-border/50", d.isSunday && "bg-muted");

  /** 막대를 이 달 칸 위치로 (달 밖이면 null, 걸치면 잘라서) */
  const place = (b: FinishBarT) => {
    if (b.end < from || b.start > to) return null;
    const s = b.start < from ? 0 : idx(b.start);
    const e = b.end > to ? n - 1 : idx(b.end);
    if (s < 0 || e < 0) return null;
    return { left: `${(s / n) * 100}%`, width: `${((e - s + 1) / n) * 100}%`, clippedStart: b.start < from };
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3 print:overflow-visible">
        <div className="min-w-[960px] text-xs">
          <div className="grid" style={gridCols}>
            <div />
            {days.map((d) => (
              <div key={d.date} className={cn("border-r border-border/50 text-center text-[11px]", d.isSunday && "text-red-600", d.isSaturday && "text-sky-600")}>
                {d.isSunday ? "일" : d.isSaturday ? "토" : ""}
              </div>
            ))}
          </div>
          <div className="grid border-b border-border pb-1" style={gridCols}>
            <div className="text-sm font-medium text-muted-foreground">{Number(month.slice(5))}월</div>
            {days.map((d) => (
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}
                title={d.isHoliday ? `${d.date} 공휴일` : d.date}
              >
                {Number(d.date.slice(8))}
              </div>
            ))}
          </div>

          {gantt.buildings.map((b) => {
            const planOf = new Map((plans.get(b.buildingNo) ?? []).map((p) => [p.trade, p.bars]));
            const reportOf = new Map(reports.filter((x) => x.buildingNo === b.buildingNo).map((x) => [x.trade, x.bars]));
            const swOf = new Map(b.rows.map((r) => [r.trade, r]));
            // 줄: 스마트웍스 공종 + 일보에만 나온 공종, 화면 순서(FINISH_TRADES)대로. 막대가 하나라도 있는 줄만
            const rows = FINISH_TRADES.filter((t) => swOf.has(t.key) || reportOf.has(t.key))
              .map((t) => ({ trade: t, sw: swOf.get(t.key), report: reportOf.get(t.key) ?? [], plan: planOf.get(t.key) ?? [] }))
              .filter((r) => r.report.length || r.sw?.actual.length || r.plan.length);
            return (
              <div key={b.buildingNo} className="border-b-2 border-border">
                <div className="grid bg-muted/40" style={gridCols}>
                  <div className="px-1 py-1 text-sm font-semibold">{b.name}</div>
                  {days.map((d) => (
                    <div key={d.date} className={dayCell(d)} />
                  ))}
                </div>
                {rows.length === 0 ? (
                  <div className="px-1 py-2 text-[11px] text-muted-foreground">이 동은 아직 해당 공종 마감 기록이 없습니다.</div>
                ) : (
                  rows.map(({ trade: t, sw, report, plan }) => {
                    const tone = toneOf(t.group);
                    const pct = sw?.total ? Math.round((sw.done / sw.total) * 100) : null;
                    // 일보 작업 막대: 기간이 겹치면 아래 칸으로 (칸 = 22px)
                    const visible = report.filter((x) => place(x));
                    const laneEnds: string[] = [];
                    const laneOf = visible.map((bar) => {
                      let k = laneEnds.findIndex((e) => e < bar.start);
                      if (k < 0) {
                        k = laneEnds.length;
                        laneEnds.push(bar.end);
                      } else laneEnds[k] = bar.end;
                      return k;
                    });
                    const LANE = 22;
                    const lanes = laneEnds.length;
                    const height = lanes * LANE + LANE;
                    const bottomTop = lanes * LANE;
                    return (
                      <div key={t.key} className="grid border-t border-border/40" style={gridCols}>
                        <div className="flex items-center justify-between gap-1 px-1" title={sw ? `스마트웍스 공종: ${sw.sources.join(", ")}` : "스마트웍스 공종 없음 (일보만)"}>
                          <span className="truncate">
                            <span className="text-muted-foreground">{t.group === t.label ? "" : `${t.group} · `}</span>
                            {t.label}
                          </span>
                          {pct != null ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{pct}%</span> : null}
                        </div>
                        <div
                          className="relative cursor-pointer hover:bg-primary/5"
                          style={{ gridColumn: `span ${n}`, height }}
                          onClick={(e) => {
                            // 누른 가로 위치 → 날짜 칸
                            const rect = e.currentTarget.getBoundingClientRect();
                            const k = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
                            const date = days[k].date;
                            const on = (x: FinishBarT) => x.start <= date && date <= x.end;
                            setTarget({
                              date,
                              buildingNo: b.buildingNo,
                              buildingName: b.name,
                              trade: t,
                              report: report.filter(on),
                              actual: (sw?.actual ?? []).filter(on),
                              plan: plan.filter(on),
                            });
                          }}
                        >
                          {/* 날짜 칸 배경 (세로줄·일요일) */}
                          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                            {days.map((d) => (
                              <div key={d.date} className={dayCell(d)} />
                            ))}
                          </div>
                          {todayIdx >= 0 ? (
                            <div className="absolute inset-y-0 border-l-2 border-primary/60" style={{ left: `${((todayIdx + 1) / n) * 100}%` }} />
                          ) : null}
                          {/* 위: 일보 작업 (작업일보 마감 줄) */}
                          {visible.map((bar, i) => {
                            const p = place(bar)!;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <div key={`r${i}`} className="absolute" style={{ left: p.left, width: p.width, top: laneOf[i] * LANE, height: LANE }}>
                                <div className="truncate whitespace-nowrap text-[10px] leading-[11px] text-foreground/85">{p.clippedStart ? `…${label}` : label}</div>
                                <div
                                  className={cn("h-2.5 rounded-sm border", tone.solid)}
                                  title={`${b.name} ${t.label} ${label} 작업 · ${md(bar.start)}~${md(bar.end)} (일보 ${bar.days}일)\n${bar.texts.join("\n")}`}
                                />
                              </div>
                            );
                          })}
                          {/* 아래: 세대 완료 기록(스마트웍스) + 예정 */}
                          {(sw?.actual ?? []).map((bar, i) => {
                            const p = place(bar);
                            if (!p) return null;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <div key={`a${i}`} className="absolute" style={{ left: p.left, width: p.width, top: bottomTop, height: LANE }}>
                                <div className="truncate whitespace-nowrap text-[10px] leading-[11px] text-slate-600">✓{label}</div>
                                <div
                                  className="h-1.5 rounded-full bg-slate-600"
                                  title={`${b.name} ${t.label} ${label} · ${md(bar.start)}~${md(bar.end)} · ${bar.units}세대 완료 (스마트웍스 세대 기록)`}
                                />
                              </div>
                            );
                          })}
                          {plan.map((bar, i) => {
                            const p = place(bar);
                            if (!p) return null;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <div key={`p${i}`} className="absolute" style={{ left: p.left, width: p.width, top: bottomTop, height: LANE }}>
                                <div className="truncate whitespace-nowrap text-[10px] italic leading-[11px] text-muted-foreground">{label}</div>
                                <div
                                  className={cn("h-2.5 rounded-sm border border-dashed", tone.light)}
                                  title={`${b.name} ${t.label} ${label} 예정 · ${md(bar.start)}~${md(bar.end)} · 남은 ${bar.units}세대 (선행·층 묶음 규칙)`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
      {target ? <FinishCellDialog siteId={siteId} target={target} topFloorOf={topFloorOf} onClose={() => setTarget(null)} /> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[...new Set(gantt.trades.map((t) => t.group))].map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-4 rounded-sm", toneOf(g).legend)} />
            {g}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-slate-600" />
          ✓ 세대 완료(스마트웍스)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-100" />
          예정(선행 공종·간격·층 묶음 규칙)
        </span>
        <span>위 = 일보 작업(작업일보 마감 줄, 3일 안에 이어지면 한 막대) · 아래 = 세대 완료·예정 · 막대 위 = 층 범위 · 세로선 = 오늘 · 칸을 누르면 그날 작업일보</span>
      </div>
    </div>
  );
}
