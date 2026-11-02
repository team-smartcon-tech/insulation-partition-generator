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
  DEFAULT_UNDERGROUND_SETTINGS,
  UNDERGROUND_STAGES,
  STAGES,
  undergroundSequence,
  pinFirstDay,
  type Stage,
  aggregateFinish,
  buildFinishGantt,
  buildFinishReportBars,
  buildingNoOf,
  groupLinesToCoreGroups,
  addWorkdays,
  planUnderground,
  undergroundStateFromActual,
  type BuildingState,
  type UgBuilding,
  type DailyReport,
  type PlanResponse,
  type SimulateResponse,
  type Site,
  validateTaktInput,
  type TaktInput,
} from "@ipg/gantt-engine";
import { z } from "zod";
import type { Env, SessionUser } from "./auth";
import { supabaseRest, supabaseRpc, errMsg } from "./supabaseClient";

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
    dcrRest(env, "/sites?select=id,name,location,latitude,longitude&order=name.asc"),
    dcrRest(
      env,
      "/daily_reports?select=site_id,report_date&aggregation_status=in.(completed,aggregating,pending)&order=report_date.desc&limit=10000",
    ),
  ]);
  const sites = (await sRes.json()) as {
    id: string;
    name: string;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
  }[];
  const last = new Map<string, string>();
  for (const r of (await dRes.json()) as { site_id: string; report_date: string }[]) {
    if (!last.has(r.site_id)) last.set(r.site_id, String(r.report_date).slice(0, 10));
  }
  return sites
    .map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location ?? null,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
      lastReportDate: last.get(s.id) ?? null,
    }))
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

const floorSchema = z.number().int().min(1).max(80);

/**
 * 동 하나. 코어마다 최상층이 다를 수 있어 coreTopFloors(1코어, 2코어, …)로 받는다.
 * cores·topFloor 는 coreTopFloors 에서 나온다 — 코어 수 = 길이, 동 최상층 = 최댓값(엔진은 동 단위).
 * 예전 클라이언트처럼 coreTopFloors 없이 cores·topFloor 만 오면 [topFloor × cores] 로 본다.
 */
export const buildingSchema = z
  .object({
    buildingNo: z.number().int().min(1),
    name: z.string().min(1),
    cores: z.number().int().min(1).max(8).default(1),
    coreTopFloors: z.array(floorSchema).min(1).max(8).optional(),
    /** 코어별 옥탑 층수(0 = 없음). coreTopFloors 와 같은 순서·길이. 없으면 hasRooftop 기준 1/0 */
    coreRooftopFloors: z.array(z.number().int().min(0).max(10)).max(8).optional(),
    /** 코어별 세대수 (한 층에서 그 코어가 맡는 세대 수, 0 = 모름). coreTopFloors 와 같은 순서·길이 */
    coreUnits: z.array(z.number().int().min(0).max(10)).max(8).optional(),
    baseFloor: z.number().int().min(1).default(3),
    topFloor: floorSchema.optional(),
    hasRooftop: z.boolean().default(false),
    currentFloor: z.number().int().min(0).nullable().default(null),
    /** 지하층 수 (B3 까지면 3). 일보 없는 동의 지하 출발 층. null = 모름 */
    basementFloors: z.number().int().min(0).max(10).nullable().default(null),
  })
  .refine((b) => b.coreTopFloors || b.topFloor != null, { message: "최상층이 없습니다." })
  .transform((b) => {
    const coreTopFloors = b.coreTopFloors ?? Array.from({ length: b.cores }, () => b.topFloor as number);
    const coreRooftopFloors = coreTopFloors.map((_, i) => b.coreRooftopFloors?.[i] ?? (b.hasRooftop ? 1 : 0));
    const coreUnits = coreTopFloors.map((_, i) => b.coreUnits?.[i] ?? 0);
    return {
      ...b,
      coreUnits,
      cores: coreTopFloors.length,
      coreTopFloors,
      topFloor: Math.max(...coreTopFloors),
      coreRooftopFloors,
      hasRooftop: coreRooftopFloors.some((n) => n > 0),
    };
  });
export type Building = z.output<typeof buildingSchema>;

type BuildingRow = {
  building_no: number;
  name: string;
  cores: number;
  base_floor: number;
  top_floor: number;
  core_top_floors?: number[] | null;
  core_rooftop_floors?: number[] | null;
  basement_floors?: number | null;
  core_units?: number[] | null;
  has_rooftop: boolean;
  current_floor: number | null;
};

const fromRow = (r: BuildingRow): Building => {
  const coreTopFloors = r.core_top_floors?.length ? r.core_top_floors : Array.from({ length: r.cores }, () => r.top_floor);
  const coreRooftopFloors = coreTopFloors.map((_, i) => r.core_rooftop_floors?.[i] ?? (r.has_rooftop ? 1 : 0));
  return {
    buildingNo: r.building_no,
    name: r.name,
    cores: coreTopFloors.length,
    coreTopFloors,
    coreRooftopFloors,
    coreUnits: coreTopFloors.map((_, i) => r.core_units?.[i] ?? 0),
    baseFloor: r.base_floor,
    topFloor: Math.max(...coreTopFloors),
    hasRooftop: coreRooftopFloors.some((n) => n > 0),
    currentFloor: r.current_floor ?? null,
    basementFloors: r.basement_floors ?? null,
  };
};

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

