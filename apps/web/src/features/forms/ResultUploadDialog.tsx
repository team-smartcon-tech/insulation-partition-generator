/**
 * [결과 올리기] — 다른 사내 시스템에서 작성한 서식(공정표·품질방침 등)의 결과 파일(PDF)을 올린다
 * (2026-10-17 사용자 결정). 올린 파일은 그 현장 서류로 남고, 이름을 서식 번호로 시작하게 지어
 * 그 서식에 붙는다(`sheetCodesOf`). 주기 서식은 고른 주·달이 채워진다.
 */
import { useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import type { QmpFormState } from "./qmpPlan";
import { PERIODIC, periodsBetween, resultTitle, type QmpCycle } from "./qmpCycle";

type Period = NonNullable<QmpFormState["periods"]>[number];

/** 착공일이 없어 기간 목록이 없을 때 고를 수 있게 — 최근 기간 몇 개(주 12·달 12·분기 8·반기 6·해 5) */
function recentPeriods(cycle: QmpCycle, today = new Date()): Period[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const from =
    cycle === "weekly"
      ? new Date(y, m, today.getDate() - 7 * 11)
      : cycle === "monthly"
        ? new Date(y, m - 11, 1)
        : cycle === "quarterly"
          ? new Date(y, m - 21, 1)
          : cycle === "half"
            ? new Date(y, m - 30, 1)
            : new Date(y - 4, 0, 1);
  return periodsBetween(cycle, from, today).map((period) => ({ key: period.key, label: period.label, status: "none" as const }));
}

export default function ResultUploadDialog({
  code,
  name,
  cycle,
  periods: givenPeriods,
  initialKey,
  link,
  onCancel,
  onConfirm,
}: {
  code: string;
  name: string;
  /** 작성 주기 — 착공일이 없어 기간 목록이 없으면 최근 기간으로 고르게 한다 */
  cycle?: QmpCycle;
  /** 주기 서식이면 기간 목록(마지막이 지금 기간) */
  periods?: Period[];
  /** 처음 골라 둘 기간(빈 칸을 눌러 왔으면 그 칸) */
  initialKey?: string;
  /** 그 시스템 화면 주소 */
  link?: string;
  onCancel: () => void;
  onConfirm: (file: File, title: string) => void;
}) {
  const periods = givenPeriods?.length ? givenPeriods : cycle && PERIODIC.includes(cycle) ? recentPeriods(cycle) : undefined;
  const [file, setFile] = useState<File | null>(null);
  // 빈 칸을 누르고 왔으면 그 칸, 아니면 아직 안 채운 가장 최근 기간
  const [key, setKey] = useState(
    initialKey ??
      [...(periods ?? [])].reverse().find((period) => period.status === "none")?.key ??
      periods?.[periods.length - 1]?.key ??
      "",
  );
  const period = periods?.find((item) => item.key === key);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-upload-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (file) onConfirm(file, resultTitle(code, name, period));
        }}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <FileUp size={20} className="mt-0.5 text-indigo-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="result-upload-title" className="text-base font-bold text-slate-900">
              결과 올리기
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500" title={name}>
              QA-{code} {name}
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-xs text-slate-600">
            다른 시스템에서 작성한 결과를 PDF로 뽑아 올리세요. 이 현장 서류함에 남고, 본사 점검에서도 볼 수 있습니다.
            {link && (
              <>
                {" "}
                <a href={link} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">
                  작성 화면 열기
                </a>
              </>
            )}
          </p>

          {periods && periods.length > 0 && (
            <label className="block text-xs font-medium text-slate-700">
              어느 기간 것인가요
              <select
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800"
              >
                {[...periods].reverse().map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                    {item.status === "none" ? "" : " — 이미 올림"}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-xs font-medium text-slate-700">
            파일
            <input
              type="file"
              accept=".pdf,application/pdf,image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700"
            />
          </label>
          {file && (
            <p className="truncate text-xs text-slate-500" title={resultTitle(code, name, period)}>
              저장 이름: {resultTitle(code, name, period)}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            취소
          </button>
          <button
            type="submit"
            disabled={!file}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
          >
            <Check size={15} /> 올리기
          </button>
        </div>
      </form>
    </div>
  );
}
