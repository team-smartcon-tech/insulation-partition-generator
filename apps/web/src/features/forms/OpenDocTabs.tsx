/**
 * 열어 둔 서류 탭 — 아크로뱃의 파일 탭과 같은 모양(사용자 요청, 사진으로 받음).
 *
 * 왜 필요한가: 서류 하나를 열면 목록이 가려진다. 다른 서류를 보려면 목록으로 돌아갔다가 다시
 * 찾아 들어가야 한다. 현장에서는 **여러 장을 번갈아 보며** 적는 일이 많다(총괄표 보며 일지 쓰기).
 * 연 것을 탭으로 남겨 두면 한 번에 오간다.
 *
 * 탭은 **이 브라우저에만** 기억한다(localStorage). 서버에 올릴 것이 아니다 — 사람마다 다르다.
 */
import { X } from "lucide-react";

import type { OpenDoc } from "./openDocList";

export { addOpenDoc, closeOpenDoc, MAX_OPEN_DOCS, type OpenDoc } from "./openDocList";

export default function OpenDocTabs({
  docs,
  activeId,
  onOpen,
  onClose,
}: {
  docs: OpenDoc[];
  /** 지금 보고 있는 서류 */
  activeId: string | null;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (docs.length === 0) return null;

  return (
    <div
      className="mb-4 flex items-stretch gap-1 overflow-x-auto rounded-xl bg-white/70 p-1 ring-1 ring-slate-200/80"
      aria-label="열어 둔 서류"
    >
      {docs.map((doc) => {
        const active = doc.id === activeId;
        return (
          <div
            key={doc.id}
            className={
              "group/tab flex min-w-0 shrink-0 items-center gap-1 rounded-lg pl-3 pr-1.5 transition " +
              (active ? "bg-[#eaf2fd] ring-1 ring-[#cfe2fa]" : "hover:bg-slate-100")
            }
          >
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              title={doc.title}
              className={
                "max-w-[15rem] truncate py-1.5 text-[12.5px] transition " +
                (active ? "font-semibold text-[#0a63b8]" : "text-slate-600 hover:text-slate-900")
              }
            >
              {doc.title}
            </button>
            <button
              type="button"
              onClick={() => onClose(doc.id)}
              title="이 탭 닫기"
              aria-label={`${doc.title} 탭 닫기`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover/tab:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
