/**
 * 마감 공정표 간트 (2026-10-30, 골조 공정표와 같은 방식). 한 달, 날짜 칸 × 동·공종 줄.
 * - 실적 막대(진함): 스마트웍스 세대 완료일을 이어 붙인 구간, 위에 층 범위("5~6F").
 * - 예정 막대(연한 점선): 남은 층, 최근 4주 속도 (엔진 buildFinishGantt).
 * - 오늘 세로선. 일요일 띠, 공휴일 빨간 날짜, 날짜 세로줄은 골조 간트와 같다.
 */
import { dateRange, floorRangeText, getDayInfo } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";
import type { FinishBarT, FinishResponse } from "../api";
import { monthRange } from "../dates";
import { CALENDAR } from "../hooks";

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

export default function FinishGantt({ gantt, month, asOf }: { gantt: Gantt; month: string; asOf: string }) {
  const { from, to } = monthRange(month);
  const days = dateRange(from, to).map((d) => getDayInfo(CALENDAR, d));
  const n = days.length;
  const idx = (d: string) => days.findIndex((x) => x.date === d);
  const todayIdx = idx(asOf);
  const tradeOf = new Map(gantt.trades.map((t) => [t.key, t]));
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
            const rows = b.rows.filter((r) => r.actual.length || r.forecast);
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
                  rows.map((r) => {
                    const t = tradeOf.get(r.trade);
                    const tone = toneOf(t?.group ?? "");
                    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
                    return (
                      <div key={r.trade} className="grid border-t border-border/40" style={gridCols}>
                        <div className="flex items-center justify-between gap-1 px-1" title={`스마트웍스 공종: ${r.sources.join(", ")}`}>
                          <span className="truncate">
                            <span className="text-muted-foreground">{t?.group === t?.label ? "" : `${t?.group} · `}</span>
                            {t?.label}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="relative h-9" style={{ gridColumn: `span ${n}` }}>
                          {/* 날짜 칸 배경 (세로줄·일요일) */}
                          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                            {days.map((d) => (
                              <div key={d.date} className={dayCell(d)} />
                            ))}
                          </div>
                          {todayIdx >= 0 ? (
                            <div className="absolute inset-y-0 border-l-2 border-primary/60" style={{ left: `${((todayIdx + 1) / n) * 100}%` }} />
                          ) : null}
                          {r.actual.map((bar, i) => {
                            const p = place(bar);
                            if (!p) return null;
                            const label = floorRangeText(bar.floorFrom, bar.floorTo);
                            return (
                              <div key={i} className="absolute bottom-1 top-0" style={{ left: p.left, width: p.width }}>
                                <div className="truncate whitespace-nowrap text-[10px] leading-4 text-foreground/80">{p.clippedStart ? `…${label}` : label}</div>
                                <div
                                  className={cn("h-3 rounded-sm border", tone.solid)}
                                  title={`${b.name} ${t?.label} ${label} · ${md(bar.start)}~${md(bar.end)} · ${bar.units}세대 완료 (실적)`}
                                />
                              </div>
                            );
                          })}
                          {r.forecast
                            ? (() => {
                                const p = place(r.forecast);
                                if (!p) return null;
                                const label = floorRangeText(r.forecast.floorFrom, r.forecast.floorTo);
                                return (
                                  <div className="absolute bottom-1 top-0" style={{ left: p.left, width: p.width }}>
                                    <div className="truncate whitespace-nowrap text-[10px] italic leading-4 text-muted-foreground">{label} 예정</div>
                                    <div
                                      className={cn("h-3 rounded-sm border border-dashed", tone.light)}
                                      title={`${b.name} ${t?.label} ${label} 예정 · ${md(r.forecast.start)}~${md(r.forecast.end)} · 남은 ${r.forecast.units}세대, 최근 4주 주당 ${r.perWeek}세대`}
                                    />
                                  </div>
                                );
                              })()
                            : null}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[...new Set(gantt.trades.map((t) => t.group))].map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-4 rounded-sm", toneOf(g).legend)} />
            {g}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-100" />
          예정(남은 층 · 최근 4주 속도)
        </span>
        <span>막대 위 = 층 범위 · 막대 = 스마트웍스 세대 완료일 구간(3일 넘게 끊기면 새 막대) · 세로선 = 오늘</span>
      </div>
    </div>
  );
}
