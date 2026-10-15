-- 스마트폼: 장(시트)마다 마지막으로 글자를 고친 때(2026-10-15 사용자 승인).
-- 발송대장처럼 한 장에 줄을 쌓는 서식이 오래 기록되지 않으면 "N일째 기록 없음" 알림을 띄우는 데 쓴다.
-- { 시트 이름: 밀리초 } 를 통째로(jsonb) 담는다. 빈 칸으로 더하므로 기존 자료에는 영향이 없다.
-- 되돌리기: alter table public.form_documents drop column sheet_edited_at;
alter table public.form_documents
  add column if not exists sheet_edited_at jsonb not null default '{}'::jsonb;

comment on column public.form_documents.sheet_edited_at is
  '시트 이름 → 마지막으로 글자를 고친 때(ms). 작성 일정의 "N일째 기록 없음" 알림용';
