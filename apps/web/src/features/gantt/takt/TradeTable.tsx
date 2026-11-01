/**
 * 공종 표 — 행마다 단계·공종·단위·세대당 물량·생산성·후속 대기일을 고치고, 옆 칸에 계산 결과(구간 인·일 · 구간 일수 · 투입 인원 · 가동률).
 * 투입 인원은 − / + 로 직접 정한다(2026-10-31). 정하면 「자동 N」 과 함께 보이고 × 로 자동에 돌아간다.
 * 방식(2026-10-31): 인원 산정(물량 ÷ 생산성) / 고정 일수(방통처럼 구간당 일수·팀 인원을 직접 — 물량·생산성 칸은 흐리게, 구간 일수를 − / +).
 * 행 추가·삭제·위아래 이동. 오류는 그 칸 아래에. 계산을 멈춘 동안(입력 오류) 결과 칸은 「—」.
 */
import { ArrowDown, ArrowUp, Minus, Plus, Trash2, X } from "lucide-react";
import { TAKT_LOW_UTILIZATION, type TaktErrors, type TaktFlow, type TaktResult } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";
import { newKey, type TradeDraft } from "./draft";

const CELL = "h-8 w-full rounded-md border bg-card px-2 text-sm tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  value,
  onChange,
  error,
  label,
  align = "right",
  inputMode = "decimal",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label: string;
  align?: "left" | "right";
  inputMode?: "decimal" | "numeric" | "text";
  disabled?: boolean;
}) {
  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        aria-label={label}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        title={disabled ? "고정 일수 공종은 쓰지 않는다 (참고값)" : undefined}
        className={cn(CELL, align === "right" && "text-right", error ? "border-red-400" : "border-input", disabled && "bg-muted text-muted-foreground/60")}
      />
      {error ? <p className="mt-0.5 text-[11px] leading-tight text-red-600">{error}</p> : null}
    </div>
  );
}

/** − 값 + . value 가 없으면(입력 오류) 「—」 */
function Stepper({
  value,
  onChange,
  unit,
  label,
  tone,
  error,
}: {
  value: number | null;
  onChange: (n: number) => void;
  unit: string;
  label: string;
  /** auto = 자동값(파랑), manual = 직접 정함(노랑), fixed = 고정 일수 공종(회색) */
  tone: "auto" | "manual" | "fixed";
  error?: string;
}) {
  const btn = "rounded-md border border-input p-1 text-muted-foreground hover:bg-muted disabled:opacity-30";
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => value != null && onChange(Math.max(1, Math.ceil(value) - 1))} disabled={value == null || value <= 1} aria-label={`${label} 줄이기`} className={btn}>
          <Minus className="size-3" />
        </button>
        <span
          className={cn(
            "inline-block min-w-12 rounded-md px-2 py-0.5 text-center text-base font-bold tabular-nums",
            tone === "manual" ? "bg-amber-100 text-amber-900" : tone === "fixed" ? "bg-slate-200 text-slate-800" : "bg-primary/10 text-primary",
          )}
        >
          {value == null ? "—" : `${Math.round(value * 10) / 10}${unit}`}
        </span>
        <button type="button" onClick={() => onChange(value == null ? 1 : Math.floor(value) + 1)} aria-label={`${label} 늘리기`} className={btn}>
          <Plus className="size-3" />
        </button>
      </div>
      {error ? <p className="mt-0.5 text-[11px] leading-tight text-red-600">{error}</p> : null}
    </div>
  );
}

