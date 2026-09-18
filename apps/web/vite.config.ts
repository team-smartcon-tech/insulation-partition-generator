import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Vite + React + Tailwind v4.
// /api/* 는 로컬 wrangler dev(apps/worker, 포트 9887) 로 프록시한다.
// (Smart Works 로컬 dev 의 8787 과 겹치지 않도록 별도 포트 사용)
// 8887 은 Windows 예약 포트 범위(WinNAT/Hyper-V)에 걸려 workerd 가
// `*** std::terminate()` 로 즉사 → /api 프록시가 끊겨 "로그인 실패" 로 보인다.
// 예약 범위는 재부팅마다 이동하므로 확인: netsh interface ipv4 show excludedportrange protocol=tcp
// 다른 타깃(예: 배포된 Worker)을 쓰려면 IPG_API_TARGET 환경변수로 덮어쓴다.
const apiTarget = process.env.IPG_API_TARGET || "http://127.0.0.1:9887";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    // Smart Works 로컬 dev(5173)와 겹치지 않도록 별도 포트 사용.
    // Windows 예약 포트 범위(WinNAT/Hyper-V)는 재부팅마다 이동하며 지금까지
    // 5273(5210~5519) → 5973(5889~5988) 이 차례로 잡아먹혔다.
    // 걸리면 `EACCES: permission denied ::1:<포트>` 로 실패한다.
    // 예약 범위 확인: netsh interface ipv4 show excludedportrange protocol=tcp
    // 관리자 PowerShell 로 영구 선점하면 재발을 막을 수 있다:
    //   net stop winnat
    //   netsh int ipv4 add excludedportrange protocol=tcp startport=5473 numberofports=1 store=persistent
    //   net start winnat
    port: 5473,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
