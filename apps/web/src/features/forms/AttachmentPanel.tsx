/**
 * 첨부 서류 화면 — **화면에서 채울 수 없는 파일**을 여는 자리.
 *
 * 현장 서류함은 현장 공유폴더를 대신하는 자리라 한글 서식·도면·사진·보고서(PPT)·압축이 섞여
 * 들어온다. 엑셀이 아닌 것은 격자로 그릴 수 없으니 이 화면은 **파일 자체를 주고받는 일**만 한다:
 * 배포 양식함에서는 [내려받기]와 [현장에 만들기], 현장 서류함에서는 내려받아 원래 프로그램으로
 * 작성한 뒤 [작성한 파일 올리기]로 같은 자리에 다시 넣는다.
 *
 * 사진과 PDF 는 **그 자리에서 바로 보여 준다** — 본사에서 점검할 때 내려받지 않고 확인할 수 있어야
 * 폴더를 대신한다고 할 수 있다.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Download, FileText, Lock, Upload } from "lucide-react";
import { fileKind, fileSizeText } from "./library";

export default function AttachmentPanel({
  fileName,
  fileSize,
  updatedAt,
  readOnly,
  siteName,
  replaced,
  bytes,
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
  /** 화면에서 바로 보여 줄 수 있는 파일(사진·PDF)의 원본 바이트 */
  bytes?: ArrayBuffer;
  onDownload: () => void;
  onWrite?: () => void;
  onReplace?: () => void;
}) {
  const kind = fileKind(fileName);

  /*
   * 미리 보기는 blob 주소로 띄운다. 다 보고 나면 반드시 되돌려 놓아야(revoke) 브라우저가
   * 그 바이트를 계속 붙들고 있지 않는다 — 40MB 짜리 여러 장이면 금방 무거워진다.
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!kind.preview || !bytes || bytes.byteLength === 0) {
      setPreviewUrl(null);
      return;
    }
    const type = kind.preview === "pdf" ? "application/pdf" : `image/${fileName.split(".").pop()?.toLowerCase()}`;
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes, fileName, kind.preview]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800">
          <Lock size={14} /> {kind.label} 파일
        </span>
        <span className="text-xs text-amber-800">
          {kind.fillable
            ? `화면에서 칸을 채울 수 없습니다. 내려받아 ${kind.label}에서 작성하세요.`
            : "화면에서 고칠 수 없는 자료입니다. 그대로 보관하고 주고받습니다."}
          {readOnly ? "" : " 작성한 파일은 아래 [작성한 파일 올리기]로 이 자리에 다시 넣습니다."}
        </span>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
        {previewUrl ? (
          kind.preview === "image" ? (
            <img src={previewUrl} alt={fileName} className="max-h-[70vh] max-w-full rounded-lg ring-1 ring-slate-200" />
          ) : (
            <object data={previewUrl} type="application/pdf" className="h-[70vh] w-full rounded-lg ring-1 ring-slate-200">
              <p className="p-4 text-sm text-slate-500">이 브라우저에서는 PDF 를 바로 볼 수 없습니다. 내려받아 확인하세요.</p>
            </object>
          )
        ) : (
          <FileText size={34} className="text-slate-400" aria-hidden />
        )}

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
