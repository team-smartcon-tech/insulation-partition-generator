// SSX → 단열 Layout 자동 로그인(GET /api/auth/sso) 회귀 테스트.
// 실행: `pnpm --filter worker test` (Node 내장 러너 + tests/register.mjs 로더)
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SignJWT } from "jose"
import app from "../src/index.ts"
import { verifySsoToken, verifySession } from "../src/auth.ts"

const SSO_SECRET = "sso-secret-for-test-0123456789abcdef"
const IPG_SECRET = "ipg-secret-for-test-0123456789abcdef"
const ENV = { SSO_JWT_SECRET: SSO_SECRET, IPG_JWT_SECRET: IPG_SECRET } as never

type Claims = Record<string, unknown>
const enc = (s: string) => new TextEncoder().encode(s)

interface MintOpts {
  secret?: string
  iss?: string | null
  aud?: string | null
  exp?: string | number | null
  alg?: string
  claims?: Claims
}

/** 기본값 = SSX 발급 계약 그대로. 각 테스트가 한 축만 바꾼다. */
async function mint(o: MintOpts = {}): Promise<string> {
  const claims: Claims = {
    sub: "user-1",
    id: "user-1",
    email: "a@b.c",
    name: "홍길동",
    role: "member",
    token_use: "ipg_sso",
    ...o.claims,
  }
  for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k]
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: o.alg ?? "HS256", typ: "JWT" }).setIssuedAt()
  if (o.iss !== null) jwt.setIssuer(o.iss ?? "smart-works")
  if (o.aud !== null) jwt.setAudience(o.aud ?? "insulation-partition-generator")
  if (o.exp !== null) jwt.setExpirationTime(o.exp ?? "60s")
  return jwt.sign(enc(o.secret ?? SSO_SECRET))
}

const ssoReq = (token?: string, extra = "") =>
  app.request(`/api/auth/sso${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}${extra}`, {}, ENV)

function assertFailedRedirect(res: Response) {
  assert.equal(res.status, 302)
  assert.equal(res.headers.get("Location"), "/")
  assert.equal(res.headers.get("Set-Cookie"), null, "실패 시 쿠키를 구우면 안 된다")
  assert.equal(res.headers.get("Cache-Control"), "no-store")
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer")
}

describe("GET /api/auth/sso — 정상", () => {
  it("302 / + ipg_session 쿠키, 그 쿠키로 /api/auth/me 200 (SSO 토큰 클레임이 세션에 반영)", async () => {
    const res = await ssoReq(await mint())
    assert.equal(res.status, 302)
    assert.equal(res.headers.get("Location"), "/")
    assert.equal(res.headers.get("Cache-Control"), "no-store")
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer")
    const setCookie = res.headers.get("Set-Cookie")!
    assert.match(setCookie, /^ipg_session=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=43200$/)

    const cookie = setCookie.split(";")[0]
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } }, ENV)
    assert.equal(me.status, 200)
    assert.deepEqual(await me.json(), {
      user: { id: "user-1", name: "홍길동", email: "a@b.c", role: "member" },
    })
  })

  it("발급된 세션은 SSO 시크릿이 아니라 IPG_JWT_SECRET 으로 서명된다", async () => {
    const res = await ssoReq(await mint())
    const token = decodeURIComponent(res.headers.get("Set-Cookie")!.split(";")[0].split("=")[1])
    assert.ok(await verifySession({ IPG_JWT_SECRET: IPG_SECRET } as never, token))
    assert.equal(await verifySession({ IPG_JWT_SECRET: SSO_SECRET } as never, token), null)
  })

  it("SSO 토큰 자체를 ipg_session 쿠키로 들이밀면 /me 401 (토큰 혼용 불가)", async () => {
    const t = await mint()
    const me = await app.request("/api/auth/me", { headers: { Cookie: `ipg_session=${t}` } }, ENV)
    assert.equal(me.status, 401)
  })

  it("COOKIE_SECURE=false 면 Secure 없이 굽는다(로컬 http)", async () => {
    const res = await app.request(`/api/auth/sso?token=${await mint()}`, {}, { ...(ENV as object), COOKIE_SECURE: "false" })
    assert.doesNotMatch(res.headers.get("Set-Cookie")!, /Secure/)
  })
})

