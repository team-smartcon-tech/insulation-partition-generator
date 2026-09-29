/**
 * 파일 올리기 창 — **끌어다 놓기가 먼저다.**
 *
 * 전에는 [올리기]를 누르면 곧바로 윈도우 파일 선택창이 떴다. 올릴 파일은 대개 탐색기나 메일
 * 첨부에 이미 열려 있어서, 선택창이 뜨면 그 폴더를 처음부터 다시 찾아 들어가야 한다(사용자 요청:
 * "올리기 누르면 드래그&드롭으로, 무조건 선택창 나오지 않게").
 *
 * 그래서 누르면 이 창이 뜨고, 여기에 파일을 끌어다 놓으면 된다. 선택창은 **사용자가 [파일에서
 * 고르기]를 누를 때만** 뜬다.
 */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, Upload, X } from "lucide-react";
import { BIG_FILE_BYTES, fileSizeText, isUploadableFile } from "./library";

export default function DropUploadDialog({
  title,
  hint,
  busy,
  onPick,
  onFiles,
  onCancel,
}: {
  /** 어디에 올리는지 — `품질관련 105 문서 및 기록 목록표` 또는 `배포 양식 올리기` */
  title: string;
  /** 그 자리에 올리면 어떻게 되는지 한 줄 */
  hint: string;
  busy: boolean;
  /** [파일에서 고르기] — 이때만 윈도우 선택창을 연다 */
  onPick: () => void;
  onFiles: (files: File[]) => void;
  onCancel: () => void;
}) {
  /** 파일을 창 위로 끌고 왔나(테두리를 진하게 해서 놓아도 된다는 것을 보인다) */
  const [over, setOver] = useState(false);
  /**
   * 안쪽 요소를 지날 때마다 dragleave 가 와서, 세지 않으면 테두리가 깜빡인다.
   * 들어온 횟수를 세어 0 이 될 때만 끈다.
   */
  const depth = useRef(0);

  // 창이 떠 있는 동안 Esc 로 닫는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const take = (list: FileList | null) => {
    const all = Array.from(list ?? []);
    const files = all.filter((file) => isUploadableFile(file.name));
    if (files.length === 0) return 0;

    /*
     * 큰 파일은 한 번 묻는다. 지금 자료는 **이 브라우저 안에만** 있어서, 40MB 짜리 보고서를
     * 몇 개만 넣어도 저장소가 차고 다른 사람 PC 에서는 보이지도 않는다.
     */
    const big = files.filter((file) => file.size > BIG_FILE_BYTES);
    if (
      big.length > 0 &&
      !window.confirm(
        [
          `큰 파일이 ${big.length}개 있습니다(${big.map((file) => fileSizeText(file.size)).join(", ")}).`,
          "",
          "지금은 올린 파일이 이 브라우저에만 저장됩니다. 다른 사람 PC 에서는 보이지 않고, 저장 공간도 넉넉하지 않습니다.",
          "그래도 올릴까요?",
        ].join("\n"),
      )
    ) {
      return 0;
    }
    onFiles(files);
    return files.length;
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drop-upload-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-200 px-6 py-4">
          <Upload size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="drop-upload-title" className="truncate text-lg font-bold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              depth.current += 1;
              setOver(true);
            }}
            onDragOver={(event) => {
              // 막지 않으면 브라우저가 파일을 열어 버려(페이지가 엑셀로 바뀐다) 놓을 수 없다.
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={() => {
              depth.current = Math.max(0, depth.current - 1);
              if (depth.current === 0) setOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              depth.current = 0;
              setOver(false);
              take(event.dataTransfer.files);
            }}
            className={
              "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition " +
              (over ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50")
            }
          >
            <Upload size={28} className={over ? "text-blue-600" : "text-slate-400"} aria-hidden />
            <p className="text-sm font-semibold text-slate-700">
              {busy ? "읽는 중입니다…" : "여기에 파일을 끌어다 놓으세요"}
            </p>
            <p className="text-xs text-slate-500">
              여러 개를 한 번에 놓아도 됩니다 · 엑셀은 화면에서 바로 작성 · 그 밖의 파일(한글·PDF·도면·사진·PPT)은
              보관하고 주고받습니다
            </p>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onPick}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50"
            >
              <FolderOpen size={14} aria-hidden /> 파일에서 고르기
            </button>
            <span className="text-[11px] text-slate-400">끌어다 놓기가 어려울 때만 쓰세요</span>
            <button
              type="button"
              onClick={onCancel}
              className="ml-auto rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
