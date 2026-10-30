/**
 * 마감 공정표 간트 (2026-10-30, 골조 공정표와 같은 방식). 한 달, 날짜 칸 × 동·공종 줄.
 * - 막대 모양은 골조 간트(GanttChart)와 같다 (2026-10-30): 연한 바탕 + 진한 테두리의 둥근 상자, 글자(층 범위)는 상자 안,
 *   날짜 칸 안쪽으로 2px 띄움. 예정은 같은 상자를 흐리게(opacity-60) — 골조의 「실적 또렷 · 예정 연하게」 규칙.
 * - 위: 일보 작업(작업일보 마감 줄). 아래: ✓ 세대 완료(스마트웍스, 회색 상자)·예정(남은 층, 엔진 planFinishBuilding).
 * - 코어 단위 (2026-10-30): 동이 코어로 나뉘면 공종 줄도 코어마다(같은 공종의 코어 줄은 붙여서). 일보 「N코어」 는 그 코어 줄에만.
 * - 오늘은 날짜 머리줄 칸을 채워 표시(세로선 대신). 요일은 월~일 모두. 일요일 띠, 공휴일 빨간 날짜, 날짜 세로줄은 골조 간트와 같다.
 */
import { FINISH_TRADES, dateRange, floorListText, floorRangeText, getDayInfo, hasFinishPlan, type FinishPlanRow } from "@ipg/gantt-engine";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FinishBarT, FinishReportsResponse, FinishResponse } from "../api";
import { monthRange } from "../dates";
import { CALENDAR } from "../hooks";
import FinishCellDialog, { type FinishCellTarget } from "./FinishCellDialog";

type Gantt = FinishResponse["gantt"];

/** 공종 묶음 색 — 골조 간트 GROUP_STYLE 과 같은 단계(바탕 -100, 테두리 -500) */
const GROUP_TONE: Record<string, string> = {
  내장: "bg-violet-100 border-violet-500",
  PL창호: "bg-emerald-100 border-emerald-500",
  유리: "bg-cyan-100 border-cyan-500",
  타일: "bg-orange-100 border-orange-500",
  방수: "bg-sky-100 border-sky-500",
  방통: "bg-rose-100 border-rose-500",
  가구: "bg-amber-100 border-amber-500",
  도배: "bg-lime-200 border-lime-600",
  마루: "bg-stone-100 border-stone-400",
};
const toneOf = (group: string) => GROUP_TONE[group] ?? GROUP_TONE["마루"];
/** ✓ 세대 완료(스마트웍스) 상자 */
const DONE_TONE = "bg-slate-100 border-slate-500";
/** 코어로 나뉜 동의 공종명 칸 너비 (나머지는 코어·% 칸) */
const TRADE_W = "4.75rem";

/** 기간이 겹치는 막대를 칸(줄 안의 단)에 나눈다 — 시작 순으로, 비어 있는 가장 위 칸. laneOf 는 넘긴 순서 그대로 */
function stackLanes(bars: { start: string; end: string }[]): { laneOf: number[]; count: number } {
  const ends: string[] = [];
  const laneOf = new Array<number>(bars.length);
  const order = bars.map((_, i) => i).sort((x, y) => bars[x].start.localeCompare(bars[y].start));
  for (const i of order) {
    let k = ends.findIndex((e) => e < bars[i].start);
    if (k < 0) k = ends.push(bars[i].end) - 1;
    else ends[k] = bars[i].end;
    laneOf[i] = k;
  }
  return { laneOf, count: ends.length };
}

