/**
 * 작업일보 탭 — 왼쪽 주요작업 LIST 원문, 오른쪽 골조 작업 해석(단계별 카드). CTPA 배치. 읽기 전용.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STAGE_LABEL, type DailyReport, type Stage, type WorkEntry } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDailyReports } from "../hooks";
import { addDays, koreanDate, todayKst, weekdayEn } from "../dates";

const STAGE_ORDER: Stage[] = ["FORM_STRIP", "MARK", "GANGFORM", "FORM_WALL", "WALL_REBAR", "ALFORM", "SHORING", "FORM_SLAB", "TOP_INSULATION", "SLAB_REBAR", "POUR", "WALL_MEP", "SLAB_MEP"];

const STAGE_KEYWORDS: Record<Stage, RegExp> = {
  MARK: /먹매김|먹메김/g,
  GANGFORM: /갱폼|갱품/g,
  WALL_REBAR: /벽체\s*철근|벽\s*철근|철근|배근/g,
  ALFORM: /알폼|알루미늄폼/g,
  TOP_INSULATION: /단열재/g,
  SLAB_REBAR: /바닥\s*철근|슬래브\s*철근|슬라브\s*철근|철근|배근/g,
  POUR: /타설/g,
  WALL_MEP: /배관|이중관|검측|기전/g,
  SLAB_MEP: /배관|이중관|검측|기전/g,
  CURE: /양생/g,
  FORM_WALL: /거푸집|형틀/g,
  FORM_SLAB: /거푸집|형틀/g,
  SHORING: /동바리|시스템/g,
  FORM_STRIP: /해체/g,
};

const STAGE_TONE: Record<Stage, string> = {
  MARK: "bg-stone-100 text-stone-700",
  GANGFORM: "bg-emerald-100 text-emerald-800",
  WALL_REBAR: "bg-violet-100 text-violet-800",
  ALFORM: "bg-sky-100 text-sky-800",
  TOP_INSULATION: "bg-lime-200 text-lime-900",
  SLAB_REBAR: "bg-violet-100 text-violet-800",
  POUR: "bg-rose-100 text-rose-800",
  WALL_MEP: "bg-amber-100 text-amber-800",
  SLAB_MEP: "bg-amber-100 text-amber-800",
  CURE: "bg-stone-100 text-stone-700",
  FORM_WALL: "bg-sky-100 text-sky-800",
  FORM_SLAB: "bg-sky-100 text-sky-800",
  SHORING: "bg-slate-200 text-slate-700",
  FORM_STRIP: "bg-sky-50 text-sky-700",
};

function Highlight({ text, re }: { text: string; re: RegExp }) {
  const parts: { s: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    if (m.index > last) parts.push({ s: text.slice(last, m.index), hit: false });
    parts.push({ s: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ s: text.slice(last), hit: false });
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground">
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </>
  );
}

const entryLine = (e: WorkEntry) => `${e.building}: ${e.floor === null ? "" : `${e.floor}F `}${e.text}`;

function StageCard({ stage, entries }: { stage: Stage; entries: WorkEntry[] }) {
  const buildings = [...new Set(entries.map((e) => e.building))];
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <h4 className="text-base font-semibold">{STAGE_LABEL[stage]}</h4>
      <div className="flex flex-wrap gap-1 pt-1">
        {buildings.map((b) => (
          <span key={b} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STAGE_TONE[stage])}>
            {b}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-1.5 text-sm">
        {entries.map((e, i) => (
          <p key={i} className="flex gap-1.5 leading-6">
            <span className="text-muted-foreground">›</span>
            <span className="min-w-0">
              - <Highlight text={entryLine(e)} re={STAGE_KEYWORDS[stage]} />
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export default function DailyReportPanel({ siteId, siteName, initialDate }: { siteId: string | null; siteName: string; initialDate: string | null }) {
  const [date, setDate] = useState<string>(initialDate ?? todayKst());
  const q = useDailyReports(siteId, date, date);
  const report: DailyReport | null = q.data?.reports[0] ?? null;

  const byStage = new Map<Stage, WorkEntry[]>();
  const noStage: WorkEntry[] = [];
  for (const e of report?.entries ?? []) {
    if (e.stage) byStage.set(e.stage, [...(byStage.get(e.stage) ?? []), e]);
    else noStage.push(e);
  }
  const matched = STAGE_ORDER.filter((s) => byStage.has(s));
  const hasText = Boolean(report?.rawText.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          기준일 <b className="text-foreground">{koreanDate(date)}</b> — 스마트웍스 작업일보를 불러와{" "}
          <b className="text-foreground">골조 작업을 동·층·단계로 읽습니다.</b> 읽기 전용이며 여기서 고치거나 저장하지 않습니다.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="전날" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-3 text-sm tabular-nums"
            aria-label="기준일"
          />
          <Button variant="outline" size="icon" aria-label="다음날" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight />
          </Button>
          <Button size="sm" onClick={() => setDate(todayKst())}>
            오늘
          </Button>
        </div>
      </div>

      {q.isError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(q.error as Error).message}</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 rounded-lg border border-primary/40 bg-card p-4">
            <div className="flex items-baseline justify-between pb-3">
              <h3 className="text-lg font-semibold text-primary">
                {date} ({weekdayEn(date)})의 주요작업LIST
              </h3>
              <span className="text-xs text-muted-foreground">{siteName}</span>
            </div>
            <div className="h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm leading-6">
              {q.isPending ? <span className="text-muted-foreground">불러오는 중…</span> : hasText ? report?.rawText : <span className="text-muted-foreground">작업 내용이 없습니다</span>}
            </div>
            <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
              {report
                ? hasText
                  ? `스마트웍스 일보 ${date} 있음 · 불러온 상태`
                  : `스마트웍스 일보 ${date} 있음 · 작업 내용이 비어 있음`
                : q.isPending
                  ? ""
                  : `스마트웍스에 ${date} 일보가 없습니다 · 날짜를 바꿔 보세요`}
            </p>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold text-primary">금일 골조 작업 해석</h3>
              <span className="text-xs text-muted-foreground">단계 {matched.length}</span>
            </div>
            {matched.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {hasText ? '원문에 "* 골조" 구간이 없거나 줄 모양이 달라 읽지 못했습니다.' : "이 날짜의 일보에 작업 내용이 없습니다."}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {matched.map((s) => (
                  <StageCard key={s} stage={s} entries={byStage.get(s) ?? []} />
                ))}
              </div>
            )}
            {noStage.length > 0 || (report?.unmatched.length ?? 0) > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm">
                <p className="font-semibold text-amber-800">확인 필요</p>
                {noStage.map((e, i) => (
                  <p key={`n${i}`} className="leading-6">
                    › - {entryLine(e)} <span className="text-xs text-muted-foreground">(기준층 단계 아님 — 지하·부대시설 등, 공정표에 반영 안 함)</span>
                  </p>
                ))}
                {report?.unmatched.map((l, i) => (
                  <p key={`u${i}`} className="leading-6">
                    › {l} <span className="text-xs text-muted-foreground">(줄 모양을 읽지 못함)</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
