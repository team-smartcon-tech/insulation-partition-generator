# API_CONTRACT.md

이 문서는 프로젝트의 API 요청/응답 계약을 진행 중에 정리하는 문서다.

API가 실제로 생기기 전까지는 비워둘 수 있다. endpoint, request, response, error, permission이 바뀌면 같은 작업에서 갱신한다.

---

## 작성 시점

- 새 API endpoint가 추가될 때
- request/response 구조가 바뀔 때
- error code 또는 사용자 메시지가 바뀔 때
- 인증/권한 조건이 바뀔 때
- 프론트엔드 API client, TanStack Query hook, form schema에 영향이 있을 때

---

## 작성할 내용

```txt
Endpoint:
Method:
Purpose:
Auth required:
Allowed roles:
Request params:
Request body:
Response:
Error codes:
Related service:
Related repository:
Related DB tables/RPC:
Related frontend usage:
Notes:
```

---

## API Notes

### 스마트폼(/tools/forms) — 2026-09-29

구현: `apps/worker/src/forms.ts` (index.ts 에서 `app.route("/api/forms", formsRoutes)` 로 마운트).
테이블: `form_sites` · `form_documents` · `form_taxonomy(+history)` — `.agents/data/DB_SCHEMA.md` 5.1 참고.
인증: 모든 경로 로그인 필수(authMiddleware 뒤에 마운트). 로컬 개발에서 `COOKIE_SECURE=false` 면
미들웨어가 통과시키므로 `currentUser()` 가 자리 표시 사용자를 쓴다.

| Method | Path | 하는 일 | 권한 |
|---|---|---|---|
| GET | `/api/forms/sites` | 현장 목록 | 로그인 |
| POST | `/api/forms/sites` | 현장 추가(같은 이름이면 기존 것을 돌려줌) | 로그인 |
| GET | `/api/forms/taxonomy` | 분류 코드표 | 로그인 |
| PUT | `/api/forms/taxonomy` | 코드표 올리기(이전 판은 이력에 쌓음) | **본사 관리자** |
| GET | `/api/forms/docs?kind=&siteId=&review=1` | 서류 목록(꼬리표만) | 로그인 |
| GET | `/api/forms/docs/:id` | 한 건 전부(격자·적은 글자·결재) | 로그인 |
| POST | `/api/forms/docs` | 서류 1건 등록 + **올리기 주소** 발급 | 로그인 |
| POST | `/api/forms/docs/:id/uploaded` | 파일 다 올렸다고 알림(크기 기록) | 로그인 |
| PATCH | `/api/forms/docs/:id` | 적은 글자·결재·**본사 점검** 갱신 | 로그인 |
| PATCH | `/api/forms/sites/:id` | 현장 조직·기본 결재선·이름 | 로그인 |
| GET | `/api/forms/docs/:id/file` | 내려받기 주소(5분) | 로그인 |
| DELETE | `/api/forms/docs/:id` | 서류와 파일 삭제 | 올린 사람 또는 본사 관리자 |

주요 결정:

- **파일 바이트는 Worker 를 지나가지 않는다.** `POST /docs` 가 Supabase 의 짧은 유효시간 올리기
  주소(token)를 내어 주고, 브라우저가 거기로 직접 올린 뒤 `/uploaded` 로 알린다. Worker 요청 크기
  제한과 메모리를 피하고, 42MB 짜리 보고서도 그대로 올라간다.
- **Storage 경로에는 한글·공백·괄호를 쓸 수 없다**(`InvalidKey`). 자리는 `{kind}/{문서 id}/file{확장자}`
  로만 짓고, 사람이 볼 이름은 `file_name` 에 두었다가 내려받기 주소에 `?download=` 로 붙인다.
- **점검자·점검 시각은 서버가 적는다.** 화면이 보내는 값을 믿지 않는다.
- 목록은 무거운 칸(`sheets`·`cell_values`)을 빼고 꼬리표만 보낸다 — 한 현장에 145종이 붙는다.
