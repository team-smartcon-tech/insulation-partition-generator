/**
 * 프로젝트/리비전(REV) API 클라이언트
 *
 * 경로: /api/elevation-projects* → 이 저장소의 Worker(apps/worker) → Supabase
 *   - public.elev_projects / public.elev_revisions
 *   - DXF 원본은 Storage(비공개 버킷), 저장은 multipart/form-data
 * 인증: 현재 없음(열린 결정 §6-1 추천안). 도입 시 이 파일에서 헤더만 추가하면 됨.
 * 개발 서버에서는 vite proxy 가 /api → 로컬 wrangler(8787) 로 전달한다.
 */

import type {
  ElevState,
  ElevSummary,
  DbElevProject,
  DbElevRevisionMeta,
  DbElevRevisionFull,
} from "@ipg/shared";

const BASE = "/api/elevation-projects";

export class ElevApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ElevApiError";
    this.status = status;
    this.body = body;
  }
}

async function elevFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  // FormData 는 Content-Type 을 브라우저가 boundary 포함해 설정하므로 지정하지 않는다.
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, { ...options, credentials: "include", headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 세션 만료/미인증 → 인증 컨텍스트에 알려 /login 으로 유도
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("ipg-auth-expired"));
    }
    throw new ElevApiError(
      (body as { error?: string })?.error || `프로젝트 API 오류 (${res.status})`,
      res.status,
      body,
    );
  }
  return res.json() as Promise<T>;
}

/** 프로젝트 목록 */
export async function listElevProjects(): Promise<{ projects: DbElevProject[] }> {
  return elevFetch<{ projects: DbElevProject[] }>("");
}

/** 프로젝트 + 리비전 메타 목록(state 제외) */
export async function getElevProject(
  projectId: string,
): Promise<{ project: DbElevProject; revisions: DbElevRevisionMeta[] }> {
  return elevFetch(`/${encodeURIComponent(projectId)}`);
}

/** 단일 REV 전체(state) + DXF signed URL */
export async function getElevRevision(
  projectId: string,
  revId: string,
): Promise<{ revision: DbElevRevisionFull; dxfSignedUrl: string | null }> {
  return elevFetch(
    `/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revId)}`,
  );
}

/** 신규 프로젝트 생성 */
export async function createElevProject(
  name: string,
  description?: string,
): Promise<{ project: DbElevProject }> {
  return elevFetch("", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

/** 프로젝트 이름/설명 수정 */
export async function renameElevProject(
  projectId: string,
  patch: { name?: string; description?: string },
): Promise<{ project: DbElevProject }> {
  return elevFetch(`/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** 프로젝트 삭제(리비전·DXF 포함) */
export async function deleteElevProject(
  projectId: string,
): Promise<{ success: boolean }> {
  return elevFetch(`/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

/** 리비전 삭제 */
export async function deleteElevRevision(
  projectId: string,
  revId: string,
): Promise<{ success: boolean }> {
  return elevFetch(
    `/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revId)}`,
    { method: "DELETE" },
  );
}

/**
 * DXF 원본을 gzip 으로 압축한다(텍스트라 보통 1/10 이하).
 *
 * Supabase Storage 는 프로젝트 단위 업로드 상한(플랜 제한)이 있어, 큰 백도면을
 * 원본 그대로 올리면 413 EntityTooLarge 로 저장이 실패한다. 압축하면 상한 안에
 * 들어가고 업로드/다운로드도 빨라진다.
 * CompressionStream 미지원 브라우저면 null → 원본 그대로 업로드(기존 동작).
 */
async function gzipFile(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream as unknown as ReadableStream).blob();
  } catch {
    return null;
  }
}

/**
 * 저장된 DXF 를 텍스트로 읽는다. `.gz` 로 저장된 REV 는 풀어서 반환한다.
 * (서버가 이미 풀어서 내려주는 경우도 있어, 실패하면 원문 디코딩으로 폴백)
 */
export async function fetchDxfText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`도면 파일 다운로드 실패 (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  const isGzip = head[0] === 0x1f && head[1] === 0x8b; // gzip 매직넘버
  if (isGzip && typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([buf])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream as unknown as ReadableStream).text();
    } catch {
      /* 폴백: 아래 원문 디코딩 */
    }
  }
  return new TextDecoder().decode(buf);
}

/**
 * 새 REV 저장(append).
 *  - dxfFile 첨부 시 새 DXF 업로드(gzip 압축). 미첨부 + reuse 지정 시 직전 REV DXF 경로 재사용.
 */
export async function saveElevRevision(
  projectId: string,
  args: {
    state: ElevState;
    summary?: ElevSummary;
    memo?: string;
    dxfFile?: File | null;
    /** DXF 변경 없을 때 직전 REV 의 경로 재사용 */
    reuse?: { dxfPath: string; dxfName: string | null; dxfSize: number | null } | null;
  },
): Promise<{ revision: DbElevRevisionFull }> {
  const fd = new FormData();
  fd.append("state", JSON.stringify(args.state));
  if (args.summary) fd.append("summary", JSON.stringify(args.summary));
  if (args.memo) fd.append("memo", args.memo);
  if (args.dxfFile) {
    const gz = await gzipFile(args.dxfFile);
    if (gz) {
      // 파일명/원본 크기는 따로 보내고, 업로드 본체만 압축본으로 교체
      fd.append("file", gz, `${args.dxfFile.name}.gz`);
      fd.append("dxfGzip", "1");
      fd.append("dxfName", args.dxfFile.name);
      fd.append("dxfSize", String(args.dxfFile.size));
    } else {
      fd.append("file", args.dxfFile, args.dxfFile.name);
    }
  } else if (args.reuse?.dxfPath) {
    fd.append("dxfPath", args.reuse.dxfPath);
    if (args.reuse.dxfName) fd.append("dxfName", args.reuse.dxfName);
    if (args.reuse.dxfSize != null) fd.append("dxfSize", String(args.reuse.dxfSize));
  }
  return elevFetch(
    `/${encodeURIComponent(projectId)}/revisions`,
    { method: "POST", body: fd },
    true,
  );
}
