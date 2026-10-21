---
type: rule
updated: 2026-09-13
tags: [area/아키텍처]
---

# 기술 스택

Woomi 신규 프로젝트의 표준 기술 선택. 스택을 바꾸려면 사유와 영향 범위를 문서화하고 합의 후 반영한다.

## 표준 스택

- **프론트엔드** — React, React Router v7 Framework Mode, TypeScript, TanStack Query, Zustand, React Hook Form, Zod. 기본 프레임워크는 `React + Vite`가 아니라 React Router v7 Framework Mode다.
- **백엔드** — Cloudflare Workers(또는 Pages Functions), Hono, TypeScript strict, Zod, Supabase JS.
- **데이터베이스** — Supabase PostgreSQL, PostgreSQL function/RPC.
- **스토리지/인프라** — Cloudflare R2 또는 Supabase Storage, Cron Triggers 또는 Queue, Wrangler.
- **툴링** — pnpm workspace, TypeScript project references, Vitest, **Prettier**, **ESLint 9**, GitHub Actions(`pr-checks.yml`·`tag-version.yml`). 2.18-draft 에서 포맷·린트가 표준이 됐다 — 그 전 규칙이던 "strict 타입 검사로 커버되면 굳이 추가하지 않는다" 는 **근거가 틀렸다**(타입 검사가 못 잡는 버그가 스캐폴드에 실제로 있었다). 값과 근거는 [포맷과 린트 기준](formatting-and-linting.md). Wrangler는 여전히 **프로젝트에서 도입한 경우에만**.

## 상태·데이터 역할 분담

- React Router — 라우팅과 loader/action. route 초기 데이터는 loader 우선.
- TanStack Query — 서버 데이터 캐시/동기화.
- Zustand — 전역 클라이언트 UI 상태만.
- React Hook Form + Zod — 복잡한 폼과 검증.
- URL로 표현 가능한 상태는 URL search params에 둔다.

## 지킬 것

- 한 프로젝트 안에서 UI 프레임워크를 섞지 않는다. 디자인 시스템이 없으면 MUI, Tailwind+shadcn/ui, Radix 중 하나로 통일.
- TypeScript는 경계(API 요청/응답, DB row, role, form 입력, Worker Env, shared schema)에 우선 적용하고 `strict: true`를 쓴다. 복잡한 제네릭 남발·타입 체조 금지.
- RLS가 필요한 서비스는 정책 문서를 반드시 둔다 — [DB 스키마 가드레일](db-schema-guardrails.md).
- 일회성 스크립트·버릴 프로토타입은 JavaScript 허용 가능.

## 함께 보기

- [계층 아키텍처](layered-architecture.md)
- [프로젝트 구조](project-structure.md)
- [코드 스타일](code-style.md)
- [테스트와 검증](testing.md)
- [배포](deployment.md)
- [바이브코딩 가이드](vibe-coding-guide.md)
- [DB 스키마 가드레일](db-schema-guardrails.md)
- [NestJS 프로젝트 규칙](nestjs.md)
- [작업 흐름](workflow.md)
- [포맷과 린트 기준](formatting-and-linting.md)

## 출처

- [원본 · .agents/STACK.md](../sources/stack.md)
