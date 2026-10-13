/**
 * 계획서 서류 현황 — 품질관리계획서 서식마다 이 현장이 작성했는지를 **주관 부서별 신호등**으로 본다.
 *
 * 생김새는 배포 양식함·현장 서류함(`FormTree.tsx`)을 그대로 따른다(사용자 요청 — "기존 디자인에
 * 맞춰서"): 흰 카드, 서류철 모양 탭, 왼쪽 분류 목록, 오른쪽 한 줄짜리 행.
 *
 * 부서 탭은 계획서의 주관 부서(QA-6.3-2)로 거른다. 협조 부서는 절 제목 옆에 글자로만 적는다 —
 * 협조까지 불을 켜면 서식 한 장에 불이 셋 붙어 무엇을 봐야 할지 흐려진다.
 */
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  QMP_CHAPTERS,
  QMP_DEPTS,
  QMP_SECTIONS,
  chapterOf,
  lampOf,
  qmpTally,
  type QmpDept,
  type QmpFormState,
  type QmpStatus,
} from "./qmpPlan";

interface Props {
  siteName: string;
  states: Map<string, QmpFormState>;
  /** 그 서식을 쓴 현장 서류를 연다 */
  onOpen: (docId: string, sheetName?: string) => void;
  /** 배포 양식으로 새로 작성한다 */
  onWrite: (code: string) => void;
  /** 그 서식이 든 배포 양식이 있나 — 없으면 [작성하기] 대신 안내를 단다 */
  canWrite: (code: string) => boolean;
}

const CHAPTER_NOS = ["4", "5", "6", "7", "8", "9", "10"];

/** 신호등 하나. 색만으로 가르지 않도록 테두리·밝기도 다르게 하고 글자 이름을 붙인다. */
export function Lamp({ status, size = 11 }: { status: QmpStatus; size?: number }) {
  const label = status === "done" ? "작성 완료" : status === "doing" ? "작성 중" : "미작성";
  const style = { width: size, height: size };
  if (status === "done") {
    return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full bg-green-600 ring-[3px] ring-green-600/20" />;
  }
  if (status === "doing") {
    return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full bg-amber-500" />;
  }
  return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full border-2 border-slate-400 bg-white" />;
}

