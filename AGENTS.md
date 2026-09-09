# AGENTS.md

Woomi 표준 웹 서비스 프로젝트에서 모든 AI 에이전트가 먼저 읽는 **공통 진입 규칙**이다.

이 문서는 길게 구현 방법을 설명하지 않는다. 작업 유형을 분류하고, 필요한 `.agents/*` 문서로 라우팅하며, 보안/배포/데이터 손실 같은 절대 금지 규칙만 직접 가진다.

- 표준 버전: `2.16-draft`
- 최종 수정일: 2026-08-31
- 기준 레퍼런스: CTPA Hono Worker layered architecture
- 1차 원칙: 실제 코드와 가장 가까운 프로젝트 문서가 우선한다. 단, 보안/배포/데이터 손실 금지 규칙은 완화할 수 없다.

---

## 0. Project Overview

프로젝트 시작 시 비개발자도 답할 수 있는 항목만 먼저 채운다.

```txt
Project name: insulation-partition-generator (표시명: 단열재 나누기도 생성기)
What it does: DXF 도면으로 외단열재 나누기도와 자재 물량을 자동 산출해 도면/엑셀로 내보내는 웹 도구
Main users: 단열재 물량·시공도면 담당자 (원래 SSX 본사 메뉴 기능)
Core workflows: DXF 업로드 → 외벽 그리기 → 창/문 배치 → 보드 규격·정책 설정 → 나누기도 미리보기 → DXF/SVG/CSV/XLSX/ZIP 내보내기 → (선택) 프로젝트 저장/불러오기
Important data: 저장한 프로젝트·리비전 (작업상태 JSON + 수량요약 + 업로드 DXF 파일) — Supabase 테이블 2개 + Storage
Admin roles: DCR 통합로그인 기반 회원 인증(super_admin/system_admin/site_admin/member). App Market 게시·삭제는 관리자(super_admin·system_admin)만. 원본은 본사 RBAC(hq-elevation-gen)
External services: Cloudflare Worker(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), Supabase(전용 ref `yzercziwazfrjsjnmbhr`), dcr-app(회원 인증 백엔드). 그 외 외부 연동 없음
Launch target: 사내용 웹 도구. 배포 완료(라이브) — https://insulation-partition-generator.jogh.workers.dev
Do not touch: 원본 SSX 저장소는 읽기 전용(수정 금지). 계산 로직(insulation.ts/geometry.ts/exporter.ts 등) 동작은 그대로 유지. Supabase 마이그레이션/쿼리는 전용 ref `yzercziwazfrjsjnmbhr` 에만(SSX MCP 금지)
```

기술 항목은 에이전트가 실제 코드와 설정을 확인한 뒤 관련 `.agents/*` 문서 또는 `Project Override`에 반영한다.

---

## 1. How To Read

작은 작업에서 모든 문서를 읽지 않는다.

기본 순서:

1. `AGENTS.md`
2. 아래 `Task Routing` 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서만 확인
4. 실제 코드와 설정 파일 확인
5. 해당 도구의 command/prompt/skill이 있으면 확인

`WORKFLOW.md`는 모든 작업의 상시 필독 문서가 아니다. 큰 기능, PR/push, 리뷰, 배포, DB/API 계약 변경처럼 절차가 중요한 작업에서 읽는다.

**위키 능동 사용**: `wiki/` 볼트가 있는 프로젝트는 llm-wiki를 쓰기로 한 프로젝트다(쓰지 않기로 하면 `wiki/`를 지운다). 이런 프로젝트에서는 시키지 않아도 다음을 챙긴다.

- 작업 전에 관련된 이전 결정·프롬프트·해결책을 위키에서 먼저 찾는다(`/wiki-ask` 또는 `wiki/rules/`·`wiki/systems/`·`wiki/patterns/` 확인).
- 의미 있는 결정, 막혔다 푼 것, 재사용할 자료가 나오면 사용자가 시키기 전에 먼저 위키에 남기자고 제안하고 기록한다(도구의 위키 명령 — Claude Code는 `/wiki-log-today`, `/wiki-add-source`. 명령이 없으면 `wiki/` 파일을 직접 편집).
- 위키의 게이트는 그대로 지킨다 — **왜 모으는지 먼저 묻고, 출처를 아는 자료만** 넣는다. 자세한 규칙과 명령은 [`wiki/README.md`](./wiki/README.md).

