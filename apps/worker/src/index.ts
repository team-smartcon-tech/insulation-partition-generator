/**
 * 단열재 나누기도 생성기 — 저장/불러오기 Worker (Hono)
 *
 * 원본(SSX worker/index.ts)의 handle*ElevProject* / *ElevRevision* 핸들러를
 * 독립 Supabase 프로젝트용으로 이식한 것.
 *   - 테이블: public.elev_projects / public.elev_revisions (supabase/migrations 참조)
 *   - DXF 원본: Storage {ELEV_DXF_BUCKET}/elevation/{projectId}/{revId}.dxf
 *   - 접근 제어: 현재 없음(열린 결정 §6-1 추천안 — 사내 도구, service_role 은 서버에만 보관).
 *     로그인 도입 시 이 파일의 라우트 앞단에 미들웨어로 추가한다.
 */
import { Hono } from "hono";
import {
  type Env,
  type SessionUser,
  authMiddleware,
  isAllowedRole,
  signSession,
  verifySession,
  buildSessionCookie,
  buildLogoutCookie,
  callDcrLogin,
  checkLoginRateLimit,
  parseCookie,
} from "./auth";

export type { Env };

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

const dxfBucket = (env: Env) => env.ELEV_DXF_BUCKET || "elev-dxf";

// ─── Supabase REST / Storage 헬퍼 ───────────────────────────

async function supabaseRest(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  prefer = "return=representation",
): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase 환경 설정 누락 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function storageUpload(
  env: Env,
  bucket: string,
  objectPath: string,
  fileBuffer: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Storage 업로드 실패 (${res.status}): ${await res.text()}`);
}

async function storageDelete(env: Env, bucket: string, objectPaths: string[]): Promise<void> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: objectPaths }),
  });
  if (!res.ok) throw new Error(`Storage 삭제 실패 (${res.status}): ${await res.text()}`);
}

/** 비공개 버킷 파일의 임시 다운로드 URL (TTL 기본 1시간) */
async function storageSignedUrl(
  env: Env,
  bucket: string,
  objectPath: string,
  expiresIn = 3600,
): Promise<string> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Signed URL 생성 실패 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { signedURL: string };
  return `${env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ─── 라우트 ─────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "insulation-partition-generator" }));

// ─── 인증 (DCR 통합로그인 · SSX 로그인과 동일: 이메일+비밀번호) ─────
// DCR /auth/login 으로 자격증명 검증 위임 → 자체 시크릿으로 세션 토큰 재발급(HttpOnly 쿠키).
// 미들웨어보다 먼저 등록되어야 게이트에 걸리지 않는다.

/** POST /api/auth/login — 로그인(이메일+비밀번호, SSX 동일) */
app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (!(await checkLoginRateLimit(c.env, ip))) {
    return c.json({ error: "시도가 너무 많습니다. 잠시 후 다시 시도하세요." }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return c.json({ error: "이메일·비밀번호를 입력하세요." }, 400);
  }

  const r = await callDcrLogin(c.env, { email, password });
  if (!r.ok || !r.user) {
    const status = r.status === 429 ? 429 : r.status >= 500 ? 502 : 401;
    return c.json({ error: r.error || "로그인 실패" }, status as 401);
  }
  if (!isAllowedRole(r.user.role)) {
    return c.json({ error: "접근 권한이 없습니다." }, 403);
  }

  const user: SessionUser = {
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    role: r.user.role,
  };
  let token: string;
  try {
    token = await signSession(c.env, user);
  } catch (e) {
    console.error("[auth/login] 토큰 발급 실패:", e instanceof Error ? e.message : String(e));
    return c.json({ error: "서버 설정 오류(IPG_JWT_SECRET)" }, 500);
  }
  c.header("Set-Cookie", buildSessionCookie(c.env, token));
  return c.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

/** POST /api/auth/logout — 세션 쿠키 만료 */
app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", buildLogoutCookie(c.env));
  return c.json({ ok: true });
});

