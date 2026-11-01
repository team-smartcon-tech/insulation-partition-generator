/**
 * 준공일 역산 (2026-11-01 사용자: 준공일도 스마트웍스에 있어 → 준공일에 맞는 택트·인원을 거꾸로).
 * 준공일 = 스마트웍스 현장 개요 공사기간 끝(바꿀 수 있음). 마감에 쓸 기간 = 준공 − 준공 전 여유 − 마감 착수일.
 * 그 안에 끝나는 가장 긴 택트(= 가장 적은 인원)를 구간 층수별로 보여 주고, 고르면 택트·구간 층수에 넣는다(직접 정한 인원은 자동으로).
 * 택트 일수는 마감 공정표처럼 달력일(일요일 포함)로 본다. 착수일·여유·준공일 수정은 이 브라우저에만 기억(저장 안 함).
 */
import { useEffect, useMemo, useState } from "react";
import { taktForDeadline, type TaktInput, type TaktResult } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";
import { addDays, todayKst } from "../dates";
import { useSitePeriod } from "../hooks";

const INPUT = "h-9 rounded-md border border-input bg-card px-2.5 text-sm tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const ZONE_OPTIONS = [2, 3, 4, 5, 6];
const DEFAULT_BUFFER = "30";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
const shortDate = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;

