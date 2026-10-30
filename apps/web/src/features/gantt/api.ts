/**
 * 스마트 공정표 API 클라이언트 — /api/gantt/*
 *
 * 인증: 세션 쿠키(credentials: include). 401 이면 "ipg-auth-expired" 이벤트 (market/api.ts 와 같은 규약).
 * 화면은 이 파일을 직접 부르지 않고 hooks.ts(TanStack Query)만 쓴다.
 * 응답 모양은 packages/gantt-engine 의 zod 계약으로 검증한다 — 서버가 바뀌면 여기서 바로 드러난다.
 */
import {
  dailyReportsResponseSchema,
  planResponseSchema,
  simulateResponseSchema,
  siteSettingsSchema,
  sitesResponseSchema,
  type DailyReportsResponse,
  type PlanRequest,
  type PlanResponse,
  type SimulateRequest,
  type SimulateResponse,
  type SiteSettings,
  type SitesResponse,
} from "@ipg/gantt-engine";
import { z } from "zod";

export class GanttApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "UNKNOWN") {
    super(message);
    this.name = "GanttApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiFetch<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/gantt${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    throw new GanttApiError(body?.error || `스마트 공정표 API 오류 (${res.status})`, res.status, body?.code);
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new GanttApiError("서버 응답이 계약과 다릅니다.", res.status, "BAD_RESPONSE");
  return parsed.data;
}

export const buildingSchema = z.object({
  buildingNo: z.number().int().min(1),
  name: z.string().min(1),
  cores: z.number().int().min(1).max(8),
  /** 코어별 최상층 [1코어, 2코어, …]. cores = 길이, topFloor = 최댓값 (서버가 맞춘다) */
  coreTopFloors: z.array(z.number().int().min(1).max(80)).min(1).max(8),
  /** 코어별 옥탑 층수(0 = 없음). coreTopFloors 와 같은 순서·길이. hasRooftop = 하나라도 > 0 */
  coreRooftopFloors: z.array(z.number().int().min(0).max(10)).max(8),
  /** 코어별 세대수 (한 층에서 그 코어가 맡는 세대 수, 0 = 모름) */
  coreUnits: z.array(z.number().int().min(0).max(10)).max(8).default([]),
  baseFloor: z.number().int().min(1),
  topFloor: z.number().int().min(1).max(80),
  hasRooftop: z.boolean(),
  currentFloor: z.number().int().min(0).nullable(),
  /** 지하층 수 (B3 까지면 3). 일보 없는 동의 지하 출발 층. null = 모름 */
  basementFloors: z.number().int().min(0).max(10).nullable().default(null),
});
export type Building = z.infer<typeof buildingSchema>;