Windows PowerShell에서 한국어 문서를 확인할 때는 인코딩 깨짐을 피하기 위해 아래처럼 읽는다.

```powershell
Get-Content -Raw -Encoding UTF8 AGENTS.md
Get-Content -Raw -Encoding UTF8 .agents\WORKFLOW.md
```

---

## 2. Task Routing

| 작업 유형 | 먼저 읽을 문서 | 필요할 때 추가 확인 |
|---|---|---|
| 작은 수정/문구/스타일/명백한 버그 | `AGENTS.md`만 확인한 뒤 실제 파일 확인 | 작업 범위가 넓어지면 해당 영역 문서 |
| 새 화면/UI | `.agents/ui/DESIGN.md`, `.agents/ui/UX_RULES.md`, `.agents/ui/COMPONENTS.md` | `.agents/code/CODE_STYLE.md`, `.agents/ARCHITECTURE.md` |
| 프론트엔드 기능 | `.agents/ARCHITECTURE.md`, `.agents/code/PROJECT_STRUCTURE.md`, `.agents/code/CODE_STYLE.md` | `.agents/code/API.md`, `.agents/WORKFLOW.md` |
| API/백엔드 | `.agents/code/API.md`, `.agents/code/ERROR_HANDLING.md`, `.agents/ARCHITECTURE.md` | `.agents/data/API_CONTRACT.md`, 기존 route/service/repository |
| DB schema/RLS/index | `.agents/data/DB_SCHEMA.md`, `.agents/data/MIGRATION.md` | `.agents/data/DOMAIN_MODEL.md`, `.agents/code/API.md` |
| migration/backfill | `.agents/data/MIGRATION.md`, `.agents/data/DB_SCHEMA.md` | `.agents/DEPLOYMENT.md`, `.agents/WORKFLOW.md` |
| 배포/secret/binding | `.agents/DEPLOYMENT.md` | `wrangler.jsonc`·`.github/workflows/*`(있는 경우), `.agents/WORKFLOW.md` |
| MCP/외부 도구 연동 | `.agents/TOOLING.md` | `CLAUDE.md`, `CODEX.md`, `.github/*`, 도구별 설정 파일 |
| PR/push/commit | `.agents/WORKFLOW.md` | `CLAUDE.md`, `CODEX.md`, tool command/prompt |
| 테스트 작성/실행 | `.agents/code/TESTING.md` | 대상 코드, `AGENTS.md` 7장 Quality Gates |
| 리뷰 | `.agents/WORKFLOW.md`, 작업 영역별 문서 | diff, tests, 관련 code/data/ui 문서 |
| 스택 변경 | `.agents/STACK.md` | `.agents/ARCHITECTURE.md`, README |
| 에이전트 규칙 변경 | `AGENTS.md`, `.agents/WORKFLOW.md` | `CLAUDE.md`, `CODEX.md`, `.github/*` |

---

## 3. Standard Document Map

| 파일 | 역할 |
|---|---|
| `.agents/ARCHITECTURE.md` | 아키텍처, 레이어, 런타임 경계 |
| `.agents/STACK.md` | 표준 기술스택 |
| `.agents/WORKFLOW.md` | 작업 순서, PR/push, 리뷰, 검증 흐름 |
| `.agents/DEPLOYMENT.md` | Cloudflare/Wrangler/GitHub Actions 배포 기준 |
| `.agents/TOOLING.md` | MCP, 브라우저 자동화, 외부 도구 사용 기준 |
| `.agents/code/API.md` | route/service/repository/API client 기준 |
| `.agents/code/PROJECT_STRUCTURE.md` | 폴더 구조와 import boundary |
| `.agents/code/CODE_STYLE.md` | TypeScript, 네이밍, 주석, 코드 스타일 |
| `.agents/code/ERROR_HANDLING.md` | ErrorCode, response, logging 기준 |
| `.agents/code/TESTING.md` | 테스트 범위와 검증 명령 |
| `.agents/code/NEST_GUIDE.md` | NestJS 프로젝트에만 적용 (적용 조건은 문서 1장) |
| `.agents/code/NEST_CF_WORKER.md` | NestJS + Cloudflare Worker 조합 기준 |
| `.agents/data/DOMAIN_MODEL.md` | 진행 중 작성하는 도메인 모델 |
| `.agents/data/DB_SCHEMA.md` | DB schema, RLS, index 가드레일 |
| `.agents/data/API_CONTRACT.md` | 진행 중 작성하는 API 계약 |
| `.agents/data/MIGRATION.md` | Supabase PostgreSQL migration 전략 |
| `.agents/ui/DESIGN.md` | 디자인 원칙 |
| `.agents/ui/UX_RULES.md` | loading/empty/error/permission, form, navigation, shortcut, feedback UX |
| `.agents/ui/COMPONENTS.md` | 진행 중 작성하는 공통 컴포넌트 목록 |
| `.agents/examples/GOOD_EXAMPLES.md` | 진행 중 축적하는 좋은 패턴 |
| `.agents/examples/BAD_EXAMPLES.md` | 진행 중 축적하는 금지 패턴 |

