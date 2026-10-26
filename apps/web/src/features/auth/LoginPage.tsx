/**
 * 로그인 화면 — DCR 로그인(이메일 + 비밀번호, SSX 동일).
 * 성공 시 홈("/")으로 이동. 이미 로그인 상태면 홈으로 리다이렉트.
 *
 * 디자인: 좌측은 홈 본문과 같은 밝은 바탕의 로그인 폼, 우측은 차분한 네이비 패널에
 * 공구함 심볼(ToolboxMark)을 선으로만 그린 큰 드로잉 하나. lg 미만에서는 폼만 보인다.
 * 도구 목록은 로그인 전이라 서버에서 못 받으므로 글로 고정해 둔다(게시 도구가 바뀌면 손으로 맞춘다).
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Mail, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandWordmark from "@/components/brand/BrandWordmark";
import { useAuth } from "./AuthContext";
import { AuthError } from "./authApi";

const INPUT_CLS =
  "h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 text-[14px] text-slate-800 outline-none transition-colors " +
  "placeholder:text-slate-300 focus:border-[#0a63b8] focus:ring-[3px] focus:ring-[#0a63b8]/20";

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

  const woomiLogo = (cls: string) => (
    <img
      src={logoSrc}
      alt="우미"
      className={cls}
      draggable={false}
      onError={() =>
        setLogoSrc((p) => (p === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png"))
      }
    />
  );

  return (
    <div className="min-h-screen bg-[#f5f7fb] lg:grid lg:grid-cols-[500px_minmax(0,1fr)] xl:grid-cols-[540px_minmax(0,1fr)]">
      {/* ── 좌: 로그인 폼 ── */}
      <section className="flex min-h-screen flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-[380px]">
          <div className="flex items-center gap-3.5">
            {/* 좁은 화면에서는 워드마크가 줄바꿈되지 않도록 우미 로고는 숨긴다 */}
            {woomiLogo("hidden h-8 w-auto select-none object-contain sm:block")}
            <div className="hidden h-7 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent sm:block" />
            <BrandWordmark className="whitespace-nowrap" />
          </div>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-slate-900">로그인</h2>
          <p className="mt-1.5 text-[13.5px] text-slate-500 [word-break:keep-all]">
            Smart Works 와 같은 회사 계정(이메일·비밀번호)으로 들어갑니다.
          </p>

          <div className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-email" className="mb-2 block text-[13px] font-semibold text-slate-600">
                이메일
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                <input
                  id="login-email"
                  className={`${INPUT_CLS} pr-3`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="name@wm.co.kr"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="mb-2 block text-[13px] font-semibold text-slate-600">
                비밀번호
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  className={`${INPUT_CLS} pr-11`}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="비밀번호 입력"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={showPw}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a63b8]/40"
                >
                  {showPw ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
                </button>
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="mt-8 h-11 w-full gap-2 rounded-lg bg-[#0a63b8] text-[15px] font-bold text-white shadow-[0_10px_24px_-10px_rgba(10,99,184,0.7)] transition-colors hover:bg-[#004791] disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? "로그인 중…" : "로그인"}
          </Button>

          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-slate-400">
            계정이 없거나 비밀번호를 잊었으면 스마트기술팀에 문의하세요.
          </p>
        </form>
      </section>
      {/* ── 우: 소개 패널 (데스크톱 전용) — 공구함 심볼 선 드로잉 하나만 둔다 ── */}
      <section className="relative hidden overflow-hidden bg-[#0B2447] text-white lg:flex lg:flex-col lg:justify-center lg:px-16 lg:py-24 xl:px-24">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1478d6]/25 blur-[170px]"
        />

        <div className="relative mx-auto grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)_240px] items-center gap-16 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h1 className="text-[34px] font-extrabold leading-[1.28] tracking-[-0.02em] [word-break:keep-all] 2xl:text-[40px]">
              시공 도구는 꺼내 쓰고,
              <br />
              만든 도구는 나눠 쓰세요
            </h1>
            <p className="mt-5 max-w-[460px] text-[15.5px] leading-relaxed text-white/60 [word-break:keep-all]">
              현장에서 바로 쓰는 시공 자동화 앱·도구를 한곳에서 찾고, 직접 만든 도구는 올려서 다른
              현장과 함께 씁니다.
            </p>
            <dl className="mt-10 grid grid-cols-[auto_1fr] gap-x-7 gap-y-2.5 text-[14px] leading-6 [word-break:keep-all]">
              <dt className="font-semibold text-white/75">시공 도구</dt>
              <dd className="text-white/50">단열 Layout, 타일 Layout, TC Planner, TC/HOIST 발주의뢰서, 스마트폼</dd>
              <dt className="font-semibold text-white/75">CAD 도구</dt>
              <dd className="text-white/50">Smart CAD Manager — AutoCAD·GstarCAD 플러그인과 리습</dd>
            </dl>
          </div>
          <ToolboxOutline className="w-full" />
        </div>

        <div className="absolute left-16 top-10 xl:left-24">
          {woomiLogo("h-7 w-auto select-none object-contain brightness-0 invert opacity-80")}
        </div>
        <p className="absolute bottom-10 left-16 text-[13px] text-white/40 xl:left-24">
          우미건설 스마트기술팀
        </p>
      </section>
    </div>
  );
}

/**
 * 공구함 심볼을 선으로만 그린 큰 드로잉 — ToolboxMark(BrandWordmark.tsx)와 같은 좌표계(48×48).
 * 심볼 도형을 고치면 여기도 같이 맞춘다.
 */
function ToolboxOutline({ className = "" }: { className?: string }) {
  const stroke = "rgba(255,255,255,0.55)";
  const faint = "rgba(255,255,255,0.22)";
  return (
    <svg viewBox="-4 -4 56 56" className={className} aria-hidden fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* 타일 윤곽 */}
      <rect x="0" y="0" width="48" height="48" rx="12" stroke={faint} strokeWidth="0.35" />
      {/* 자 */}
      <g transform="rotate(16 31 20)" stroke={stroke} strokeWidth="0.45">
        <rect x="27.6" y="6.5" width="6.8" height="20" rx="1.6" />
        <path d="M27.6 10.5h3M27.6 13.8h2M27.6 17.1h3M27.6 20.4h2" strokeWidth="0.35" />
      </g>
      {/* 렌치 */}
      <g transform="rotate(-20 18 22)" stroke={stroke} strokeWidth="0.45">
        <rect x="15.8" y="10" width="4.4" height="17" rx="2.2" />
        <path d="M13.2 7.2a5.4 5.4 0 1 0 9.6 0M16 2.6v7M20 2.6v7" />
      </g>
      {/* 공구함 */}
      <g stroke={stroke} strokeWidth="0.5">
        <path d="M9.6 26h28.8l-1.7 9.9a3 3 0 0 1-3 2.5H14.3a3 3 0 0 1-3-2.5z" />
        <rect x="8" y="23.2" width="32" height="4.4" rx="2.2" />
        <rect x="20.2" y="30.4" width="7.6" height="2.8" rx="1.4" />
      </g>
    </svg>
  );
}
