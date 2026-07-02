# AGENTS.md

Woomi 표준 웹 서비스 프로젝트에서 모든 AI 에이전트가 먼저 읽는 **공통 진입 규칙**이다.

이 문서는 길게 구현 방법을 설명하지 않는다. 작업 유형을 분류하고, 필요한 `.agents/*` 문서로 라우팅하며, 보안/배포/데이터 손실 같은 절대 금지 규칙만 직접 가진다.

- 표준 버전: `2.0-draft`
- 최종 수정일: 2026-05-28
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
Important data: 저장한 프로젝트·리비전 (작업상태 JSON + 수량요약 + 업로드 DXF 파일) — 새 Supabase 테이블 2개 + Storage
Admin roles: 현재 무인증(접근 제어 없음, 사내 도구). 필요 시 worker 라우트 앞단 미들웨어로 추가. 원본은 본사 RBAC(hq-elevation-gen)
External services: Cloudflare Worker(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), Supabase(전용 ref `yzercziwazfrjsjnmbhr`). 그 외 외부 연동 없음
Launch target: 사내용 웹 도구. **배포 완료(라이브)** — https://insulation-partition-generator.jogh.workers.dev
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
| 배포/secret/binding | `.agents/DEPLOYMENT.md` | `wrangler.jsonc`, `.github/workflows/*`, `.agents/WORKFLOW.md` |
| MCP/외부 도구 연동 | `.agents/TOOLING.md` | `CLAUDE.md`, `CODEX.md`, `.github/*`, 도구별 설정 파일 |
| PR/push/commit | `.agents/WORKFLOW.md` | `CLAUDE.md`, `CODEX.md`, tool command/prompt |
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
├── apps/                 # 실행/배포 단위
├── packages/             # 공유 코드
├── .agents/              # 에이전트 공통 규칙과 컨텍스트
├── .claude/              # Claude Code commands/skills/settings
├── .codex/               # Codex prompts/skills/hooks
├── .github/              # Copilot prompts/instructions, CI
├── .githooks/            # 로컬 git hook
├── docs/                 # 사람용 문서
├── scripts/              # 반복 자동화
├── supabase/             # migration, seed, local Supabase 설정
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
- 사용자 승인 없는 `git commit`, `git push`, `git pull`
- 사용자 승인 없는 production 배포
- 사용자 승인 없는 운영 DB 변경
- 사용자 승인 없는 destructive migration
- `git reset --hard` 또는 사용자 변경사항 되돌리기
- 템플릿 규칙을 실제 프로젝트 코드보다 우선해 기계적으로 강제

필수:

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

## 10. Project Override

각 프로젝트는 이 아래에 프로젝트 전용 규칙을 추가한다.

프로젝트별 규칙은 공통 표준보다 구체적일 때 우선한다. 단, 보안, 배포, 데이터 손실 관련 금지 규칙은 프로젝트 규칙으로 완화할 수 없다.

### 이 프로젝트의 성격

- 이 저장소는 SSX(`smart-schedule-X`)의 "세대 단열재 나누기도" 화면 기능을 **동작 그대로 독립 이관**한 것이다.
- 원본 SSX 저장소는 **읽기 전용 참조**이며 수정하지 않는다.
- 호스팅은 SSX와 분리된 **신규 Cloudflare Worker**(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), 데이터는 분리된 **신규 Supabase 프로젝트**(ref `yzercziwazfrjsjnmbhr`)를 사용한다.
- 상세 이관 계획: `docs/2026-07-02-단열재나누기도-이관계획.md` · 현재 상태: `docs/2026-07-02-단열재나누기도-핸드오프.md`

### 스택 오버라이드

- 프론트엔드: 표준(React Router v7 Framework Mode) 대신 **Vite + React + wouter** (원본과 동일). 사유는 `.agents/STACK.md`의 Project Override 참조.
- 그 외 표준 유지: TypeScript, TanStack Query, Zod, 서버=Hono/Cloudflare Worker, DB=Supabase, UI=Tailwind + shadcn/ui.

### 저장/불러오기(persistence) — 이식 완료

- 생성 기능(계산·화면)은 서버·DB 없이 순수 클라이언트로 동작한다.
- 저장/불러오기: worker `/api/elevation-projects*` + Supabase 테이블 `elev_projects`/`elev_revisions` + Storage 버킷 `elev-dxf`. 로그인은 현재 무인증(§ Project Overview).
- SSX dev 기존 데이터(프로젝트 2·리비전 5)는 DB만 이관됨(DXF 원본 파일 제외). 상세: 핸드오프 문서 §3-D.
