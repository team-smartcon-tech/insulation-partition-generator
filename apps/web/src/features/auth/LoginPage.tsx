/**
 * 로그인 화면 — DCR 로그인(이메일 + 비밀번호, SSX 동일).
 * 성공 시 홈("/")으로 이동. 이미 로그인 상태면 홈으로 리다이렉트.
 * 디자인: 우미 브랜드(네이비) + 앰비언트 그라데이션 + 글래스 카드 (홈 허브와 통일).
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthContext";
import { AuthError } from "./authApi";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logoSrc, setLogoSrc] = useState("/woomi_short.png");

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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f7fb] px-4">
      {/* ── 앰비언트 그라데이션 배경 ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,#1478d6_0%,transparent_68%)] opacity-[0.18] blur-[90px]" />
        <div className="absolute -bottom-40 -right-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,#22c1ff_0%,transparent_68%)] opacity-[0.14] blur-[90px]" />
        <div className="absolute left-1/2 top-1/2 h-[640px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,#004791_0%,transparent_70%)] opacity-[0.05] blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* 브랜드 로고 + 워드마크 */}
        <div className="mb-6 flex items-center justify-center gap-3.5">
          <img
            src={logoSrc}
            alt="우미"
            className="h-9 w-auto select-none object-contain"
            draggable={false}
            onError={() =>
              setLogoSrc((p) => (p === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png"))
            }
          />
          <div className="h-7 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent" />
          <div className="flex flex-col leading-none">
            <div
              className="flex items-baseline gap-0.5"
              style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
            >
              <span className="text-[22px] tracking-tight text-slate-900">
                Auto<span className="text-[#0a63b8]">Con</span>
              </span>
              <span className="text-[23px] leading-none text-[#1478d6]">.</span>
            </div>
            <span className="mt-[3px] text-[8.5px] font-bold uppercase tracking-[0.26em] text-slate-400">
              Construction Automation
            </span>
          </div>
        </div>

        {/* 글래스 카드 */}
        <form
          onSubmit={onSubmit}
          className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_24px_48px_-16px_rgba(16,24,40,0.22)] backdrop-blur-xl"
        >
          {/* 상단 액센트 바 */}
          <div className="h-1 bg-gradient-to-r from-[#22c1ff] via-[#0a63b8] to-[#003a78]" />

          <div className="p-8">
            <div className="mb-7">
              <div className="flex items-center gap-2.5">
                <span className="h-px w-7 bg-gradient-to-r from-[#1478d6] to-transparent" />
                <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#0a63b8]">
                  Welcome
                </span>
              </div>
              <h1 className="mt-2.5 text-[22px] font-extrabold tracking-tight text-slate-900">
                로그인
              </h1>
            </div>

            <div className="space-y-4">
              {/* 이메일 */}
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-600">이메일</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                  <input
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white/70 pl-10 pr-3 text-[14px] text-slate-800 outline-none transition-all placeholder:text-slate-300 focus:border-[#0a63b8] focus:bg-white focus:ring-2 focus:ring-[#0a63b8]/20"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    placeholder="name@company.com"
                    autoFocus
                  />
                </div>
              </div>

              {/* 비밀번호 */}
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-600">비밀번호</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                  <input
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white/70 pl-10 pr-10 text-[14px] text-slate-800 outline-none transition-all placeholder:text-slate-300 focus:border-[#0a63b8] focus:bg-white focus:ring-2 focus:ring-[#0a63b8]/20"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    title={showPw ? "비밀번호 숨기기" : "비밀번호 표시"}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
                  </button>
                </div>
              </div>
            </div>

            {/* 로그인 버튼 */}
            <Button
              type="submit"
              disabled={submitting}
              className="group mt-7 h-11 w-full gap-2 rounded-lg bg-gradient-to-r from-[#0a63b8] to-[#003a78] text-[14px] font-semibold shadow-[0_10px_24px_-8px_rgba(0,71,145,0.55)] transition-all hover:from-[#0a63b8] hover:to-[#00274d] hover:shadow-[0_14px_28px_-8px_rgba(0,71,145,0.6)]"
            >
              {submitting ? (
                "로그인 중…"
              ) : (
                <>
                  로그인
                  <ArrowRight className="h-4 w-4 -translate-x-1 opacity-70 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </>
              )}
            </Button>

            <p className="mt-5 text-center text-[11.5px] leading-relaxed text-slate-400">
              계정 문의는 관리자에게 하세요.
            </p>
          </div>
        </form>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          © 우미건설 · 오토콘 (AutoCon)
        </p>
      </div>
    </div>
  );
}
