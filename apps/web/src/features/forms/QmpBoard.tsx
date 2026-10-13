/**
 * 배포 양식함·현장 서류함을 **품질관리계획서 구조**(장 → 절 → QA 서식)로 보여 준다.
 *
 * 2026-10-13 사용자 결정: 지금 보여 줄 것은 "품질관리계획서 기반 서류 통일화"다. 현장 문서트리
 * (코드표)는 제출 양식의 "확장 가능성"에 말로만 적는다 — 그래서 두 서류함 모두 이 화면이 기본이고,
 * 코드표 화면(`FormTree.tsx`)은 지우지 않고 숨겨 둔다.
 *
 * - **현장 서류함**: 서식마다 주관 부서(첨부 QA-6.3-2)의 신호등. 결재까지 끝나면 초록.
 * - **배포 양식함**: 서식마다 회사 양식이 올라와 있는지. 빠진 것을 본사가 바로 찾는다.
 *
 * 생김새는 기존 서류함(`FormTree.tsx`)을 따른다 — 흰 카드, 서류철 탭, 왼쪽 목록, 한 줄짜리 행.
 * 부서 탭은 **주관** 부서로 거른다. 협조까지 불을 켜면 서식 한 장에 불이 셋 붙어 흐려진다.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, FileSpreadsheet, Search, Upload } from "lucide-react";
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
  /** site: 현장 서류함(작성 신호등), library: 배포 양식함(양식이 있나) */
  mode: "site" | "library";
  title: string;
  states: Map<string, QmpFormState>;
  /** 계획서 서식이 아닌 서류(시트 이름에 QA 번호가 없는 것) — 숨기지 않고 맨 아래에 모은다 */
  others: { id: string; title: string }[];
  /** 서류(또는 배포 양식)를 그 시트로 연다 */
  onOpen: (docId: string, sheetName?: string) => void;
  /** 현장 서류함: 배포 양식으로 새로 작성한다 */
  onWrite?: (code: string) => void;
  /** 현장 서류함: 그 서식이 든 배포 양식이 있나 */
  canWrite?: (code: string) => boolean;
  /** 배포 양식함: 양식 올리기 */
  onUpload?: () => void;
  busy?: boolean;
  /** 도구 줄 오른쪽에 더 붙일 것(현장 서류함의 "배포 양식에서 가져오기" 등) */
  toolbarExtra?: ReactNode;
}

const CHAPTER_NOS = ["4", "5", "6", "7", "8", "9", "10"];

/** 신호등 하나. 색만으로 가르지 않도록 테두리·밝기도 다르게 하고 이름을 붙인다. */
export function Lamp({ status, size = 11, labels }: { status: QmpStatus; size?: number; labels?: Record<QmpStatus, string> }) {
  const label = (labels ?? { done: "작성 완료", doing: "작성 중", none: "미작성" })[status];
  const style = { width: size, height: size };
  if (status === "done") {
    return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full bg-green-600 ring-[3px] ring-green-600/20" />;
  }
  if (status === "doing") {
    return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full bg-amber-500" />;
  }
  return <span role="img" aria-label={label} title={label} style={style} className="inline-block shrink-0 rounded-full border-2 border-slate-400 bg-white" />;
}

const LIBRARY_LABELS: Record<QmpStatus, string> = { done: "양식 있음", doing: "양식 있음", none: "양식 없음" };

