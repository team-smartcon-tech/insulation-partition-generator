---
description: DB 스키마 변경 워크플로우
applyTo: "**/migrations/**,**/.agents/data/**"
---

# DB Migration Instructions

이 instruction은 shim이다. 실제 기준은 아래 문서를 따른다.

1. `.agents/data/MIGRATION.md`
2. `.agents/data/DB_SCHEMA.md`
3. `.agents/data/API_CONTRACT.md`
4. 관련 repository/service/API 구현

핵심 금지:

- 문서 없이 schema/RLS/index 변경 금지
- Supabase migration 파일명 임의 생성 금지
- 사용자 승인 없는 production DB 변경 금지
- 근거 없는 index 자동 생성 금지

작업 후 migration, DB schema, API 계약 갱신 여부를 보고한다.
