# ARCHITECTURE.md

이 문서는 Woomi 신규 프로젝트의 표준 아키텍처를 정의한다. `AGENTS.md`는 진입 규칙이고, 상세 구조 판단은 이 문서를 따른다.

---

## 1. Core Architecture

회사의 기본 아키텍처는 **도메인 우선 모듈러 모놀리스 + 도메인 내부 레이어드 아키텍처**다.

작은 서비스는 전역 레이어 구조를 사용할 수 있다.

```txt
routes -> services -> repositories -> database/external systems
```

도메인이 많은 서비스는 도메인별로 나누고, 각 도메인 안에서 레이어를 분리한다.

```txt
src/
  domains/
  platform/
```

---

## 2. Backend Architecture

```txt
src/
  domains/                 # 비즈니스 도메인 단위 기능 묶음
    identity-access/        # 로그인, 세션, 사용자, 권한 같은 인증/인가 도메인
      identity.route.ts     # HTTP 요청/응답, 요청 검증, service 호출
      identity.service.ts   # 비즈니스 규칙, 권한 판단, 상태 전이
      identity.repository.ts # DB/RPC/storage 접근
      identity.schema.ts    # zod 요청/응답 검증 스키마
      identity.middleware.ts # 해당 도메인에만 필요한 요청 전처리/권한 가드

    site-registry/          # 현장, 조직, 프로젝트 같은 핵심 자원 관리 도메인
      site.route.ts
      site.service.ts
      site.repository.ts
      site.schema.ts

  platform/                 # 모든 도메인이 공유하는 기술 기반 계층
    auth/                   # 인증 컨텍스트, 세션/JWT 검증, role helper
    db/                     # Supabase client, table/rpc 상수, DB 공통 유틸
    env/                    # 환경변수 파싱, 필수 secret 검증
    errors/                 # AppError, ErrorCode, error middleware
    middleware/             # 전역 CORS, auth, logging, rate limit, request id middleware
    response/               # ok/created/validationError 같은 표준 응답 helper
    storage/                # R2/Supabase Storage 업로드, signed URL, path helper
    observability/          # logging, tracing, metrics, health check
```

`domains/`에는 제품의 업무 개념을 넣고, `platform/`에는 특정 업무를 모르는 기술 공통 기능만 넣는다.

예:

- "일일보고서 생성"은 `domains/daily-report`
- "Supabase client 생성"은 `platform/db`

middleware는 적용 범위에 따라 위치를 나눈다.

- 모든 API에 적용되는 CORS, request id, logging, auth context, rate limit은 `platform/middleware`
- 특정 도메인에만 필요한 권한 가드나 요청 전처리는 해당 도메인의 `*.middleware.ts`

---

## 3. Frontend Architecture

신규 프로젝트의 프론트엔드는 **React Router v7 Framework Mode + Feature-Sliced Design 계열 구조**를 기본으로 한다.

React Router Framework Mode에서는 `apps/web/app`이 프론트엔드 앱 루트다. URL에 직접 연결되는 파일은 `routes/`에 두고, 실제 기능과 도메인 모델은 `features/`와 `entities/` 아래에서 slice로 나눈다.

기존 FSD 개념은 유지한다. React Router v7 Framework Mode를 적용하면서 필수로 바뀌는 것은 URL 진입점 계층이 `pages/`가 아니라 `routes/`가 된다는 점이다.

```txt
apps/web/
  app/                       # React Router Framework app root
    root.tsx                 # root layout, provider, global error boundary
    routes.ts                # route config. 파일 라우팅을 쓰면 생략 가능
    routes/                  # URL에 직접 연결되는 route module
      _index.tsx
      admin.dashboard.tsx
      sites.$siteId.tsx

    features/                # 사용자가 수행하는 기능 단위 slice
      daily-report/
        components/
        hooks/
        api.ts
        types.ts

    entities/                # 여러 feature가 공유하는 핵심 데이터 모델 slice
      site/
        components/
        hooks/
        types.ts

    shared/                  # 특정 도메인을 모르는 공통 UI/유틸
      ui/
      api/
      lib/
      config/
      styles/
```

프론트엔드 의존성 방향:

```txt
root/routes -> features -> entities -> shared
```

금지 흐름:

```txt
shared -> features
entities -> features
features -> routes
components -> raw fetch 반복 작성
routes -> Supabase 직접 접근
```

작은 프로젝트는 `entities/`를 생략할 수 있다. 하지만 `shared/`에는 업무 지식이 들어가면 안 된다.

---

## 4. Runtime Boundary

프론트엔드와 백엔드는 하나의 모노레포 안에 둘 수 있지만, 물리적으로는 분리한다.

```txt
apps/
  web/
  worker/

packages/
  shared/
```

허용:

```txt
apps/web -> packages/shared
apps/worker -> packages/shared
apps/web -> HTTP API -> apps/worker
```

금지:

