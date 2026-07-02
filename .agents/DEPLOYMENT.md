# DEPLOYMENT.md

이 문서는 Woomi 프로젝트의 배포 환경, secret, Cloudflare/Wrangler 운영 규칙을 정리한다.

배포는 코드 변경보다 위험하다. 에이전트는 사용자 승인 없이 자동 배포하지 않는다.

---

## 1. Environments

모든 프로젝트는 최소 세 환경을 구분한다.

| 환경 | 목적 | 배포 대상 | 원칙 |
|---|---|---|---|
| local | 개발자 로컬 실행 | local dev server | 실제 운영 secret 사용 금지 |
| dev/staging | 배포 전 검증 | Cloudflare dev/staging | 운영 데이터와 분리 |
| production | 실제 사용자 서비스 | Cloudflare production | 배포 전 승인 필요 |

환경별로 분리해야 하는 것:

- Worker/Page name
- Supabase project 또는 DB URL
- R2 bucket
- KV namespace
- Queue
- Service Binding target
- Cron trigger 필요 여부
- secret 값

---

## 2. Cloudflare Deployment Model

Cloudflare 프로젝트는 `wrangler.jsonc`를 기준으로 배포한다.

모노레포는 저장소 통합 전략이지 단일 배포 단위를 뜻하지 않는다. 프론트엔드와 백엔드가 같은 레포에 있어도 Cloudflare 배포는 하나의 Worker로 합칠 수도 있고, 여러 Worker로 분리 배포한 뒤 Service Binding으로 연결할 수도 있다.

선택 기준:

| 프로젝트 유형 | 권장 배포 방식 | 기준 |
|---|---|---|
| 작은 앱, MVP, 내부 도구 | 하나의 Worker 통합 배포 | 프론트, API, assets가 작고 도메인이 적은 경우 |
| 중대형 앱, 도메인이 많은 서비스 | gateway-worker + domain workers 분리 배포 | API 책임이 많고 RAG/AI/파일/권한 같은 리소스 경계가 필요한 경우 |
| 이미 service binding으로 나뉜 기존 프로젝트 | 분리 배포 유지 | 모노레포로 합치더라도 실행/배포 단위는 유지 |

배포 형태 예:

```txt
통합 배포:
apps/web
apps/worker
-> one Cloudflare Worker
   - static assets
   - /api/*
   - DB/storage access

분리 배포:
Browser
  -> gateway-worker
      -> ASSETS
      -> API_SERVICE
      -> RAG_SERVICE
      -> FILE_SERVICE
```

분리 배포에서는 Worker 간 내부 호출에 Service Binding을 우선 사용한다. gateway-worker는 다른 Worker의 내부 코드를 직접 import하지 않는다.

필수 항목:

```txt
Worker/Page name:
Wrangler config path:
Main entry:
Compatibility date:
Compatibility flags:
Assets binding:
Service bindings:
KV namespaces:
R2 buckets:
Queues:
Cron triggers:
Workers AI binding:
Observability:
```

프로젝트별 실제 구조는 `wrangler.jsonc`와 `README.md`에 명시한다.

---

## 3. Wrangler Environment Rules

Wrangler의 `env.dev` 또는 `env.staging`은 top-level 설정을 모두 자동 상속하지 않는다.

다음 항목은 환경별로 다시 선언해야 한다.

```txt
vars
kv_namespaces
r2_buckets
services
ai
assets
observability
triggers
build
```

규칙:

- production 기본값은 top-level에 둔다.
- dev/staging은 `env.dev`, `env.staging`에 명시한다.
- dev/staging이 production 리소스를 바라보지 않게 한다.
- dev build가 production `.env`를 박지 않도록 build command를 환경별로 분리한다.
- service binding은 환경별 대상 Worker를 분리한다.

예:

```jsonc
{
  "name": "my-app",
  "services": [
    { "binding": "API", "service": "my-api" }
  ],
  "env": {
    "dev": {
      "name": "my-app-dev",
      "services": [
        { "binding": "API", "service": "my-api-dev" }
      ]
    }
  }
}
```

---

## 4. Vars, Secrets, Env Files

구분:

| 종류 | 예 | 저장 위치 |
|---|---|---|
| public build env | `VITE_PUBLIC_*` | `.env.development`, `.env.production`, CI vars |
| Worker vars | 모델명, feature flag, public URL | `wrangler.jsonc` `vars` |
| Worker secrets | service role key, JWT secret, API key | Cloudflare Worker Secrets |
| local sample | 필요한 key 목록 | `.env.example` |

금지:

- secret을 코드에 하드코딩
- `.env` 실제 값을 커밋
- 프론트엔드에 service role key 노출
- production secret을 dev/staging에 재사용
- Supabase URL/anon key를 여러 파일에 흩뿌리기

secret 등록 예:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put JWT_SECRET
wrangler secret put OPENAI_API_KEY

wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env dev
wrangler secret put JWT_SECRET --env dev
wrangler secret put OPENAI_API_KEY --env dev
```

Worker는 1회 이상 배포된 뒤에 secret 등록이 필요한 경우가 있다. 이 조건은 프로젝트 README 또는 본 문서에 적는다.

---

## 5. Bindings

### 5.1 Service Bindings

Worker 간 내부 호출은 Cloudflare Service Binding을 우선한다.

규칙:

- 내부 Worker 코드를 직접 import하지 않는다.
- 외부 URL `fetch`보다 Service Binding을 우선한다.
- binding 이름은 역할이 드러나게 작성한다.
- dev/staging/prod 대상 Worker를 분리한다.

예:

```txt
API_SERVICE -> api-worker
RAG_SERVICE -> rag-worker
AUTH_SERVICE -> auth-worker
```

### 5.2 R2

파일 업로드나 비공개 파일 저장이 필요하면 R2 bucket을 기본 storage로 설계한다.

규칙:

- production과 dev/staging bucket을 분리한다.
- binding 이름은 도메인 또는 목적이 드러나게 한다.
- private 파일은 인증 없이 signed URL을 발급하지 않는다.
- 파일 경로는 `{feature}/{ownerId or siteId}/{uuid}.{ext}` 형태를 우선한다.

### 5.3 KV / Queues / Cron / AI

리소스별로 환경 분리를 명시한다.

```txt
KV:
Queue:
Cron:
Workers AI:
```

Cron은 production과 dev/staging에서 모두 필요한지 확인한다. dev/staging cron이 운영 데이터에 영향을 주면 비활성화한다.

---

## 6. Required Checks Before Deploy

배포 안내 또는 실행 전에 반드시 확인한다.

```bash
git status
git fetch
git status -sb
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Cloudflare Worker dry-run:

```bash
pnpm --filter <worker-package> run deploy:dry
```

또는 프로젝트별 명령:

```bash
pnpm cf:deploy:dry
pnpm deploy:dry
```

배포를 보류해야 하는 상태:

- 미커밋 변경 있음
- untracked 파일 있음
- remote 대비 ahead/behind 있음
- lint/typecheck/test/build 실패
- dry-run 실패
- production secret 누락
- dev/staging이 production 리소스를 바라봄
- 문서와 `package.json` 명령이 불일치

사용자에게 상태를 명시적으로 알리고 배포를 보류한다.

---

## 7. Deploy Commands

프로젝트는 아래 convention을 우선 사용한다.

```bash
pnpm deploy          # production 배포
pnpm deploy:dry      # production dry-run
pnpm deploy:dev      # dev/staging 배포
pnpm deploy:dev:dry  # dev/staging dry-run
```

Cloudflare prefix를 쓰는 프로젝트는 아래도 허용한다.

```bash
pnpm cf:deploy
pnpm cf:deploy:dry
pnpm cf:deploy:dev
pnpm cf:deploy:dev:dry
```

명령 이름은 `package.json`과 `README.md`에서 일치해야 한다.

---

## 8. CI/CD

회사 표준 CI/CD 기본값은 GitHub Actions다.

Cloudflare Git Integration, Workers Builds, Pages Git Deploy는 개인 프로젝트, 프로토타입, 단순한 소규모 앱에서 예외로 허용할 수 있다. production 배포는 GitHub Actions를 우선한다.

### 8.1 GitHub Actions Standard

신규 프로젝트의 기본 브랜치 전략은 `main -> production`이다.

기본 전략:

| 브랜치/이벤트 | 대상 | 용도 |
|---|---|---|
| `main` | production | 실제 사용자 서비스 배포 |
| `develop` 또는 `dev` | dev/staging | 배포 전 검증 환경 |
| `feature/*` 또는 PR | preview/check only | 리뷰, lint/test/build 검증 |

기존 프로젝트가 `deploy` 브랜치를 production 배포용으로 사용 중이면 예외로 허용한다. 단, `AGENTS.md` 또는 이 문서의 Project Override에 명시해야 한다.

CI/CD를 사용하는 경우 다음을 명시한다.

```txt
Production branch: main
Dev/Staging branch:
Preview/PR trigger:
GitHub Environment for dev:
GitHub Environment for production:
Required reviewers:
```

GitHub Actions에서 secret을 동기화하는 경우:

- GitHub Environment별 secret을 분리한다.
- wrangler CLI 인증 secret과 Worker runtime secret을 구분한다.
- 배포 로그에 secret 값이 찍히지 않게 한다.
- dev/prod 배포가 같은 Worker name/R2 bucket을 쓰지 않게 한다.

### 8.2 Cloudflare CI/CD Exception

Cloudflare Git Integration, Workers Builds, Pages Git Deploy를 사용할 수 있는 경우:

- 개인 프로젝트 또는 프로토타입
- 단일 Worker/Pages로 충분한 소규모 앱
- monorepo 조건부 배포가 단순한 앱
- production 승인과 검증 흐름을 별도로 문서화한 경우

예외를 사용하더라도 생략하면 안 되는 것:

