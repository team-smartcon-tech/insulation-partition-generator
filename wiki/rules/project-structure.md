---
type: rule
updated: 2026-08-19
tags: [area/아키텍처]
---

# 프로젝트 구조

파일이 어디에 있어야 하고 무엇을 import할 수 있는지의 규칙. [계층 아키텍처](layered-architecture.md)를 파일 단위로 구체화한 것이다.

## 루트 구조

`apps/`(web, worker — 실행/배포 단위), `packages/`(shared, platform — 공유 단위), `.agents/`, `.github/`, `docs/`, `scripts/`, `supabase/`. 공유 타입/계약은 `packages/shared`, Worker 공통 기반은 `packages/platform`으로 올린다.

## 파일 책임

- 백엔드(`apps/worker/src`): `index.ts`(fetch entry), `app.ts`(Hono 조립), `domains/`(도메인별 route/service/repository/schema/middleware), `platform/`. 파일명은 `*.route.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`, `*.middleware.ts`, `*.type.ts`, `*.constant.ts`.
- 프론트엔드(`apps/web/app`): `routes/`, `features/`(api/model/ui/lib), `entities/`(api/model/ui), `shared/`(api/config/lib/ui/styles). 파일명은 `*.tsx`, `*.schema.ts`, `*.store.ts`, `*.query.ts`, `*.mutation.ts`.

## Import 경계 (금지)

- `repository → service`, `repository → route`, `service → route`
- `apps/web → apps/worker/src/*`, `apps/worker → apps/web/app/*`
- `packages/shared → apps/*`, `packages/shared → packages/platform`
- 도메인 간 다른 도메인 repository 직접 호출 — 필요하면 public service, application service, queue/event, DB view/RPC 중 하나로 경계를 만든다.

## shared / platform 에 못 올리는 것

- `packages/shared` 금지: React component, Supabase client, Cloudflare `Env`, service role key, cookie/session 접근, `apps/*` import.
- `packages/platform` 금지: 브라우저 앱에서 직접 import, 도메인 비즈니스 규칙, 특정 앱의 route/service import.

## 왜 중요한가

이미 존재하는 프로젝트 구조를 무시하고 템플릿을 기계적으로 강제하지 않는다 — 실제 코드가 항상 우선이다([진입 규칙](agents-entry.md)의 충돌 우선순위). 하지만 새로 만들 때는 이 경계가 도메인 응집도와 안전한 공유의 기준이 된다.

## 함께 보기

- [계층 아키텍처](layered-architecture.md)
- [API 계층 규칙](api-layers.md)
- [코드 스타일](code-style.md)
- [기술 스택](stack.md)
- [공통 컴포넌트](components.md)
- [바이브코딩 가이드](vibe-coding-guide.md)
- [작업 흐름](workflow.md)
- [NestJS 프로젝트 규칙](nestjs.md)

## 출처

- [원본 · .agents/code/PROJECT_STRUCTURE.md](../sources/project-structure.md)
