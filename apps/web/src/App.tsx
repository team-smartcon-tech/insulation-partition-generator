import { Redirect, Route, Switch } from "wouter";
import { Toaster } from "sonner";
import ElevationGeneratorPage from "@/features/elevation/ElevationGeneratorPage";
import LoginPage from "@/features/auth/LoginPage";
import AuthGate from "@/features/auth/AuthGate";
import FormsPage from "@/features/forms/FormsPage";
import HomePage from "@/features/home/HomePage";

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
        {/* 옛 "새 아이템" 자리 — 우미 양식 모음집이 대체했다.
            이미 이 주소로 열어 둔 탭·북마크가 있어 없는 페이지로 보내지 않는다. */}
        <Route path="/tools/new-item">
          <Redirect to="/tools/forms" replace />
        </Route>
        {/* 도구: 우미 양식 모음집 */}
        <Route path="/tools/forms">
          <AuthGate>
            <FormsPage />
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
