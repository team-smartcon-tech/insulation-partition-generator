/**
 * 스마트 공정표 API — /api/gantt/*
 *
 * 두 DB 를 쓴다.
 *  - 스마트웍스(dcr-app) Supabase: 현장(sites)·작업일보(daily_reports). **읽기 전용**(SELECT 만).
 *    키는 DCR_SUPABASE_SERVICE_ROLE_KEY (CTPA 와 같은 방식). 쓰기 메서드를 호출하는 코드를 만들지 않는다.
 *  - 이 앱 Supabase: gantt_site_settings(현장 설정), gantt_buildings(동 목록·최상층). supabaseRest 사용.
 *
 * 계산은 packages/gantt-engine (순수). 규칙의 1차 소스는 docs/gantt/설계.md.
 * 인증: index.ts 에서 authMiddleware 뒤에 마운트되므로 모든 라우트가 로그인 필수.
 */
import { Hono } from "hono";
import {
  DEFAULT_SITE_SETTINGS,
  addDays,
  dateRange,
  getDayInfo,
  parseWorkText,
  periodStats,
  planRequestSchema,
  progressFromReports,
  simulate,
  simulateRequestSchema,
  siteSettingsSchema,
  type DailyReport,
  type PlanResponse,
  type SimulateResponse,
  type Site,
} from "@ipg/gantt-engine";
import { z } from "zod";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, errMsg } from "./supabaseClient";

const gantt = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

// ─── 스마트웍스(dcr) 읽기 전용 ────────────────────────────────────────────

