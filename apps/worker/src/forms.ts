/**
 * 스마트폼(/tools/forms) 서버 API — 현장 서류를 서버에 두고 본사가 점검한다.
 *
 * 왜 서버인가: 지금까지 자료는 **각자 브라우저 안에만** 있었다. 옆자리 직원이 열면 비어 있고,
 * 큰 파일 몇 개면 저장소가 찬다. 현장 공유폴더(`Z:\01. 공사`)를 이 앱으로 대신하려면
 * 파일과 목록이 한곳에 있어야 한다.
 *
 * 테이블: public.form_sites / form_documents / form_taxonomy
 *         (supabase/migrations/20260929024537_add_smart_forms_server_storage.sql)
 * 파일:   Storage {FORM_FILES_BUCKET}/{kind}/{문서 id}/{파일명} (비공개 → 짧은 유효시간 주소)
 *
 * **파일 바이트는 이 Worker 를 지나가지 않는다.** 브라우저가 Supabase 로 바로 올리고 바로 받는다.
 * Worker 요청 크기 제한(100MB)과 메모리에 걸리기 때문이다. Worker 는 "누가 어디에 올려도 되는지"를
 * 판단하고 **짧은 유효시간의 주소만** 내어 준다.
 *
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 *
 * ※ 다른 앱(단열재 나누기도·공지사항·App Market)과 완전히 분리된 신규 라우트다.
 */
import { Hono } from "hono";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, storageDelete, storageSignedUrl, errMsg } from "./supabaseClient";

const forms = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** 코드표를 바꾸거나 현장을 지울 수 있는 본사 관리자 */
const ADMIN_ROLES = new Set(["super_admin", "system_admin"]);

/**
 * 파일을 담는 버킷. `Env` 에 칸을 더하지 않고 여기서 읽는다 — `auth.ts` 는 지금 사용자가
 * 손보는 중인 파일이라 건드리지 않는다. 설정이 없으면 기본값을 쓴다.
 */
const bucket = (env: Env) => (env as { FORM_FILES_BUCKET?: string }).FORM_FILES_BUCKET || "form-files";

/** 목록에서는 무거운 것(격자·적은 글자)을 빼고 꼬리표만 보낸다. 145종을 한 번에 읽기 때문이다. */
const LIST_COLUMNS =
  "id,kind,site_id,taxonomy_id,code,title,file_name,attachment,file_size,content_type," +
  "parser_version,template_id,template_uploaded_at,batch_id,uploaded_by,uploader_name," +
  "review_status,reviewer_name,reviewed_at,review_note,created_at,updated_at";

const isAdmin = (user: SessionUser) => ADMIN_ROLES.has(user.role);

/**
 * 지금 누가 부르고 있나.
 *
 * `authMiddleware` 는 **로컬 개발(`COOKIE_SECURE=false`)에서 로그인 검사를 건너뛴다.** 그때는
 * `c.get("user")` 가 비어 있어서, 그대로 쓰면 `user.id` 에서 터진다(운영에서는 늘 들어 있다).
 * 로컬에서만 쓰는 자리 표시 사용자를 대신 쓴다 — 여기서 막으면 로컬 개발이 아예 안 된다.
 */
function currentUser(c: { get: (key: "user") => SessionUser | undefined }): SessionUser {
  return (
    c.get("user") ?? { id: "local-dev", name: "로컬 개발", email: "local@dev", role: "system_admin" }
  );
}

/**
 * 파일이 놓일 자리.
 *
 * **경로에는 한글·공백·괄호를 쓸 수 없다.** Supabase Storage 가 `InvalidKey` 로 거절한다
 * (`600. 검측요청서(시험).txt` 로 시험하다 실제로 막혔다). 그래서 자리는 문서 id + 확장자로만
 * 짓고, 사람이 볼 이름(`file_name`)은 장부에 적어 둔다 — 내려받을 때 그 이름으로 내려간다.
 * 문서 id 로 폴더를 나누므로 이름이 같아도 서로 덮어쓰지 않는다.
 */
function objectPath(kind: string, id: string, fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]{1,10})$/);
  const extension = match ? `.${match[1].toLowerCase()}` : "";
  return `${kind}/${id}/file${extension}`;
}

/**
 * 올리기용 짧은 유효시간 주소. 브라우저가 이 주소로 파일을 **직접** 올린다.
 * (Supabase: POST /storage/v1/object/upload/sign/{bucket}/{path} → token)
 */
