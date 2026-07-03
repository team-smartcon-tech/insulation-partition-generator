/**
 * DCR 통합로그인(회원) — 인증 모듈
 *
 * 방식(신뢰 경계 최소화):
 *   1) 신규 Worker가 자격증명(이메일+비밀번호, SSX 로그인과 동일)을 받아 DCR /auth/login 을
 *      서버-투-서버로 호출(검증 위임).
 *   2) DCR 응답 {ok, user} 만 신뢰하고, **신규 앱 자체 시크릿(IPG_JWT_SECRET)** 으로
 *      audience/issuer='insulation-partition-generator' + 짧은 만료의 **자체 세션 토큰**을 재발급.
 *      → DCR 의 JWT_SECRET 을 공유하지 않으므로, 이 토큰이 유출돼도 DCR 본체엔 통하지 않음.
 *   3) 이후 /api/* 요청은 HttpOnly 쿠키(ipg_session)의 자체 토큰을 로컬 검증.
 *
 * dev/prod 분리: DCR_BASE_URL(또는 DCR_APP 바인딩)을 환경별로 dcr-app-dev / dcr-app 로 가리킨다.
 * PII: DCR 응답의 복호화된 phone 등은 취하지 않고 즉시 버린다(로깅/영속 금지).
 */
import type { MiddlewareHandler } from "hono";
import { SignJWT, jwtVerify } from "jose";

/** 로그인 rate-limit용 최소 KV 인터페이스(선택 바인딩) */
interface IpgKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** DXF 저장 버킷 이름 (미설정 시 elev-dxf). */
  ELEV_DXF_BUCKET?: string;
  /** 신규 앱 자체 세션 토큰 서명/검증 시크릿 — DCR 것과 별개! 필수(미설정 시 로그인 500). */
  IPG_JWT_SECRET?: string;
  /** DCR 로그인 백엔드 base URL. dev=dcr-app-dev, prod=dcr-app. DCR_APP 바인딩 없을 때 사용. */
  DCR_BASE_URL?: string;
  /** (선택) dcr-app 서비스 바인딩. 있으면 우선 사용(동일 계정). */
  DCR_APP?: { fetch: (input: Request) => Promise<Response> };
  /** 세션 쿠키 이름(기본 ipg_session) */
  COOKIE_NAME?: string;
  /** "false" 면 Secure 미부여(로컬 http dev용). 기본 Secure 부여. */
  COOKIE_SECURE?: string;
  /** (선택) 로그인 rate-limit용 KV. 없으면 제한 생략(문서화). */
  RATE_LIMIT?: IpgKV;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** 자체 토큰 issuer/audience — DCR('dcr-app')와 구분 */
const AUD = "insulation-partition-generator";
/** 세션 수명(초) — 짧게 유지(폐기 불가 완화). 12시간 */
const SESSION_TTL_SEC = 12 * 60 * 60;
/** 허용 role 화이트리스트 — DCR /auth/login 이 발급하는 계정 유형(직원/회원). */
const ALLOWED_ROLES = new Set(["super_admin", "system_admin", "site_admin", "member"]);

const cookieName = (env: Env) => env.COOKIE_NAME || "ipg_session";

function secretKey(env: Env): Uint8Array {
  if (!env.IPG_JWT_SECRET) throw new Error("IPG_JWT_SECRET 미설정");
  return new TextEncoder().encode(env.IPG_JWT_SECRET);
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/** 자체 세션 토큰 발급(HS256, IPG_JWT_SECRET) */
export async function signSession(env: Env, user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(AUD)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secretKey(env));
}

/** 자체 세션 토큰 로컬 검증. 실패 시 null. */
export async function verifySession(env: Env, token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(env), {
      issuer: AUD,
      audience: AUD,
    });
    if (!payload.sub) return null;
    return {
      id: String(payload.sub),
      name: typeof payload.name === "string" ? payload.name : "",
      email: typeof payload.email === "string" ? payload.email : "",
      // role 클레임이 없으면 빈 문자열 → isAllowedRole 에서 거부(fail-closed).
      role: typeof payload.role === "string" ? payload.role : "",
    };
  } catch {
    return null;
  }
}