```txt
apps/web -> apps/worker/src/domains/*
apps/worker -> apps/web/app/features/*
packages/shared -> apps/web 또는 apps/worker
```

즉, 배포 단위와 런타임은 분리하고, 제품/도메인/문서/이슈 관리는 하나의 저장소에서 통합한다.

---

## 5. Multi-Worker Example

아래 구조는 `smart-schedule-X` 계열 프로젝트를 기준으로 든 **예시**다. 모든 프로젝트가 반드시 이 앱 이름과 개수를 따라야 하는 것은 아니다.

```txt
apps/
  web/
  gateway-worker/
  dcr-worker/
  rag-worker/
  ezgolgu-worker/

packages/
  shared/
  platform/
```

예시 구조에서 `gateway-worker`는 다른 Worker의 내부 코드를 import하지 않는다. 필요한 경우 Cloudflare service binding 또는 HTTP API로 호출한다. 공통 타입과 계약은 `packages/shared`에 둔다.

---

## 6. Core Rules

- route는 HTTP 입출력만 담당한다.
- service는 비즈니스 규칙을 담당한다.
- repository는 데이터 접근만 담당한다.
- middleware는 요청을 통과시킬지 막을지에 집중한다.
- 복잡한 권한 판단이나 상태 전이는 service로 넘긴다.
- 도메인 간 직접 repository 호출은 금지한다.
- shared에는 업무를 모르는 순수 공통만 둔다.
- platform에는 서버/Worker 중심 공통 기반만 둔다.

---

## 7. Project Override (insulation-partition-generator)

위 1~6장은 템플릿 표준이다. 이 저장소의 실제 구조는 아래와 같고(2026-10-21 코드 확인), 다르면 이 절이 이긴다(`AGENTS.md` 8장 — 실제 코드 우선).

### 런타임 경계 — 4장과 같다

```txt
apps/web        Vite + React SPA (wouter)      → HTTP /api/* →  apps/worker
apps/worker     Hono, 단일 Cloudflare Worker — SPA 정적 자산 + /api/* 를 함께 서빙
packages/shared @ipg/shared 공용 타입(ElevState 등). web 은 features/elevation/types.ts 에서 재수출
engine/         Python 마감 물량 엔진(finish_takeoff). 웹·Worker 와 코드를 공유하지 않는다
```

- `apps/web` 은 `apps/worker` 코드를 import 하지 않는다(주석의 경로 언급만 있음). Worker 는 다른 Worker(dcr-app)를 서비스 바인딩 `DCR_APP` 또는 `DCR_BASE_URL` HTTP 로 부른다 — 5장의 원칙과 같다.
- 데이터 원천은 Supabase(DB + 비공개 Storage). Worker 만 service role 키로 접근하고, 브라우저는 Supabase 에 직접 붙지 않는다.

### 프론트엔드 — 3장과 다르다

React Router v7 Framework Mode 가 아니므로 `apps/web/app/`·`routes/`·loader/action 이 없다.

```txt
apps/web/src/
  main.tsx, App.tsx          # 진입점, wouter <Route> 정의(URL 진입점은 여기 한 곳)
  features/<도구>/           # 도구(기능) 단위 slice — elevation(단열 Layout)·tcRental·market·takeoff·home·auth
    *Page.tsx, components/, api.ts(REST 클라), hooks.ts(react-query), types.ts, utils/
  components/                # ui/(shadcn 방식 프리미티브) · brand/
  lib/utils.ts               # cn() 등 순수 유틸
```

- `entities/` 계층은 없다(3장의 "작은 프로젝트는 생략 가능"). 도구 사이 공유는 `components/`·`lib/`·`packages/shared` 로 한다.
- 새 도구는 `features/home/tools.ts` 의 `TOOLS` 에 한 줄 + `features/<도구>/` + `App.tsx` 라우트(파일 머리 주석의 3단계).

### 백엔드 — 2장과 다르다

`domains/`·`platform/` 분리와 route/service/repository 3층이 없다. 라우트 파일 하나가 HTTP 입출력과 Supabase REST 호출을 함께 가진다.

```txt
apps/worker/src/
  index.ts           # Hono 앱, /health, /api/auth/*, authMiddleware, /api/elevation-projects*, /api/takeoff/*, 하위 라우터 마운트
  auth.ts            # DCR 로그인 위임, 세션 JWT(jose), authMiddleware, Env 타입
  market.ts          # /api/market/*
  sites.ts           # /api/sites (= /api/elevation-sites 별칭)
  tcRental.ts        # /api/tc-rental-projects*
  supabaseClient.ts  # Supabase REST/Storage fetch 헬퍼(index.ts 안에도 같은 헬퍼가 남아 있다)
```

- 실제 구조가 6장 Core Rules(route/service/repository 분리)와 다르다는 사실만 적는다. 기존 파일을 그 구조로 옮길지는 정해지지 않았다(결정 필요) — 정해지기 전에는 주변 파일 방식을 따른다.