async function signedUploadUrl(env: Env, path: string): Promise<{ url: string; token: string }> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  /*
   * **덮어쓰기를 켠다.** 같은 서류를 다시 올릴 때(따라 올리기와 "빠진 것 다시 올리기"가 겹칠 때)
   * 파일 자리가 이미 있으면 `KeyAlreadyExists(409)` 로 거절당해 올리기가 통째로 실패했다.
   * 같은 서류의 같은 자리이므로 덮어쓰는 것이 맞다.
   */
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket(env)}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body: JSON.stringify({ upsert: true }),
  });
  if (!res.ok) throw new Error(`올리기 주소 발급 실패 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { url?: string; token?: string };
  if (!data.token) throw new Error("올리기 주소에 token 이 없습니다.");
  return { url: `${env.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket(env)}/${path}`, token: data.token };
}

/**
 * 화면이 만든 id 를 **그대로** 쓸 수 있으면 쓴다.
 *
 * 브라우저에 쌓아 둔 자료를 서버로 옮길 때, 서버가 새 id 를 발급하면 "이 서류는 어느 현장 것"
 * 같은 연결이 전부 끊어진다. 화면은 처음부터 표준 UUID(`crypto.randomUUID()`)를 쓰므로
 * 그대로 받아 주면 연결이 살아 있다. 모양이 UUID 가 아니면 무시하고 DB 가 새로 만든다.
 */
const uuidOrNull = (value: unknown): string | undefined =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;

/** PostgREST 응답 하나를 꺼낸다. 없으면 null. */
async function firstRow<T>(res: Response): Promise<T | null> {
  const rows = (await res.json()) as T[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// ── 나는 누구인가 · 본사 관리자 명단 ─────────────────────────────────────────

/**
 * 본사 관리자인가.
 *
 * 2026-09-11 에 정한 규칙(`20260911000001_form_taxonomy.sql`)을 그대로 따른다 —
 * **로그인 등급이 최고·시스템 관리자이거나, 본사 관리자 명단에 이메일이 있으면** 본사다.
 * 등급은 회사 공용 로그인 시스템(DCR)이 정하는 것이라 여기서 바꿀 수 없다. 그래서 명단이 있다.
 */
async function isHqAdmin(env: Env, user: SessionUser): Promise<boolean> {
  if (isAdmin(user)) return true;
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return false;
  try {
    const res = await supabaseRest(
      env,
      "GET",
      `/form_admins?select=email&email=eq.${encodeURIComponent(email)}&limit=1`,
    );
    if (!res.ok) return false;
    return (await firstRow<{ email: string }>(res)) !== null;
  } catch (err) {
    // 명단을 못 읽었다고 등급까지 부정하지는 않는다. 다만 명단 덕에 얻는 권한은 주지 않는다.
    console.error("[forms/admins 조회]", errMsg(err));
    return false;
  }
}

/**
 * GET /api/forms/me — 지금 로그인한 사람과 **본사 관리자인지**.
 * 화면은 이 답으로 [배포 양식함]·[본사 점검] 탭을 보일지 정한다.
 */
forms.get("/me", async (c) => {
  const user = currentUser(c);
  const admin = await isHqAdmin(c.env, user);
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    admin,
    // 등급으로 얻은 권한인지(명단에서 뺄 수 없다), 명단으로 얻은 권한인지 구분해 보여 준다.
    byRole: isAdmin(user),
  });
});

/** GET /api/forms/admins — 본사 관리자 명단(본사만) */
forms.get("/admins", async (c) => {
  const user = currentUser(c);
  if (!(await isHqAdmin(c.env, user))) return c.json({ error: "본사 관리자만 볼 수 있습니다." }, 403);
  try {
    const res = await supabaseRest(c.env, "GET", "/form_admins?select=*&order=added_at.asc");
    if (!res.ok) throw new Error(await res.text());
    return c.json({ admins: await res.json() });
  } catch (err) {
    console.error("[forms/admins GET]", errMsg(err));
    return c.json({ error: "명단을 읽지 못했습니다." }, 500);
  }
});

/** POST /api/forms/admins — 명단에 한 사람 더하기(본사만) */
forms.post("/admins", async (c) => {
  const user = currentUser(c);
  if (!(await isHqAdmin(c.env, user))) return c.json({ error: "본사 관리자만 바꿀 수 있습니다." }, 403);
  try {
    const body = (await c.req.json()) as { email?: string; name?: string };
    // 대소문자 차이로 명단에서 빠지지 않게 소문자로 맞춰 넣는다(표 주석의 약속).
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "이메일을 바르게 적어 주세요." }, 400);

    const res = await supabaseRest(
      c.env,
      "POST",
      "/form_admins",
      { email, name: String(body.name ?? "").trim() || null, added_by: user.email },
      "return=representation,resolution=merge-duplicates",
    );
    if (!res.ok) throw new Error(await res.text());
    return c.json({ admin: await firstRow(res) });
  } catch (err) {
    console.error("[forms/admins POST]", errMsg(err));
    return c.json({ error: "명단에 넣지 못했습니다." }, 500);
  }
});

/** DELETE /api/forms/admins/:email — 명단에서 빼기(본사만) */
forms.delete("/admins/:email", async (c) => {
  const user = currentUser(c);
  if (!(await isHqAdmin(c.env, user))) return c.json({ error: "본사 관리자만 바꿀 수 있습니다." }, 403);
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  // 자기 자신을 빼면 그 자리에서 권한을 잃는다. 실수로 아무도 못 들어가는 상태가 되지 않게 막는다.
  if (email === String(user.email ?? "").toLowerCase() && !isAdmin(user)) {
    return c.json({ error: "자기 자신은 뺄 수 없습니다. 다른 본사 관리자에게 부탁하세요." }, 400);
  }
  try {
    const res = await supabaseRest(c.env, "DELETE", `/form_admins?email=eq.${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error(await res.text());
    return c.json({ ok: true });
  } catch (err) {
    console.error("[forms/admins DELETE]", errMsg(err));
    return c.json({ error: "명단에서 빼지 못했습니다." }, 500);
  }
});

