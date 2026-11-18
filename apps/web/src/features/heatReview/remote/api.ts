/**
 * 동절기 열원검토 서버 저장 API 클라이언트
 *
 * 경로: /api/sites/* (현장, 다른 도구와 공유) · /api/heat-review-projects/* (세부 프로젝트·REV)
 * 인증: 세션 쿠키(credentials: include). 401 이면 인증 컨텍스트에 만료를 알린다("ipg-auth-expired").
 *
 * TC 임대계획(features/tcRental/api.ts)과 같은 구조다. 현장 API 는 그쪽 것을 그대로 쓴다.
 * 화면은 이 파일을 직접 부르지 않고 hooks.ts(TanStack Query)만 쓴다.
 */
import type { HeatProject } from "../types";

export { listSites, createSite, updateSite, deleteSite, type SiteRow } from "@/features/tcRental/api";

export class HeatApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HeatApiError";
    this.status = status;
  }
}

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    throw new HeatApiError(body?.error || `동절기 열원검토 API 오류 (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

// ── 세부 프로젝트 ────────────────────────────────────────────────────────────

const PROJECTS = "/api/heat-review-projects";

export interface HeatProjectRow {
  id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  latest_rev_no: number;
  latest_rev_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** REV 목록에 쓰는 요약 — plan 을 열지 않고 카드에 숫자를 보여주기 위한 것 */
export interface HeatRevSummary {
  /** 계산에 들어간 구역 수 */
  zones?: number;
  /** 동시에 깔리는 열원 대수 */
  units?: number;
  /** 동절기 금액(원) */
  seasonTotal?: number;
}

export interface HeatRevisionMeta {
  id: string;
  rev_no: number;
  memo: string | null;
  summary: HeatRevSummary | null;
  schema_ver: number;
  created_by: string | null;
  created_at: string;
}

export interface HeatRevisionFull extends HeatRevisionMeta {
  project_id: string;
  plan: HeatProject;
}

export function listProjects() {
  return apiFetch<{ projects: HeatProjectRow[] }>(PROJECTS);
}

export function getProject(projectId: string) {
  return apiFetch<{ project: HeatProjectRow; revisions: HeatRevisionMeta[] }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}`,
  );
}

export function createProject(name: string, siteId: string | null, description?: string) {
  return apiFetch<{ project: HeatProjectRow }>(PROJECTS, {
    method: "POST",
    body: JSON.stringify({ name, siteId, description }),
  });
}

export function updateProject(
  projectId: string,
  patch: { name?: string; description?: string; siteId?: string | null },
) {
  return apiFetch<{ project: HeatProjectRow }>(`${PROJECTS}/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteProject(projectId: string) {
  return apiFetch<{ success: true }>(`${PROJECTS}/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

// ── 리비전 ───────────────────────────────────────────────────────────────────

export function getRevision(projectId: string, revId: string) {
  return apiFetch<{ revision: HeatRevisionFull }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revId)}`,
  );
}

export function saveRevision(
  projectId: string,
  plan: HeatProject,
  summary: HeatRevSummary,
  memo?: string,
) {
  return apiFetch<{ revision: HeatRevisionMeta }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}/revisions`,
    { method: "POST", body: JSON.stringify({ plan, summary, memo }) },
  );
}

export function deleteRevision(projectId: string, revId: string) {
  return apiFetch<{ success: true }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revId)}`,
    { method: "DELETE" },
  );
}

// ── 도면(DXF) ────────────────────────────────────────────────────────────────
// 프로젝트에 종류별(단위세대·코어·주차장) 한 장씩 서버에 보관한다. REV 와는 따로 간다.
// 서버 저장소가 한 파일 50MB 까지만 받아서, 올리기 전에 gzip 으로 줄인다(DXF 는 글자라 1/10 쯤 된다).

/** 줄인 뒤의 크기 한도 */
export const MAX_REMOTE_DXF_BYTES = 48 * 1024 * 1024;

const canGzip = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function gzip(file: Blob): Promise<Blob> {
  return new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

/**
 * 도면을 서버에 올린다.
 * @returns 실제로 올라간 크기(byte)
 */
export async function uploadDrawing(projectId: string, sheet: string, file: Blob): Promise<number> {
  const body = canGzip ? await gzip(file) : file;
  if (body.size > MAX_REMOTE_DXF_BYTES) {
    throw new HeatApiError(
      `도면이 너무 큽니다(압축해도 ${Math.round(body.size / 1e6)}MB · 한도 48MB). 필요한 층만 남겨 저장해 주세요.`,
      413,
    );
  }
  const res = await fetch(
    `${PROJECTS}/${encodeURIComponent(projectId)}/drawings/${encodeURIComponent(sheet)}${canGzip ? "?gz=1" : ""}`,
    { method: "PUT", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    throw new HeatApiError(err?.error || `도면 저장 실패 (${res.status})`, res.status);
  }
  return body.size;
}

/** 서버에 보관된 도면을 내려받는다. 올린 적이 없으면 null */
export async function downloadDrawing(projectId: string, sheet: string): Promise<ArrayBuffer | null> {
  const res = await fetch(
    `${PROJECTS}/${encodeURIComponent(projectId)}/drawings/${encodeURIComponent(sheet)}`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    throw new HeatApiError(`도면 조회 실패 (${res.status})`, res.status);
  }
  const { url, gz } = (await res.json()) as { url: string; gz?: boolean };
  const file = await fetch(url);
  if (!file.ok) {
    if (file.status === 404 || file.status === 400) return null;
    throw new HeatApiError(`도면 내려받기 실패 (${file.status})`, file.status);
  }
  if (!gz) return file.arrayBuffer();
  if (!file.body || !canGzip) throw new HeatApiError("이 브라우저는 압축된 도면을 풀지 못합니다.", 0);
  return new Response(file.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export function deleteRemoteDrawing(projectId: string, sheet: string) {
  return apiFetch<{ success: true }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}/drawings/${encodeURIComponent(sheet)}`,
    { method: "DELETE" },
  );
}