/** GET /api/auth/me — 현재 세션(쿠키 로컬 검증) */
app.get("/api/auth/me", async (c) => {
  const token = parseCookie(c.req.header("Cookie") ?? null, c.env.COOKIE_NAME || "ipg_session");
  const user = token ? await verifySession(c.env, token) : null;
  if (!user) return c.json({ error: "인증이 필요합니다." }, 401);
  return c.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// 이하 /api/* 는 로그인 필수 (/health, /api/auth/* 는 미들웨어 내부에서 통과)
app.use("/api/*", authMiddleware());

/** GET /api/elevation-projects — 프로젝트 목록 */
app.get("/api/elevation-projects", async (c) => {
  try {
    const res = await supabaseRest(c.env, "GET", `/elev_projects?select=*&order=updated_at.desc`);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[elev-projects/GET]", errText);
      return c.json({ error: `조회 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ projects: await res.json() });
  } catch (err) {
    console.error("[elev-projects/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** POST /api/elevation-projects — 신규 프로젝트 생성 (JSON: {name, description?}) */
app.post("/api/elevation-projects", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "프로젝트 이름이 필요합니다." }, 400);
    const row = {
      name,
      description: typeof body?.description === "string" ? body.description : null,
      created_by: c.get("user")?.id ?? null,
    };
    const res = await supabaseRest(c.env, "POST", `/elev_projects`, row);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[elev-projects/POST]", errText);
      return c.json({ error: `생성 실패: ${errText}` }, res.status as 500);
    }
    const inserted = (await res.json()) as unknown[];
    return c.json({ project: inserted[0] ?? null });
  } catch (err) {
    console.error("[elev-projects/POST]", errMsg(err));
    return c.json({ error: `생성 실패: ${errMsg(err)}` }, 500);
  }
});

/** GET /api/elevation-projects/:projectId — 프로젝트 + 리비전 메타 목록(state 제외 경량) */
app.get("/api/elevation-projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const pRes = await supabaseRest(
      c.env, "GET", `/elev_projects?id=eq.${encodeURIComponent(projectId)}&select=*&limit=1`,
    );
    if (!pRes.ok) return c.json({ error: "조회 실패" }, pRes.status as 500);
    const project = ((await pRes.json()) as unknown[])[0] ?? null;
    if (!project) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);
    const rRes = await supabaseRest(
      c.env, "GET",
      `/elev_revisions?project_id=eq.${encodeURIComponent(projectId)}` +
        `&select=id,rev_no,memo,dxf_name,dxf_size,dxf_path,summary,schema_ver,created_by,created_at` +
        `&order=rev_no.desc`,
    );
    const revisions = rRes.ok ? await rRes.json() : [];
    return c.json({ project, revisions });
  } catch (err) {
    console.error("[elev-project/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** PATCH /api/elevation-projects/:projectId — 이름/설명 수정 */
app.patch("/api/elevation-projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown } | null;
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body?.name === "string" && body.name.trim()) row.name = body.name.trim();
    if (typeof body?.description === "string") row.description = body.description;
    const res = await supabaseRest(
      c.env, "PATCH", `/elev_projects?id=eq.${encodeURIComponent(projectId)}`, row,
    );
    if (!res.ok) {
      const errText = await res.text();
      return c.json({ error: `저장 실패: ${errText}` }, res.status as 500);
    }
    const updated = ((await res.json()) as unknown[])[0] ?? null;
    return c.json({ project: updated });
  } catch (err) {
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/** DELETE /api/elevation-projects/:projectId — 프로젝트 + 리비전 + Storage 정리 */
app.delete("/api/elevation-projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    // 해당 프로젝트의 DXF 경로 수집 후 Storage 삭제
    const rRes = await supabaseRest(
      c.env, "GET", `/elev_revisions?project_id=eq.${encodeURIComponent(projectId)}&select=dxf_path`,
    );
    if (rRes.ok) {
      const paths = ((await rRes.json()) as { dxf_path: unknown }[])
        .map((r) => r.dxf_path)
        .filter((p): p is string => typeof p === "string" && !!p);
      if (paths.length > 0) {
        try { await storageDelete(c.env, dxfBucket(c.env), paths); } catch { /* ignore */ }
      }
    }
    // cascade 로 revisions 도 삭제됨
    const res = await supabaseRest(
      c.env, "DELETE", `/elev_projects?id=eq.${encodeURIComponent(projectId)}`, undefined, "return=minimal",
    );
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      return c.json({ error: `삭제 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `삭제 실패: ${errMsg(err)}` }, 500);
  }
});

/** GET /api/elevation-projects/:projectId/revisions/:revId — 단일 REV 전체 + DXF signed URL */
app.get("/api/elevation-projects/:projectId/revisions/:revId", async (c) => {
  const revId = c.req.param("revId");
  try {
    const res = await supabaseRest(
      c.env, "GET", `/elev_revisions?id=eq.${encodeURIComponent(revId)}&select=*&limit=1`,
    );
    if (!res.ok) return c.json({ error: "조회 실패" }, res.status as 500);
    const rev = ((await res.json()) as Record<string, unknown>[])[0] ?? null;
    if (!rev) return c.json({ error: "리비전을 찾을 수 없습니다." }, 404);
    let dxfSignedUrl: string | null = null;
    if (typeof rev.dxf_path === "string" && rev.dxf_path) {
      try {
        dxfSignedUrl = await storageSignedUrl(
          c.env,
          (typeof rev.dxf_bucket === "string" && rev.dxf_bucket) || dxfBucket(c.env),
          rev.dxf_path,
          3600,
        );
      } catch (e) {
        console.error("[elev-rev/GET] signed URL 실패:", e);
      }
    }
    return c.json({ revision: rev, dxfSignedUrl });
  } catch (err) {
    console.error("[elev-rev/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * POST /api/elevation-projects/:projectId/revisions — 새 REV 저장
 * Body: multipart/form-data
 *   - state : JSON 문자열(복원용 앱 상태)  [필수]
 *   - summary : JSON 문자열(표시용 요약)    [선택]
 *   - memo : 문자열                         [선택]
 *   - file : DXF 파일                       [선택 — 없으면 dxfPath 재사용]
 *   - dxfPath/dxfName/dxfSize : 직전 REV DXF 재사용 시 전달(파일 미첨부)
 */
app.post("/api/elevation-projects/:projectId/revisions", async (c) => {
  const projectId = c.req.param("projectId");
  const bucket = dxfBucket(c.env);
  try {
    const form = await c.req.raw.formData();
    const stateRaw = form.get("state");
    if (typeof stateRaw !== "string") {
      return c.json({ error: "state(JSON)가 필요합니다." }, 400);
    }
    let state: unknown;
    try {
      state = JSON.parse(stateRaw);
    } catch {
      return c.json({ error: "state JSON 파싱 오류" }, 400);
    }
    let summary: unknown = null;
    const summaryRaw = form.get("summary");
    if (typeof summaryRaw === "string") {
      try { summary = JSON.parse(summaryRaw); } catch { summary = null; }
    }
    const memoRaw = form.get("memo");
    const memo = typeof memoRaw === "string" ? memoRaw : null;

    // 프로젝트 확인 + 다음 rev_no
    const pRes = await supabaseRest(
      c.env, "GET", `/elev_projects?id=eq.${encodeURIComponent(projectId)}&select=id,latest_rev_no&limit=1`,
    );
    const project = pRes.ok
      ? (((await pRes.json()) as { latest_rev_no?: number }[])[0] ?? null)
      : null;
    if (!project) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);

    const revId = crypto.randomUUID();

    // DXF: 신규 파일 업로드 또는 직전 경로 재사용
    let dxfPath: string | null = null;
    let dxfBucketCol: string | null = null;
    let dxfName: string | null = null;
    let dxfSize: number | null = null;
    // workers-types 의 FormData.get 은 string|null 로 선언되어 있어 File 여부를 typeof 로 판별
    const fileEntry = form.get("file");
    const file =
      fileEntry && typeof fileEntry !== "string" ? (fileEntry as unknown as File) : null;
    if (file && file.size > 0) {
      if (file.size > 90 * 1024 * 1024) {
        return c.json({ error: "DXF 파일은 90MB 이하여야 합니다." }, 413);
      }
      const objectPath = `elevation/${projectId}/${revId}.dxf`;
      const buf = await file.arrayBuffer();
      await storageUpload(c.env, bucket, objectPath, buf, file.type || "application/dxf");
      dxfPath = objectPath;
      dxfBucketCol = bucket;
      dxfName = file.name;
      dxfSize = file.size;
    } else if (typeof form.get("dxfPath") === "string" && (form.get("dxfPath") as string)) {
      // 직전 REV DXF 재사용(변경 없음)
      dxfPath = form.get("dxfPath") as string;
      dxfBucketCol = bucket;
      dxfName = typeof form.get("dxfName") === "string" ? (form.get("dxfName") as string) : null;
      const ds = form.get("dxfSize");
      dxfSize = typeof ds === "string" && ds ? Number(ds) : null;
    }

    // insert (rev_no 동시성 충돌 시 1회 재시도)
    const insertRev = (revNo: number) =>
      supabaseRest(c.env, "POST", `/elev_revisions`, {
        id: revId,
        project_id: projectId,
        rev_no: revNo,
        memo,
        state,
        summary,
        dxf_bucket: dxfBucketCol,
        dxf_path: dxfPath,
        dxf_name: dxfName,
        dxf_size: dxfSize,
        schema_ver: 1,
        created_by: c.get("user")?.id ?? null,
      });

    let nextNo = (project.latest_rev_no ?? 0) + 1;
    let res = await insertRev(nextNo);
    if (res.status === 409) {
      // unique(project_id,rev_no) 충돌 → 최신 재조회 후 1회 재시도
      const reRes = await supabaseRest(
        c.env, "GET",
        `/elev_revisions?project_id=eq.${encodeURIComponent(projectId)}&select=rev_no&order=rev_no.desc&limit=1`,
      );
      const top = reRes.ok ? (((await reRes.json()) as { rev_no?: number }[])[0] ?? null) : null;
      nextNo = (top?.rev_no ?? nextNo) + 1;
      res = await insertRev(nextNo);
    }
    if (!res.ok) {
      const errText = await res.text();
      console.error("[elev-rev/POST]", errText);
      // Storage 롤백(신규 업로드분만)
      if (file && dxfPath) {
        try { await storageDelete(c.env, bucket, [dxfPath]); } catch { /* ignore */ }
      }
      return c.json({ error: `저장 실패: ${errText}` }, res.status as 500);
    }
    const inserted = ((await res.json()) as unknown[])[0] ?? null;

    // 프로젝트 latest 갱신
    await supabaseRest(
      c.env, "PATCH", `/elev_projects?id=eq.${encodeURIComponent(projectId)}`,
      { latest_rev_no: nextNo, latest_rev_id: revId, updated_at: new Date().toISOString() },
      "return=minimal",
    );

    return c.json({ revision: inserted });
  } catch (err) {
    console.error("[elev-rev/POST]", errMsg(err));
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/** DELETE /api/elevation-projects/:projectId/revisions/:revId — 특정 REV 삭제 */
app.delete("/api/elevation-projects/:projectId/revisions/:revId", async (c) => {
  const projectId = c.req.param("projectId");
  const revId = c.req.param("revId");
  const bucket = dxfBucket(c.env);
  try {
    // DXF 경로 조회(다른 REV가 같은 경로 재사용 중이면 삭제 보류)
    const rRes = await supabaseRest(
      c.env, "GET", `/elev_revisions?id=eq.${encodeURIComponent(revId)}&select=dxf_path`,
    );
    const target = rRes.ok ? (((await rRes.json()) as { dxf_path?: string | null }[])[0] ?? null) : null;
    const dxfPath: string | null = target?.dxf_path ?? null;

    const res = await supabaseRest(
      c.env, "DELETE", `/elev_revisions?id=eq.${encodeURIComponent(revId)}`, undefined, "return=minimal",
    );
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      return c.json({ error: `삭제 실패: ${errText}` }, res.status as 500);
    }

    // 같은 dxf_path 를 다른 REV가 쓰는지 확인 후 미사용이면 Storage 삭제
    if (dxfPath) {
      const useRes = await supabaseRest(
        c.env, "GET", `/elev_revisions?dxf_path=eq.${encodeURIComponent(dxfPath)}&select=id&limit=1`,
      );
      const stillUsed = useRes.ok && ((await useRes.json()) as unknown[]).length > 0;
      if (!stillUsed) {
        try { await storageDelete(c.env, bucket, [dxfPath]); } catch { /* ignore */ }
      }
    }

    // latest 재계산
    const topRes = await supabaseRest(
      c.env, "GET",
      `/elev_revisions?project_id=eq.${encodeURIComponent(projectId)}&select=id,rev_no&order=rev_no.desc&limit=1`,
    );
    const top = topRes.ok
      ? (((await topRes.json()) as { id?: string; rev_no?: number }[])[0] ?? null)
      : null;
    await supabaseRest(
      c.env, "PATCH", `/elev_projects?id=eq.${encodeURIComponent(projectId)}`,
      { latest_rev_no: top?.rev_no ?? 0, latest_rev_id: top?.id ?? null, updated_at: new Date().toISOString() },
      "return=minimal",
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `삭제 실패: ${errMsg(err)}` }, 500);
  }
});

// ─── 마감 물량 산출 — LLM 실 검수 ──────────────────────────
//
// 기하 엔진이 뽑은 실(이름 + 가로/세로 + 면적)을 LLM 이 실무 관점에서 검수한다.
// 도면마다 벽 표현이 제각각이라 레이캐스트가 개구부를 지나쳐 실을 과대/과소로
// 잡는 경우가 있는데, "84㎡ 세대의 침실이 45㎡" 같은 건 사람은 즉시 알아본다.
// 좌표 계산 자체를 LLM 에 맡기지는 않는다 — 판정과 분류만 시킨다.
//
// LLM 은 반드시 dcr-app 단일 진입점(/api/llm/generate) 을 경유한다. provider 직접 호출 금지.

interface LlmRoomIn {
  name: string;
  area_m2: number;
  width_mm: number;
  depth_mm: number;
}

app.post("/api/takeoff/verify-rooms", async (c) => {
  try {
    const body = (await c.req.json()) as { rooms?: LlmRoomIn[]; unit_type?: string };
    const rooms = body.rooms ?? [];
    if (rooms.length === 0) return c.json({ error: "검수할 실이 없습니다" }, 400);

    // 토큰 낭비를 막기 위해 면적 큰 순으로 상위 60개만 보낸다.
    const sample = [...rooms].sort((a, b) => b.area_m2 - a.area_m2).slice(0, 60);

    const system = [
      "당신은 국내 공동주택 마감 적산 전문가입니다.",
      "도면에서 자동 추출한 실 목록을 검수합니다. 좌표를 다시 계산하지 말고, 실명과 치수의 타당성만 판정하세요.",
      "판정 기준(전용 84㎡ 기준 통상값): 거실 15~25㎡, 안방 10~18㎡, 침실 7~14㎡,",
      "주방/식당 8~16㎡, 욕실 3~7㎡, 드레스룸 2~6㎡, 현관 2~5㎡, 발코니 3~12㎡.",
      "치수가 통상값을 크게 벗어나면 대개 벽 개구부를 지나쳐 옆 실까지 합쳐 잡힌 것입니다.",
      "반드시 JSON 만 출력하세요. 형식:",
      '{"rooms":[{"index":0,"verdict":"ok|too_big|too_small|not_a_room","reason":"한 문장","room_type":"거실|안방|침실|주방|욕실|드레스룸|현관|발코니|기타"}],"summary":"한 문장"}',
    ].join("\n");

    const user = [
      body.unit_type ? `세대 타입: ${body.unit_type}` : "",
      "실 목록:",
      ...sample.map(
        (r, i) => `${i}. ${r.name} — ${r.area_m2}㎡ (${r.width_mm}×${r.depth_mm}mm)`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system,
        user,
        maxTokens: 4000,
        temperature: 0,
        responseFormat: "json",
      }),
    };

    // auth 와 동일 전략: 서비스 바인딩 우선 → 로컬(502/503)이면 공개 URL 폴백
    let res: Response | null = null;
    if (c.env.DCR_APP) {
      try {
        const bound = await c.env.DCR_APP.fetch(
          new Request("https://dcr-app/api/llm/generate", init),
        );
        if (bound.status !== 502 && bound.status !== 503) res = bound;
      } catch (e) {
        console.error("[takeoff] LLM 바인딩 호출 실패, 폴백:", errMsg(e));
      }
    }
    if (!res && c.env.DCR_BASE_URL) {
      res = await fetch(`${c.env.DCR_BASE_URL.replace(/\/$/, "")}/api/llm/generate`, init);
    }
    if (!res) return c.json({ error: "LLM 백엔드 미설정 (DCR_APP/DCR_BASE_URL)" }, 500);
    if (!res.ok) {
      return c.json({ error: `LLM 호출 실패 (${res.status})` }, 502);
    }

    const raw = (await res.json()) as { text?: string; content?: string };
    const text = raw.text ?? raw.content ?? "";
    // 코드펜스로 감싸 오는 모델이 있어 벗겨낸 뒤 파싱한다.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: { rooms?: { index: number; verdict: string; reason: string; room_type?: string }[]; summary?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return c.json({ error: "LLM 응답을 해석할 수 없습니다", raw: cleaned.slice(0, 400) }, 502);
    }

    // 샘플 인덱스를 원본 배열 인덱스로 되돌린다.
    const backMap = sample.map((s) => rooms.indexOf(s));
    const verdicts = (parsed.rooms ?? []).map((v) => ({
      ...v,
      index: backMap[v.index] ?? v.index,
    }));

    return c.json({
      verdicts,
      summary: parsed.summary ?? "",
      checked: sample.length,
      skipped: rooms.length - sample.length,
    });
  } catch (err) {
    return c.json({ error: `실 검수 실패: ${errMsg(err)}` }, 500);
  }
});

export default app;
