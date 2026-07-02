# CODE_STYLE.md

이 문서는 Woomi 표준 TypeScript 코드 작성 기준을 정의한다.

기준 레퍼런스는 CTPA의 Hono Worker, Supabase repository, response/error helper, React frontend 구성이다. 신규 프로젝트는 `.agents/ARCHITECTURE.md`의 2.0 구조를 우선한다.

이 문서는 표준 제공 템플릿이다. 프로젝트에 이미 확정된 formatter, lint rule, import style, component library, backend framework 규칙이 있으면 먼저 확인하고 이 문서를 프로젝트 기준에 맞게 수정한다. 단, 보안, secret, 데이터 손실 방지 규칙은 완화하지 않는다.

---

## 1. Common Style

- TypeScript를 기본으로 사용한다.
- `strict` mode를 기준으로 한다.
- 2-space indent를 사용한다.
- semicolon은 프로젝트 포맷터 기준을 따른다. 신규 표준은 no semicolon을 권장한다.
- 문자열 quote는 프로젝트 Prettier 설정을 따른다.
- 타입 전용 import는 `import type`을 사용한다.
- 사용하지 않는 import, 변수, dead code를 남기지 않는다.
- 의미 있는 숫자와 문자열은 상수로 분리한다.
- 복잡한 조건식에는 이름을 붙인다.
- 중첩 삼항은 피하고 `if` 또는 작은 함수로 푼다.

---

## 2. TypeScript Rules

- 외부 입력은 TypeScript 타입만 믿지 않고 Zod 등 런타임 검증을 사용한다.
- API request/response, DB row, Env binding, 권한 role은 명시 타입을 둔다.
- 단순 내부 구현은 타입 추론을 활용한다.
- `any`는 금지에 가깝게 다룬다. 필요한 경우 이유를 주석 또는 PR에 남긴다.
- `unknown`을 받은 뒤 좁히는 방식을 우선한다.
- type assertion은 경계부에서만 사용하고, 도메인 내부로 퍼뜨리지 않는다.

---

## 3. Backend Style

### 3.1 Hono Entry

`index.ts`는 Worker fetch entry만 담당한다.

```ts
import { createApp } from './app'
import type { EnvBindings } from './platform/env'

const app = createApp()

export default {
  fetch(request: Request, env: EnvBindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx)
  },
}
```

`app.ts`는 Hono app, global middleware, domain route mount만 담당한다.

```ts
import { Hono } from 'hono'
import { errorHandler, notFoundHandler } from './platform/errors'
import { createRoutes } from './routes'
import type { HonoEnv } from './platform/env'

export function createApp() {
  const app = new Hono<HonoEnv>()

  app.route('/api', createRoutes())
  app.notFound(notFoundHandler)
  app.onError(errorHandler)

  return app
}
```

### 3.2 Route

route는 HTTP 입출력만 담당한다.

- request param/query/body 파싱
- auth context 확인
- Zod 검증
- service 호출
- response helper 반환

금지:

- route에서 Supabase 직접 접근
- route에 긴 비즈니스 규칙 작성
- route마다 `c.json()` shape를 제각각 작성

### 3.3 Service

service는 비즈니스 규칙을 담당한다.

- 권한 판단
- 상태 전이
- 여러 repository 조합
- 트랜잭션/RPC 필요 여부 판단
- 도메인 error throw

service는 HTTP response 객체를 만들지 않는다.

### 3.4 Repository

repository는 데이터 접근만 담당한다.

- Supabase query
- RPC 호출
- R2/storage 접근
- DB row와 도메인 모델 변환

repository는 route/service를 import하지 않는다.

### 3.5 Supabase

- Supabase client 생성은 `platform/db`에서만 한다.
- 테이블명/RPC명은 중앙 상수로 관리한다.
- service role key는 Worker/server runtime에서만 사용한다.
- 프론트엔드에 service role key를 노출하지 않는다.
- 원자성이 필요한 작업은 PostgreSQL function/RPC 또는 명시적 보상 트랜잭션을 검토한다.

---

## 4. Frontend Style

### 4.1 React Component

- 컴포넌트는 함수형으로 작성한다.
- route 파일은 조립과 라우팅 책임에 집중한다.
- 재사용 UI는 `shared/ui`, 도메인 표시 UI는 `entities/*/ui`, 사용자 행동 UI는 `features/*/ui`에 둔다.
- 큰 컴포넌트는 읽기 어려워지기 전에 하위 컴포넌트로 분리한다.
- `useEffect`는 외부 시스템 동기화에만 사용한다.

### 4.2 State

- local state를 먼저 사용한다.
- URL로 표현 가능한 상태는 search params에 둔다.
- 서버 데이터는 TanStack Query 또는 loader/action 경계로 관리한다.
- 전역 UI 상태만 Zustand에 둔다.
- 서버 데이터를 Zustand에 장기 저장하지 않는다.

### 4.3 Form

- 복잡한 폼은 React Hook Form + Zod를 사용한다.
- 필드 간 의존성이 강하면 form-level schema로 검증한다.
- 단순 독립 필드는 field-level helper로 분리할 수 있다.
- validation error는 사용자 문구로 변환한다.

### 4.4 API Client

- 컴포넌트에서 raw `fetch`를 반복 작성하지 않는다.
- 공통 API client에서 base URL, auth, JSON parsing, error mapping을 처리한다.
- 도메인별 API 함수와 query/mutation hook을 분리한다.
- request/response schema가 있으면 `packages/shared` 또는 feature schema에서 재사용한다.

---

## 5. Readability Rules

- 동시에 실행되지 않는 시나리오는 분리한다.
- 구현 상세를 이름 있는 함수/컴포넌트로 감춘다.
- 단순한 로직까지 과하게 추상화하지 않는다.
- 숨은 부작용을 만들지 않는다.
- 이름이 같으면 동작도 같아야 한다.
- 공통화보다 변경 영향 범위를 먼저 본다.

---

## 6. Comments

주석은 코드가 말하지 못하는 이유를 설명할 때만 쓴다.

좋은 주석:

- 인증 제외 이유
- 트랜잭션/RPC를 선택한 이유
- Cloudflare/Supabase 제약
- 임시 호환 코드 제거 조건

나쁜 주석:

- 코드 그대로 반복 설명
- 오래된 TODO
- 책임을 문서 대신 주석으로만 남김

TODO는 목적 태그를 붙인다.

```txt
TODO[migration]:
TODO[security]:
TODO[cleanup]:
TODO[compat]:
```

---

## 7. Checklist

변경 후 확인:

- 기존 구조와 같은 위치에 파일을 두었는가?
- route/service/repository 책임이 섞이지 않았는가?
- 외부 입력을 런타임 검증했는가?
- 에러 shape가 표준을 따르는가?
- secret이 프론트엔드나 git에 노출되지 않았는가?
- 불필요한 추상화나 공통화를 만들지 않았는가?
- 검증 명령을 실행했거나 실행하지 못한 이유를 기록했는가?
