/**
 * 배포 양식함·현장 서류함을 **품질관리계획서 구조**(장 → 절 → QA 서식)로 보여 준다.
 *
 * 2026-10-13 사용자 결정: 지금 보여 줄 것은 "품질관리계획서 기반 서류 통일화"다. 현장 문서트리
 * (코드표)는 제출 양식의 "확장 가능성"에 말로만 적는다 — 그래서 두 서류함 모두 이 화면이 기본이고,
 * 코드표 화면(`FormTree.tsx`)은 지우지 않고 숨겨 둔다.
 *
 * - **현장 서류함**: 서식마다 신호등. 결재까지 끝나면 초록. 절마다 작성 부서(첨부 QA-6.3-2 의 주관·협조)를 단다.
 * - **배포 양식함**: 서식마다 회사 양식이 올라와 있는지. 빠진 것을 본사가 바로 찾는다.
 *
 * 생김새는 기존 서류함(`FormTree.tsx`)을 따른다 — 흰 카드, 서류철 탭, 왼쪽 목록, 한 줄짜리 행.
 * 부서 탭은 주관·협조를 가리지 않고 **그 부서가 쓰는 절**을 모두 보인다. 불은 서식마다 하나다
 * (누가 썼든 서류가 있으면 켜진다) — 부서마다 불을 달면 서식 한 장에 불이 셋 붙어 흐려진다.
 */
import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Check, ChevronDown, Download, FilePenLine, FileSpreadsheet, Search, Upload, X } from "lucide-react";
import QmpSettingsDialog from "./QmpSettingsDialog";
import { CYCLE_LABEL, PERIODIC, type QmpCycle, type QmpSiteSettings } from "./qmpCycle";
import {
  QMP_CHAPTERS,
  QMP_DEPTS,
  QMP_SECTIONS,
  chapterOf,
  lampOf,
  qmpTally,
  sectionOfCode,
  writersOf,
  writesSection,
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
  onOpen: (docId: string, sheetName?: string, code?: string) => void;
  /**
   * 현장 서류함: 그 서식을 쓴다 — 쓰는 부서와 함께. 이미 이 현장에 그 서식이 든 서류가 있으면
   * 그것을 열고(`existing`), 없으면 배포 양식으로 새로 만든다.
   */
  onWrite?: (code: string, dept: QmpDept, existing?: { docId: string; sheetName?: string }) => void;
  /** 현장 서류함: 이미 정한 작성 부서를 바꾼다 */
  onSetDept?: (docId: string, sheetName: string, dept: QmpDept) => void;
  /** 현장 서류함: 그 서식이 든 배포 양식이 있나 */
  canWrite?: (code: string) => boolean;
  /** 배포 양식함: 양식 올리기 */
  onUpload?: () => void;
  /** 현장 서류함: 아직 없는 서식의 배포 양식을 한 번에 가져올 수(양식 수) */
  importCount?: number;
  /** 현장 서류함: [전체 가져오기] */
  onImportAll?: () => void;
  busy?: boolean;
  /** 도구 줄 오른쪽에 더 붙일 것(현장 서류함의 "배포 양식에서 가져오기" 등) */
  toolbarExtra?: ReactNode;
  /** 현장 서류함: 이 현장 작성 일정(착공일·작성 주기·적용 제외)과 저장 */
  siteName?: string;
  settings?: QmpSiteSettings;
  onSaveSettings?: (next: QmpSiteSettings) => void;
}

const CHAPTER_NOS = ["4", "5", "6", "7", "8", "9", "10"];

