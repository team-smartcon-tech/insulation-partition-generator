/**
 * 로그인 화면 — DCR 로그인(이메일 + 비밀번호, SSX 동일).
 * 성공 시 홈("/")으로 이동. 이미 로그인 상태면 홈으로 리다이렉트.
 *
 * 디자인: 전면 어두운 바탕(그라데이션 — `public/login-bg.jpg` 를 두면 현장 사진이 그 위에 깔린다) 위에
 * 왼쪽은 헤드라인 + 도구 4종 아이콘 줄, 오른쪽은 떠 있는 어두운 카드 폼. 한 화면에 들어오고 스크롤이 없다.
 * lg 미만에서는 카드만 보인다.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { User, Lock, Eye, EyeOff, LayoutGrid, Construction, FileText, Wrench } from "lucide-react";
import { ToolboxMark } from "@/components/brand/BrandWordmark";
import { useAuth } from "./AuthContext";
import { AuthError } from "./authApi";

/** 아이디 저장 — 브라우저 편의용(서버 공유·권한과 무관). 체크 해제 시 지운다 */
const SAVED_EMAIL_KEY = "ipg_saved_email";

const FEATURES = [
  { icon: LayoutGrid, l1: "단열·타일 Layout", l2: "나누기도·물량 산출" },
  { icon: Construction, l1: "TC Planner·TC/HOIST", l2: "배치 계획·발주의뢰서" },
  { icon: FileText, l1: "스마트폼", l2: "현장 서류·품질관리계획" },
  { icon: Wrench, l1: "Smart CAD Manager", l2: "CAD 플러그인·리습" },
];