/**
 * GET /smartworks-buildings/:siteId — 스마트웍스 옵션마감 「동/라인 설정」 에서 동 목록·코어별 최상층 (읽기 전용).
 * golgudo_building(동) + golgudo_rooms(세대: 동·층·라인)에서 라인별 최고층 → 이웃 같은 높이 라인을 한 코어로.
 * 지하층 수·기준층 시작·옥탑은 스마트웍스에 없다 — 화면에서 기존 값 유지·직접 입력.
 */
gantt.get("/smartworks-buildings/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const bRes = await dcrRest(c.env, `/golgudo_building?site_id=eq.${encodeURIComponent(siteId)}&select=id,name&order=name.asc`);
    const rows = (await bRes.json()) as { id: string; name: string }[];
    const rooms: { building_id: string; floor: number | string; line: number | string }[] = [];
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const r = await dcrRest(
        c.env,
        `/golgudo_rooms?site_id=eq.${encodeURIComponent(siteId)}&deleted_at=is.null&select=building_id,floor,line&order=building_id.asc,line.asc,floor.asc&limit=1000&offset=${offset}`,
      );
      const page = (await r.json()) as typeof rooms;
      rooms.push(...page);
      if (page.length < 1000) break;
    }
    const buildings = rows
      .map((b) => {
        const mine = rooms.filter((r) => r.building_id === b.id && Number.isFinite(Number(r.floor)));
        const lines = [...new Set(mine.map((r) => String(r.line)))].sort((x, y) => x.localeCompare(y, "ko", { numeric: true }));
        const lineTops = lines.map((l) => Math.max(...mine.filter((r) => String(r.line) === l).map((r) => Number(r.floor))));
        const groups = groupLinesToCoreGroups(lineTops);
        return { buildingNo: buildingNoOf(b.name), name: b.name, lineTops, coreTopFloors: groups.map((g) => g.top), coreUnits: groups.map((g) => g.units) };
      })
      .filter((b): b is typeof b & { buildingNo: number } => b.buildingNo != null && b.coreTopFloors.length > 0)
      .sort((x, y) => x.buildingNo - y.buildingNo);
    return c.json({ siteId, buildings });
  } catch (err) {
    return fail(c, err);
  }
});

/** "25.08.06" · "2025.08.06" · "2025-08-06" → "2025-08-06" (아니면 null) */
function periodDate(s: string | undefined): string | null {
  const m = /^\s*(\d{2}|\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(s ?? "");
  if (!m) return null;
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/**
 * GET /site-period/:siteId — 스마트웍스 현장 개요 공사기간 (읽기 전용, 2026-11-01 택트 준공일 역산).
 * ssx_site_overview_profiles.construction_overview.info.period = "25.08.06 ~ 29.04.30 (44.8개월)". 없거나 못 읽으면 null.
 */
gantt.get("/site-period/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const res = await dcrRest(c.env, `/ssx_site_overview_profiles?site_id=eq.${encodeURIComponent(siteId)}&select=construction_overview`);
    const row = ((await res.json()) as { construction_overview: { info?: { period?: string } } | null }[])[0];
    const raw = row?.construction_overview?.info?.period ?? null;
    const [a, b] = (raw ?? "").split("~");
    return c.json({ siteId, raw, start: periodDate(a), completion: periodDate(b) });
  } catch (err) {
    return fail(c, err);
  }
});