/** 끝난 비율(%) — 결재까지 끝난 것만 센다 */
const percentOf = (t: { done: number; total: number }) => (t.total > 0 ? Math.round((t.done / t.total) * 100) : 0);

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
  onSetDept,
  canWrite,
  onUpload,
  importCount = 0,
  onImportAll,
  busy,
  toolbarExtra,
  siteName,
  settings,
  onSaveSettings,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const library = mode === "library";
  /** 배포 양식함은 절차·기준 문서(PROCESS 등)도 양식이므로 함께 센다. */
  const withRefs = library;
  const [dept, setDept] = useState<QmpDept | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");
  /** 부서를 골라야 하는 서식(전체 탭에서 [작성하기], 또는 부서 바꾸기) */
  const [picking, setPicking] = useState<{ code: string; name: string; change: boolean } | null>(null);

  /** 그 서식이 든 이 현장 서류(전체 가져오기 등으로 이미 있으면) */
  const existingOf = (code: string) => {
    const state = states.get(code);
    return state?.docId ? { docId: state.docId, sheetName: state.sheetName } : undefined;
  };

  /**
   * [작성하기] — 부서 탭에서 누르면 그 부서가 쓴다(묻지 않는다). 전체 탭에서 누르면 누가 쓰는지
   * 몰라서 묻는다(2026-10-13 사용자 요청). 그 부서가 쓰는 절이 아니면 역시 묻는다.
   */
  const requestWrite = (code: string, name: string) => {
    const sec = sectionOfCode(code);
    if (dept && sec && writersOf(sec).includes(dept)) onWrite?.(code, dept, existingOf(code));
    else setPicking({ code, name, change: false });
  };

  const tally = (d: QmpDept | null, ch: string | null = null) => qmpTally(states, d, ch, withRefs);
  const overall = tally(null);
  /** 진행률 막대는 고른 부서 탭을 따른다 — "우리 부서는 얼마나 했나" 가 바로 보이게. */
  const current = tally(dept);
  const percent = percentOf(current);
  /** 고른 부서가 실제로 맡아 쓴(쓰는 중 포함) 서식 수 */
  const ownWritten = dept
    ? [...states.values()].filter((state) => state.dept === dept && state.status !== "none").length
    : 0;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(
    () =>
      QMP_SECTIONS.filter((sec) => (!dept || writesSection(sec, dept)) && (!chapter || chapterOf(sec.no) === chapter))
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
          <div className="mt-2 flex items-center gap-2.5">
            <div className="h-1.5 w-44 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div
                className={"h-full rounded-full transition-all " + (library ? "bg-blue-600" : "bg-green-600")}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-600">
              <span className="font-semibold text-slate-900">{percent}%</span>
              {dept && (
                <span className="text-slate-500">
                  {" "}
                  · {dept} {current.done}/{current.total}
                  {!library && ownWritten > 0 && ` · ${dept}가 맡아 쓴 서식 ${ownWritten}장`}
                </span>
              )}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {library
              ? "품질관리계획서 서식별로 회사 양식이 올라와 있는지 봅니다. 양식 엑셀의 시트 이름(QA-7.2-2 등)으로 저절로 제자리를 찾습니다."
              : "품질관리계획서 절마다 작성 부서(첨부 QA-6.3-2)가 서류를 작성해 결재까지 마치면 초록불이 켜집니다."}
          </p>
          {!library && onSaveSettings && (
            <p className="mt-1 text-xs text-slate-500">
              {settings?.startDate ? (
                <>
                  착공 {settings.startDate.replace(/-/g, ".")} 부터 월간·분기·연간 서식의 작성 횟수를 셉니다.
                  {(settings.excluded?.length ?? 0) > 0 && ` 적용 제외: ${settings.excluded!.join(", ")}`}
                </>
              ) : (
                <span className="text-amber-700">
                  [작성 일정]에서 착공일을 정하면 월간·분기·연간 서식이 몇 번 중 몇 번 작성됐는지 보입니다.
                </span>
              )}
            </p>
          )}
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
          {!library && onSaveSettings && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="서식마다 언제 써야 하는지 정합니다 — 착공일, 작성 주기(월간·분기·연간·수시…), 이 현장에서 안 쓰는 절. 진척(%)은 이 일정으로 셉니다"
              className={
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ring-1 transition " +
                (settings?.startDate
                  ? "text-slate-600 ring-slate-300 hover:bg-slate-50"
                  : "bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100")
              }
            >
              <CalendarClock size={13} /> {settings?.startDate ? "작성 일정" : "작성 일정 정하기"}
            </button>
          )}
          {toolbarExtra}
          {onImportAll && (
            <button
              type="button"
              onClick={onImportAll}
              disabled={busy || importCount === 0}
              title={
                importCount === 0
                  ? "가져올 양식이 없습니다 — 배포 양식이 있는 서식은 이미 이 현장 서류함에 있습니다"
                  : `아직 이 현장에 없는 서식의 배포 양식 ${importCount}종을 한 번에 만듭니다`
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Download size={13} /> {busy ? "만드는 중..." : `전체 가져오기${importCount > 0 ? ` (${importCount}종)` : ""}`}
            </button>
          )}
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
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="작성 부서">
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
                  {t.done}/{t.total} · {percentOf(t)}%
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
                <span className="rounded border border-slate-300 px-1 text-[10px] text-slate-500">참고</span>작성하지 않고 보고 따르는 서류(흐름도·작성방법·평가기준)
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
                    const secExcluded = !library && (settings?.excluded ?? []).includes(sec.no);
                    for (const form of sec.forms) {
                      if (!withRefs && form.reference) continue;
                      const formState = states.get(form.code);
                      if (formState?.excluded || formState?.notYet) continue;
                      const status = formState?.status ?? "none";
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
                            {!library && !secExcluded && <Lamp status={lampOf(secTally)} size={8} />}
                            작성 {[`${sec.lead}(주관)`, ...sec.help].join(" · ")}
                          </span>
                          {secExcluded && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                              이 현장 적용 제외
                            </span>
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
                              onWrite={onWrite ? () => requestWrite(form.code, form.name) : undefined}
                              onChangeDept={
                                onSetDept ? () => setPicking({ code: form.code, name: form.name, change: true }) : undefined
                              }
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
      {settingsOpen && onSaveSettings && (
        <QmpSettingsDialog
          siteName={siteName ?? "현장"}
          settings={settings}
          onCancel={() => setSettingsOpen(false)}
          onSave={(next) => {
            setSettingsOpen(false);
            onSaveSettings(next);
          }}
        />
      )}
      {picking && (
        <DeptPickDialog
          code={picking.code}
          name={picking.name}
          change={picking.change}
          writers={writersOf(sectionOfCode(picking.code) ?? QMP_SECTIONS[0])}
          current={states.get(picking.code)?.dept}
          onCancel={() => setPicking(null)}
          onConfirm={(chosen) => {
            const existing = existingOf(picking.code);
            setPicking(null);
            if (!picking.change) onWrite?.(picking.code, chosen, existing);
            else if (existing?.sheetName) onSetDept?.(existing.docId, existing.sheetName, chosen);
          }}
        />
      )}
    </section>
  );
}

/** 누가 쓰는지 고른다 — 그 절의 작성 부서만 보이고, 주관 부서를 미리 골라 둔다. */
function DeptPickDialog({
  code,
  name,
  change,
  writers,
  current,
  onCancel,
  onConfirm,
}: {
  code: string;
  name: string;
  change: boolean;
  writers: QmpDept[];
  current?: QmpDept;
  onCancel: () => void;
  onConfirm: (dept: QmpDept) => void;
}) {
  const [chosen, setChosen] = useState<QmpDept>(current && writers.includes(current) ? current : writers[0]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dept-pick-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <FilePenLine size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="dept-pick-title" className="text-base font-bold text-slate-900">
              {change ? "작성 부서 바꾸기" : "어느 부서가 쓰나요?"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500" title={name}>
              QA-{code} {name}
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <ul className="px-5 py-3">
          {writers.map((writer, index) => (
            <li key={writer}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-800 hover:bg-slate-50">
                <input type="radio" name="qmp-dept" checked={chosen === writer} onChange={() => setChosen(writer)} />
                {writer}
                {index === 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">주관</span>}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            취소
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onConfirm(chosen)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Check size={15} /> {change ? "바꾸기" : "작성하기"}
          </button>
        </div>
      </div>
    </div>
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
  onChangeDept,
  canWrite,
}: {
  code: string;
  name: string;
  reference: boolean;
  library: boolean;
  state: QmpFormState | undefined;
  onOpen: (docId: string, sheetName?: string, code?: string) => void;
  onWrite?: () => void;
  onChangeDept?: () => void;
  canWrite?: (code: string) => boolean;
}) {
  const status = state?.status ?? "none";
  const dim = reference && !library;
  /** 쓰는 부서 — 누르면 바꾼다 */
  const deptTag = state?.dept ? (
    <button
      type="button"
      onClick={onChangeDept}
      disabled={!onChangeDept || !state.sheetName}
      title="작성 부서 바꾸기"
      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-200 disabled:hover:bg-slate-100"
    >
      {state.dept}
    </button>
  ) : null;
  const [open, setOpen] = useState(false);
  const cycle = !library && !reference ? state?.cycle : undefined;
  const periodic = cycle !== undefined && PERIODIC.includes(cycle);
  const periods = state?.periods;
  /** 지난 기간 가운데 비어 있는 수(지금 기간은 빼고) */
  const missed = periods ? periods.slice(0, -1).filter((period) => period.status === "none").length : 0;
  /** 주기 표시 — 누르면 기간별 칸이 펼쳐진다 */
  const cycleTag = !cycle || cycle === "once" || state?.excluded || state?.notYet ? null : periodic && periods ? (
    <button
      type="button"
      onClick={() => setOpen((on) => !on)}
      aria-expanded={open}
      title={missed > 0 ? `지난 기간 중 ${missed}번이 비어 있습니다 — 눌러서 기간별로 봅니다` : "눌러서 기간별로 봅니다"}
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums ring-1 transition " +
        (missed > 0 ? "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100" : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100")
      }
    >
      {CYCLE_LABEL[cycle]} · {state?.written ?? 0}/{state?.due ?? 0}
      <ChevronDown size={11} aria-hidden className={open ? "rotate-180 transition" : "transition"} />
    </button>
  ) : (
    <span
      className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500 ring-1 ring-slate-200"
      title={periodic ? "[작성 일정]에서 착공일을 정하면 몇 번 중 몇 번 썼는지 셉니다" : "일이 생길 때마다 쓰는 서식 — 쓴 장 수"}
    >
      {CYCLE_LABEL[cycle]}
      {cycle === "adhoc" ? ` · ${state?.count ?? 0}건` : ""}
    </span>
  );
  return (
    <li className="border-b border-slate-100">
      <div className="flex h-9 items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-xs tabular-nums text-slate-400">QA-{code}</span>
      {state?.docId ? (
        <button
          type="button"
          onClick={() => onOpen(state.docId!, state.sheetName, code)}
          title={library ? `${name} — 배포 양식 열기` : `${name} — 이 현장 서류 열기`}
          className={"min-w-0 flex-1 truncate text-left hover:text-blue-700 hover:underline " + (dim || state.excluded ? "text-slate-400" : "text-slate-600")}
        >
          {name}
        </button>
      ) : (
        <span className={"min-w-0 flex-1 truncate " + (dim || state?.excluded ? "text-slate-400" : "text-slate-600")}>{name}</span>
      )}
      {cycleTag}
      {state?.quietDays !== undefined && (
        <span
          className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] tabular-nums text-amber-800 ring-1 ring-amber-200"
          title={`마지막 기록 ${state.lastAt ? formatDate(state.lastAt) : ""} — 일이 있었는데 안 적었는지 확인해 보세요. 알림 날수는 [작성 일정]에서 바꾸거나 끌 수 있습니다`}
        >
          {state.quietDays}일째 기록 없음
        </span>
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
        <span className="shrink-0 rounded border border-slate-300 px-1 text-[10px] text-slate-500">참고</span>
      ) : state?.excluded ? (
        <span className="shrink-0 text-xs text-slate-400">적용 제외</span>
      ) : state?.notYet ? (
        <span className="shrink-0 text-xs text-slate-400" title="준공 때 쓰는 서식입니다 — 그 전에는 세지 않습니다">
          준공 때 작성
        </span>
      ) : status === "done" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-green-700">
          {deptTag}
          <Lamp status="done" />
          {periodic && periods ? "기간 모두 작성" : state?.finishedAt ? formatDate(state.finishedAt) : "작성됨"}
        </span>
      ) : status === "doing" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-amber-700">
          {deptTag}
          <Lamp status="doing" />
          {periodic && periods && missed > 0 ? `${missed}번 빠짐` : "작성 중"}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-2 text-xs">
          {deptTag}
          <Lamp status="none" />
          {/* 이미 이 현장에 그 서식이 든 서류가 있으면(전체 가져오기 등) 새로 만들지 않고 그것을 연다. */}
          {state?.docId || canWrite?.(code) ? (
            <button
              type="button"
              onClick={() => onWrite?.()}
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
      </div>
      {open && periods && cycle && <PeriodDots cycle={cycle} periods={periods} onOpen={(docId, sheetName) => onOpen(docId, sheetName, code)} onWrite={onWrite} />}
    </li>
  );
}

/** 기간별 칸 — 해마다 한 줄. ● 씀, ◐ 작성 중, ○ 빠짐, 점선 ○ 지금 기간(아직 안 써도 됨) */
function PeriodDots({
  cycle,
  periods,
  onOpen,
  onWrite,
}: {
  cycle: QmpCycle;
  periods: NonNullable<QmpFormState["periods"]>;
  onOpen: (docId: string, sheetName?: string, code?: string) => void;
  onWrite?: () => void;
}) {
  const years = new Map<string, typeof periods>();
  for (const period of periods) {
    const year = period.key.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), period]);
  }
  const lastKey = periods[periods.length - 1]?.key;
  /** 해의 몇 번째 칸인가 — 첫 해는 착공 전 칸을 비워 두어 열이 1월(1분기)부터 맞게 */
  const slot = (key: string) =>
    cycle === "monthly" ? Number(key.slice(5, 7)) - 1 : cycle === "quarterly" || cycle === "half" ? Number(key.slice(6)) - 1 : 0;
  const slots = cycle === "monthly" ? 12 : cycle === "quarterly" ? 4 : cycle === "half" ? 2 : 0;
  return (
    <div className="mb-2 ml-[76px] space-y-1 rounded-lg bg-slate-50 px-3 py-2">
      {[...years.entries()].map(([year, list]) => (
        <div key={year} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-slate-500">{year}</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: slot(list[0].key) }, (_, i) => (
              <span key={`pad${i}`} aria-hidden className="h-3.5 w-3.5" />
            ))}
            {list.map((period) => {
              const current = period.key === lastKey;
              const label =
                period.status === "done"
                  ? "작성"
                  : period.status === "doing"
                    ? "작성 중"
                    : current
                      ? "지금 기간 — 아직 안 씀"
                      : "빠짐";
              const look =
                period.status === "done"
                  ? "bg-green-600"
                  : period.status === "doing"
                    ? "bg-amber-500"
                    : current
                      ? "border border-dashed border-slate-400 bg-white"
                      : "border-2 border-rose-400 bg-white";
              return (
                <button
                  key={period.key}
                  type="button"
                  title={`${period.label} — ${label}${period.docId ? " (눌러서 열기)" : ""}`}
                  aria-label={`${period.label} ${label}`}
                  onClick={() => (period.docId ? onOpen(period.docId, period.sheetName) : onWrite?.())}
                  className={"h-3.5 w-3.5 rounded-full transition hover:scale-125 " + look}
                />
              );
            })}
          </div>
        </div>
      ))}
      {slots > 0 && (
        <div className="flex items-center gap-2" aria-hidden>
          <span className="w-10 shrink-0" />
          <div className="flex gap-1">
            {Array.from({ length: slots }, (_, i) => (
              <span key={i} className="w-3.5 text-center text-[9px] tabular-nums text-slate-400">
                {i + 1}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">{cycle === "monthly" ? "월" : cycle === "quarterly" ? "분기" : "반기"}</span>
        </div>
      )}
      <p className="pt-0.5 text-[11px] text-slate-500">
        월별 장은 [시트 추가]로 더하고 이름에 달을 적으면(예: 2026-07) 그 달로 셉니다. 달이 없으면 만든 날로 셉니다.
      </p>
    </div>
  );
}
