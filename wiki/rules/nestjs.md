---
type: rule
updated: 2026-08-19
tags: [area/아키텍처, area/조건부]
---

# NestJS 프로젝트 규칙

**조건부 규칙.** NestJS를 쓰는 프로젝트에서만 적용되고, 이 저장소의 표준 스택(React Router v7 + Hono/Workers — [기술 스택](stack.md))에는 적용되지 않는다. 이 스캐폴드에는 `apps/web` 하나만 있어 Worker 앱 자체가 없다. 조건을 만족하면 다른 코드 문서보다 이 규칙을 우선한다.

## 언제 적용되나

셋 중 하나라도 맞으면 적용한다: `package.json`에 `@nestjs/common` 또는 `@nestjs/core`가 있다 / 진입점이 `src/main.ts` + `NestFactory.create(...)`다 / 사용자가 요청에 `Nest`·`NestJS`를 명시했다.

적용되면 읽을 순서는 `AGENTS.md` → [계층 아키텍처](layered-architecture.md) → [기술 스택](stack.md) → 이 규칙 → [프로젝트 구조](project-structure.md) → [코드 스타일](code-style.md) → [테스트와 검증](testing.md)이다. 작은 작업에서 전부 읽지 않는다는 원칙은 그대로다 — [진입 규칙](agents-entry.md).

## 모듈 경계

Controller는 HTTP I/O·Guard·DTO 매핑만, Service는 유스케이스·트랜잭션·오케스트레이션, Module은 의존성 조립과 export 경계만, Entity는 DB 구조 표현만(비즈니스 로직 금지). 이 저장소의 `route → service → repository` 흐름([API 계층 규칙](api-layers.md))과 층 나누는 취지가 같다.

권장 `src` 레이아웃: `database/entities/*`, `domains/*`(도메인별), `observability/*`, `shared/*`, `app.module.ts`, `main.ts`.

## 금지

Controller에서 복잡한 DB 로직 직접 수행, Module 경계를 무시한 cross-domain 직접 참조 남발, 스케줄 로직 부분 수정 후 task/scheduler 동기화 누락.

## 스케줄과 리팩터

스케줄을 바꾸면 `task registry`(실행 액션 등록)·`schedule service`(DB orchestration)·`scheduler service`(cron lifecycle) 셋을 함께 검토한다. 상대경로 대규모 변경에는 `src/...` alias를 우선하고, 폴더 이동 뒤 `app.module.ts` 조립 import를 즉시 검증한다. 최소 검증은 `npm run build`, 권장은 `npm run test`.

## Cloudflare Worker + Drizzle 조합

NestJS를 Worker에서 돌리거나 Supabase/Drizzle을 함께 다루면 조건부 규칙이 하나 더 붙는다.

- **`wrangler.jsonc`** — `main: src/worker.ts`, `compatibility_flags: ["nodejs_compat"]`, 그리고 Worker에서 쓰지 않는 transport 패키지(`@nestjs/microservices`, `@nestjs/websockets/socket-module`, `@grpc/*`, `kafkajs`, `mqtt`, `nats`, `ioredis`, `amqplib` 등)를 빈 모듈로 `alias`한다. alias 없이 직접 로딩하지 않는다.
- **Worker 엔트리** — 요청마다 `NestFactory.createApplicationContext(AppModule)`로 컨텍스트를 만들고 닫는다. 순서는 `fetch(request, env)` → `env.DATABASE_URL`을 `process.env.DATABASE_URL`로 주입 → AppService 호출 → Response 반환 → context close. `DATABASE_URL` 없이 기동하지 않는다.
- **Drizzle** — `drizzle.config.ts`에 `schema`·`out` 경로를 명시 고정, `dialect: postgresql`, Supabase 연결 시 SSL 옵션 함께 설정. 스키마는 `pgTable` 중심으로 선언하고 `notNull`·`unique`·PK/identity를 코드에서 명시한다. 제약은 DB에 위임하기 전에 schema 파일에서 먼저 선언한다.
- **반영 순서** — `db:generate` → `db:migrate`(환경에 따라 `db:push`) → `start:cf:dev` → 검증 후 `deploy:cf`. 스키마 변경 후 반영 명령을 생략하지 않는다. 이 저장소의 Supabase CLI migration 절차([마이그레이션](migration.md))와는 다른 도구 계열이므로 섞지 않는다.
- **검증** — 최소 `npm run build`, Worker 동작은 `npm run start:cf:dev`, 스키마 변경 포함 시 `npm run db:generate` + 마이그레이션 반영 확인.

## 왜 별도 문서인가

이 규칙은 스택이 다른 프로젝트에만 적용된다. 조건을 확인하지 않고 적용하면 이 저장소 표준(React Router v7 + Hono + Supabase — [기술 스택](stack.md))과 충돌한다. 반대로 NestJS 프로젝트에서 이 규칙을 안 읽으면 Worker 런타임에서 빌드가 깨진다.

## 함께 보기

- [진입 규칙](agents-entry.md)
- [계층 아키텍처](layered-architecture.md)
- [기술 스택](stack.md)
- [API 계층 규칙](api-layers.md)
- [프로젝트 구조](project-structure.md)
- [마이그레이션](migration.md)
- [테스트와 검증](testing.md)

## 출처

- [원본 · .agents/code/NEST_GUIDE.md](../sources/nest-guide.md)
- [원본 · .agents/code/NEST_CF_WORKER.md](../sources/nest-cf-worker.md)
