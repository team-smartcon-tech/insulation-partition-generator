/**
 * 현장(프로젝트 카드) API — /api/elevation-sites*
 *
 * 계층: 현장(elev_sites) → 세부 프로젝트(elev_projects) → REV(elev_revisions)
 *   기존에는 프로젝트가 평면 목록이라 "부산장안" 같은 이름이 여러 번 나와 구분이 안 됐다.
 *   현장을 한 단계 위에 두어 카드로 고르고, 그 안에서 세부 프로젝트를 고른다.
 *
 * 썸네일: Storage {MARKET_SHOT_BUCKET}/elev-sites/{siteId}/{uuid}.{ext} (비공개 → signed URL)
 *   DXF 버킷이 아니라 이미지용 버킷을 재사용한다 — MIME/용량 정책이 이미 이미지에 맞춰져 있고,
 *   새 버킷을 만들지 않는다는 규칙도 지킨다.
 *
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 *       (조회·생성·수정은 로그인 사용자 공통, 삭제도 동일 — 사내 도구 기준)
 */
import { Hono } from "hono";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, storageUpload, storageDelete, storageSignedUrl, errMsg } from "./supabaseClient";

const sites = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** 썸네일 버킷 — App Market 스크린샷과 같은 이미지 버킷을 폴더만 나눠 쓴다. */
const thumbBucket = (env: Env) => env.MARKET_SHOT_BUCKET || "market-shots";

const MAX_THUMB_BYTES = 8 * 1024 * 1024;
const ALLOWED_THUMB_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface SiteRow {
  id: string;
  name: string;
  thumb_bucket: string | null;
  thumb_path: string | null;
  [key: string]: unknown;
}

