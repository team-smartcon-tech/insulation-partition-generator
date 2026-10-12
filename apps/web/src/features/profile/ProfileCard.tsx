/**
 * 내 정보 카드 — 헤더 오른쪽 이름을 누르면 뜬다. 결재 서명을 여기서 등록한다.
 *
 * 사내 Smart Works 의 프로필 카드와 같은 모양이다(사용자가 보내 준 화면). 그 카드의 사진 바꾸기·
 * 멤버 관리·비밀번호 변경은 **넣지 않았다** — 이 앱에 그 기능이 없어, 눌러도 아무 일이 없으면
 * 고장 난 것처럼 보인다. 있는 것(이메일·역할·서명·로그아웃)만 둔다.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { IdCard, LogOut, Mail, PenLine, ShieldCheck, Trash2, X } from "lucide-react";
import type { AuthUser } from "@/features/auth/authApi";
import SignatureDialog, { useSignature } from "./SignatureDialog";
import { writeSignature } from "./signature";

export default function ProfileCard({
  user,
  roleLabel,
  onClose,
  onLogout,
}: {
  user: AuthUser;
  roleLabel?: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const signature = useSignature(user.id);
  const [drawing, setDrawing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function save(dataUrl: string) {
    if (!writeSignature(user.id, dataUrl)) {
      setMessage("이 브라우저에서는 서명을 저장할 수 없습니다(사이트 데이터 차단).");
      return;
    }
    setDrawing(false);
    setMessage(null);
  }

  // 헤더(흐림 효과가 걸린 상자) 안에서 그리면 화면 전체가 아니라 헤더 안에 갇힌다 — 문서 맨 끝에 붙인다.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="내 정보">
      {/* 바깥을 누르면 닫는다 */}
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default" />

      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="h-24 bg-[linear-gradient(120deg,#00224a,#0a5aa8_60%,#1478d6)]" />
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="-mt-12 flex flex-col items-center px-6">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#2a8fe6] via-[#0a63b8] to-[#003a78] text-3xl font-bold text-white ring-4 ring-white">
            {user.name.trim().charAt(0) || "?"}
          </div>
          <p className="mt-3 text-lg font-bold text-slate-900">{user.name}</p>
          {roleLabel && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              <ShieldCheck size={12} /> {roleLabel}
            </span>
          )}
        </div>

        <dl className="mt-5 space-y-3 px-6 text-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Mail size={16} />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] text-slate-400">이메일</dt>
              <dd className="truncate text-slate-800">{user.email}</dd>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <IdCard size={16} />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] text-slate-400">사용자 ID</dt>
              <dd className="truncate text-xs text-slate-700">{user.id}</dd>
            </div>
          </div>
        </dl>

        {/* 결재 서명 */}
        <section className="mx-6 mt-5 rounded-xl border border-dashed border-slate-300 p-3">
          <div className="flex items-center gap-1.5">
            <PenLine size={14} className="text-slate-500" aria-hidden />
            <h3 className="flex-1 text-xs font-semibold text-slate-700">결재 서명</h3>
            {signature && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("등록한 서명을 지웁니다. 이미 결재한 서류의 서명은 그대로 남습니다.")) {
                    writeSignature(user.id, null);
                  }
                }}
                className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] text-slate-400 hover:text-rose-600"
              >
                <Trash2 size={11} /> 지우기
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawing(true)}
              className="rounded px-1 text-xs font-medium text-blue-600 hover:underline"
            >
              {signature ? "다시 등록" : "등록하기"}
            </button>
          </div>
          <div className="mt-2 flex h-20 items-center justify-center rounded-lg bg-slate-50">
            {signature ? (
              <img src={signature} alt={`${user.name} 결재 서명`} className="max-h-16 max-w-[80%] object-contain" />
            ) : (
              <span className="text-xs text-slate-400">서명이 등록되지 않았습니다</span>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">지금은 이 PC 의 이 브라우저에만 저장됩니다.</p>
          {message && <p className="mt-1 text-[11px] text-rose-600">{message}</p>}
        </section>

        <div className="px-6 pb-6 pt-5">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
          >
            <LogOut size={15} /> 로그아웃
          </button>
        </div>
      </div>

      {drawing && <SignatureDialog onCancel={() => setDrawing(false)} onSave={save} />}
    </div>,
    document.body,
  );
}