/** 골조 간트 BoxEl 과 같은 상자: 날짜 칸 안쪽 2px, 둥근 테두리, 글자는 안에 한 줄 */
function Bar({ left, width, top, height, tone, text, title, faded }: {
  left: string;
  width: string;
  top: number;
  height: number;
  tone: string;
  text: string;
  title: string;
  faded?: boolean;
}) {
  return (
    <div className="absolute" style={{ left, width, top, height }}>
      <div
        className={cn("absolute inset-x-0.5 inset-y-[3px] flex items-center overflow-hidden rounded-md border px-1", tone, faded && "opacity-60")}
        title={title}
      >
        <span className="select-none truncate whitespace-nowrap text-[10px] font-medium leading-none tracking-tighter text-foreground/75">{text}</span>
      </div>
    </div>
  );
}
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
  /** 마우스가 올라간 칸 (줄 key + 날짜 칸 번호) — 그 칸만 칠한다 */
  const [hover, setHover] = useState<{ key: string; k: number } | null>(null);
  const colAt = (e: { clientX: number; currentTarget: HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
  };
  const { from, to } = monthRange(month);
  const days = dateRange(from, to).map((d) => getDayInfo(CALENDAR, d));
  const n = days.length;
  const idx = (d: string) => days.findIndex((x) => x.date === d);
  const gridCols = { gridTemplateColumns: `9rem repeat(${n}, minmax(0, 1fr))` };
  // 코어로 나뉜 동: 왼쪽 9rem = 공종명(코어 줄 합친 칸) TRADE_W + 코어·% 칸
  const coreRowCols = { gridTemplateColumns: `calc(9rem - ${TRADE_W}) repeat(${n}, minmax(0, 1fr))` };
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
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center text-[11px]", d.isSunday || d.isHoliday ? "text-red-600" : d.isSaturday ? "text-sky-600" : "text-muted-foreground")}
              >
                {"일월화수목금토"[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
              </div>
            ))}
          </div>
          <div className="grid border-b border-border pb-1" style={gridCols}>
            <div className="text-sm font-medium text-muted-foreground">{Number(month.slice(5))}월</div>
            {days.map((d) => (
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}
                title={d.date === asOf ? `${d.date} 오늘` : d.isHoliday ? `${d.date} 공휴일` : d.date}
              >
                {d.date === asOf ? <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-primary px-1 font-semibold text-primary-foreground">{Number(d.date.slice(8))}</span> : Number(d.date.slice(8))}
              </div>
            ))}
          </div>

          {gantt.buildings.map((b) => {
            const keyOf = (trade: string, core: number | null) => `${trade}|${core ?? ""}`;
            const planOf = new Map((plans.get(b.buildingNo) ?? []).map((p) => [keyOf(p.trade, p.core), p.bars]));
            const myReports = reports.filter((x) => x.buildingNo === b.buildingNo);
            const swOf = new Map(b.rows.map((r) => [keyOf(r.trade, r.core), r]));
            const coreList: (number | null)[] = b.cores.length ? b.cores.map((c) => c.core) : [null];
            const linesOf = new Map(b.cores.map((c) => [c.core, c]));
            // 줄: 스마트웍스 공종, 화면 순서(FINISH_TRADES)대로 × 코어. ✓ 세대 완료나 예정이 있는 줄만 — 둘 다 달과 상관없어
            // 어느 달을 봐도 공종 구분이 같다 (2026-10-30 사용자: 10월 이전도 11월과 같게). 그 달 작업일보는 이 줄 위에만 그리고,
            // 일보에만 나온 공종(줄 없음)은 그리지 않는다 — 예전에는 일보 있는 달만 줄이 늘어 달마다 구분이 달랐다.
            // 예정 규칙이 없는 공종(창짝설치·유리·몰딩·주방가구·일반가구)은 줄도 그리지 않는다 (2026-10-30 사용자: 공정표에서도 뺀다)
            const rows = FINISH_TRADES.filter((t) => hasFinishPlan(t.key))
              .filter((t) => b.rows.some((r) => r.trade === t.key))
              .flatMap((t) =>
                coreList.map((core) => ({
                  key: keyOf(t.key, core),
                  trade: t,
                  core,
                  sw: swOf.get(keyOf(t.key, core)),
                  // 일보: 그 코어 줄 + 코어 표기 없는 줄(동 전체)
                  report: myReports
                    .filter((r) => r.trade === t.key && (core == null || r.core == null || r.core === core))
                    .flatMap((r) => r.bars)
                    .sort((x, y) => x.start.localeCompare(y.start)),
                  plan: planOf.get(keyOf(t.key, core)) ?? [],
                })),
              )
              .filter((r) => r.sw?.actual.length || r.plan.length);
            // 코어로 나뉜 동: 공종명은 그 공종의 코어 줄들을 세로로 합친 칸 하나(가운데), 옆 칸에 「N코어 %」.
            // 두 칸 너비 합 = 9rem 이라 날짜 칸은 다른 동과 같은 자리.
            const cored = rows.some((r) => r.core != null);
            const groups: (typeof rows)[] = [];
            for (const r of rows) {
              const last = groups[groups.length - 1];
              if (cored && last && last[0].trade.key === r.trade.key) last.push(r);
              else groups.push([r]);
            }
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
                  groups.map((group) => {
                    const renderRow = ({ key, trade: t, core, sw, report, plan }: (typeof rows)[number], gi: number) => {
                    const coreInfo = core != null ? linesOf.get(core) : undefined;
                    const tone = toneOf(t.group);
                    const pct = sw?.total ? Math.round((sw.done / sw.total) * 100) : null;
                    // 일보 작업 막대: 기간이 겹치면 아래 칸으로 (칸 = 26px)
                    const visible = report.filter((x) => place(x));
                    const { laneOf, count: lanes } = stackLanes(visible);
                    // 예정도 팀이 여럿이면(동시에 두 묶음) 겹친다 → 아래 칸으로. ✓ 세대 완료는 예정과 기간이 겹치지 않아 첫 칸
                    const planLane = stackLanes(plan.filter((x) => place(x)));
                    const LANE = 26;
                    const height = lanes * LANE + Math.max(1, planLane.count) * LANE;
                    const bottomTop = lanes * LANE;
                    return (
                      <div
                        key={key}
                        className={cn("grid", cored ? gi > 0 && "border-t border-dashed border-border/30" : "border-t border-border/40")}
                        style={cored ? coreRowCols : gridCols}
                      >
                        <div
                          className="flex items-center justify-between gap-1 px-1"
                          title={[
                            sw ? `스마트웍스 공종: ${sw.sources.join(", ")}` : "스마트웍스 공종 없음 (일보만)",
                            coreInfo
                              ? `${core}코어 = ${coreInfo.lines.map((l) => `${l}호`).join("·")} 라인 (${coreInfo.source === "settings" ? "설정 코어별 세대수" : "스마트웍스 라인 높이로 나눔"})`
                              : "",
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          {core != null ? (
                            <span className="text-[10px] text-muted-foreground">{core}코어</span>
                          ) : (
                            <span className="truncate">
                              <span className="text-muted-foreground">{t.group === t.label ? "" : `${t.group} · `}</span>
                              {t.label}
                            </span>
                          )}
                          {pct != null ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{pct}%</span> : null}
                        </div>
                        <div
                          className="relative cursor-pointer"
                          style={{ gridColumn: `span ${n}`, height }}
                          onMouseMove={(e) => {
                            const k = colAt(e);
                            if (hover?.key !== key || hover.k !== k) setHover({ key, k });
                          }}
                          onMouseLeave={() => setHover(null)}
                          onClick={(e) => {
                            // 누른 가로 위치 → 날짜 칸
                            const k = colAt(e);
                            const date = days[k].date;
                            const on = (x: FinishBarT) => x.start <= date && date <= x.end;
                            setTarget({
                              date,
                              buildingNo: b.buildingNo,
                              buildingName: b.name,
                              core,
                              coreLines: coreInfo?.lines ?? [],
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
                          {hover?.key === key ? (
                            <div
                              className="pointer-events-none absolute inset-y-0 bg-primary/15 ring-1 ring-inset ring-primary/40"
                              style={{ left: `${(hover.k / n) * 100}%`, width: `${100 / n}%` }}
                            />
                          ) : null}
                          {/* 위: 일보 작업 (작업일보 마감 줄) */}
                          {visible.map((bar, i) => {
                            const p = place(bar)!;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <Bar
                                key={`r${i}`}
                                left={p.left}
                                width={p.width}
                                top={laneOf[i] * LANE}
                                height={LANE}
                                tone={tone}
                                text={p.clippedStart ? `…${label}` : label}
                                title={`${b.name} ${t.label} ${label} 작업 · ${md(bar.start)}~${md(bar.end)} (일보 ${bar.days}일)\n${bar.texts.join("\n")}`}
                              />
                            );
                          })}
                          {/* 아래: 세대 완료 기록(스마트웍스) + 예정 */}
                          {(sw?.actual ?? []).map((bar, i) => {
                            const p = place(bar);
                            if (!p) return null;
                            const fu = bar.floorUnits ?? [];
                            const label = fu.length ? floorListText(fu.map((x) => x.floor)) : floorRangeText(bar.floorFrom, bar.floorTo);
                            const detail = fu.map((x) => `${floorRangeText(x.floor, x.floor)} ${x.units}세대`).join(", ");
                            return (
                              <Bar
                                key={`a${i}`}
                                left={p.left}
                                width={p.width}
                                top={bottomTop}
                                height={LANE}
                                tone={DONE_TONE}
                                text={`✓${label}`}
                                title={`${b.name} ${t.label} · ${bar.start === bar.end ? md(bar.start) : `${md(bar.start)}~${md(bar.end)}`} · ${bar.units}세대 완료 (스마트웍스 마감입력)${detail ? `\n${detail}` : ""}`}
                              />
                            );
                          })}
                          {plan.filter((x) => place(x)).map((bar, i) => {
                            const p = place(bar)!;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <Bar
                                key={`p${i}`}
                                left={p.left}
                                width={p.width}
                                top={bottomTop + planLane.laneOf[i] * LANE}
                                height={LANE}
                                tone={tone}
                                faded
                                text={label}
                                title={`${b.name} ${t.label} ${label} 예정 · ${md(bar.start)}~${md(bar.end)} · 남은 ${bar.units}세대 (선행·층 묶음 규칙)`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                    };
                    if (!cored) return renderRow(group[0], 0);
                    const t = group[0].trade;
                    return (
                      <div key={t.key} className="grid border-t border-border/40" style={{ gridTemplateColumns: `${TRADE_W} minmax(0, 1fr)` }}>
                        <div
                          className="flex items-center border-r border-border/30 px-1"
                          title={t.group === t.label ? t.label : `${t.group} · ${t.label}`}
                        >
                          <span className="truncate">{t.label}</span>
                        </div>
                        <div>{group.map(renderRow)}</div>
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
        {[...new Set(gantt.trades.filter((t) => hasFinishPlan(t.key)).map((t) => t.group))].map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3.5 w-4 rounded border", toneOf(g))} />
            {g}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-3.5 w-4 rounded border", DONE_TONE)} />
          ✓ 세대 완료(스마트웍스)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-3.5 w-4 rounded border opacity-60", toneOf("내장"))} />
          예정(선행 공종·간격·층 묶음 규칙)
        </span>
        <span>위 = 일보 작업(작업일보 마감 줄, 3일 안에 이어지면 한 막대) · 아래 = ✓ 그날 완료한 층(스마트웍스 마감입력 날짜)·예정 · 상자 안 = 층 범위 · 일보 작업·세대 완료는 또렷하게, 예정은 연하게 · 채운 날짜 = 오늘 · 칸을 누르면 그날 작업일보</span>
      </div>
    </div>
  );
}
