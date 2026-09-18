/**
 * TC 임대계획 API 클라이언트
 *
 * 경로: /api/sites/* (현장, 단열 Layout 과 공유) · /api/tc-rental-projects/* (세부 프로젝트·REV)
 * 인증: 세션 쿠키(credentials: include). 401 이면 인증 컨텍스트에 만료를 알린다
 *       (features/market/api.ts 와 동일한 규약 — "ipg-auth-expired" 이벤트).
 *
 * 화면은 이 파일을 직접 부르지 않고 hooks.ts(TanStack Query)만 쓴다.
 */
import type { TcRentalPlan } from "./types";

export class TcRentalApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TcRentalApiError";
    this.status = status;
  }
}

async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  // FormData 는 브라우저가 boundary 포함해 Content-Type 을 설정하므로 지정하지 않는다.
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(path, { ...options, credentials: "include", headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    throw new TcRentalApiError(body?.error || `TC 임대계획 API 오류 (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

// ── 현장 (도구 공유) ─────────────────────────────────────────────────────────

export interface SiteRow {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export function listSites() {
  return apiFetch<{ sites: SiteRow[] }>("/api/sites");
}

/** 현장 추가 — 썸네일이 있으면 multipart, 없으면 JSON */
export function createSite(name: string, description?: string, thumb?: File | null) {
  if (thumb) {
    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    form.append("thumb", thumb);
    return apiFetch<{ site: SiteRow }>("/api/sites", { method: "POST", body: form }, true);
  }
  return apiFetch<{ site: SiteRow }>("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export function updateSite(
  siteId: string,
  patch: { name?: string; description?: string; thumb?: File | null },
) {
  if (patch.thumb) {
    const form = new FormData();
    if (patch.name) form.append("name", patch.name);
    if (patch.description !== undefined) form.append("description", patch.description);
    form.append("thumb", patch.thumb);
    return apiFetch<{ site: SiteRow }>(
      `/api/sites/${encodeURIComponent(siteId)}`,
      { method: "PATCH", body: form },
      true,
    );
  }
  return apiFetch<{ site: SiteRow }>(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name: patch.name, description: patch.description }),
  });
}

export function deleteSite(siteId: string) {
  return apiFetch<{ success: true }>(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });
}

// ── 세부 프로젝트 ────────────────────────────────────────────────────────────

const PROJECTS = "/api/tc-rental-projects";

export interface TcProjectRow {
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
export interface TcRevSummary {
  buildings?: number;
  units?: number;
  totalMonths?: number;
  idleDays?: number;
  siteName?: string;
}

export interface TcRevisionMeta {
  id: string;
  rev_no: number;
  memo: string | null;
  summary: TcRevSummary | null;
  schema_ver: number;
  created_by: string | null;
  created_at: string;
}

export interface TcRevisionFull extends TcRevisionMeta {
  project_id: string;
  plan: TcRentalPlan;
}

export function listProjects() {
  return apiFetch<{ projects: TcProjectRow[] }>(PROJECTS);
}

export function getProject(projectId: string) {
  return apiFetch<{ project: TcProjectRow; revisions: TcRevisionMeta[] }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}`,
  );
}

export function createProject(name: string, siteId: string | null, description?: string) {
  return apiFetch<{ project: TcProjectRow }>(PROJECTS, {
    method: "POST",
    body: JSON.stringify({ name, siteId, description }),
  });
}

export function updateProject(
  projectId: string,
  patch: { name?: string; description?: string; siteId?: string | null },
) {
  return apiFetch<{ project: TcProjectRow }>(`${PROJECTS}/${encodeURIComponent(projectId)}`, {
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
  return apiFetch<{ revision: TcRevisionFull }>(
    `${PROJECTS}/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revId)}`,
  );
}

export function saveRevision(
  projectId: string,
  plan: TcRentalPlan,
  summary: TcRevSummary,
  memo?: string,
) {
  return apiFetch<{ revision: TcRevisionMeta }>(
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
