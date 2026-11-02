/**
 * 출발 상태 보정 팝업 (2026-11-02 사용자: 「달력 첫날 작업을 수정할 수 있나」 → 1안, 「동 숫자를 누르면 동 옆에 팝업처럼」).
 * 예정은 마지막 작업일보에서 동마다 「몇 층·어느 공종까지 했는지」를 읽어 출발한다. 그게 현장과 다르면 간트의 동 이름을 눌러
 * 예정 첫날의 층·공종을 직접 정한다. 값에는 예정 시작일(from)을 같이 저장해, 새 일보가 들어와 시작일이 바뀌면 서버가 무시한다.
 * 층이 기준층 시작보다 낮으면 지하·저층 순서표, 아니면 기준층 사이클의 공종.
 */
import { useEffect, useRef } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SiteSettings, Stage } from "@ipg/gantt-engine";
import { STAGE_TITLE, floorLabel } from "../ganttLabels";
import { NumInput } from "./StepInput";

/**
 * stage = 오전 공종(amEmpty 면 오후 공종), pm = 오후 공종, amEmpty = 첫날 오전 비움(오후만 고정), pmEmpty = 첫날 오후 비움,
 * free = 고정 안 함 — stage 는 엔진이 출발할 공종일 뿐 (층만 바꾸거나, 비운 칸 다음부터 엔진)
 */
export type Override = { from: string; floor: number; stage: string; pm?: string; amEmpty?: boolean; pmEmpty?: boolean; free?: boolean };

/** 팝업 선택값: 엔진이 정함 / 비어 있음 / 공종 */
const AUTO = "";
const EMPTY = "EMPTY";
type Pick = Stage | typeof AUTO | typeof EMPTY;
const isStage = (v: Pick): v is Stage => v !== AUTO && v !== EMPTY;

/** 기준층 사이클에서 고를 수 있는 공종 (순서대로) */
const BASE_STAGES: Stage[] = ["MARK", "GANGFORM", "WALL_REBAR", "WALL_MEP", "ALFORM", "TOP_INSULATION", "SLAB_REBAR", "SLAB_MEP", "POUR"];
/** 지하·저층(재래식) 순서표 공종 */
const UG_STAGES: Stage[] = ["MARK", "GANGFORM", "WALL_REBAR", "WALL_MEP", "FORM_WALL", "POUR_WALL", "SHORING", "FORM_SLAB", "SLAB_REBAR", "SLAB_MEP", "POUR"];

/** 이 동에 지금 쓰이는 보정 (예정 시작일이 같을 때만) */
export const activeOverride = (settings: SiteSettings, id: number, planFrom: string): Override | null => {
  const o = (settings.startOverrides ?? {})[String(id)] as Override | undefined;
  return o && o.from === planFrom ? o : null;
};

export type StartOverrideCtx = {
  value: SiteSettings;
  /** 저장돼 있는 이 동 보정 (저장 상태 표시용) */
  savedOf: (id: number) => Override | null;
  /** 이 동 보정만 현장 설정에 저장 — 오른쪽 설정에서 바꾼 다른 값은 저장하지 않는다 (2026-11-02) */
  saveOne: (id: number, o: Override | null) => Promise<void>;
  saving: boolean;
  /** 예정 시작일 다음 첫 작업일 (일요일·공휴일이면 그다음) — 화면 표기용 */
  firstWorkday: string;
  onChange: (next: SiteSettings) => void;
  /** 이번 예정 시작일 (마지막 일보 다음 날) */
  planFrom: string;
  baseFloorOf: (id: number) => number;
  /** 엔진이 일보로 정한 예정 첫 공종 (그 달에 보이면) */
  computed: Map<number, { stage: Stage; floor: number; am?: Stage; pm?: Stage }>;
  /** 저장돼 있지만 예정 시작일이 달라 무시된 동 */
  stale: number[];
};

