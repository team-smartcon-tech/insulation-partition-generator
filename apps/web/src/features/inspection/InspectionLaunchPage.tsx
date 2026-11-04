/**
 * 검측요청 — /tools/inspection
 *
 * 검측요청은 별도 서비스(wm-pi/Inspection-Request)라 이 화면은 그 주소로 이동만 한다.
 * 우미 직원은 검측요청 로그인 화면에서 스마트웍스 이메일·비밀번호로 들어간다.
 */
import { useEffect } from "react";
import ToolShell from "@/features/tcRental/components/ToolShell";

const INSPECTION_URL: string =
  (import.meta.env.VITE_INSPECTION_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://inspection-request.jogh.workers.dev";

export default function InspectionLaunchPage() {
  useEffect(() => {
    // 뒤로 가기로 이 화면에 돌아와 다시 이동하지 않게 replace
    window.location.replace(INSPECTION_URL);
  }, []);

  return (
    <ToolShell title="검측요청" subtitle={<span className="text-[12px] text-slate-400">검측요청 · 전자서명 · 결과통보</span>}>
      <div className="px-6 py-16 text-center text-sm lg:px-8">
        <p className="text-slate-500">
          검측요청으로 이동하는 중입니다… 열리지 않으면 <a className="text-blue-700 underline" href={INSPECTION_URL}>여기</a>를 눌러 주세요.
        </p>
      </div>
    </ToolShell>
  );
}
