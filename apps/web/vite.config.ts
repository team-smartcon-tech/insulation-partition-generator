import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Vite + React + Tailwind v4.
// /api/* 는 로컬 wrangler dev(apps/worker, 포트 8887) 로 프록시한다.
// (Smart Works 로컬 dev 의 8787 과 겹치지 않도록 8887 사용)
// 다른 타깃(예: 배포된 Worker)을 쓰려면 IPG_API_TARGET 환경변수로 덮어쓴다.
const apiTarget = process.env.IPG_API_TARGET || "http://127.0.0.1:8887";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    // Smart Works 로컬 dev(5173)와 겹치지 않도록 별도 포트 사용.
    // 5273 은 Windows 예약 포트 범위(WinNAT/Hyper-V, 5210~5519)에 걸려
    // `EACCES: permission denied ::1:5273` 로 실패하므로 예약 블록에서 떨어진 5973 사용.
    // 예약 범위 확인: netsh interface ipv4 show excludedportrange protocol=tcp
    port: 5973,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
