/**
 * 한 칸에 배포 양식이 여럿일 때 — 골라서(기본은 모두) 한 번에 현장 서류함에 만든다.
 *
 * 712 현장설명서 칸처럼 공종마다 다른 서류가 9종씩 올라온다. [작성하기]가 최신 한 장만 가져오면
 * 나머지 8종은 배포 양식함까지 가서 하나씩 눌러야 한다(사용자 신고). 이미 이 현장에 있는 서류는
 * 표시하고 기본 선택에서 뺀다 — 모르고 두 번 만들지 않게.
 */
import { useState } from "react";
import { Check, FilePenLine, X } from "lucide-react";

export interface SlotWriteChoice {
  id: string;
  title: string;
  uploadedAt: number;
  /** 이 현장에 이미 만든 부수(같은 서류의 옛 판 포함) */
  existing: number;
}

export default function SlotWriteDialog({
  slotLabel,
  siteName,
  choices,
  busy,
  onCancel,
  onConfirm,
}: {
  slotLabel: string;
  siteName: string;
  choices: SlotWriteChoice[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (templateIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(choices.filter((choice) => choice.existing === 0).map((choice) => choice.id)),
  );
  const allPicked = picked.size === choices.length;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="slot-write-title">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-200 px-6 py-4">
          <FilePenLine size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="slot-write-title" className="text-lg font-bold text-slate-900">
              {slotLabel} 작성하기
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              이 칸에 배포 양식이 {choices.length}종 있습니다. 고른 양식이 {siteName} 서류함에 한 번에 만들어집니다.
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-6 py-2.5 text-xs">
          <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(choices.map((choice) => choice.id)))}
            />
            전체 선택
          </label>
          <span className="text-slate-400">이미 있는 서류는 처음에 선택하지 않았습니다</span>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
          {choices.map((choice) => (
            <li key={choice.id} className="border-b border-slate-100">
              <label className="flex cursor-pointer items-center gap-3 px-6 py-2.5 hover:bg-slate-50">
                <input type="checkbox" checked={picked.has(choice.id)} onChange={() => toggle(choice.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800" title={choice.title}>
                    {choice.title}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    배포 {new Date(choice.uploadedAt).toLocaleDateString("ko-KR")}
                  </span>
                </span>
                {choice.existing > 0 && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                    이미 {choice.existing}부 있음
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 border-t border-slate-200 px-6 py-3">
          <span className="text-xs text-slate-500">{picked.size}종 선택</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              취소
            </button>
            <button
              type="button"
              disabled={picked.size === 0 || busy}
              onClick={() => onConfirm(choices.filter((choice) => picked.has(choice.id)).map((choice) => choice.id))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              <Check size={15} /> {busy ? "만드는 중..." : `${picked.size}종 작성하기`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
