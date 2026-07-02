import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 뼈대 단계 최소 설정. API 프록시 등은 저장/불러오기 이식 단계에서 추가합니다.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
