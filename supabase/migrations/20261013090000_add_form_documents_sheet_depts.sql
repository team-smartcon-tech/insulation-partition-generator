-- 스마트폼: 품질관리계획서 서식(시트)마다 작성 부서를 남긴다.
--
-- 왜: 품질관리계획서 서류 현황에서 [작성하기]를 누를 때 품질·공무·공사 중 누가 쓰는지 정한다
--     (2026-10-13 사용자 결정). 엑셀 한 권에 서식이 여러 장이라 시트 이름 → 부서로 담는다.
--     예: {"QA-4.3-2": "공사", "QA-4.3-3": "품질"}
-- 영향: 칸 하나 더하기뿐 — 기존 서류는 빈 값('{}')이 된다. Worker 는 이 칸이 없어도 다른 저장을
--       막지 않도록 만들어 두었다(forms.ts PATCH /docs/:id).
-- 되돌리기: `alter table public.form_documents drop column if exists sheet_depts;`

alter table public.form_documents
  add column if not exists sheet_depts jsonb not null default '{}'::jsonb;

comment on column public.form_documents.sheet_depts is
  '시트 이름 → 그 장을 쓰는 부서(품질·공무·공사). 품질관리계획서 서류 현황용.';
