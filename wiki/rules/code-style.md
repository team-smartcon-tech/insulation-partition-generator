---
type: rule
updated: 2026-10-21
tags: [area/코드품질]
---

# 코드 스타일

Woomi 표준 TypeScript 작성 기준. strict mode 기준이고, indent·semicolon·quote는 **손으로 맞추지 않는다** — `pnpm format` 이 정리한다([포맷과 린트 기준](formatting-and-linting.md), 2.18-draft 도입). 포맷 대상이 아닌 파일(`*.md`·`docs/`)만 주변 파일의 스타일에 맞춘다. 타입 전용 import는 `import type`.

> **이 저장소 주의(insulation-partition-generator)**: 이 문서는 템플릿 표준 기준이다. 본문 규칙은 그대로 두고, 이 저장소에서는 다음을 함께 읽는다. CI(`.github/workflows/pr-checks.yml` — 이 저장소에는 없음)·Prettier·ESLint(`pnpm format:check`·`pnpm lint`)·Vitest·`pnpm test` 는 **없다**. Zustand·React Hook Form·Zod 도 **쓰지 않는다**(입력 검증은 손으로 쓴다). 프론트는 React Router v7(`app/routes/`·loader/action)이 아니라 Vite + wouter(`apps/web/src/features/*`, 라우트는 `apps/web/src/App.tsx`)다. 템플릿 샘플 컴포넌트(`SheetGrid`·공용 `Skeleton`·`version-info` 등)는 없다 — 공용 UI 는 `apps/web/src/components/` 에 실제로 있는 것만 쓴다. `packages/shared`(`@ipg/shared`)는 있지만 `src/index.ts` 한 파일에 공용 타입만 있다(`schemas/`·Zod 없음). 실제 검증 명령과 차이 목록은 [`AGENTS.md`](../../AGENTS.md) 11장, 구조는 `.agents/ARCHITECTURE.md` 7장.

## 공통

- 사용하지 않는 import/변수/dead code 금지. 의미 있는 숫자·문자열은 상수화. 복잡한 조건식에는 이름을 붙이고 중첩 삼항은 피한다.
- `any`는 금지에 가깝게 다루고, 필요하면 이유를 주석/PR에 남긴다. `unknown`을 좁히는 방식 우선, type assertion은 경계부에서만.
- 외부 입력은 타입만 믿지 않고 Zod 등 런타임 검증을 쓴다.
- TODO에는 목적 태그를 단다: `TODO[migration]`, `TODO[security]`, `TODO[cleanup]`, `TODO[compat]`.

## 백엔드

`index.ts`는 Worker fetch entry만, `app.ts`는 Hono app·global middleware·route mount만. 계층 책임은 [API 계층 규칙](api-layers.md)과 같다. Supabase client 생성은 `platform/db`에서만, 테이블/RPC명은 중앙 상수화.

## 프론트엔드

- UI 배치: 재사용 UI는 `shared/ui`, 도메인 표시 UI는 `entities/*/ui`, 사용자 행동 UI는 `features/*/ui`.
- `useEffect`는 외부 시스템 동기화에만 쓴다.
- 상태 우선순위: local state → URL search params → 서버 데이터(TanStack Query 또는 loader/action) → 전역 UI 상태만 Zustand. 서버 데이터를 Zustand에 장기 저장하지 않는다.
- 복잡한 폼은 React Hook Form + Zod.

## 체크리스트

파일 위치 일관성, 계층 책임 미혼재, 런타임 검증, 표준 error shape, secret 미노출, 과한 추상화 금지, 검증 명령 실행 또는 미실행 사유 기록. 보안·secret·데이터 손실 방지 규칙은 프로젝트 사정과 무관하게 완화하지 않는다 — [절대 금지·필수 규칙](non-negotiable-rules.md).

## 함께 보기

- [API 계층 규칙](api-layers.md)
- [프로젝트 구조](project-structure.md)
- [에러 처리](error-handling.md)
- [테스트와 검증](testing.md)
- [포맷과 린트 기준](formatting-and-linting.md)
- [기술 스택](stack.md)
- [NestJS 프로젝트 규칙](nestjs.md)
- [좋은 예시와 금지 예시](examples.md)

## 출처

- [원본 · .agents/code/CODE_STYLE.md](../sources/code-style.md)
