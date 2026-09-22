/**
 * 첨부 서류(한글 등) 화면 — **화면에서 채울 수 없는 파일**을 여는 자리.
 *
 * 한글(.hwp) 서식은 엑셀처럼 격자로 그려 칸을 채울 수 없다. 그래서 이 화면은 파일 자체를
 * 주고받는 일만 한다: 배포 양식함에서는 [내려받기]와 [현장에 만들기], 현장 서류함에서는
 * 내려받아 한글로 작성한 뒤 [작성한 파일 올리기]로 같은 자리에 다시 넣는다.
 */
import { ArrowRight, Download, FileText, Lock, Upload } from "lucide-react";
import { fileSizeText } from "./library";

export default function AttachmentPanel({
  fileName,
  fileSize,
  updatedAt,
  readOnly,
  siteName,
  replaced,
  onDownload,
  onWrite,
  onReplace,
}: {
  fileName: string;
  fileSize?: number;
  /** 마지막으로 파일이 바뀐 시각 */
  updatedAt: number;
  /** 배포 원본인가(현장 서류면 false) */
  readOnly: boolean;
  /** 배포 원본일 때, 사본을 만들 현장 이름 */
  siteName?: string;
  /** 현장 서류일 때, 작성한 파일로 한 번이라도 바꿨나 */
  replaced: boolean;
  onDownload: () => void;
  onWrite?: () => void;
  onReplace?: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800">
          <Lock size={14} /> 한글 서식
        </span>
        <span className="text-xs text-amber-800">
          한글 파일은 화면에서 칸을 채울 수 없습니다. 내려받아 한글에서 작성하세요.
          {readOnly ? "" : " 작성한 파일은 아래 [작성한 파일 올리기]로 이 자리에 다시 넣습니다."}
        </span>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <FileText size={34} className="text-slate-400" aria-hidden />
        <p className="max-w-full break-all text-sm font-semibold text-slate-800">{fileName}</p>
        <p className="text-xs text-slate-500">
          {[fileSizeText(fileSize), `${new Date(updatedAt).toLocaleDateString("ko-KR")} 기준`]
            .filter(Boolean)
            .join(" · ")}
          {replaced ? " · 작성한 파일이 올라와 있습니다" : ""}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <Download size={14} aria-hidden /> 내려받기
          </button>
          {readOnly && onWrite && (
            <button
              type="button"
              onClick={onWrite}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-blue-700 ring-1 ring-blue-300 transition hover:bg-blue-50"
            >
              {siteName ? `${siteName}에 만들기` : "현장에 만들기"} <ArrowRight size={13} aria-hidden />
            </button>
          )}
          {!readOnly && onReplace && (
            <button
              type="button"
              onClick={onReplace}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
            >
              <Upload size={14} aria-hidden /> 작성한 파일 올리기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
