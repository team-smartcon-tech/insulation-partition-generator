/**
 * ③ 임대기간 산정 — 호기별 [반입·설치 → 가동 → 해체] 구간과 유휴, 그 아래 투입 대수 곡선.
 *
 * 막대를 세 토막으로 나눠 그리는 이유: 임대료가 붙는 구간은 가동 기간만이 아니라
 * 반입부터 반출까지 전체다. 설치·해체가 얼마나 긴지 눈으로 보여야 "골조 며칠 줄이면
 * 임대 며칠이 줄어드는가" 를 사람이 판단할 수 있다. 그래서 **가동률**(가동일 ÷ 임대일)을
 * 오른쪽에 함께 둔다 — 같은 18개월이라도 가동률이 낮으면 돈만 나간 기간이 길었다는 뜻이다.
 *
 * 투입 대수는 막대그래프가 아니라 **같은 시간축 위의 계단 곡선**으로 그린다.
 * 월마다 값이 같으면(예: 6대 유지) 막대는 의미 없는 파란 벽이 되고, 무엇보다 위 간트와
 * 축이 따로 놀아 "이 시점에 몇 대"를 눈으로 이어 읽을 수 없다.
 */
import { useMemo } from "react";
import { TriangleAlert, CalendarClock, Layers, TrendingUp } from "lucide-react";
import type { BuildingFrameProfile, RentalParams, RentalSpan } from "../types";
import BudgetCompare from "./BudgetCompare";
import {
  axisDayCount,
  buildDecadeAxis,
  cellDayCount,
  dayPercent,
  diffDays,
  isWinterDecade,
  shortYmd,
  type DecadeCell,
} from "../engine/dates";
import { monthlyLoad, type MonthlyLoad } from "../engine/rental";
import { unitColor } from "../theme";

/** 좌측 라벨 / 우측 수치 칸 — 헤더·막대·곡선이 모두 같은 격자를 쓴다 */
const GRID = "232px minmax(0,1fr) 112px";

/** 비가동 구간(설치·해체) 빗금 — 색이 아니라 질감으로 "일 못 하는 기간"을 표시한다 */
const HATCH =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.4) 0 4px, rgba(255,255,255,0) 4px 9px)";

const INSTALL_COLOR = "#94a7ba";
const DEMOB_COLOR = "#6b7f95";