// ── 오류·개선 의견 ──────────────────────────────────────────────────────────

/** GET /api/forms/feedback — 의견 목록. **모든 직원이 본다**(같은 불편을 따로 적지 않게). */
forms.get("/feedback", async (c) => {
  try {
    const res = await supabaseRest(c.env, "GET", "/form_feedback?select=*&order=created_at.desc");
    if (!res.ok) throw new Error(await res.text());
    return c.json({ feedback: await res.json() });
  } catch (err) {
    console.error("[forms/feedback GET]", errMsg(err));
    return c.json({ error: "의견을 읽지 못했습니다." }, 500);
  }
});

/** POST /api/forms/feedback — 의견 올리기(누구나) */
forms.post("/feedback", async (c) => {
  try {
    const body = (await c.req.json()) as { kind?: string; title?: string; body?: string; whereAt?: string };
    const title = String(body.title ?? "").trim();
    if (!title) return c.json({ error: "제목을 적어 주세요." }, 400);

    const user = currentUser(c);
    const res = await supabaseRest(c.env, "POST", "/form_feedback", {
      kind: body.kind === "idea" ? "idea" : "bug",
      title,
      body: String(body.body ?? "").trim(),
      where_at: String(body.whereAt ?? "").trim() || null,
      // 올린 사람은 **로그인 정보로** 적는다. 화면이 보낸 이름을 믿으면 남의 이름으로 올릴 수 있다.
      author_id: user.id,
      author_name: user.name,
      author_email: user.email,
    });
    if (!res.ok) throw new Error(await res.text());
    return c.json({ item: await firstRow(res) }, 201);
  } catch (err) {
    console.error("[forms/feedback POST]", errMsg(err));
    return c.json({ error: "의견을 올리지 못했습니다." }, 500);
  }
});

/**
 * PATCH /api/forms/feedback/:id — 고치기.
 * 글쓴이는 **자기 글의 내용만**, 본사는 **상태와 답**을 적는다.
 */
forms.patch("/feedback/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const user = currentUser(c);
    const admin = await isHqAdmin(c.env, user);
    const found = await supabaseRest(c.env, "GET", `/form_feedback?select=*&id=eq.${id}&limit=1`);
    const row = found.ok ? await firstRow<{ author_email?: string }>(found) : null;
    if (!row) return c.json({ error: "그 의견을 찾지 못했습니다." }, 404);

    const mine = String(row.author_email ?? "").toLowerCase() === String(user.email ?? "").toLowerCase();
    const body = (await c.req.json()) as {
      kind?: string;
      title?: string;
      body?: string;
      whereAt?: string;
      status?: string;
      reply?: string;
    };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (mine) {
      if (body.kind !== undefined) patch.kind = body.kind === "idea" ? "idea" : "bug";
      if (body.title !== undefined) patch.title = String(body.title).trim();
      if (body.body !== undefined) patch.body = String(body.body).trim();
      if (body.whereAt !== undefined) patch.where_at = String(body.whereAt).trim() || null;
    }
    if (admin) {
      if (body.status !== undefined && ["open", "doing", "done", "wont"].includes(body.status)) {
        patch.status = body.status;
      }
      if (body.reply !== undefined) {
        patch.reply = String(body.reply).trim() || null;
        patch.replied_by = user.name || user.email;
        patch.replied_at = new Date().toISOString();
      }
    }
    if (Object.keys(patch).length === 1) {
      return c.json({ error: "고칠 수 있는 것이 없습니다(내 글의 내용, 또는 본사의 상태·답)." }, 403);
    }

    const res = await supabaseRest(c.env, "PATCH", `/form_feedback?id=eq.${id}`, patch);
    if (!res.ok) throw new Error(await res.text());
    return c.json({ item: await firstRow(res) });
  } catch (err) {
    console.error("[forms/feedback PATCH]", errMsg(err));
    return c.json({ error: "의견을 고치지 못했습니다." }, 500);
  }
});