export default function TradeTable({
  trades,
  onChange,
  errors,
  result,
  flows,
}: {
  trades: TradeDraft[];
  onChange: (next: TradeDraft[]) => void;
  errors: TaktErrors;
  /** 입력 오류가 있으면 null */
  result: TaktResult | null;
  /** 겹쳐 이동 공종 (줄 번호 → 구간 일수 내역, 마감 예정 규칙에서) */
  flows?: Map<number, TaktFlow>;
}) {
  const set = (i: number, patch: Partial<TradeDraft>) => onChange(trades.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= trades.length) return;
    const next = [...trades];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    const last = trades.at(-1);
    const stage = last ? String((Number(last.stage) || 0) + 1) : "1";
    onChange([...trades, { key: newKey(), stage, name: "", unit: "㎡", qtyPerUnit: "", productivity: "", waitDays: "0", crew: "", mode: "rate", fixedDays: "" }]);
  };
  const err = (i: number, f: string) => errors[`trades.${i}.${f}`];
  const numOr = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">공종 표</h3>
        <button
          type="button"
          onClick={add}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-muted"
        >
          <Plus className="size-3.5" /> 공종 추가
        </button>
      </div>
      {errors.trades ? <p className="mb-2 text-xs text-red-600">{errors.trades}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-14 font-medium">순서</th>
              <th className="w-16 font-medium">단계</th>
              <th className="font-medium">공종</th>
              <th className="w-16 font-medium">단위</th>
              <th className="w-24 font-medium" title="인원 산정 = 물량 ÷ 생산성으로 인원을 낸다 · 고정 일수 = 구간당 일수·팀 인원을 직접 (방통 등)">방식</th>
              <th className="w-24 text-right font-medium">세대당 물량</th>
              <th className="w-24 text-right font-medium">1인1일 생산성</th>
              <th className="w-20 text-right font-medium">후속 대기일</th>
              <th className="w-24 border-l border-border pl-3 text-right font-medium">구간 인·일</th>
              <th className="w-32 text-center font-medium" title="이 인원으로 한 구간에 걸리는 작업일 (구간 인·일 ÷ 인원). 고정 일수 공종은 − / + 로 정한다">구간 일수</th>
              <th className="w-36 text-center font-medium">투입 인원</th>
              <th className="w-20 text-right font-medium">가동률</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const r = result?.trades[i];
              const fixed = t.mode === "fixed";
              const flow = flows?.get(i);
              // 고정 일수 공종(방통 등)은 구간마다 들어왔다 나가므로 현장 체류 기준 가동률을 보지 않는다
              const low = r != null && !fixed && !flows?.has(i) && r.utilization < TAKT_LOW_UTILIZATION;
              return (
                <tr key={t.key} className="align-top">
                  <td className="pt-1">
                    <div className="flex gap-0.5">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t.name || "공종"} 위로`} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30">
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === trades.length - 1} aria-label={`${t.name || "공종"} 아래로`} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30">
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="pr-2">
                    <Field label="단계" value={t.stage} onChange={(v) => set(i, { stage: v })} error={err(i, "stage")} inputMode="numeric" />
                  </td>
                  <td className="pr-2">
                    <Field label="공종명" value={t.name} onChange={(v) => set(i, { name: v })} error={err(i, "name")} align="left" inputMode="text" />
                  </td>
                  <td className="pr-2">
                    <Field label="단위" value={t.unit} onChange={(v) => set(i, { unit: v })} align="left" inputMode="text" />
                  </td>
                  <td className="pr-2">
                    <select
                      value={t.mode}
                      onChange={(e) =>
                        set(
                          i,
                          e.target.value === "fixed"
                            ? // 고정 일수로: 지금 구간 일수(반올림)·인원에서 시작
                              { mode: "fixed", fixedDays: String(Math.max(1, Math.round(r?.zoneDays ?? 2))), crew: String(r?.crew ?? 1) }
                            : { mode: "rate", fixedDays: "", crew: "" },
                        )
                      }
                      aria-label={`${t.name || "공종"} 산정 방식`}
                      className="h-8 w-full rounded-md border border-input bg-card px-1 text-xs"
                    >
                      <option value="rate">인원 산정</option>
                      <option value="fixed">고정 일수</option>
                    </select>
                  </td>
                  <td className="pr-2">
                    <Field label="세대당 물량" value={t.qtyPerUnit} onChange={(v) => set(i, { qtyPerUnit: v })} error={fixed ? undefined : err(i, "qtyPerUnit")} disabled={fixed} />
                  </td>
                  <td className="pr-2">
                    <Field label="1인1일 생산성" value={t.productivity} onChange={(v) => set(i, { productivity: v })} error={fixed ? undefined : err(i, "productivity")} disabled={fixed} />
                  </td>
                  <td className="pr-2">
                    <Field label="후속 대기일" value={t.waitDays} onChange={(v) => set(i, { waitDays: v })} error={err(i, "waitDays")} />
                  </td>
                  <td className="border-l border-border pl-3 pt-1.5 text-right tabular-nums">{r ? r.manDays.toFixed(1) : "—"}</td>
                  {fixed ? (
                    <td className="pt-1" title={r?.bottleneck ? "택트보다 길다 — 뒤 공종이 기다린다" : undefined}>
                      <Stepper
                        value={numOr(t.fixedDays)}
                        onChange={(n) => set(i, { fixedDays: String(n) })}
                        unit="일"
                        label={`${t.name || "공종"} 구간 일수`}
                        tone={r?.bottleneck ? "manual" : "fixed"}
                        error={err(i, "fixedDays")}
                      />
                    </td>
                  ) : (
                    <td className={cn("pt-1.5 text-right tabular-nums", r?.bottleneck && "font-semibold text-red-600")} title={r?.bottleneck ? "택트보다 길다 — 이 공종이 흐름 전체를 늦춘다" : undefined}>
                      {r ? `${r.bottleneck ? "⚠ " : ""}${r.zoneDays.toFixed(1)}일` : "—"}
                      {flow ? (
                        <span
                          className="block text-[11px] font-normal text-sky-700"
                          title="마감 예정 규칙의 겹쳐 이동 — 한 곳 작업일(구간 층수 비례) + (코어 수 − 1) × 간격. 인원은 표시만"
                        >
                          겹쳐 이동 {Math.round(flow.placeDays * 10) / 10}
                          {flow.stops > 1 ? ` + ${flow.stops - 1}×${flow.moveDays}` : ""}일
                        </span>
                      ) : null}
                    </td>
                  )}
                  <td className="pt-1">
                    {fixed ? (
                      <Stepper
                        value={numOr(t.crew)}
                        onChange={(n) => set(i, { crew: String(n) })}
                        unit="명"
                        label={`${t.name || "공종"} 팀 인원`}
                        tone="fixed"
                        error={err(i, "crew")}
                      />
                    ) : r ? (
                      <div className="flex flex-col items-center">
                        <Stepper
                          value={r.crew}
                          onChange={(n) => set(i, { crew: String(n) })}
                          unit="명"
                          label={`${t.name || "공종"} 인원`}
                          tone={t.crew ? "manual" : "auto"}
                        />
                        {t.crew ? (
                          <button
                            type="button"
                            onClick={() => set(i, { crew: "" })}
                            className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                            title="자동 인원으로 되돌리기"
                          >
                            자동 {r.autoCrew}명 <X className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="pt-0.5 text-center">—</p>
                    )}
                  </td>
                  <td className={cn("pt-1.5 text-right tabular-nums", low && "font-semibold text-amber-700")} title={fixed ? "고정 일수 공종은 구간마다 들어왔다 나가므로 가동률을 보지 않는다" : low ? "가동률 80% 미만 — 인원이 남는다(유휴)" : undefined}>
                    {r && !fixed && !flow ? `${low ? "⚠ " : ""}${Math.round(r.utilization * 100)}%` : "—"}
                  </td>
                  <td className="pt-1 text-right">
                    <button
                      type="button"
                      onClick={() => onChange(trades.filter((_, k) => k !== i))}
                      aria-label={`${t.name || "공종"} 삭제`}
                      className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        단계 번호가 같은 공종은 같은 구간에 동시에 들어갑니다(타일·천장). 후속 대기일은 방수 담수시험·방통 양생처럼 다음 단계가 기다리는 작업일이며, 같은 단계에선 가장 긴 값을 씁니다.
        방식이 <b>고정 일수</b>인 공종(기포+방통 등)은 물량·생산성을 쓰지 않고 구간 일수·팀 인원을 − / + 로 정합니다(회색). 구간 일수는 사람이 붙는 날만(예: 기포 타설 1 + 방통 타설 1 = 2일), 양생은 후속 대기일에(예: 기포 3 + 방통 14 = 17일) 넣으세요 — 양생을 구간 일수에 넣으면 택트보다 길어져 병목이 됩니다.
        투입 인원은 − / + 로 바꿀 수 있습니다(노란색 = 직접 정함). 늘리면 그 공종이 빨리 지나가 앞서 나가고, 줄여서 구간 일수가 택트보다 길어지면 그 공종이 병목이 되어 뒤 공종이 구간마다 기다립니다. 가동률은 첫 착수~마지막 완료 동안 기준이라 기다린 날만큼 내려갑니다. 80% 미만은 ⚠ 표시.
      </p>
    </div>
  );
}
