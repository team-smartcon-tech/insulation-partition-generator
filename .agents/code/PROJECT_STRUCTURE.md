# PROJECT_STRUCTURE.md

이 문서는 Woomi 표준 프로젝트의 파일 위치와 layer boundary를 정의한다.

기준 레퍼런스는 CTPA의 `apps/web`, `apps/worker`, `packages/shared` 구성이다. 신규 프로젝트는 이 구조를 그대로 복사하기보다 `.agents/ARCHITECTURE.md`의 2.0 구조에 맞춰 적용한다.

이 문서는 표준 제공 템플릿이다. 새 프로젝트 또는 기존 프로젝트에 적용할 때는 실제 실행 앱, 배포 단위, 프론트엔드 프레임워크 모드, 백엔드 런타임, shared package 존재 여부를 확인하고 프로젝트에 맞게 수정한다. 이미 존재하는 프로젝트의 구조를 무시하고 템플릿 구조를 기계적으로 강제하지 않는다.

---

## 1. Root Structure

```txt
.
├── apps/
│   ├── web/                      # React Router v7 Framework Mode frontend
│   └── worker/                   # Hono + Cloudflare Worker backend
├── packages/
│   ├── shared/                   # browser/server safe types, constants, schemas, pure utils
│   └── platform/                 # server/Worker common auth, db, env, response, error, storage
├── .agents/                      # AI agent rules and project context
├── .github/                      # CI, PR template, GitHub instructions
├── docs/                         # human-facing docs
├── scripts/                      # repeatable automation
├── supabase/                     # migrations, seed, local config
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

원칙:

- `apps/*`는 실행/배포 단위다.
- `packages/*`는 공유 단위다.
- 앱 내부 파일끼리 직접 import하지 않는다.
- 공유 타입과 계약은 `packages/shared`로 올린다.
- Worker 공통 기반은 `packages/platform`으로 올린다.

---

## 2. Frontend Structure

React Router v7 Framework Mode를 기준으로 한다.

```txt
apps/web/
  app/
    root.tsx
    routes/
      _index.tsx
      admin._index.tsx
      admin.users.tsx
    features/
      user-management/
        api/
        model/
        ui/
        lib/
    entities/
      user/
        api/
        model/
        ui/
    shared/
      api/
      config/
      lib/
      ui/
      styles/
  public/
  package.json
```

책임:

| 위치 | 역할 |
|---|---|
| `app/root.tsx` | 전역 provider, layout root, error boundary |
| `app/routes/` | URL 진입점, loader/action, 화면 조립 |
| `app/features/` | 사용자 행동 단위 기능 |
| `app/entities/` | 업무 명사 단위 모델과 표시 |
| `app/shared/` | 도메인 지식 없는 공통 UI/API/lib |

규칙:

- route 파일은 화면 조립과 라우팅 책임 중심으로 둔다.
- route 파일에 긴 비즈니스 로직을 넣지 않는다.
- 서버 데이터는 TanStack Query 또는 React Router loader/action 경계를 사용한다.
- 폼은 React Hook Form + Zod를 우선한다.
- URL로 표현 가능한 상태는 search params에 둔다.
- 전역 UI 상태만 Zustand에 둔다.

---

## 3. Backend Structure

신규 Hono Worker는 도메인 우선 모듈러 모놀리스 구조를 따른다.

```txt
apps/worker/
  src/
    index.ts                     # Worker fetch entry
    app.ts                       # Hono app composition
    domains/
      attendance/
        attendance.route.ts
        attendance.service.ts
        attendance.repository.ts
        attendance.schema.ts
        attendance.middleware.ts
        attendance.type.ts
      approval/
        approval.route.ts
        approval.service.ts
        approval.repository.ts
        approval.schema.ts
    platform/
      auth/
      db/
      env/
      errors/
      middleware/
      response/
      storage/
      observability/
    routes.ts                    # domain route mounting
  tests/
  wrangler.jsonc
  package.json
```

CTPA에는 `routes/`, `services/`, `repositories/`, `schemas/`, `middlewares/`가 분리되어 있다. 신규 프로젝트에서는 같은 책임을 도메인 폴더 아래에 모아 응집도를 높인다.

책임:

| 파일 | 역할 |
|---|---|
| `*.route.ts` | HTTP 입출력, 인증 컨텍스트, Zod 검증, response helper |
| `*.service.ts` | 비즈니스 규칙, 권한, 상태 전이, repository 조합 |
| `*.repository.ts` | Supabase/RPC/R2 접근, row 변환 |
| `*.schema.ts` | request/response Zod schema, inferred type |
| `*.middleware.ts` | 도메인 전용 guard, idempotency, access check |
| `platform/*` | 공통 auth/db/env/error/response/storage/logging |

---

## 4. Shared Package

```txt
packages/shared/
  src/
    constants/
    schemas/
    types/
    utils/
    index.ts
```

허용:

- DTO 타입
- Zod schema
- role/status 상수
- pure util

금지:

- React component
- Supabase client
- Cloudflare `Env`
- service role key
- cookie/session 접근
- `apps/*` import

---

## 5. Platform Package

```txt
packages/platform/
  src/
    auth/
    db/
    env/
    errors/
    middleware/
    response/
    storage/
    observability/
```

허용:

- Supabase service client factory
- JWT/session helper
- Hono middleware
- AppError/ErrorCode
- response helper
- R2/storage helper
- logger/health check

금지:

- 브라우저 앱에서 직접 import
- 도메인 비즈니스 규칙 포함
- 특정 앱의 route/service import

---

## 6. Import Boundaries

허용:

```txt
route -> service -> repository -> platform/db
route -> platform/middleware
service -> other domain public service
apps/web -> packages/shared
apps/worker -> packages/shared
apps/worker -> packages/platform
```

금지:

```txt
repository -> service
repository -> route
service -> route
apps/web -> apps/worker/src/*
apps/worker -> apps/web/app/*
packages/shared -> apps/*
packages/shared -> packages/platform
```

도메인 간 DB 접근이 필요하면 다른 도메인의 repository를 직접 호출하지 않는다. public service, application service, queue/event, DB view/RPC 중 하나로 경계를 만든다.

---

## 7. File Naming

Backend:

```txt
*.route.ts
*.service.ts
*.repository.ts
*.schema.ts
*.middleware.ts
*.type.ts
*.constant.ts
```

Frontend:

```txt
*.tsx                  # React component/route
*.ts                   # model, api, lib
*.schema.ts            # zod schema
*.store.ts             # Zustand store
*.query.ts             # TanStack Query options/hooks
*.mutation.ts          # mutation hooks
```

이름은 역할과 도메인이 드러나게 작성한다.
