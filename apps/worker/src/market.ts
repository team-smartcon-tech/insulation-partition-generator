/**
 * App Market — 홈(런처)에 게시되는 외부 도구 카탈로그 API
 *
 * 테이블: public.market_apps / market_app_versions / market_app_likes
 *         (supabase/migrations/20260811000001_market_apps.sql)
 * 스크린샷: Storage {MARKET_SHOT_BUCKET}/market/{appId}/{uuid}.{ext} (비공개 → signed URL)
 *
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 *       게시/수정/삭제는 관리자(super_admin·system_admin)만.
 *
 * ※ 단열재 나누기도(/api/elevation-projects*)와 완전히 분리된 신규 라우트다.
 */
import { Hono } from "hono";
import type { Env, SessionUser } from "./auth";
import {
  supabaseRest,
  supabaseRpc,
  storageUpload,
  storageDelete,
  storageSignedUrl,
  errMsg,
} from "./supabaseClient";

const market = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** 게시·수정·삭제 권한 role */
const ADMIN_ROLES = new Set(["super_admin", "system_admin"]);

const shotBucket = (env: Env) => env.MARKET_SHOT_BUCKET || "market-shots";

/** 스크린샷 1장 제한 (버킷 file_size_limit 과 동일) */
const MAX_SHOT_BYTES = 10 * 1024 * 1024;
const MAX_SHOT_COUNT = 8;
const ALLOWED_SHOT_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const APP_COLUMNS =
  "id,title,description,deploy_url,repo_url,platform_type,location,category,version," +
  "team,owners,tags,screenshots,status,view_count,like_count,author_id,author_name," +
  "created_at,updated_at";

interface ShotRef {
  bucket: string;
  path: string;
  name: string;
  size: number;
  mime: string;
}

interface AppRow {
  id: string;
  screenshots: ShotRef[] | null;
  [key: string]: unknown;
}

const isAdmin = (user: SessionUser | undefined) => !!user && ADMIN_ROLES.has(user.role);

const adminOnly = (c: { get: (k: "user") => SessionUser | undefined }) =>
  isAdmin(c.get("user"));

/** http(s) 주소만 허용 — javascript: 등 스킴 차단 */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/** form 필드 → 문자열(빈 값은 null) */
function formText(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value : null;
}

