import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Vite + React + Tailwind v4.
// /api/* 는 로컬 wrangler dev(apps/worker, 기본 8787) 로 프록시한다.
// 다른 타깃(예: 배포된 Worker)을 쓰려면 IPG_API_TARGET 환경변수로 덮어쓴다.
const apiTarget = process.env.IPG_API_TARGET || "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
