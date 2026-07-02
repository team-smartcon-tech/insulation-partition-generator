# NEST_GUIDE.md

## 1) Trigger Conditions

아래 조건 중 하나라도 만족하면 이 문서를 반드시 우선 적용한다.

- `package.json`에 `@nestjs/common` 또는 `@nestjs/core` 존재
- 진입점이 `src/main.ts` + `NestFactory.create(...)`
- 사용자 요청에 `Nest`, `NestJS` 명시

## 2) Mandatory Reading Order (Nest)

1. `AGENTS.md`
2. `.agents/ARCHITECTURE.md`
3. `.agents/STACK.md`
4. `.agents/code/NEST_GUIDE.md` (본 문서)
5. `.agents/code/PROJECT_STRUCTURE.md`
6. `.agents/code/CODE_STYLE.md`
7. `.agents/code/TESTING.md`

## 3) Nest Module Boundaries

- Controller: HTTP I/O, Guard, DTO 매핑만 담당
- Service: 유스케이스/트랜잭션/오케스트레이션 담당
- Module: 의존성 조립과 export 경계만 담당
- Entity: DB 구조 표현만 담당 (비즈니스 로직 금지)

## 4) Recommended src Layout (Nest)

```text
src/
  database/entities/*
  domains/
    automation/*
    identity/*
    engagement/*
  observability/*
  shared/*
  app.module.ts
  main.ts
```

## 5) Nest Scheduling Rule

스케줄 변경 시 아래 3개를 함께 검토한다.

- `task registry` (실행 액션 등록)
- `schedule service` (DB schedule orchestration)
- `scheduler service` (cron lifecycle)

## 6) Nest Refactor Guardrails

- 상대경로 대규모 변경 시 `src/...` alias 우선
- 폴더 이동 후 `app.module.ts` 조립 import 즉시 검증
- 최소 검증: `npm run build`
- 권장 검증: `npm run test`

## 7) Prohibited

- Controller에서 직접 복잡한 DB 로직 수행
- Module 경계를 무시한 cross-domain 직접 참조 남발
- 스케줄 로직 부분 수정 후 task/scheduler 동기화 누락

## 8) Cloudflare Worker + Drizzle Add-on

NestJS를 Cloudflare Worker에서 구동하거나 Supabase/Drizzle을 함께 다루는 경우,
반드시 `.agents/code/NEST_CF_WORKER.md`를 추가로 먼저 확인한다.
