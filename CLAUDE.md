# CLAUDE.md

Claude Code 전용 보충 규칙. 공통 규칙의 1차 소스는 [`AGENTS.md`](./AGENTS.md)다.

읽는 순서(§1 How To Read), 작업 라우팅(§2 Task Routing), 승인 없는 작업 금지(§6 Non-Negotiable Rules), 충돌 우선순위(§8 Conflict Resolution Priority), 버전·CHANGELOG(§10 Versioning & Changelog)는 `AGENTS.md`를 따른다. 이 문서는 그것을 다시 쓰지 않고, **Claude Code에만 있는 것**만 담는다.

---

## 0. 프로젝트 빠른 참조 (세션 즉시 참조용)

> 상세는 [`README.md`](./README.md) / [`docs/2026-07-02-단열재나누기도-핸드오프.md`](./docs/2026-07-02-단열재나누기도-핸드오프.md).

**무엇**: DXF 도면 → 단열재 나누기도 + 물량 산출서(DXF/SVG/CSV/XLSX/ZIP) 웹 앱. **표시명 "단열 Layout"** (코드 식별자는 `insulation`/`elev_*` 유지). SSX "세대 단열재 나누기도"를 독립 이관. **라이브**: https://insulation-partition-generator.jogh.workers.dev

**명령 (pnpm 모노레포, Node 20+)**

```bash
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # 로컬 시크릿(로그인/저장) — 값 채우기
pnpm dev                     # worker(9887)+web(5173) 동시 기동. http://localhost:5173
pnpm dev:web / pnpm dev:worker   # 개별 실행
pnpm --filter web build      # 프로덕션 빌드(타입체크 포함)
pnpm -r typecheck
```

**핵심 경로**

- 화면: `apps/web/src/features/elevation/ElevationGeneratorPage.tsx`
- 저장: 같은 폴더 `api.ts`(REST 클라) · `hooks.ts`(react-query)
- 계산·도면: `apps/web/src/features/elevation/utils/*`
- Worker: `apps/worker/src/index.ts`(`/api/elevation-projects*`), 설정 `apps/worker/wrangler.jsonc`
- 홈(런처): `apps/web/src/features/home/HomePage.tsx` + 내장 도구 목록 `features/home/tools.ts`
- App Market(홈 게시 도구): `apps/web/src/features/market/*`(게시 폼·상세) + `apps/worker/src/market.ts`(`/api/market/*`).
  테이블 `market_apps`/`market_app_versions`/`market_app_likes`, 버킷 `market-shots`(비공개). 게시·삭제는 관리자(super_admin·system_admin)만.
  홈 섹션은 `market_apps.section`(시공 도구·CAD 도구 — `features/market/types.ts` `SECTIONS`), 카드 없는 섹션은 숨김.
  설치형(`distribution=download`)은 `deploy_url` 의 https 설치파일을 Worker `/api/market/apps/:id/download` 가 중계(원 URL 은 관리자에게만 응답).
- 공용 타입: `packages/shared/src/index.ts`(`ElevState` 등) — web의 `features/elevation/types.ts`가 재수출

**인프라**

- Supabase(전용): ref `yzercziwazfrjsjnmbhr` · 테이블 `elev_projects`/`elev_revisions`, `market_apps`/`market_app_versions`/`market_app_likes` · 버킷 `elev-dxf`·`market-shots`(둘 다 private)
- Cloudflare 계정: Smarttech `2b025f536a98444871b3306efbfd6b2a` (wrangler.jsonc `account_id`)
- Worker 시크릿: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Cloudflare Secrets)

**인증 (DCR 통합로그인 · 회원)**

- 앱 전체 로그인 벽. `apps/web/src/features/auth/*`(AuthContext·AuthGate·LoginPage), worker `apps/worker/src/auth.ts` + `/api/auth/{login,logout,me}` + `app.use('/api/*', authMiddleware)`.
- worker가 **배포 dcr-app 의 `/auth/login`**(이메일+비번, SSX 로그인과 동일)을 서버-투-서버 호출 → **자체 시크릿 `IPG_JWT_SECRET`** 으로 12h 세션 토큰 재발급(HttpOnly `ipg_session`). DCR JWT_SECRET 미공유. 허용 role: super_admin/system_admin/site_admin/member.
- 백엔드 URL: `DCR_BASE_URL`(prod=`dcr-app.jogh.workers.dev`, dev=`dcr-app-dev.jogh.workers.dev`, 로컬은 `.dev.vars`). 시크릿 `IPG_JWT_SECRET` 필수.

**함정 (Gotchas)**

