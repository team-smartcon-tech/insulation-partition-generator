---
type: rule
updated: 2026-08-19
tags: [area/아키텍처]
---

# 계층 아키텍처

도메인 우선 모듈러 모놀리스 + 도메인 내부 레이어드 아키텍처. 작은 서비스는 전역 레이어 구조도 가능하다.

## 백엔드

레이어 흐름은 `routes → services → repositories → database/external systems`다.

코드는 두 축으로 나뉜다.

- `src/domains/` — 비즈니스 도메인(예: identity-access, site-registry). 도메인마다 `*.route.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`(zod), `*.middleware.ts`.
- `src/platform/` — auth, db, env, errors, middleware, response, storage, observability 같은 기술 공통.

핵심 규칙: 도메인 간 직접 repository 호출 금지. 복잡한 권한 판단·상태 전이는 service로. platform에는 서버/Worker 중심 공통 기반만.

## 프론트엔드

React Router v7 Framework Mode + Feature-Sliced Design 계열 구조. 앱 루트는 `apps/web/app`이고 `root.tsx`, `routes.ts`, `routes/`, `features/`, `entities/`, `shared/`로 구성된다.

의존성 방향은 `root/routes → features → entities → shared` 한 방향이다. 금지 흐름: `shared → features`, `entities → features`, `features → routes`, `routes → Supabase 직접 접근`. `shared/`에는 업무 지식이 들어가면 안 된다.

## 런타임 경계

프론트와 백엔드는 하나의 모노레포에 두되 물리적으로 분리한다(`apps/web`, `apps/worker`, `packages/shared`). 금지: `apps/web → apps/worker/src/domains/*`, `apps/worker → apps/web/app/features/*`, `packages/shared → apps/*`.

멀티 Worker에서는 gateway-worker가 다른 Worker 내부 코드를 import하지 않고 Cloudflare service binding 또는 HTTP API로 호출한다 — [배포](deployment.md).

## 왜 중요한가

계층과 경계가 지켜져야 AI가 코드를 예측 가능하게 만들고, 사람이 리뷰할 수 있다. 위반 패턴은 [작업 흐름](workflow.md)의 아키텍처 위반 금지 목록에서도 다시 막는다.

## 함께 보기

- [프로젝트 구조](project-structure.md)
- [API 계층 규칙](api-layers.md)
- [기술 스택](stack.md)
- [배포](deployment.md)
- [진입 규칙](agents-entry.md)
- [바이브코딩 가이드](vibe-coding-guide.md)
- [NestJS 프로젝트 규칙](nestjs.md)

## 출처

- [원본 · .agents/ARCHITECTURE.md](../sources/architecture.md)
