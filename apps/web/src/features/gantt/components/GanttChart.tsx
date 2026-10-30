/**
 * 동별 간트 (설계 §7 "출력", 디자인 시안 2026-10-29). Smart-Gantt-Chart 저장소에서 이식.
 * - 하루 한 칸, 왼쪽 오전 · 오른쪽 오후. 작업이 있는 반일만 연한 상자. 철근 오전 + 기전 오후는 상자 하나.
 * - 사이클 시작(먹매김) 위에 층 라벨(옥탑은 PH1·PH2). 날짜마다 세로 구분선, 일요일 세로 띠. 유휴 줄은 온종일 유휴인 날만 상자.
 * - 실적(작업일보, asOf 까지)은 또렷하게, 예정(엔진)은 연하게. 둘 사이에 세로 선.
 */
import type {
  ActualWork,
  Assignment,
  DayInfo,
  PlanResponse,
  SimulateResponse,
  Stage,
} from "@ipg/gantt-engine";
import { useState } from "react";
import { cn } from "@/lib/utils";
import CellReportDialog, { type CellTarget } from "./CellReportDialog";

export type GanttData = SimulateResponse & Partial<Pick<PlanResponse, "asOf" | "buildings" | "actual">>;

type Group = "cure" | "gangform" | "rebar" | "mep" | "alform" | "insulation" | "pour" | "form" | "shoring" | "strip";

const STAGE_GROUP: Record<Stage, Group> = {
  MARK: "cure",
  GANGFORM: "gangform",
  WALL_REBAR: "rebar",
  WALL_MEP: "mep",
  ALFORM: "alform",
  TOP_INSULATION: "insulation",
  SLAB_REBAR: "rebar",
  SLAB_MEP: "mep",
  POUR: "pour",
  CURE: "cure",
  FORM_WALL: "form",
  FORM_SLAB: "form",
  SHORING: "shoring",
  FORM_STRIP: "strip",
};

const GROUP_LABEL: Record<Group, string> = {
  cure: "양생·먹매김",
  gangform: "갱폼",
  rebar: "W·S철근",
  mep: "W·S기전",
  alform: "알폼",
  insulation: "단열재(최상층)",
  pour: "타설",
  form: "W·S거푸집(지하)",
  shoring: "동바리",
  strip: "거푸집 해체",
};

/** 상자 안 세로 글자 (반일 칸이 좁아 짧게). W철근 = 벽철근, S철근 = 슬래브철근 */
const STAGE_TEXT: Record<Stage, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼",
  WALL_REBAR: "W철근",
  WALL_MEP: "W기전",
  ALFORM: "알폼",
  TOP_INSULATION: "단열재",
  SLAB_REBAR: "S철근",
  SLAB_MEP: "S기전",
  POUR: "타설",
  CURE: "양생",
  FORM_WALL: "W거푸집",
  FORM_SLAB: "S거푸집",
  SHORING: "동바리",
  FORM_STRIP: "해체",
};

const GROUP_STYLE: Record<Group, string> = {
  cure: "bg-stone-100 border-stone-400",
  gangform: "bg-emerald-100 border-emerald-500",
  rebar: "bg-violet-100 border-violet-500",
  mep: "bg-amber-100 border-amber-500",
  alform: "bg-sky-100 border-sky-500",
  insulation: "bg-lime-200 border-lime-600", // 타설(장미색)과 구별되게 연두
  pour: "bg-rose-100 border-rose-500",
  form: "bg-sky-100 border-sky-500", // 거푸집 = 알폼과 같은 색 (2026-10-30 사용자 요청)
  shoring: "bg-slate-200 border-slate-500",
  strip: "bg-sky-50 border-sky-400 border-dashed", // 거푸집 해체 = 같은 계열 점선
};

const STAGE_TITLE: Record<Stage, string> = {
  MARK: "양생·먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "W철근(벽철근)",
  WALL_MEP: "W기전(벽 기전·검측)",
  ALFORM: "알폼",
  TOP_INSULATION: "바닥단열재(최상층)",
  SLAB_REBAR: "S철근(슬래브철근)",
  SLAB_MEP: "S기전(슬래브 기전·검측)",
  POUR: "타설",
  CURE: "양생",
  FORM_WALL: "W거푸집(벽체 거푸집)",
  FORM_SLAB: "S거푸집(바닥 거푸집)",
  SHORING: "시스템 동바리",
  FORM_STRIP: "거푸집 해체",
};