/** form 필드(JSON 배열 문자열) → 문자열 배열 */
function formStringArray(form: FormData, key: string): string[] {
  const raw = form.get(key);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

/** 파일명에서 확장자만 안전하게 추출 */
function extOf(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

/** screenshots(JSON) → signed URL 목록. 실패한 항목은 조용히 건너뛴다(카드가 깨지지 않도록). */
async function signShots(env: Env, shots: ShotRef[] | null | undefined, limit?: number) {
  const list = Array.isArray(shots) ? shots.slice(0, limit ?? shots.length) : [];
  const signed = await Promise.all(
    list.map(async (shot) => {
      try {
        const url = await storageSignedUrl(env, shot.bucket || "market-shots", shot.path);
        return { url, name: shot.name, mime: shot.mime };
      } catch (err) {
        console.error("[market/sign]", errMsg(err));
        return null;
      }
    }),
  );
  return signed.filter((s): s is { url: string; name: string; mime: string } => s !== null);
}

/** 현재 사용자가 좋아요한 앱 id 집합 */
async function likedIdsFor(env: Env, userId: string, appIds: string[]): Promise<Set<string>> {
  if (appIds.length === 0) return new Set();
  const inList = appIds.map((id) => `"${id}"`).join(",");
  const res = await supabaseRest(
    env,
    "GET",
    `/market_app_likes?user_id=eq.${encodeURIComponent(userId)}&app_id=in.(${inList})&select=app_id`,
  );
  if (!res.ok) return new Set();
  const rows = (await res.json()) as { app_id: string }[];
  return new Set(rows.map((r) => r.app_id));
}

// ─── 목록 ───────────────────────────────────────────────────

/** GET /api/market/apps — 게시된 도구 목록 (홈 카드용) */
market.get("/apps", async (c) => {
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/market_apps?status=eq.published&select=${APP_COLUMNS}&order=created_at.desc`,
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("[market/apps GET]", errText);
      return c.json({ error: `조회 실패: ${errText}` }, res.status as 500);
    }
    const rows = (await res.json()) as AppRow[];
    const user = c.get("user");
    const liked = await likedIdsFor(c.env, user?.id ?? "", rows.map((r) => r.id));

    const apps = await Promise.all(
      rows.map(async (row) => {
        const [thumb] = await signShots(c.env, row.screenshots, 1);
        const { screenshots: _drop, ...rest } = row;
        return { ...rest, thumbnail_url: thumb?.url ?? null, liked: liked.has(row.id) };
      }),
    );
    return c.json({ apps, canPublish: isAdmin(user) });
  } catch (err) {
    console.error("[market/apps GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

// ─── 게시 ───────────────────────────────────────────────────

/**
 * POST /api/market/apps — 새 도구 게시 (관리자 전용, multipart/form-data)
 * 필드: title, deployUrl (필수) / repoUrl, platformType, location, category, version,
 *       team, description, owners(JSON), tags(JSON) / shots (File, 복수)
 */
market.post("/apps", async (c) => {
  if (!adminOnly(c)) return c.json({ error: "게시 권한이 없습니다." }, 403);

  const bucket = shotBucket(c.env);
  const uploaded: string[] = [];
  try {
    const form = await c.req.raw.formData();

    const title = formText(form, "title");
    if (!title) return c.json({ error: "제목을 입력하세요." }, 400);

    const deployUrl = normalizeUrl(form.get("deployUrl"));
    if (!deployUrl) {
      return c.json({ error: "배포 URL 은 http(s) 주소여야 합니다." }, 400);
    }
    const repoUrlRaw = formText(form, "repoUrl");
    if (repoUrlRaw && !normalizeUrl(repoUrlRaw)) {
      return c.json({ error: "레포 URL 은 http(s) 주소여야 합니다." }, 400);
    }

    const appId = crypto.randomUUID();

    // 스크린샷 업로드 — 첫 장이 목록 썸네일
    const shots: ShotRef[] = [];
    // workers-types 의 FormData 는 값 타입을 string 으로 선언하므로 typeof 로 파일을 가려낸다
    // (index.ts 의 DXF 업로드와 동일한 처리).
    const files = form
      .getAll("shots")
      .filter((entry) => !!entry && typeof entry !== "string") as unknown as File[];
    if (files.length > MAX_SHOT_COUNT) {
      return c.json({ error: `스크린샷은 최대 ${MAX_SHOT_COUNT}장까지 올릴 수 있습니다.` }, 400);
    }
    for (const file of files) {
      if (file.size === 0) continue;
      if (file.size > MAX_SHOT_BYTES) {
        return c.json({ error: `이미지 1장은 10MB 이하여야 합니다: ${file.name}` }, 413);
      }
      const mime = file.type || "image/png";
      if (!ALLOWED_SHOT_MIME.has(mime)) {
        return c.json({ error: `지원하지 않는 이미지 형식입니다: ${mime}` }, 415);
      }
      const objectPath = `market/${appId}/${crypto.randomUUID()}.${extOf(file.name, mime)}`;
      await storageUpload(c.env, bucket, objectPath, await file.arrayBuffer(), mime);
      uploaded.push(objectPath);
      shots.push({
        bucket,
        path: objectPath,
        name: file.name || "screenshot",
        size: file.size,
        mime,
      });
    }
    if (shots.length === 0) {
      return c.json({ error: "실제 실행 화면 스크린샷을 1장 이상 올려 주세요." }, 400);
    }

    const user = c.get("user");
    const version = formText(form, "version");
    const row = {
      id: appId,
      title,
      description: formText(form, "description"),
      deploy_url: deployUrl,
      repo_url: repoUrlRaw ? normalizeUrl(repoUrlRaw) : null,
      platform_type: formText(form, "platformType") ?? "웹앱",
      location: formText(form, "location") === "현장" ? "현장" : "본사",
      category: formText(form, "category") ?? "웹앱",
      version,
      team: formText(form, "team"),
      owners: formStringArray(form, "owners"),
      tags: formStringArray(form, "tags"),
      screenshots: shots,
      status: "published",
      author_id: user?.id ?? null,
      author_name: user?.name ?? null,
    };

    const res = await supabaseRest(c.env, "POST", `/market_apps`, row);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[market/apps POST]", errText);
      await storageDelete(c.env, bucket, uploaded).catch(() => undefined);
      return c.json({ error: `게시 실패: ${errText}` }, res.status as 500);
    }
    const inserted = ((await res.json()) as AppRow[])[0] ?? null;

    // 버전 이력 최초 1건 — 값이 없으면 v1.0 으로 시작
    await supabaseRest(
      c.env,
      "POST",
      `/market_app_versions`,
      {
        app_id: appId,
        version: version || "v1.0",
        note: null,
        created_by: user?.id ?? null,
        created_by_name: user?.name ?? null,
      },
      "return=minimal",
    ).catch((err) => {
      // 이력 실패로 게시 자체를 되돌리지는 않는다(본문은 이미 저장됨).
      console.error("[market/apps POST version]", errMsg(err));
      return undefined;
    });

    return c.json({ app: inserted });
  } catch (err) {
    console.error("[market/apps POST]", errMsg(err));
    await storageDelete(c.env, bucket, uploaded).catch(() => undefined);
    return c.json({ error: `게시 실패: ${errMsg(err)}` }, 500);
  }
});

// ─── 상세 ───────────────────────────────────────────────────

/** GET /api/market/apps/:appId — 상세 (스크린샷 signed URL + 버전 이력 + 좋아요 여부) */
market.get("/apps/:appId", async (c) => {
  const appId = c.req.param("appId");
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/market_apps?id=eq.${encodeURIComponent(appId)}&select=${APP_COLUMNS}&limit=1`,
    );
    if (!res.ok) return c.json({ error: "조회 실패" }, res.status as 500);
    const row = ((await res.json()) as AppRow[])[0] ?? null;
    if (!row) return c.json({ error: "게시물을 찾을 수 없습니다." }, 404);

    const user = c.get("user");
    const [screenshots, versionsRes, liked] = await Promise.all([
      signShots(c.env, row.screenshots),
      supabaseRest(
        c.env,
        "GET",
        `/market_app_versions?app_id=eq.${encodeURIComponent(appId)}&select=id,version,note,created_by_name,created_at&order=created_at.desc`,
      ),
      likedIdsFor(c.env, user?.id ?? "", [appId]),
    ]);
    const versions = versionsRes.ok ? await versionsRes.json() : [];

    const { screenshots: _drop, ...rest } = row;
    return c.json({
      app: { ...rest, screenshots, liked: liked.has(appId) },
      versions,
      canManage: isAdmin(user),
    });
  } catch (err) {
    console.error("[market/app GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** POST /api/market/apps/:appId/view — 조회수 +1 (상세 진입 시 1회) */
market.post("/apps/:appId/view", async (c) => {
  const appId = c.req.param("appId");
  try {
    await supabaseRpc(c.env, "market_app_bump_view", { p_app_id: appId });
    return c.json({ ok: true });
  } catch (err) {
    // 조회수는 부가 정보 — 실패해도 화면을 막지 않는다.
    console.error("[market/view]", errMsg(err));
    return c.json({ ok: false });
  }
});

/** POST /api/market/apps/:appId/like — 좋아요 토글 */
market.post("/apps/:appId/like", async (c) => {
  const appId = c.req.param("appId");
  const user = c.get("user");
  if (!user?.id) return c.json({ error: "인증이 필요합니다." }, 401);
  try {
    const existing = await supabaseRest(
      c.env,
      "GET",
      `/market_app_likes?app_id=eq.${encodeURIComponent(appId)}&user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
    );
    const has = existing.ok && ((await existing.json()) as unknown[]).length > 0;

    if (has) {
      await supabaseRest(
        c.env,
        "DELETE",
        `/market_app_likes?app_id=eq.${encodeURIComponent(appId)}&user_id=eq.${encodeURIComponent(user.id)}`,
        undefined,
        "return=minimal",
      );
    } else {
      await supabaseRest(
        c.env,
        "POST",
        `/market_app_likes`,
        { app_id: appId, user_id: user.id },
        "return=minimal",
      );
    }

    const syncRes = await supabaseRpc(c.env, "market_app_sync_like_count", { p_app_id: appId });
    const likeCount = syncRes.ok ? Number(await syncRes.json()) || 0 : 0;
    return c.json({ liked: !has, likeCount });
  } catch (err) {
    console.error("[market/like]", errMsg(err));
    return c.json({ error: `좋아요 처리 실패: ${errMsg(err)}` }, 500);
  }
});

/** POST /api/market/apps/:appId/versions — 버전 이력 추가 (관리자) */
market.post("/apps/:appId/versions", async (c) => {
  if (!adminOnly(c)) return c.json({ error: "권한이 없습니다." }, 403);
  const appId = c.req.param("appId");
  try {
    const body = (await c.req.json().catch(() => null)) as
      | { version?: unknown; note?: unknown }
      | null;
    const version = typeof body?.version === "string" ? body.version.trim() : "";
    if (!version) return c.json({ error: "버전을 입력하세요." }, 400);

    const user = c.get("user");
    const res = await supabaseRest(c.env, "POST", `/market_app_versions`, {
      app_id: appId,
      version,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null,
      created_by: user?.id ?? null,
      created_by_name: user?.name ?? null,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[market/versions POST]", errText);
      return c.json({ error: `등록 실패: ${errText}` }, res.status as 500);
    }
    // 대표 버전 표기도 최신으로 갱신
    await supabaseRest(
      c.env,
      "PATCH",
      `/market_apps?id=eq.${encodeURIComponent(appId)}`,
      { version, updated_at: new Date().toISOString() },
      "return=minimal",
    );
    return c.json({ version: ((await res.json()) as unknown[])[0] ?? null });
  } catch (err) {
    console.error("[market/versions POST]", errMsg(err));
    return c.json({ error: `등록 실패: ${errMsg(err)}` }, 500);
  }
});

/** DELETE /api/market/apps/:appId — 게시 삭제 (관리자). 스크린샷도 함께 정리 */
market.delete("/apps/:appId", async (c) => {
  if (!adminOnly(c)) return c.json({ error: "권한이 없습니다." }, 403);
  const appId = c.req.param("appId");
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/market_apps?id=eq.${encodeURIComponent(appId)}&select=screenshots&limit=1`,
    );
    const row = res.ok ? (((await res.json()) as AppRow[])[0] ?? null) : null;
    if (!row) return c.json({ error: "게시물을 찾을 수 없습니다." }, 404);

    const delRes = await supabaseRest(
      c.env,
      "DELETE",
      `/market_apps?id=eq.${encodeURIComponent(appId)}`,
      undefined,
      "return=minimal",
    );
    if (!delRes.ok) {
      const errText = await delRes.text();
      console.error("[market/app DELETE]", errText);
      return c.json({ error: `삭제 실패: ${errText}` }, delRes.status as 500);
    }

    // Storage 정리 실패는 치명적이지 않다(고아 파일만 남음).
    const paths = (row.screenshots ?? []).map((s) => s.path);
    if (paths.length > 0) {
      await storageDelete(c.env, shotBucket(c.env), paths).catch((err) =>
        console.error("[market/app DELETE shots]", errMsg(err)),
      );
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("[market/app DELETE]", errMsg(err));
    return c.json({ error: `삭제 실패: ${errMsg(err)}` }, 500);
  }
});

export default market;
