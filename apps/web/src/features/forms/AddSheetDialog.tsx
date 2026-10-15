/**
 * [시트 추가] — 어느 시트를 바탕으로 새 장을 만들지 작성자가 고른다(2026-10-14 사용자 요청).
 *
 * 예전에는 견본 시트를 저절로 골라 이름만 물었다. 서식마다 쓰는 장이 달라(QA-4.3-2 관계도를 한 장 더,
 * 견본 대신 지난달 장의 틀을 쓰고 싶을 때 등) 바탕을 고를 수 있어야 한다. 어느 시트를 고르든 표·머리글은
 * 그대로 두고 채운 내용과 견본 표시("Sample" 도장·제출 시 삭제 안내)는 빼고 만든다(`withCustomSheets`).
 */
import { useState } from "react";
import { Check, FilePlus2, X } from "lucide-react";

export default function AddSheetDialog({
  sheets,
  initial,
  onCancel,
  onConfirm,
}: {
  /** 바탕으로 쓸 수 있는 시트(원본 엑셀에 있는 장) */
  sheets: string[];
  /** 처음 골라 둘 시트(견본이 있으면 견본) */
  initial: string;
  onCancel: () => void;
  onConfirm: (source: string, name: string) => void;
}) {
  const [source, setSource] = useState(sheets.includes(initial) ? initial : sheets[0]);
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-sheet-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onConfirm(source, trimmed);
        }}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <FilePlus2 size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="add-sheet-title" className="text-base font-bold text-slate-900">
              시트 추가
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              고른 시트의 표·머리글로 새 장을 만듭니다. 채워 넣은 내용과 견본 표시("Sample")는 빠집니다.
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <p className="px-5 pt-3 text-xs font-medium text-slate-600">바탕으로 쓸 시트</p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {sheets.map((item) => (
            <li key={item}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                <input type="radio" name="add-sheet-source" checked={source === item} onChange={() => setSource(item)} />
                <span className="truncate">{item}</span>
                {item === initial && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">견본</span>}
              </label>
            </li>
          ))}
        </ul>

        <label className="block border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-600">
          새 시트 이름
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 2026-07"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            취소
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            <Check size={15} /> 만들기
          </button>
        </div>
      </form>
    </div>
  );
}
