import { Hono } from "hono";

// 뼈대 단계: /health 만 응답합니다.
// 저장/불러오기 API(elevation-projects)와 Supabase/Storage 연동은 다음 단계에서 이식합니다.
export interface Env {
  // 다음 단계에서 채움 (Cloudflare Secrets):
  // SUPABASE_URL: string;
  // SUPABASE_SERVICE_ROLE_KEY: string;
  // JWT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({ ok: true, service: "insulation-partition-generator" }),
);

export default app;
