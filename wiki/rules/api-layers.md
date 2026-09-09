---
type: rule
updated: 2026-08-19
tags: [area/아키텍처, area/api]
---

# API 계층 규칙

백엔드 route/service/repository와 프론트 API client의 책임 분리. 표준 흐름은 `HTTP request → middleware → route → schema validation → service → repository/RPC/storage → response helper`다.

## 계층별 책임

- **route** — path/query/body 파싱, auth context 읽기, Zod 검증, service 호출, 표준 response 반환. 금지: Supabase `.from()` 직접 호출, storage 직접 접근, 긴 권한/상태 전이 구현, raw DB error 반환.
- **service** — 도메인 규칙, 권한 판단, 상태 전이, 여러 repository 조합, AppError throw. 금지: `c.json()` 반환, HTTP status 결정, request body 재파싱, UI 문구 조립.
- **repository** — Supabase query, PostgreSQL RPC, R2/storage 접근, DB row 변환. 금지: route/service import, HTTP response 생성, 권한 정책 결정. 복잡한 join/upsert/원자성 작업은 PostgreSQL function/RPC를 검토한다.

## 검증과 응답 계약

- request body/query/params는 Zod로 검증하고 `z.infer<typeof schema>`로 타입을 재사용한다. 프론트/백 공유가 안전한 schema만 `packages/shared`로 올린다(서버 secret·Env·Supabase client가 든 schema는 금지).
- 성공/실패 응답 shape는 프로젝트당 하나로 통일한다. Error shape는 `{ message, code, detail? }` — [에러 처리](error-handling.md).

## 프론트엔드

공통 API client(base URL, auth header, JSON parsing, 204 처리, error 변환, retry)를 통해서만 통신한다. 컴포넌트 안에서 raw `fetch`를 반복 작성하거나, 화면마다 error shape를 임의로 파싱하거나, service role key를 쓰는 것은 금지다.

## 계약 문서 갱신

endpoint/요청·응답/error code/권한/DB 영향이 바뀌면 [API 계약과 도메인 모델](api-contract.md)을 같은 작업에서 갱신한다.

## 함께 보기

- [계층 아키텍처](layered-architecture.md)
- [에러 처리](error-handling.md)
- [API 계약과 도메인 모델](api-contract.md)
- [코드 스타일](code-style.md)
- [프로젝트 구조](project-structure.md)
- [작업 흐름](workflow.md)
- [진입 규칙](agents-entry.md)
- [NestJS 프로젝트 규칙](nestjs.md)

## 출처

- [원본 · .agents/code/API.md](../sources/api.md)