type Memo = { start?: string; buffer?: string; completion?: string };
const memoKey = (siteId: string) => `ipg.takt.deadline.${siteId}`;
function readMemo(siteId: string): Memo {
  try {
    return JSON.parse(localStorage.getItem(memoKey(siteId)) ?? "{}") as Memo;
  } catch {
    return {};
  }
}
function writeMemo(siteId: string, m: Memo) {
  try {
    localStorage.setItem(memoKey(siteId), JSON.stringify(m));
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

export default function DeadlineCard({
  siteId,
  input,
  result,
  onApply,
  prepare,
}: {
  siteId: string;
  /** 검사를 통과한 지금 입력 */
  input: TaktInput;
  /** 지금 입력의 계산 */
  result: TaktResult;
  onApply: (taktDays: number, zoneFloors: number) => void;
  /** 겹쳐 이동 공종을 고정 일수로 (taktWithFlows) */
  prepare?: (zoneInput: TaktInput) => TaktInput;
}) {
  const period = useSitePeriod(siteId);
  const [memo, setMemo] = useState<Memo>(() => readMemo(siteId));
  useEffect(() => writeMemo(siteId, memo), [siteId, memo]);

  const swCompletion = period.data?.completion ?? null;
  const completion = memo.completion ?? swCompletion ?? "";
  const start = memo.start ?? todayKst();
  const bufferText = memo.buffer ?? DEFAULT_BUFFER;
  const buffer = Number(bufferText);
  const valid = isDate(completion) && isDate(start) && Number.isInteger(buffer) && buffer >= 0;
  const target = valid ? addDays(completion, -buffer) : null;
  const available = target ? daysBetween(start, target) : 0;

  const maxFloors = Math.max(...input.buildingFloors);
  const rows = useMemo(() => {
    if (!target || available <= 0) return [];
    const zones = [...new Set([...ZONE_OPTIONS, input.zoneFloors])].filter((z) => z <= maxFloors).sort((a, b) => a - b);
    return zones.map((z) => taktForDeadline(input, available, z, 60, prepare));
  }, [input, available, target, maxFloors, prepare]);

  const nowEnd = addDays(start, Math.ceil(result.totalDays - 1e-9));
  const nowLate = target ? daysBetween(target, nowEnd) : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-semibold">준공일 역산</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        ① 준공일·여유·마감 착수일을 맞추면 ② 마감이 끝나야 하는 날까지 끝나는 <b>가장 긴 택트</b>(= 가장 적은 인원)를 구간 층수별로 보여 줍니다. ③ 인원·공기를 보고
        한 줄을 「적용」 하면 위 택트·구간 층수와 아래 공종 표 인원이 그 값으로 바뀝니다 → 「저장」. 인원은 자동 인원 기준, 기포방통 같은 고정 일수 공종은 구간 층수에
        비례. 일수는 달력일(마감 공정표처럼 일요일 포함).
      </p>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">준공일</span>
          <span className="mt-1 flex items-center gap-1.5">
            <input type="date" value={completion} onChange={(e) => setMemo((m) => ({ ...m, completion: e.target.value || undefined }))} className={cn(INPUT, "w-40")} />
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {period.isPending ? (
              "스마트웍스 공사기간 불러오는 중…"
            ) : swCompletion ? (
              <>
                스마트웍스 현장 개요 {period.data?.raw}
                {memo.completion && memo.completion !== swCompletion ? (
                  <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setMemo((m) => ({ ...m, completion: undefined }))}>
                    되돌리기
                  </button>
                ) : null}
              </>
            ) : (
              "스마트웍스 현장 개요에 공사기간이 없습니다 — 직접 넣으세요"
            )}
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">준공 전 여유</span>
          <span className="mt-1 flex items-center gap-1.5">
            <input
              value={bufferText}
              onChange={(e) => setMemo((m) => ({ ...m, buffer: e.target.value }))}
              inputMode="numeric"
              className={cn(INPUT, "w-20 text-right", !(Number.isInteger(buffer) && buffer >= 0) && "border-red-400")}
            />
            <span className="text-xs text-muted-foreground">일</span>
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">사전점검·청소·사용승인 (가정값 {DEFAULT_BUFFER}일)</span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">마감 착수일</span>
          <span className="mt-1 flex items-center gap-1.5">
            <input type="date" value={start} onChange={(e) => setMemo((m) => ({ ...m, start: e.target.value || undefined }))} className={cn(INPUT, "w-40")} />
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">첫 구간 첫 공종 착수 (기본 오늘)</span>
        </label>
        {target ? (
          <div className="pt-5 text-sm">
            마감 끝 목표 <b>{shortDate(target)}</b> · 쓸 수 있는 기간 <b className={cn(available <= 0 && "text-red-600")}>{available}일</b>
          </div>
        ) : null}
      </div>

      {target && available > 0 ? (
        <>
          <p className={cn("mt-3 rounded-md border px-3 py-2 text-sm", nowLate > 0 ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-900")}>
            지금 입력(택트 {input.taktDays}일, {input.zoneFloors}개층, 인원 {result.crewTotal}명)이면 {shortDate(nowEnd)} 끝 —{" "}
            {nowLate > 0 ? `목표보다 ${nowLate}일 늦습니다.` : `목표보다 ${-nowLate}일 여유.`}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-3 font-medium">구간 층수</th>
                  <th className="pb-1 pr-3 font-medium">택트</th>
                  <th className="pb-1 pr-3 font-medium">인원 합</th>
                  <th className="pb-1 pr-3 font-medium">끝나는 날</th>
                  <th className="pb-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const current = r.zoneFloors === input.zoneFloors;
                  const end = addDays(start, Math.ceil(r.result.totalDays - 1e-9));
                  const applied = current && r.taktDays === input.taktDays && input.trades.every((t) => t.mode === "fixed" || t.crew == null);
                  return (
                    <tr key={r.zoneFloors} className={cn("border-t border-border/60", current && "bg-muted/40")}>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {r.zoneFloors}개층{current ? <span className="ml-1 text-[11px] text-muted-foreground">(지금)</span> : null}
                      </td>
                      {r.taktDays == null ? (
                        <td colSpan={4} className="py-1.5 text-xs text-red-700">
                          택트 1일로도 {shortDate(end)} 끝 — 목표보다 {daysBetween(target, end)}일 늦습니다. 단계를 묶거나 구간을 줄이세요.
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3 font-semibold tabular-nums">{r.taktDays}일</td>
                          <td className="py-1.5 pr-3 tabular-nums">{r.result.crewTotal}명</td>
                          <td className="py-1.5 pr-3 tabular-nums">{shortDate(end)}</td>
                          <td className="py-1.5 text-right">
                            {applied ? (
                              <span className="text-xs text-muted-foreground">적용됨</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onApply(r.taktDays!, r.zoneFloors)}
                                className="rounded-md border border-primary/50 px-2 py-0.5 text-xs text-primary hover:bg-primary/5"
                                title="택트·구간 층수를 이 값으로, 직접 정한 인원은 자동 인원으로 (저장해야 반영)"
                              >
                                적용
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            「적용」 은 택트·구간 층수를 바꾸고 직접 정한 인원을 자동 인원으로 돌립니다. 마감 공정표 인원 연동은 저장한 뒤 반영됩니다.
          </p>
        </>
      ) : target ? (
        <p className="mt-3 text-sm text-red-700">마감 착수일이 마감 끝 목표보다 늦습니다.</p>
      ) : null}
    </div>
  );
}