const formatDate = (ms: number) => {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

export default function QmpStatusPage({ siteName, states, onOpen, onWrite, canWrite }: Props) {
  const [dept, setDept] = useState<QmpDept | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");

  const overall = qmpTally(states, null);
  const percent = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(
    () =>
      QMP_SECTIONS.filter((sec) => (!dept || sec.lead === dept) && (!chapter || chapterOf(sec.no) === chapter))
        .map((sec) => ({
          ...sec,
          forms: sec.forms.filter((form) => {
            if (onlyMissing && (form.reference || states.get(form.code)?.status === "done")) return false;
            if (needle && !`qa-${form.code} ${form.name}`.toLowerCase().includes(needle)) return false;
            return true;
          }),
        }))
        .filter((sec) => sec.forms.length > 0 || (!onlyMissing && !needle)),
    [dept, chapter, onlyMissing, needle, states],
  );

  const tabs: { key: QmpDept | null; label: string }[] = [{ key: null, label: "전체" }, ...QMP_DEPTS.map((d) => ({ key: d, label: d }))];

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            계획서 서류 현황{" "}
            <span className="text-sm font-normal tabular-nums text-slate-500">
              {overall.done} / {overall.total}장
            </span>
          </h2>
          <div className="mt-2 h-1.5 w-44 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {siteName ? `${siteName} · ` : ""}품질관리계획서 절마다 주관 부서(첨부 QA-6.3-2)가 서류를 작성해 결재까지 마치면
            초록불이 켜집니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="서식명 · QA 번호 검색"
              aria-label="서식명 · QA 번호 검색"
              className="w-44 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-700 placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyMissing((on) => !on)}
            aria-pressed={onlyMissing}
            className={
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition " +
              (onlyMissing ? "bg-slate-800 text-white" : "text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
            }
          >
            아직 안 끝난 것만
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="주관 부서">
          {tabs.map((tab) => {
            const tally = qmpTally(states, tab.key);
            const active = dept === tab.key;
            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setDept(tab.key);
                  setChapter(null);
                }}
                className={
                  "-mb-px inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3.5 py-2 text-sm transition " +
                  (active
                    ? "border-slate-200 bg-white font-semibold text-slate-900"
                    : "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200/70")
                }
              >
                {tab.key && <Lamp status={lampOf(tally)} size={9} />}
                {tab.label}{" "}
                <span className="font-normal tabular-nums text-slate-400">
                  {tally.done}/{tally.total}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3.5 pb-2 text-xs text-slate-500" aria-label="범례">
          <span className="inline-flex items-center gap-1.5"><Lamp status="done" size={10} />작성 완료(결재 끝)</span>
          <span className="inline-flex items-center gap-1.5"><Lamp status="doing" size={10} />작성 중·결재 대기</span>
          <span className="inline-flex items-center gap-1.5"><Lamp status="none" size={10} />미작성</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded border border-slate-300 px-1 text-[10px] text-slate-500">기준</span>절차·기준(작성 안 함)
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row">
        <nav className="shrink-0 lg:w-60" aria-label="장 고르기">
          <button
            type="button"
            onClick={() => setChapter(null)}
            className={
              "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm " +
              (chapter === null ? "bg-slate-100 font-semibold text-slate-900" : "font-medium text-slate-700 hover:bg-slate-50")
            }
          >
            전체 장
            <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
              {qmpTally(states, dept).done}/{qmpTally(states, dept).total}
            </span>
          </button>
          <ul className="mb-1 ml-5 mt-0.5 space-y-px">
            {CHAPTER_NOS.map((no) => {
              const tally = qmpTally(states, dept, no);
              const active = chapter === no;
              return (
                <li key={no}>
                  <button
                    type="button"
                    onClick={() => setChapter(no)}
                    className={
                      active
                        ? "flex w-full items-center justify-between rounded-md bg-slate-100 px-2 py-1.5 text-left text-[13px] font-medium text-slate-900"
                        : "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-slate-600 hover:bg-slate-50"
                    }
                  >
                    <span className="truncate">
                      {no} {QMP_CHAPTERS[no]}
                    </span>
                    <span className={"ml-2 tabular-nums " + (tally.total === 0 ? "text-slate-300" : "text-slate-500")}>
                      {tally.total === 0 ? "–" : `${tally.done}/${tally.total}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-7">
          {CHAPTER_NOS.map((no) => {
            const inChapter = sections.filter((sec) => chapterOf(sec.no) === no);
            if (inChapter.length === 0) return null;
            const tally = qmpTally(states, dept, no);
            return (
              <div key={no}>
                <h3 className="flex items-baseline gap-2 border-b border-slate-200 pb-2 text-base font-semibold text-slate-900">
                  제 {no} 장 {QMP_CHAPTERS[no]}
                  <span className="text-sm font-normal tabular-nums text-slate-500">
                    {tally.done}/{tally.total}
                  </span>
                </h3>
                <div className="mt-3 space-y-4">
                  {inChapter.map((sec) => {
                    const secTally = {
                      done: 0,
                      doing: 0,
                      total: 0,
                    };
                    for (const form of sec.forms) {
                      if (form.reference) continue;
                      const status = states.get(form.code)?.status ?? "none";
                      if (status === "done") secTally.done += 1;
                      if (status === "doing") secTally.doing += 1;
                      secTally.total += 1;
                    }
                    return (
                      <section key={sec.no}>
                        <h4 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                          <ChevronDown size={15} aria-hidden className="text-slate-400" />
                          <span className="tabular-nums">{sec.no}</span>
                          {sec.title}
                          <span className="font-normal tabular-nums text-slate-500">
                            {secTally.total === 0 ? "–" : `${secTally.done}/${secTally.total}`}
                          </span>
                          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-700">
                            <Lamp status={lampOf(secTally)} size={8} />
                            주관 {sec.lead}
                          </span>
                          {sec.help.length > 0 && (
                            <span className="text-xs font-normal text-slate-500">협조 {sec.help.join(" · ")}</span>
                          )}
                        </h4>
                        <ul className="mt-2 grid gap-x-8 lg:grid-cols-2">
                          {sec.forms.map((form) => {
                            const state = states.get(form.code);
                            const status = state?.status ?? "none";
                            return (
                              <li key={form.code} className="flex h-9 items-center gap-3 border-b border-slate-100 text-sm">
                                <span className="w-16 shrink-0 text-xs tabular-nums text-slate-400">QA-{form.code}</span>
                                {state?.docId ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpen(state.docId!, state.sheetName)}
                                    title={`${form.name} — 이 현장 서류 열기`}
                                    className={
                                      "min-w-0 flex-1 truncate text-left hover:text-blue-700 hover:underline " +
                                      (form.reference ? "text-slate-400" : "text-slate-600")
                                    }
                                  >
                                    {form.name}
                                  </button>
                                ) : (
                                  <span className={"min-w-0 flex-1 truncate " + (form.reference ? "text-slate-400" : "text-slate-600")}>
                                    {form.name}
                                  </span>
                                )}
                                {form.reference ? (
                                  <span className="shrink-0 rounded border border-slate-300 px-1 text-[10px] text-slate-500">기준</span>
                                ) : status === "done" ? (
                                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-green-700">
                                    <Lamp status="done" />
                                    {state?.finishedAt ? formatDate(state.finishedAt) : "작성됨"}
                                  </span>
                                ) : status === "doing" ? (
                                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-amber-700">
                                    <Lamp status="doing" />
                                    작성 중
                                  </span>
                                ) : (
                                  <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                                    <Lamp status="none" />
                                    {canWrite(form.code) ? (
                                      <button
                                        type="button"
                                        onClick={() => onWrite(form.code)}
                                        className="rounded px-1.5 py-0.5 text-blue-600 transition hover:bg-blue-50"
                                      >
                                        작성하기
                                      </button>
                                    ) : (
                                      <span className="px-1.5 text-slate-300" title="이 서식이 든 배포 양식이 아직 없습니다">
                                        양식 없음
                                      </span>
                                    )}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {sections.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">
              {onlyMissing ? "보이는 범위의 서류는 모두 끝났습니다." : "찾는 서식이 없습니다."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