표준 제공 문서는 고정된 절대 규칙이 아니다. 새 프로젝트 또는 기존 프로젝트에 적용할 때는 실제 코드, 프레임워크, 배포 방식, API 계약, 디자인 시스템을 확인한 뒤 프로젝트 현실에 맞게 수정한다.

---

## 4. Directory Baseline

권장 루트 구조:

```txt
.
├── apps/                 # 실행/배포 단위 (이 템플릿에는 apps/web 만 있음)
├── packages/             # 공유 코드            — 필요할 때 생성, 아직 없음
├── .agents/              # 에이전트 공통 규칙과 컨텍스트
├── .claude/              # Claude Code commands/skills/settings
├── .codex/               # Codex prompts/skills/hooks
├── .github/              # Copilot prompts/instructions, workflows/tag-version.yml
├── .githooks/            # 로컬 git hook
├── docs/                 # 사람용 문서          — exec-brief/ (임원 브리핑 덱)
├── wiki/                 # 팀 지식 위키 (rules·sources / systems·patterns 는 생기면 / Obsidian 볼트 겸용)
├── scripts/              # 반복 자동화
├── supabase/             # migration, seed 설정 — 필요할 때 생성, 아직 없음
├── AGENTS.md
├── CLAUDE.md
├── CODEX.md
└── README.md
```

세부 구조와 import boundary는 `.agents/ARCHITECTURE.md`와 `.agents/code/PROJECT_STRUCTURE.md`를 따른다.

---

## 5. Tool-Specific Files

| 도구 | 보충 문서 | 반복 작업 | 복잡 작업 |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/commands/` | `.claude/skills/` |
| Codex | `CODEX.md` | `.codex/prompts/` | `.codex/skills/` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/prompts/` | `.github/instructions/` |

도구별 문서에는 공통 규칙을 숨기지 않는다. 공통 규칙은 `AGENTS.md` 또는 `.agents/*`에 반영한다.

---

## 6. Non-Negotiable Rules

절대 금지:

- API key, service role key, JWT secret 하드코딩
- 실제 값이 들어간 `.env` 커밋
- 프론트엔드에 서버 secret 노출
- 인증 없이 private storage URL 발급
- 안전 훅이나 보호 규칙을 우회하는 옵션(`--no-verify`, `-n`, `--force`)을 붙인 `git commit`, `git push`
- 사용자 승인 없는 production 배포
- 사용자 승인 없는 운영 DB 변경
- 사용자 승인 없는 destructive migration
- 사용자 승인 없는 운영 secret 변경
- 사용자 승인 없는 외부 서비스 데이터 생성/수정/삭제 — 결제, 알림 발송, 고객 데이터 변경 포함
- destructive filesystem command
- secret 값을 대화, 보고, 문서에 출력
- `git reset --hard` 또는 사용자 변경사항 되돌리기
- 템플릿 규칙을 실제 프로젝트 코드보다 우선해 기계적으로 강제

필수:

- **git 작업 경계.** 저장소 안에서 끝나는 작업(`git init`, 브랜치 생성, `git add`, `git commit`)은 사전 승인된 것으로 보고 매번 묻지 않는다 — 되돌릴 수 있고, 오히려 커밋을 미루는 쪽이 작업 유실 위험이 크다. 저장소 밖으로 나가는 작업(`git push`, `git pull`, PR 생성, 원격 저장소 생성)은 **되돌리기 어렵다는 사실을 한 줄로 알린 뒤** 진행한다. 위 금지 목록의 우회 옵션과 `git reset --hard`는 이 예외에 해당하지 않는다.
- secret은 환경변수 또는 platform secret으로 관리한다.
- MCP와 외부 도구는 read-only 조회와 write/delete/deploy 작업을 구분해서 사용한다.
- 파일 업로드는 확장자, MIME, 크기, 권한을 검증한다.
- DB/API/배포 변경은 관련 `.agents/*` 문서를 함께 갱신한다.
- 반복되는 UX 패턴이나 공통 화면 정책이 생기면 `.agents/ui/UX_RULES.md` 또는 프로젝트별 UX 문서에 기록한다.
- 검증하지 못한 항목은 최종 보고에 명시한다.

