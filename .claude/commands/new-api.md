---
description: 새 API 엔드포인트 구현 워크플로우
---

# /new-api

이 command는 shim이다. 실제 기준은 아래 문서를 따른다.

1. `AGENTS.md`의 `Task Routing` 중 `API/백엔드`
2. `.agents/code/API.md`
3. `.agents/code/ERROR_HANDLING.md`
4. `.agents/data/API_CONTRACT.md`
5. DB 변경이 있으면 `.agents/data/DB_SCHEMA.md`와 `.agents/data/MIGRATION.md`

기존 route/service/repository 패턴을 먼저 찾고, 새 구조를 임의로 만들지 않는다.