async function dcrRest(env: Env, path: string): Promise<Response> {
  if (!env.DCR_SUPABASE_URL || !env.DCR_SUPABASE_SERVICE_ROLE_KEY) {
    throw new GanttError(
      503,
      "스마트웍스(DCR) 연결 키가 설정되지 않았습니다 (DCR_SUPABASE_URL / DCR_SUPABASE_SERVICE_ROLE_KEY).",
      "NOT_CONFIGURED",
    );
  }
  const res = await fetch(`${env.DCR_SUPABASE_URL}/rest/v1${path}`, {
    method: "GET",
    headers: {
      apikey: env.DCR_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.DCR_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GanttError(503, `스마트웍스 조회 실패: ${text.slice(0, 200)}`, "DATABASE_ERROR");
  }
  return res;
}

class GanttError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type DcrReportRow = {
  id: string;
  site_id: string;
  report_date: string;
  aggregation_status: string | null;
  work_summary: string | null;
  work_descriptions: unknown;
  updated_at: string | null;
  created_at: string | null;
};

const STATUS_RANK: Record<string, number> = { completed: 3, aggregating: 2, pending: 1 };

/** (report_date) 당 1건: completed > aggregating > pending, 같으면 최신본 (CTPA 와 같은 규칙) */
function pickOnePerDate(rows: DcrReportRow[]): DcrReportRow[] {
  const ts = (r: DcrReportRow) => Date.parse(r.updated_at ?? r.created_at ?? "") || 0;
  const picked = new Map<string, DcrReportRow>();
  for (const r of rows) {
    const key = String(r.report_date ?? "").slice(0, 10);
    if (!key) continue;
    const cur = picked.get(key);
    const rRank = STATUS_RANK[r.aggregation_status ?? ""] ?? 0;
    const cRank = cur ? (STATUS_RANK[cur.aggregation_status ?? ""] ?? 0) : -1;
    if (!cur || rRank > cRank || (rRank === cRank && ts(r) > ts(cur))) picked.set(key, r);
  }
  return [...picked.values()].sort((a, b) => a.report_date.localeCompare(b.report_date));
}

/** dcr 일보 → "주요작업 LIST" 원문 (CTPA dcrToRawText 와 같은 규칙) */
function toRawText(r: Pick<DcrReportRow, "work_summary" | "work_descriptions">): string {
  const lines: string[] = [];
  if (r.work_summary && String(r.work_summary).trim()) lines.push(String(r.work_summary).trim());
  const descs = Array.isArray(r.work_descriptions) ? r.work_descriptions : [];
  for (const d of descs) {
    if (typeof d === "string") {
      if (d.trim()) lines.push(d.trim());
    } else if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      const v = o.workDescription ?? o.work_description ?? o.description ?? o.task_description;
      if (typeof v === "string" && v.trim()) lines.push(v.trim());
    }
  }
  return [...new Set(lines)].join("\n");
}

function toDailyReport(row: DcrReportRow): DailyReport {
  const rawText = toRawText(row);
  const { entries, unmatched } = parseWorkText(rawText);
  return {
    id: row.id,
    siteId: row.site_id,
    date: String(row.report_date).slice(0, 10),
    status: row.aggregation_status ?? "pending",
    rawText,
    entries,
    unmatched,
  };
}

async function listSites(env: Env): Promise<Site[]> {
  const [sRes, dRes] = await Promise.all([
    dcrRest(env, "/sites?select=id,name,location&order=name.asc"),
    dcrRest(
      env,
      "/daily_reports?select=site_id,report_date&aggregation_status=in.(completed,aggregating,pending)&order=report_date.desc&limit=10000",
    ),
  ]);
  const sites = (await sRes.json()) as { id: string; name: string; location: string | null }[];
  const last = new Map<string, string>();
  for (const r of (await dRes.json()) as { site_id: string; report_date: string }[]) {
    if (!last.has(r.site_id)) last.set(r.site_id, String(r.report_date).slice(0, 10));
  }
  return sites
    .map((s) => ({ id: s.id, name: s.name, location: s.location ?? null, lastReportDate: last.get(s.id) ?? null }))
    .sort(
      (a, b) =>
        (b.lastReportDate ?? "").localeCompare(a.lastReportDate ?? "") || a.name.localeCompare(b.name, "ko"),
    );
}

const MAX_RANGE_DAYS = 62;

async function listReports(env: Env, q: { siteId: string; from: string; to: string }): Promise<DailyReport[]> {
  if (q.to < q.from) throw new GanttError(400, "종료일이 시작일보다 앞입니다.", "BAD_REQUEST");
  if (dateRange(q.from, q.to).length > MAX_RANGE_DAYS) {
    throw new GanttError(400, `기간은 ${MAX_RANGE_DAYS}일 이하여야 합니다.`, "BAD_REQUEST");
  }
  const res = await dcrRest(
    env,
    `/daily_reports?select=id,site_id,report_date,aggregation_status,work_summary,work_descriptions,updated_at,created_at` +
      `&site_id=eq.${encodeURIComponent(q.siteId)}&report_date=gte.${q.from}&report_date=lte.${q.to}` +
      `&aggregation_status=in.(completed,aggregating,pending)&order=report_date.asc`,
  );
  return pickOnePerDate((await res.json()) as DcrReportRow[]).map(toDailyReport);
}

// ─── 이 앱 DB: 현장 설정·동 목록 ──────────────────────────────────────────

export const buildingSchema = z.object({
  buildingNo: z.number().int().min(1),
  name: z.string().min(1),
  cores: z.number().int().min(1).max(8).default(1),
  baseFloor: z.number().int().min(1).default(3),
  topFloor: z.number().int().min(1).max(80),
  hasRooftop: z.boolean().default(false),
  currentFloor: z.number().int().min(0).nullable().default(null),
});
export type Building = z.infer<typeof buildingSchema>;

type BuildingRow = {
  building_no: number;
  name: string;
  cores: number;
  base_floor: number;
  top_floor: number;
  has_rooftop: boolean;
  current_floor: number | null;
};

const fromRow = (r: BuildingRow): Building => ({
  buildingNo: r.building_no,
  name: r.name,
  cores: r.cores,
  baseFloor: r.base_floor,
  topFloor: r.top_floor,
  hasRooftop: r.has_rooftop,
  currentFloor: r.current_floor ?? null,
});

async function loadBuildings(env: Env, siteId: string): Promise<Building[]> {
  const res = await supabaseRest(
    env,
    "GET",
    `/gantt_buildings?site_id=eq.${encodeURIComponent(siteId)}&select=*&order=building_no.asc`,
  );
  if (!res.ok) {
    const text = await res.text();
    // 마이그레이션 전(표 없음)에는 빈 목록으로 간주 — 최상층 없이(끝없이 올라감) 계획한다
    if (text.includes("PGRST205")) return [];
    throw new GanttError(500, `동 목록 조회 실패: ${text}`, "DATABASE_ERROR");
  }
  return ((await res.json()) as BuildingRow[]).map(fromRow);
}

async function loadSettings(env: Env, siteId: string) {
  const res = await supabaseRest(
    env,
    "GET",
    `/gantt_site_settings?site_id=eq.${encodeURIComponent(siteId)}&select=settings,updated_at,updated_by&limit=1`,
  );
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("PGRST205")) return { settings: DEFAULT_SITE_SETTINGS, saved: false, updatedAt: null, updatedBy: null };
    throw new GanttError(500, `설정 조회 실패: ${text}`, "DATABASE_ERROR");
  }
  const rows = (await res.json()) as { settings: unknown; updated_at: string; updated_by: string | null }[];
  const parsed = rows[0] ? siteSettingsSchema.safeParse(rows[0].settings) : null;
  return {
    settings: parsed?.success ? parsed.data : DEFAULT_SITE_SETTINGS,
    saved: Boolean(parsed?.success),
    updatedAt: rows[0]?.updated_at ?? null,
    updatedBy: rows[0]?.updated_by ?? null,
  };
}