- **로컬 로그인**: `apps/worker/.dev.vars` 에 `COOKIE_SECURE=false` 없으면 http 로컬에서 쿠키 저장 안 돼 로그인 유지 실패. `IPG_JWT_SECRET` 없으면 로그인 500.
- **단일 Worker가 SPA+API 서빙** — `wrangler.jsonc`의 `assets`(`run_worker_first: ["/api/*","/health"]` + SPA fallback). `run_worker_first` 배열형은 **wrangler v4+** 필요.
- Supabase 마이그레이션/쿼리는 **이 프로젝트 전용 MCP(`supabase`, ref `yzercziwazfrjsjnmbhr`)에만**. SSX MCP(`supabase-dev` `kejieugtzuksqpgtxbwg` / `supabase-prod`)에는 **절대 적용 금지**.
- 로컬 `wrangler` 사용 시 셸에 남은 무효 `CLOUDFLARE_API_TOKEN` 있으면 `unset` 후 `wrangler login`(OAuth). 계정이 여러 개라 `account_id` 명시로 Smarttech 고정됨.
- 저장 데이터 원천은 Supabase(DB+Storage) — `localStorage` 아님.
- 접근 제어는 위 **인증** 절의 로그인 벽 하나다(`app.use('/api/*', authMiddleware)` 앞에 둔 `/health`·`/api/auth/*` 만 예외). 도구별 권한(App Market 게시·삭제 등)은 각 라우트가 role 로 판정한다.
- 배포 정식 경로: GitHub 연결 Workers Builds(Root `apps/worker` / Build `pnpm --filter web build` / Deploy `npx wrangler deploy`). `main` 직접 push 금지(훅 차단).

---

## Commands & Skills

반복 작업은 [`.claude/commands/`](./.claude/commands/), 복잡한 작업은 [`.claude/skills/`](./.claude/skills/)를 먼저 확인한다. 목록은 디렉터리에서 직접 본다. 명령 문서가 `AGENTS.md`와 충돌하면 `AGENTS.md`가 이기고, 명령 문서 갱신을 제안한다.

---

## Hooks

Claude Code hooks는 [`.claude/settings.json`](./.claude/settings.json)에 정의하고, 판정 로직은 [`scripts/agent-guard.cjs`](./scripts/agent-guard.cjs)에 있다. `node scripts/agent-guard.cjs --selftest`로 규칙을 확인한다.

Git hook은 도구와 무관하게 Git 레벨에서 동작한다. 프로젝트 루트에서 활성화한다.

```bash
git config core.hooksPath .githooks
```

---

## Claude 전용 안전 규칙

`.claude/settings.local.json`에 `git`, `wrangler`, `supabase`, `deploy` 계열 명령을 allowlist로 추가하지 않는다. 이 파일은 `.gitignore` 대상이라 `AGENTS.md` §6(Non-Negotiable Rules) 승인 규칙이 조용히 사전 승인되고 PR 리뷰에도 보이지 않는다.

금지 이유가 "리뷰에 보이지 않는 곳에서 승인이 사라지는 것"이므로, **git에 추적되는 [`.claude/settings.json`](./.claude/settings.json)의 `permissions.allow`에 명시적으로 넣는 것은 여기 해당하지 않는다.** 등재 대상은 `AGENTS.md` §6이 사전 승인으로 규정한 로컬 git 작업과 읽기 전용 조회뿐이다.

**등재 규칙은 접두사 매칭이므로 플래그까지 좁혀서 쓴다.** `Bash(git config core.hooksPath:*)` 같은 넓은 규칙은 `git config core.hooksPath /dev/null`을 함께 허용해 `.githooks/` 안전장치를 프롬프트 없이 끌 수 있다. 같은 이유로 아래는 좁혀 두었다.

| 쓰지 않는 규칙 | 이유 | 대신 쓰는 것 |
|---|---|---|
| `git config core.hooksPath:*` | 훅 경로를 딴 데로 돌려 안전장치를 끌 수 있다 | `git config core.hooksPath .githooks` (완전 일치) |
| `git switch:*` | `--discard-changes`가 미커밋 작업을 지운다 | `git switch -c:*` (새 브랜치 생성만) |
| `git branch:*` | `-D`가 머지 안 된 브랜치를 지운다 | `git branch --show-current`, `--list` |
| `git remote:*` | `add`·`set-url`이 푸시 목적지를 바꾼다 | `git remote -v`, `get-url` |

`git push`, `gh repo create`, `gh pr create`도 **의도적으로 뺐다** — 저장소 밖으로 나가는 작업의 권한 프롬프트가 §6이 요구하는 마지막 확인 지점이다. 여기에 추가할 때는 그 규칙이 어떤 플래그까지 함께 허용하는지 먼저 따지고, PR에서 그 사실이 보이는지 확인한다.

---

## 규칙을 바꿀 때

공통으로 적용될 규칙은 이 문서가 아니라 `AGENTS.md`·`.agents/*`에 반영한다. 그래야 Claude Code, Codex, Copilot이 같은 기준으로 일한다. 버전·변경 기록은 `AGENTS.md` §10 과 §11 Project Override 를 따른다(이 저장소에는 `CHANGELOG.md` 가 아직 없다).
