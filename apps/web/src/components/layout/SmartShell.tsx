/**
 * 스마트 시리즈 화면의 공통 틀 — 배경(블루프린트 그리드 + 오로라), 흰 상단 바, 딥블루 배너.
 *
 * 홈(SmartDeck 도구 목록)과 각 도구(Smart Forms 등)가 같은 첫인상을 갖게 하려고 뽑아 냈다.
 * 화면마다 따로 복사해 두면 한쪽만 고쳐져 금방 서로 달라진다.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";

/** DCR role 코드 → 한국어 라벨 */
const ROLE_LABEL: Record<string, string> = {
  super_admin: "최고 관리자",
  system_admin: "시스템 관리자",
  site_admin: "현장 관리자",
  member: "회원",
};

/** 화면 전체 배경 + 내용. 배경 레이어는 클릭을 가로채지 않는다. */
export function SmartBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#e6eefb] via-[#f2f6fd] to-[#e8f0fa] text-slate-800">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* 블루프린트 그리드 — 천천히 흐름 */}
        <div
          className="ambient-anim absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(2,71,145,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(2,71,145,0.07) 1px, transparent 1px)",
            backgroundSize: "46px 46px",
            maskImage: "radial-gradient(120% 80% at 50% -10%, #000 35%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(120% 80% at 50% -10%, #000 35%, transparent 78%)",
            animation: "gridDrift 34s linear infinite",
          }}
        />
        {/* 움직이는 오로라 광원 */}
        <div
          className="ambient-anim absolute -left-44 -top-52 h-[580px] w-[580px] rounded-full blur-[92px]"
          style={{
            background: "radial-gradient(circle, #1478d6 0%, transparent 68%)",
            opacity: 0.28,
            animation: "ambientFloatA 17s ease-in-out infinite",
          }}
        />
        <div
          className="ambient-anim absolute -top-36 right-[-140px] h-[540px] w-[540px] rounded-full blur-[92px]"
          style={{
            background: "radial-gradient(circle, #22c1ff 0%, transparent 68%)",
            opacity: 0.24,
            animation: "ambientFloatB 21s ease-in-out infinite",
          }}
        />
        <div
          className="ambient-anim absolute bottom-[-160px] left-1/4 h-[540px] w-[780px] rounded-full blur-[112px]"
          style={{
            background: "radial-gradient(ellipse, #4f83e0 0%, transparent 70%)",
            opacity: 0.2,
            animation: "ambientFloatC 24s ease-in-out infinite 1.5s",
          }}
        />
        <div
          className="ambient-anim absolute left-1/2 top-1/3 h-[320px] w-[320px] rounded-full blur-[84px]"
          style={{
            background: "radial-gradient(circle, #7cc4ff 0%, transparent 65%)",
            opacity: 0.18,
            animation: "ambientFloatB 19s ease-in-out infinite 0.8s",
          }}
        />
        {/* 은은한 빛 스윕 */}
        <div className="absolute -top-1/2 left-0 h-[200%] w-full overflow-hidden">
          <div
            className="ambient-anim absolute top-0 h-full w-[26%] blur-2xl"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
              animation: "sheenSweep 13s ease-in-out infinite 3s",
            }}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

/** 우미 로고 (실패 시 대체 이미지로 폴백) */
export function WoomiLogo() {
  const [src, setSrc] = useState("/woomi_short.png");
  return (
    <img
      src={src}
      alt="우미"
      className="h-9 w-auto select-none object-contain"
      draggable={false}
      loading="eager"
      onError={() =>
        setSrc((prev) => (prev === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png"))
      }
    />
  );
}

/** 흰 글래스 상단 바 — 좌: 우미 로고 | 도구 워드마크, 우: 사용자·로그아웃 */
export function SmartHeader({ brand }: { brand: ReactNode }) {
  const { user, logout } = useAuth();
  const roleLabel = user?.role ? (ROLE_LABEL[user.role] ?? undefined) : undefined;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 shadow-[0_8px_24px_-16px_rgba(8,22,52,0.4)] backdrop-blur-xl">
      <div className="flex h-[68px] w-full items-center justify-between px-8">
        <div className="flex items-center gap-4">
          <WoomiLogo />
          <div className="h-7 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent" />
          {brand}
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-[13.5px] font-bold text-slate-800">{user.name} 님</div>
              {roleLabel && <div className="text-[11px] text-slate-400">{roleLabel}</div>}
            </div>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2a8fe6] via-[#0a63b8] to-[#003a78] text-[13px] font-bold text-white shadow-[0_4px_12px_-2px_rgba(0,71,145,0.5)] ring-1 ring-white/30">
            {user?.name?.trim().charAt(0) ?? "?"}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="로그아웃"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}

/** 배너 위 요약 칩 (`도구 4`, `● 사용 가능 3`) */
export function HeroChip({ children, dot = false }: { children: ReactNode; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-0.5 text-[11px] font-semibold text-white/90 ring-1 ring-white/25 backdrop-blur">
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-[#5cffa8]" />}
      {children}
    </span>
  );
}

/** 풀블리드 딥블루 배너 — 작은 머리글·칩, 큰 제목, 설명, 오른쪽 자리(검색·버튼) */
export function SmartHero({
  eyebrow,
  chips,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  chips?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="relative z-10 w-full overflow-hidden bg-[linear-gradient(105deg,#00224a_0%,#0a5aa8_38%,#1478d6_62%,#043a74_100%)] shadow-[0_18px_40px_-24px_rgba(0,39,77,0.75)]">
      {/* 블루프린트 그리드 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          maskImage: "radial-gradient(120% 130% at 78% 0%, #000 10%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(120% 130% at 78% 0%, #000 10%, transparent 72%)",
        }}
      />
      {/* 광원 + 상단 하이라이트 라인 */}
      <div
        className="pointer-events-none absolute -right-24 -top-40 h-[420px] w-[520px] rounded-full blur-[90px]"
        style={{ background: "radial-gradient(circle, #4fc3ff 0%, transparent 70%)", opacity: 0.3 }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 left-[12%] h-[320px] w-[520px] rounded-full blur-[90px]"
        style={{ background: "radial-gradient(ellipse, #0d2f66 0%, transparent 70%)", opacity: 0.55 }}
      />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />

      <div className="relative mx-auto flex w-full max-w-[2100px] flex-wrap items-center justify-between gap-4 px-8 py-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-[2px] w-5 rounded-full bg-[#5cc8ff]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#a9d8ff]">{eyebrow}</span>
            {chips && <span className="ml-1 inline-flex flex-wrap items-center gap-2">{chips}</span>}
          </div>
          <h1
            className="mt-1.5 text-[30px] leading-[1.12] text-white drop-shadow-[0_3px_14px_rgba(0,20,45,0.45)]"
            style={{ fontFamily: "'Black Han Sans', 'SUIT Variable', sans-serif" }}
          >
            {title}
          </h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-snug text-white/75">{description}</p>
        </div>

        {actions && <div className="flex w-full max-w-2xl items-center gap-2.5 sm:w-auto">{actions}</div>}
      </div>
    </section>
  );
}
