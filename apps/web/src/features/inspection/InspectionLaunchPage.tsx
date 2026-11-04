/**
 * 검측요청 — /tools/inspection
 *
 * 검측요청은 별도 서비스라 이 화면은 이동만 한다: Worker 에서 60초짜리 연결 토큰을 받아
 * 검측요청 /sso 로 넘어가면 툴박스 계정으로 바로 로그인된다(apps/worker/src/inspection.ts).
 * 스마트 공정표에서 고르던 현장이 있으면 그 현장으로 먼저 연다.
 */
import { useEffect, useRef, useState } from "react";
import ToolShell from "@/features/tcRental/components/ToolShell";

/** 스마트 공정표 GanttPage 가 기억하는 현장 키 */
const GANTT_SITE_KEY = "gantt.siteId";

export default function InspectionLaunchPage() {
  const [error, setError] = useState<string | null>(null);
  // StrictMode 이중 실행으로 토큰을 두 번 받지 않게
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let siteId: string | null = null;
    try {
      siteId = localStorage.getItem(GANTT_SITE_KEY);
    } catch {
      /* 없어도 된다 */
    }

    (async () => {
      const res = await fetch("/api/inspection/handoff", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
        throw new Error(body.error || `검측요청 연결 오류 (${res.status})`);
      }
      // 뒤로 가기로 이 화면에 돌아와 토큰을 또 받지 않게 replace
      window.location.replace(body.url);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <ToolShell title="검측요청" subtitle={<span className="text-[12px] text-slate-400">검측요청 · 전자서명 · 결과통보</span>}>
      <div className="px-6 py-16 text-center text-sm lg:px-8">
        {error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <p className="text-slate-500">검측요청으로 이동하는 중입니다…</p>
        )}
      </div>
    </ToolShell>
  );
}
