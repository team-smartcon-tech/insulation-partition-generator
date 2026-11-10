---
type: system
updated: 2026-11-10
tags: [area/auth, domain/sso]
---

# 로그인과 SSX 자동 로그인(SSO)

단열 Layout 의 로그인 벽 — 직접 로그인(DCR 자격증명 위임)과 SSX 바로가기 자동 로그인(SSO) 두 입구가 같은 `ipg_session` 쿠키로 모인다.

## 무엇인가

- **직접 로그인** `POST /api/auth/login`: 이메일+비밀번호를 dcr-app `/api/auth/login` 에 서버-투-서버로 넘겨 확인 → 자체 `IPG_JWT_SECRET` 으로 12h 세션(`ipg_session`, HttpOnly). 커밋 `0bb254a`·`2a2c9bc`(2026-07-02~03).
- **SSX 자동 로그인** `GET /api/auth/sso?token=…`(`feature/ssx-sso-ipg`, 2026-11-10): SSX 홈 바로가기 「단열 Layout」 → SSX `GET /api/sso/insulation-layout`(세션 쿠키 인증) → 60초 JWT → 이 라우트가 검증 후 같은 `ipg_session` 을 굽고 `/` 로. 실패는 쿠키 없이 `/`(로그인 화면).
- 토큰 계약(양쪽 고정): HS256, 시크릿 IPG `SSO_JWT_SECRET` = SSX `IPG_SSO_JWT_SECRET`(전용 값), iss `smart-works`, aud `insulation-partition-generator`, `token_use: ipg_sso`, 허용 role super_admin·system_admin·site_admin·member. 검증 `apps/worker/src/auth.ts` `verifySsoToken`, 발급 SSX `worker/lib/external/insulationLayoutSso.ts`.
- 같은 구조의 선례: SSX → 소음예측 `noisePredictorSso.ts`.

## 저장 구조

DB 없음. 세션은 서명 쿠키뿐(서버 저장 없음 → 폐기 불가, 그래서 12h 로 짧게). SSO 토큰도 저장하지 않는다 — **jti 재사용 방지 없음**(사용자 결정 2026-11-10, 소음예측과 동일).

## 데었던 것 — 규칙이 된 것

- **"SSO 가 고장났다"는 오해 (2026-11-10)**: 원래 구현은 SSO 가 아니라 "같은 계정으로 따로 로그인"이었다. SSX 의 자동 로그인은 소음예측에만 있었다. 인증이 "연결돼 있다"는 기억은 코드(`auth.ts` 머리 주석)로 먼저 확인한다.
- **role 기본값 fail-open (리뷰 F1, 2026-11-10)**: SSX 발급측이 소음예측 코드를 복제하며 `user?.role ?? "member"` 를 가져왔다 — role 없는 SSX 세션이 단열 Layout 에 member 로 들어갈 수 있었다(직접 로그인은 같은 계정을 거부). `?? ""` 로 고치고 테스트로 고정. **권한 값이 빠지면 허용 쪽으로 채우지 않는다.** 소음예측 원본(`noisePredictorSso.ts`)에는 같은 결함이 남아 있다(이번 범위 밖, SSX 쪽 별도 처리 필요).

## 아직 아닌 것 / 미완

- 단열 Layout 에 직접 접속했을 때 SSX 를 거쳐 자동 로그인 — 하지 않았다(바로가기 진입만, 사용자 결정).
- 로그인 CSRF(공격자 토큰을 피해자가 60초 안에 열면 공격자 계정 세션) — 위험 수용(리뷰 F2, LOW).
- 토큰이 URL 쿼리라 Workers Logs·방문 기록에 남을 수 있음 — 60초 만료로 수용(리뷰 F3, LOW).

## 검증 기록 (2026-11-10)

- 단열 Layout worker `pnpm --filter worker test` 33/33 (Node ≥22.6), SSX vitest SSO+소음예측 27/27, role 수정은 되돌리면 1건 RED 확인.
- 상호운용: SSX 실제 핸들러 발급 토큰 → 단열 Layout 실제 라우트, 같은 시크릿 통과 / 다른 시크릿 실패(9/9).
- ego-browser 로컬(127.0.0.1:9887): 세션 없음→`/login`, 다른 시크릿 토큰→`/login`, 정상 토큰(+`next=` 외부 URL)→`/` 로그인 상태.

## 배포·운영 확인 (2026-11-10)

- 단열 Layout: PR #84 머지(`3db01b3`) → Workers Builds 약 75초 뒤 `/api/auth/sso` 302(`no-store`·`no-referrer`), 기존 `/api/auth/login` 401(가짜 계정) 유지.
- SSX: #2191 → dev(`38af6e6`), 운영은 승격 PR #2193(deploy 기준 체리픽 + 1.117.0, `acab50a`) + backport #2194. 미승격 마이그레이션 0건(`pnpm check:drift`).
- 시크릿: `SSO_JWT_SECRET`(이 Worker)·SSX `IPG_SSO_JWT_SECRET`(운영·`--env dev`) 등록을 `wrangler secret list` 이름으로 확인. **값 일치는 아래 왕복으로만 확인된다.**
- 브라우저 왕복(ego-browser, 실계정): SSX dev 홈 「단열 Layout」 → 이 앱 운영이 로그인 상태(`/api/auth/me` 200, super_admin). 운영 SSX(1.117.0)도 같은 결과 — 시험 전 이 앱 세션을 로그아웃(401 확인)해 기존 세션 영향을 배제했다.
- 덤으로 확인한 것: 배포 직후 열려 있던 SSX 탭은 `Failed to fetch dynamically imported module` — 옛 청크 해시. 캐시 무시 새로고침으로 해소, 결함 아님.

| 역할 | 에이전트 | 지정 모델 | 보고된 실제 모델 | 담당 |
| --- | --- | --- | --- | --- |
| 구현 | `senior-coder` | 기본값 opus | Opus 5.5 (claude-opus-5-5) | 단열 Layout 수신 |
| 구현 | `senior-coder` | 기본값 opus | Opus 5.5 (claude-opus-5-5) | SSX 발급·바로가기 |
| 테스트 | `tester` | 기본값 sonnet | Sonnet 5.5 (claude-sonnet-5-5) | 양쪽 테스트·상호운용 |
| 리뷰 | `reviewer` | 기본값 opus | Opus 5.5 (claude-opus-5-5) | 최종 diff (NEEDS_CHANGES → F1 수정) |

## 함께 보기

- [절대 금지·필수 규칙](../rules/non-negotiable-rules.md)

## 출처

- `apps/worker/src/auth.ts`, `apps/worker/src/index.ts`, `apps/worker/tests/sso.test.ts`
- SSX `worker/lib/external/insulationLayoutSso.ts`, `noisePredictorSso.ts`, `client/src/components/dashboard/QuickNavWidget.tsx`
- 커밋 `0bb254a`, `2a2c9bc`, PR #84(이 저장소), SSX PR #2191·#2193·#2194
- SSX 쪽 정리: smart-schedule-X `llm-wiki/systems/외부앱-자동로그인-SSO.md`
