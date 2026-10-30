/**
 * 동별 간트 (설계 §7 "출력", 디자인 시안 2026-10-29). Smart-Gantt-Chart 저장소에서 이식.
 * - 하루 한 칸, 왼쪽 오전 · 오른쪽 오후. 작업이 있는 반일만 연한 상자. 철근 오전 + 기전 오후는 상자 하나.
 * - 사이클 시작(먹매김) 위에 층 라벨(옥탑은 PH1·PH2). 날짜마다 세로 구분선, 일요일 세로 띠. 유휴 줄은 온종일 유휴인 날만 상자.
 * - 실적(작업일보, asOf 까지)은 또렷하게, 예정(엔진)은 연하게. 오늘은 날짜 머리줄 칸을 채워 표시(2026-10-30, 세로 선 대신). 요일은 월~일 모두.
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
import { todayKst } from "../dates";
import {
  GROUP_LABEL,
  STAGE_GROUP,
  STAGE_INDEX,
  STAGE_TEXT,
  STAGE_TITLE,
  actualFloorText,
  floorLabel,
  isPour,
  type Group,
} from "../ganttLabels";

export type GanttData = SimulateResponse & Partial<Pick<PlanResponse, "asOf" | "buildings" | "actual">>;

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
};


type Box = {
  span: "AM" | "PM" | "DAY";
  group: Group;
  title: string;
  text?: string;
  /** 실적처럼 반일 구분이 없는 날: 하루를 위에서부터 n 줄로 나눈 i 번째 (0부터) */
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
  if (am) return [{ span: isPour(am.stage) ? "DAY" : "AM", group: STAGE_GROUP[am.stage], title: t(am, "오전"), text: planText(am, cont(am)) }];
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
        // 하루 칸 = 위 오전 · 아래 오후 (2026-10-30 사용자: 열이 아니라 행으로)
        "absolute inset-x-0.5 rounded-md border",
        GROUP_STYLE[box.group],
        !seg && box.span === "DAY" && "inset-y-0",
        !seg && box.span === "AM" && "top-0 bottom-1/2 mb-px",
        !seg && box.span === "PM" && "top-1/2 bottom-0 mt-px",
        (box.text || box.count != null) && "flex items-center justify-center overflow-hidden",
      )}
      style={seg ? { top: `calc(${(seg.i / seg.n) * 100}% + 1px)`, height: `calc(${100 / seg.n}% - 2px)` } : undefined}
      title={box.title}
    >
      {box.count != null ? (
        <span className="select-none text-[10px] font-semibold leading-none tabular-nums text-foreground/70">{box.count}</span>
      ) : null}
      {box.text ? (
        // 가로 글자, 줄바꿈 금지, 4글자 이상은 한 단계 작게
        <span
          className={cn(
            "select-none whitespace-nowrap font-medium leading-none tracking-tighter text-foreground/75",
            box.text.length >= 4 ? "text-[9px]" : "text-[10px]",
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
  // 지하·저층 예정(먹매김 없음): 동별로 새 사이클 층을 시작하는 첫날에 층 라벨
  const planStoryStart = new Map<string, Assignment>();
  {
    const seen = new Set<string>();
    for (const a of [...data.assignments].sort((x, y) => x.date.localeCompare(y.date))) {
      if (a.roof != null || !(a.floor < 2 || ["FORM_WALL", "FORM_SLAB", "SHORING", "POUR_WALL", "POUR_COLUMN"].includes(a.stage))) continue;
      const k = `${a.buildingId}|${a.floor}`;
      if (seen.has(k)) continue;
      seen.add(k);
      planStoryStart.set(`${a.date}|${a.buildingId}`, a);
    }
  }
  // 실적은 반일 구분이 없어 날짜 단위로 본다: 그 동의 앞 실적 날짜에 같은 작업이 있으면 이어진 것
  const contActual = new Set<ActualWork>();
  const actualDays = new Map<number, Map<string, ActualWork[]>>();
  for (const w of data.actual ?? []) {
    const byDate = actualDays.get(w.buildingId) ?? new Map<string, ActualWork[]>();
    byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
    actualDays.set(w.buildingId, byDate);
  }
  // 실적 층 라벨: 동별로 사이클 층이 처음 올라간 날(그달 첫 실적 날 포함)에 그 층.
  // 그날 층 = 숫자 층 실적 중 가장 높은 층 — 아래층에 섞인 기록(다른 층 시스템 동바리 등)이나 RF·「층?」 으로는 라벨을 바꾸지 않는다.
  // 먹매김이 없는 일보(화성·지하 현장)도 층이 보이게 (2026-10-30)
  const actualStoryLabel = new Map<string, string>();
  for (const [id, byDate] of actualDays) {
    const dates = [...byDate.keys()].sort();
    let maxSeen = -Infinity;
    let roofSeen = "";
    dates.forEach((date, i) => {
      const prev = i > 0 ? byDate.get(dates[i - 1])! : [];
      for (const w of byDate.get(date)!) if (prev.some((x) => same(x, w))) contActual.add(w);
      const numeric = byDate.get(date)!.filter((w) => w.floorLabel == null);
      // 옥탑 공사: 숫자 층이 없고 「옥탑…」 표기만 있으면 그 표기가 바뀐 날 라벨 (부산장안)
      const roof = byDate.get(date)!.find((w) => w.floorLabel?.startsWith("옥탑"));
      if (!numeric.length && roof) {
        if (roofSeen !== roof.floorLabel) actualStoryLabel.set(`${date}|${id}`, roof.floorLabel!);
        roofSeen = roof.floorLabel!;
        return;
      }
      if (!numeric.length) return;
      const top = numeric.reduce((m, w) => (w.floor > m.floor ? w : m));
      if (top.floor > maxSeen) {
        actualStoryLabel.set(`${date}|${id}`, actualFloorText(top));
        maxSeen = top.floor;
      }
    });
  }
  const asOf = data.asOf ?? null;
  const isActualDay = (date: string) => asOf !== null && date <= asOf;
  const today = todayKst();

  const month = Number(data.from.slice(5, 7));
  const gridCols = { gridTemplateColumns: `5.5rem repeat(${data.days.length}, minmax(0, 1fr))` };
  const dayCell = (d: DayInfo, extra?: string) =>
    cn("relative min-w-0 border-r border-border/50", d.isSunday && "bg-muted", extra);

  const pourDates = new Set([
    ...data.assignments.filter((a) => isPour(a.stage)).map((a) => a.date),
    ...(data.actual ?? []).filter((a) => isPour(a.stage)).map((a) => a.date),
  ]);

  return (
    <div className="space-y-3">
      {target ? <CellReportDialog siteId={siteId} target={target} onClose={() => setTarget(null)} /> : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
        <div className="min-w-[960px] text-xs">
          <div className="grid" style={gridCols}>
            <div />
            {data.days.map((d) => (
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center text-[11px]", d.isSunday || d.isHoliday ? "text-red-600" : d.isSaturday ? "text-sky-600" : "text-muted-foreground")}
              >
                {"일월화수목금토"[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
              </div>
            ))}
          </div>
          <div className="grid border-b border-border pb-1" style={gridCols}>
            <div className="text-sm font-medium text-muted-foreground">{month}월</div>
            {data.days.map((d) => (
              <div
                key={d.date}
                className={cn("border-r border-border/50 text-center tabular-nums", (d.isSunday || d.isHoliday) && "font-semibold text-red-600")}
                title={d.date === today ? `${d.date} 오늘` : d.isHoliday ? `${d.date} 공휴일` : d.date}
              >
                {d.date === today ? <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-primary px-1 font-semibold text-primary-foreground">{Number(d.date.slice(8))}</span> : Number(d.date.slice(8))}
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
                const markPlan = am?.stage === "MARK" ? am : pm?.stage === "MARK" ? pm : planStoryStart.get(`${d.date}|${id}`);
                const startFloor = actual
                  ? actualStoryLabel.get(`${d.date}|${id}`)
                  : markPlan
                    ? floorLabel(markPlan)
                    : undefined;
                return (
                  <div
                    key={d.date}
                    className={dayCell(d, "h-[4.75rem] cursor-pointer hover:bg-primary/5")}
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
          칸 위 오전 · 아래 오후. W철근·W기전 = 벽철근·벽 기전, S철근·S기전 = 슬래브철근·슬래브 기전. 실적은 오전·오후 구분이 없어 그날 공종을 순서대로 위에서부터 나눠 그림. 층 라벨은 사이클 시작(먹매김) 위치, PH1·PH2 는 옥탑(층당 15일, 알폼 대신 거푸집). 유휴 줄은 그달 팀 작업이 없는 날(일요일·공휴일 포함), 상자 숫자는 이달 몇 번째 유휴일.
           칸을 누르면 그날 그 동의 작업일보.{asOf ? ` 작업일보 실적(${asOf}까지)은 또렷하게, 그 뒤 엔진 예정은 연하게.` : ""} 채운 날짜 = 오늘.
        </p>
      </div>
    </div>
  );
}
