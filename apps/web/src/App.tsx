import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import AnnouncementsPage from "@/features/announcements/AnnouncementsPage";
import ElevationGeneratorPage from "@/features/elevation/ElevationGeneratorPage";
import LoginPage from "@/features/auth/LoginPage";
import AuthGate from "@/features/auth/AuthGate";
import FormsPage from "@/features/forms/FormsPage";
import HomePage from "@/features/home/HomePage";
import NewItemPage from "@/features/new-item";

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
        <Route path="/tools/announcements">
          <AuthGate>
            <AnnouncementsPage />
          </AuthGate>
        </Route>
        <Route path="/tools/new-item">
          <AuthGate>
            <NewItemPage />
          </AuthGate>
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
