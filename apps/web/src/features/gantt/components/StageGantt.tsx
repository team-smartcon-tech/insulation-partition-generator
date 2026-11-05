/**
 * 공정별 간트 (2026-11-02 사용자: 「동별 공정표 아래에 공정별 공정표 — 줄은 공종, 칸에는 몇 동」).
 * - 줄 = 기준층 사이클 공종 8개(먹매김 → 갱폼 → W철근 → W기전 → 알폼 → S철근 → S기전 → S타설) + 거푸집. 칸 = 그날 그 공종을 하는 동 번호.
 * - 동별 간트와 같은 데이터·날짜 칸. 한 칸에 동이 여럿이면 위아래로 쌓는다(줄 높이 = 그달 가장 많이 겹친 날).
 * - 상자 색은 동마다 다르다(2026-11-02 사용자: 「배지 색상은 동별로 — 겹치는 걸 보기 쉽게」). 동 순서대로 BUILDING_STYLE 을 돌려 쓴다.
 * - 예정은 오전만이면 상자 왼쪽 반, 오후만이면 오른쪽 반을 채운다(번호는 칸 폭 전체에). 실적은 오전·오후 구분이 없어 하루.
 * - 거푸집은 알폼과 따로 한 줄(2026-11-02 사용자: 「거푸집은 별도 공정으로」): 옥탑 거푸집(예정 roof 알폼, 실적 「옥탑…」 층 알폼)과
 *   지하·저층 W·S거푸집. 나머지 옥탑 칸은 같은 공종 줄. 단열재와 그 밖의 지하 공종(시스템·W·C타설)은 이 표에 없다.
 * - 공정 연결 화살표 (2026-11-02 사용자: 「화살표로 연결」·「공정연결」): 같은 동의 앞 공종 상자 끝 → 다음 공종 상자 시작, 동 색으로.
 *   S타설 → 다음 층 먹매김(위로 거슬러 오르는 선)은 표 전체를 가로지르므로 그리지 않는다. 칸 폭은 화면 폭에 따라 바뀌어 재서 그린다.
 */
import type { Stage } from "@ipg/gantt-engine";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { GanttData } from "./GanttChart";
import { STAGE_TEXT, STAGE_TITLE, actualFloorText, floorLabel, isPour } from "../ganttLabels";
import { todayKst } from "../dates";

/** 줄: 공종, FORM = 거푸집(옥탑·지하) */
type Row = Stage | "FORM";
const ROWS: Row[] = ["MARK", "GANGFORM", "WALL_REBAR", "WALL_MEP", "ALFORM", "FORM", "SLAB_REBAR", "SLAB_MEP", "POUR"];
const ROW_TEXT = (r: Row) => (r === "FORM" ? "거푸집" : STAGE_TEXT[r]);
const ROW_TITLE = (r: Row) => (r === "FORM" ? "거푸집(옥탑·지하)" : STAGE_TITLE[r]);
/** 작업 → 줄. 옥탑 알폼·지하 W·S거푸집은 거푸집 줄, 표에 없는 공종은 null */
const rowOf = (stage: Stage, roof: boolean): Row | null =>
  stage === "FORM_WALL" || stage === "FORM_SLAB" || (stage === "ALFORM" && roof) ? "FORM" : ROWS.includes(stage) ? stage : null;