/** DELETE /api/forms/feedback/:id — 글쓴이 또는 본사만 지운다. */
forms.delete("/feedback/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const user = currentUser(c);
    const found = await supabaseRest(c.env, "GET", `/form_feedback?select=author_email&id=eq.${id}&limit=1`);
    const row = found.ok ? await firstRow<{ author_email?: string }>(found) : null;
    if (!row) return c.json({ ok: true }); // 이미 없다 — 지우려던 뜻은 이뤄졌다
    const mine = String(row.author_email ?? "").toLowerCase() === String(user.email ?? "").toLowerCase();
    if (!mine && !(await isHqAdmin(c.env, user))) {
      return c.json({ error: "내가 올린 의견만 지울 수 있습니다." }, 403);
    }
    const res = await supabaseRest(c.env, "DELETE", `/form_feedback?id=eq.${id}`);
    if (!res.ok) throw new Error(await res.text());
    return c.json({ ok: true });
  } catch (err) {
    console.error("[forms/feedback DELETE]", errMsg(err));
    return c.json({ error: "의견을 지우지 못했습니다." }, 500);
  }
});

// ── 현장 ────────────────────────────────────────────────────────────────────

/** GET /api/forms/sites — 현장 목록 */
forms.get("/sites", async (c) => {
  try {
    const res = await supabaseRest(c.env, "GET", "/form_sites?select=*&order=sort_order.asc,name.asc");
    if (!res.ok) throw new Error(await res.text());
    return c.json({ sites: await res.json() });
  } catch (err) {
    console.error("[forms/sites GET]", errMsg(err));
    return c.json({ error: "현장 목록을 읽지 못했습니다." }, 500);
  }
});

/** POST /api/forms/sites — 현장 추가 */
forms.post("/sites", async (c) => {
  try {
    const body = (await c.req.json()) as {
      id?: string;
      name?: string;
      sortOrder?: number;
      members?: unknown;
      lineDefaults?: unknown;
      qmpSettings?: unknown;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: "현장 이름을 적어 주세요." }, 400);

    const user = currentUser(c);
    const row: Record<string, unknown> = {
      ...(uuidOrNull(body.id) ? { id: uuidOrNull(body.id) } : {}),
      name,
      sort_order: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
      members: Array.isArray(body.members) ? body.members : [],
      line_defaults: body.lineDefaults && typeof body.lineDefaults === "object" ? body.lineDefaults : {},
      created_by: user.id,
    };
    if (body.qmpSettings && typeof body.qmpSettings === "object") row.qmp_settings = body.qmpSettings;
    let res = await supabaseRest(c.env, "POST", "/form_sites", row);
    // 계획서 설정 칸(`qmp_settings`, 2026-10-15)은 운영 표에 나중에 더한다. 칸이 아직 없으면 그것만 빼고 저장한다.
    if (!res.ok && "qmp_settings" in row) {
      const text = await res.clone().text();
      if (/qmp_settings/.test(text)) {
        const { qmp_settings: _skipped, ...rest } = row;
        res = await supabaseRest(c.env, "POST", "/form_sites", rest);
      }
    }
    // 같은 이름의 현장이 이미 있으면 그것을 돌려준다 — 두 개가 생기면 서류가 갈린다.
    if (res.status === 409) {
      const found = await supabaseRest(c.env, "GET", `/form_sites?name=eq.${encodeURIComponent(name)}&select=*`);
      return c.json({ site: await firstRow(found), existed: true });
    }
    if (!res.ok) throw new Error(await res.text());
    return c.json({ site: await firstRow(res) }, 201);
  } catch (err) {
    console.error("[forms/sites POST]", errMsg(err));
    return c.json({ error: "현장을 만들지 못했습니다." }, 500);
  }
});

/**
 * PATCH /api/forms/sites/:id — 현장 조직·기본 결재선·이름을 바꾼다.
 *
 * 조직(결재선에서 고를 사람 명단)은 현장에서 자주 손본다. 브라우저에만 있으면 다른 PC 에서
 * 결재선을 지정할 때 명단이 비어 있다.
 */
forms.patch("/sites/:id", async (c) => {
  try {
    const body = (await c.req.json()) as {
      name?: string;
      members?: unknown;
      lineDefaults?: unknown;
      sortOrder?: number;
      qmpSettings?: unknown;
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.qmpSettings !== undefined) patch.qmp_settings = body.qmpSettings ?? {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.members !== undefined) patch.members = Array.isArray(body.members) ? body.members : [];
    if (body.lineDefaults !== undefined) patch.line_defaults = body.lineDefaults ?? {};
    if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;

    const target = `/form_sites?id=eq.${encodeURIComponent(c.req.param("id"))}`;
    let res = await supabaseRest(c.env, "PATCH", target, patch);
    // 계획서 설정 칸이 아직 없는 운영 표에서도 다른 저장은 되게 그 칸만 빼고 다시 보낸다.
    if (!res.ok && "qmp_settings" in patch) {
      const text = await res.clone().text();
      if (/qmp_settings/.test(text)) {
        const { qmp_settings: _skipped, ...rest } = patch;
        res = await supabaseRest(c.env, "PATCH", target, rest);
      }
    }
    if (!res.ok) throw new Error(await res.text());
    const site = await firstRow(res);
    if (!site) return c.json({ error: "그 현장을 찾지 못했습니다." }, 404);
    return c.json({ site });
  } catch (err) {
    console.error("[forms/sites PATCH]", errMsg(err));
    return c.json({ error: "현장을 저장하지 못했습니다." }, 500);
  }
});

