---
type: rule
updated: 2026-08-19
tags: [area/검증]
---

# 테스트와 검증

모든 것을 과하게 테스트하지 않고, 위험한 경계와 반복 회귀 부분을 우선하는 검증 기준.

## 우선순위

1. 인증/권한
2. DB/RPC/RLS 영향
3. 결제/파일/운영 데이터 변경
4. API 요청/응답 계약
5. 복잡한 상태 전이
6. 주요 사용자 흐름

## 표준 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Worker는 `pnpm --filter <worker-package> run typecheck/test/deploy:dry`. **존재하지 않는 명령을 템플릿에 있다는 이유로 실행하거나 새로 만들지 않는다** — `package.json`과 문서의 명령 설명은 일치해야 한다.

**이 저장소에서 실제로 돌아가는 것은 `typecheck`·`test`·`build` 세 개다.** 위 4종과 `deploy:dry`는 원본이 CTPA 레퍼런스 기준으로 적어 둔 표준이고, 이 스캐폴드에는 `lint` 스크립트도 ESLint/Prettier 설정 파일도 없다 — [기술 스택](stack.md). 없는 명령을 실행해 실패를 확인하지 말고, 건너뛴 검증은 이유와 함께 보고한다 — [배포](deployment.md).

## 영역별

- **백엔드** — 가능하면 `createApp()`을 import해 request 단위(Vitest)로 테스트: health route, auth middleware, validation/permission/not found error, 상태 전이, repository/RPC 매핑.
- **프론트엔드** — route rendering, form validation, loading/empty/error state, permission UI, 반응형 layout, API error 표시. unit/component는 Vitest + Testing Library, E2E는 Playwright.
- **DB** — migration apply/rollback, 영향 API 통과, RLS 허용/차단 사용자, backfill count before/after — [마이그레이션](migration.md).

## 지킬 것

- production DB를 테스트 대상으로 쓰지 않는다.
- RLS, destructive migration, backfill은 테스트 또는 검증 SQL 없이 진행하지 않는다.
- fixture는 작고 읽기 쉽게, 개인정보/secret 미포함, 시간 의존 테스트는 고정 날짜.
- AI 에이전트는 완료 보고에 검증 결과(Checks run/Passed/Failed/Skipped/Reason/Residual risk)를 포함하고, 검증을 못 했으면 "검증하지 못함"이라고 명확히 적는다.

## 함께 보기

- [작업 흐름](workflow.md)
- [에러 처리](error-handling.md)
- [마이그레이션](migration.md)
- [코드 스타일](code-style.md)
- [기술 스택](stack.md)
- [배포](deployment.md)
- [절대 금지·필수 규칙](non-negotiable-rules.md)
- [NestJS 프로젝트 규칙](nestjs.md)

## 출처

- [원본 · .agents/code/TESTING.md](../sources/testing.md)
