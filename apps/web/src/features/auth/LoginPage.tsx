/**
 * 로그인 화면 — DCR 로그인(이메일 + 비밀번호, SSX 동일).
 * 성공 시 홈("/")으로 이동. 이미 로그인 상태면 홈으로 리다이렉트.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthContext";
import { AuthError } from "./authApi";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) setLocation("/", { replace: true });
  }, [isLoading, user, setLocation]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("이메일·비밀번호를 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      toast.success("로그인되었습니다.");
      setLocation("/", { replace: true });
    } catch (err) {
      const msg =
        err instanceof AuthError
          ? err.status === 429
            ? "시도가 너무 많습니다. 잠시 후 다시 시도하세요."
            : err.message
          : "로그인 실패";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#004791] focus:ring-1 focus:ring-[#004791]/30";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <div className="mb-6 text-center">
          <h1 className="text-lg font-bold text-slate-800">단열재 나누기도 생성기</h1>
          <p className="mt-1 text-xs text-slate-400">DCR 계정으로 로그인 (이메일 · 비밀번호)</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">이메일</label>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">비밀번호</label>
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </div>
        <Button type="submit" disabled={submitting} className="mt-6 w-full bg-[#004791] hover:bg-[#003a78]">
          {submitting ? "로그인 중…" : "로그인"}
        </Button>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
          DCR 회원 계정으로 로그인합니다. 계정 문의는 관리자에게 하세요.
        </p>
      </form>
    </div>
  );
}