describe("GET /api/auth/sso — 거부(모두 쿠키 없이 302 /)", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["token 쿼리 없음", () => ssoReq()],
    ["token 빈 값", () => ssoReq("")],
    ["쓰레기 문자열 토큰", () => ssoReq("not-a-jwt")],
    ["다른 시크릿으로 서명", async () => ssoReq(await mint({ secret: "another-secret-0123456789abcdef" }))],
    ["IPG_JWT_SECRET 으로 서명(시크릿 혼용)", async () => ssoReq(await mint({ secret: IPG_SECRET }))],
    ["iss 다름", async () => ssoReq(await mint({ iss: "evil" }))],
    ["iss 없음", async () => ssoReq(await mint({ iss: null }))],
    ["aud 다름(소음예측용 토큰)", async () => ssoReq(await mint({ aud: "construction-noise-predictor" }))],
    ["aud 없음", async () => ssoReq(await mint({ aud: null }))],
    ["만료(10분 전)", async () => ssoReq(await mint({ exp: Math.floor(Date.now() / 1000) - 600 }))],
    ["exp 없음", async () => ssoReq(await mint({ exp: null }))],
    ["token_use 다름(noise_sso)", async () => ssoReq(await mint({ claims: { token_use: "noise_sso" } }))],
    ["token_use 없음", async () => ssoReq(await mint({ claims: { token_use: undefined } }))],
    ["허용 외 role(guest)", async () => ssoReq(await mint({ claims: { role: "guest" } }))],
    ["허용 외 role(partner)", async () => ssoReq(await mint({ claims: { role: "partner" } }))],
    ["role 없음", async () => ssoReq(await mint({ claims: { role: undefined } }))],
    ["id ≠ sub", async () => ssoReq(await mint({ claims: { id: "user-2", sub: "user-1" } }))],
    ["id·sub 둘 다 없음", async () => ssoReq(await mint({ claims: { id: undefined, sub: undefined } }))],
    ["id·sub 공백뿐", async () => ssoReq(await mint({ claims: { id: "  ", sub: "  " } }))],
    ["alg HS512(HS256 만 허용)", async () => ssoReq(await mint({ alg: "HS512" }))],
  ]
  for (const [name, run] of cases) {
    it(name, async () => assertFailedRedirect(await run()))
  }

  it("alg=none 위조 토큰", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
    const now = Math.floor(Date.now() / 1000)
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: "x", id: "x", role: "super_admin", token_use: "ipg_sso",
      iss: "smart-works", aud: "insulation-partition-generator", exp: now + 60,
    })}.`
    assertFailedRedirect(await ssoReq(forged))
  })

  it("SSO_JWT_SECRET 미설정이면 유효해 보이는 토큰도 거부(SSO 꺼짐) — 빈 문자열 시크릿 포함", async () => {
    const t = await mint()
    for (const env of [{ IPG_JWT_SECRET: IPG_SECRET }, { IPG_JWT_SECRET: IPG_SECRET, SSO_JWT_SECRET: "" }]) {
      assertFailedRedirect(await app.request(`/api/auth/sso?token=${t}`, {}, env as never))
    }
    // SSO_JWT_SECRET 이 빈 값이면 어떤 키로 서명한 토큰도(여기선 "x") 통과하지 못해야 한다.
    const emptyKey = await new SignJWT({ sub: "x", id: "x", role: "super_admin", token_use: "ipg_sso" })
      .setProtectedHeader({ alg: "HS256" }).setIssuer("smart-works").setAudience("insulation-partition-generator")
      .setExpirationTime("60s").sign(enc("x"))
    assertFailedRedirect(await app.request(`/api/auth/sso?token=${emptyKey}`, {}, { IPG_JWT_SECRET: IPG_SECRET, SSO_JWT_SECRET: "" } as never))
  })

  it("IPG_JWT_SECRET 미설정(세션 서명 불가)이어도 쿠키 없이 302 /", async () => {
    assertFailedRedirect(await app.request(`/api/auth/sso?token=${await mint()}`, {}, { SSO_JWT_SECRET: SSO_SECRET } as never))
  })
})

describe("GET /api/auth/sso — 이동 대상 고정(오픈 리다이렉트)", () => {
  it("next/redirect/returnTo 에 외부 URL 을 붙여도 Location 은 / (성공·실패 모두)", async () => {
    const extra = "&next=https://evil.example/&redirect=//evil.example&returnTo=https://evil.example"
    const ok = await ssoReq(await mint(), extra)
    assert.equal(ok.status, 302)
    assert.equal(ok.headers.get("Location"), "/")
    assert.ok(ok.headers.get("Set-Cookie"))
    const bad = await ssoReq("garbage", extra)
    assert.equal(bad.headers.get("Location"), "/")
  })
})

describe("GET /api/auth/sso — 재사용(사용자 결정: jti 없음, 60초 창)", () => {
  it("같은 토큰을 두 번 써도 둘 다 통과한다(현 동작 고정 — 재사용 방지가 생기면 이 테스트를 바꿔야 한다)", async () => {
    const t = await mint()
    assert.ok((await ssoReq(t)).headers.get("Set-Cookie"))
    assert.ok((await ssoReq(t)).headers.get("Set-Cookie"))
  })
})

describe("verifySsoToken 단위", () => {
  const env = { SSO_JWT_SECRET: SSO_SECRET } as never
  it("reason 구분: no_secret / invalid_token / bad_claims / role_not_allowed", async () => {
    assert.deepEqual(await verifySsoToken({} as never, await mint()), { ok: false, reason: "no_secret" })
    assert.deepEqual(await verifySsoToken(env, "x.y.z"), { ok: false, reason: "invalid_token" })
    assert.deepEqual(await verifySsoToken(env, await mint({ claims: { token_use: "session" } })), { ok: false, reason: "bad_claims" })
    assert.deepEqual(await verifySsoToken(env, await mint({ claims: { role: "guest" } })), { ok: false, reason: "role_not_allowed" })
  })
  it("sub 만 있거나 id 만 있어도 userId 로 쓰고, name/email 이 없으면 빈 문자열", async () => {
    const onlySub = await verifySsoToken(env, await mint({ claims: { id: undefined, name: undefined, email: undefined } }))
    assert.deepEqual(onlySub, { ok: true, user: { id: "user-1", name: "", email: "", role: "member" } })
    const onlyId = await verifySsoToken(env, await mint({ claims: { sub: undefined } }))
    assert.equal(onlyId.ok && onlyId.user.id, "user-1")
  })
  it("만료 5초 이내는 시계 오차로 허용, 그 이상은 거부(경계)", async () => {
    const now = Math.floor(Date.now() / 1000)
    assert.equal((await verifySsoToken(env, await mint({ exp: now - 2 }))).ok, true)
    assert.equal((await verifySsoToken(env, await mint({ exp: now - 30 }))).ok, false)
  })
  it("4개 허용 role 은 통과", async () => {
    for (const role of ["super_admin", "system_admin", "site_admin", "member"]) {
      assert.equal((await verifySsoToken(env, await mint({ claims: { role } }))).ok, true, role)
    }
  })
})