// ── 코드표 ──────────────────────────────────────────────────────────────────

/** GET /api/forms/taxonomy — 서류 분류 코드표(전 직원 공용) */
forms.get("/taxonomy", async (c) => {
  try {
    const res = await supabaseRest(c.env, "GET", "/form_taxonomy?select=*&order=sort_order.asc,division.asc");
    if (!res.ok) throw new Error(await res.text());
    return c.json({ taxonomies: await res.json() });
  } catch (err) {
    console.error("[forms/taxonomy GET]", errMsg(err));
    return c.json({ error: "코드표를 읽지 못했습니다." }, 500);
  }
});

/**
 * PUT /api/forms/taxonomy — 코드표 올리기(로그인한 누구나).
 * 바꾸기 전 것은 이력에 쌓아 둔다 — 잘못 올렸을 때 되돌릴 수 있어야 한다.
 *
 * 예전에는 등급(최고·시스템 관리자)만 됐다. 본사 관리자 명단에 든 사람도 막혀 불편하다고
 * 사용자가 제약을 없앴다(2026-10-13). 누가 바꿨는지는 이력의 `replaced_by` 에 남는다.
 */
forms.put("/taxonomy", async (c) => {
  const user = currentUser(c);
  try {
    const body = (await c.req.json()) as {
      id?: string;
      division?: string;
      fileName?: string;
      groups?: unknown;
      conflicts?: unknown;
      sortOrder?: number;
    };
    const id = String(body.id ?? "").trim();
    if (!id || !Array.isArray(body.groups)) return c.json({ error: "코드표 내용이 올바르지 않습니다." }, 400);

    const before = await supabaseRest(c.env, "GET", `/form_taxonomy?id=eq.${encodeURIComponent(id)}&select=*`);
    const previous = before.ok ? await firstRow<Record<string, unknown>>(before) : null;
    if (previous) {
      await supabaseRest(c.env, "POST", "/form_taxonomy_history", {
        taxonomy_id: id,
        division: previous.division ?? "",
        file_name: previous.file_name ?? "",
        groups: previous.groups ?? [],
        conflicts: previous.conflicts ?? [],
        replaced_by: user.id,
      });
    }

    /*
     * 같은 1차 분류 이름이 **다른 번호로** 이미 있으면, 그 줄을 고친다.
     *
     * 코드표는 회사 공용이라 이름(공무관련·품질관련)이 곧 그 코드표다. 사람마다 브라우저에서
     * 만든 번호가 달라, 그대로 넣으면 `uq_form_taxonomy_division` 에 걸려 거절당한다(실제로 그랬다).
     * 이때는 **서버에 있던 번호를 그대로 두고 내용만 갱신**한 뒤, 그 줄을 돌려준다 — 화면이
     * 그 번호를 받아 자기 것을 맞춘다(`adoptTaxonomyId`).
     */
    const division = String(body.division ?? "");
    if (division) {
      const sameName = await supabaseRest(
        c.env,
        "GET",
        `/form_taxonomy?division=eq.${encodeURIComponent(division)}&scope=eq.company&select=id`,
      );
      const found = sameName.ok ? await firstRow<{ id: string }>(sameName) : null;
      if (found && found.id !== id) {
        const updated = await supabaseRest(c.env, "PATCH", `/form_taxonomy?id=eq.${encodeURIComponent(found.id)}`, {
          file_name: String(body.fileName ?? ""),
          groups: body.groups,
          conflicts: body.conflicts ?? [],
          sort_order: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        });
        if (!updated.ok) throw new Error(await updated.text());
        return c.json({ taxonomy: await firstRow(updated), adopted: true });
      }
    }

    const res = await supabaseRest(
      c.env,
      "POST",
      "/form_taxonomy",
      {
        id,
        division,
        file_name: String(body.fileName ?? ""),
        groups: body.groups,
        conflicts: body.conflicts ?? [],
        sort_order: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      "resolution=merge-duplicates,return=representation",
    );
    if (!res.ok) throw new Error(await res.text());
    return c.json({ taxonomy: await firstRow(res) });
  } catch (err) {
    console.error("[forms/taxonomy PUT]", errMsg(err));
    return c.json({ error: "코드표를 저장하지 못했습니다." }, 500);
  }
});

/**
 * DELETE /api/forms/taxonomy/:id — 코드표 지우기(로그인한 누구나 — 위 PUT 과 같은 이유).
 *
 * 화면이 서버 코드표를 받아 오므로, 서버에서 지우지 않으면 다음에 열 때 되살아난다.
 * 지우기 전 것은 이력에 쌓는다. 그 코드표의 서류는 지우지 않는다 — 외래키가 코드표 번호만
 * 비워(`on delete set null`) "코드 없는 서류"가 된다.
 */
forms.delete("/taxonomy/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  try {
    const before = await supabaseRest(c.env, "GET", `/form_taxonomy?id=eq.${encodeURIComponent(id)}&select=*`);
    const previous = before.ok ? await firstRow<Record<string, unknown>>(before) : null;
    if (!previous) return c.json({ ok: true });
    const history = await supabaseRest(c.env, "POST", "/form_taxonomy_history", {
      taxonomy_id: id,
      division: previous.division ?? "",
      file_name: previous.file_name ?? "",
      groups: previous.groups ?? [],
      conflicts: previous.conflicts ?? [],
      replaced_by: user.id,
    });
    // 이력을 못 남기면 지우지 않는다 — 되돌릴 길이 없어진다.
    if (!history.ok) throw new Error(await history.text());
    const res = await supabaseRest(c.env, "DELETE", `/form_taxonomy?id=eq.${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(await res.text());
    return c.json({ ok: true });
  } catch (err) {
    console.error("[forms/taxonomy DELETE]", errMsg(err));
    return c.json({ error: "코드표를 지우지 못했습니다." }, 500);
  }
});

// ── 서류 ────────────────────────────────────────────────────────────────────

/**
 * GET /api/forms/docs — 목록(꼬리표만).
 * `?kind=template` 배포 양식함 · `?siteId=...` 그 현장 서류함 · `?review=1` 본사 점검함
 */
forms.get("/docs", async (c) => {
  try {
    const kind = c.req.query("kind");
    const siteId = c.req.query("siteId");
    const review = c.req.query("review");

    const where: string[] = [];
    if (kind === "template" || kind === "site") where.push(`kind=eq.${kind}`);
    if (siteId) where.push(`site_id=eq.${encodeURIComponent(siteId)}`);
    if (review === "1") where.push("review_status=neq.none");

    const path =
      `/form_documents?select=${LIST_COLUMNS}` +
      (where.length > 0 ? `&${where.join("&")}` : "") +
      "&order=updated_at.desc";
    const res = await supabaseRest(c.env, "GET", path);
    if (!res.ok) throw new Error(await res.text());
    return c.json({ docs: await res.json() });
  } catch (err) {
    console.error("[forms/docs GET]", errMsg(err));
    return c.json({ error: "서류 목록을 읽지 못했습니다." }, 500);
  }
});

/** GET /api/forms/docs/:id — 한 건 전부(격자·적은 글자·결재 포함) */
forms.get("/docs/:id", async (c) => {
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/form_documents?id=eq.${encodeURIComponent(c.req.param("id"))}&select=*`,
    );
    if (!res.ok) throw new Error(await res.text());
    const doc = await firstRow(res);
    if (!doc) return c.json({ error: "그 서류를 찾지 못했습니다." }, 404);
    return c.json({ doc });
  } catch (err) {
    console.error("[forms/docs/:id GET]", errMsg(err));
    return c.json({ error: "서류를 읽지 못했습니다." }, 500);
  }
});

