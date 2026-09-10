-- ============================================================
-- Migration: 20260910000001_elev_sites
-- 적용 대상: 단열재 나누기도 생성기 전용 Supabase (ref yzercziwazfrjsjnmbhr)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: 프로젝트 관리 계층을 2단(현장 → 세부 프로젝트)으로 확장
--   - elev_sites            : 현장(카드 단위). 썸네일은 Storage 경로만 보관
--   - elev_projects.site_id : 소속 현장 (NULL = 미분류)
--   - 백필: 기존 프로젝트 이름을 현장명으로 승격. 동명 프로젝트는 한 현장으로 묶인다
--           (예: "부산장안" 2개 → 현장 1개 + 세부 프로젝트 2개)
-- 되돌리기: site_id 는 nullable 이라 컬럼만 무시하면 기존 화면/API 그대로 동작한다.
-- ============================================================

-- 1) 현장 (카드 단위)
create table if not exists public.elev_sites (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  -- 카드 썸네일(조감도 등). 비공개 버킷이라 조회는 signed URL 로만.
  thumb_bucket text,
  thumb_path   text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.elev_sites is
  '단열재 나누기도 현장(프로젝트 카드 단위). 세부 프로젝트는 elev_projects.site_id 로 연결.';

-- 2) 프로젝트 → 현장 연결 (NULL = 미분류)
alter table public.elev_projects
  add column if not exists site_id uuid references public.elev_sites(id) on delete set null;

comment on column public.elev_projects.site_id is
  '소속 현장. NULL 이면 화면에서 "미분류" 그룹으로 묶여 표시된다.';

create index if not exists idx_elev_projects_site
  on public.elev_projects (site_id, updated_at desc);

-- 3) 권한 및 RLS (service_role 전용 — Worker 가 service key 로 접근)
grant all privileges on table public.elev_sites to service_role;

alter table public.elev_sites enable row level security;

drop policy if exists "service_role_all" on public.elev_sites;
create policy "service_role_all" on public.elev_sites
  for all to service_role using (true) with check (true);

-- 4) 백필 — 기존 프로젝트 이름을 현장으로 승격 (재실행해도 중복 생성 안 됨)
insert into public.elev_sites (name, created_by, created_at, updated_at)
select p.name, min(p.created_by), min(p.created_at), max(p.updated_at)
  from public.elev_projects p
 where p.site_id is null
   and not exists (select 1 from public.elev_sites s where s.name = p.name)
 group by p.name;

update public.elev_projects p
   set site_id = s.id
  from public.elev_sites s
 where p.site_id is null
   and s.name = p.name;
