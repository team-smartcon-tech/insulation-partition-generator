# AGENTS.md

Woomi 표준 웹 서비스 프로젝트에서 모든 AI 에이전트가 먼저 읽는 **공통 진입 규칙**이다.

이 문서는 길게 구현 방법을 설명하지 않는다. 작업 유형을 분류하고, 필요한 `.agents/*` 문서로 라우팅하며, 보안/배포/데이터 손실 같은 절대 금지 규칙만 직접 가진다.

- 표준 버전: `2.27-draft` (기반 템플릿 표준 — 템플릿을 다시 당겨올 때만 바꾼다)
- 제품 버전: 루트 [`CHANGELOG.md`](./CHANGELOG.md) 최상단이 단일 출처 (10장 · 11장)
- 최종 수정일: 2026-10-21
- 기준 레퍼런스: CTPA Hono Worker layered architecture
- 1차 원칙: 실제 코드와 가장 가까운 프로젝트 문서가 우선한다. 단, 보안/배포/데이터 손실 금지 규칙은 완화할 수 없다.

---

## 0. Project Overview

프로젝트 시작 시 비개발자도 답할 수 있는 항목만 먼저 채운다.

```txt
Project name: insulation-partition-generator (표시명: **단열 Layout** — 구 "단열재 나누기도 생성기")
What it does: DXF 도면으로 외단열재 나누기도와 자재 물량을 자동 산출해 도면/엑셀로 내보내는 웹 도구. 지금은 홈(런처)에 시공 도구 여러 개를 얹은 사내 플랫폼이다
             — 단열 Layout(`/tools/insulation`, takeoff 마감 물량 패널 포함), TC/HOIST 발주의뢰서(`/tools/tc-rental`, TC 임대계획),
               스마트폼(`/tools/forms`), App Market(`/market/*`, 관리자가 게시하는 홈 카드). 목록 단일 원천: `apps/web/src/features/home/tools.ts`
             — 스마트폼은 2026-10-21 독립 이관 준비를 마쳤고 별도 저장소 `woomi-ai-innovation/2026-leesy121212-alt` 로 옮겨 가는 중이다
               (`docs/2026-10-21-스마트폼-독립이관계획.md`). 이관이 끝나 안정될 때까지 이 저장소의 스마트폼 코드·테이블은 지우지 않는다
Main users: 단열재 물량·시공도면 담당자 (원래 SSX 본사 메뉴 기능), 그 외 도구별 현장·본사 담당자
Core workflows: (단열 Layout) DXF 업로드 → 외벽 그리기 → 창/문 배치 → 보드 규격·정책 설정 → 나누기도 미리보기 → DXF/SVG/CSV/XLSX/ZIP 내보내기 → (선택) 프로젝트 저장/불러오기
Important data: 단열 Layout 프로젝트·리비전(작업상태 JSON + 수량요약 + 업로드 DXF), 현장(`elev_sites`), App Market(`market_*`), TC 임대계획(`tc_rental_*`), 스마트폼 서류(`form_*`) — 전부 전용 Supabase 의 테이블 + 비공개 Storage 버킷. 테이블 목록은 `supabase/migrations/`
Admin roles: 앱 전체 로그인 벽(DCR 통합로그인, 이메일+비밀번호). 허용 role: super_admin/system_admin/site_admin/member. App Market 게시·삭제는 super_admin·system_admin 만. 상세는 `CLAUDE.md` 0장 "인증"
External services: Cloudflare Worker(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), Supabase(전용 ref `yzercziwazfrjsjnmbhr`), dcr-app(같은 계정 Worker — 로그인 위임 `/auth/login` 과 takeoff 실 검수용 LLM 프록시 `/api/llm/generate`, 서비스 바인딩 `DCR_APP` 우선·`DCR_BASE_URL` 폴백)
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

**위키 능동 사용**: `wiki/` 볼트가 있는 프로젝트는 llm-wiki를 쓰기로 한 프로젝트다(쓰지 않기로 하면 `wiki/`를 지운다). 이런 프로젝트에서는 시키지 않아도 다음을 챙긴다.

- 작업 전에 관련된 이전 결정·프롬프트·해결책을 위키에서 먼저 찾는다(`/wiki-ask` 또는 `wiki/rules/`·`wiki/systems/`·`wiki/patterns/` 확인).
- 의미 있는 결정, 막혔다 푼 것, 재사용할 자료가 나오면 사용자가 시키기 전에 먼저 위키에 남기자고 제안하고 기록한다(`/wiki-log-today`, `/wiki-add-source` — 세 도구 모두에 있다. 명령이 없는 도구면 `wiki/` 파일을 직접 편집).
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
├── apps/                 # 실행/배포 단위 — apps/web(Vite SPA) · apps/worker(Hono, SPA+API 를 한 Worker 로 서빙)
├── packages/             # 공유 코드 — packages/shared(@ipg/shared, ElevState 등 공용 타입)
├── engine/               # Python 마감 물량 엔진(finish_takeoff, pytest) — 웹과 별개로 실행
├── tests/                # node --test 단위 테스트(tests/*.test.mjs) + fixtures
├── vendor/               # 사내 DXF 엔진 tgz(@jakkelab-aec/rw-dxf-engine-ts)
├── .agents/              # 에이전트 공통 규칙과 컨텍스트
├── .claude/              # Claude Code commands/skills/settings
├── .codex/               # Codex prompts/skills/hooks
├── .github/              # Copilot prompts/instructions (workflows 없음 — CI 미도입, 11장)
├── .githooks/            # 로컬 git hook
├── docs/                 # 사람용 문서 — 이관계획·핸드오프·요구명세 · 브라우저-검증-절차.md · ai/(설계·결정·실행 계획)
├── .userdocs/            # 템플릿 2.0 시절 설계 기록(템플릿은 2.19 에서 docs/ 로 합쳤다 — 이 저장소는 아직 옮기지 않음)
├── wiki/                 # 팀 지식 위키 (rules·sources / systems·patterns 는 생기면 / Obsidian 볼트 겸용)
├── scripts/              # 반복 자동화
├── supabase/             # migrations/ (전용 프로젝트 `yzercziwazfrjsjnmbhr` 에만 적용)
├── AGENTS.md
├── CHANGELOG.md          # 제품 변경 기록(단일 출처)
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
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

템플릿 스캐폴드는 위 다섯을 모두 제공하고 CI(`pr-checks.yml` (이 저장소에는 없음))로 막는다. **이 저장소에는 아직 없다** — 실제로 돌릴 수 있는 명령은 11장 "검증 명령(실제값)"을 따른다. 없는 명령을 실행해 실패를 확인하지 않는다.

**메뉴·탭·화면의 기능을 추가·변경했으면 자동 검사로 끝내지 않는다.** 자동 검사는 "화면에서 실제로 눌러 보면 되는가"를 증명하지 않는다 — PR 전에 브라우저에서 확인하고, **무엇을 확인하지 못했는지까지** PR 에 적는다. 문구·색·여백만 바꾼 수정과 문서·리팩터는 대상이 아니다. 절차는 [`docs/브라우저-검증-절차.md`](./docs/브라우저-검증-절차.md)(머리말의 "이 저장소 주의" 먼저).

Cloudflare Worker 배포 전에는 프로젝트별 dry-run 명령을 우선한다.

```bash
pnpm --filter worker run deploy:dry
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

> **이 저장소 주의**: 아래는 템플릿 기준이다. 이 저장소는 11장대로 **제품 버전은 루트 `CHANGELOG.md` 가 단일 출처**이고, 머리말 "표준 버전" 은 템플릿을 다시 당겨올 때만 바꾼다. `README.md` 에는 표준 버전 표기가 없어 갱신 대상이 아니다. Stop 훅(`agent-guard.cjs stop-changelog`)의 리마인더 문구("표준 버전·README 갱신")는 템플릿 공용 스크립트의 기준이라 그대로 두었다 — 이 저장소에서는 `CHANGELOG.md` 항목 추가로 읽는다.

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

**git 태그**(템플릿 기준 — **이 저장소는 태그 자동화 미도입**, 11장): `.github/workflows/tag-version.yml` (이 저장소에는 없음)이 `main` 푸시마다 `CHANGELOG.md` 최상단 버전을 읽어 `v<표준 버전>` 태그를 붙인다. 태그가 이미 있으면 아무것도 하지 않는다. **에이전트가 태그를 직접 만들지 않는다.**

- 태그는 **`main`에만** 남는다. 워크플로우가 `main` 푸시에서만 돌기 때문이다. 피처 브랜치 커밋은 머지 방식(squash·rebase)에 따라 사라지거나 다른 커밋이 되어, 태그가 어디에도 없는 커밋을 가리키게 된다.
- 버전당 하나다. 같은 버전을 여러 PR로 나눠 머지하면 첫 머지에서 한 번만 붙는다.
- **버전을 올리지 않고 머지하면 태그도 붙지 않는다.** 여러 버전을 한 브랜치에 쌓아 머지하면 중간 버전은 건너뛴다. 각 버전을 남기려면 버전별로 나눠 머지한다.

태그 ruleset을 만들 때 `Restrict creations`를 켜면 이 워크플로우가 막힌다. branch ruleset은 태그에 영향이 없다.

Actions를 쓸 수 없는 프로젝트(비활성, 사설 러너 없음)에서는 아래를 **사용자 승인 후** 실행한다. 태그는 한 번 공개되면 되돌리기 어려우므로 6장의 로컬 작업 예외가 적용되지 않는다.

```bash
git switch main && git pull
git tag -a v2.10-draft -m v2.10-draft && git push origin v2.10-draft
```

누락 방지: `.claude/settings.json`의 `Stop` 훅이 위 갱신 대상 파일이 바뀌었는데 `CHANGELOG.md`가 그대로면 리마인더를 띄운다(`docs/`와 빌드 산출물은 제외해 소음을 막는다). 태그 리마인더는 워크플로우가 대신하므로 두지 않는다 — CI가 붙인 태그는 로컬에서 `git fetch --tags` 전까지 안 보여, 훅이 붙은 태그를 없다고 잘못 알린다.

---

## 11. Project Override

각 프로젝트는 이 아래에 프로젝트 전용 규칙을 추가한다.

프로젝트별 규칙은 공통 표준보다 구체적일 때 우선한다. 단, 보안, 배포, 데이터 손실 관련 금지 규칙은 프로젝트 규칙으로 완화할 수 없다.

### 이 프로젝트의 성격

- 이 저장소는 SSX(`smart-schedule-X`)의 "세대 단열재 나누기도" 화면 기능을 **동작 그대로 독립 이관**한 것이다.
- 원본 SSX 저장소는 **읽기 전용 참조**이며 수정하지 않는다.
- 호스팅은 SSX와 분리된 **신규 Cloudflare Worker**(계정 Smarttech `2b025f536a98444871b3306efbfd6b2a`), 데이터는 분리된 **신규 Supabase 프로젝트**(ref `yzercziwazfrjsjnmbhr`)를 사용한다.
- 상세 이관 계획: `docs/2026-07-02-단열재나누기도-이관계획.md` · 현재 상태: `docs/2026-07-02-단열재나누기도-핸드오프.md`

### 스택 오버라이드

- 프론트엔드: 표준(React Router v7 Framework Mode) 대신 **Vite + React + wouter** (원본과 동일). 사유는 `.agents/STACK.md`의 Project Override 참조.
- 그 외 표준 유지: TypeScript, TanStack Query, 서버=Hono/Cloudflare Worker, DB=Supabase, UI=Tailwind v4 + shadcn/ui 방식(`components/ui/button.tsx`·cva).
- Zod 는 쓰지 않는다(2026-10-21 확인: `apps/*`·`packages/*` 의 `package.json` 에 없음). 템플릿 문서의 "Zod 로 검증" 은 이 저장소에서 수동 검증으로 읽는다.
- 템플릿의 React Router v7 전제(`apps/web/app/routes/*`, loader/action, `react-router.config.ts`)는 이 저장소에 없다. 화면은 `apps/web/src/features/*`, 라우트는 `apps/web/src/App.tsx`(wouter) 다. 상세는 `.agents/ARCHITECTURE.md`·`.agents/STACK.md` 의 Project Override.

### 저장/불러오기(persistence) — 이식 완료

- 생성 기능(계산·화면)은 서버·DB 없이 순수 클라이언트로 동작한다.
- 저장/불러오기: worker `/api/elevation-projects*` + Supabase 테이블 `elev_projects`/`elev_revisions` + Storage 버킷 `elev-dxf`. 로그인 벽 뒤에 있다(§ Project Overview "Admin roles").
- SSX dev 기존 데이터(프로젝트 2·리비전 5)는 DB만 이관됨(DXF 원본 파일 제외). 상세: 핸드오프 문서 §3-D.

### 템플릿 2.27-draft 적용 (2026-10-21) — 들여오지 않은 것·바꿔 적용한 것

템플릿을 다시 당겨오며(2.0-draft → 2.27-draft) 아래는 **사용자 결정으로 가져오지 않았거나 바꿔 적용했다.** 규칙을 지운 것이 아니라 "이 저장소에는 아직 없다"는 표시다. 템플릿 문서에서 이 장치를 전제로 한 문장을 만나면 여기를 우선한다.

| 템플릿 장치 | 이 저장소 | 영향받는 문서 |
|---|---|---|
| CI `.github/workflows/pr-checks.yml`(PR 필수 검사) | **미도입** — PR 에 자동 게이트가 없다. 아래 검증 명령을 사람이·에이전트가 돌린다 | 7장, `.agents/WORKFLOW.md`, `.agents/DEPLOYMENT.md`, `.agents/code/TESTING.md` |
| `.github/workflows/tag-version.yml`(태그 자동화) | **미도입** — 10장의 자동 태그는 일어나지 않는다. 태그가 필요하면 10장 수동 명령을 사용자 승인 후 | 10장 |
| Prettier·ESLint(`format:check`·`lint`, `.prettierrc.json`·`eslint.config.mjs`) | **미도입** — 루트 `lint` 스크립트(`pnpm -r lint`)는 있으나 lint 를 가진 패키지가 없다. 손으로 주변 파일 스타일에 맞춘다 | 7장, `.agents/STACK.md` 7장, `.agents/code/CODE_STYLE.md` |
| `.nvmrc`·`.git-blame-ignore-revs` | **미도입** — Node 버전은 루트 `package.json` `engines.node >=20` | — |
| `CHANGELOG.md`·버전 | **바꿔 적용** — 루트 `CHANGELOG.md` 를 **제품 기준 단일 출처**로 둔다(2026-10-21 신설, 10장의 "분기한 프로젝트는 제품 버전을 따로 둔다" 형식). 규칙·문서·훅·앱 코드를 바꾸면 같은 작업에서 항목을 더한다. 템플릿 표준 번호는 머리말 "표준 버전" 에만 적는다. 태그 자동화는 위 줄대로 미도입 | 10장, `CLAUDE.md` |
| `docs/브라우저-검증-절차.md` | **들여왔다** — 머리말 "이 저장소 주의"(CI 없음, 실제 dev 포트 5473·DCR 로그인, React Router 예시는 템플릿 기준)를 먼저 읽는다 | 7장, `.agents/code/TESTING.md` |
| `/onboard` 명령 | **미도입** — 템플릿 샘플 앱(사이드바 이름 교체)을 전제로 한 첫 커밋 실습이다 | `CLAUDE.md` |
| opencode(`opencode.json`·`.opencode/`) | **미도입** — 팀이 opencode 를 쓰지 않기로 했다(2026-10-21). 템플릿도 2.28-draft 에서 opencode 지원을 뺐다 | — |
| 민감 파일 편집 차단·`main` 푸시 차단 범위 | **보존** — 템플릿 `agent-guard.cjs file` 은 값 파일(`.env`·키·`secrets.*`)만 막는다. 이 저장소가 쓰던 "경로에 `secret` 이 들어간 파일·`.env` 계열·`*.pem` 편집 차단" 은 `.claude/settings.json` 의 Write\|Edit PreToolUse 에 **별도 훅으로 그대로** 두었다. `main` 직접 푸시 차단도 옛 정규식(`git push … main` — `+main`·`HEAD:main`·`refs/heads/main` 포함)을 Bash PreToolUse 에 별도 훅으로 남기고, 6장이 금지하는 강제 푸시(`--force*`·`-f`) 차단 훅을 더했다. 템플릿 `agent-guard.cjs bash` 는 `+main` 을 통과시킨다. **`.claude/settings.json`·`.codex/hooks.json` 모두** 같은 훅이다(6장 약화 금지). `agent-guard.cjs`(템플릿 공용)는 고치지 않았다 | `.claude/settings.json`, `.codex/hooks.json` |
| `.agents/skills/` 의 템플릿 사본 6개(component-generator·db-migration·source-command-*), `.userdocs/` | **정리 보류** — 템플릿은 2.9·2.19 에서 지웠거나 `docs/` 로 합쳤지만 이 저장소는 그대로 둔다(2026-10-21 리드 결정). `.agents/skills/supabase*` 는 이 저장소가 설치한 스킬이다 | — |

### 검증 명령(실제값)

```bash
pnpm -r typecheck                                   # web·worker·shared 타입 검사
pnpm --filter web build                             # 프로덕션 빌드(tsc --noEmit + vite build)
node --experimental-strip-types --no-warnings --test tests/*.test.mjs   # 단위 테스트(node 내장 러너)
cd engine && python -m pytest                       # Python 엔진(engine/ 을 건드렸을 때)
pnpm --filter worker run deploy:dry                 # Worker 배포 dry-run
node scripts/agent-guard.cjs --selftest             # 에이전트 훅 판정 규칙 점검
```

루트에 `pnpm test` 스크립트는 없다.