/**
 * POST /api/forms/docs — 서류 1건을 만들고 **올리기 주소**를 함께 내어 준다.
 *
 * 순서: ① 여기서 꼬리표를 만들고 주소를 받는다 → ② 브라우저가 그 주소로 파일을 직접 올린다
 *       → ③ `/docs/:id/uploaded` 로 "다 올렸다"고 알린다.
 * 2단계로 나누는 이유는 파일 바이트가 Worker 를 지나가지 않게 하기 위해서다.
 */
forms.post("/docs", async (c) => {
  try {
    const user = currentUser(c);
    const body = (await c.req.json()) as {
      id?: string;
      kind?: string;
      siteId?: string | null;
      taxonomyId?: string | null;
      code?: string | null;
      title?: string;
      fileName?: string;
      attachment?: boolean;
      contentType?: string | null;
      sheets?: unknown;
      parserVersion?: number;
      templateId?: string | null;
      templateUploadedAt?: string | null;
      batchId?: string | null;
    };

    const kind = body.kind === "site" ? "site" : "template";
    const fileName = String(body.fileName ?? "").trim();
    if (!fileName) return c.json({ error: "파일 이름이 없습니다." }, 400);
    if (kind === "site" && !body.siteId) return c.json({ error: "어느 현장의 서류인지 없습니다." }, 400);

    const res = await supabaseRest(c.env, "POST", "/form_documents", {
      ...(uuidOrNull(body.id) ? { id: uuidOrNull(body.id) } : {}),
      kind,
      site_id: kind === "site" ? body.siteId : null,
      taxonomy_id: body.taxonomyId ?? null,
      code: body.code ?? null,
      title: String(body.title ?? fileName.replace(/\.[^.\\/]+$/, "")),
      file_name: fileName,
      attachment: body.attachment === true,
      content_type: body.contentType ?? null,
      sheets: body.sheets ?? null,
      parser_version: Number.isFinite(body.parserVersion) ? Number(body.parserVersion) : null,
      template_id: body.templateId ?? null,
      template_uploaded_at: body.templateUploadedAt ?? null,
      batch_id: body.batchId ?? null,
      uploaded_by: user.id,
      uploader_name: user.name,
      file_bucket: bucket(c.env),
    });
    /*
     * **같은 번호로 두 번 와도 받아 준다.**
     *
     * 화면은 저장하면서 서버에 따라 올리고(`syncUpload`), 빠진 것을 찾아 다시 올리는 길도 있다
     * (`formMigrate`). 두 길이 같은 서류를 거의 동시에 올리면 뒤엣것이 `duplicate key` 로 터졌고,
     * 화면에는 "올리지 못했습니다"로 보였다(실제로 운영 기록에 500 이 남았다).
     * 이미 있는 것은 **있는 그대로 돌려준다** — 올리려던 뜻은 이미 이뤄졌다.
     */
    let doc = await firstRow<{ id: string }>(res.ok ? res : new Response("[]"));
    if (!res.ok) {
      const text = await res.text();
      const already = /23505|duplicate key/.test(text) && uuidOrNull(body.id);
      if (!already) throw new Error(text);
      const found = await supabaseRest(c.env, "GET", `/form_documents?select=*&id=eq.${uuidOrNull(body.id)}&limit=1`);
      doc = found.ok ? await firstRow<{ id: string }>(found) : null;
      if (!doc) throw new Error(text);
    }
    if (!doc) throw new Error("서류를 만들었지만 결과가 비어 있습니다.");

    const path = objectPath(kind, doc.id, fileName);
    const upload = await signedUploadUrl(c.env, path);
    await supabaseRest(c.env, "PATCH", `/form_documents?id=eq.${doc.id}`, { file_path: path }, "return=minimal");

    return c.json({ doc: { ...doc, file_path: path }, upload }, 201);
  } catch (err) {
    console.error("[forms/docs POST]", errMsg(err));
    return c.json({ error: "서류를 만들지 못했습니다." }, 500);
  }
});

