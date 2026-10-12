-- ============================================================
-- Migration: 20260911000001_form_taxonomy
-- 적용 대상: 단열재 나누기도 생성기 전용 Supabase 프로젝트 (public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 반드시 이 프로젝트 전용 DB에만 적용.
-- 내용: 우미 양식 모음집 — 회사 공용 서류 분류 코드표와 본사 관리자 명단
--   - form_taxonomy         : 코드표. 1차 분류(공무관련·품질관련 …)마다 한 벌씩
--   - form_taxonomy_history : 코드표를 바꿀 때마다 이전 것을 남긴다(잘못 올렸을 때 되돌리기)
--   - form_admins           : 코드표를 바꿀 수 있는 본사 관리자 명단
-- 접근: service_role 만 (RLS). Worker 가 service key 로 접근하고,
--       "누가 바꿀 수 있나" 판단도 Worker 가 한다.
--
-- 정한 규칙(2026-09-11 사용자 결정):
--   코드표는 회사 공용. 본사 관리자만 바꾸고, 나머지는 보기만 한다.
--   본사 관리자 = 로그인 등급 super_admin/system_admin  또는  form_admins 명단에 있는 사람.
--   1차 분류(공무관련·품질관련)마다 코드표가 따로 있고, 코드 번호는 서로 겹칠 수 있다.
--
-- 기존 데이터: 없음. 새 표만 만들고 기존 것은 건드리지 않는다. 지우는 명령 없음.
-- ============================================================

-- 1) 코드표 — 1차 분류마다 한 벌
create table if not exists public.form_taxonomy (
  -- 서류가 "어느 코드표 소속인지"를 이 id 로 기억한다. 1차 분류 이름을 바꿔도 서류가
  -- 떨어져 나가지 않도록 이름이 아니라 id 로 묶는다.
  id           text primary key,
  -- 지금은 회사 전체 공용이라 'company'. 나중에 현장별 코드표가 필요해지면 이 값을 늘린다.
  scope        text not null default 'company',
  -- 1차 분류 이름(예: '공무관련'). 코드표 엑셀의 시트 이름에서 온다.
  division     text not null default '',
  -- 트리에 보이는 순서
  sort_order   int  not null default 0,
  file_name    text not null,
  -- [{ code, name, items: [{ code, name, groupCode }] }]
  groups       jsonb not null,
  -- 같은 코드에 다른 이름이 붙은 코드 목록(화면 경고용)
  conflicts    jsonb not null default '[]'::jsonb,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

comment on table public.form_taxonomy is
  '우미 양식 모음집 서류 분류 코드표. 1차 분류마다 한 벌. 전 직원이 보고 본사 관리자만 바꾼다.';

-- 같은 범위 안에서 1차 분류 이름은 하나만(이름 없는 코드표는 제외)
create unique index if not exists uq_form_taxonomy_division
  on public.form_taxonomy (scope, division)
  where division <> '';

-- 2) 코드표 이력 — 바꿀 때마다 이전 것을 쌓는다(추가만 하고 고치지 않는다)
create table if not exists public.form_taxonomy_history (
  id            uuid primary key default gen_random_uuid(),
  taxonomy_id   text not null,
  division      text not null default '',
  file_name     text not null,
  groups        jsonb not null,
  conflicts     jsonb not null default '[]'::jsonb,
  -- 이 이력을 남긴 사람(= 새 코드표로 바꾼 사람)
  replaced_by   text,
  replaced_at   timestamptz not null default now()
);

comment on table public.form_taxonomy_history is
  '코드표를 바꾸기 직전의 내용. 잘못된 파일을 올렸을 때 되돌리는 용도. 추가만 한다.';

create index if not exists idx_form_taxonomy_history_taxonomy
  on public.form_taxonomy_history (taxonomy_id, replaced_at desc);

-- 3) 본사 관리자 명단
create table if not exists public.form_admins (
  -- 로그인 이메일로 판단한다. 대소문자 차이로 빠지지 않게 소문자로 넣는다(Worker 가 맞춘다).
  email        text primary key,
  name         text,
  added_by     text,
  added_at     timestamptz not null default now()
);

comment on table public.form_admins is
  '코드표를 바꿀 수 있는 본사 관리자. super_admin/system_admin 등급은 여기 없어도 바꿀 수 있다.';

-- 4) 권한 및 RLS (service_role 전용 — 워커가 service key로 접근)
grant all privileges on table public.form_taxonomy         to service_role;
grant all privileges on table public.form_taxonomy_history to service_role;
grant all privileges on table public.form_admins           to service_role;

alter table public.form_taxonomy         enable row level security;
alter table public.form_taxonomy_history enable row level security;
alter table public.form_admins           enable row level security;

drop policy if exists "service_role_all" on public.form_taxonomy;
create policy "service_role_all" on public.form_taxonomy
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_taxonomy_history;
create policy "service_role_all" on public.form_taxonomy_history
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_admins;
create policy "service_role_all" on public.form_admins
  for all to service_role using (true) with check (true);
