# CLAUDE.md

이 문서는 Claude Code 전용 보충 규칙이다.

공통 규칙의 1차 소스는 항상 [`AGENTS.md`](./AGENTS.md)다. Claude 전용 문서는 `AGENTS.md`와 `.agents/` 문서를 대체하지 않는다.

---

## 0. 프로젝트 빠른 참조 (세션 즉시 참조용)

> 상세는 [`README.md`](./README.md) / [`docs/2026-07-02-단열재나누기도-핸드오프.md`](./docs/2026-07-02-단열재나누기도-핸드오프.md).

**무엇**: DXF 도면 → 단열재 나누기도 + 물량 산출서(DXF/SVG/CSV/XLSX/ZIP) 웹 앱. SSX "세대 단열재 나누기도"를 독립 이관. **라이브**: https://insulation-partition-generator.jogh.workers.dev

**명령 (pnpm 모노레포, Node 20+)**

```bash
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # 로컬 시크릿(로그인/저장) — 값 채우기
pnpm dev                     # worker(8787)+web(5173) 동시 기동. http://localhost:5173
pnpm dev:web / pnpm dev:worker   # 개별 실행
pnpm --filter web build      # 프로덕션 빌드(타입체크 포함)
pnpm -r typecheck
```

**핵심 경로**

- 화면: `apps/web/src/features/elevation/ElevationGeneratorPage.tsx`
- 저장: 같은 폴더 `api.ts`(REST 클라) · `hooks.ts`(react-query)
- 계산·도면: `apps/web/src/features/elevation/utils/*`
- Worker: `apps/worker/src/index.ts`(`/api/elevation-projects*`), 설정 `apps/worker/wrangler.jsonc`
- 공용 타입: `packages/shared/src/index.ts`(`ElevState` 등) — web의 `features/elevation/types.ts`가 재수출

**인프라**

- Supabase(전용): ref `yzercziwazfrjsjnmbhr` · 테이블 `elev_projects`/`elev_revisions` · 버킷 `elev-dxf`(private)
- Cloudflare 계정: Smarttech `2b025f536a98444871b3306efbfd6b2a` (wrangler.jsonc `account_id`)
- Worker 시크릿: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Cloudflare Secrets)

**인증 (DCR 통합로그인 · 회원)**

- 앱 전체 로그인 벽. `apps/web/src/features/auth/*`(AuthContext·AuthGate·LoginPage), worker `apps/worker/src/auth.ts` + `/api/auth/{login,logout,me}` + `app.use('/api/*', authMiddleware)`.
- worker가 **배포 dcr-app 의 member/login**(이름+회사명+비번)을 서버-투-서버 호출 → **자체 시크릿 `IPG_JWT_SECRET`** 으로 12h 세션 토큰 재발급(HttpOnly `ipg_session`). DCR JWT_SECRET 미공유.
- 백엔드 URL: `DCR_BASE_URL`(prod=`dcr-app.jogh.workers.dev`, dev=`dcr-app-dev.jogh.workers.dev`, 로컬은 `.dev.vars`). 시크릿 `IPG_JWT_SECRET` 필수.

**함정 (Gotchas)**

- **로컬 로그인**: `apps/worker/.dev.vars` 에 `COOKIE_SECURE=false` 없으면 http 로컬에서 쿠키 저장 안 돼 로그인 유지 실패. `IPG_JWT_SECRET` 없으면 로그인 500.
- **단일 Worker가 SPA+API 서빙** — `wrangler.jsonc`의 `assets`(`run_worker_first: ["/api/*","/health"]` + SPA fallback). `run_worker_first` 배열형은 **wrangler v4+** 필요.
- Supabase 마이그레이션/쿼리는 **이 프로젝트 전용 MCP(`supabase`, ref `yzercziwazfrjsjnmbhr`)에만**. SSX MCP(`supabase-dev` `kejieugtzuksqpgtxbwg` / `supabase-prod`)에는 **절대 적용 금지**.
- 로컬 `wrangler` 사용 시 셸에 남은 무효 `CLOUDFLARE_API_TOKEN` 있으면 `unset` 후 `wrangler login`(OAuth). 계정이 여러 개라 `account_id` 명시로 Smarttech 고정됨.
- 저장 데이터 원천은 Supabase(DB+Storage) — `localStorage` 아님.
- 접근 제어 없음(무인증). 도입 시 `apps/worker/src/index.ts` 라우트 앞단 미들웨어 한 곳.
- 배포 정식 경로: GitHub 연결 Workers Builds(Root `apps/worker` / Build `pnpm --filter web build` / Deploy `npx wrangler deploy`). `main` 직접 push 금지(훅 차단).

---

## 1. Reading Order

Claude Code는 작업 시작 전 아래 순서로 확인한다.

1. [`AGENTS.md`](./AGENTS.md)
2. `AGENTS.md`의 `Task Routing` 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서만 확인
4. 실제 코드와 설정 파일 확인
5. 해당 작업에 맞는 `.claude/commands/` 또는 `.claude/skills/`

표준 제공 문서는 템플릿이다. 기존 프로젝트에 적용할 때는 실제 코드와 설정을 먼저 확인하고 프로젝트에 맞게 수정한다.

`WORKFLOW.md`는 큰 기능, PR/push, 리뷰, 배포, DB/API 계약 변경처럼 절차가 중요한 작업에서 읽는다.

---

## 2. Claude Commands

반복 작업은 `.claude/commands/`를 우선 확인한다.

```txt
.claude/commands/new-feature.md
.claude/commands/new-api.md
.claude/commands/review-pr.md
.claude/commands/commit.md
```

명령 문서가 오래되었거나 `AGENTS.md`와 충돌하면 `AGENTS.md`를 우선하고, 명령 문서 갱신을 제안한다.

---

## 3. Claude Skills

복잡한 작업은 `.claude/skills/`를 확인한다.

```txt
.claude/skills/component-generator/
.claude/skills/db-migration/
```

DB, Supabase, migration, 배포, 보안 작업은 관련 `.agents/data/*`, `.agents/DEPLOYMENT.md`를 함께 확인한다.

---

## 4. Hooks

Claude Code hooks는 [`.claude/settings.json`](./.claude/settings.json)에 정의한다.

기본 목적:

- 민감 파일 수정 차단
- `main` 직접 push 차단
- `.agents/` 수정 시 관련 문서/명령 갱신 리마인드

Git hook을 함께 사용하려면 프로젝트 루트에서 실행한다.

```bash
git config core.hooksPath .githooks
```

---

## 5. Work Rules

Claude Code는 다음을 사용자 승인 없이 수행하지 않는다.

- `git commit`
- `git push`
- `git pull`
- production 배포
- 운영 DB 변경
- destructive filesystem command
- 사용자 변경사항 되돌리기

PR, push, 배포 작업은 `.agents/WORKFLOW.md`와 `.agents/DEPLOYMENT.md`를 따른다.

---

## 6. Updating Rules

Claude 전용 규칙만 바꾸지 않는다.

공통으로 적용되어야 하는 규칙은 반드시 아래 중 하나에 반영한다.

- `AGENTS.md`
- `.agents/ARCHITECTURE.md`
- `.agents/STACK.md`
- `.agents/WORKFLOW.md`
- 작업 유형별 `.agents/*` 문서

그래야 Claude Code, Codex, GitHub Copilot이 같은 기준으로 작업한다.
