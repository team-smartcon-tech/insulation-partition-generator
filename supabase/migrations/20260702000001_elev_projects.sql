-- ============================================================
-- Migration: 20260702000001_elev_projects
-- 적용 대상: 단열재 나누기도 생성기 전용 신규 Supabase 프로젝트 (public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 반드시 이 프로젝트 전용 DB에만 적용.
-- 내용: 프로젝트 + 리비전(REV) 저장 (원본 SSX 20260629000001_ssx_elev_projects 이식,
--       ssx_ 접두사 제거)
--   - elev_projects   : 논리 프로젝트 단위
--   - elev_revisions  : append-only 스냅샷(REV). DXF 원본은 Storage(elev-dxf 버킷)
-- 접근: service_role 만 (RLS). Worker 가 service key 로 접근.
-- ============================================================

-- 1) 프로젝트 (논리 단위)
create table if not exists public.elev_projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  latest_rev_no int  not null default 0,
  latest_rev_id uuid,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.elev_projects is
  '단열재 나누기도 프로젝트(논리 단위). 리비전은 elev_revisions.';

-- 2) 리비전 (append-only 스냅샷)
create table if not exists public.elev_revisions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.elev_projects(id) on delete cascade,
  rev_no      int  not null,
  memo        text,
  -- 완전 복원용 앱 상태(walls/openings/board specs/policy/buildings 등) JSON
  state       jsonb not null,
  -- DXF 원본 (elev-dxf 버킷): elevation/{project_id}/{rev_id}.dxf
  dxf_bucket  text,
  dxf_path    text,
  dxf_name    text,
  dxf_size    bigint,
  -- 표시용 요약(목록/트리 빠른 렌더)
  summary     jsonb,
  schema_ver  int  not null default 1,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (project_id, rev_no)
);

comment on table public.elev_revisions is
  '단열재 나누기도 리비전(append-only). state=복원용 앱상태, DXF 원본은 Storage 경로(dxf_path).';

create index if not exists idx_elev_rev_project
  on public.elev_revisions (project_id, rev_no desc);

-- 3) 권한 및 RLS (service_role 전용 — 워커가 service key로 접근)
grant all privileges on table public.elev_projects  to service_role;
grant all privileges on table public.elev_revisions to service_role;

alter table public.elev_projects  enable row level security;
alter table public.elev_revisions enable row level security;

drop policy if exists "service_role_all" on public.elev_projects;
create policy "service_role_all" on public.elev_projects
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.elev_revisions;
create policy "service_role_all" on public.elev_revisions
  for all to service_role using (true) with check (true);
