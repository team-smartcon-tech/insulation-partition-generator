/**
 * 공정표 칸(동 × 날짜)을 누르면 뜨는 팝업 — 그날 그 동의 작업일보 원문과 공정표에 어떻게 반영됐는지.
 * - 공정표 반영: 실적 날은 엔진 정리(순서 밖 기전 제외·기전 이월) 뒤 남은 공종, 예정 날은 엔진 배정(오전·오후).
 * - 해석 결과: 그날 일보에서 그 동으로 읽힌 줄. 공정표에 안 들어간 줄은 "제외"로 표시해 이유를 확인할 수 있게.
 * - 일보 원문: 그 동 번호가 나오는 줄만, 공종 구간 제목과 함께. 읽기 전용.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import type { ActualWork, Assignment, Stage, WorkEntry } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";
import { koreanDate } from "../dates";
import { useDailyReports } from "../hooks";

const NAME: Record<Stage, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "W철근(벽철근)",
  WALL_MEP: "W기전(벽 기전·검측)",
  ALFORM: "알폼",
  TOP_INSULATION: "단열재(최상층)",
  SLAB_REBAR: "S철근(슬래브철근)",
  SLAB_MEP: "S기전(슬래브 기전·검측)",
  POUR: "타설",
  CURE: "양생",
  FORM_WALL: "W거푸집(벽체 거푸집)",
  FORM_SLAB: "S거푸집(바닥 거푸집)",
  SHORING: "시스템(시스템 동바리)",
};

export type CellTarget = {
  date: string;
  buildingId: number;
  label: string;
  /** 실적 날(asOf 이하)인가 */
  isActual: boolean;
  /** 엔진 정리 뒤 공정표에 그린 실적 */
  actual: ActualWork[];
  /** 엔진 예정 (오전·오후) */
  am?: Assignment;
  pm?: Assignment;
};

/** 옥탑은 알폼이 아니라 일반 거푸집 */
const nameOf = (a: { stage: Stage; roof?: number }) => (a.stage === "ALFORM" && a.roof != null ? "거푸집(옥탑)" : NAME[a.stage]);

const floorText = (a: { floor: number | null; roof?: number; floorLabel?: string }) =>
  a.roof ? `PH${a.roof}` : a.floorLabel ? a.floorLabel : a.floor == null ? "층 없음" : a.floor < 0 ? `B${-a.floor}F` : `${a.floor}F`;

/** 원문에서 그 동 번호가 나오는 줄만, 바로 위 구간 제목("* 전기(20)")과 함께 */
function linesFor(rawText: string, buildingNo: number): { header: string | null; lines: string[] }[] {
  const mention = new RegExp(`(^|[^\\d])${buildingNo}(?!\\d)`);
  const out: { header: string | null; lines: string[] }[] = [];
  let header: string | null = null;
  for (const line of rawText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^[*•■▶]/.test(t) || /^\[.*\]$/.test(t)) {
      header = t.replace(/^[*•■▶]\s*/, "");
      continue;
    }
    if (!mention.test(t)) continue;
    const last = out.at(-1);
    if (last && last.header === header) last.lines.push(t);
    else out.push({ header, lines: [t] });
  }
  return out;
}

function MentionHighlight({ text, buildingNo }: { text: string; buildingNo: number }) {
  const parts = text.split(new RegExp(`(${buildingNo}\\s*동?)`));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function CellReportDialog({ siteId, target, onClose }: { siteId: string | null; target: CellTarget; onClose: () => void }) {
  const q = useDailyReports(siteId, target.date, target.date);
  const report = q.data?.reports[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries: WorkEntry[] = (report?.entries ?? []).filter((e) => e.buildingNo === target.buildingId);
  const reflected = (e: WorkEntry) =>
    e.stage != null && target.actual.some((a) => a.stage === e.stage && a.floor === (e.floor ?? 0));
  const raw = report ? linesFor(report.rawText, target.buildingId) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${target.label} ${target.date} 작업일보`}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {target.label} <span className="ml-1 font-normal text-muted-foreground">{koreanDate(target.date)}</span>
          </h2>
          <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="닫기 (Esc)" aria-label="닫기">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">공정표 반영</h3>
            {target.isActual ? (
              target.actual.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {target.actual.map((a, i) => (
                    <li key={i} className="rounded-md border border-border bg-muted/50 px-2 py-0.5">
                      {floorText(a)} {NAME[a.stage]}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">이 날 이 동의 공정 실적은 없습니다.</p>
              )
            ) : target.am || target.pm ? (
              <p>
                <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">엔진 예정</span>
                오전 {target.am ? `${floorText(target.am)} ${nameOf(target.am)}` : "—"} · 오후{" "}
                {target.pm ? `${floorText(target.pm)} ${nameOf(target.pm)}` : "—"}
              </p>
            ) : (
              <p className="text-muted-foreground">엔진 예정 작업이 없습니다.</p>
            )}
          </section>

          {q.isPending ? (
            <p className="text-muted-foreground">작업일보를 불러오는 중…</p>
          ) : q.isError ? (
            <p className="text-red-700">{(q.error as Error).message}</p>
          ) : !report ? (
            <p className="text-muted-foreground">이 날짜의 스마트웍스 작업일보가 없습니다.</p>
          ) : (
            <>
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">해석 결과 ({target.label})</h3>
                {entries.length ? (
                  <ul className="space-y-1">
                    {entries.map((e, i) => {
                      const ok = reflected(e);
                      return (
                        <li key={i} className="flex flex-wrap items-baseline gap-2">
                          <span
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                              ok ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600",
                            )}
                          >
                            {ok ? "반영" : e.stage ? "제외" : "공정 무관"}
                          </span>
                          <span>
                            {e.floor == null && !e.floorLabel ? "" : `${floorText(e)} `}
                            {e.text}
                          </span>
                          <span className="text-xs text-muted-foreground">{e.stage ? `→ ${NAME[e.stage]}` : ""}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">이 동으로 읽힌 줄이 없습니다.</p>
                )}
                {entries.some((e) => e.stage && !reflected(e)) ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    제외: 순서 밖 기전(W기전은 W철근~알폼 전, S기전은 S철근~타설 전만 인정)이거나, 다음 일보로 이어져 다음 날로 넘긴 기전입니다.
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">작업일보 원문 ({target.label} 언급 줄)</h3>
                {raw.length ? (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 leading-6">
                    {raw.map((g, i) => (
                      <div key={i}>
                        {g.header ? <p className="text-xs font-semibold text-muted-foreground">{g.header}</p> : null}
                        {g.lines.map((l, j) => (
                          <p key={j} className="break-keep">
                            <MentionHighlight text={l} buildingNo={target.buildingId} />
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">원문에 이 동이 나오지 않습니다.</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  스마트웍스 작업일보 · 상태 {report.status} · 읽기 전용
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
