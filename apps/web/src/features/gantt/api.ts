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

async function apiFetch<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
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
  baseFloor: z.number().int().min(1),
  topFloor: z.number().int().min(1).max(80),
  hasRooftop: z.boolean(),
  currentFloor: z.number().int().min(0).nullable(),
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

export const saveBuildings = (siteId: string, buildings: Building[]) =>
  apiFetch(
    `/buildings/${encodeURIComponent(siteId)}`,
    z.object({ siteId: z.string(), buildings: z.array(buildingSchema) }),
    { method: "PUT", body: JSON.stringify({ buildings }) },
  );