const settingsResponseSchema = z.object({
  siteId: z.string(),
  settings: siteSettingsSchema,
  saved: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
  buildings: z.array(buildingSchema),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const listSites = () => apiFetch<SitesResponse>("/sites", sitesResponseSchema);

export const listDailyReports = (siteId: string, from: string, to: string) =>
  apiFetch<DailyReportsResponse>(
    `/daily-reports?${new URLSearchParams({ siteId, from, to })}`,
    dailyReportsResponseSchema,
  );

export const simulateSchedule = (req: SimulateRequest) =>
  apiFetch<SimulateResponse>("/simulate", simulateResponseSchema, { method: "POST", body: JSON.stringify(req) });

export const planSchedule = (req: PlanRequest) =>
  apiFetch<PlanResponse>("/plan", planResponseSchema, { method: "POST", body: JSON.stringify(req) });

export const getSettings = (siteId: string) =>
  apiFetch<SettingsResponse>(`/settings/${encodeURIComponent(siteId)}`, settingsResponseSchema);

export const saveSettings = (siteId: string, settings: SiteSettings) =>
  apiFetch(
    `/settings/${encodeURIComponent(siteId)}`,
    z.object({ siteId: z.string(), settings: siteSettingsSchema, saved: z.boolean() }),
    { method: "PUT", body: JSON.stringify({ settings }) },
  );

/** 스마트웍스 옵션마감 「동/라인 설정」 의 동 목록·코어별 최상층 (읽기 전용) */
const smartworksBuildingsSchema = z.object({
  siteId: z.string(),
  buildings: z.array(
    z.object({
      buildingNo: z.number().int(),
      name: z.string(),
      lineTops: z.array(z.number()),
      coreTopFloors: z.array(z.number().int().min(1).max(80)).min(1),
      coreUnits: z.array(z.number().int()).default([]),
    }),
  ),
});
export type SmartworksBuilding = z.infer<typeof smartworksBuildingsSchema>["buildings"][number];
export const listSmartworksBuildings = (siteId: string) =>
  apiFetch(`/smartworks-buildings/${encodeURIComponent(siteId)}`, smartworksBuildingsSchema);

export const saveBuildings = (siteId: string, buildings: Building[]) =>
  apiFetch(
    `/buildings/${encodeURIComponent(siteId)}`,
    z.object({ siteId: z.string(), buildings: z.array(buildingSchema) }),
    { method: "PUT", body: JSON.stringify({ buildings }) },
  );

/** 마감 공정표 (스마트웍스 옵션마감 세대별 마감 완료 → 동 × 층 × 공종, 읽기 전용) */
const finishStatSchema = z.object({
  typeId: z.string(),
  done: z.number(),
  total: z.number(),
  lead: z.number().nullable(),
  tail: z.number().nullable(),
  first: z.string().nullable(),
  last: z.string().nullable(),
  perWeek: z.number(),
  forecast: z.string().nullable(),
  status: z.enum(["done", "progress", "stalled", "blocked", "idle"]),
  blockedBy: z.string().optional(),
});
const finishBarSchema = z.object({ start: z.string(), end: z.string(), floorFrom: z.number(), floorTo: z.number(), units: z.number() });
export type FinishBarT = z.infer<typeof finishBarSchema>;
const finishResponseSchema = z.object({
  siteId: z.string(),
  asOf: z.string(),
  needsBuildings: z.boolean(),
  missingInSmartworks: z.array(z.number()).default([]),
  types: z.array(z.object({ id: z.string(), name: z.string(), inProgress: z.boolean() })),
  sequences: z.array(z.object({ from: z.string(), to: z.string() })),
  buildings: z.array(
    z.object({
      buildingNo: z.number(),
      name: z.string(),
      floors: z.array(z.object({ floor: z.number(), units: z.number() })),
      cells: z.array(z.object({ typeId: z.string(), floor: z.number(), done: z.number(), last: z.string().nullable() })),
      stats: z.array(finishStatSchema),
    }),
  ),
  /** 간트 (날짜 × 동·공종 막대) */
  gantt: z
    .object({
      trades: z.array(z.object({ key: z.string(), group: z.string(), label: z.string() })),
      buildings: z.array(
        z.object({
          buildingNo: z.number(),
          name: z.string(),
          rows: z.array(
            z.object({
              trade: z.string(),
              sources: z.array(z.string()),
              done: z.number(),
              total: z.number(),
              perWeek: z.number(),
              actual: z.array(finishBarSchema),
              forecast: finishBarSchema.nullable(),
              floors: z.array(z.object({ floor: z.number(), units: z.number(), done: z.number(), last: z.string().nullable() })).default([]),
            }),
          ),
        }),
      ),
    })
    .default({ trades: [], buildings: [] }),
});
export type FinishResponse = z.infer<typeof finishResponseSchema>;
export type FinishStat = z.infer<typeof finishStatSchema>;
export const getFinish = (siteId: string) => apiFetch(`/finish/${encodeURIComponent(siteId)}`, finishResponseSchema);

/** 작업일보 마감 줄 → 동·공종별 「일보 작업」 막대 */
const finishReportsSchema = z.object({
  siteId: z.string(),
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      buildingNo: z.number(),
      trade: z.string(),
      bars: z.array(finishBarSchema.extend({ days: z.number(), texts: z.array(z.string()) })),
    }),
  ),
});
export type FinishReportsResponse = z.infer<typeof finishReportsSchema>;
export const getFinishReports = (siteId: string, from: string, to: string) =>
  apiFetch(`/finish-reports/${encodeURIComponent(siteId)}?${new URLSearchParams({ from, to })}`, finishReportsSchema);
