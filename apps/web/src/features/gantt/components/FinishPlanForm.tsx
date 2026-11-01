/**
 * 마감 예정 규칙 카드 (2026-10-30). 공종마다 선행 공종 · 간격(일) · 층 묶음 · 투입 인원(명) · 묶음당 작업일.
 * 투입 인원은 택트 인원 탭과 연동(2026-10-31, 팀 → 명): 이름이 같은 택트 공종의 인원을 보여 주고 고치면 택트에도 반영,
 * 묶음당 작업일은 인원으로 자동 계산(엔진 takt/link). 택트 짝이 없는 공종만 작업일을 직접 넣는다.
 * 마감 공정표 탭 오른쪽(저장 없이 바꿔 보기)과 설정 탭(저장)이 같이 쓴다. 값은 현장 설정 settings.finish.
 */
import {
  DEFAULT_FINISH_PLAN,
  FINISH_RULE_ALIAS,
  FINISH_TRADES,
  finishPlanOf,
  hasFinishPlan,
  linkedBatchDays,
  type FinishPlanSettings,
  type FinishTradePlan,
  type TaktLink,
} from "@ipg/gantt-engine";
import { NumInput } from "./StepInput";

type Trade = { key: string; group: string; label: string };
/** 선행 선택지 「골조」 (공종 키와 겹치지 않는 값) — 고르면 pred 대신 frameLead */
const FRAME = "__frame";
/** 「변경」 표시 비교용 — frameLead 없음(undefined)과 null 을 같게 본다. 작업일·팀은 택트 연동이라 비교하지 않는다 */
const sig = (r: FinishTradePlan | undefined) =>
  r ? JSON.stringify([r.pred, r.frameLead ?? null, r.gapDays, r.floorsPerBatch, r.moveDays ?? null, r.moveDays != null ? (r.moveBy ?? "core") : null]) : "";
/** 이동 방식 선택값: 묶음을 끝내고 다음으로(기본) / 코어마다 겹쳐 / 동마다 겹쳐 */
const MOVE_DONE = "done";

