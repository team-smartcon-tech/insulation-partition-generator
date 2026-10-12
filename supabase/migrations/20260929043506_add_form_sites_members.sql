-- ============================================================
-- Migration: 20260929043506_add_form_sites_members
-- 적용 대상: IPG 전용 Supabase 프로젝트 (public 스키마)
--
-- 왜: 현장에는 **조직(결재선에서 고르는 사람 명단)** 과 **기본 결재선**이 딸려 있다
--     (apps/web/src/features/forms/sites.ts 의 FormSite.members / lineDefaults).
--     지금까지 브라우저에만 있어서, 다른 PC 에서 결재선을 지정하면 사람 명단이 비어 있었다.
--
-- 내용: form_sites 에 칸 두 개를 더한다(더하기만 — 기존 값은 건드리지 않는다).
--   - members       : [{ id, name, rank, ... }]  현장 조직
--   - line_defaults : { 칸이름: [사람...] }       그 현장의 기본 결재선
--   모양이 자주 바뀌고 DB 가 그 안을 검색할 일이 없어 jsonb 로 통째로 담는다.
--
-- 기존 데이터: form_sites 는 아직 비어 있다(시험용 한 줄을 넣었다가 지웠다). 잃을 것이 없다.
-- 되돌리기: alter table public.form_sites drop column members, drop column line_defaults;
-- ============================================================

alter table public.form_sites
  add column if not exists members       jsonb not null default '[]'::jsonb,
  add column if not exists line_defaults jsonb not null default '{}'::jsonb;

comment on column public.form_sites.members is
  '현장 조직 — 결재선에서 고르는 사람 명단. 화면이 통째로 읽고 통째로 쓴다.';
comment on column public.form_sites.line_defaults is
  '그 현장의 기본 결재선(칸 이름 → 사람들). 새 서류의 결재선을 미리 채우는 데 쓴다.';
