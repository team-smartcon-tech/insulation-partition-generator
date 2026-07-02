/**
 * 인증 API 클라이언트 — 신규 Worker의 /api/auth/* 호출.
 * 세션은 HttpOnly 쿠키(ipg_session)로 관리되므로 토큰을 JS에서 다루지 않는다.
 * 동일 오리진이라 credentials:'include' 로 쿠키를 함께 보낸다.
 */
const BASE = "/api/auth";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role?: string;
}

async function j<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError((data as { error?: string })?.error || `인증 오류 (${res.status})`, res.status);
  }
  return data as T;
}

/** 로그인 (이메일 + 비밀번호, SSX 동일) */
export function postLogin(body: {
  email: string;
  password: string;
}): Promise<{ ok: true; user: AuthUser }> {
  return j("/login", { method: "POST", body: JSON.stringify(body) });
}

export function postLogout(): Promise<{ ok: true }> {
  return j("/logout", { method: "POST" });
}

/** 현재 세션 확인 (미인증 시 401 → AuthError) */
export function getMe(): Promise<{ user: AuthUser }> {
  return j("/me");
}