- PR 리뷰 또는 변경 승인
- lint/typecheck/test/build 검증
- 환경별 secret 분리
- production 배포 승인
- `README.md`와 `DEPLOYMENT.md` 문서화
- dev/prod Worker name, R2 bucket, KV, Service Binding 분리

금지:

- 중대형 또는 멀티 Worker production 프로젝트를 Cloudflare 대시보드 설정만으로 운영
- 대시보드에만 존재하는 빌드/배포 규칙
- 검증 없이 `main` push만으로 production 자동 배포
- GitHub Actions와 Cloudflare 자동 배포를 동시에 켜서 중복 배포가 발생하는 상태

---

## 9. Rollback

rollback은 "이전 코드로 되돌리기"만 뜻하지 않는다. 배포 대상, DB migration, secret, binding, storage 변경 여부에 따라 복구 방법이 달라진다.

AI 에이전트는 rollback을 사용자 승인 없이 실행하지 않는다. 먼저 영향 범위와 되돌릴 대상을 보고한 뒤 승인을 받는다.

### 9.1 Rollback Plan

프로젝트마다 아래 항목을 채운다.

```txt
Rollback command/process:
Previous deployment id:
Cloudflare rollback method:
Data rollback needed:
DB migration rollback:
Secret rollback:
Binding rollback:
R2/KV/Queue rollback:
Expected downtime:
Owner:
```

예:

```txt
Rollback command/process:
  Worker: wrangler rollback --name <worker-name> --env production
  Pages: Cloudflare dashboard에서 이전 production deployment로 rollback

Previous deployment id:
  GitHub Actions run id 또는 Cloudflare deployment/version id

Cloudflare rollback method:
  Worker version rollback
  Pages deployment rollback

Data rollback needed:
  no / yes, reason:

DB migration rollback:
  no / yes, migration file:

Secret rollback:
  no / yes, changed secret names:

Binding rollback:
  no / yes, changed bindings:

R2/KV/Queue rollback:
  no / yes, affected resources:

Expected downtime:
  none / short / unknown

Owner:
  deployment owner name
```

### 9.2 Rollback Types

| 유형 | 되돌릴 대상 | 주의점 |
|---|---|---|
| code rollback | Worker/Pages deployment | 가장 단순하지만 DB/API 계약이 바뀐 경우 불충분할 수 있음 |
| config rollback | `wrangler.jsonc`, vars, routes, compatibility flags | 이전 deployment와 현재 binding 구성이 맞는지 확인 필요 |
| secret rollback | Worker secrets, GitHub Environment secrets | secret 값은 git diff에 남지 않으므로 별도 기록 필요 |
| DB rollback | migration, RPC, RLS, seed/backfill | 데이터 손실 위험이 있으므로 `.agents/data/MIGRATION.md` 확인 필수 |
| storage rollback | R2 object, KV value, Queue message | 파일 삭제/덮어쓰기 여부를 먼저 확인 |
| traffic rollback | gradual deployment 비율 조정 | Worker 버전/트래픽 분배 상태 확인 필요 |

### 9.3 Rollback 전 확인

```bash
git status
git fetch
git status -sb
```

확인할 것:

- 어떤 배포가 문제를 만들었는가?
- 문제 배포의 commit SHA, GitHub Actions run id, Cloudflare deployment/version id는 무엇인가?
- 이전 정상 배포 id를 알고 있는가?
- DB migration, secret, binding, R2/KV/Queue 변경이 포함되었는가?
- rollback이 자동으로 production traffic에 반영되는가?
- rollback 후 검증할 URL과 health check는 무엇인가?

rollback을 보류해야 하는 상태:

- 이전 정상 deployment id가 불명확함
- DB migration rollback 계획 없음
- secret 또는 binding 변경 내역을 모름
- rollback 대상 Worker/Page를 확신할 수 없음
- 사용자의 명시 승인 없음

### 9.4 Rollback 후 확인

rollback 후에는 다음을 확인한다.

```txt
Production URL:
Health check:
Critical API:
Auth/session:
Main user flow:
Cloudflare deployment/version:
Error logs:
```

DB migration이 포함된 배포는 코드 rollback만으로 복구되지 않을 수 있다. 이 경우 `.agents/data/MIGRATION.md`의 rollback 계획을 먼저 확인한다.

Cloudflare Worker rollback은 이전 Worker version을 활성 deployment로 바꾸는 방식이다. 중간에 KV, D1, R2, secret, binding 같은 플랫폼 리소스가 변경되었으면 코드만 되돌려도 이전 상태와 동일하지 않을 수 있다.

---

## 10. Deployment Report

배포 전 또는 배포 후 사용자에게 다음을 보고한다.

```txt
Target environment:
Git status:
Ahead/behind:
Checks run:
Dry-run result:
Bindings changed:
Secrets changed:
DB migration included:
Deploy command:
Rollback note:
```

검증하지 못한 항목은 "검증하지 못함"이라고 명시한다.