/** 스마트웍스 표를 1000행씩 끝까지 (PostgREST limit/offset) */
async function dcrAll<T>(env: Env, path: string, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const r = await dcrRest(env, `${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`);
    const page = (await r.json()) as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/**
 * GET /finish/:siteId — 마감 공정표 (2026-10-30). 스마트웍스 옵션마감 세대별 마감 완료 기록(읽기 전용)을
 * 동 × 층 × 공종 진척과 공종별 요약으로 모은다 (packages/gantt-engine aggregateFinish).
 * 동은 설정 탭 동 목록에 있는 것만 — 목록이 없으면 needsBuildings 로 안내.
 */
gantt.get("/finish/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const sid = encodeURIComponent(siteId);
  try {
    // 현장 공종 연결(settings.finishMap, 2026-10-31): 스마트웍스 공종 → 마감 공종 14개. 없는 공종은 이름 규칙
    const [saved, siteSettings] = await Promise.all([loadBuildings(c.env, siteId), loadSettings(c.env, siteId)]);
    const today = todayKst();
    if (!saved.length)
      return c.json({ siteId, asOf: today, needsBuildings: true, types: [], sequences: [], buildings: [], gantt: { trades: [], buildings: [] } });
    const listed = new Set(saved.map((b) => b.buildingNo));
    const [bRows, tRows, qRows, rRows, wRows] = await Promise.all([
      dcrAll<{ id: string; name: string }>(c.env, `/golgudo_building?site_id=eq.${sid}&select=id,name&order=name.asc`),
      dcrAll<{ id: string; work_type: string; index: number; is_deleted: boolean | null; include_in_progress: boolean | null }>(
        c.env,
        `/golgudo_finish_types?site_id=eq.${sid}&select=id,work_type,index,is_deleted,include_in_progress&order=index.asc`,
      ),
      dcrAll<{ prerequisite_key: string; successor_key: string }>(c.env, `/golgudo_finish_sequences?site_id=eq.${sid}&select=prerequisite_key,successor_key`),
      dcrAll<{ id: string; building_id: string; floor: number | string; line: number | string; is_void: boolean | null }>(
        c.env,
        `/golgudo_rooms?site_id=eq.${sid}&deleted_at=is.null&select=id,building_id,floor,line,is_void&order=id.asc`,
      ),
      dcrAll<{ room_id: string; work_type_id: string; finished_at: string | null }>(
        c.env,
        `/golgudo_works?site_id=eq.${sid}&select=room_id,work_type_id,finished_at&order=room_id.asc,work_type_id.asc`,
      ),
    ]);
    const buildings = bRows
      .map((b) => {
        const s = saved.find((x) => x.buildingNo === buildingNoOf(b.name));
        // 코어 단위 마감 (2026-10-30): 설정 동 목록의 코어 수·코어별 세대수로 라인을 코어에 나눈다
        return { id: b.id, buildingNo: buildingNoOf(b.name) ?? -1, name: s?.name ?? b.name, cores: s?.cores, coreUnits: s?.coreUnits };
      })
      .filter((b) => listed.has(b.buildingNo));
    const types = tRows.map((t) => ({ id: t.id, name: t.work_type, index: t.index, deleted: !!t.is_deleted, inProgress: t.include_in_progress !== false }));
    const rooms = rRows
      .filter((r) => Number.isFinite(Number(r.floor)))
      .map((r) => ({ id: r.id, buildingId: r.building_id, floor: Number(r.floor), line: String(r.line), isVoid: !!r.is_void }));
    const works = wRows.filter((w) => w.finished_at).map((w) => ({ roomId: w.room_id, typeId: w.work_type_id, date: String(w.finished_at).slice(0, 10) }));
    const result = aggregateFinish({
      types,
      sequences: qRows.map((q) => ({ prerequisite: q.prerequisite_key, successor: q.successor_key })),
      buildings,
      rooms,
      works,
      today,
    });
    // 간트(골조 공정표처럼 날짜 × 동·공종 막대): 사용자 지정 공종만 (engine finish/gantt)
    const gantt = buildFinishGantt({ types, buildings, rooms, works, today, finishMap: siteSettings.settings.finishMap });
    const missing = saved.filter((b) => !buildings.some((x) => x.buildingNo === b.buildingNo)).map((b) => b.buildingNo);
    return c.json({ siteId, asOf: today, needsBuildings: false, missingInSmartworks: missing, ...result, gantt });
  } catch (err) {
    return fail(c, err);
  }
});

/**
 * GET /finish-reports/:siteId?from&to — 작업일보 마감 줄 → 동·공종별 「일보 작업」 막대 (2026-10-30).
 * 골조·전기/설비 구간은 읽지 않는다. 「~최상층」 은 동 목록 최상층으로. 동 목록에 없는 동은 뺀다.
 */
gantt.get("/finish-reports/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const parsed = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "기간(from, to)이 필요합니다.", code: "VALIDATION_FAILED" }, 400);
  try {
    const [saved, reports] = await Promise.all([loadBuildings(c.env, siteId), listReports(c.env, { siteId, ...parsed.data })]);
    const top = new Map(saved.map((b) => [b.buildingNo, b.topFloor]));
    const rows = buildFinishReportBars(
      reports.map((r) => ({ date: r.date, rawText: r.rawText })),
      (no) => top.get(no) ?? null,
    ).filter((r) => !saved.length || top.has(r.buildingNo));
    return c.json({ siteId, ...parsed.data, rows });
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
      .map(({ date, half, buildingId, stage, floor, roof }) => ({ date, half, buildingId, stage, floor, roof })),
    stats: periodStats(result, req.calendar, req.from, req.to),
  };
  return c.json(body);
});

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 출발 상태를 찾으려고 거슬러 읽는 일보 기간. 보는 달에 일보가 없어도(다음 달 등) 마지막 실적에서 이어 간다 */
const REPORT_LOOKBACK_DAYS = 45;

/**
 * POST /plan — 현장 작업일보(실적) + 동 목록 → 예정
 *
 * 보는 달과 상관없이 "오늘까지의 마지막 실적"에서 출발해 그 달 말일까지 이어서 계산한다.
 * 그래서 11월·12월처럼 아직 일보가 없는 달도 10월 말 실적에서 이어진 예정이 나온다.
 * 일보에 없는 동(설정 탭에만 있는 동)은 설정의 현재 층(없으면 기준층 시작)에서 먹매김부터 출발한다.
 * 일보도 동 목록도 없을 때만 예시 시뮬레이션(1~N동)을 보여 준다.
 */