/** 파일명/MIME 에서 확장자 추출 (market.ts 와 동일 규칙) */
function extOf(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

/**
 * form 에서 썸네일 파일을 꺼내 검증 후 업로드한다.
 * 반환: 업로드한 경로(없으면 null) 또는 오류.
 */
async function uploadThumb(
  env: Env,
  siteId: string,
  form: FormData,
): Promise<{ path: string | null } | { error: string; status: 400 | 413 | 415 }> {
  // workers-types 의 FormData.get 은 string 으로 선언돼 있어 typeof 로 파일을 가려낸다.
  const entry = form.get("thumb");
  const file = entry && typeof entry !== "string" ? (entry as unknown as File) : null;
  if (!file || file.size === 0) return { path: null };
  if (file.size > MAX_THUMB_BYTES) {
    return { error: "썸네일 이미지는 8MB 이하여야 합니다.", status: 413 };
  }
  const mime = file.type || "image/png";
  if (!ALLOWED_THUMB_MIME.has(mime)) {
    return { error: `지원하지 않는 이미지 형식입니다: ${mime}`, status: 415 };
  }
  const objectPath = `elev-sites/${siteId}/${crypto.randomUUID()}.${extOf(file.name, mime)}`;
  await storageUpload(env, thumbBucket(env), objectPath, await file.arrayBuffer(), mime);
  return { path: objectPath };
}

/** 썸네일 경로 → signed URL. 실패해도 카드가 깨지지 않도록 null 로 넘긴다. */
async function signThumb(env: Env, row: SiteRow): Promise<string | null> {
  if (!row.thumb_path) return null;
  try {
    return await storageSignedUrl(env, row.thumb_bucket || thumbBucket(env), row.thumb_path);
  } catch {
    return null;
  }
}

/** 요청 본문을 multipart/json 양쪽에서 동일하게 읽는다(썸네일 첨부 여부에 따라 달라짐). */
async function readBody(
  c: { req: { header: (k: string) => string | undefined; raw: Request; json: () => Promise<unknown> } },
): Promise<{ form: FormData | null; get: (k: string) => string | null }> {
  const ct = c.req.header("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.raw.formData();
    return {
      form,
      get: (k) => {
        const v = form.get(k);
        return typeof v === "string" ? v : null;
      },
    };
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  return {
    form: null,
    get: (k) => (typeof body?.[k] === "string" ? (body[k] as string) : null),
  };
}

/** GET /api/elevation-sites — 현장 목록 (썸네일 signed URL 포함) */
sites.get("/", async (c) => {
  try {
    const res = await supabaseRest(c.env, "GET", `/elev_sites?select=*&order=updated_at.desc`);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[elev-sites/GET]", errText);
      return c.json({ error: `조회 실패: ${errText}` }, res.status as 500);
    }
    const rows = (await res.json()) as SiteRow[];
    const withThumbs = await Promise.all(
      rows.map(async (row) => ({ ...row, thumbnail_url: await signThumb(c.env, row) })),
    );
    return c.json({ sites: withThumbs });
  } catch (err) {
    console.error("[elev-sites/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * POST /api/elevation-sites — 현장 추가
 * Body: JSON {name, description?} 또는 multipart(name, description?, thumb 파일)
 */
sites.post("/", async (c) => {
  try {
    const { form, get } = await readBody(c);
    const name = (get("name") ?? "").trim();
    if (!name) return c.json({ error: "현장 이름이 필요합니다." }, 400);

    const siteId = crypto.randomUUID();
    let thumbPath: string | null = null;
    if (form) {
      const up = await uploadThumb(c.env, siteId, form);
      if ("error" in up) return c.json({ error: up.error }, up.status);
      thumbPath = up.path;
    }

    const row = {
      id: siteId,
      name,
      description: get("description"),
      thumb_bucket: thumbPath ? thumbBucket(c.env) : null,
      thumb_path: thumbPath,
      created_by: c.get("user")?.id ?? null,
    };
    const res = await supabaseRest(c.env, "POST", `/elev_sites`, row);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[elev-sites/POST]", errText);
      // DB 실패 시 방금 올린 이미지는 남기지 않는다
      if (thumbPath) {
        try { await storageDelete(c.env, thumbBucket(c.env), [thumbPath]); } catch { /* ignore */ }
      }
      return c.json({ error: `생성 실패: ${errText}` }, res.status as 500);
    }
    const inserted = ((await res.json()) as SiteRow[])[0] ?? null;
    return c.json({
      site: inserted ? { ...inserted, thumbnail_url: await signThumb(c.env, inserted) } : null,
    });
  } catch (err) {
    console.error("[elev-sites/POST]", errMsg(err));
    return c.json({ error: `생성 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * PATCH /api/elevation-sites/:siteId — 이름·설명·썸네일 수정
 * multipart 로 thumb 를 보내면 교체하고, 기존 이미지는 지운다.
 */
sites.patch("/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const { form, get } = await readBody(c);
    const curRes = await supabaseRest(
      c.env, "GET", `/elev_sites?id=eq.${encodeURIComponent(siteId)}&select=*&limit=1`,
    );
    const current = curRes.ok ? (((await curRes.json()) as SiteRow[])[0] ?? null) : null;
    if (!current) return c.json({ error: "현장을 찾을 수 없습니다." }, 404);

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const name = get("name");
    if (name !== null && name.trim()) row.name = name.trim();
    const description = get("description");
    if (description !== null) row.description = description;

    let newThumbPath: string | null = null;
    if (form) {
      const up = await uploadThumb(c.env, siteId, form);
      if ("error" in up) return c.json({ error: up.error }, up.status);
      newThumbPath = up.path;
      if (newThumbPath) {
        row.thumb_bucket = thumbBucket(c.env);
        row.thumb_path = newThumbPath;
      }
    }

    const res = await supabaseRest(
      c.env, "PATCH", `/elev_sites?id=eq.${encodeURIComponent(siteId)}`, row,
    );
    if (!res.ok) {
      const errText = await res.text();
      if (newThumbPath) {
        try { await storageDelete(c.env, thumbBucket(c.env), [newThumbPath]); } catch { /* ignore */ }
      }
      return c.json({ error: `저장 실패: ${errText}` }, res.status as 500);
    }
    // 교체 성공 후에만 옛 이미지를 정리한다
    if (newThumbPath && current.thumb_path && current.thumb_path !== newThumbPath) {
      try {
        await storageDelete(c.env, current.thumb_bucket || thumbBucket(c.env), [current.thumb_path]);
      } catch { /* ignore */ }
    }
    const updated = ((await res.json()) as SiteRow[])[0] ?? null;
    return c.json({
      site: updated ? { ...updated, thumbnail_url: await signThumb(c.env, updated) } : null,
    });
  } catch (err) {
    console.error("[elev-sites/PATCH]", errMsg(err));
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * DELETE /api/elevation-sites/:siteId — 현장 삭제
 * 세부 프로젝트가 남아 있으면 거절한다(REV·DXF 를 실수로 날리지 않도록).
 * 먼저 세부 프로젝트를 다른 현장으로 옮기거나 삭제해야 한다.
 */
sites.delete("/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    // 현장은 여러 도구가 공유하므로, 어느 도구의 세부 프로젝트가 남아 있어도 삭제를 막는다.
    // (TC 임대계획 쪽은 FK 가 on delete set null 이라 막지 않으면 조용히 "미분류"로 떨어진다)
    const owners: Array<{ table: string; label: string }> = [
      { table: "elev_projects", label: "단열 Layout" },
      { table: "tc_rental_projects", label: "TC 임대계획" },
    ];
    const blocking: string[] = [];
    for (const owner of owners) {
      const res = await supabaseRest(
        c.env, "GET", `/${owner.table}?site_id=eq.${encodeURIComponent(siteId)}&select=id`,
      );
      // 테이블이 아직 없는 환경(마이그레이션 미적용)은 건너뛴다 — 삭제를 막을 근거가 없다
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown[];
      if (rows.length > 0) blocking.push(`${owner.label} ${rows.length}개`);
    }
    if (blocking.length > 0) {
      return c.json(
        {
          error: `세부 프로젝트가 남아 있어 삭제할 수 없습니다 (${blocking.join(", ")}). 먼저 옮기거나 삭제하세요.`,
        },
        409,
      );
    }

    const curRes = await supabaseRest(
      c.env, "GET", `/elev_sites?id=eq.${encodeURIComponent(siteId)}&select=thumb_bucket,thumb_path&limit=1`,
    );
    const current = curRes.ok ? (((await curRes.json()) as SiteRow[])[0] ?? null) : null;

    const res = await supabaseRest(
      c.env, "DELETE", `/elev_sites?id=eq.${encodeURIComponent(siteId)}`, undefined, "return=minimal",
    );
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      return c.json({ error: `삭제 실패: ${errText}` }, res.status as 500);
    }
    if (current?.thumb_path) {
      try {
        await storageDelete(c.env, current.thumb_bucket || thumbBucket(c.env), [current.thumb_path]);
      } catch { /* ignore */ }
    }
    return c.json({ success: true });
  } catch (err) {
    console.error("[elev-sites/DELETE]", errMsg(err));
    return c.json({ error: `삭제 실패: ${errMsg(err)}` }, 500);
  }
});

export default sites;