const INPUT_CLS =
  "h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] pl-11 text-[14.5px] text-white outline-none transition-colors " +
  "placeholder:text-white/35 focus:border-[#8fd4ff]/70 focus:bg-white/[0.09] focus:ring-[3px] focus:ring-[#8fd4ff]/20";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(SAVED_EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saveId, setSaveId] = useState(() => !!email);
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
      try {
        if (saveId) localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
        else localStorage.removeItem(SAVED_EMAIL_KEY);
      } catch {
        /* 저장소 막힌 브라우저 — 편의 기능이라 무시 */
      }
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
      alt="우미건설"
      className={cls}
      draggable={false}
      onError={() =>
        setLogoSrc((p) => (p === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png"))
      }
    />
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d141d] text-white">
      {/* ── 배경 ──
          기본은 사진 없는 어두운 그라데이션. `public/login-bg.jpg` 를 두면(없으면 브라우저가 조용히 무시) 그 위에
          사진이 깔리고, 아래 오버레이가 글·카드 가독성을 지킨다. 사진은 자사 현장 촬영분만 쓴다. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 620px at 80% 18%, rgba(108,194,255,0.20) 0%, transparent 65%)," +
            "radial-gradient(760px 520px at 10% 88%, rgba(20,120,214,0.14) 0%, transparent 65%)," +
            "linear-gradient(160deg, #182331 0%, #111a26 50%, #0d141d 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center opacity-55"
        style={{ backgroundImage: "url(/login-bg.jpg)", filter: "brightness(0.45) saturate(0.5)" }}
      />
      {/* 사선 결 — 사진이 없을 때 바탕이 밋밋하지 않게, 있을 때는 거의 안 보인다 */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 96px)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(13,20,29,0.5) 0%, rgba(13,20,29,0.1) 50%, rgba(13,20,29,0.55) 100%)",
        }}
      />

      {/* ── 상단 브랜드 ── */}
      <header className="relative z-10 flex items-center gap-3 px-8 pt-8 lg:px-16">
        {woomiLogo("h-7 w-auto select-none object-contain brightness-0 invert")}
        <span className="h-5 w-px bg-white/30" />
        <span className="text-[14px] font-semibold tracking-tight text-white/85">스마트 툴박스</span>
      </header>

      {/* ── 본문: 좌 소개 / 우 카드 ── */}
      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1760px] items-center px-6 pb-10 lg:px-16">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,1fr)_440px] xl:gap-20">
          {/* 좌: 헤드라인 + 도구 4종 */}
          <section className="hidden lg:block">
            <h1 className="text-[42px] font-extrabold leading-[1.25] tracking-[-0.02em] [word-break:keep-all] xl:text-[48px]">
              현장에서 만든 도구가
              <br />
              다음 현장의 표준이 됩니다
            </h1>
            <p className="mt-5 text-[17px] text-white/75">현장 시공 자동화 도구 공유 플랫폼</p>
            <span className="mt-7 block h-[3px] w-14 rounded-full bg-[#8fd4ff]" />

            <ul className="mt-14 flex max-w-[760px] divide-x divide-white/15">
              {FEATURES.map(({ icon: Icon, l1, l2 }, i) => (
                <li key={l1} className={"flex-1 " + (i === 0 ? "pr-6" : "px-6")}>
                  <Icon className="h-7 w-7 text-[#8fd4ff]" strokeWidth={1.6} />
                  <p className="mt-4 text-[13.5px] font-semibold leading-snug text-white/90 [word-break:keep-all]">
                    {l1}
                    <br />
                    <span className="font-normal text-white/60">{l2}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* 우: 로그인 카드 */}
          <form
            onSubmit={onSubmit}
            className="mx-auto w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#141f2d]/90 px-8 py-10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:px-10"
          >
            {/* 카드 머리 — BrandWordmark 와 같은 표기 규칙(앞 단어 얇게, TOOL BOX 만 세움)의 흰색 판 */}
            <div className="flex items-center gap-3.5">
              <ToolboxMark className="h-12 w-12 shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]" />
              <div className="flex flex-col leading-none">
                <h2 className="flex items-baseline gap-[3px] whitespace-nowrap">
                  <span
                    className="mr-[4px] text-[22px] font-light tracking-[0.02em] text-white/60"
                    style={{ fontFamily: "'Archivo', 'SUIT Variable', sans-serif" }}
                  >
                    SMART
                  </span>
                  <span
                    className="text-[24px] tracking-[-0.045em] text-white"
                    style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
                  >
                    TOOL BOX
                  </span>
                  <span
                    className="text-[24px] leading-none text-[#8fd4ff]"
                    style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
                  >
                    .
                  </span>
                </h2>
                <span className="mt-[6px] text-[9px] font-bold uppercase tracking-[0.26em] text-white/45">
                  Smart Site Tools
                </span>
              </div>
            </div>

            <div className="mt-9 space-y-3.5">
              <div className="relative">
                <User className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/40" />
                <input
                  aria-label="이메일"
                  className={`${INPUT_CLS} pr-4`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="이메일을 입력하세요"
                  autoFocus
                />
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/40" />
                <input
                  aria-label="비밀번호"
                  className={`${INPUT_CLS} pr-12`}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="비밀번호를 입력하세요"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={showPw}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-white/40 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fd4ff]/50"
                >
                  {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 h-12 w-full rounded-lg bg-[#1478d6] text-[15px] font-bold text-white transition-colors hover:bg-[#0a63b8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#8fd4ff]/40 disabled:opacity-60"
            >
              {submitting ? "로그인 중…" : "로그인"}
            </button>

            <label className="mt-4 flex w-fit cursor-pointer select-none items-center gap-2 text-[13px] text-white/70">
              <input
                type="checkbox"
                checked={saveId}
                onChange={(e) => setSaveId(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10 accent-[#1478d6]"
              />
              아이디 저장
            </label>

            <div className="mt-8 border-t border-white/10 pt-6 text-center">
              <p className="text-[12px] text-white/45">계정이 없거나 비밀번호를 잊었으면 스마트기술팀에 문의하세요.</p>
              <div className="mt-5 flex items-center justify-center gap-2.5">
                {woomiLogo("h-5 w-auto select-none object-contain brightness-0 invert opacity-80")}
                <span className="h-4 w-px bg-white/25" />
                <span className="text-[12.5px] text-white/60">우미건설 스마트기술팀</span>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
