/**
 * 마감 예정 규칙 카드 (2026-10-30). 공종마다 선행 공종 · 간격(일) · 층 묶음 · 묶음당 작업일 · 팀 수(2026-10-31, 1~5).
 * 마감 공정표 탭 오른쪽(저장 없이 바꿔 보기)과 설정 탭(저장)이 같이 쓴다. 값은 현장 설정 settings.finish.
 */
import { DEFAULT_FINISH_PLAN, finishPlanOf, hasFinishPlan, type FinishPlanSettings, type FinishTradePlan } from "@ipg/gantt-engine";
import { NumInput } from "./StepInput";

type Trade = { key: string; group: string; label: string };
/** 선행 선택지 「골조」 (공종 키와 겹치지 않는 값) — 고르면 pred 대신 frameLead */
const FRAME = "__frame";
/** 팀 수 상한 (엔진 계약 finishTradePlanSchema.teams 와 같게) */
const MAX_TEAMS = 5;
/** 「변경」 표시 비교용 — frameLead 없음(undefined)과 null, 팀 없음과 1팀을 같게 본다 */
const sig = (r: FinishTradePlan | undefined) =>
  r ? JSON.stringify([r.pred, r.frameLead ?? null, r.gapDays, r.floorsPerBatch, r.daysPerBatch, r.teams ?? 1]) : "";

export default function FinishPlanForm({
  trades,
  value,
  onChange,
}: {
  trades: readonly Trade[];
  value: FinishPlanSettings | undefined;
  onChange: (next: FinishPlanSettings) => void;
}) {
  // 예정 규칙이 있는 공종만 (창짝설치·유리·몰딩·주방가구·일반가구는 규칙 없음)
  trades = trades.filter((t) => hasFinishPlan(t.key));
  const set = (key: string, patch: Partial<FinishTradePlan>) => {
    const cur = finishPlanOf(value, key);
    onChange({ ...(value ?? {}), [key]: { ...cur, ...patch } });
  };
  const lastFrameLead = (key: string) => DEFAULT_FINISH_PLAN[key as keyof typeof DEFAULT_FINISH_PLAN]?.frameLead ?? 5;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="mb-1 text-sm font-semibold">마감 예정 규칙 (공종별)</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        선행 공종이 그 층을 끝내고 <b>간격</b>이 지나면 시작, <b>N개 층씩</b> 묶어 <b>묶음당 작업일</b> 동안. 선행이 <b>골조</b>면 묶음 최고층 + N 층 S타설
        다음 날부터(창틀 5: 1~5층은 골조 10층 타설 후). <b>팀</b>이 N개면 묶음 N개를 동시에(동·코어마다). 아래층부터, 일요일·공휴일 포함. 기본값은 가정값입니다.
      </p>
      <div className="space-y-2">
        {trades.map((t) => {
          const r = finishPlanOf(value, t.key);
          const changed = sig(r) !== sig(DEFAULT_FINISH_PLAN[t.key as keyof typeof DEFAULT_FINISH_PLAN]);
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
                    value={r.frameLead != null ? FRAME : (r.pred ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      // 골조 ↔ 공종은 둘 중 하나 (골조를 고르면 층수는 전에 쓰던 값, 없으면 5)
                      if (v === FRAME) set(t.key, { pred: null, frameLead: lastFrameLead(t.key) });
                      else set(t.key, { pred: v || null, frameLead: null });
                    }}
                    className="h-7 max-w-[8.5rem] rounded-md border border-input bg-card px-1 text-xs text-foreground"
                    aria-label={`${t.label} 선행 공종`}
                  >
                    <option value="">없음</option>
                    <option value={FRAME}>골조</option>
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
                {r.frameLead != null ? (
                  <span className="flex items-center gap-1" title="묶음 최고층 + N 층까지 골조 S타설이 끝나야 시작 (5: 1~5층은 골조 10층 타설 후)">
                    골조
                    <NumInput className="w-[42px]" min={0} max={30} value={r.frameLead} aria-label={`${t.label} 골조 선행 층수`} onValue={(v) => set(t.key, { frameLead: v ?? 0 })} />개 층 선행
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  간격
                  <NumInput className="w-[42px]" min={0} max={120} value={r.gapDays} aria-label={`${t.label} 간격`} onValue={(v) => set(t.key, { gapDays: v ?? 0 })} />일
                </span>
                <span className="flex items-center gap-1">
                  <NumInput className="w-[42px]" min={1} max={20} value={r.floorsPerBatch} aria-label={`${t.label} 층 묶음`} onValue={(v) => set(t.key, { floorsPerBatch: v ?? 1 })} />층씩
                </span>
                <span className="flex items-center gap-1">
                  <NumInput className="w-[42px]" min={1} max={60} value={r.daysPerBatch} aria-label={`${t.label} 묶음당 작업일`} onValue={(v) => set(t.key, { daysPerBatch: v ?? 1 })} />일
                </span>
                <span className="flex items-center gap-1" title="동(코어)마다 동시에 일하는 팀 수 — N팀이면 묶음 N개를 동시에">
                  <NumInput className="w-[42px]" min={1} max={MAX_TEAMS} value={r.teams ?? 1} aria-label={`${t.label} 팀 수`} onValue={(v) => set(t.key, { teams: v ?? 1 })} />팀
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
