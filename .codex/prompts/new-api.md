---
description: 새 API 엔드포인트 구현 워크플로우
---

# /new-api

이 prompt는 shim이다. 실제 기준은 아래 문서를 따른다.

1. `AGENTS.md`의 `Task Routing` 중 `API/백엔드`
2. `.agents/code/API.md`
3. `.agents/code/ERROR_HANDLING.md`
4. `.agents/data/API_CONTRACT.md`
5. DB 변경이 있으면 `.agents/data/DB_SCHEMA.md`와 `.agents/data/MIGRATION.md`

`wiki/`가 있으면 구현 전에 `wiki/index.md`와 이 API·도메인에 직접 관련된 `wiki/rules/`·`wiki/systems/`·`wiki/patterns/` 페이지만 확인한다. 위키와 실제 코드·설정 또는 `.agents/*` 원본이 다르면 원본을 따른 뒤 위키 드리프트를 기록한다.

기존 route/service/repository 패턴을 먼저 찾고, 새 구조를 임의로 만들지 않는다.

완료 보고에 `Wiki: checked`, `updated`, 또는 `not needed`와 짧은 근거를 남긴다. API 계약·도메인 결정처럼 재사용 가능한 지식이 생겼을 때만 `/wiki-log-today` 기록을 제안한다.