const STAGE_INDEX: Record<Stage, number> = {
  MARK: 0,
  GANGFORM: 1,
  WALL_REBAR: 2,
  WALL_MEP: 3,
  ALFORM: 4,
  TOP_INSULATION: 5,
  SLAB_REBAR: 6,
  SLAB_MEP: 7,
  POUR: 8,
  CURE: 9,
  // 지하·저층 순서: 해체 → 벽 거푸집 → 벽 철근 → 기전 → 동바리 → 바닥 거푸집 → 바닥 철근 → 기전 → 타설
  FORM_STRIP: -1,
  FORM_WALL: 1.5,
  SHORING: 4.2,
  FORM_SLAB: 4.5,
};

/** 실적 층 표시: RF 같은 표기 그대로, 지하는 B1F */
const actualFloorText = (w: { floor: number; floorLabel?: string }) => w.floorLabel ?? (w.floor < 0 ? `B${-w.floor}F` : `${w.floor}F`);

/** 층 표시: 옥탑은 PH1·PH2, 그 외 42F */
const floorLabel = (a: { floor: number; roof?: number }) => (a.roof ? `PH${a.roof}` : `${a.floor}F`);

type Box = {
  span: "AM" | "PM" | "DAY";
  group: Group;
  title: string;
  text?: string;
  /** 실적처럼 반일 구분이 없는 날: 하루를 n 칸으로 나눈 i 번째 (0부터) */
  seg?: { i: number; n: number };
  /** 유휴 줄: 그달 몇 번째 유휴일인가 (가로 숫자) */
  count?: number;
};

/** 글자: 같은 작업이 여러 칸 이어지면(cont = 앞 칸과 같은 작업) 첫 칸에만 */
const textOf = (stage: Stage, cont: boolean) => (cont ? undefined : STAGE_TEXT[stage]);
/** 옥탑은 알폼이 아니라 일반 거푸집 */
const isRoofForm = (a: { stage: Stage; roof?: number }) => a.stage === "ALFORM" && a.roof != null;
const planText = (a: Assignment, cont: boolean) => (cont ? undefined : isRoofForm(a) ? "거푸집" : STAGE_TEXT[a.stage]);
const planTitle = (a: Assignment) => (isRoofForm(a) ? "거푸집(옥탑)" : STAGE_TITLE[a.stage]);

/**
 * 예정 하루 → 상자. 오전·오후가 같은 작업(알폼·단열재·옥탑 등)이면 하루 상자 하나, 아니면 반일 상자 둘.
 * 철근 오전 + 기전 오후도 합치지 않는다 — W철근 → 기전 → 알폼 → S철근 → 기전 순서가 보여야 한다.
 */
function dayBoxes(date: string, label: string, am: Assignment | undefined, pm: Assignment | undefined, cont: (a: Assignment) => boolean): Box[] {
  const t = (a: Assignment, half: string) => `${date} ${half} · ${label} ${floorLabel(a)} · ${planTitle(a)}`;
  if (am && pm) {
    if (am.stage === pm.stage) {
      return [{ span: "DAY", group: STAGE_GROUP[am.stage], title: `${t(am, "오전·오후")}`, text: planText(am, cont(am)) }];
    }
    return [
      { span: "AM", group: STAGE_GROUP[am.stage], title: t(am, "오전"), text: planText(am, cont(am)) },
      { span: "PM", group: STAGE_GROUP[pm.stage], title: t(pm, "오후"), text: planText(pm, cont(pm)) },
    ];
  }
  if (am) return [{ span: am.stage === "POUR" ? "DAY" : "AM", group: STAGE_GROUP[am.stage], title: t(am, "오전"), text: planText(am, cont(am)) }];
  if (pm) return [{ span: "PM", group: STAGE_GROUP[pm.stage], title: t(pm, "오후"), text: planText(pm, cont(pm)) }];
  return [];
}

/**
 * 실적 하루 → 상자. 일보에는 오전·오후가 없으므로 그날 적힌 공종을 사이클 순서대로 하루를 나눠 모두 그린다
 * (예전에는 첫·마지막 두 개만 그려 가운데 공종이 빠졌다).
 */
