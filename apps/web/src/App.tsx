import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import ElevationGeneratorPage from "@/features/elevation/ElevationGeneratorPage";
import LoginPage from "@/features/auth/LoginPage";
import AuthGate from "@/features/auth/AuthGate";

export default function App() {
  return (
    <>
      <Switch>
        <Route path="/login"><LoginPage /></Route>
        <Route path="/">
          <AuthGate>
            <ElevationGeneratorPage />
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