export default function FinishPlanForm({
  trades,
  value,
  onChange,
  predEditable = true,
  links,
  onCrew,
}: {
  trades: readonly Trade[];
  value: FinishPlanSettings | undefined;
  onChange: (next: FinishPlanSettings) => void;
  /**
   * 선행(공종·골조 N개 층)을 여기서 고를 수 있나. 마감 공정표 「저장 없이 바꿔 보기」 는 false — 선행은 설정 탭에서만
   * (2026-10-31 사용자). false 면 지금 선행을 글자로만 보이고, 간격·층씩·일·팀만 바꿔 본다.
   */
  predEditable?: boolean;
  /** 택트 연동 (공종 키 → 택트 인원·층당 인·일). 없으면 작업일을 직접 넣는다 */
  links?: Map<string, TaktLink>;
  /** 투입 인원을 바꿀 때 (택트 인원에 반영). 없으면 인원은 읽기 전용 */
  onCrew?: (key: string, crew: number) => void;
}) {
  // 예정 규칙이 있는 공종만 (창짝설치·유리·주방가구·일반가구·내장(구분 없음)·도배·마루는 규칙 없음).
  // 다른 공종 규칙을 쓰는 공종(PL창틀 → 창틀설치)은 그 공종 카드 하나로 — 2026-10-31 사용자: PL창틀 카드 삭제
  trades = [
    ...new Map(
      trades
        .filter((t) => hasFinishPlan(t.key))
        .map((t) => {
          const to = FINISH_RULE_ALIAS[t.key as keyof typeof FINISH_RULE_ALIAS];
          return (to && FINISH_TRADES.find((x) => x.key === to)) || t;
        })
        .map((t) => [t.key, t] as const),
    ).values(),
  ];
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
        다음 날부터(창틀 5: 1~5층은 골조 10층 타설 후). <b>N명</b>은 택트 인원 탭의 투입 인원과 같은 값이고, <b>묶음당 작업일</b>은 그 인원으로 자동 계산합니다(묶음 층수 × 층당 인·일 ÷ 인원).
        그 인원이 동의 코어들에 나뉘어 동시에 진행하고(코어마다 묶음당 작업일은 같음), 동과 동 사이는 차례로 옮겨 갑니다. 아래층부터, 일요일·공휴일 포함. 기본값은 가정값입니다.
        <b>겹쳐 이동</b>(PL창호처럼 1코어를 하루 하고 2코어로)을 고르면 한 팀이 코어(또는 동)를 N일 간격으로 차례로 시작하고, 각 막대는 묶음당 작업일 — 4코어 5일 간격 1일이면 8일.
        이때 작업일은 직접 넣고 인원은 표시만 합니다.
      </p>
      <div className="space-y-2">
        {trades.map((t) => {
          const r = finishPlanOf(value, t.key);
          const link = links?.get(t.key);
          const changed = sig(r) !== sig(DEFAULT_FINISH_PLAN[t.key as keyof typeof DEFAULT_FINISH_PLAN]);
          return (
            <div key={t.key} className="rounded-md border border-border/70 px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">
                  {t.label}
                  {changed ? <span className="ml-1 text-[10px] text-primary">변경</span> : null}
                </span>
                {!predEditable ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" title="선행은 설정 탭 「마감 예정 규칙」 에서 바꿉니다">
                    선행
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                      {r.frameLead != null
                        ? `골조 ${r.frameLead}개 층`
                        : r.pred
                          ? (FINISH_TRADES.find((x) => x.key === r.pred)?.label ?? r.pred)
                          : "없음"}
                    </span>
                  </span>
                ) : (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  선행
                  {/* 폭 고정 — 보기 목록에서 자기 공종이 빠져 가장 긴 이름 카드(내장경량벽체)만 좁아지던 것 */}
                  <select
                    value={r.frameLead != null ? FRAME : (r.pred ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      // 골조 ↔ 공종은 둘 중 하나 (골조를 고르면 층수는 전에 쓰던 값, 없으면 5)
                      if (v === FRAME) set(t.key, { pred: null, frameLead: lastFrameLead(t.key) });
                      else set(t.key, { pred: v || null, frameLead: null });
                    }}
                    className="h-7 w-[7.5rem] rounded-md border border-input bg-card px-1 text-xs text-foreground"
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
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {predEditable && r.frameLead != null ? (
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
                <span className="flex items-center gap-1" title="겹쳐 이동: 팀이 한 곳을 시작하고 N일 뒤 다음 곳을 시작 (막대는 묶음당 작업일). 기본은 묶음을 끝내고 다음으로">
                  <select
                    value={r.moveDays != null ? (r.moveBy ?? "core") : MOVE_DONE}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === MOVE_DONE) set(t.key, { moveDays: null, moveBy: undefined });
                      else set(t.key, { moveDays: r.moveDays ?? 1, moveBy: v as "core" | "building", daysPerBatch: link ? linkedBatchDays(link, r.floorsPerBatch) : r.daysPerBatch });
                    }}
                    className="h-7 rounded-md border border-input bg-card px-1 text-xs text-foreground"
                    aria-label={`${t.label} 이동 방식`}
                  >
                    <option value={MOVE_DONE}>끝내고 이동</option>
                    <option value="core">코어 겹쳐 이동</option>
                    <option value="building">동 겹쳐 이동</option>
                  </select>
                  {r.moveDays != null ? (
                    <>
                      <NumInput className="w-[42px]" min={1} max={30} value={r.moveDays} aria-label={`${t.label} 다음 곳 착수 간격`} onValue={(v) => set(t.key, { moveDays: v ?? 1 })} />
                      일 뒤 다음 {r.moveBy === "building" ? "동" : "코어"}
                    </>
                  ) : null}
                </span>
                {link && r.moveDays == null ? (
                  <>
                    {link.fixed ? (
                      <span className="flex items-center gap-1" title="고정 일수 공종 — 인원은 팀 규모(표시), 작업일은 택트 구간 일수에서">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-foreground">{link.crew}</span>명
                      </span>
                    ) : (
                      <span className="flex items-center gap-1" title={`택트 투입 인원 (자동 ${link.autoCrew}명)${link.manual ? " — 직접 정함" : ""}`}>
                        {onCrew ? (
                          <NumInput className="w-[42px]" min={1} max={200} value={link.crew} aria-label={`${t.label} 투입 인원`} onValue={(v) => onCrew(t.key, v ?? 1)} />
                        ) : (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-foreground">{link.crew}</span>
                        )}
                        명
                      </span>
                    )}
                    <span
                      className="flex items-center gap-1"
                      title={
                        link.fixed
                          ? "택트 구간 일수 × 묶음 층수 ÷ 구간 층수 (올림)"
                          : `묶음 층수 ${r.floorsPerBatch} × 층당 ${(link.perFloorManDays ?? 0).toFixed(1)} 인·일 ÷ ${link.crew}명 (올림)`
                      }
                    >
                      <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-foreground">{linkedBatchDays(link, r.floorsPerBatch)}</span>일
                    </span>
                  </>
                ) : (
                  <>
                    {link ? (
                      <span className="flex items-center gap-1" title="겹쳐 이동 공종은 인원을 표시만 합니다 (택트 투입 인원)">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-foreground">{link.crew}</span>명
                      </span>
                    ) : null}
                    <span
                      className="flex items-center gap-1"
                      title={r.moveDays != null ? "한 곳(코어·동)의 묶음당 작업일 — 직접 넣습니다" : "택트 인원 탭에 같은 이름의 공종이 없어 작업일을 직접 넣습니다"}
                    >
                      <NumInput className="w-[42px]" min={1} max={60} value={r.daysPerBatch} aria-label={`${t.label} 묶음당 작업일`} onValue={(v) => set(t.key, { daysPerBatch: v ?? 1 })} />일
                      {link ? null : <span className="text-[10px] text-amber-700">택트 연결 없음</span>}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
