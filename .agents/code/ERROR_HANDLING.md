# ERROR_HANDLING.md

이 문서는 Woomi 표준 에러 처리 기준을 정의한다.

기준 레퍼런스는 CTPA의 `AppError`, `ErrorCode`, `ERROR_STATUS_MAP`, Hono `onError`, response helper 패턴이다.

이 문서는 표준 제공 템플릿이다. 새 프로젝트 또는 기존 프로젝트에 적용할 때는 실제 error response shape, error code 체계, frontend error 처리 방식, logging/observability 도구를 확인하고 프로젝트에 맞게 수정한다. 템플릿의 error shape를 기존 API 계약 위에 무조건 덮어쓰지 않는다.

---

## 1. Goals

- 사용자에게 일관된 error response를 제공한다.
- 클라이언트가 `code`로 안정적으로 분기할 수 있게 한다.
- raw database/storage/provider error를 사용자에게 그대로 노출하지 않는다.
- 예상 가능한 도메인 오류와 예상하지 못한 시스템 오류를 분리한다.

---

## 2. Error Shape

표준 오류 응답:

```ts
type ErrorResponse = {
  message: string
  code: string
  detail?: unknown
}
```

권장 HTTP status:

| 상황 | status |
|---|---|
| validation error | 400 |
| missing/invalid auth | 401 |
| forbidden | 403 |
| not found | 404 |
| conflict | 409 |
| external dependency unavailable | 503 |
| unknown server error | 500 |

---

## 3. Backend Error Pattern

도메인 오류는 `AppError`로 던진다.

```ts
throw new AppError(ErrorCode.NotFound, 'Attendance not found')
```

전역 error middleware에서 `AppError`를 status + body로 변환한다.

```ts
app.onError(errorHandler)
```

규칙:

- route마다 try/catch를 반복하지 않는다.
- validation error는 route에서 즉시 표준 응답으로 반환한다.
- service/repository에서 raw provider error를 사용자 메시지로 그대로 반환하지 않는다.
- unknown error는 logging 후 generic message로 반환한다.

---

## 4. Error Code Rules

- error code는 enum 또는 const object로 중앙화한다.
- 새 error code를 추가하면 status map도 함께 갱신한다.
- 클라이언트 분기가 필요한 오류는 message가 아니라 code를 기준으로 한다.
- code는 대문자 snake case를 사용한다.

예:

```txt
BAD_REQUEST
VALIDATION_FAILED
AUTH_INVALID_TOKEN
FORBIDDEN
NOT_FOUND
CONFLICT
DATABASE_ERROR
STORAGE_ERROR
```

---

## 5. Validation Error

Zod validation 실패는 별도 error code를 사용한다.

```ts
return validationError(c, parsed.error.flatten())
```

프론트엔드는 field error와 form error를 분리해 표시한다.

---

## 6. Repository Error

repository는 provider error를 감싸서 던진다.

허용:

```ts
if (error) throw new Error(`Attendance lookup failed: ${error.message}`)
```

권장:

```ts
if (error) {
  throw new AppError(ErrorCode.DatabaseError, 'Attendance lookup failed', {
    cause: error.message,
  })
}
```

사용자에게 SQL, key, token, full provider payload를 노출하지 않는다.

---

## 7. Frontend Error Handling

- API client에서 표준 error를 파싱한다.
- 화면은 error code를 기준으로 사용자 문구를 결정한다.
- 인증 만료, 권한 없음, not found는 공통 처리한다.
- loading, empty, error 상태를 모두 표시한다.

금지:

- `error.message`를 그대로 alert로 표시
- 화면마다 HTTP status 해석을 중복 구현
- 실패한 mutation 후 optimistic state를 되돌리지 않음

---

## 8. Logging

로그에 남길 것:

- request id
- route/method
- error code
- safe detail
- dependency name

로그에 남기지 말 것:

- access token
- refresh token
- service role key
- password
- private file URL
- 주민번호/전화번호 등 민감정보 원문

---

## 9. Checklist

- error code가 중앙에 등록되었는가?
- status map이 갱신되었는가?
- 사용자 메시지가 안전한가?
- raw DB/storage/provider error가 노출되지 않는가?
- 프론트엔드가 code 기준으로 분기하는가?
- validation error가 field 단위로 전달되는가?
