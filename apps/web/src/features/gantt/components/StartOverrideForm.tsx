/**
 * 출발 상태 보정 (2026-11-02 사용자: 「달력 첫날 작업을 수정할 수 있나」 → 1안).
 * 예정은 마지막 작업일보에서 동마다 「몇 층·어느 공종까지 했는지」를 읽어 출발한다. 그게 현장과 다르면 여기서 동마다
 * 예정 첫날의 층·공종을 직접 정한다. 값에는 예정 시작일(from)을 같이 저장해, 새 일보가 들어와 시작일이 바뀌면 서버가 무시한다.
 * 층이 기준층 시작보다 낮으면 지하·저층 순서표, 아니면 기준층 사이클의 공종.
 */
import { X } from "lucide-react";
import type { SiteSettings, Stage } from "@ipg/gantt-engine";
import { STAGE_TITLE, floorLabel } from "../ganttLabels";
import { NumInput } from "./StepInput";

type Override = { from: string; floor: number; stage: string };

/** 기준층 사이클에서 고를 수 있는 공종 (순서대로) */
const BASE_STAGES: Stage[] = ["MARK", "GANGFORM", "WALL_REBAR", "WALL_MEP", "ALFORM", "TOP_INSULATION", "SLAB_REBAR", "SLAB_MEP", "POUR"];
/** 지하·저층(재래식) 순서표 공종 */
const UG_STAGES: Stage[] = ["MARK", "GANGFORM", "WALL_REBAR", "WALL_MEP", "FORM_WALL", "POUR_WALL", "SHORING", "FORM_SLAB", "SLAB_REBAR", "SLAB_MEP", "POUR"];

export default function StartOverrideForm({
  value,
  onChange,
  planFrom,
  buildings,
  computed,
  stale,
}: {
  value: SiteSettings;
  onChange: (next: SiteSettings) => void;
  /** 이번 예정 시작일 (마지막 일보 다음 날) */
  planFrom: string;
  /** 줄: 동 번호·이름·기준층 시작 */
  buildings: { id: number; label: string; baseFloor: number }[];
  /** 엔진이 일보로 정한 예정 첫 공종 (그 달에 보이면) */
  computed: Map<number, { stage: Stage; floor: number }>;
  /** 저장돼 있지만 예정 시작일이 달라 무시된 동 */
  stale: number[];
}) {
  const all = (value.startOverrides ?? {}) as Record<string, Override>;
  const setOne = (id: number, next: Override | null) => {
    const copy = { ...all };
    if (next) copy[String(id)] = next;
    else delete copy[String(id)];
    onChange({ ...value, startOverrides: copy });
  };
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="mb-1 text-sm font-semibold">출발 상태 보정</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        예정 첫날({md(planFrom)}) 동마다 할 층·공종. 일보에서 읽은 위치가 현장과 다를 때만 바꾸세요. 새 일보가 들어오면 자동으로 풀립니다.
      </p>
      <div className="space-y-1.5">
        {buildings.map((b) => {
          const o = all[String(b.id)];
          const active = o && o.from === planFrom ? o : null;
          const cur = computed.get(b.id);
          const floor = active?.floor ?? cur?.floor ?? b.baseFloor;
          const stage = (active?.stage ?? cur?.stage ?? "MARK") as Stage;
          const options = floor < b.baseFloor ? UG_STAGES : BASE_STAGES;
          const put = (patch: Partial<Override>) => setOne(b.id, { from: planFrom, floor, stage, ...patch });
          return (
            <div key={b.id} className="flex items-center gap-1.5 text-sm">
              <span className="w-12 shrink-0 truncate font-medium" title={b.label}>
                {b.label}
              </span>
              <NumInput className="w-[50px]" min={-10} max={80} value={floor} aria-label={`${b.label} 층`} onValue={(v) => v != null && v !== 0 && put({ floor: v })} />
              <span className="shrink-0 text-xs text-muted-foreground">{floor < 0 ? `B${-floor}` : "F"}</span>
              <select
                value={options.includes(stage) ? stage : options[0]}
                onChange={(e) => put({ stage: e.target.value })}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1 text-xs"
                aria-label={`${b.label} 공종`}
              >
                {options.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_TITLE[s]}
                  </option>
                ))}
              </select>
              {active ? (
                <button
                  type="button"
                  onClick={() => setOne(b.id, null)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-primary hover:bg-muted"
                  title={`보정 지우기 (일보 기준${cur ? `: ${floorLabel(cur)} ${STAGE_TITLE[cur.stage]}` : ""})`}
                  aria-label={`${b.label} 보정 지우기`}
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
      {stale.length ? (
        <p className="mt-2 text-xs text-amber-700">
          {stale.map((n) => `${n}동`).join("·")}: 저장된 보정은 예전 예정 시작일 기준이라 쓰지 않았습니다(새 일보 반영). 다시 정하거나 지우세요.
        </p>
      ) : null}
    </div>
  );
}