gantt.post("/plan", async (c) => {
  const parsed = planRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "요청이 계약과 다릅니다.", code: "VALIDATION_FAILED", detail: parsed.error.flatten() }, 400);
  const req = parsed.data;
  if (req.to < req.from) return c.json({ error: "종료일이 시작일보다 앞입니다.", code: "BAD_REQUEST" }, 400);
  try {
    const upTo = req.upTo ?? todayKst();
    const actualTo = upTo < req.to ? upTo : req.to;
    const lookback = addDays(actualTo, -REPORT_LOOKBACK_DAYS);
    const readFrom = lookback < req.from ? lookback : req.from;
    const [reports, buildings] = await Promise.all([
      listReports(c.env, { siteId: req.siteId, from: readFrom, to: actualTo }),
      loadBuildings(c.env, req.siteId),
    ]);
    const topFloors = new Map(buildings.map((b) => [b.buildingNo, b.topFloor]));
    // 동 목록이 저장된 현장은 목록에 없는 동 번호(일보 오타 — 평택고덕 「3111동」 = 3611동)를 공정표에서 뺀다.
    // 작업일보 탭 원문에는 그대로 보인다 (2026-10-30)
    const listed = new Set(buildings.map((b) => b.buildingNo));
    const ignoredSet = new Set<number>();
    const reportsForPlan = listed.size
      ? reports.map((r) => ({
          ...r,
          entries: r.entries.filter((e) => {
            if (e.buildingNo == null || listed.has(e.buildingNo)) return true;
            if (e.stage) ignoredSet.add(e.buildingNo);
            return false;
          }),
        }))
      : reports;
    const progress = progressFromReports(reportsForPlan, actualTo, topFloors);
    const days = dateRange(req.from, req.to).map((d) => getDayInfo(req.calendar, d));
    const reportDates = reports.filter((r) => r.date >= req.from).map((r) => r.date);

    // 이 현장의 첫 작업일보 날짜 — 보는 달에 쓸 실적이 없을 때 안내용
    const firstReportDate = await (async () => {
      const r = await dcrRest(
        c.env,
        `/daily_reports?select=report_date&site_id=eq.${encodeURIComponent(req.siteId)}&aggregation_status=in.(completed,aggregating,pending)&order=report_date.asc&limit=1`,
      );
      const rows = (await r.json()) as { report_date: string }[];
      return rows[0] ? String(rows[0].report_date).slice(0, 10) : null;
    })();

    // 일보가 있는 현장인데 이 달까지 쓸 실적이 없다(첫 일보 이전 달 등) — 예시를 그리지 않고 빈 공정표로 안내 (2026-10-30 사용자 요청)
    if (!progress.asOf && buildings.length === 0 && firstReportDate) {
      const empty = { fullDays: 0, halfDays: 0 };
      const body: PlanResponse = {
        from: req.from,
        to: req.to,
        days,
        buildingIds: [],
        assignments: [],
        stats: { from: req.from, to: req.to, pours: 0, pourGapDays: 0, idle: { rebar: empty, alform: empty, gangform: empty } },
        asOf: null,
        buildings: [],
        actual: [],
        reportDates,
        unplanned: [],
        underground: [],
        noTopFloor: [],
        rooftopPhase: [],
        ignoredBuildings: [],
        firstReportDate,
        startOverride: { applied: [], stale: [] },
      };
      return c.json(body);
    }

    // 일보가 아예 없는 현장 — 예시 시뮬레이션
    if (!progress.asOf && buildings.length === 0) {
      const warm = simulate({ settings: req.settings, calendar: req.calendar, from: addDays(req.from, -30), to: req.to });
      const body: PlanResponse = {
        from: req.from,
        to: req.to,
        days,
        buildingIds: warm.buildings.map((b) => b.id),
        assignments: warm.assignments
          .filter((a) => a.date >= req.from && a.date <= req.to)
          .map(({ date, half, buildingId, stage, floor, roof }) => ({ date, half, buildingId, stage, floor, roof })),
        stats: periodStats(warm, req.calendar, req.from, req.to),
        asOf: null,
        buildings: warm.buildings.map((b) => ({ id: b.id, label: `${b.id}동` })),
        actual: [],
        reportDates,
        unplanned: [],
        underground: [],
        noTopFloor: [],
        rooftopPhase: [],
        ignoredBuildings: [],
        firstReportDate,
        startOverride: { applied: [], stale: [] },
      };
      return c.json(body);
    }

    // 예정 출발일: 마지막 실적 다음 날. 실적이 없으면 오늘부터
    const planFrom = progress.asOf ? addDays(progress.asOf, 1) : upTo;
    const reported = new Set(progress.buildings.map((b) => b.id));
    // 동의 옥탑 층수 = 가장 높은 코어(가장 늦게 끝나는 코어)의 옥탑 층수. 같은 높이면 큰 쪽
    const rooftopOf = (b: Building) =>
      Math.max(0, ...b.coreTopFloors.map((t, i) => (t === b.topFloor ? b.coreRooftopFloors[i] ?? 0 : 0)));
    const rooftops = new Map(buildings.map((b) => [b.buildingNo, rooftopOf(b)]));
    // 지하·저층 공정 중인 동은 재래식 순서표로 예정을 낸다 (설계 §8-2, 2026-10-30 2안).
    // 판단: 그 동의 마지막 실적 날에 지하 공종(거푸집·시스템·W/C타설)이 있거나, RF 같은 비숫자 층이거나, 기준층 시작보다 낮다.
    // 지하가 끝나면(기준층 시작 바로 아래 층 S타설) 전환 작업일 뒤 기준층 엔진으로 넘긴다.
    const ug = req.settings.underground ?? DEFAULT_UNDERGROUND_SETTINGS;
    const baseFloorOf = (id: number) => buildings.find((x) => x.buildingNo === id)?.baseFloor ?? 2;
    // 갱폼 셋팅층 (2026-11-01): 저층·기준층 시작과 따로. 저층도 이 층 이상이면 갱폼인양, 기준층은 이 층 아래면 갱폼인양 없이
    const gangformOf = (id: number) => req.settings.gangformFloors?.[String(id)] ?? null;
    // 셋팅 기간 (2026-11-01, 사용자: 알폼 셋팅 5일이면 공정표에 5일): 셋팅층 첫 사이클의 그 공종을 셋팅 기간만큼 막대로 —
    //   갱폼 설치 = 갱폼 셋팅층 먹매김 다음 「갱폼」(현장 공통, 기본 10일), 알폼 셋팅 = 기준층 시작 층의 「알폼」(underground.transitionDays).
    //   저층 끝 → 기준층 시작 사이에 빈칸으로 쉬지 않는다(다음 작업일 먹매김)
    const gangformSetupDays = req.settings.gangformSetupDays ?? 10;
    const unplanned = new Set<number>(); // 지하 공정인데 위치를 못 읽은 동 (실적만)
    const rooftopPhase = new Set<number>(); // 옥탑 공사 중인 동 (실적만)
    const ugBuildings: UgBuilding[] = [];
    for (const b of progress.buildings) {
      const mine = progress.actual.filter((a) => a.buildingId === b.id);
      const lastDate = mine.at(-1)?.date;
      const lastDay = mine.filter((a) => a.date === lastDate);
      const top = Math.max(...lastDay.map((a) => a.floor));
      // 옥탑 공사 중(마지막 실적 날에 「옥탑…」 층) — 지하가 아니다. 실적만 보여 준다 (부산장안 2026-10)
      if (lastDay.some((a) => a.floorLabel?.startsWith("옥탑"))) {
        rooftopPhase.add(b.id);
        continue;
      }
      const numeric = lastDay.filter((a) => a.floorLabel == null);
      const topNum = numeric.length ? Math.max(...numeric.map((a) => a.floor)) : top;
      if (!(lastDay.some((a) => UNDERGROUND_STAGES.includes(a.stage) || (a.floorLabel != null && a.floorLabel !== "층?")) || topNum < baseFloorOf(b.id))) continue;
      const st = undergroundStateFromActual(progress.actual, b.id, baseFloorOf(b.id), ug, gangformOf(b.id));
      if (st) ugBuildings.push(st);
      else unplanned.add(b.id);
    }
    // 일보에 없는 동 중 지하층 수가 있으면 지하 맨 아래층부터
    for (const b of buildings) {
      if (reported.has(b.buildingNo) || !b.basementFloors) continue;
      ugBuildings.push({ id: b.buildingNo, story: -b.basementFloors, stepIndex: 0, doneDays: 0, baseFloor: b.baseFloor, gangformFloor: gangformOf(b.buildingNo) });
    }
    // 출발 상태 보정 (2026-11-02): settings.startOverrides[동] = {from, floor, stage}. from 이 이번 예정 시작일과 같을 때만 쓴다
    // (새 일보가 들어와 시작일이 바뀌면 무효 — 화면에 안내). 층이 기준층 시작보다 낮으면 지하·저층 순서표, 아니면 기준층 사이클
    const overrides = new Map<number, { floor: number; stage: Stage; pm?: Stage; amEmpty?: boolean; pmEmpty?: boolean; free?: boolean }>();
    const staleOverrides: number[] = [];
    for (const [k, o] of Object.entries(req.settings.startOverrides ?? {})) {
      const no = Number(k);
      if (!buildings.some((x) => x.buildingNo === no) && !progress.buildings.some((x) => x.id === no)) continue;
      const stage = o.stage as Stage;
      const ok = (STAGES as readonly string[]).includes(o.stage) && (o.floor < baseFloorOf(no) || !UNDERGROUND_STAGES.includes(stage));
      if (o.from !== planFrom || !ok) {
        staleOverrides.push(no);
        continue;
      }
      // 오후 공종은 기준층만, 기준층 사이클 공종일 때만 (아니면 엔진이 정한다)
      const pm = o.pm && o.floor >= baseFloorOf(no) && (STAGES as readonly string[]).includes(o.pm) && !UNDERGROUND_STAGES.includes(o.pm as Stage) ? (o.pm as Stage) : undefined;
      // 비움·고정 안 함도 기준층만. 고정 안 함이면 타설부터 시작해도 된다(엔진이 날을 정함)
      const isBase = o.floor >= baseFloorOf(no);
      const free = o.free === true && isBase;
      const amEmpty = o.amEmpty === true && isBase && (stage !== "POUR" || free);
      const pmEmpty = o.pmEmpty === true && isBase;
      overrides.set(no, { floor: o.floor, stage, ...(pm ? { pm } : {}), ...(amEmpty ? { amEmpty } : {}), ...(pmEmpty ? { pmEmpty } : {}), ...(free ? { free } : {}) });
    }
    for (const [no, o] of overrides) {
      unplanned.delete(no);
      rooftopPhase.delete(no);
      const i = ugBuildings.findIndex((b) => b.id === no);
      if (i >= 0) ugBuildings.splice(i, 1);
      if (o.floor < baseFloorOf(no)) {
        const seq = undergroundSequence(ug, o.floor, gangformOf(no), gangformSetupDays);
        ugBuildings.push({
          id: no,
          story: o.floor,
          stepIndex: Math.max(0, seq.findIndex((s) => s.stage === o.stage)),
          doneDays: 0,
          baseFloor: baseFloorOf(no),
          gangformFloor: gangformOf(no),
        });
      }
    }
    const baseOverrides = [...overrides].filter(([no, o]) => o.floor >= baseFloorOf(no));
    const pinned: { date: string; half: "AM" | "PM"; buildingId: number; stage: Stage; floor: number }[] = [];
    const ugIds = new Set(ugBuildings.map((b) => b.id));
    // 지하·저층 팀 용량 (2026-11-01): 형틀팀 = 동이 속한 지하 구역의 팀(구역 순서 = 우선순위), 철근팀 = underground.rebarTeams.
    // 지하·저층이 같은 팀을 이어 쓰고 기준층 자원(rebarTeams·alformTeams …)과는 따로
    const formTeamOf = new Map<number, string>();
    const ugPriority = new Map<number, number>();
    (req.settings.zones ?? []).forEach((z, i) => {
      for (const no of z.buildingNos) {
        if (!formTeamOf.has(no)) formTeamOf.set(no, z.team);
        if (!ugPriority.has(no)) ugPriority.set(no, i);
      }
    });
    const ugPlan = planUnderground({
      calendar: req.calendar,
      settings: ug,
      from: planFrom,
      to: req.to,
      buildings: ugBuildings,
      formTeamOf,
      rebarTeams: ug.rebarTeams ?? null,
      priority: ugPriority,
      gangformSetupDays,
      pourPerDay: req.settings.pourPerDay,
    });
    // 지하·저층이 잡은 타설(S타설·W타설) — 기준층 예정의 「1일 타설」 한도와 요약 카드 타설 수에 같이 센다 (2026-11-02)
    const ugPourDates = ugPlan.assignments.filter((a) => a.stage === "POUR" || a.stage === "POUR_WALL").map((a) => a.date);
    const reservedPours = new Map<string, number>();
    for (const d of ugPourDates) reservedPours.set(d, (reservedPours.get(d) ?? 0) + 1);
    const topFloorOf = (id: number) => buildings.find((x) => x.buildingNo === id)?.topFloor ?? null;

    const initial: BuildingState[] = [
      ...progress.initial
        .filter((b) => !unplanned.has(b.id) && !ugIds.has(b.id) && !rooftopPhase.has(b.id) && !overrides.has(b.id))
        .map((b) => ({ ...b, rooftopFloors: rooftops.get(b.id) ?? 0 })),
      // 출발 상태 보정한 동 (기준층): 예정 첫날 그 층·공종부터. 마지막 타설일은 일보 값(양생일 판정)
      ...baseOverrides.map(([no, o]) => {
        const prev = progress.initial.find((b) => b.id === no);
        const topFloor = topFloorOf(no) ?? prev?.topFloor ?? null;
        // 첫날 오전(·오후)은 정한 대로 고정하고 그 다음 칸부터 엔진 (pinFirstDay). 오후를 안 정했으면 오전만 고정
        const p = pinFirstDay({ calendar: req.calendar, from: planFrom, buildingId: no, floor: o.floor, topFloor, am: o.stage, pm: o.pm, amEmpty: o.amEmpty, pmEmpty: o.pmEmpty, free: o.free, lastPourDate: prev?.lastPourDate ?? null });
        pinned.push(...p.fixed);
        return { id: no, pours: 0, topFloor, rooftopFloors: rooftops.get(no) ?? 0, ...p.state };
      }),
      ...buildings
        .filter((b) => !reported.has(b.buildingNo) && !ugIds.has(b.buildingNo) && !overrides.has(b.buildingNo))
        .map((b) => ({
          id: b.buildingNo,
          stage: "MARK" as const,
          readySlot: 0,
          readyDate: planFrom,
          prevEndSlot: -1,
          lastPourDate: null,
          pours: 0,
          floor: b.currentFloor ?? b.baseFloor,
          topFloor: b.topFloor,
          done: false,
          rooftopFloors: rooftops.get(b.buildingNo) ?? 0,
        })),
      // 지하가 기간 안에 끝나는 동: 전환 작업일 뒤 기준층 시작 층 먹매김부터
      ...[...ugPlan.finishedOn].map(([id, finished]) => ({
        id,
        stage: "MARK" as const,
        readySlot: 0,
        readyDate: addWorkdays(req.calendar, finished, 0),
        prevEndSlot: -1,
        lastPourDate: finished,
        pours: 0,
        floor: baseFloorOf(id),
        topFloor: topFloorOf(id),
        done: false,
        rooftopFloors: rooftops.get(id) ?? 0,
      })),
    ]
      // 갱폼 셋팅층 (2026-11-01): 기준층 시작(= 알폼 셋팅층)부터 이 층 아래까지 갱폼인양 없이. 없으면 기준층 시작부터 갱폼
      // 갱폼 셋팅층을 비웠으면 기준층 시작이 셋팅층 (설치 기간 막대가 기준층 첫 사이클에)
      .map((b) => ({
        ...b,
        gangformFloor: gangformOf(b.id) ?? baseFloorOf(b.id),
        gangformSetupDays,
        alformFloor: baseFloorOf(b.id),
        alformSetupDays: ug.transitionDays,
      }))
      .sort((a, b) => a.id - b.id);

    // 최상층을 모르는 동은 기준층 예정을 그리지 않는다(끝없이 올라가 67층 같은 예정이 나왔다). 실적·지하 예정은 그대로, 화면에 「최상층 미입력」 안내
    const noTopFloor = initial.filter((b) => b.topFloor == null).map((b) => b.id);
    const initialWithTop = initial.filter((b) => b.topFloor != null);
    const planned =
      planFrom <= req.to && initialWithTop.length
        ? simulate({
            settings: { ...req.settings, buildingCount: initialWithTop.length },
            calendar: req.calendar,
            from: planFrom,
            to: req.to,
            initial: initialWithTop,
            reservedPours,
          })
        : null;
    const statsFrom = planFrom > req.from ? planFrom : req.from;
    // 화면 줄: 예정 계산하는 동 + 실적만 있는 동(지하·저층)
    const allIds = [...new Set([...initial.map((b) => b.id), ...ugIds, ...unplanned, ...rooftopPhase])].sort((a, b) => a - b);
    const empty = { fullDays: 0, halfDays: 0 };
    const labelOf = (id: number) => buildings.find((x) => x.buildingNo === id)?.name ?? progress.buildings.find((x) => x.id === id)?.label ?? `${id}동`;
    const body: PlanResponse = {
      from: req.from,
      to: req.to,
      days,
      buildingIds: allIds,
      assignments: [
        ...pinned.map(({ date, half, buildingId, stage, floor }) => ({ date, half, buildingId, stage, floor })),
        ...ugPlan.assignments,
        ...(planned?.assignments ?? []).map(({ date, half, buildingId, stage, floor, roof }) => ({ date, half, buildingId, stage, floor, roof })),
      ].filter((a) => a.date >= req.from && a.date <= req.to),
      stats: planned
        ? periodStats(planned, req.calendar, statsFrom, req.to, ugPourDates)
        : { ...periodStats({ slots: [], assignments: [], buildings: [] }, req.calendar, statsFrom, req.to, ugPourDates), idle: { rebar: empty, alform: empty, gangform: empty } },
      asOf: progress.asOf,
      buildings: allIds.map((id) => ({ id, label: labelOf(id) })),
      actual: progress.actual.filter((a) => a.date >= req.from && a.date <= req.to),
      reportDates,
      unplanned: [...unplanned].sort((a, b) => a - b),
      underground: [...ugIds].sort((a, b) => a - b),
      noTopFloor: noTopFloor.sort((a, b) => a - b),
      rooftopPhase: [...rooftopPhase].sort((a, b) => a - b),
      ignoredBuildings: [...ignoredSet].sort((a, b) => a - b),
      firstReportDate,
      startOverride: { applied: [...overrides.keys()].sort((a, b) => a - b), stale: staleOverrides.sort((a, b) => a - b) },
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
          core_top_floors: b.coreTopFloors,
          core_rooftop_floors: b.coreRooftopFloors,
          basement_floors: b.basementFloors,
          core_units: b.coreUnits,
          base_floor: b.baseFloor,
          top_floor: b.topFloor,
          has_rooftop: b.hasRooftop,
          current_floor: b.currentFloor,
          updated_by: who,
          updated_at: now,
        })),
        "resolution=merge-duplicates,return=representation",
      );
      if (!up.ok) {
        const text = await up.text();
        // core_top_floors 칸이 아직 없음(마이그레이션 20261030090000 전) — 조용히 버리지 않고 알린다
        if (text.includes("core_top_floors"))
          throw new GanttError(500, "코어별 최상층 칸이 DB에 아직 없습니다. 마이그레이션(20261030090000)을 먼저 적용해야 합니다.", "DATABASE_ERROR");
        if (text.includes("core_units"))
          throw new GanttError(500, "코어별 세대수 칸이 DB에 아직 없습니다. 마이그레이션(20261030120000)을 먼저 적용해야 합니다.", "DATABASE_ERROR");
        if (text.includes("basement_floors"))
          throw new GanttError(500, "지하층 수 칸이 DB에 아직 없습니다. 마이그레이션(20261030110000)을 먼저 적용해야 합니다.", "DATABASE_ERROR");
        if (text.includes("core_rooftop_floors"))
          throw new GanttError(500, "코어별 옥탑 층수 칸이 DB에 아직 없습니다. 마이그레이션(20261030100000)을 먼저 적용해야 합니다.", "DATABASE_ERROR");
        throw new GanttError(500, `동 저장 실패: ${text}`, "DATABASE_ERROR");
      }
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