export default function RentalTimeline({
  spans,
  buildings,
  axisFrom,
  axisTo,
  params,
}: {
  spans: RentalSpan[];
  buildings: BuildingFrameProfile[];
  axisFrom: string;
  axisTo: string;
  params: RentalParams;
}) {
  const valid = spans.filter((s) => !s.problem);
  const load = useMemo(() => monthlyLoad(valid), [valid]);

  const totalMonths = valid.reduce((a, s) => a + s.rentalMonths, 0);
  const idleDays = valid.reduce((a, s) => a + s.idleGaps.reduce((x, g) => x + g.days, 0), 0);
  const peak = load.reduce((a, m) => Math.max(a, m.tc + m.hc), 0);
  const tcCount = valid.filter((s) => s.kind === "tc").length;
  const hcCount = valid.filter((s) => s.kind === "hc").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          label="투입 장비"
          value={tcCount + hcCount}
          unit="대"
          sub={`타워크레인 ${tcCount} · 호이스트 ${hcCount}`}
        />
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="총 임대"
          value={totalMonths}
          unit="개월"
          sub="장비별 임대 개월 합계"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="최대 동시 투입"
          value={peak}
          unit="대"
          sub="현장 관리 부하의 정점"
        />
        <StatCard
          icon={<TriangleAlert className="h-4 w-4" />}
          label="유휴"
          value={idleDays}
          unit="일"
          sub={idleDays > 0 ? "배정을 바꾸면 줄일 수 있습니다" : "담당 동 사이 공백 없음"}
          tone={idleDays > 0 ? "warn" : "ok"}
        />
      </div>

      <GanttPanel spans={spans} axisFrom={axisFrom} axisTo={axisTo} params={params} load={load} />

      <BudgetCompare spans={spans} buildings={buildings} params={params} />

      {valid.some((s) => s.idleGaps.length > 0) && <IdlePanel spans={valid} />}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  sub: string;
  tone?: "default" | "warn" | "ok";
}) {
  const palette =
    tone === "warn"
      ? { bar: "#f59e0b", chip: "text-amber-600 bg-amber-50 ring-amber-100" }
      : tone === "ok"
        ? { bar: "#10b981", chip: "text-emerald-600 bg-emerald-50 ring-emerald-100" }
        : { bar: "#0a63b8", chip: "text-[#0a63b8] bg-[#eef5fd] ring-[#dceaf9]" };
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      {/* 상단 얇은 강조선 — 카드마다 의미색을 한 줄로만 쓴다(면으로 칠하면 표가 시끄러워진다) */}
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: palette.bar }} />
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${palette.chip}`}>
          {icon}
        </span>
        <span className="text-[13.5px] font-semibold text-slate-500">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span className="text-[34px] font-bold leading-none tabular-nums tracking-tight text-slate-800">
          {value.toLocaleString()}
        </span>
        <span className="text-[14.5px] font-semibold text-slate-400">{unit}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-slate-400">{sub}</p>
    </div>
  );
}

function GanttPanel({
  spans,
  axisFrom,
  axisTo,
  params,
  load,
}: {
  spans: RentalSpan[];
  axisFrom: string;
  axisTo: string;
  params: RentalParams;
  load: MonthlyLoad[];
}) {
  const axis = useMemo(() => buildDecadeAxis(axisFrom, axisTo), [axisFrom, axisTo]);
  const pct = (ymd: string) => dayPercent(axis, ymd);

  const months = useMemo(() => groupBy(axis, (c) => `${c.year}-${c.month}`), [axis]);
  const years = useMemo(() => groupBy(axis, (c) => String(c.year)), [axis]);
  const winterMonths = useMemo(
    () => months.filter((m) => isWinterDecade(m.cells[0], params.winter.from, params.winter.to)),
    [months, params],
  );

  if (spans.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <p className="text-[15px] text-slate-400">호기를 배정하면 임대 구간이 계산됩니다.</p>
      </section>
    );
  }

  const width = (from: number, to: number) => Math.max(0.4, to - from);
  const totalDays = axisDayCount(axis);
  /** 묶음(연·월)의 시작 위치와 폭을 일수 기준 % 로 */
  const groupLeft = (g: { cells: DecadeCell[] }) => dayPercent(axis, g.cells[0].start);
  const groupWidth = (g: { cells: DecadeCell[] }) =>
    (g.cells.reduce((a, c) => a + cellDayCount(c), 0) / totalDays) * 100;

  /** 트랙 뒤에 깔리는 공통 배경 — 동절기 음영과 연 경계선 */
  const trackBg = (
    <>
      {winterMonths.map((m) => (
        <div
          key={`w-${m.key}`}
          className="absolute inset-y-0 bg-[#e8433c]/[0.05]"
          style={{ left: `${groupLeft(m)}%`, width: `${groupWidth(m)}%` }}
        />
      ))}
      {years.slice(1).map((y) => (
        <div
          key={`y-${y.key}`}
          className="absolute inset-y-0 w-px bg-slate-300/60"
          style={{ left: `${groupLeft(y)}%` }}
        />
      ))}
    </>
  );

  /** 한 호기의 막대 한 줄 — 종류별 묶음에서 공통으로 쓴다 */
  const renderRow = (s: RentalSpan) => {
            const rentalDays = s.rentalDays || 1;
            const activeDays =
              s.activeStart && s.activeEnd ? diffDays(s.activeStart, s.activeEnd) : 0;
            const util = Math.round((activeDays / rentalDays) * 100);
            return (
              <div
                key={s.unitId}
                className="grid items-center gap-3 rounded-md py-0.5 transition-colors hover:bg-slate-50"
                style={{ gridTemplateColumns: GRID }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-flex h-[25px] w-[58px] shrink-0 items-center justify-center rounded text-[12px] font-bold text-white"
                    style={{ background: unitColor(s.no, s.kind) }}
                  >
                    {s.kind === "tc" ? "T/C" : "H/C"} {s.no}
                  </span>
                  <span
                    className="truncate text-[12.5px] text-slate-500"
                    title={s.buildingNames.join(", ")}
                  >
                    {summarizeNames(s.buildingNames)}
                  </span>
                </div>

                <div className="relative h-[30px] overflow-hidden rounded-md bg-slate-100/60">
                  {trackBg}
                  {s.problem ? (
                    <span className="absolute inset-0 flex items-center pl-2.5 text-[12.5px] text-slate-400">
                      {s.problem}
                    </span>
                  ) : (
                    <>
                      <Phase
                        left={pct(s.mobilizeStart)}
                        w={width(pct(s.mobilizeStart), pct(s.activeStart))}
                        color={INSTALL_COLOR}
                        hatched
                        round="l"
                        title={`반입·설치 ${shortYmd(s.mobilizeStart)} ~ ${shortYmd(s.activeStart)} (${diffDays(s.mobilizeStart, s.activeStart)}일)`}
                      />
                      <Phase
                        left={pct(s.activeStart)}
                        w={width(pct(s.activeStart), pct(s.activeEnd))}
                        color={unitColor(s.no, s.kind)}
                        title={`가동 ${shortYmd(s.activeStart)} ~ ${shortYmd(s.activeEnd)} (${activeDays}일)`}
                        label={`${shortYmd(s.mobilizeStart)} ~ ${shortYmd(s.demobEnd)}`}
                      />
                      <Phase
                        left={pct(s.activeEnd)}
                        w={width(pct(s.activeEnd), pct(s.demobEnd))}
                        color={DEMOB_COLOR}
                        hatched
                        round="r"
                        title={`해체·반출 ${shortYmd(s.activeEnd)} ~ ${shortYmd(s.demobEnd)} (${diffDays(s.activeEnd, s.demobEnd)}일)`}
                      />
                      {s.idleGaps.map((g) => (
                        <div
                          key={g.from}
                          title={`유휴 ${g.days}일 · ${shortYmd(g.from)} ~ ${shortYmd(g.to)}`}
                          className="absolute inset-y-0 border-x border-dashed border-rose-300 bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.3)_0_4px,transparent_4px_8px)]"
                          style={{
                            left: `${pct(g.from)}%`,
                            width: `${width(pct(g.from), pct(g.to))}%`,
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <span className="text-[14px] font-bold tabular-nums text-slate-700">
                    {s.rentalMonths}
                    <span className="ml-0.5 text-[11.5px] font-normal text-slate-400">개월</span>
                  </span>
                  <span
                    className="inline-flex h-[21px] w-[44px] items-center justify-center rounded text-[11.5px] font-bold tabular-nums"
                    title={`가동률 — 가동 ${activeDays}일 ÷ 임대 ${rentalDays}일`}
                    style={{
                      background: util >= 85 ? "#e8f7f0" : util >= 70 ? "#fdf3e3" : "#fdeaea",
                      color: util >= 85 ? "#0f7a53" : util >= 70 ? "#9a6412" : "#b3322c",
                    }}
                  >
                    {Number.isFinite(util) ? `${util}%` : "—"}
                  </span>
                </div>
              </div>
            );
          };

  /** 종류별 묶음 — 비어 있는 종류는 아예 내보내지 않는다 */
  const groups = [
    { kind: "tc" as const, label: "타워크레인", accent: "#0a63b8" },
    { kind: "hc" as const, label: "호이스트", accent: "#d2456e" },
  ]
    .map((g) => ({ ...g, rows: spans.filter((s) => s.kind === g.kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold text-slate-800">호기별 임대 구간</span>
          <span className="text-[13px] text-slate-400">반입부터 반출까지가 임대 기간입니다</span>
        </div>
        <div className="flex items-center gap-3">
          <LegendDot color={INSTALL_COLOR} label="반입·설치" hatched />
          <LegendDot color="#0a63b8" label="가동" />
          <LegendDot color={DEMOB_COLOR} label="해체·반출" hatched />
        </div>
      </header>

      <div className="px-4 pb-3 pt-3">
        {/* ── 시간축 헤더 (연 / 월) ── */}
        <div className="grid items-end gap-3" style={{ gridTemplateColumns: GRID }}>
          <span className="pb-0.5 text-[12px] font-semibold text-slate-400">호기 · 담당 동</span>
          <div>
            <div className="relative h-[16px]">
              {years.map((y) => (
                <span
                  key={y.key}
                  className="absolute top-0 whitespace-nowrap border-l border-slate-200 pl-1 text-[11.5px] font-bold text-slate-500"
                  style={{ left: `${groupLeft(y)}%` }}
                >
                  {y.key}
                </span>
              ))}
            </div>
            <div className="relative h-[13px]">
              {months.map((m) => {
                const isWinter = isWinterDecade(m.cells[0], params.winter.from, params.winter.to);
                return (
                  <span
                    key={m.key}
                    className={
                      "absolute top-0 text-[10px] tabular-nums " +
                      (isWinter ? "font-semibold text-[#c0544d]" : "text-slate-400")
                    }
                    style={{ left: `${groupLeft(m)}%` }}
                  >
                    {m.cells.length >= 3 ? m.cells[0].month : ""}
                  </span>
                );
              })}
            </div>
          </div>
          <span className="pb-0.5 text-right text-[12px] font-semibold text-slate-400">
            임대 · 가동률
          </span>
        </div>

        {/* ── 호기별 막대 ── */}
        <div className="mt-1 space-y-3">
          {groups.map((g) => (
            <div key={g.kind}>
              {/* 종류 구분 — T/C 와 H/C 가 한 덩어리로 섞이면 어느 줄이 무엇인지 헷갈린다 */}
              <div className="grid items-center gap-3 pb-1" style={{ gridTemplateColumns: GRID }}>
                <div className="flex items-center gap-1.5">
                  <span className="h-3.5 w-[3px] rounded-full" style={{ background: g.accent }} />
                  <span className="text-[13px] font-bold text-slate-600">{g.label}</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-px text-[11.5px] font-bold text-slate-500">
                    {g.rows.length}대
                  </span>
                </div>
                <span className="h-px bg-slate-100" />
                <span />
              </div>
              <div className="space-y-1">{g.rows.map(renderRow)}</div>
            </div>
          ))}
        </div>

        {/* ── 같은 축 위의 투입 대수 곡선 ── */}
        <LoadCurve
          load={load}
          axis={axis}
          grid={GRID}
          trackBg={trackBg}
          months={months}
        />
      </div>
    </section>
  );
}

/** 담당 동이 많으면 "3603동 외 2개" 로 줄인다 — 잘린 글자보다 개수가 읽기 쉽다 */
function summarizeNames(names: string[]): string {
  if (names.length === 0) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} 외 ${names.length - 1}개`;
}

