---
type: rule
updated: 2026-10-21
tags: [area/코드품질, area/api]
---

# 에러 처리

일관된 error response로 클라이언트가 `code` 기준으로 안정 분기하게 하고, raw provider error를 사용자에게 노출하지 않는 기준.

> **이 저장소 주의(insulation-partition-generator)**: 이 문서는 템플릿 표준 기준이다. 본문 규칙은 그대로 두고, 이 저장소에서는 다음을 함께 읽는다. CI(`.github/workflows/pr-checks.yml` — 이 저장소에는 없음)·Prettier·ESLint(`pnpm format:check`·`pnpm lint`)·Vitest·`pnpm test` 는 **없다**. Zustand·React Hook Form·Zod 도 **쓰지 않는다**(입력 검증은 손으로 쓴다). 프론트는 React Router v7(`app/routes/`·loader/action)이 아니라 Vite + wouter(`apps/web/src/features/*`, 라우트는 `apps/web/src/App.tsx`)다. 템플릿 샘플 컴포넌트(`SheetGrid`·공용 `Skeleton`·`version-info` 등)는 없다 — 공용 UI 는 `apps/web/src/components/` 에 실제로 있는 것만 쓴다. `packages/shared`(`@ipg/shared`)는 있지만 `src/index.ts` 한 파일에 공용 타입만 있다(`schemas/`·Zod 없음). 실제 검증 명령과 차이 목록은 [`AGENTS.md`](../../AGENTS.md) 11장, 구조는 `.agents/ARCHITECTURE.md` 7장.

## 표준 shape와 흐름

- Error shape: `{ message: string, code: string, detail?: unknown }`.
- 도메인 오류는 `AppError`(예: `new AppError(ErrorCode.NotFound, ...)`)로 throw하고, 전역 `app.onError(errorHandler)`가 status와 body로 변환한다. route마다 try/catch를 반복하지 않는다.
- HTTP status 매핑: validation 400, auth 401, forbidden 403, not found 404, conflict 409, external dependency 503, unknown 500.
- error code는 enum/const object로 중앙화하고 대문자 snake case(`NOT_FOUND`, `DATABASE_ERROR`)를 쓴다. 새 code를 추가하면 status map도 같이 갱신한다.
- 클라이언트 분기는 message가 아니라 **code** 기준이다.

## Validation

Zod 검증 실패는 별도 code + `validationError(c, parsed.error.flatten())`로 즉시 반환한다. 프론트는 field error와 form error를 분리해 표시한다.

## Repository와 로깅

repository는 provider error를 감싸서 던진다(`AppError(ErrorCode.DatabaseError, ..., { cause })`). SQL, key, token, full payload는 노출하지 않는다.

로그에 남기면 안 되는 것: access/refresh token, service role key, password, private file URL, 주민번호·전화번호 등 민감정보 원문. 남길 것: request id, route/method, error code, safe detail, dependency name.

## 프론트엔드 금지

`error.message`를 그대로 alert 하지 않는다. 화면마다 HTTP status 해석을 중복하지 않는다. 실패한 mutation 뒤 optimistic state를 복원한다. loading/empty/error 상태를 모두 표시한다 — [UX 규칙](ux-rules.md).

## 함께 보기

- [API 계층 규칙](api-layers.md)
- [코드 스타일](code-style.md)
- [UX 규칙](ux-rules.md)
- [테스트와 검증](testing.md)
- [진입 규칙](agents-entry.md)

## 출처

- [원본 · .agents/code/ERROR_HANDLING.md](../sources/error-handling.md)