// ─── 라우트 ───────────────────────────────────────────────────────────────

const fail = (c: { json: (b: unknown, s: number) => Response }, err: unknown) => {
  if (err instanceof GanttError) return c.json({ error: err.message, code: err.code }, err.status);
  console.error("[gantt]", errMsg(err));
  return c.json({ error: `처리 실패: ${errMsg(err)}`, code: "INTERNAL_ERROR" }, 500);
};

/** GET /sites — 스마트웍스 현장 목록 (최근 일보 날짜순) */
gantt.get("/sites", async (c) => {
  try {
    return c.json({ sites: await listSites(c.env) });
  } catch (err) {
    return fail(c, err);
  }
});

const reportsQuery = z.object({
  siteId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** GET /daily-reports?siteId&from&to — 작업일보 원문 + 골조 해석 */
gantt.get("/daily-reports", async (c) => {
  const q = reportsQuery.safeParse(c.req.query());
  if (!q.success) return c.json({ error: "siteId, from, to(YYYY-MM-DD) 가 필요합니다.", code: "VALIDATION_FAILED" }, 400);
  try {
    return c.json({ ...q.data, reports: await listReports(c.env, q.data) });
  } catch (err) {
    return fail(c, err);
  }
});

/** POST /simulate — 설정만으로 시뮬레이션 (예열 포함) */
gantt.post("/simulate", async (c) => {
  const parsed = simulateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "요청이 계약과 다릅니다.", code: "VALIDATION_FAILED", detail: parsed.error.flatten() }, 400);
  const req = parsed.data;
  if (req.to < req.from) return c.json({ error: "종료일이 시작일보다 앞입니다.", code: "BAD_REQUEST" }, 400);
  const warmupFrom = req.warmupFrom ?? addDays(req.from, -30);
  const result = simulate({ settings: req.settings, calendar: req.calendar, from: warmupFrom, to: req.to });
  const body: SimulateResponse = {
    from: req.from,
    to: req.to,
    days: dateRange(req.from, req.to).map((d) => getDayInfo(req.calendar, d)),
    buildingIds: result.buildings.map((b) => b.id),
    assignments: result.assignments
      .filter((a) => a.date >= req.from && a.date <= req.to)
      .map(({ date, half, buildingId, stage, floor }) => ({ date, half, buildingId, stage, floor })),
    stats: periodStats(result, req.calendar, req.from, req.to),
  };
  return c.json(body);
});

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** POST /plan — 현장 작업일보(실적) + 동별 최상층 → 예정 */
gantt.post("/plan", async (c) => {
  const parsed = planRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "요청이 계약과 다릅니다.", code: "VALIDATION_FAILED", detail: parsed.error.flatten() }, 400);
  const req = parsed.data;
  if (req.to < req.from) return c.json({ error: "종료일이 시작일보다 앞입니다.", code: "BAD_REQUEST" }, 400);
  try {
    const upTo = req.upTo ?? todayKst();
    const actualTo = upTo < req.to ? upTo : req.to;
    const [reports, buildings] = await Promise.all([
      actualTo >= req.from ? listReports(c.env, { siteId: req.siteId, from: req.from, to: actualTo }) : Promise.resolve([]),
      loadBuildings(c.env, req.siteId),
    ]);
    const topFloors = new Map(buildings.map((b) => [b.buildingNo, b.topFloor]));
    const progress = progressFromReports(reports, actualTo, topFloors);
    const days = dateRange(req.from, req.to).map((d) => getDayInfo(req.calendar, d));
    const reportDates = reports.map((r) => r.date);

    if (!progress.asOf) {
      const warm = simulate({ settings: req.settings, calendar: req.calendar, from: addDays(req.from, -30), to: req.to });
      const body: PlanResponse = {
        from: req.from,
        to: req.to,
        days,
        buildingIds: warm.buildings.map((b) => b.id),
        assignments: warm.assignments
          .filter((a) => a.date >= req.from && a.date <= req.to)
          .map(({ date, half, buildingId, stage, floor }) => ({ date, half, buildingId, stage, floor })),
        stats: periodStats(warm, req.calendar, req.from, req.to),
        asOf: null,
        buildings: warm.buildings.map((b) => ({ id: b.id, label: `${b.id}동` })),
        actual: [],
        reportDates,
      };
      return c.json(body);
    }

    const planFrom = addDays(progress.asOf, 1);
    const planned =
      planFrom <= req.to
        ? simulate({
            settings: { ...req.settings, buildingCount: progress.buildings.length },
            calendar: req.calendar,
            from: planFrom,
            to: req.to,
            initial: progress.initial,
          })
        : null;
    const empty = { fullDays: 0, halfDays: 0 };
    const body: PlanResponse = {
      from: req.from,
      to: req.to,
      days,
      buildingIds: progress.buildings.map((b) => b.id),
      assignments: (planned?.assignments ?? []).map(({ date, half, buildingId, stage, floor }) => ({ date, half, buildingId, stage, floor })),
      stats: planned
        ? periodStats(planned, req.calendar, planFrom, req.to)
        : { from: planFrom, to: req.to, pours: 0, pourGapDays: 0, idle: { rebar: empty, alform: empty, gangform: empty } },
      asOf: progress.asOf,
      buildings: progress.buildings.map((b) => {
        const row = buildings.find((x) => x.buildingNo === b.id);
        return { id: b.id, label: row?.name ?? b.label };
      }),
      actual: progress.actual.filter((a) => a.date >= req.from && a.date <= req.to),
      reportDates,
    };
    return c.json(body);
  } catch (err) {
    return fail(c, err);
  }
});

