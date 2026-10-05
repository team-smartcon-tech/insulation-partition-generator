/**
 * 로그인 화면 — DCR 로그인(이메일 + 비밀번호, SSX 동일).
 * 성공 시 홈("/")으로 이동. 이미 로그인 상태면 홈으로 리다이렉트.
 *
 * 모양은 **사내 Smart Works 로그인 화면과 같은 틀**이다(사용자 요청, 사진으로 받음) —
 * 어두운 남색 바탕에 카드 하나, 왼쪽은 브랜드(우미 로고 · 이름 · 부제 · 한 줄 소개),
 * 오른쪽은 로그인. 직원이 매일 보는 화면과 같아야 "다른 회사 프로그램" 처럼 보이지 않는다.
 *
 * 좁은 화면(휴대폰)에서는 왼쪽 브랜드 칸을 위로 올려 쌓고, 한 줄 소개는 숨긴다.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "./AuthContext";
import { AuthError } from "./authApi";

/** 적어 둔 이메일을 다음에도 띄워 준다(이 브라우저에만 남는다). */
const SAVED_EMAIL_KEY = "ipg-auth:saved-email";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logoSrc, setLogoSrc] = useState("/woomi_logo.png");

  useEffect(() => {
    if (!isLoading && user) setLocation("/", { replace: true });
  }, [isLoading, user, setLocation]);

  // 지난번에 "아이디 저장"을 켜 두었으면 그 이메일로 시작한다.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_EMAIL_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      // 저장이 막힌 브라우저 — 빈 칸으로 시작한다.
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("이메일·비밀번호를 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      try {
        if (remember) localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
        else localStorage.removeItem(SAVED_EMAIL_KEY);
      } catch {
        // 저장이 막혀 있어도 로그인은 됐다.
      }
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
    <div className="flex min-h-screen items-center justify-center bg-[#0a1322] px-4 py-10">
      {/* 바탕에 아주 옅은 빛 — 평평한 남색만 깔면 화면이 죽어 보인다 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#1478d6_0%,transparent_70%)] opacity-[0.12] blur-[90px]" />
        <div className="absolute -bottom-40 right-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#0a63b8_0%,transparent_70%)] opacity-[0.12] blur-[90px]" />
      </div>

      <div className="relative grid w-full max-w-[1100px] overflow-hidden rounded-[18px] shadow-[0_40px_80px_-24px_rgba(0,0,0,0.65)] md:grid-cols-2">
        {/* ── 왼쪽: 브랜드 ── */}
        <div className="flex flex-col items-center justify-center bg-gradient-to-br from-[#1b5390] via-[#17457c] to-[#123a6c] px-10 py-12 text-center md:py-20">
          {/* 로고는 남색 바탕에 얹히므로 흰색으로 뒤집는다(흰색 파일을 따로 두지 않아도 된다). */}
          <img
            src={logoSrc}
            alt="우미"
            draggable={false}
            onError={() => setLogoSrc((prev) => (prev === "/woomi_logo.png" ? "/woomi_short.png" : "/woomi_browser_logo.png"))}
            className="h-11 w-auto select-none object-contain brightness-0 invert"
          />

          <p className="mt-7 flex items-baseline text-[34px] leading-none tracking-[-0.02em] text-white md:text-[38px]">
            <span className="font-bold text-[#f5821f]">S</span>
            <span className="font-medium">mart</span>
            <span className="ml-2 font-black" style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}>
              FORMS
            </span>
            <span className="font-black text-[#f5821f]">.</span>
          </p>

          <p className="mt-4 text-[15px] font-medium text-[#b7cde8]">건설 공무관리 시스템</p>

          <span className="my-8 h-px w-[62%] bg-white/20" />

          <p className="hidden max-w-[22rem] text-[13px] leading-relaxed text-[#9bb6d6] md:block">
            현장 서류를 한곳에, 작성부터 결재와 본사 점검까지
          </p>
        </div>

        {/* ── 오른쪽: 로그인 ── */}
        <form onSubmit={onSubmit} className="bg-[#111d2f] px-8 py-12 md:px-12 md:py-20">
          <h1 className="text-[26px] font-bold tracking-tight text-white">로그인</h1>
          <p className="mt-2 text-[13px] text-[#8fa3bd]">회사 계정으로 접속합니다</p>

          <div className="mt-8 space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-[12.5px] font-medium text-[#9db2cc]">
                이메일
              </label>
              <input
                id="login-email"
                className="h-11 w-full rounded-lg border border-transparent bg-[#e8eef7] px-3.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#1478d6] focus:ring-2 focus:ring-[#1478d6]/30"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="name@wm.co.kr"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="login-pw" className="mb-1.5 block text-[12.5px] font-medium text-[#9db2cc]">
                비밀번호
              </label>
              <div className="relative">
                <input
                  id="login-pw"
                  className="h-11 w-full rounded-lg border border-transparent bg-[#e8eef7] pl-3.5 pr-10 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#1478d6] focus:ring-2 focus:ring-[#1478d6]/30"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((on) => !on)}
                  title={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700"
                >
                  {showPw ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[#9db2cc]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-[15px] w-[15px] cursor-pointer accent-[#1478d6]"
              />
              아이디 저장
            </label>
            <button
              type="button"
              onClick={() =>
                toast.info("비밀번호는 사내 Smart Works 계정과 같습니다. 관리자에게 문의하세요.")
              }
              className="text-[12.5px] text-[#8fa3bd] underline-offset-2 transition hover:text-white hover:underline"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="group mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1668c7] text-[14.5px] font-semibold text-white shadow-[0_12px_26px_-10px_rgba(22,104,199,0.9)] transition hover:bg-[#1573dd] disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {submitting ? (
              "로그인 중…"
            ) : (
              <>
                <LogIn className="h-[17px] w-[17px]" />
                로그인
                <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-80" />
              </>
            )}
          </button>

          <p className="mt-7 text-center text-[12.5px] text-[#8fa3bd]">
            계정이 없으신가요?{" "}
            <button
              type="button"
              onClick={() => toast.info("사내 Smart Works 계정으로 들어옵니다. 계정 신청은 관리자에게 하세요.")}
              className="font-semibold text-[#5ea2ea] underline-offset-2 transition hover:underline"
            >
              계정 문의
            </button>
          </p>
          <p className="mt-2 text-center text-[11.5px] leading-relaxed text-[#64799a]">
            사내 Smart Works 계정으로 로그인합니다
          </p>
        </form>
      </div>
    </div>
  );
}
