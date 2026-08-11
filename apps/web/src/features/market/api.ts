/**
 * App Market API 클라이언트
 *
 * 경로: /api/market/* → 이 저장소의 Worker(apps/worker/src/market.ts) → Supabase
 * 인증: 세션 쿠키(credentials: include). 401 이면 인증 컨텍스트에 만료를 알린다
 *       (features/elevation/api.ts 와 동일한 규약 — "ipg-auth-expired" 이벤트).
 */
import type {
  MarketAppDetail,
  MarketAppInput,
  MarketAppSummary,
  MarketAppVersion,
} from "./types";

const BASE = "/api/market";

export class MarketApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MarketApiError";
    this.status = status;
  }
}

async function marketFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  // FormData 는 브라우저가 boundary 포함해 Content-Type 을 설정하므로 지정하지 않는다.
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, { ...options, credentials: "include", headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    }
    throw new MarketApiError(body?.error || `App Market API 오류 (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

/** 게시된 도구 목록 */
export function listMarketApps() {
  return marketFetch<{ apps: MarketAppSummary[]; canPublish: boolean }>("/apps");
}

/** 상세 (스크린샷 + 버전 이력) */
export function getMarketApp(appId: string) {
  return marketFetch<{
    app: MarketAppDetail;
    versions: MarketAppVersion[];
    canManage: boolean;
  }>(`/apps/${encodeURIComponent(appId)}`);
}

/** 새 도구 게시 (관리자) */
export function publishMarketApp(input: MarketAppInput, shots: File[]) {
  const form = new FormData();
  form.append("title", input.title);
  form.append("deployUrl", input.deployUrl);
  form.append("repoUrl", input.repoUrl);
  form.append("platformType", input.platformType);
  form.append("location", input.location);
  form.append("category", input.category);
  form.append("version", input.version);
  form.append("team", input.team);
  form.append("description", input.description);
  form.append("owners", JSON.stringify(input.owners));
  form.append("tags", JSON.stringify(input.tags));
  for (const file of shots) form.append("shots", file, file.name);

  return marketFetch<{ app: MarketAppSummary }>(
    "/apps",
    { method: "POST", body: form },
    true,
  );
}

/** 조회수 +1 (상세 진입 시 1회) */
export function bumpMarketAppView(appId: string) {
  return marketFetch<{ ok: boolean }>(`/apps/${encodeURIComponent(appId)}/view`, {
    method: "POST",
  });
}

/** 좋아요 토글 */
export function toggleMarketAppLike(appId: string) {
  return marketFetch<{ liked: boolean; likeCount: number }>(
    `/apps/${encodeURIComponent(appId)}/like`,
    { method: "POST" },
  );
}

/** 버전 이력 추가 (관리자) */
export function addMarketAppVersion(appId: string, version: string, note?: string) {
  return marketFetch<{ version: MarketAppVersion }>(
    `/apps/${encodeURIComponent(appId)}/versions`,
    { method: "POST", body: JSON.stringify({ version, note }) },
  );
}

/** 게시 삭제 (관리자) */
export function deleteMarketApp(appId: string) {
  return marketFetch<{ ok: boolean }>(`/apps/${encodeURIComponent(appId)}`, {
    method: "DELETE",
  });
}