function actualBoxes(date: string, label: string, works: ActualWork[], cont: (w: ActualWork) => boolean): Box[] {
  // 층과 상관없이 사이클 순서(먹매김 → 갱폼 → W철근 → 기전 → 알폼 → 단열재 → S철근 → 기전 → 타설)로만 줄 세운다.
  // 설비 구간에 다른 층 배관이 같이 적혀도 W철근 앞에 기전이 서지 않게. 같은 공종은 한 칸(높은 층 기준)
  const byStage = new Map<Stage, ActualWork>();
  for (const w of works) {
    const p = byStage.get(w.stage);
    if (!p || w.floor > p.floor) byStage.set(w.stage, w);
  }
  const sorted = [...byStage.values()].sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage]);
  // 툴팁에는 그날 적힌 층을 모두 보여 준다 (합친 칸도 원문 층을 확인할 수 있게)
  const floorsOf = (stage: Stage) => [...new Set(works.filter((w) => w.stage === stage).map(actualFloorText))].join("·");
  const t = (w: ActualWork) => `${date} 실적 · ${label} ${floorsOf(w.stage)} · ${STAGE_TITLE[w.stage]}`;
  if (sorted.length === 1) return [{ span: "DAY", group: STAGE_GROUP[sorted[0].stage], title: t(sorted[0]), text: textOf(sorted[0].stage, cont(sorted[0])) }];
  // 한 칸에 4개 이상이면 상자가 너무 좁아 글자는 숨긴다 (툴팁·칸 클릭 팝업으로 확인)
  const showText = sorted.length < 4;
  return sorted.map((w, i) => ({
    span: "DAY",
    group: STAGE_GROUP[w.stage],
    title: t(w),
    text: showText ? textOf(w.stage, cont(w)) : undefined,
    seg: { i, n: sorted.length },
  }));
}

function BoxEl({ box }: { box: Box }) {
  const seg = box.seg;
  return (
    <div
      className={cn(
        "absolute inset-y-0 rounded-md border",
        GROUP_STYLE[box.group],
        !seg && box.span === "DAY" && "inset-x-0.5",
        !seg && box.span === "AM" && "left-0.5 right-1/2 mr-px",
        !seg && box.span === "PM" && "left-1/2 right-0.5 ml-px",
        (box.text || box.count != null) && "flex items-center justify-center overflow-hidden",
      )}
      style={seg ? { left: `calc(${(seg.i / seg.n) * 100}% + 2px)`, width: `calc(${100 / seg.n}% - 3px)` } : undefined}
      title={box.title}
    >
      {box.count != null ? (
        <span className="select-none text-[10px] font-semibold leading-none tabular-nums text-foreground/70">{box.count}</span>
      ) : null}
      {box.text ? (
        // 세로 글자는 넘치면 왼쪽 줄로 꺾여 "집 S거푸" 처럼 읽힌다 — 줄바꿈 금지, 4글자 이상은 한 단계 작게
        <span
          className={cn(
            "select-none whitespace-nowrap font-medium leading-none tracking-tighter text-foreground/75 [text-orientation:upright] [writing-mode:vertical-rl]",
            box.text.length >= 4 ? "text-[8.5px]" : "text-[10px]",
          )}
        >
          {box.text}
        </span>
      ) : null}
    </div>
  );
}

const IDLE_TEAMS: { key: string; label: string; group: Group; stages: Stage[] }[] = [
  { key: "gangform", label: "갱폼 유휴", group: "gangform", stages: ["GANGFORM"] },
  { key: "rebar", label: "철근 유휴", group: "rebar", stages: ["WALL_REBAR", "SLAB_REBAR"] },
  { key: "alform", label: "알폼 유휴", group: "alform", stages: ["ALFORM"] },
];

