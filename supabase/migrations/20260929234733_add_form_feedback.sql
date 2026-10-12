-- ============================================================
-- Migration: 20260929234733_add_form_feedback
-- 적용 대상: 단열재 나누기도 생성기 전용 Supabase 프로젝트(IPG, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 이 프로젝트 전용 DB에만 적용.
-- 내용: 스마트폼 [오류·개선 의견] 게시판 표 하나
--   - form_feedback : 직원 누구나 올리는 오류 신고·개선 의견과 본사의 답
--
-- 정한 규칙(2026-09-30 사용자 결정):
--   탭 구성은 홈 / 배포 양식함 / 현장 서류함 / 본사 점검 / 오류·개선 의견.
--   배포 양식함·본사 점검은 본사 관리자만, 나머지는 **모든 직원**이 본다.
--   의견은 모두가 쓰고 모두가 본다 — 같은 불편을 두 사람이 따로 적지 않게.
--
-- 기존 데이터: 건드리지 않는다. 새 표 하나만 만든다. 지우는 명령 없음.
-- 되돌리기: drop table public.form_feedback;  (다른 표와 연결이 없어 그것으로 끝난다)
-- ============================================================

create table if not exists public.form_feedback (
  id            uuid primary key default gen_random_uuid(),

  -- 오류 신고인가 개선 의견인가. 화면에서 고른다.
  kind          text not null default 'bug' check (kind in ('bug', 'idea')),
  title         text not null,
  body          text not null default '',
  -- 어느 화면·서류에서 생긴 일인가(자유 입력). 본사가 재현해 볼 때 쓴다.
  where_at      text,

  -- 처리 상태. 본사만 바꾼다.
  status        text not null default 'open' check (status in ('open', 'doing', 'done', 'wont')),
  reply         text,
  replied_by    text,
  replied_at    timestamptz,

  -- 올린 사람. 로그인 정보를 Worker 가 적는다(화면이 보낸 값은 믿지 않는다).
  author_id     text,
  author_name   text,
  author_email  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.form_feedback is
  '스마트폼 오류 신고·개선 의견. 직원 누구나 올리고 모두가 본다. 상태와 답은 본사 관리자만 적는다.';
comment on column public.form_feedback.kind is 'bug=오류 신고, idea=개선 의견';
comment on column public.form_feedback.status is 'open=접수, doing=확인 중, done=처리 완료, wont=하지 않음';
comment on column public.form_feedback.where_at is '어느 화면·서류에서 생겼나(자유 입력)';

-- 목록은 늘 최신순으로 읽는다.
create index if not exists idx_form_feedback_created on public.form_feedback (created_at desc);
-- 본사가 "아직 안 본 것"만 추릴 때.
create index if not exists idx_form_feedback_status on public.form_feedback (status, created_at desc);

-- 권한 및 RLS — service_role 전용(Worker 가 service key 로 접근하고, 누가 무엇을 할 수 있나는 Worker 가 판단한다).
grant all privileges on table public.form_feedback to service_role;
revoke all privileges on table public.form_feedback from anon, authenticated;

alter table public.form_feedback enable row level security;

drop policy if exists "service_role_all" on public.form_feedback;
create policy "service_role_all" on public.form_feedback
  for all to service_role using (true) with check (true);
