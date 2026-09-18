/**
 * TC 임대계획 API — /api/tc-rental-projects*
 *
 * 계층: 현장(elev_sites, 단열 Layout 과 공유) → 세부 프로젝트(tc_rental_projects)
 *       → REV(tc_rental_revisions)
 *
 * 단열 Layout 과 다른 점은 **첨부 파일이 없다**는 것뿐이라, REV 저장이 multipart 가 아니라
 * 평범한 JSON 이다. 계획 문서 전체(plan)를 통째로 스냅샷으로 넣는다 — 부분 저장을 하면
 * "화면에 그린 것만 저장되어 나머지가 지워지는" 유실 경로가 생긴다.
 *
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 */
import { Hono } from "hono";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, errMsg } from "./supabaseClient";

const tcRental = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** REV 메타 목록에서 plan 은 뺀다 — 목록 한 번에 수 MB 가 오가는 것을 막는다 */
const REV_META_COLS = "id,rev_no,memo,summary,schema_ver,created_by,created_at";

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

/** GET / — 세부 프로젝트 목록 (현장별 묶기는 화면에서 한다) */
tcRental.get("/", async (c) => {
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/tc_rental_projects?select=*&order=updated_at.desc`,
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("[tc-rental/projects/GET]", errText);
      return c.json({ error: `조회 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ projects: await res.json() });
  } catch (err) {
    console.error("[tc-rental/projects/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** POST / — 세부 프로젝트 생성 (JSON: {name, description?, siteId?}) */
tcRental.post("/", async (c) => {
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
    const res = await supabaseRest(c.env, "POST", `/tc_rental_projects`, row);
    if (!res.ok) {
      const errText = await res.text();
      console.error("[tc-rental/projects/POST]", errText);
      return c.json({ error: `생성 실패: ${errText}` }, res.status as 500);
    }
    return c.json({ project: ((await res.json()) as unknown[])[0] ?? null });
  } catch (err) {
    console.error("[tc-rental/projects/POST]", errMsg(err));
    return c.json({ error: `생성 실패: ${errMsg(err)}` }, 500);
  }
});

/** GET /:projectId — 프로젝트 + REV 메타 목록(plan 제외) */
tcRental.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const pRes = await supabaseRest(
      c.env,
      "GET",
      `/tc_rental_projects?id=${eq(projectId)}&select=*&limit=1`,
    );
    if (!pRes.ok) return c.json({ error: "조회 실패" }, pRes.status as 500);
    const project = ((await pRes.json()) as unknown[])[0] ?? null;
    if (!project) return c.json({ error: "프로젝트를 찾을 수 없습니다." }, 404);

    const rRes = await supabaseRest(
      c.env,
      "GET",
      `/tc_rental_revisions?project_id=${eq(projectId)}&select=${REV_META_COLS}&order=rev_no.desc`,
    );
    return c.json({ project, revisions: rRes.ok ? await rRes.json() : [] });
  } catch (err) {
    console.error("[tc-rental/project/GET]", errMsg(err));
    return c.json({ error: `조회 실패: ${errMsg(err)}` }, 500);
  }
});

/** PATCH /:projectId — 이름·설명·현장 이동 */
tcRental.patch("/:projectId", async (c) => {
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
      `/tc_rental_projects?id=${eq(projectId)}`,
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

/** DELETE /:projectId — 프로젝트 삭제 (REV 는 cascade) */
tcRental.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const res = await supabaseRest(
      c.env,
      "DELETE",
      `/tc_rental_projects?id=${eq(projectId)}`,
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
tcRental.get("/:projectId/revisions/:revId", async (c) => {
  const revId = c.req.param("revId");
  try {
    const res = await supabaseRest(
      c.env,
      "GET",
      `/tc_rental_revisions?id=${eq(revId)}&select=*&limit=1`,
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
tcRental.post("/:projectId/revisions", async (c) => {
  const projectId = c.req.param("projectId");
  try {
    const body = (await c.req.json().catch(() => null)) as
      | { plan?: unknown; summary?: unknown; memo?: unknown }
      | null;
    if (!body?.plan || typeof body.plan !== "object") {
      return c.json({ error: "plan(계획 문서)이 필요합니다." }, 400);
    }

    const pRes = await supabaseRest(
      c.env,
      "GET",
      `/tc_rental_projects?id=${eq(projectId)}&select=id,latest_rev_no&limit=1`,
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
    const insRes = await supabaseRest(c.env, "POST", `/tc_rental_revisions`, insert);
    if (!insRes.ok) {
      const errText = await insRes.text();
      console.error("[tc-rental/rev/POST]", errText);
      return c.json({ error: `저장 실패: ${errText}` }, insRes.status as 500);
    }
    const revision = ((await insRes.json()) as unknown[])[0] ?? null;

    // 최신 REV 포인터 갱신. 실패해도 REV 자체는 남으므로 저장은 성공으로 본다.
    const upRes = await supabaseRest(
      c.env,
      "PATCH",
      `/tc_rental_projects?id=${eq(projectId)}`,
      { latest_rev_no: revNo, latest_rev_id: revId, updated_at: new Date().toISOString() },
      "return=minimal",
    );
    if (!upRes.ok) console.error("[tc-rental/rev/POST] 포인터 갱신 실패", await upRes.text());

    return c.json({ revision });
  } catch (err) {
    console.error("[tc-rental/rev/POST]", errMsg(err));
    return c.json({ error: `저장 실패: ${errMsg(err)}` }, 500);
  }
});

/**
 * DELETE /:projectId/revisions/:revId — 특정 REV 삭제
 * 최신 REV 를 지우면 포인터를 남은 것 중 가장 큰 번호로 되돌린다.
 */
tcRental.delete("/:projectId/revisions/:revId", async (c) => {
  const projectId = c.req.param("projectId");
  const revId = c.req.param("revId");
  try {
    const res = await supabaseRest(
      c.env,
      "DELETE",
      `/tc_rental_revisions?id=${eq(revId)}`,
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
      `/tc_rental_revisions?project_id=${eq(projectId)}&select=id,rev_no&order=rev_no.desc&limit=1`,
    );
    const latest = rRes.ok
      ? (((await rRes.json()) as { id: string; rev_no: number }[])[0] ?? null)
      : null;
    await supabaseRest(
      c.env,
      "PATCH",
      `/tc_rental_projects?id=${eq(projectId)}`,
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

export default tcRental;
