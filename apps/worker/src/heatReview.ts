/**
 * 동절기 열원검토 API — /api/heat-review-projects*
 *
 * 계층: 현장(elev_sites, 다른 도구와 공유) → 세부 프로젝트(heat_review_projects)
 *       → REV(heat_review_revisions)
 *
 * TC 임대계획(heatReview.ts)과 같은 구조다. 검토서 전체(plan = 구역·조건·열원·비용 가정)를 통째로
 * 스냅샷으로 넣는다 — 부분 저장을 하면 "화면에 그린 것만 저장되어 나머지가 지워지는" 유실 경로가 생긴다.
 * 도면(DXF) 원본은 Storage 에 둔다: {ELEV_DXF_BUCKET}/heat-review/{projectId}/{sheet}.dxf
 * (sheet = unit | core | parking). REV 마다가 아니라 프로젝트에 종류별 한 장 — 도면은 REV 를 새로 쌓는다고
 * 바뀌지 않고, 수십 MB 를 REV 마다 복사하면 금방 찬다. 구역 좌표는 plan 에 들어 있다.
 *
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 */
import { Hono } from "hono";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, errMsg, storageDelete, storageSignedUrl, storageUpload } from "./supabaseClient";

const heatReview = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** REV 메타 목록에서 plan 은 뺀다 — 목록 한 번에 수 MB 가 오가는 것을 막는다 */
const REV_META_COLS = "id,rev_no,memo,summary,schema_ver,created_by,created_at";

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

const dxfBucket = (env: Env) => env.ELEV_DXF_BUCKET || "elev-dxf";
const SHEETS = ["unit", "core", "parking"];
/** 프로젝트 id 는 uuid 만 받는다 — Storage 경로에 그대로 들어간다 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 도면은 브라우저가 gzip 으로 줄여서 올린다(.dxf.gz) — Storage 가 한 파일 50MB 까지만 받는데
 * 주차장 도면은 90MB 를 넘기도 한다. DXF 는 글자라 1/10 쯤으로 준다.
 * 줄이지 못하는 브라우저가 올린 것은 .dxf 그대로다.
 */
const drawingPath = (projectId: string, sheet: string, gz = true) =>
  `heat-review/${projectId}/${sheet}.dxf${gz ? ".gz" : ""}`;
/** Storage 한 파일 한도(50MB) 안쪽 */
const MAX_DXF_BYTES = 48 * 1024 * 1024;