export default function GanttChart({ data, siteId = null }: { data: GanttData; siteId?: string | null }) {
  // 칸을 누르면 그날 그 동의 작업일보 팝업
  const [target, setTarget] = useState<CellTarget | null>(null);
  const byCell = new Map<string, Assignment>();
  for (const a of data.assignments) byCell.set(`${a.date}|${a.half}|${a.buildingId}`, a);
  const get = (date: string, half: "AM" | "PM", id: number) => byCell.get(`${date}|${half}|${id}`);

  const labelOf = new Map((data.buildings ?? []).map((b) => [b.id, b.label]));
  const label = (id: number) => labelOf.get(id) ?? `${id}동`;
  const actualByCell = new Map<string, ActualWork[]>();
  for (const w of data.actual ?? []) {
    const k = `${w.date}|${w.buildingId}`;
    actualByCell.set(k, [...(actualByCell.get(k) ?? []), w]);
  }
  // 이어지는 칸: 같은 동에서 바로 앞 작업이 같은 공종·같은 층(옥탑 포함)이면 같은 작업의 둘째 칸 이후다.
  // 공종은 층마다 한 번씩만 나오므로 앞 작업과 같으면 이어진 것 (일요일을 건너도 이어진다)
  const same = (x: { stage: Stage; floor: number; roof?: number }, y: { stage: Stage; floor: number; roof?: number }) =>
    x.stage === y.stage && x.floor === y.floor && (x.roof ?? 0) === (y.roof ?? 0);
  const contPlan = new Set<Assignment>();
  const prevPlan = new Map<number, Assignment>();
  for (const a of [...data.assignments].sort((x, y) => x.date.localeCompare(y.date) || x.half.localeCompare(y.half))) {
    const p = prevPlan.get(a.buildingId);
    if (p && same(p, a)) contPlan.add(a);
    prevPlan.set(a.buildingId, a);
  }
  // 실적은 반일 구분이 없어 날짜 단위로 본다: 그 동의 앞 실적 날짜에 같은 작업이 있으면 이어진 것
  const contActual = new Set<ActualWork>();
  const actualDays = new Map<number, Map<string, ActualWork[]>>();
  for (const w of data.actual ?? []) {
    const byDate = actualDays.get(w.buildingId) ?? new Map<string, ActualWork[]>();
    byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
    actualDays.set(w.buildingId, byDate);
  }
  // 지하·저층(먹매김이 없는 공정): 그 동의 작업 층이 앞 실적 날과 달라진 날 칸 위에 층 라벨 ("B1F·1F")
  const ugFloorLabel = new Map<string, string>();
  for (const [id, byDate] of actualDays) {
    const dates = [...byDate.keys()].sort();
    let prevKey = "";
    dates.forEach((date, i) => {
      const prev = i > 0 ? byDate.get(dates[i - 1])! : [];
      for (const w of byDate.get(date)!) if (prev.some((x) => same(x, w))) contActual.add(w);
      const works = byDate.get(date)!;
      if (works.some((w) => w.stage === "MARK") || !works.some((w) => w.floor < 2 || w.floorLabel != null)) {
        prevKey = "";
        return;
      }
      const floors = [...new Set([...works].sort((a, b) => a.floor - b.floor).map(actualFloorText))];
      const key = floors.join("·");
      if (key !== prevKey) ugFloorLabel.set(`${date}|${id}`, key);
      prevKey = key;
    });
  }
  const asOf = data.asOf ?? null;
  const isActualDay = (date: string) => asOf !== null && date <= asOf;
  const isPlanStart = (date: string) => asOf !== null && date > asOf && !data.days.some((d) => d.date > asOf && d.date < date);

  const month = Number(data.from.slice(5, 7));
  const gridCols = { gridTemplateColumns: `5.5rem repeat(${data.days.length}, minmax(0, 1fr))` };
  const dayCell = (d: DayInfo, extra?: string) =>
    cn("relative min-w-0 border-r border-border/50", d.isSunday && "bg-muted", isPlanStart(d.date) && "border-l-2 border-l-primary/60", extra);

  const pourDates = new Set([
    ...data.assignments.filter((a) => a.stage === "POUR").map((a) => a.date),
    ...(data.actual ?? []).filter((a) => a.stage === "POUR").map((a) => a.date),
  ]);

  return (
    <div className="space-y-3">
      {target ? <CellReportDialog siteId={siteId} target={target} onClose={() => setTarget(null)} /> : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
        <div className="min-w-[960px] text-xs">
          <div className="grid" style={gridCols}>
            <div />
            {data.days.map((d) => (
              <div key={d.date} className={cn("border-r border-border/50 text-center text-[11px]", d.isSunday && "text-red-600", d.isSaturday && "text-sky-600")}>
                {d.isSunday ? "일" : d.isSaturday ? "토" : ""}
              </div>
            ))}
          </div>
          <div className="grid border-b border-border pb-1" style={gridCols}>
            <div className="text-sm font-medium text-muted-foreground">{month}월</div>
            {data.days.map((d) => (
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}
                title={d.isHoliday ? `${d.date} 공휴일` : d.date}
              >
                {Number(d.date.slice(8))}
              </div>
            ))}
          </div>

          {data.buildingIds.map((id) => (
            <div key={id} className="grid border-b border-border/60" style={gridCols}>
              <div className="flex items-end pb-2 text-sm font-semibold">{label(id)}</div>
              {data.days.map((d) => {
                const actual = actualByCell.get(`${d.date}|${id}`);
                const am = get(d.date, "AM", id);
                const pm = get(d.date, "PM", id);
                const planned = !isActualDay(d.date);
                const boxes = isActualDay(d.date) && actual ? actualBoxes(d.date, label(id), actual, (w) => contActual.has(w)) : planned ? dayBoxes(d.date, label(id), am, pm, (a) => contPlan.has(a)) : [];
                // 사이클 시작(먹매김) 칸에 층 라벨 (옥탑은 PH1·PH2)
                const markActual = actual?.find((w) => w.stage === "MARK");
                const markPlan = am?.stage === "MARK" ? am : pm?.stage === "MARK" ? pm : undefined;
                const startFloor = actual
                  ? markActual
                    ? actualFloorText(markActual)
                    : ugFloorLabel.get(`${d.date}|${id}`)
                  : markPlan
                    ? floorLabel(markPlan)
                    : undefined;
                return (
                  <div
                    key={d.date}
                    className={dayCell(d, "h-[4.25rem] cursor-pointer hover:bg-primary/5")}
                    title={`${label(id)} ${d.date} — 눌러서 작업일보 보기`}
                    onClick={() =>
                      setTarget({ date: d.date, buildingId: id, label: label(id), isActual: isActualDay(d.date), actual: actual ?? [], am, pm })
                    }
                  >
                    {startFloor !== undefined ? (
                      <div className="absolute left-0.5 top-0.5 whitespace-nowrap text-[10px] leading-none text-muted-foreground">{startFloor}</div>
                    ) : null}
                    <div className={cn("absolute inset-x-0 bottom-1.5 top-4", planned && asOf !== null && "opacity-60")}>
                      {boxes.map((b, i) => (
                        <BoxEl key={i} box={b} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="mt-1 border-t-2 border-border" />
          {IDLE_TEAMS.map((team) => {
            // 유휴일 = 그달 그 팀 작업이 하나도 없는 날. 일요일·공휴일 포함(팀 체류 기준, 설계 §5 "일요일 포함 월 허용 유휴").
            // 상자 안 숫자는 그달 몇 번째 유휴일인지. 옥탑 갱폼·철근·거푸집도 그 팀 작업일로 센다.
            const idleDays = data.days.filter((d) =>
              isActualDay(d.date)
                ? !(data.actual ?? []).some((a) => a.date === d.date && team.stages.includes(a.stage))
                : !data.assignments.some((a) => a.date === d.date && team.stages.includes(a.stage)),
            ).map((d) => d.date);
            // 그달 작업이 하루도 없는 팀(아직 현장에 없음 — 지하 공정 현장의 갱폼·알폼 등)은 줄을 숨긴다
            if (idleDays.length === data.days.length) return null;
            const nth = new Map(idleDays.map((date, i) => [date, i + 1]));
            return (
              <div key={team.key} className="grid" style={gridCols}>
                <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
                  {team.label}
                  <b className="font-semibold tabular-nums text-foreground">{idleDays.length}일</b>
                </div>
                {data.days.map((d) => {
                  const n = nth.get(d.date);
                  return (
                    <div key={d.date} className={dayCell(d, "h-7")}>
                      <div className="absolute inset-x-0 inset-y-1">
                        {n != null ? (
                          <BoxEl box={{ span: "DAY", group: team.group, title: `${d.date} ${team.label} · 이달 ${n}일째${d.isSunday ? " (일요일)" : d.isHoliday ? " (공휴일)" : ""}`, count: n }} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="grid" style={gridCols}>
            <div className="flex items-center text-[11px] text-muted-foreground">타설 없음</div>
            {data.days.map((d) => (
              <div key={d.date} className={dayCell(d, "h-7")}>
                <div className="absolute inset-x-0 inset-y-1">
                  {d.isSunday ? null : !d.pourAllowed ? (
                    <div className="absolute inset-x-0.5 inset-y-0 rounded-md border border-dashed border-border" title={`${d.date} 타설 불가 (${d.isHoliday ? "공휴일" : "토요일"})`} />
                  ) : !pourDates.has(d.date) ? (
                    <BoxEl box={{ span: "DAY", group: "pour", title: `${d.date} 타설 없음` }} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
            <span key={g} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-3.5 w-4 rounded border", GROUP_STYLE[g])} />
              {GROUP_LABEL[g]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-4 rounded border border-dashed border-border" />
            휴일 불가
          </span>
        </div>
        <p>
          칸 왼쪽 오전 · 오른쪽 오후. W철근·W기전 = 벽철근·벽 기전, S철근·S기전 = 슬래브철근·슬래브 기전. 실적은 오전·오후 구분이 없어 그날 공종을 순서대로 나눠 그림. 층 라벨은 사이클 시작(먹매김) 위치, PH1·PH2 는 옥탑(층당 15일, 알폼 대신 거푸집). 유휴 줄은 그달 팀 작업이 없는 날(일요일·공휴일 포함), 상자 숫자는 이달 몇 번째 유휴일.
           칸을 누르면 그날 그 동의 작업일보.{asOf ? ` 세로 선 왼쪽은 작업일보 실적(${asOf}까지, 또렷함), 오른쪽은 엔진 예정(연함).` : ""}
        </p>
      </div>
    </div>
  );
}