export function buildSessionCookie(env: Env, token: string): string {
  const secure = env.COOKIE_SECURE === "false" ? "" : " Secure;";
  return `${cookieName(env)}=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function buildLogoutCookie(env: Env): string {
  const secure = env.COOKIE_SECURE === "false" ? "" : " Secure;";
  return `${cookieName(env)}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
}

export interface DcrLoginResult {
  ok: boolean;
  status: number;
  user?: { id: string; name: string; email: string; role: string };
  error?: string;
}

/**
 * DCR /auth/login 서버-투-서버 호출(공개 URL 우선 → 서비스 바인딩 폴백). SSX 로그인과 동일(이메일+비밀번호).
 * 브라우저가 아니라 Worker가 호출하므로 CORS 무관.
 * 응답에서 id/name/email/role 만 취하고 token 등은 버린다(자체 토큰 재발급 사용).
 */
export async function callDcrLogin(
  env: Env,
  body: { email: string; password: string },
): Promise<DcrLoginResult> {
  const path = "/api/auth/login";
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password, remember: true }),
  };

  let res: Response;
  try {
    // 우선순위: DCR_BASE_URL(로컬 .dev.vars 전용) → DCR_APP 바인딩(prod).
    // 로컬 wrangler dev 는 DCR_APP 바인딩을 주입하지만 dcr-app 이 로컬에 안 떠 있어 5xx 를 돌려주므로,
    // 로컬은 .dev.vars 의 DCR_BASE_URL 로 공개 URL 을 직접 fetch(localhost 프로세스라 정상 동작).
    // prod 는 vars 에 DCR_BASE_URL 을 두지 않으므로 바인딩을 사용(같은 계정 workers.dev fetch 회피).
    if (env.DCR_BASE_URL) {
      res = await fetch(`${env.DCR_BASE_URL.replace(/\/$/, "")}${path}`, init);
    } else if (env.DCR_APP) {
      res = await env.DCR_APP.fetch(new Request(`https://dcr-app${path}`, init));
    } else {
      return { ok: false, status: 500, error: "DCR 로그인 백엔드 미설정 (DCR_BASE_URL/DCR_APP)" };
    }
  } catch (e) {
    console.error("[auth] DCR 호출 실패:", e instanceof Error ? e.message : String(e));
    return { ok: false, status: 502, error: "인증 서버 연결 실패" };
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    user?: { id?: string; name?: string; email?: string; role?: string; kind?: string };
  };
  if (!res.ok || !data?.ok || !data.user?.id) {
    return { ok: false, status: res.status || 401, error: data?.error || "로그인 실패" };
  }
  const u = data.user;
  return {
    ok: true,
    status: 200,
    user: {
      id: String(u.id),
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: String(u.role ?? u.kind ?? ""),
    },
  };
}

/** 로그인 rate-limit — KV 바인딩 있을 때만. IP당 15분 20회. 미구성 시 통과. */
export async function checkLoginRateLimit(env: Env, ip: string): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;
  try {
    const key = `login:${ip}`;
    const cur = Number((await env.RATE_LIMIT.get(key)) || 0);
    if (cur >= 20) return false;
    await env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: 900 });
    return true;
  } catch {
    return true; // KV 오류 시 로그인 자체를 막지 않음
  }
}

export function isAllowedRole(role: string): boolean {
  return ALLOWED_ROLES.has(role);
}

/** /api/* 보호 미들웨어. /health 및 /api/auth/* 는 통과. */
export const authMiddleware = (): MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> =>
  async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/health" || path.startsWith("/api/auth/")) return next();
    const token = parseCookie(c.req.header("Cookie") ?? null, cookieName(c.env));
    const user = token ? await verifySession(c.env, token) : null;
    if (!user) return c.json({ error: "인증이 필요합니다." }, 401);
    if (!isAllowedRole(user.role)) return c.json({ error: "접근 권한이 없습니다." }, 403);
    c.set("user", user);
    return next();
  };
