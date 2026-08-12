import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import ElevationGeneratorPage from "@/features/elevation/ElevationGeneratorPage";
import LoginPage from "@/features/auth/LoginPage";
import AuthGate from "@/features/auth/AuthGate";
import HomePage from "@/features/home/HomePage";
import MarketPublishPage from "@/features/market/MarketPublishPage";
import MarketAppDetailPage from "@/features/market/MarketAppDetailPage";

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