const formatDate = (ms: number) => {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

export default function QmpBoard({
  mode,
  title,
  states,
  others,
  onOpen,
  onWrite,
  canWrite,
  onUpload,
  busy,
  toolbarExtra,
}: Props) {
  const library = mode === "library";
  /** 배포 양식함은 절차·기준 문서(PROCESS 등)도 양식이므로 함께 센다. */
  const withRefs = library;
  const [dept, setDept] = useState<QmpDept | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");

  const tally = (d: QmpDept | null, ch: string | null = null) => qmpTally(states, d, ch, withRefs);
  const overall = tally(null);
  const percent = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(
    () =>
      QMP_SECTIONS.filter((sec) => (!dept || sec.lead === dept) && (!chapter || chapterOf(sec.no) === chapter))
        .map((sec) => ({
          ...sec,
          forms: sec.forms.filter((form) => {
            const counted = withRefs || !form.reference;
            if (onlyMissing && (!counted || states.get(form.code)?.status === "done")) return false;
            if (needle && !`qa-${form.code} ${form.name}`.toLowerCase().includes(needle)) return false;
            return true;
          }),
        }))
        .filter((sec) => sec.forms.length > 0 || (!onlyMissing && !needle)),
    [dept, chapter, onlyMissing, needle, states, withRefs],
  );

  const tabs: { key: QmpDept | null; label: string }[] = [{ key: null, label: "전체" }, ...QMP_DEPTS.map((d) => ({ key: d, label: d }))];
  const shownOthers = needle ? others.filter((doc) => doc.title.toLowerCase().includes(needle)) : others;

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            {title}{" "}
            <span className="text-sm font-normal tabular-nums text-slate-500">
              {overall.done} / {overall.total}
              {library ? "종" : "장"}
            </span>
          </h2>
          <div className="mt-2 h-1.5 w-44 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div
              className={"h-full rounded-full transition-all " + (library ? "bg-blue-600" : "bg-green-600")}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {library
              ? "품질관리계획서 서식별로 회사 양식이 올라와 있는지 봅니다. 양식 엑셀의 시트 이름(QA-7.2-2 등)으로 저절로 제자리를 찾습니다."
              : "품질관리계획서 절마다 주관 부서(첨부 QA-6.3-2)가 서류를 작성해 결재까지 마치면 초록불이 켜집니다."}
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
            {library ? "빠진 양식만" : "아직 안 끝난 것만"}
          </button>
          {toolbarExtra}
          {onUpload && (
            <button
              type="button"
              onClick={onUpload}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Upload size={13} /> {busy ? "읽는 중..." : "배포 양식 올리기"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="주관 부서">
          {tabs.map((tab) => {
            const t = tally(tab.key);
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
                {tab.key && !library && <Lamp status={lampOf(t)} size={9} />}
                {tab.label}{" "}
                <span className="font-normal tabular-nums text-slate-400">
                  {t.done}/{t.total}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3.5 pb-2 text-xs text-slate-500" aria-label="범례">
          {library ? (
            <>
              <span className="inline-flex items-center gap-1.5"><Lamp status="done" size={10} labels={LIBRARY_LABELS} />양식 있음</span>
              <span className="inline-flex items-center gap-1.5"><Lamp status="none" size={10} labels={LIBRARY_LABELS} />양식 없음</span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5"><Lamp status="done" size={10} />작성 완료(결재 끝)</span>
              <span className="inline-flex items-center gap-1.5"><Lamp status="doing" size={10} />작성 중·결재 대기</span>
              <span className="inline-flex items-center gap-1.5"><Lamp status="none" size={10} />미작성</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded border border-slate-300 px-1 text-[10px] text-slate-500">기준</span>절차·기준(작성 안 함)
              </span>
            </>
          )}
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
              {tally(dept).done}/{tally(dept).total}
            </span>
          </button>
          <ul className="mb-1 ml-5 mt-0.5 space-y-px">
            {CHAPTER_NOS.map((no) => {
              const t = tally(dept, no);
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
                    <span className={"ml-2 tabular-nums " + (t.total === 0 ? "text-slate-300" : "text-slate-500")}>
                      {t.total === 0 ? "–" : `${t.done}/${t.total}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {others.length > 0 && (
            <a
              href="#qmp-others"
              className="mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              그 밖의 서류
              <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">{others.length}</span>
            </a>
          )}
        </nav>

        <div className="min-w-0 flex-1 space-y-7">
          {CHAPTER_NOS.map((no) => {
            const inChapter = sections.filter((sec) => chapterOf(sec.no) === no);
            if (inChapter.length === 0) return null;
            const t = tally(dept, no);
            return (
              <div key={no}>
                <h3 className="flex items-baseline gap-2 border-b border-slate-200 pb-2 text-base font-semibold text-slate-900">
                  제 {no} 장 {QMP_CHAPTERS[no]}
                  <span className="text-sm font-normal tabular-nums text-slate-500">
                    {t.done}/{t.total}
                  </span>
                </h3>
                <div className="mt-3 space-y-4">
                  {inChapter.map((sec) => {
                    const secTally = { done: 0, doing: 0, total: 0 };
                    for (const form of sec.forms) {
                      if (!withRefs && form.reference) continue;
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
                            {!library && <Lamp status={lampOf(secTally)} size={8} />}
                            주관 {sec.lead}
                          </span>
                          {sec.help.length > 0 && (
                            <span className="text-xs font-normal text-slate-500">협조 {sec.help.join(" · ")}</span>
                          )}
                        </h4>
                        <ul className="mt-2 grid gap-x-8 lg:grid-cols-2">
                          {sec.forms.map((form) => (
                            <FormRow
                              key={form.code}
                              code={form.code}
                              name={form.name}
                              reference={form.reference}
                              library={library}
                              state={states.get(form.code)}
                              onOpen={onOpen}
                              onWrite={onWrite}
                              canWrite={canWrite}
                            />
                          ))}
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
              {onlyMissing ? (library ? "보이는 범위의 양식은 모두 올라와 있습니다." : "보이는 범위의 서류는 모두 끝났습니다.") : "찾는 서식이 없습니다."}
            </p>
          )}

          {/* 계획서 서식이 아닌 서류도 숨기지 않는다 — 사라진 줄 알면 다시 올려 같은 서류가 둘 생긴다. */}
          {!dept && !chapter && !onlyMissing && shownOthers.length > 0 && (
            <div id="qmp-others">
              <h3 className="flex items-baseline gap-2 border-b border-slate-200 pb-2 text-base font-semibold text-slate-900">
                그 밖의 서류
                <span className="text-sm font-normal tabular-nums text-slate-500">{shownOthers.length}</span>
              </h3>
              <p className="mt-2 text-xs text-slate-500">
                시트 이름에 QA 번호가 없어 계획서 서식과 맞추지 못한 {library ? "양식" : "서류"}입니다.
              </p>
              <ul className="mt-2 grid gap-x-8 lg:grid-cols-2">
                {shownOthers.map((doc) => (
                  <li key={doc.id} className="flex h-9 items-center gap-3 border-b border-slate-100 text-sm">
                    <FileSpreadsheet size={14} aria-hidden className="shrink-0 text-slate-400" />
                    <button
                      type="button"
                      onClick={() => onOpen(doc.id)}
                      className="min-w-0 flex-1 truncate text-left text-slate-600 hover:text-blue-700 hover:underline"
                      title={doc.title}
                    >
                      {doc.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FormRow({
  code,
  name,
  reference,
  library,
  state,
  onOpen,
  onWrite,
  canWrite,
}: {
  code: string;
  name: string;
  reference: boolean;
  library: boolean;
  state: QmpFormState | undefined;
  onOpen: (docId: string, sheetName?: string) => void;
  onWrite?: (code: string) => void;
  canWrite?: (code: string) => boolean;
}) {
  const status = state?.status ?? "none";
  const dim = reference && !library;
  return (
    <li className="flex h-9 items-center gap-3 border-b border-slate-100 text-sm">
      <span className="w-16 shrink-0 text-xs tabular-nums text-slate-400">QA-{code}</span>
      {state?.docId ? (
        <button
          type="button"
          onClick={() => onOpen(state.docId!, state.sheetName)}
          title={library ? `${name} — 배포 양식 열기` : `${name} — 이 현장 서류 열기`}
          className={"min-w-0 flex-1 truncate text-left hover:text-blue-700 hover:underline " + (dim ? "text-slate-400" : "text-slate-600")}
        >
          {name}
        </button>
      ) : (
        <span className={"min-w-0 flex-1 truncate " + (dim ? "text-slate-400" : "text-slate-600")}>{name}</span>
      )}
      {library ? (
        status === "none" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
            <Lamp status="none" labels={LIBRARY_LABELS} />
            양식 없음
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-blue-700">
            <Lamp status="done" labels={LIBRARY_LABELS} />
            양식 있음
          </span>
        )
      ) : reference ? (
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
          {canWrite?.(code) ? (
            <button
              type="button"
              onClick={() => onWrite?.(code)}
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
}
