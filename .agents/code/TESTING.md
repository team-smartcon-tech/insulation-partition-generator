# TESTING.md

이 문서는 Woomi 표준 테스트와 검증 기준을 정의한다.

기준 레퍼런스는 CTPA의 Vitest 기반 Worker route test와 `pnpm lint/typecheck/test/build/deploy:dry` 검증 흐름이다.

이 문서는 표준 제공 템플릿이다. 프로젝트에 적용할 때는 실제 test runner, E2E 도구, package script, CI 환경을 확인하고 명령과 테스트 범위를 프로젝트에 맞게 수정한다. 존재하지 않는 명령을 템플릿에 있다는 이유만으로 실행하거나 새로 만들지 않는다.

---

## 1. Testing Philosophy

- 모든 것을 과하게 테스트하지 않는다.
- 위험한 경계와 반복 회귀가 생기는 부분을 우선 테스트한다.
- AI 에이전트는 테스트를 추가하지 못한 경우 이유를 최종 보고에 명시한다.

우선순위:

1. 인증/권한
2. DB/RPC/RLS 영향
3. 결제/파일/운영 데이터 변경
4. API request/response 계약
5. 복잡한 상태 전이
6. 주요 사용자 흐름

---

## 2. Standard Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Cloudflare Worker:

```bash
pnpm --filter <worker-package> run typecheck
pnpm --filter <worker-package> run test
pnpm --filter <worker-package> run deploy:dry
```

프로젝트에 없는 명령은 억지로 만들지 않는다. 다만 `package.json`, `README.md`, `.agents/WORKFLOW.md`의 명령 설명은 일치해야 한다.

---

## 3. Backend Tests

우선 테스트할 것:

- health route
- auth middleware
- validation error
- permission error
- not found
- domain state transition
- repository/RPC mapping

Hono app은 가능하면 `createApp()`을 import해 request 단위로 테스트한다.

```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/api/health'), {} as any)
    expect(res.status).toBe(200)
  })
})
```

DB가 필요한 테스트는 local/dev DB와 test seed 전략을 먼저 정한다. production DB를 테스트 대상으로 사용하지 않는다.

---

## 4. Frontend Tests

우선 확인할 것:

- route rendering
- form validation
- loading/empty/error state
- permission-based UI
- mobile/desktop layout
- API error display

테스트 도구는 프로젝트 상황에 맞게 선택한다.

- unit/component: Vitest + Testing Library
- E2E: Playwright
- visual/manual check: 주요 화면 스크린샷 또는 브라우저 확인

UI 변경은 최소한 주요 사용자 흐름, 모바일/데스크톱 깨짐, 에러 상태를 확인한다.

---

## 5. DB / Migration Tests

DB 변경 시 확인:

```txt
Migration applies:
Migration rollback or forward fix:
Affected APIs still pass:
RLS policy works for allowed user:
RLS policy blocks forbidden user:
Backfill count before/after:
```

RLS, destructive migration, backfill은 테스트 또는 검증 SQL 없이 진행하지 않는다.

---

## 6. Test Data

- 테스트 데이터는 production 데이터와 분리한다.
- fixture는 작고 읽기 쉽게 유지한다.
- 개인정보/secret이 fixture에 들어가지 않게 한다.
- 시간 의존 테스트는 고정 날짜를 사용한다.

---

## 7. AI Agent Report

작업 완료 보고에는 검증 결과를 포함한다.

```txt
Checks run:
Passed:
Failed:
Skipped:
Reason for skipped checks:
Residual risk:
```

검증을 실행하지 않았으면 "검증하지 못함"이라고 명확히 적는다.