/** GET / — 세부 프로젝트 목록 (현장별 묶기는 화면에서 한다) */
heatReview.get("/", async (c) => {
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_projects?select=*&order=updated_at.desc`,
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("[heat-review/projects/GET]", errText);
      return c.json({ error: `조회 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ projects: await res.json() });
  } catch (err) {
    console.error("[heat-review/projects/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** POST / — 세부 프로젝트 생성 (JSON: {name, description?, siteId?}) */
heatReview.post("/", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; description?: unknown; siteId?: unknown }
      | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "프로젝트 이름이 필요합니다." }, 400);

    const row: Record<string, unknown> = {
      name,
      description: typeof body?.description === "string" ? body.description : null,
      site_id: typeof body?.siteId === "string" && body.siteId ? body.siteId : null,
      created_by: c.get("user")?.id ?? null,
    };
    const res = await supabaseRest(c.env, "POST", `/heat_review_projects`, row);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[heat-review/projects/POST]", errText);
      return c.json({ error: `생성 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ project: ((await res.json()) as unknown[])[0] ?? null });
  } catch (err) {
    console.error("[heat-review/projects/POST]", errMsg(err));
    return c.json({ error: `생성 실패: ${errMsg(err)}` }, 500);
  }
});

/** GET /:projectId — 프로젝트 + REV 메타 목록(plan 제외) */
heatReview.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const pRes = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_projects?id=${eq(projectId)}&select=*&limit=1`,
    );
    if (!pRes.ok) return c.json({ error: "조회 실패" }, pRes.status as 500);
    const project = ((await pRes.json()) as unknown[])[0] ?? null;
    if (!project) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);

    const rRes = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_revisions?project_id=${eq(projectId)}&select=${REV_META_COLS}&order=rev_no.desc`,
    );
    return c.json({ project, revisions: rRes.ok ? await rRes.json() : [] });
  } catch (err) {
    console.error("[heat-review/project/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** PATCH /:projectId — 이름·설명·현장 이동 */
heatReview.patch("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; description?: unknown; siteId?: unknown }
      | null;
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body?.name === "string" && body.name.trim()) row.name = body.name.trim();
    if (typeof body?.description === "string") row.description = body.description;
    // 키가 아예 없으면 현장을 바꾸지 않는다. null 을 명시하면 "미분류"로 뺀다.
    if (body && "siteId" in body) {
      row.site_id = typeof body.siteId === "string" && body.siteId ? body.siteId : null;
    }
    const res = await supabaseRest(
      c.env,
      "PATCH",
      `/heat_review_projects?id=${eq(projectId)}`,
      row,
    );
    if (!res.ok) {
      const errText = await res.text();
      return c.json({ error: `저장 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ project: ((await res.json()) as unknown[])[0] ?? null });
  } catch (err) {
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * PUT /:projectId/drawings/:sheet — 도면 올리기(같은 종류는 덮어쓴다)
 * Body: DXF 파일 그대로(application/octet-stream)
 */
heatReview.put("/:projectId/drawings/:sheet", async (c) => {
  const projectId = c.req.param("projectId");
  const sheet = c.req.param("sheet");
  if (!UUID.test(projectId) || !SHEETS.includes(sheet)) return c.json({ error: "잘못된 요청입니다." }, 400);
  try {
    const pRes = await supabaseRest(c.env, "GET", `/heat_review_projects?id=${eq(projectId)}&select=id&limit=1`);
    const found = pRes.ok ? ((await pRes.json()) as unknown[]).length > 0 : false;
    if (!found) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);

    const buf = await c.req.arrayBuffer();
    if (buf.byteLength === 0) return c.json({ error: "빈 파일입니다." }, 400);
    if (buf.byteLength > MAX_DXF_BYTES) {
      return c.json({ error: "도면이 너무 커서(압축해도 48MB 초과) 서버에 보관할 수 없습니다. 필요한 층만 남겨 저장해 주세요." }, 413);
    }
    const gz = c.req.query("gz") === "1";
    await storageUpload(
      c.env,
      dxfBucket(c.env),
      drawingPath(projectId, sheet, gz),
      buf,
      gz ? "application/gzip" : "application/dxf",
    );
    // 같은 종류의 다른 형식(.dxf ↔ .dxf.gz)이 남아 있으면 옛 도면이 대신 내려갈 수 있다 → 지운다
    try {
      await storageDelete(c.env, dxfBucket(c.env), [drawingPath(projectId, sheet, !gz)]);
    } catch {
      /* 없으면 그만 */
    }
    return c.json({ success: true, size: buf.byteLength });
  } catch (err) {
    console.error("[heat-review/drawing/PUT]", errMsg(err));
    return c.json({ error: `도면 저장 실패: ${errMsg(err)}` }, 500);
  }
});

/** GET /:projectId/drawings/:sheet — 도면 내려받을 임시 주소. 올린 적이 없으면 404 */
heatReview.get("/:projectId/drawings/:sheet", async (c) => {
  const projectId = c.req.param("projectId");
  const sheet = c.req.param("sheet");
  if (!UUID.test(projectId) || !SHEETS.includes(sheet)) return c.json({ error: "잘못된 요청입니다." }, 400);
  try {
    // 서명 주소 발급은 파일이 없으면 실패한다 → 압축본, 원본 순으로 찾는다
    for (const gz of [true, false]) {
      try {
        const url = await storageSignedUrl(c.env, dxfBucket(c.env), drawingPath(projectId, sheet, gz));
        return c.json({ url, gz });
      } catch {
        /* 다음 형식 */
      }
    }
    return c.json({ error: "서버에 보관된 도면이 없습니다." }, 404);
  } catch {
    return c.json({ error: "서버에 보관된 도면이 없습니다." }, 404);
  }
});

/** DELETE /:projectId/drawings/:sheet — 도면 지우기 */
heatReview.delete("/:projectId/drawings/:sheet", async (c) => {
  const projectId = c.req.param("projectId");
  const sheet = c.req.param("sheet");
  if (!UUID.test(projectId) || !SHEETS.includes(sheet)) return c.json({ error: "잘못된 요청입니다." }, 400);
  try {
    await storageDelete(c.env, dxfBucket(c.env), [
      drawingPath(projectId, sheet, true),
      drawingPath(projectId, sheet, false),
    ]);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `도면 삭제 실패: ${errMsg(err)}` }, 500);
  }
});

