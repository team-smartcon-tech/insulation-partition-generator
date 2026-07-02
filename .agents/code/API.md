# API.md

이 문서는 backend route/service/repository와 frontend API client 작성 기준을 정의한다.

CTPA의 Hono route, service, repository, Zod schema, response helper 패턴을 기준으로 하되, 신규 프로젝트는 도메인 폴더 내부에 같은 책임을 배치한다.

이 문서는 표준 제공 템플릿이다. 새 프로젝트 또는 기존 프로젝트에 적용할 때는 실제 API 응답 형식, auth 방식, route 구조, error code, API client 구현을 먼저 확인하고 이 문서를 프로젝트에 맞게 수정한다. 템플릿 예시를 실제 코드보다 우선하지 않는다.

---

## 1. Backend API Flow

표준 흐름:

```txt
HTTP request
  -> middleware
  -> route
  -> schema validation
  -> service
  -> repository/RPC/storage
  -> response helper
```

route는 HTTP 입출력, service는 도메인 규칙, repository는 데이터 접근만 담당한다.

---

## 2. Route Rules

route에서 할 일:

- path/query/body 파싱
- auth context 읽기
- Zod validation
- service 호출
- 표준 response 반환

route에서 하지 않을 일:

- Supabase `.from()` 직접 호출
- storage 직접 접근
- 긴 권한/상태 전이 구현
- raw database error 반환

예:

```ts
attendance.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const parsed = createAttendanceSchema.safeParse(body)
  if (!parsed.success) return validationError(c, parsed.error.flatten())

  return ok(c, await AttendanceService.create(c.env, user.sub, parsed.data))
})
```

---

## 3. Service Rules

service에서 할 일:

- 도메인 규칙
- 권한 판단
- 상태 전이
- 여러 repository 조합
- AppError throw
- RPC/transaction 필요 여부 판단

service에서 하지 않을 일:

- `c.json()` 반환
- HTTP status 결정
- request body 재파싱
- UI용 문구 조립

---

## 4. Repository Rules

repository에서 할 일:

- Supabase query
- PostgreSQL RPC 호출
- R2/storage 접근
- DB row 변환

repository에서 하지 않을 일:

- route/service import
- HTTP response 생성
- 권한 정책 결정
- 사용자 메시지 결정

복잡한 join, upsert, 원자성이 필요한 작업은 PostgreSQL function/RPC를 검토한다.

---

## 5. Schema Rules

- request body, query, params는 Zod로 검증한다.
- `z.infer<typeof schema>`로 타입을 재사용한다.
- 프론트와 백엔드가 공유해도 안전한 schema는 `packages/shared`로 올린다.
- 서버 secret, Cloudflare Env, Supabase client가 들어간 schema는 shared로 올리지 않는다.

---

## 6. Response Contract

프로젝트는 성공/실패 응답 shape를 하나로 정한다.

기본 권장:

```txt
Success:
  response body 그대로 또는 { data }

Error:
  {
    message: string
    code: string
    detail?: unknown
  }
```

한 프로젝트 안에서 성공 응답 shape를 섞지 않는다. legacy 호환 때문에 body 그대로 반환하는 경우 문서에 명시한다.

---

## 7. Frontend API Client

프론트엔드는 공통 API client를 통해 통신한다.

공통 client 책임:

- base URL
- credentials/auth header
- JSON parsing
- 204/no-content 처리
- 표준 error 변환
- retry 여부

feature/entity API 함수는 공통 client만 호출한다.

금지:

- 컴포넌트 내부 raw `fetch` 반복
- 같은 API를 여러 방식으로 호출
- error shape를 화면마다 임의 파싱
- service role key 또는 server secret 사용

---

## 8. API Contract Update

아래 변경은 `.agents/data/API_CONTRACT.md`를 함께 갱신한다.

- endpoint 추가/삭제
- request/response 변경
- error code 변경
- auth/role 조건 변경
- DB/RPC 영향이 있는 API 변경
