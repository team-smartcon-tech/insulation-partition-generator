/**
 * 인증 게이트 — 로그인 안 됐으면 /login 으로 보내고, 로딩 중엔 스켈레톤.
 * 전체 앱 보호(App.tsx 에서 "/" 라우트를 감쌈).
 */
import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./AuthContext";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login", { replace: true });
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#004791]" />
          <span className="text-sm">세션 확인 중…</span>
        </div>
      </div>
    );
  }

  if (!user) return null; // 리다이렉트 진행 중

  return <>{children}</>;
}