/** 동별 상자 색 (동 순서대로, 넘치면 처음부터). Tailwind 가 찾을 수 있게 클래스 이름을 그대로 적는다 */
/** line = 화살표 색 (테두리 -600 과 같은 값) */
const BUILDING_STYLE = [
  { cls: "bg-sky-200 border-sky-600", line: "#0284c7" },
  { cls: "bg-amber-200 border-amber-600", line: "#d97706" },
  { cls: "bg-emerald-200 border-emerald-600", line: "#059669" },
  { cls: "bg-rose-200 border-rose-600", line: "#e11d48" },
  { cls: "bg-violet-200 border-violet-600", line: "#7c3aed" },
  { cls: "bg-lime-200 border-lime-600", line: "#65a30d" },
  { cls: "bg-orange-200 border-orange-600", line: "#ea580c" },
  { cls: "bg-cyan-200 border-cyan-600", line: "#0891b2" },
  { cls: "bg-fuchsia-200 border-fuchsia-600", line: "#c026d3" },
  { cls: "bg-stone-300 border-stone-600", line: "#57534e" },
  { cls: "bg-indigo-200 border-indigo-600", line: "#4f46e5" },
  { cls: "bg-teal-200 border-teal-600", line: "#0d9488" },
];
/** 동 하나가 쓰는 줄 높이(px) */
const LANE = 15;

type Entry = { id: number; span: "AM" | "PM" | "DAY"; floor: string };
/** 화살표 계산용: 상자 하나 (날짜 순번·공종 줄·칸 안 순번) */
type Chip = {
  day: number;
  row: number;
  lane: number;
  span: Entry["span"];
  floor: string;
};

