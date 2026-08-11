/**
 * Supabase REST / Storage 공용 헬퍼
 *
 * ⚠️ index.ts 안에도 동일한 헬퍼가 남아 있다(단열재 나누기도 전용). 그쪽은 이미 검증돼
 * 운영 중인 경로라 손대지 않기로 했고, 신규 기능(App Market)은 이 모듈을 쓴다.
 * 나중에 index.ts 를 정리할 기회가 있으면 이쪽으로 일원화한다.
 */
import type { Env } from "./auth";

/** Supabase PostgREST 호출 (service_role 키 사용 — 서버 전용) */
export async function supabaseRest(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, unknown> | Record<string, unknown>[],
  prefer = "return=representation",
): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase 환경 설정 누락 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Postgres 함수 호출 (`/rest/v1/rpc/{name}`) */
export async function supabaseRpc(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return supabaseRest(env, "POST", `/rpc/${fn}`, args, "return=representation");
}

export async function storageUpload(
  env: Env,
  bucket: string,
  objectPath: string,
  fileBuffer: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Storage 업로드 실패 (${res.status}): ${await res.text()}`);
}

export async function storageDelete(
  env: Env,
  bucket: string,
  objectPaths: string[],
): Promise<void> {
  if (objectPaths.length === 0) return;
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: objectPaths }),
  });
  if (!res.ok) throw new Error(`Storage 삭제 실패 (${res.status}): ${await res.text()}`);
}

/** 비공개 버킷 파일의 임시 조회 URL (TTL 기본 1시간) */
export async function storageSignedUrl(
  env: Env,
  bucket: string,
  objectPath: string,
  expiresIn = 3600,
): Promise<string> {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Signed URL 생성 실패 (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { signedURL: string };
  return `${env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}

export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