// ─── 택트 인원 (2026-10-31) — 현장별 마감 택트 입력 (gantt_takt_*) ─────────────────────
// 계산은 화면(엔진 computeTakt). 여기서는 저장·불러오기와 같은 함수(validateTaktInput)로 입력 검사만.

type TaktSiteRow = {
  units_per_floor: number;
  zone_floors: number;
  takt_days: number;
  building_floors: number[];
  frame_zone_days: number | null;
  updated_by: string | null;
  updated_at: string;
  gantt_takt_trades: {
    sort_order: number;
    stage: number;
    name: string;
    unit: string;
    qty_per_unit: number | null;
    productivity: number | null;
    wait_days: number;
    /** 인원 직접 지정 (마이그레이션 20261031100000 전에는 없음 → 자동) */
    crew?: number | null;
    /** 산정 방식·고정 일수 (마이그레이션 20261031110000 전에는 없음 → rate) */
    mode?: string | null;
    fixed_days?: number | null;
  }[];
};

/** GET /takt/:siteId — 저장된 택트 입력 (없으면 takt: null → 화면이 예시값·설정 동 목록으로 채운다) */
gantt.get("/takt/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const res = await supabaseRest(c.env, "GET", `/gantt_takt_sites?select=*,gantt_takt_trades(*)&site_id=eq.${encodeURIComponent(siteId)}`);
    if (!res.ok) throw new GanttError(500, `택트 조회 실패: ${await res.text()}`, "DATABASE_ERROR");
    const row = ((await res.json()) as TaktSiteRow[])[0];
    if (!row) return c.json({ siteId, takt: null });
    return c.json({
      siteId,
      takt: {
        unitsPerFloor: Number(row.units_per_floor),
        zoneFloors: Number(row.zone_floors),
        taktDays: Number(row.takt_days),
        buildingFloors: row.building_floors.map(Number),
        frameZoneDays: row.frame_zone_days == null ? null : Number(row.frame_zone_days),
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
        trades: [...(row.gantt_takt_trades ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t) => ({
            stage: Number(t.stage),
            name: t.name,
            unit: t.unit,
            qtyPerUnit: t.qty_per_unit == null ? null : Number(t.qty_per_unit),
            productivity: t.productivity == null ? null : Number(t.productivity),
            waitDays: Number(t.wait_days),
            crew: t.crew == null ? null : Number(t.crew),
            mode: t.mode === "fixed" ? ("fixed" as const) : ("rate" as const),
            fixedDays: t.fixed_days == null ? null : Number(t.fixed_days),
          })),
      },
    });
  } catch (err) {
    return fail(c, err);
  }
});

