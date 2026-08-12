/**
 * App Market 하위 페이지(게시하기 · 상세)의 공통 껍데기.
 * 홈(HomePage)과 같은 배경 톤 + 헤더를 쓰되, 좌측에 "홈으로" 이동을 둔다.
 * HomePage 는 건드리지 않으려고 로고/헤더를 이 파일에 따로 둔다.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, LogOut } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import BrandWordmark from "@/components/brand/BrandWordmark";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "최고 관리자",
  system_admin: "시스템 관리자",
  site_admin: "현장 관리자",
  member: "회원",
};

/** 우미 로고 (실패 시 대체 이미지로 폴백) */
function WoomiLogo() {
  const [src, setSrc] = useState("/woomi_short.png");
  return (
    <img
      src={src}
      alt="우미"
      className="h-9 w-auto select-none object-contain"
      draggable={false}
      loading="eager"
      onError={() =>
        setSrc((prev) =>
          prev === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png",
        )
      }
    />
  );
}

export default function MarketShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const roleLabel = user?.role ? ROLE_LABEL[user.role] ?? undefined : undefined;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#e6eefb] via-[#f4f7fd] to-[#eef3fb] text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 shadow-[0_8px_24px_-16px_rgba(8,22,52,0.4)] backdrop-blur-xl">
        <div className="flex h-[68px] w-full items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title="홈으로"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
            </Link>
            <WoomiLogo />
            <div className="h-7 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent" />
            <BrandWordmark />
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

      <main className="relative mx-auto w-full max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