/** POST /api/forms/docs/:id/uploaded — 파일을 다 올렸다고 알린다(크기 기록) */
forms.post("/docs/:id/uploaded", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { fileSize?: number };
    const res = await supabaseRest(
      c.env,
      "PATCH",
      `/form_documents?id=eq.${encodeURIComponent(c.req.param("id"))}`,
      {
        file_size: Number.isFinite(body.fileSize) ? Number(body.fileSize) : null,
        updated_at: new Date().toISOString(),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return c.json({ doc: await firstRow(res) });
  } catch (err) {
    console.error("[forms/docs/uploaded]", errMsg(err));
    return c.json({ error: "올린 파일을 기록하지 못했습니다." }, 500);
  }
});

/**
 * PATCH /api/forms/docs/:id — 적은 글자·결재·점검을 갱신한다.
 * 보낸 것만 바꾼다 — 화면이 일부만 저장하는 일이 잦다(칸 하나 고치기 등).
 */
forms.patch("/docs/:id", async (c) => {
  try {
    const user = currentUser(c);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) patch.title = String(body.title);
    if (body.cellValues !== undefined) patch.cell_values = body.cellValues;
    if (body.customSheets !== undefined) patch.custom_sheets = body.customSheets;
    if (body.extraRows !== undefined) patch.extra_rows = body.extraRows;
    if (body.approvalLines !== undefined) patch.approval_lines = body.approvalLines;
    if (body.approvals !== undefined) patch.approvals = body.approvals;
    if (body.sheetDepts !== undefined) patch.sheet_depts = body.sheetDepts;
    if (body.sheetEditedAt !== undefined) patch.sheet_edited_at = body.sheetEditedAt;
    if (body.sheets !== undefined) patch.sheets = body.sheets;
    if (body.parserVersion !== undefined) patch.parser_version = Number(body.parserVersion);
    if (body.taxonomyId !== undefined) patch.taxonomy_id = body.taxonomyId;
    if (body.code !== undefined) patch.code = body.code;

    // 본사 점검 — 누가 언제 보았는지는 **서버가** 적는다. 화면이 보내 주는 값을 믿지 않는다.
    if (body.reviewStatus !== undefined) {
      const status = String(body.reviewStatus);
      if (!["none", "requested", "ok", "fix"].includes(status)) {
        return c.json({ error: "점검 상태 값이 올바르지 않습니다." }, 400);
      }
      patch.review_status = status;
      patch.review_note = body.reviewNote === undefined ? null : String(body.reviewNote ?? "");
      if (status === "ok" || status === "fix") {
        patch.reviewed_by = user.id;
        patch.reviewer_name = user.name;
        patch.reviewed_at = new Date().toISOString();
      }
    }

    const target = `/form_documents?id=eq.${encodeURIComponent(c.req.param("id"))}`;
    let res = await supabaseRest(c.env, "PATCH", target, patch);
    /*
     * 작성 부서(`sheet_depts`, 2026-10-13)·장마다 고친 때(`sheet_edited_at`, 2026-10-15) 칸은 운영 표에
     * 나중에 더한다. 칸이 아직 없는 서버에 이 판이 먼저 올라가도 **다른 저장은 막히지 않게** 없는 칸만
     * 빼고 다시 보낸다.
     */
    const optional = ["sheet_depts", "sheet_edited_at"];
    for (let tries = 0; !res.ok && tries < optional.length; tries += 1) {
      const text = await res.text();
      const missing = optional.find((name) => name in patch && text.includes(name));
      if (!missing) throw new Error(text);
      delete patch[missing];
      res = await supabaseRest(c.env, "PATCH", target, patch);
    }
    if (!res.ok) throw new Error(await res.text());
    const doc = await firstRow(res);
    if (!doc) return c.json({ error: "그 서류를 찾지 못했습니다." }, 404);
    return c.json({ doc });
  } catch (err) {
    console.error("[forms/docs PATCH]", errMsg(err));
    return c.json({ error: "서류를 저장하지 못했습니다." }, 500);
  }
});

