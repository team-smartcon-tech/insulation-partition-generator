/**
 * 택트 인원 탭 (2026-10-31) — 마감 공종이 N개 층 구간을 같은 일수(택트)에 끝내고 다음 구간으로 넘어가도록,
 * 공종별 유휴 없는 적정 인원을 내고 동·층수에 따른 전체 마감 기간을 흐름선으로 본다.
 *
 * - 현장은 상단에서 고른 공정표 현장. 현장마다 한 벌 저장(/api/gantt/takt/:siteId, gantt_takt_* 표).
 * - 저장된 것이 없으면 예시값으로 시작하고, 동별 층수는 설정 탭 동 목록의 최상층으로 채운다.
 * - 입력이 바뀌면 바로 다시 계산(엔진 computeTakt). 0 이하·빈 값은 그 칸에 오류를 띄우고 계산을 멈춘다.
 * - 다음 단계로 남긴 것: 골조 공정 엔진 연결(지금은 골조 구간 소요일 입력 + 경고만), 동별 별도 팀 투입 모드.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { computeTakt, taktWithFlows, validateTaktInput, type TaktInput } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFinish, useSaveTakt, useSettings, useTakt } from "../hooks";
import { draftOf, draftSig, inputOf, sampleDraft, type Draft } from "./draft";
import TradeTable from "./TradeTable";
import FlowChart from "./FlowChart";
import DeadlineCard from "./DeadlineCard";

const INPUT = "h-9 w-full rounded-md border bg-card px-2.5 text-sm tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function NumField({
  label,
  value,
  onChange,
  error,
  suffix,
  hint,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  suffix?: string;
  hint?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    // 한 줄 배치(2026-10-31): 숫자 칸은 좁게 고정, 동별 층수(wide)가 남은 폭을 채운다. 좁은 화면에선 줄바꿈
    <label className={cn("block", wide ? "min-w-[16rem] flex-1" : "w-40 shrink-0")}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={wide ? "text" : "decimal"}
          aria-invalid={Boolean(error)}
          className={cn(INPUT, !wide && "text-right", error ? "border-red-400" : "border-input")}
        />
        {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
      {error ? <span className="mt-0.5 block text-[11px] text-red-600">{error}</span> : hint ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function TaktPanel({
  siteId,
  siteName,
  actionsSlot = null,
}: {
  siteId: string | null;
  siteName: string;
  /** 탭 줄 오른쪽 자리 — 저장·예시값 버튼을 여기에 그린다 (GanttPage) */
  actionsSlot?: HTMLElement | null;
}) {
  const settings = useSettings(siteId);
  const takt = useTakt(siteId);
  const save = useSaveTakt(siteId);
  // 겹쳐 이동(마감 예정 규칙, 2026-11-01): 그 공종은 구간 일수 = 코어당 일수 + (코어 수 − 1) × 간격으로 계산. 코어 수는 마감 공정표와 같게
  const finishData = useFinish(siteId);
  const finishRules = settings.data?.settings.finish;
  const cores = Math.max(1, ...(finishData.data?.gantt.buildings ?? []).map((b) => b.cores.length || 1));
  /** 설정 탭 동 목록의 최상층 (동 번호 순) */
  const listedFloors = useMemo(
    () => [...(settings.data?.buildings ?? [])].sort((a, b) => a.buildingNo - b.buildingNo).map((b) => b.topFloor),
    [settings.data],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  /** 마지막으로 불러오거나 저장한 상태 (저장된 적 없으면 null) */
  const [savedSig, setSavedSig] = useState<string | null>(null);

  // 처음 한 번: 저장된 입력, 없으면 예시값 + 설정 동 목록 (GanttPage 가 현장마다 key 로 새로 만든다)
  useEffect(() => {
    if (draft || !takt.data || !settings.data) return;
    const t = takt.data.takt;
    if (t) {
      const d = draftOf(t, t.frameZoneDays);
      setDraft(d);
      setSavedSig(draftSig(d));
    } else setDraft(sampleDraft(listedFloors));
  }, [draft, takt.data, settings.data, listedFloors]);

  const input = useMemo(() => (draft ? inputOf(draft) : null), [draft]);
  const errors = useMemo(() => (input ? validateTaktInput(input) : {}), [input]);
  const ok = input != null && Object.keys(errors).length === 0;
  const flowed = useMemo(() => (ok && input ? taktWithFlows(input, finishRules, cores) : null), [ok, input, finishRules, cores]);
  const result = useMemo(() => (flowed ? computeTakt(flowed.input) : null), [flowed]);
  const prepare = useMemo(() => (zi: TaktInput) => taktWithFlows(zi, finishRules, cores).input, [finishRules, cores]);
  /** 인원을 하나도 직접 정하지 않았을 때(자동 인원) — 조절로 기간이 얼마나 바뀌었는지 비교용 */
  // 고정 일수 공종의 팀 인원은 「조절」 이 아니라 입력이라 그대로 둔다
  const autoResult = useMemo(() => {
    if (!ok || !input || !input.trades.some((t) => t.mode !== "fixed" && t.crew != null)) return null;
    return computeTakt(prepare({ ...input, trades: input.trades.map((t) => (t.mode === "fixed" ? t : { ...t, crew: null })) }));
  }, [ok, input, prepare]);
  const dirty = draft != null && (savedSig == null || draftSig(draft) !== savedSig);

  if (!siteId) return <p className="py-10 text-center text-sm text-muted-foreground">현장을 고르세요.</p>;
  const loadError = takt.error ?? settings.error;
  if (loadError) return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(loadError as Error).message}</div>;
  if (!draft || !input) return <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</p>;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const frameDays = draft.frameZoneDays.trim() === "" ? null : Number(draft.frameZoneDays);
  const frameError = frameDays != null && !(Number.isFinite(frameDays) && frameDays > 0) ? "0보다 큰 값을 넣거나 비워 두세요." : undefined;
  const frameWarn = ok && frameDays != null && !frameError && input.taktDays < frameDays;
  const zoneFloors = Number(draft.zoneFloors) || 0;
  const saved = takt.data?.takt;

  const onSave = async () => {
    if (!ok || frameError) {
      toast.error("입력 오류가 있어 저장할 수 없습니다. 빨간 칸을 고치세요.");
      return;
    }
    try {
      await save.mutateAsync({ ...input, trades: input.trades.map((t) => ({ ...t, crew: t.crew ?? null, mode: t.mode ?? "rate", fixedDays: t.fixedDays ?? null })), frameZoneDays: frameDays });
      setSavedSig(draftSig(draft));
      toast.success(`${siteName} 택트 입력을 저장했습니다.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onReset = () => {
    if (!window.confirm("공종 표와 입력을 예시값으로 되돌릴까요? (저장하기 전에는 저장된 값이 그대로입니다)")) return;
    setDraft(sampleDraft(listedFloors));
  };

  return (
    <div className="space-y-4">
      {actionsSlot
        ? createPortal(
            <>
              <span className="mr-1 text-xs text-muted-foreground">
                {dirty ? "저장 안 한 변경 있음" : saved ? `저장됨${saved.updatedBy ? ` · ${saved.updatedBy}` : ""}` : ""}
              </span>
              <Button variant="outline" size="sm" onClick={onReset} title="예시값으로 되돌리기">
                <RotateCcw className="size-4" /> 예시값
              </Button>
              <Button size="sm" onClick={onSave} disabled={save.isPending || !dirty}>
                <Save className="size-4" /> {save.isPending ? "저장 중…" : "저장"}
              </Button>
            </>,
            actionsSlot,
          )
        : null}

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        공종 표·생산성·대기일 기본값은 <b>예시값</b>입니다 — 실행 내역·현장 실적 품셈으로 교체하세요.
        {!saved ? " 이 현장은 아직 저장한 택트 입력이 없습니다." : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">전체 입력</h3>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <NumField label="층당 세대수" value={draft.unitsPerFloor} onChange={(v) => set({ unitsPerFloor: v })} error={errors.unitsPerFloor} suffix="세대" />
          <NumField label="구간 층수" value={draft.zoneFloors} onChange={(v) => set({ zoneFloors: v })} error={errors.zoneFloors} suffix="개층" />
          <NumField label="택트 (구간당 작업일수)" value={draft.taktDays} onChange={(v) => set({ taktDays: v })} error={errors.taktDays} suffix="일" />
          <NumField
            label={`골조 ${zoneFloors || "N"}개층 소요일 (선택)`}
            value={draft.frameZoneDays}
            onChange={(v) => set({ frameZoneDays: v })}
            error={frameError}
            suffix="일"
            hint="택트가 더 짧으면 경고"
          />
          <NumField
            label="동별 층수 (쉼표로 구분)"
            value={draft.buildingFloors}
            onChange={(v) => set({ buildingFloors: v })}
            error={errors.buildingFloors}
            wide
            hint={
              <>
                {input.buildingFloors.length ? `${input.buildingFloors.length}개 동` : null}
                {listedFloors.length ? (
                  <button
                    type="button"
                    className="ml-2 text-primary underline-offset-2 hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      set({ buildingFloors: listedFloors.join(",") });
                    }}
                    title="설정 탭 동 목록의 최상층으로 채운다"
                  >
                    설정 동 목록으로 채우기 ({listedFloors.join(",")})
                  </button>
                ) : null}
              </>
            }
          />
        </div>
        {frameWarn ? (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠ 택트 {input.taktDays}일이 골조 {zoneFloors}개층 소요일 {frameDays}일보다 짧습니다 — 마감이 골조를 따라잡아 기다리게 됩니다.
          </p>
        ) : null}
      </div>

      {result && result.effectiveTakt > input.taktDays ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          ⚠ {result.trades
            .map((t, i) => (t.bottleneck ? `${input.trades[i].name}(${t.crew}명, 구간 ${t.zoneDays.toFixed(1)}일)` : null))
            .filter(Boolean)
            .join(", ")}
          {" "}이(가) 택트 {input.taktDays}일보다 느려, 뒤 공종이 구간마다 기다립니다(흐름선의 가로 계단). 인원을 늘리거나 택트를 늘리세요.
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="총 구간 수" value={`${result.totalZones}구간`} sub={`${input.buildingFloors.length}개 동 · ${input.zoneFloors}개층씩, 한 동을 끝내면 다음 동 첫 구간으로`} />
          <Stat label="동시 투입 인원" value={`${result.crewTotal}명`} sub={`공종 ${input.trades.length}개 투입 인원 합`} />
          <Stat
            label="전체 마감 기간"
            value={`0 → ${Math.round(result.totalDays * 10) / 10}일`}
            sub={
              autoResult && Math.abs(result.totalDays - autoResult.totalDays) > 1e-6
                ? `인원 조절로 자동 인원(${Math.round(autoResult.totalDays * 10) / 10}일) 대비 ${result.totalDays > autoResult.totalDays ? "+" : ""}${Math.round((result.totalDays - autoResult.totalDays) * 10) / 10}일`
                : "첫 구간 착수 → 마지막 구간 완료 (작업일)"
            }
          />
        </div>
      ) : (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">입력 오류가 있어 계산을 멈췄습니다. 빨간 칸을 고치면 바로 다시 계산합니다.</div>
      )}

      {result ? (
        <DeadlineCard
          siteId={siteId}
          input={input}
          result={result}
          prepare={prepare}
          onApply={(taktDays, zf) =>
            // 고정 일수 공종의 구간 일수는 구간 층수에 비례 (역산과 같게, 소수 한 자리)
            set({
              taktDays: String(taktDays),
              zoneFloors: String(zf),
              trades: draft.trades.map((t) =>
                t.mode === "fixed"
                  ? { ...t, fixedDays: String(Math.round(((Number(t.fixedDays) * zf) / input.zoneFloors) * 10) / 10) }
                  : { ...t, crew: "" },
              ),
            })
          }
        />
      ) : null}

      <TradeTable trades={draft.trades} onChange={(trades) => set({ trades })} errors={errors} result={result} flows={flowed?.flows} />

      {result ? <FlowChart trades={input.trades} result={result} /> : null}
    </div>
  );
}
