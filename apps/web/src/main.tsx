import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "@/features/auth/AuthContext";
import "./index.css";

// networkMode: "always" — react-query 기본값("online")은 onlineManager(=navigator.onLine)가
// offline 이라고 보면 요청을 아예 보내지 않고 **무기한 pause** 한다. 이때 mutateAsync 의 프로미스가
// 영원히 pending 이라 로그인 버튼이 "로그인 중…" 에서 멈추고 콘솔에는 요청 흔적조차 안 남는다.
// 사내망·VPN·가상 네트워크 어댑터 환경에서 navigator.onLine 이 실제 연결과 무관하게 false 로
// 잘못 보고되는 사례가 있어(2026-09-02 로그인 불가 신고), 판정을 믿지 않고 항상 요청을 보낸다.
// 진짜 오프라인이면 fetch 가 즉시 실패 → 에러 토스트 + 버튼 복구로 이어져 UX 도 이쪽이 낫다.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