/** GET /settings/:siteId — 현장 설정 + 동 목록 (없으면 기본값) */
gantt.get("/settings/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const [s, buildings] = await Promise.all([loadSettings(c.env, siteId), loadBuildings(c.env, siteId)]);
    return c.json({ siteId, ...s, buildings });
  } catch (err) {
    return fail(c, err);
  }
});

/** PUT /settings/:siteId — 현장 설정 저장 (통째로) */
gantt.put("/settings/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const body = (await c.req.json().catch(() => null)) as { settings?: unknown } | null;
  const parsed = siteSettingsSchema.safeParse(body?.settings);
  if (!parsed.success) return c.json({ error: "설정이 계약과 다릅니다.", code: "VALIDATION_FAILED", detail: parsed.error.flatten() }, 400);
  try {
    const res = await supabaseRest(
      c.env,
      "POST",
      `/gantt_site_settings?on_conflict=site_id`,
      { site_id: siteId, settings: parsed.data, updated_by: c.get("user")?.name ?? null, updated_at: new Date().toISOString() },
      "resolution=merge-duplicates,return=representation",
    );
    if (!res.ok) throw new GanttError(500, `설정 저장 실패: ${await res.text()}`, "DATABASE_ERROR");
    return c.json({ siteId, settings: parsed.data, saved: true });
  } catch (err) {
    return fail(c, err);
  }
});

/** PUT /buildings/:siteId — 동 목록 저장 (목록 전체로 교체: 없어진 동은 지운다) */
gantt.put("/buildings/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const body = (await c.req.json().catch(() => null)) as { buildings?: unknown } | null;
  const parsed = z.array(buildingSchema).max(60).safeParse(body?.buildings);
  if (!parsed.success) return c.json({ error: "동 목록이 계약과 다릅니다.", code: "VALIDATION_FAILED", detail: parsed.error.flatten() }, 400);
  const nos = parsed.data.map((b) => b.buildingNo);
  if (new Set(nos).size !== nos.length) return c.json({ error: "동 번호가 중복됩니다.", code: "BAD_REQUEST" }, 400);
  try {
    const who = c.get("user")?.name ?? null;
    const now = new Date().toISOString();
    if (parsed.data.length) {
      const up = await supabaseRest(
        c.env,
        "POST",
        `/gantt_buildings?on_conflict=site_id,building_no`,
        parsed.data.map((b) => ({
          site_id: siteId,
          building_no: b.buildingNo,
          name: b.name,
          cores: b.cores,
          base_floor: b.baseFloor,
          top_floor: b.topFloor,
          has_rooftop: b.hasRooftop,
          current_floor: b.currentFloor,
          updated_by: who,
          updated_at: now,
        })),
        "resolution=merge-duplicates,return=representation",
      );
      if (!up.ok) throw new GanttError(500, `동 저장 실패: ${await up.text()}`, "DATABASE_ERROR");
    }
    // 목록에서 빠진 동은 삭제 (이 앱의 설정 표. 스마트웍스 DB 가 아니다)
    const notIn = nos.length ? `&building_no=not.in.(${nos.join(",")})` : "";
    const del = await supabaseRest(c.env, "DELETE", `/gantt_buildings?site_id=eq.${encodeURIComponent(siteId)}${notIn}`, undefined, "return=minimal");
    if (!del.ok) throw new GanttError(500, `동 정리 실패: ${await del.text()}`, "DATABASE_ERROR");
    return c.json({ siteId, buildings: await loadBuildings(c.env, siteId) });
  } catch (err) {
    return fail(c, err);
  }
});

export default gantt;
