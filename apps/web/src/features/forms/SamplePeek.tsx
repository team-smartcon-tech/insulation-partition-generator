/**
 * 견본 시트를 **떠 있는 창**으로 띄운다 — 보면서 작성하라고(2026-10-16 사용자 요청).
 *
 * 견본 탭을 누르면 작성 중인 시트는 그대로 두고, 그 위에 견본만 담은 창이 뜬다. 머리를 끌어 옮기고
 * 오른쪽 아래 모서리를 끌어 크기를 바꾼다. 견본은 보기만 한다 — 고치려면 [이 시트로 가기].
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRightToLine, BookOpen, X } from "lucide-react";
import FormSheetView from "./FormSheetView";
import type { FormCellValues, FormSheet } from "./types";

/** 견본(채워 둔 예시) 시트인가 — 이름에 견본·샘플·sample. "양식"은 빈 서식 자체라 아니다. */
export function isSampleSheet(sheet: FormSheet): boolean {
  if (sheet.custom) return false;
  return /견본|샘플|sample/i.test(sheet.name);
}

export default function SamplePeek({
  sheet,
  values,
  onClose,
  onGoTo,
}: {
  sheet: FormSheet;
  values?: FormCellValues;
  onClose: () => void;
  /** 견본 시트로 옮겨 가 직접 본다(고친다) */
  onGoTo: () => void;
}) {
  // 처음 자리: 화면 오른쪽 위. 작성 중인 표의 왼쪽(머리글 쪽)을 가리지 않게.
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, window.innerWidth - 640 - 24),
    y: 96,
  }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({
      x: Math.min(Math.max(0, event.clientX - drag.current.dx), window.innerWidth - 120),
      y: Math.min(Math.max(0, event.clientY - drag.current.dy), window.innerHeight - 48),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      role="dialog"
      aria-label={`견본 보기: ${sheet.name}`}
      style={{ left: pos.x, top: pos.y, width: 640, height: "72vh", minWidth: 320, minHeight: 200, maxWidth: "96vw", maxHeight: "92vh" }}
      className="fixed z-30 flex resize flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-300"
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-move select-none items-center gap-2 border-b border-slate-200 bg-amber-50 px-3 py-2"
        title="끌어서 옮깁니다. 오른쪽 아래 모서리를 끌면 크기가 바뀝니다."
      >
        <BookOpen size={15} className="shrink-0 text-amber-700" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
          {/견본/.test(sheet.name) ? sheet.name : `견본 · ${sheet.name}`}
          <span className="ml-2 text-xs font-normal text-slate-500">보면서 작성하세요</span>
        </span>
        <button
          type="button"
          onClick={onGoTo}
          title="견본 시트로 옮겨 가서 봅니다"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-white"
        >
          <ArrowRightToLine size={12} /> 이 시트로 가기
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="견본 창 닫기"
          className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-white"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <FormSheetView sheet={sheet} editable={false} values={values} scale="fit" />
      </div>
    </div>
  );
}