---

## 7. Quality Gates

가능한 범위에서 아래를 실행한다.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

이 스캐폴드가 제공하는 스크립트는 `typecheck`, `test`, `build` 다. `lint`와 아래 `deploy:dry`는 없으므로 프로젝트에서 도입한 경우에만 실행한다. 없는 명령을 실행해 실패를 확인하지 않는다.

Cloudflare Worker 배포 전에는 프로젝트별 dry-run 명령을 우선한다.

```bash
pnpm --filter <worker-package> run deploy:dry
```

프로젝트에 없는 명령은 억지로 만들지 않는다. 실행하지 못한 검증은 이유를 보고한다.

---

## 8. Conflict Resolution Priority

문서 간 충돌이 발생하면 아래 순서를 따른다.

1. 실제 코드 및 설정 파일
2. 가장 가까운 하위 `AGENTS.md`
3. 프로젝트별 `Project Override`
4. 루트 `AGENTS.md`
5. 작업 유형별 `.agents/*` 문서
6. 도구별 `CLAUDE.md`, `CODEX.md`, `.github/*`
7. 예시 문서

보안, 배포, 데이터 손실 관련 공통 금지 규칙은 프로젝트 문서로 완화할 수 없다.

---

## 9. Output Requirements

작업 완료 보고에는 아래를 포함한다.

```txt
Changed:
Files:
Validation:
Skipped validation:
Risk:
```

리뷰 요청을 받으면 구현 설명보다 findings를 먼저 쓴다. 문제가 없으면 "발견한 문제 없음"이라고 명확히 말한다.

---

## 10. Versioning & Changelog

저장소의 공통 규칙, `.agents/*` 문서, `apps/*` 스캐폴드/코드, 훅에 영향을 주는 변경이 생기면 반드시 같은 작업에서 아래를 갱신한다.

- 루트 `CHANGELOG.md`에 변경 항목을 추가한다.
- `AGENTS.md`와 `README.md`의 "표준 버전"과 "최종 수정일"을 갱신한다.
- `main`의 **`v<표준 버전>` git 태그**는 머지되면 자동으로 붙는다(아래 참고).

버전은 `MAJOR.MINOR-단계` 형식이다. 새 기능/스캐폴드/규칙 추가는 MINOR를, 호환이 깨지는 표준 변경은 MAJOR를 올린다. 정식 확정 전에는 `-draft`를 유지한다.

### 이 템플릿에서 분기한 프로젝트는 제품 버전을 따로 둔다 ★

**이 번호는 "템플릿 표준의 버전"이다. 제품의 버전이 아니다.** 분기한 저장소가 이 번호 라인을 그대로 이어 쓰면, 템플릿이 같은 번호를 다시 내는 순간 **같은 번호가 두 저장소에서 서로 다른 내용**을 가리킨다. 각자 `v<번호>` 태그까지 달고 있어 나중에 구분할 방법이 없다. 실제로 일어난 일이다 — 한 파생 프로젝트가 `2.14-draft`(2026-08-15)를 썼고 이 템플릿도 `2.14-draft`(2026-08-19)를 냈다.

분기한 프로젝트는 **머리말에 두 축을 나눠 적는다.**

```txt
- 제품 버전: `0.3.0` (프로젝트 이름)        ← CHANGELOG 최상단이 단일 출처. 저장소가 바뀔 때마다
- 기반 템플릿 표준: `2.15-draft`             ← 템플릿을 다시 당겨올 때만
```

- 제품 버전은 `MAJOR.MINOR.PATCH` 를 쓰고 `-draft` 를 붙이지 않는다. 운영에 나가기 전에는 `0.x` 로 두고, **`1.0.0` 은 운영 전환 시점**에 붙인다.
- 분기 시점의 과거 항목은 **다시 번호 매기지 않는다.** 이미 붙은 태그와 어긋난다. `CHANGELOG.md` 에 구분선을 넣어 "여기 위는 제품 버전, 아래는 템플릿에서 물려받은 이력"을 밝힌다.
- 이 템플릿 저장소 자신은 계속 `MAJOR.MINOR-단계` 를 쓴다. 위 규칙은 **분기한 쪽**에 적용된다.