/** PUT /takt/:siteId — 택트 입력 저장 (현장 줄 + 공종 표 통째로, RPC 한 트랜잭션) */
gantt.put("/takt/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const b = (await c.req.json().catch(() => null)) as (Partial<TaktInput> & { frameZoneDays?: unknown }) | null;
  if (!b || !Array.isArray(b.buildingFloors) || !Array.isArray(b.trades)) {
    return c.json({ error: "동별 층수·공종 표가 필요합니다.", code: "VALIDATION_FAILED" }, 400);
  }
  if (b.buildingFloors.length > 100 || b.trades.length > 100) return c.json({ error: "동·공종은 각각 100개까지입니다.", code: "VALIDATION_FAILED" }, 400);
  const input: TaktInput = {
    unitsPerFloor: Number(b.unitsPerFloor),
    zoneFloors: Number(b.zoneFloors),
    taktDays: Number(b.taktDays),
    buildingFloors: b.buildingFloors.map(Number),
    trades: b.trades.map((t) => ({
      stage: Number(t?.stage),
      name: typeof t?.name === "string" ? t.name.trim().slice(0, 50) : "",
      unit: typeof t?.unit === "string" ? t.unit.trim().slice(0, 10) : "",
      qtyPerUnit: Number(t?.qtyPerUnit),
      productivity: Number(t?.productivity),
      waitDays: Number(t?.waitDays),
      crew: t?.crew == null ? null : Number(t.crew),
      mode: t?.mode === "fixed" ? ("fixed" as const) : ("rate" as const),
      fixedDays: t?.fixedDays == null ? null : Number(t.fixedDays),
    })),
  };
  const errors = validateTaktInput(input);
  if (Object.keys(errors).length) return c.json({ error: `입력 오류: ${Object.values(errors)[0]}`, code: "VALIDATION_FAILED", detail: errors }, 400);
  const frame = b.frameZoneDays == null ? null : Number(b.frameZoneDays);
  if (frame != null && !(Number.isFinite(frame) && frame > 0)) return c.json({ error: "골조 소요일은 0보다 큰 값이어야 합니다.", code: "VALIDATION_FAILED" }, 400);
  try {
    const res = await supabaseRpc(c.env, "gantt_takt_save", {
      p_site_id: siteId,
      p_site: {
        units_per_floor: input.unitsPerFloor,
        zone_floors: input.zoneFloors,
        takt_days: input.taktDays,
        building_floors: input.buildingFloors,
        frame_zone_days: frame,
      },
      p_trades: input.trades.map((t) => ({
        stage: t.stage,
        name: t.name,
        unit: t.unit,
        // 고정 일수 공종은 물량·생산성을 비워도 된다 → 숫자가 아니면 null
        qty_per_unit: Number.isFinite(t.qtyPerUnit) ? t.qtyPerUnit : null,
        productivity: Number.isFinite(t.productivity) ? t.productivity : null,
        wait_days: t.waitDays,
        crew: t.crew ?? null,
        mode: t.mode ?? "rate",
        fixed_days: t.mode === "fixed" ? (t.fixedDays ?? null) : null,
      })),
      p_user: c.get("user")?.name ?? null,
    });
    if (!res.ok) throw new GanttError(500, `택트 저장 실패: ${await res.text()}`, "DATABASE_ERROR");
    return c.json({ siteId, saved: true });
  } catch (err) {
    return fail(c, err);
  }
});

export default gantt;