export default function StartOverridePopup({
  ctx,
  id,
  label,
  anchor,
  onClose,
}: {
  ctx: StartOverrideCtx;
  id: number;
  label: string;
  /** 동 이름 칸의 화면 위치 — 그 오른쪽에 띄운다 */
  anchor: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      // 동 이름 버튼은 그 버튼이 열고 닫는다(여기서 닫으면 바로 다시 열린다)
      if ((e.target as HTMLElement).closest?.("[data-ov-anchor]")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const { value, onChange, planFrom } = ctx;
  const all = (value.startOverrides ?? {}) as Record<string, Override>;
  const setOne = (next: Override | null) => {
    const copy = { ...all };
    if (next) copy[String(id)] = next;
    else delete copy[String(id)];
    onChange({ ...value, startOverrides: copy });
  };
  const active = activeOverride(value, id, planFrom);
  const cur = ctx.computed.get(id);
  const baseFloor = ctx.baseFloorOf(id);
  const floor = active?.floor ?? cur?.floor ?? baseFloor;
  const ug = floor < baseFloor;
  const options = ug ? UG_STAGES : BASE_STAGES;
  // 지금 보이는 오전·오후. 보정이 없으면 둘 다 엔진이 정함 (엔진 값은 아래 「일보 기준」)
  const amVal: Pick = !active || (active.free && !active.amEmpty) ? AUTO : active.amEmpty ? EMPTY : (active.stage as Stage);
  const pmVal: Pick =
    ug || !active || (active.free && !active.pmEmpty) ? AUTO : active.pmEmpty ? EMPTY : active.amEmpty ? (active.stage as Stage) : ((active.pm as Stage | undefined) ?? AUTO);
  // 고정하지 않고 엔진이 출발할 공종 (지금 보정 → 엔진 첫 공종 → 먹매김)
  const startOf = (opts: Stage[]) => [active?.stage as Stage | undefined, cur?.stage].find((s): s is Stage => !!s && opts.includes(s)) ?? "MARK";
  /**
   * 오전·오후 → 저장 값. 오전이 엔진이면 오후도 엔진 — 층을 바꿨을 때만 보정(free). 오전 비움 + 오후 공종 = amEmpty(오후만 고정),
   * 오전 비움 + 오후 엔진·비움 = 고정 없이 비운 칸 다음부터 엔진. 오후 비움 = pmEmpty. 오후가 오전보다 앞서면 오후는 엔진
   */
  const make = (am: Pick, pm: Pick, fl = floor): Override | null => {
    const opts = fl < baseFloor ? UG_STAGES : BASE_STAGES;
    const free: Override = { from: planFrom, floor: fl, stage: startOf(opts), free: true };
    // 층을 바꿔 지하·저층 ↔ 기준층이 바뀌면 그 순서표에 없는 공종은 엔진에 맡긴다
    if (isStage(am) && !opts.includes(am)) am = AUTO;
    if (fl < baseFloor) return isStage(am) ? { from: planFrom, floor: fl, stage: am } : fl !== floor || active ? free : null;
    if (am === AUTO) return fl !== floor || active ? free : null;
    if (am === EMPTY) {
      if (!isStage(pm)) return { ...free, amEmpty: true, ...(pm === EMPTY ? { pmEmpty: true } : {}) };
      return pm === "POUR" ? null : { from: planFrom, floor: fl, stage: pm, amEmpty: true };
    }
    const o: Override = { from: planFrom, floor: fl, stage: am };
    if (am === "POUR") return o;
    if (pm === EMPTY) o.pmEmpty = true;
    else if (isStage(pm) && pm !== "POUR" && opts.indexOf(pm) >= opts.indexOf(am)) o.pm = pm;
    return o;
  };
  const pmOptions = (isStage(amVal) ? options.slice(Math.max(0, options.indexOf(amVal))) : options).filter((s) => s !== "POUR");
  const sel = "h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-1 text-xs";
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  // 화면 아래쪽이면 위로 올려 붙인다
  const top = Math.min(anchor.top, window.innerHeight - 260);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${label} 출발 상태 보정`}
      className="fixed z-50 w-80 rounded-lg border border-border bg-card p-3 shadow-xl print:hidden"
      style={{ left: anchor.right + 6, top: Math.max(8, top) }}
    >
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {label} <span className="font-normal text-muted-foreground">출발 상태 보정</span>
        </h4>
        <button type="button" onClick={onClose} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted" aria-label="닫기">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        예정 첫날({md(ctx.firstWorkday)}) 할 층·공종. 정한 칸은 그대로 고정, 다음 칸부터 엔진이 이어 갑니다. 「비어 있음」은 그 반나절 작업 없음, 「엔진이 정함」은 엔진에 맡김. 새 일보가 들어오면 자동으로 풀립니다.
      </p>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-xs text-muted-foreground">층</span>
          <NumInput
            className="w-[56px]"
            min={-10}
            max={80}
            value={floor}
            aria-label={`${label} 층`}
            onValue={(v) => v != null && v !== 0 && setOne(make(amVal, pmVal, v))}
          />
          <span className="shrink-0 text-xs text-muted-foreground">{floor < 0 ? `= B${-floor}F` : "F"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-xs text-muted-foreground">{ug ? "공종" : "오전"}</span>
          <select value={amVal} onChange={(e) => setOne(make(e.target.value as Pick, pmVal))} className={sel} aria-label={`${label} ${ug ? "공종" : "오전 공종"}`}>
            <option value={AUTO}>엔진이 정함</option>
            {ug ? null : <option value={EMPTY}>비어 있음</option>}
            {options.map((s) => (
              <option key={s} value={s}>
                {STAGE_TITLE[s]}
              </option>
            ))}
          </select>
        </div>
        {ug ? null : (
          <div className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-xs text-muted-foreground">오후</span>
            {amVal === "POUR" ? (
              <span className="text-xs text-muted-foreground">타설은 그날 하루 (오후 없음)</span>
            ) : (
              <select
                value={pmVal}
                disabled={amVal === AUTO}
                title={amVal === AUTO ? "오전을 정하거나 비워야 오후를 정할 수 있습니다" : undefined}
                onChange={(e) => setOne(make(amVal, e.target.value as Pick))}
                className={`${sel} disabled:opacity-60`}
                aria-label={`${label} 오후 공종`}
              >
                <option value={AUTO}>엔진이 정함</option>
                <option value={EMPTY}>비어 있음</option>
                {pmOptions.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_TITLE[s]}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 text-xs">
        <span className="text-muted-foreground">
          일보 기준:{" "}
          {cur
            ? ug
              ? `${floorLabel(cur)} ${STAGE_TITLE[cur.stage]}`
              : `${floorLabel(cur)} 오전 ${cur.am ? STAGE_TITLE[cur.am] : "비어 있음"} · 오후 ${cur.pm ? STAGE_TITLE[cur.pm] : "비어 있음"}`
            : "이 달에 예정 없음"}
        </span>
      </div>
      {ctx.stale.includes(id) ? (
        <p className="mt-2 text-xs text-amber-700">저장된 보정은 예전 예정 시작일 기준이라 쓰지 않았습니다(새 일보 반영). 다시 정하거나 그대로 두세요.</p>
      ) : null}
      {(() => {
        // 이 동 보정만 저장 (오른쪽 설정의 다른 변경과 상관없이)
        const savedO = ctx.savedOf(id);
        const savedActive = savedO && savedO.from === planFrom ? savedO : null;
        const same = JSON.stringify(savedActive ?? null) === JSON.stringify(active ?? null);
        return (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-[11px] text-muted-foreground">{same ? (active ? "저장된 보정입니다." : "저장된 보정 없음") : "저장하지 않은 변경이 있습니다."}</span>
            <div className="flex shrink-0 gap-1.5">
              {/* 일보대로: 이 동 보정을 지우고 바로 저장 */}
              <Button
                size="sm"
                variant="outline"
                disabled={(!active && !savedActive) || ctx.saving}
                onClick={() => {
                  setOne(null);
                  void ctx.saveOne(id, null);
                }}
              >
                <RotateCcw /> 일보대로
              </Button>
              <Button size="sm" disabled={same || ctx.saving} onClick={() => void ctx.saveOne(id, active)}>
                <Save /> {ctx.saving ? "저장 중…" : "저장"}
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