문구 오타 수정처럼 사소한 변경은 버전을 올리지 않고 `CHANGELOG.md` 항목만 남기거나 생략할 수 있다. 이 갱신은 `git commit`/`push` 없이도 수행하며, 커밋과 별개다.

**git 태그**: [`.github/workflows/tag-version.yml`](./.github/workflows/tag-version.yml)이 `main` 푸시마다 `CHANGELOG.md` 최상단 버전을 읽어 `v<표준 버전>` 태그를 붙인다. 태그가 이미 있으면 아무것도 하지 않는다. **에이전트가 태그를 직접 만들지 않는다.**

- 태그는 **`main`에만** 남는다. 워크플로우가 `main` 푸시에서만 돌기 때문이다. 피처 브랜치 커밋은 머지 방식(squash·rebase)에 따라 사라지거나 다른 커밋이 되어, 태그가 어디에도 없는 커밋을 가리키게 된다.
- 버전당 하나다. 같은 버전을 여러 PR로 나눠 머지하면 첫 머지에서 한 번만 붙는다.
- **버전을 올리지 않고 머지하면 태그도 붙지 않는다.** 여러 버전을 한 브랜치에 쌓아 머지하면 중간 버전은 건너뛴다. 각 버전을 남기려면 버전별로 나눠 머지한다.

태그 ruleset을 만들 때 `Restrict creations`를 켜면 이 워크플로우가 막힌다. branch ruleset은 태그에 영향이 없다.

Actions를 쓸 수 없는 프로젝트(비활성, 사설 러너 없음)에서는 아래를 **사용자 승인 후** 실행한다. 태그는 한 번 공개되면 되돌리기 어려우므로 6장의 로컬 작업 예외가 적용되지 않는다.

```bash
git switch main && git pull
git tag -a v2.10-draft -m v2.10-draft && git push origin v2.10-draft
```

누락 방지: `.claude/settings.json`의 `Stop` 훅이 위 갱신 대상 파일이 바뀌었는데 `CHANGELOG.md`가 그대로면 리마인더를 띄운다(`.userdocs/`와 빌드 산출물은 제외해 소음을 막는다). 태그 리마인더는 워크플로우가 대신하므로 두지 않는다 — CI가 붙인 태그는 로컬에서 `git fetch --tags` 전까지 안 보여, 훅이 붙은 태그를 없다고 잘못 알린다.

---

## 11. Project Override

각 프로젝트는 이 아래에 프로젝트 전용 규칙을 추가한다.

프로젝트별 규칙은 공통 표준보다 구체적일 때 우선한다. 단, 보안, 배포, 데이터 손실 관련 금지 규칙은 프로젝트 규칙으로 완화할 수 없다.

### 이 프로젝트의 성격

- SSX(`smart-schedule-X`)의 "세대 단열재 나누기도" 화면 기능을 **동작 그대로 독립 이관**한 저장소다.
- 원본 SSX 저장소는 **읽기 전용 참조**이며 수정하지 않는다.
- 호스팅은 SSX와 분리된 신규 Cloudflare Worker(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), 데이터는 분리된 신규 Supabase 프로젝트(ref `yzercziwazfrjsjnmbhr`)를 쓴다.
- 상세 이관 계획: `docs/2026-07-02-단열재나누기도-이관계획.md` · 현재 상태: `docs/2026-07-02-단열재나누기도-핸드오프.md`

### 스택 오버라이드

- 프론트엔드: 표준(React Router v7 Framework Mode) 대신 **Vite + React 19 + wouter**. 사유는 `.agents/STACK.md` 9장.
- 그 외 표준 유지: TypeScript strict, TanStack Query(저장/불러오기), Zod, 서버=Hono/Cloudflare Worker, DB=Supabase, UI=Tailwind v4 + shadcn/ui 계열(Radix Slot + CVA).
- 상태 관리: 원본이 로컬 컴포넌트 상태 중심이라 Zustand는 현재 미사용(필요 시 도입).
- 테스트: `node:test` 기반 `tests/*.test.mjs`. Vitest를 강제하지 않는다.

### 핵심 경로