function Phase({
  left,
  w,
  color,
  title,
  label,
  hatched,
  round,
}: {
  left: number;
  w: number;
  color: string;
  title: string;
  label?: string;
  hatched?: boolean;
  round?: "l" | "r";
}) {
  return (
    <div
      title={title}
      className={
        "absolute inset-y-[3px] flex items-center justify-center overflow-hidden " +
        (round === "l" ? "rounded-l-[4px]" : round === "r" ? "rounded-r-[4px]" : "")
      }
      style={{
        left: `${left}%`,
        width: `${w}%`,
        background: color,
        backgroundImage: hatched ? HATCH : undefined,
      }}
    >
      {label && w > 16 ? (
        <span className="truncate px-2 text-[12px] font-semibold tabular-nums text-white/95">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 투입 대수 계단 곡선 — 위 간트와 같은 가로 좌표를 쓴다.
 * SVG 는 가로만 늘려야 해서 preserveAspectRatio 를 끄고, 선 굵기는
 * vector-effect 로 고정한다(안 하면 늘어난 만큼 선이 납작해진다).
 */
function LoadCurve({
  load,
  axis,
  grid,
  trackBg,
  months,
}: {
  load: MonthlyLoad[];
  axis: DecadeCell[];
  grid: string;
  trackBg: React.ReactNode;
  months: Array<{ key: string; start: number; cells: DecadeCell[] }>;
}) {
  const H = 62;
  const VW = 1000;
  const peak = Math.max(1, ...load.map((m) => m.tc + m.hc));

  const path = useMemo(() => {
    if (load.length === 0) return { area: "", line: "" };
    const byKey = new Map(load.map((m) => [m.ym, m.tc + m.hc]));
    const pts: Array<{ x: number; v: number }> = [];
    for (const m of months) {
      const [y, mo] = m.key.split("-");
      const ym = `${y}-${String(mo).padStart(2, "0")}`;
      pts.push({ x: (dayPercent(axis, m.cells[0].start) / 100) * VW, v: byKey.get(ym) ?? 0 });
    }
    pts.push({ x: VW, v: pts[pts.length - 1]?.v ?? 0 });

    const yOf = (v: number) => H - (v / peak) * (H - 6) - 2;
    let line = "";
    for (let i = 0; i < pts.length - 1; i += 1) {
      const y = yOf(pts[i].v);
      line += `${i === 0 ? "M" : "L"}${pts[i].x.toFixed(1)} ${y.toFixed(1)} L${pts[i + 1].x.toFixed(1)} ${y.toFixed(1)} `;
    }
    const area = `${line}L${VW} ${H} L0 ${H} Z`;
    return { area, line };
  }, [load, months, axis, peak]);

  if (load.length === 0) return null;

  return (
    <div className="mt-2 border-t border-slate-100 pt-2.5">
      <div className="grid items-center gap-3" style={{ gridTemplateColumns: grid }}>
        <div className="flex flex-col">
          <span className="text-[12.5px] font-bold text-slate-600">투입 대수</span>
          <span className="text-[11.5px] text-slate-400">시점별 동시 투입</span>
        </div>

        <div className="relative" style={{ height: H }}>
          <div className="absolute inset-0 overflow-hidden rounded-md bg-slate-50">{trackBg}</div>
          {/* 피크 기준선 */}
          <div
            className="absolute inset-x-0 border-t border-dashed border-slate-300"
            style={{ top: 2 }}
          />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${VW} ${H}`}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="load-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0a63b8" stopOpacity="0.28" />
                <stop offset="1" stopColor="#0a63b8" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <path d={path.area} fill="url(#load-fill)" />
            <path
              d={path.line}
              fill="none"
              stroke="#0a63b8"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="pointer-events-none absolute left-1.5 text-[10.5px] font-bold tabular-nums text-slate-400"
            style={{ top: 3 }}
          >
            피크 {peak}대
          </span>
        </div>

        <div className="text-right">
          <span className="text-[14px] font-bold tabular-nums text-slate-700">{peak}</span>
          <span className="ml-0.5 text-[11.5px] text-slate-400">대</span>
        </div>
      </div>
    </div>
  );
}

function IdlePanel({ spans }: { spans: RentalSpan[] }) {
  const rows = spans.flatMap((s) => s.idleGaps.map((g) => ({ s, g })));
  const total = rows.reduce((a, r) => a + r.g.days, 0);
  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
        <TriangleAlert className="h-4 w-4 text-amber-500" />
        <span className="text-[15px] font-bold text-amber-900">유휴 구간</span>
        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[12.5px] font-bold text-amber-900">
          합계 {total}일
        </span>
        <span className="text-[13px] text-amber-700/80">
          담당 동 사이가 비어 장비가 서 있기만 하는 기간입니다
        </span>
      </header>
      <ul className="divide-y divide-slate-100">
        {rows.map(({ s, g }) => (
          <li
            key={`${s.unitId}-${g.from}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[14px]"
          >
            <span
              className="inline-flex h-[23px] w-[58px] shrink-0 items-center justify-center rounded text-[12px] font-bold text-white"
              style={{ background: unitColor(s.no, s.kind) }}
            >
              {s.kind === "tc" ? "T/C" : "H/C"} {s.no}
            </span>
            <span className="w-[54px] shrink-0 font-bold tabular-nums text-amber-700">
              {g.days}일
            </span>
            <span className="tabular-nums text-slate-500">
              {shortYmd(g.from)} ~ {shortYmd(g.to)}
            </span>
            <span className="text-slate-400">
              {g.afterBuilding} 완료 후 {g.beforeBuilding} 착수까지
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LegendDot({ color, label, hatched }: { color: string; label: string; hatched?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-500">
      <span
        className="inline-block h-2.5 w-4 rounded-[2px]"
        style={{ background: color, backgroundImage: hatched ? HATCH : undefined }}
      />
      {label}
    </span>
  );
}

/** 축 칸을 키로 묶는다 — 연/월 헤더를 한 함수로 만든다 */
function groupBy(axis: DecadeCell[], keyOf: (c: DecadeCell) => string) {
  const out: Array<{ key: string; start: number; cells: DecadeCell[] }> = [];
  for (const c of axis) {
    const key = keyOf(c);
    const last = out[out.length - 1];
    if (last && last.key === key) last.cells.push(c);
    else out.push({ key, start: c.index, cells: [c] });
  }
  return out;
}
