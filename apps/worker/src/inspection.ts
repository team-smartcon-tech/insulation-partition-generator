/**
 * 검측요청 플랫폼 연결 — /api/inspection/*
 *
 * 검측요청(별도 서비스, 저장소 wm-pi/Inspection-Request)은 감리단·협력사도 쓰는 독립 앱이라
 * 스마트 공정표처럼 이 앱 안으로 옮기지 않고, 툴박스 로그인을 넘겨 주는 방식으로 붙인다.
 *
 * 흐름:
 *   1. 홈의 '검측요청' 카드 → /tools/inspection → POST /api/inspection/handoff
 *   2. 여기서 로그인 사용자(세션)의 현장 권한을 스마트웍스에서 읽어 **60초짜리 연결 토큰**을 서명한다
 *      (HS256, INSPECTION_SSO_SECRET — 이 앱의 IPG_JWT_SECRET·DCR 의 JWT_SECRET 과 별개).
 *   3. 화면이 {INSPECTION_URL}/sso#t=<토큰> 으로 이동 → 검측요청이 토큰을 검증하고 자체 세션을 만든다.
 *
 * 토큰은 주소의 # 뒤(fragment)에 실어 서버 로그·Referer 에 남지 않게 한다.
 * 스마트웍스 DB 는 읽기만 한다(gantt.ts 와 같은 규칙).
 */
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env, SessionUser } from "./auth";
import { errMsg } from "./supabaseClient";

const inspection = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>();

/** 검측요청이 검증하는 issuer/audience — 이 앱의 세션 토큰('insulation-partition-generator')과 구분 */
const ISSUER = "smart-toolbox";
const AUDIENCE = "inspection-request";
/** 이동 한 번에만 쓰면 되므로 짧게 */
const TOKEN_TTL_SEC = 60;

/** 전 현장을 보는 스마트웍스 역할 */
const ALL_SITE_ROLES = new Set(["super_admin", "system_admin"]);

async function dcrGet<T>(env: Env, path: string): Promise<T> {
  if (!env.DCR_SUPABASE_URL || !env.DCR_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("스마트웍스(DCR) 연결 키가 설정되지 않았습니다 (DCR_SUPABASE_URL / DCR_SUPABASE_SERVICE_ROLE_KEY).");
  }
  const res = await fetch(`${env.DCR_SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: env.DCR_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.DCR_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`스마트웍스 조회 실패 (${res.status})`);
  return (await res.json()) as T;
}

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/**
 * 이 사용자가 들어갈 수 있는 현장 {id, name}.
 * super_admin·system_admin 은 전 현장, 그 외는 admins.managed_sites → people.managed_sites 순
 * (스마트 공정표 SSO 의 보강 규칙과 같다).
 */
async function sitesFor(env: Env, user: SessionUser): Promise<{ id: string; name: string }[]> {
  let ids: string[] | null = null;
  if (!ALL_SITE_ROLES.has(user.role)) {
    const people = await dcrGet<{ id: string; managed_sites: unknown }[]>(
      env,
      `/people?select=id,managed_sites&email=eq.${encodeURIComponent(user.email)}&limit=1`,
    );
    const person = people[0];
    if (!person) return [];
    const admins = await dcrGet<{ managed_sites: unknown }[]>(
      env,
      `/admins?select=managed_sites&person_id=eq.${encodeURIComponent(person.id)}&limit=1`,
    );
    const adminSites = asIds(admins[0]?.managed_sites);
    ids = adminSites.length > 0 ? adminSites : asIds(person.managed_sites);
    if (ids.length === 0) return [];
  }
  const filter = ids ? `&id=in.(${ids.map((id) => encodeURIComponent(`"${id}"`)).join(",")})` : "";
  return dcrGet<{ id: string; name: string }[]>(env, `/sites?select=id,name&order=name.asc${filter}`);
}

/**
 * POST /handoff — 검측요청으로 넘어갈 주소를 만든다.
 * 요청: { siteId? } — 스마트 공정표에서 고르던 현장 등, 먼저 열고 싶은 현장(권한 안일 때만 채택된다)
 * 응답: { url }
 */
inspection.post("/handoff", async (c) => {
  const { env } = c;
  if (!env.INSPECTION_SSO_SECRET || !env.INSPECTION_URL) {
    return c.json({ error: "검측요청 연결 설정(INSPECTION_SSO_SECRET / INSPECTION_URL)이 없습니다." }, 503);
  }
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { siteId?: unknown };

  try {
    const sites = await sitesFor(env, user);
    const token = await new SignJWT({
      email: user.email,
      name: user.name,
      role: user.role,
      sites,
      siteId: typeof body.siteId === "string" ? body.siteId : undefined,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SEC}s`)
      .sign(new TextEncoder().encode(env.INSPECTION_SSO_SECRET));

    return c.json({ url: `${env.INSPECTION_URL.replace(/\/$/, "")}/sso#t=${token}` });
  } catch (e) {
    console.error("[inspection/handoff]", errMsg(e));
    return c.json({ error: "검측요청 연결 정보를 만들지 못했습니다." }, 503);
  }
});

export default inspection;
