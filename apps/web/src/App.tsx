import type { ReactNode } from "react";
import { Link, Route, Switch } from "wouter";
import { useAuth } from "@/features/auth/AuthContext";
import { TOOLS, canSeeTool } from "@/features/home/tools";
import { Toaster } from "sonner";
import ElevationGeneratorPage from "@/features/elevation/ElevationGeneratorPage";
import TcRentalPage from "@/features/tcRental/TcRentalPage";
import GanttPage from "@/features/gantt/GanttPage";
import HeatReviewPage from "@/features/heatReview/HeatReviewPage";
import SlabZonePage from "@/features/slabZone/SlabZonePage";
import InspectionLaunchPage from "@/features/inspection/InspectionLaunchPage";
import LoginPage from "@/features/auth/LoginPage";
import AuthGate from "@/features/auth/AuthGate";
import HomePage from "@/features/home/HomePage";
import MarketPublishPage from "@/features/market/MarketPublishPage";
import MarketAppDetailPage from "@/features/market/MarketAppDetailPage";

/** 명단이 걸린 도구는 명단에 있는 사람만 들어간다(홈 카드도 같은 기준으로 가린다 — tools.ts canSeeTool) */
function ToolGate({ toolId, children }: { toolId: string; children: ReactNode }) {
  const { user } = useAuth();
  const tool = TOOLS.find((t) => t.id === toolId);
  if (tool && !canSeeTool(tool, user?.email)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <p className="text-[15px] font-bold text-slate-800">이 도구는 아직 시범 운영 중입니다</p>
        <p className="text-[13px] text-slate-500">지정된 사용자만 열 수 있습니다.</p>
        <Link href="/" className="mt-2 text-[13px] font-semibold text-[#004791] underline">
          홈으로
        </Link>
      </main>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Switch>
        <Route path="/login"><LoginPage /></Route>
        {/* 메인 허브 — 도구 목록 */}
        <Route path="/">
          <AuthGate>
            <HomePage />
          </AuthGate>
        </Route>
        {/* 도구: 단열재 나누기도 */}
        <Route path="/tools/insulation">
          <AuthGate>
            <ElevationGeneratorPage />
          </AuthGate>
        </Route>
        {/* 도구: TC 임대계획 */}
        <Route path="/tools/tc-rental">
          <AuthGate>
            <TcRentalPage />
          </AuthGate>
        </Route>
        {/* 도구: 동절기 열원검토 */}
        <Route path="/tools/heat-review">
          <AuthGate>
            <HeatReviewPage />
          </AuthGate>
        </Route>
        {/* 도구: 슬래브 구분도 */}
        <Route path="/tools/slab-zone">
          <AuthGate>
            <ToolGate toolId="slab-zone">
              <SlabZonePage />
            </ToolGate>
          </AuthGate>
        </Route>
        {/* 도구: 스마트 공정표 */}
        <Route path="/tools/gantt">
          <AuthGate>
            <GanttPage />
          </AuthGate>
        </Route>
        {/* 도구: 검측요청 (별도 서비스로 로그인 넘겨 이동) */}
        <Route path="/tools/inspection">
          <AuthGate>
            <InspectionLaunchPage />
          </AuthGate>
        </Route>
        {/* App Market — 게시/수정/상세 (구체적인 경로가 /market/:appId 보다 먼저 와야 한다) */}
        <Route path="/market/new">
          <AuthGate>
            <MarketPublishPage />
          </AuthGate>
        </Route>
        <Route path="/market/:appId/edit">
          {(params) => (
            <AuthGate>
              <MarketPublishPage appId={params.appId} />
            </AuthGate>
          )}
        </Route>
        <Route path="/market/:appId">
          <AuthGate>
            <MarketAppDetailPage />
          </AuthGate>
        </Route>
        <Route>
          <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
            <p>페이지를 찾을 수 없습니다.</p>
          </main>
        </Route>
      </Switch>
      <Toaster richColors position="top-center" />
    </>
  );
}