export default function StageGantt({ data }: { data: GanttData }) {
  const labelOf = new Map((data.buildings ?? []).map((b) => [b.id, b.label]));
  const label = (id: number) => labelOf.get(id) ?? `${id}동`;
  /** 칸 안 번호: 「401동」 → 401 */
  const short = (id: number) => label(id).replace(/동$/, "");
  const order = new Map(data.buildingIds.map((id, i) => [id, i]));
  const styleIndex = (id: number) => (order.get(id) ?? id) % BUILDING_STYLE.length;
  const colorOf = (id: number) => BUILDING_STYLE[styleIndex(id)].cls;
  const asOf = data.asOf ?? null;
  const isActualDay = (date: string) => asOf !== null && date <= asOf;
  const today = todayKst();

  // 날짜|공종 → 그날 그 공종을 하는 동
  const cells = new Map<string, Entry[]>();
  const push = (date: string, stage: Row, e: Entry) => {
    const k = `${date}|${stage}`;
    cells.set(k, [...(cells.get(k) ?? []), e]);
  };
  // 실적: 하루 단위. 같은 동·공종이 여러 층이면 높은 층
  const actual = new Map<string, { id: number; stage: Row; date: string; floor: number; text: string }>();
  for (const w of data.actual ?? []) {
    const row = rowOf(w.stage, !!w.floorLabel?.startsWith("옥탑"));
    if (!isActualDay(w.date) || !row) continue;
    const k = `${w.date}|${row}|${w.buildingId}`;
    const p = actual.get(k);
    if (!p || w.floor > p.floor)
      actual.set(k, {
        id: w.buildingId,
        stage: row,
        date: w.date,
        floor: w.floor,
        text: actualFloorText(w),
      });
  }
  for (const a of actual.values()) push(a.date, a.stage, { id: a.id, span: "DAY", floor: a.text });
  // 예정: 오전·오후 → 하루 / 반일
  const halves = new Map<string, { am?: string; pm?: string }>();
  for (const a of data.assignments) {
    const row = rowOf(a.stage, a.roof != null);
    if (isActualDay(a.date) || !row) continue;
    const k = `${a.date}|${row}|${a.buildingId}`;
    const h = halves.get(k) ?? {};
    h[a.half === "AM" ? "am" : "pm"] = floorLabel(a);
    halves.set(k, h);
  }
  for (const [k, h] of halves) {
    const [date, stage, id] = k.split("|");
    const span = h.am && h.pm ? "DAY" : h.am ? (stage !== "FORM" && isPour(stage as Stage) ? "DAY" : "AM") : "PM";
    push(date, stage as Row, {
      id: Number(id),
      span,
      floor: (h.am ?? h.pm)!,
    });
  }
  for (const list of cells.values()) list.sort((x, y) => (order.get(x.id) ?? x.id) - (order.get(y.id) ?? y.id));

  // 줄 높이·위치 (px). 줄 = 칸 높이(lanes*LANE+8) + 아래 테두리 1px
  const lanesOf = ROWS.map((stage) => Math.max(1, ...data.days.map((d) => cells.get(`${d.date}|${stage}`)?.length ?? 0)));
  const rowTop: number[] = [];
  lanesOf.reduce((top, lanes, r) => ((rowTop[r] = top), top + lanes * LANE + 8 + 1), 0);

  // 동별 상자를 시간 순(날짜 → 오전·하루 → 오후 → 공종 순서)으로 늘어놓고, 공종·층이 바뀌는 곳마다 화살표
  const chipsOf = new Map<number, Chip[]>();
  data.days.forEach((d, day) =>
    ROWS.forEach((stage, row) =>
      (cells.get(`${d.date}|${stage}`) ?? []).forEach((e, lane) =>
        chipsOf.set(e.id, [...(chipsOf.get(e.id) ?? []), { day, row, lane, span: e.span, floor: e.floor }]),
      ),
    ),
  );
  const halfRank = (s: Entry["span"]) => (s === "PM" ? 1 : 0);
  const links: { id: number; from: Chip; to: Chip }[] = [];
  for (const [id, chips] of chipsOf) {
    chips.sort((a, b) => a.day - b.day || halfRank(a.span) - halfRank(b.span) || a.row - b.row);
    for (let i = 1; i < chips.length; i++) {
      const a = chips[i - 1];
      const b = chips[i];
      if (a.row === b.row && a.floor === b.floor) continue; // 같은 공종이 이어지는 칸
      if (b.row <= a.row) continue; // S타설 → 다음 층 먹매김 등 위로 오르는 선은 생략
      links.push({ id, from: a, to: b });
    }
  }
  const [showLinks, setShowLinks] = useState(true);
  // 칸 폭(px): 공종 줄 묶음의 폭에서 이름 칸(5.5rem)을 빼고 날짜 수로 나눈다
  const rowsRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ label: number; col: number } | null>(null);
  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const measure = () => {
      const label = 5.5 * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
      setBox({ label, col: (el.clientWidth - label) / data.days.length });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.days.length]);
  /** 상자 x (나가는 끝: 오전만 = 왼쪽 반 끝 / 들어오는 끝: 오후만 = 가운데) · 가운데 y */
  const geo = (c: Chip, col: number, label: number) => {
    const x0 = label + c.day * col;
    const y = rowTop[c.row] + 4 + c.lane * LANE + (LANE - 2) / 2;
    return {
      out: x0 + (c.span === "AM" ? col / 2 : col - 2),
      in: x0 + (c.span === "PM" ? col / 2 : 2),
      mid: x0 + col / 2,
      y,
    };
  };

  const month = Number(data.from.slice(5, 7));
  const gridCols = {
    gridTemplateColumns: `5.5rem repeat(${data.days.length}, minmax(0, 1fr))`,
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
      <div className="min-w-[960px] text-xs">
        <div className="mb-1 flex items-center gap-3">
          <span className="text-sm font-semibold">공정별 공정표</span>
          <label className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground print:hidden">
            <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} className="size-3.5" />
            공정 연결 화살표
          </label>
        </div>
        <div className="grid" style={gridCols}>
          <div />
          {data.days.map((d) => (
            <div
              key={d.date}
              className={cn(
                "border-r border-border/50 text-center text-[11px]",
                d.isSunday || d.isHoliday ? "text-red-600" : d.isSaturday ? "text-sky-600" : "text-muted-foreground",
              )}
            >
              {"일월화수목금토"[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
            </div>
          ))}
        </div>
        <div className="grid border-b border-border pb-1" style={gridCols}>
          <div className="text-sm font-medium text-muted-foreground">{month}월</div>
          {data.days.map((d) => (
            <div key={d.date} className={cn("border-r border-border/50 text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}>
              {d.date === today ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-primary px-1 font-semibold text-primary-foreground">
                  {Number(d.date.slice(8))}
                </span>
              ) : (
                Number(d.date.slice(8))
              )}
            </div>
          ))}
        </div>

        <div ref={rowsRef} className="relative">
          {ROWS.map((stage, r) => {
            const lanes = lanesOf[r];
            return (
              <div key={stage} className="grid border-b border-border/60" style={gridCols}>
                <div className="flex items-center text-sm font-semibold">{ROW_TEXT(stage)}</div>
                {data.days.map((d) => {
                  const list = cells.get(`${d.date}|${stage}`) ?? [];
                  const planned = !isActualDay(d.date);
                  return (
                    <div
                      key={d.date}
                      className={cn("relative min-w-0 border-r border-border/50", d.isSunday && "bg-muted")}
                      style={{ height: lanes * LANE + 8 }}
                    >
                      <div className={cn("absolute inset-x-0 inset-y-1", planned && asOf !== null && "opacity-60")}>
                        {list.map((e, i) => (
                          <div
                            key={e.id}
                            className={cn("absolute inset-x-0.5 overflow-hidden rounded border", colorOf(e.id), e.span !== "DAY" && "bg-card")}
                            style={{ top: i * LANE, height: LANE - 2 }}
                            title={`${d.date}${planned ? "" : " 실적"} · ${label(e.id)} ${e.floor} · ${ROW_TITLE(stage)}${e.span === "AM" ? " (오전)" : e.span === "PM" ? " (오후)" : ""}`}
                          >
                            {/* 반일: 그 반쪽만 채운다 */}
                            {e.span !== "DAY" ? (
                              <div className={cn("absolute inset-y-0 w-1/2 border-0", colorOf(e.id), e.span === "AM" ? "left-0" : "right-0")} />
                            ) : null}
                            <span className="relative flex h-full select-none items-center justify-center text-[9px] font-semibold leading-none tracking-tighter tabular-nums text-foreground/80">
                              {short(e.id)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {showLinks && box ? (
            <svg className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible" aria-hidden>
              <defs>
                {BUILDING_STYLE.map((s, i) => (
                  <marker key={i} id={`stage-arrow-${i}`} viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" fill={s.line} />
                  </marker>
                ))}
              </defs>
              {links.map(({ id, from, to }, i) => {
                const a = geo(from, box.col, box.label);
                const b = geo(to, box.col, box.label);
                const k = styleIndex(id);
                const h = (LANE - 2) / 2;
                // 다음 상자가 오른쪽에 있으면 옆으로 휘어서, 같은 날(위아래)이면 상자 가운데에서 아래로
                const mx = (a.out + b.in) / 2;
                const d = b.in > a.out + 2 ? `M${a.out},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.in},${b.y}` : `M${a.mid},${a.y + h} L${b.mid},${b.y - h}`;
                const planned = !isActualDay(data.days[to.day].date);
                return (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={BUILDING_STYLE[k].line}
                    strokeWidth={1.2}
                    strokeOpacity={planned && asOf !== null ? 0.55 : 0.9}
                    markerEnd={`url(#stage-arrow-${k})`}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {data.buildingIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-3.5 w-4 rounded border", colorOf(id))} />
              {label(id)}
            </span>
          ))}
        </div>
        <p className="mt-1 text-muted-foreground">
          칸 숫자 = 그날 그 공종을 하는 동(색도 동마다 다름). 상자 왼쪽 반만 채우면 오전, 오른쪽 반만 채우면 오후. 실적은 하루 단위. 화살표 = 같은 동의 다음
          공종(S타설 → 다음 층 먹매김은 생략).
          {asOf ? ` 작업일보 실적(${asOf}까지)은 또렷하게, 그 뒤 예정은 연하게.` : ""}
        </p>
      </div>
    </div>
  );
}
