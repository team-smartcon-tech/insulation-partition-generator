/**
 * 동별 간트 (설계 §7 "출력", 디자인 시안 2026-10-29). Smart-Gantt-Chart 저장소에서 이식.
 * - 하루 한 칸, 왼쪽 오전 · 오른쪽 오후. 작업이 있는 반일만 연한 상자. 철근 오전 + 기전 오후는 상자 하나.
 * - 사이클 시작(먹매김) 위에 층 라벨. 일요일 세로 띠. 유휴 줄은 온종일 유휴인 날만 상자.
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
import { cn } from "@/lib/utils";

export type GanttData = SimulateResponse & Partial<Pick<PlanResponse, "asOf" | "buildings" | "actual">>;

type Group = "cure" | "gangform" | "rebar" | "mep" | "alform" | "insulation" | "pour";

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
};

const GROUP_LABEL: Record<Group, string> = {
  cure: "양생·먹매김",
  gangform: "갱폼",
  rebar: "철근",
  mep: "기전(오전)",
  alform: "알폼",
  insulation: "단열재(최상층)",
  pour: "타설",
};

const GROUP_STYLE: Record<Group, string> = {
  cure: "bg-stone-100 border-stone-400",
  gangform: "bg-emerald-100 border-emerald-500",
  rebar: "bg-violet-100 border-violet-500",
  mep: "bg-amber-100 border-amber-500",
  alform: "bg-sky-100 border-sky-500",
  insulation: "bg-pink-100 border-pink-500",
  pour: "bg-rose-100 border-rose-500",
};

const STAGE_TITLE: Record<Stage, string> = {
  MARK: "양생·먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "벽철근",
  WALL_MEP: "기전·검측(벽)",
  ALFORM: "알폼",
  TOP_INSULATION: "단열재(최상층)",
  SLAB_REBAR: "슬래브철근",
  SLAB_MEP: "기전·검측(슬래브)",
  POUR: "타설",
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
};

type Box = { span: "AM" | "PM" | "DAY"; group: Group; title: string };

function dayBoxes(date: string, label: string, am?: Assignment, pm?: Assignment): Box[] {
  const t = (a: Assignment, half: string) => `${date} ${half} · ${label} ${a.floor}F · ${STAGE_TITLE[a.stage]}`;
  if (am && pm) {
    const g1 = STAGE_GROUP[am.stage];
    const g2 = STAGE_GROUP[pm.stage];
    if (g1 === g2 || (g1 === "rebar" && g2 === "mep")) {
      return [{ span: "DAY", group: g1, title: `${t(am, "오전")} / ${STAGE_TITLE[pm.stage]}` }];
    }
    return [
      { span: "AM", group: g1, title: t(am, "오전") },
      { span: "PM", group: g2, title: t(pm, "오후") },
    ];
  }
  if (am) return [{ span: am.stage === "POUR" ? "DAY" : "AM", group: STAGE_GROUP[am.stage], title: t(am, "오전") }];
  if (pm) return [{ span: "PM", group: STAGE_GROUP[pm.stage], title: t(pm, "오후") }];
  return [];
}

function actualBoxes(date: string, label: string, works: ActualWork[]): Box[] {
  const sorted = [...works].sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage]);
  const t = (w: ActualWork) => `${date} 실적 · ${label} ${w.floor}F · ${STAGE_TITLE[w.stage]}`;
  if (sorted.length === 1) return [{ span: "DAY", group: STAGE_GROUP[sorted[0].stage], title: t(sorted[0]) }];
  const [a, b] = [sorted[0], sorted[sorted.length - 1]];
  const g1 = STAGE_GROUP[a.stage];
  const g2 = STAGE_GROUP[b.stage];
  if (g1 === g2 || (g1 === "rebar" && g2 === "mep")) {
    return [{ span: "DAY", group: g1, title: sorted.map(t).join(" / ") }];
  }
  return [
    { span: "AM", group: g1, title: t(a) },
    { span: "PM", group: g2, title: t(b) },
  ];
}

function BoxEl({ box }: { box: Box }) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 rounded-md border",
        GROUP_STYLE[box.group],
        box.span === "DAY" && "inset-x-0.5",
        box.span === "AM" && "left-0.5 right-1/2 mr-px",
        box.span === "PM" && "left-1/2 right-0.5 ml-px",
      )}
      title={box.title}
    />
  );
}

const IDLE_TEAMS: { key: string; label: string; group: Group; stages: Stage[]; canWork: (d: DayInfo) => boolean }[] = [
  { key: "gangform", label: "갱폼 유휴", group: "gangform", stages: ["GANGFORM"], canWork: (d) => d.craneAllowed },
  { key: "rebar", label: "철근 유휴", group: "rebar", stages: ["WALL_REBAR", "SLAB_REBAR"], canWork: (d) => d.workable },
  { key: "alform", label: "알폼 유휴", group: "alform", stages: ["ALFORM"], canWork: (d) => d.workable },
];

export default function GanttChart({ data }: { data: GanttData }) {
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
  const asOf = data.asOf ?? null;
  const isActualDay = (date: string) => asOf !== null && date <= asOf;
  const isPlanStart = (date: string) => asOf !== null && date > asOf && !data.days.some((d) => d.date > asOf && d.date < date);

  const month = Number(data.from.slice(5, 7));
  const gridCols = { gridTemplateColumns: `4.5rem repeat(${data.days.length}, minmax(0, 1fr))` };
  const dayCell = (d: DayInfo, extra?: string) =>
    cn("relative min-w-0", d.isSunday && "bg-muted", isPlanStart(d.date) && "border-l-2 border-primary/60", extra);

  const pourDates = new Set([
    ...data.assignments.filter((a) => a.stage === "POUR").map((a) => a.date),
    ...(data.actual ?? []).filter((a) => a.stage === "POUR").map((a) => a.date),
  ]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
        <div className="min-w-[960px] text-xs">
          <div className="grid" style={gridCols}>
            <div />
            {data.days.map((d) => (
              <div key={d.date} className={cn("text-center text-[11px]", d.isSunday && "text-red-600", d.isSaturday && "text-sky-600")}>
                {d.isSunday ? "일" : d.isSaturday ? "토" : ""}
              </div>
            ))}
          </div>
          <div className="grid border-b border-border pb-1" style={gridCols}>
            <div className="text-sm font-medium text-muted-foreground">{month}월</div>
            {data.days.map((d) => (
              <div
                key={d.date}
                className={cn("text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}
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
                const boxes = isActualDay(d.date) && actual ? actualBoxes(d.date, label(id), actual) : planned ? dayBoxes(d.date, label(id), am, pm) : [];
                const startFloor = actual
                  ? actual.find((w) => w.stage === "MARK")?.floor
                  : am?.stage === "MARK"
                    ? am.floor
                    : pm?.stage === "MARK"
                      ? pm.floor
                      : undefined;
                return (
                  <div key={d.date} className={dayCell(d, "h-14")}>
                    {startFloor !== undefined ? (
                      <div className="absolute left-0.5 top-0.5 text-[10px] leading-none text-muted-foreground">{startFloor}F</div>
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
          {IDLE_TEAMS.map((team) => (
            <div key={team.key} className="grid" style={gridCols}>
              <div className="flex items-center text-[11px] text-muted-foreground">{team.label}</div>
              {data.days.map((d) => {
                const busy = isActualDay(d.date)
                  ? (data.actual ?? []).some((a) => a.date === d.date && team.stages.includes(a.stage))
                  : data.assignments.some((a) => a.date === d.date && team.stages.includes(a.stage));
                const idle = team.canWork(d) && !busy;
                return (
                  <div key={d.date} className={dayCell(d, "h-7")}>
                    <div className="absolute inset-x-0 inset-y-1">
                      {idle ? <BoxEl box={{ span: "DAY", group: team.group, title: `${d.date} ${team.label}` }} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
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
          칸 왼쪽 오전 · 오른쪽 오후 (철근 뒤 기전·검측은 같은 날 오후). 층 라벨은 사이클 시작(먹매김) 위치.
          {asOf ? ` 세로 선 왼쪽은 작업일보 실적(${asOf}까지, 또렷함), 오른쪽은 엔진 예정(연함).` : ""}
        </p>
      </div>
    </div>
  );
}
