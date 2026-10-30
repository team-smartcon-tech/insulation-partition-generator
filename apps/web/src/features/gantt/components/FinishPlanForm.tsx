/**
 * 마감 예정 규칙 카드 (2026-10-30). 공종마다 선행 공종 · 간격(일) · 층 묶음 · 묶음당 작업일.
 * 마감 공정표 탭 오른쪽(저장 없이 바꿔 보기)과 설정 탭(저장)이 같이 쓴다. 값은 현장 설정 settings.finish.
 */
import { DEFAULT_FINISH_PLAN, finishPlanOf, type FinishPlanSettings, type FinishTradePlan } from "@ipg/gantt-engine";
import { NumInput } from "./StepInput";

type Trade = { key: string; group: string; label: string };

export default function FinishPlanForm({
  trades,
  value,
  onChange,
}: {
  trades: readonly Trade[];
  value: FinishPlanSettings | undefined;
  onChange: (next: FinishPlanSettings) => void;
}) {
  const set = (key: string, patch: Partial<FinishTradePlan>) => {
    const cur = finishPlanOf(value, key);
    onChange({ ...(value ?? {}), [key]: { ...cur, ...patch } });
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="mb-1 text-sm font-semibold">마감 예정 규칙 (공종별)</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        선행 공종이 그 층을 끝내고 <b>간격</b>이 지나면 시작, <b>N개 층씩</b> 묶어 <b>묶음당 작업일</b> 동안. 아래층부터, 일요일 제외. 기본값은 가정값입니다.
      </p>
      <div className="space-y-2">
        {trades.map((t) => {
          const r = finishPlanOf(value, t.key);
          const changed = JSON.stringify(r) !== JSON.stringify(DEFAULT_FINISH_PLAN[t.key as keyof typeof DEFAULT_FINISH_PLAN]);
          return (
            <div key={t.key} className="rounded-md border border-border/70 px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">
                  {t.group !== t.label ? <span className="font-normal text-muted-foreground">{t.group} · </span> : null}
                  {t.label}
                  {changed ? <span className="ml-1 text-[10px] text-primary">변경</span> : null}
                </span>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  선행
                  <select
                    value={r.pred ?? ""}
                    onChange={(e) => set(t.key, { pred: e.target.value || null })}
                    className="h-7 max-w-[8.5rem] rounded-md border border-input bg-card px-1 text-xs text-foreground"
                    aria-label={`${t.label} 선행 공종`}
                  >
                    <option value="">없음</option>
                    {trades
                      .filter((x) => x.key !== t.key)
                      .map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  간격
                  <NumInput className="w-[45px]" min={0} max={120} value={r.gapDays} aria-label={`${t.label} 간격`} onValue={(v) => set(t.key, { gapDays: v ?? 0 })} />일
                </span>
                <span className="flex items-center gap-1">
                  <NumInput className="w-[45px]" min={1} max={20} value={r.floorsPerBatch} aria-label={`${t.label} 층 묶음`} onValue={(v) => set(t.key, { floorsPerBatch: v ?? 1 })} />층씩
                </span>
                <span className="flex items-center gap-1">
                  <NumInput className="w-[45px]" min={1} max={60} value={r.daysPerBatch} aria-label={`${t.label} 묶음당 작업일`} onValue={(v) => set(t.key, { daysPerBatch: v ?? 1 })} />일
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
