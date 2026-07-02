# supabase/migrations

이 폴더에는 **새 Supabase 프로젝트**용 마이그레이션(SQL)이 들어갑니다.

- 현재 비어 있습니다. **DB 변경은 아직 하지 않았습니다.**
- 다음 단계에서 원본 SSX의 `ssx_elev_projects` / `ssx_elev_revisions` 테이블을
  이 프로젝트용으로(예: 접두사 없이) 재구성한 마이그레이션을 추가하고,
  **새 Supabase(개발) 프로젝트에만** 적용합니다.
- 저장소(Storage) 버킷도 이 단계에서 정합니다.
  (원본은 공용 `schedule-private` 버킷의 `elevation/{projectId}/{revId}.dxf` 경로를 사용)
- 운영 DB 변경, 데이터 삭제성 마이그레이션은 사용자 승인 없이 실행하지 않습니다.