/** DELETE /:projectId — 프로젝트 삭제 (REV 는 cascade, 도면도 함께 지운다) */
heatReview.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    if (UUID.test(projectId)) {
      try {
        await storageDelete(
          c.env,
          dxfBucket(c.env),
          SHEETS.flatMap((s) => [drawingPath(projectId, s, true), drawingPath(projectId, s, false)]),
        );
      } catch {
        /* 도면이 없거나 지우지 못해도 프로젝트 삭제는 진행한다 */
      }
    }
    const res = await supabaseRest(
      c.env,
      "DELETE",
      `/heat_review_projects?id=${eq(projectId)}`,
      undefined,
      "return=minimal",
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

/** GET /:projectId/revisions/:revId — 단일 REV (plan 포함) */
heatReview.get("/:projectId/revisions/:revId", async (c) => {
  const revId = c.req.param("revId");
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_revisions?id=${eq(revId)}&select=*&limit=1`,
    );
    if (!res.ok) return c.json({ error: "조회 실패" }, res.status as 500);
    const revision = ((await res.json()) as unknown[])[0] ?? null;
    if (!revision) return c.json({ error: "리비전을 찾을 수 없습니다." }, 404);
    return c.json({ revision });
  } catch (err) {
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * POST /:projectId/revisions — 새 REV 저장
 * Body: JSON {plan, summary?, memo?}
 *
 * rev_no 는 서버가 매긴다. 클라이언트가 보내면 두 사람이 동시에 저장할 때 같은 번호가 나온다
 * (그래도 `unique (project_id, rev_no)` 가 최종 방어선이라 조용히 덮어쓰이지는 않는다).
 */
heatReview.post("/:projectId/revisions", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const body = (await c.req.json().catch(() => null)) as
      | { plan?: unknown; summary?: unknown; memo?: unknown }
      | null;
    if (!body?.plan || typeof body.plan !== "object") {
      return c.json({ error: "plan(검토서)이 필요합니다." }, 400);
    }

    const pRes = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_projects?id=${eq(projectId)}&select=id,latest_rev_no&limit=1`,
    );
    const project = pRes.ok
      ? (((await pRes.json()) as { latest_rev_no?: number }[])[0] ?? null)
      : null;
    if (!project) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);

    const revNo = (project.latest_rev_no ?? 0) + 1;
    const revId = crypto.randomUUID();
    const insert = {
      id: revId,
      project_id: projectId,
      rev_no: revNo,
      memo: typeof body.memo === "string" ? body.memo : null,
      plan: body.plan,
      summary: body.summary && typeof body.summary === "object" ? body.summary : null,
      created_by: c.get("user")?.id ?? null,
    };
    const insRes = await supabaseRest(c.env, "POST", `/heat_review_revisions`, insert);
    if (!insRes.ok) {
      const errText = await insRes.text();
      console.error("[heat-review/rev/POST]", errText);
      return c.json({ error: `저장 실패: ${errText}` }, insRes.status as 500);
    }
    const revision = ((await insRes.json()) as unknown[])[0] ?? null;

    // 최신 REV 포인터 갱신. 실패해도 REV 자체는 남으므로 저장은 성공으로 본다.
    const upRes = await supabaseRest(
      c.env,
      "PATCH",
      `/heat_review_projects?id=${eq(projectId)}`,
      { latest_rev_no: revNo, latest_rev_id: revId, updated_at: new Date().toISOString() },
      "return=minimal",
    );
    if (!upRes.ok) console.error("[heat-review/rev/POST] 포인터 갱신 실패", await upRes.text());

    return c.json({ revision });
  } catch (err) {
    console.error("[heat-review/rev/POST]", errMsg(err));
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * DELETE /:projectId/revisions/:revId — 특정 REV 삭제
 * 최신 REV 를 지우면 포인터를 남은 것 중 가장 큰 번호로 되돌린다.
 */
heatReview.delete("/:projectId/revisions/:revId", async (c) => {
  const projectId = c.req.param("projectId");
  const revId = c.req.param("revId");
  try {
    const res = await supabaseRest(
      c.env,
      "DELETE",
      `/heat_review_revisions?id=${eq(revId)}`,
      undefined,
      "return=minimal",
    );
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      return c.json({ error: `삭제 실패: ${errText}` }, res.status as 500);
    }

    const rRes = await supabaseRest(
      c.env,
      "GET",
      `/heat_review_revisions?project_id=${eq(projectId)}&select=id,rev_no&order=rev_no.desc&limit=1`,
    );
    const latest = rRes.ok
      ? (((await rRes.json()) as { id: string; rev_no: number }[])[0] ?? null)
      : null;
    await supabaseRest(
      c.env,
      "PATCH",
      `/heat_review_projects?id=${eq(projectId)}`,
      {
        latest_rev_no: latest?.rev_no ?? 0,
        latest_rev_id: latest?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      "return=minimal",
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `삭제 실패: ${errMsg(err)}` }, 500);
  }
});

export default heatReview;