- 메인 화면: `apps/web/src/features/elevation/ElevationGeneratorPage.tsx`
- 저장 API 클라이언트: 같은 폴더 `api.ts` · react-query 훅 `hooks.ts`
- 계산·도면 로직: `apps/web/src/features/elevation/utils/*`
- Worker: `apps/worker/src/index.ts`(`/api/elevation-projects*`), 설정 `apps/worker/wrangler.jsonc`
- 홈(런처): `apps/web/src/features/home/HomePage.tsx` + 내장 도구 목록 `features/home/tools.ts`
- App Market: `apps/web/src/features/market/*` + `apps/worker/src/market.ts`(`/api/market/*`). 테이블 `market_apps`/`market_app_versions`/`market_app_likes`, 버킷 `market-shots`(비공개). 게시·삭제는 관리자만.
- 공용 타입: `packages/shared/src/index.ts`(`ElevState` 등) — web의 `features/elevation/types.ts`가 재수출.

### 인프라

- Supabase(전용): ref `yzercziwazfrjsjnmbhr` · 테이블 `elev_projects`/`elev_revisions`, `market_apps`/`market_app_versions`/`market_app_likes` · 버킷 `elev-dxf`·`market-shots`(둘 다 private)
- Cloudflare: Smarttech 계정 `2b025f536a98444871b3306efbfd6b2a` (`wrangler.jsonc`의 `account_id`)
- Worker 시크릿: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IPG_JWT_SECRET`, `DCR_BASE_URL` (Cloudflare Secrets)

### 인증 (DCR 통합로그인)

- 앱 전체가 로그인 벽 뒤에 있다. `apps/web/src/features/auth/*`(AuthContext·AuthGate·LoginPage), worker `apps/worker/src/auth.ts` + `/api/auth/{login,logout,me}` + `app.use('/api/*', authMiddleware)`.
- worker가 배포된 `dcr-app`의 `/auth/login`(이메일+비밀번호, SSX 로그인과 동일)을 서버-투-서버로 호출한 뒤, **자체 시크릿 `IPG_JWT_SECRET`** 으로 12h 세션 토큰을 재발급한다(HttpOnly 쿠키 `ipg_session`). DCR의 JWT_SECRET은 공유하지 않는다. 허용 role: super_admin/system_admin/site_admin/member.
- `DCR_BASE_URL`: prod=`dcr-app.jogh.workers.dev`, dev=`dcr-app-dev.jogh.workers.dev`, 로컬은 `.dev.vars`.

### 저장/불러오기 (이식 완료)

- 생성 기능(계산·화면)은 서버·DB 없이 순수 클라이언트로 동작한다.
- 저장/불러오기: worker `/api/elevation-projects*` + Supabase 테이블 `elev_projects`/`elev_revisions` + Storage 버킷 `elev-dxf`.
- 저장 데이터의 원천은 Supabase(DB+Storage)다 — `localStorage`가 아니다.

### 함정 (Gotchas)

- **로컬 개발 포트**: web = **5973**(Vite, `apps/web/vite.config.ts`), worker = **8887**(wrangler). `pnpm dev`로 동시 기동하고 http://localhost:5973 로 접속한다. 5173/8787은 SSX 로컬과 겹쳐 쓰지 않는다.
- **로컬 로그인**: `apps/worker/.dev.vars`에 `COOKIE_SECURE=false`가 없으면 http 로컬에서 쿠키가 저장되지 않아 로그인이 유지되지 않는다. `IPG_JWT_SECRET`이 없으면 로그인 500.
- **단일 Worker가 SPA+API를 함께 서빙한다** — `wrangler.jsonc`의 `assets`(`run_worker_first: ["/api/*","/health"]` + SPA fallback). `run_worker_first` 배열형은 wrangler v4+ 가 필요하다.
- **Supabase MCP는 이 프로젝트 전용(`supabase`, ref `yzercziwazfrjsjnmbhr`)에만 쓴다.** SSX MCP(`supabase-dev` `kejieugtzuksqpgtxbwg` / `supabase-prod`)에는 **절대 적용하지 않는다.**
- 로컬 `wrangler` 사용 시 셸에 남은 무효 `CLOUDFLARE_API_TOKEN`이 있으면 `unset` 후 `wrangler login`(OAuth). 계정이 여러 개라 `account_id` 명시로 Smarttech에 고정돼 있다.
- 배포 정식 경로는 GitHub 연결 Workers Builds(Root `apps/worker` / Build `pnpm --filter web build` / Deploy `npx wrangler deploy`). **`main` 직접 push 금지**(훅 차단).