/** GET /api/forms/docs/:id/file — 내려받기용 짧은 유효시간 주소(기본 5분) */
forms.get("/docs/:id/file", async (c) => {
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/form_documents?id=eq.${encodeURIComponent(c.req.param("id"))}&select=file_bucket,file_path,file_name`,
    );
    if (!res.ok) throw new Error(await res.text());
    const doc = await firstRow<{ file_bucket?: string; file_path?: string; file_name: string }>(res);
    if (!doc) return c.json({ error: "그 서류를 찾지 못했습니다." }, 404);
    if (!doc.file_path) return c.json({ error: "아직 파일이 올라오지 않았습니다." }, 404);

    // 주소는 **짧게** 살아 있어야 한다. 새어 나가도 오래 쓰이지 않게.
    const signed = await storageSignedUrl(c.env, doc.file_bucket || bucket(c.env), doc.file_path, 300);
    // 저장된 자리 이름은 `file.xlsx` 다. 내려받을 때는 사람이 아는 이름으로 내려가야 한다.
    const url = `${signed}${signed.includes("?") ? "&" : "?"}download=${encodeURIComponent(doc.file_name)}`;
    return c.json({ url, fileName: doc.file_name });
  } catch (err) {
    console.error("[forms/docs/file]", errMsg(err));
    return c.json({ error: "내려받기 주소를 만들지 못했습니다." }, 500);
  }
});

/** DELETE /api/forms/docs/:id — 서류와 그 파일을 지운다(올린 사람 또는 본사 관리자) */
forms.delete("/docs/:id", async (c) => {
  try {
    const user = currentUser(c);
    const id = encodeURIComponent(c.req.param("id"));
    const found = await supabaseRest(c.env, "GET", `/form_documents?id=eq.${id}&select=uploaded_by,file_bucket,file_path`);
    if (!found.ok) throw new Error(await found.text());
    const doc = await firstRow<{ uploaded_by?: string; file_bucket?: string; file_path?: string }>(found);
    if (!doc) return c.json({ error: "그 서류를 찾지 못했습니다." }, 404);
    if (doc.uploaded_by !== user.id && !isAdmin(user)) {
      return c.json({ error: "올린 사람 또는 본사 관리자만 지울 수 있습니다." }, 403);
    }

    const res = await supabaseRest(c.env, "DELETE", `/form_documents?id=eq.${id}`, undefined, "return=minimal");
    if (!res.ok) throw new Error(await res.text());
    // 표에서 지운 뒤 파일을 지운다. 순서가 반대면 파일만 사라지고 목록에 남는다.
    if (doc.file_path) {
      await storageDelete(c.env, doc.file_bucket || bucket(c.env), [doc.file_path]).catch((err) =>
        console.error("[forms/docs DELETE] 파일 삭제 실패", errMsg(err)),
      );
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("[forms/docs DELETE]", errMsg(err));
    return c.json({ error: "서류를 지우지 못했습니다." }, 500);
  }
});

export default forms;
