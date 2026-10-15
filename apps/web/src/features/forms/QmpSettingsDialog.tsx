/**
 * [작성 기준] — 이 현장에서 무엇을 언제 써야 하는지: 착공일·서식별 작성 주기·적용 제외 절을 정한다
 * (2026-10-15 사용자 결정: 현장마다 계획서가 달라 주기도 다르다, 그 현장 사람 누구나 바꾼다).
 * 이름은 "계획서 설정"이었다 — 계획서 파일을 고치는 것처럼 읽혀 바꿨다(같은 날 사용자 요청).
 *
 * 회사 기본값(`DEFAULT_CYCLES`)과 다른 주기만 저장한다 — 기본값이 나중에 바뀌어도 현장이 일부러
 * 바꾼 것만 남는다.
 */
import { useMemo, useState } from "react";
import { Check, RotateCcw, Settings2, X } from "lucide-react";
import { QMP_SECTIONS } from "./qmpPlan";
import { CYCLE_LABEL, CYCLE_ORDER, DEFAULT_CYCLES, cycleOf, parseDay, type QmpCycle, type QmpSiteSettings } from "./qmpCycle";

/**
 * 계획서에서 읽어 둔 착공일 — 설정이 비어 있을 때 미리 채워 둔다(저장은 사람이 누른다).
 * 부산 장안: 품질관리계획서 4.1.1 공사기간 "2025년 04월 01일 ~ 2027년 11월 30일".
 */
const KNOWN_START: [RegExp, string][] = [[/장안/, "2025-04-01"]];

export default function QmpSettingsDialog({
  siteName,
  settings,
  onCancel,
  onSave,
}: {
  siteName: string;
  settings?: QmpSiteSettings;
  onCancel: () => void;
  onSave: (next: QmpSiteSettings) => void;
}) {
  const suggested = settings?.startDate ? undefined : KNOWN_START.find(([re]) => re.test(siteName))?.[1];
  const [startDate, setStartDate] = useState(settings?.startDate ?? suggested ?? "");
  const [cycles, setCycles] = useState<Record<string, QmpCycle>>(settings?.cycles ?? {});
  const [excluded, setExcluded] = useState<string[]>(settings?.excluded ?? []);
  const draft: QmpSiteSettings = { cycles };
  const validStart = startDate === "" || parseDay(startDate) !== null;

  const sections = useMemo(
    () => QMP_SECTIONS.map((sec) => ({ ...sec, forms: sec.forms.filter((form) => !form.reference) })).filter((sec) => sec.forms.length > 0),
    [],
  );
  const changedCount = Object.keys(cycles).length;

  const setCycle = (code: string, cycle: QmpCycle) =>
    setCycles((prev) => {
      const next = { ...prev };
      if ((DEFAULT_CYCLES[code] ?? "once") === cycle) delete next[code];
      else next[code] = cycle;
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qmp-settings-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validStart) return;
          onSave({
            ...(startDate ? { startDate } : {}),
            ...(changedCount > 0 ? { cycles } : {}),
            ...(excluded.length > 0 ? { excluded } : {}),
            updatedAt: Date.now(),
          });
        }}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <Settings2 size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="qmp-settings-title" className="text-base font-bold text-slate-900">
              {siteName} 작성 기준
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              이 현장에서 무엇을 언제 써야 하는지 품질관리계획서대로 정합니다. 진척(%)은 이 기준으로 셉니다 — 월간·분기·연간
              서식은 착공일부터 오늘까지 써야 했던 횟수와 비교합니다.
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <label className="block text-sm font-medium text-slate-700">
            착공일
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="ml-3 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800"
            />
            {suggested && startDate === suggested && (
              <span className="ml-2 text-xs font-normal text-slate-500">계획서 4.1.1 공사기간에서 가져왔습니다</span>
            )}
            {!startDate && <span className="ml-2 text-xs font-normal text-amber-700">비워 두면 주기별 진척을 세지 않습니다</span>}
          </label>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-700">
                서식별 작성 주기{" "}
                <span className="font-normal text-slate-500">· 회사 기본값과 다르게 정한 서식 {changedCount}개</span>
              </h3>
              {changedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCycles({})}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                >
                  <RotateCcw size={12} /> 모두 회사 기본값으로
                </button>
              )}
            </div>
            <div className="mt-2 space-y-3">
              {sections.map((sec) => {
                const off = excluded.includes(sec.no);
                return (
                  <div key={sec.no} className={"rounded-lg ring-1 ring-slate-200 " + (off ? "bg-slate-50" : "")}>
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                      <span className={"text-sm font-medium " + (off ? "text-slate-400" : "text-slate-800")}>
                        <span className="tabular-nums">{sec.no}</span> {sec.title}
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={off}
                          onChange={(event) =>
                            setExcluded((prev) =>
                              event.target.checked ? [...prev, sec.no] : prev.filter((no) => no !== sec.no),
                            )
                          }
                        />
                        이 현장 적용 제외
                      </label>
                    </div>
                    {!off && (
                      <ul className="grid gap-x-6 px-3 py-1 sm:grid-cols-2">
                        {sec.forms.map((form) => {
                          const value = cycleOf(form.code, draft);
                          const changed = form.code in cycles;
                          return (
                            <li key={form.code} className="flex h-8 items-center gap-2 text-xs">
                              <span className="w-14 shrink-0 tabular-nums text-slate-400">QA-{form.code}</span>
                              <span className="min-w-0 flex-1 truncate text-slate-700" title={form.name}>
                                {form.name}
                              </span>
                              <select
                                value={value}
                                onChange={(event) => setCycle(form.code, event.target.value as QmpCycle)}
                                aria-label={`QA-${form.code} 작성 주기`}
                                className={
                                  "rounded border px-1.5 py-0.5 text-xs " +
                                  (changed ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-300 text-slate-700")
                                }
                              >
                                {CYCLE_ORDER.map((cycle) => (
                                  <option key={cycle} value={cycle}>
                                    {CYCLE_LABEL[cycle]}
                                    {(DEFAULT_CYCLES[form.code] ?? "once") === cycle ? " (기본)" : ""}
                                  </option>
                                ))}
                              </select>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500">
            {settings?.updatedAt ? `마지막 저장 ${new Date(settings.updatedAt).toLocaleString("ko-KR")}` : "아직 저장한 적 없음 — 회사 기본값으로 셉니다"}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              취소
            </button>
            <button
              type="submit"
              disabled={!validStart}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              <Check size={15} /> 저장
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
