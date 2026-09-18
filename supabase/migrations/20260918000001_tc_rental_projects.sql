-- ============================================================
-- Migration: 20260918000001_tc_rental_projects
-- 적용 대상: 스마트덱 전용 Supabase (ref yzercziwazfrjsjnmbhr)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: TC 임대계획 도구의 저장 계층 (현장 → 세부 프로젝트 → REV)
--   - tc_rental_projects  : 논리 프로젝트 단위 (현장 안의 세부 프로젝트)
--   - tc_rental_revisions : append-only 스냅샷(REV). 계획 문서 전체를 plan jsonb 로 보관
--
-- 현장은 새로 만들지 않고 **elev_sites 를 공유**한다.
--   "세종2차 임대", "부산장안" 같은 현장은 도구에 속한 것이 아니라 회사에 속한 것이라,
--   도구마다 현장 목록을 따로 두면 같은 현장을 두 번 등록하게 된다.
--   테이블 이름의 `elev_` 접두사는 단열 Layout 이 먼저 만든 흔적일 뿐 소유권이 아니다.
--   (이름을 바꾸려면 두 도구의 코드를 함께 고쳐야 하므로 지금은 그대로 둔다.)
--
-- 배포 순서: 이 마이그레이션을 **먼저** 적용하고 코드를 배포한다.
--   코드가 먼저 나가면 PostgREST 가 42703(undefined_column)을 내어 저장 경로가 죽는다.
-- 롤백: 역순 — 코드를 먼저 되돌리고 테이블을 지운다.
--   drop table if exists public.tc_rental_revisions;
--   drop table if exists public.tc_rental_projects;
--   (elev_sites 는 단열 Layout 이 쓰므로 절대 지우지 않는다)
-- ============================================================

-- 1) 세부 프로젝트
create table if not exists public.tc_rental_projects (
  id            uuid primary key default gen_random_uuid(),
  -- 소속 현장. NULL = 미분류 (현장이 지워져도 프로젝트는 남는다)
  site_id       uuid references public.elev_sites(id) on delete set null,
  name          text not null,
  description   text,
  latest_rev_no int  not null default 0,
  latest_rev_id uuid,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tc_rental_projects is
  'TC 임대계획 세부 프로젝트. 현장은 elev_sites 공유, 리비전은 tc_rental_revisions.';

create index if not exists idx_tc_rental_projects_site
  on public.tc_rental_projects (site_id, updated_at desc);

-- 2) 리비전 (append-only 스냅샷)
create table if not exists public.tc_rental_revisions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.tc_rental_projects(id) on delete cascade,
  rev_no      int  not null,
  memo        text,
  -- 복원용 계획 문서 전체 (buildings/units/assignments/params). 화면이 그대로 이 값을 읽는다.
  plan        jsonb not null,
  -- 목록에서 빠르게 보여줄 요약 (동 수, 장비 수, 총 임대개월 등). plan 을 열지 않고 카드에 쓴다.
  summary     jsonb,
  schema_ver  int  not null default 1,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (project_id, rev_no)
);

comment on table public.tc_rental_revisions is
  'TC 임대계획 리비전(append-only). plan=복원용 계획 문서, summary=목록 표시용 요약.';

create index if not exists idx_tc_rental_rev_project
  on public.tc_rental_revisions (project_id, rev_no desc);

-- 3) 권한 및 RLS (service_role 전용 — Worker 가 service key 로 접근)
grant all privileges on table public.tc_rental_projects  to service_role;
grant all privileges on table public.tc_rental_revisions to service_role;

alter table public.tc_rental_projects  enable row level security;
alter table public.tc_rental_revisions enable row level security;

drop policy if exists "service_role_all" on public.tc_rental_projects;
create policy "service_role_all" on public.tc_rental_projects
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.tc_rental_revisions;
create policy "service_role_all" on public.tc_rental_revisions
  for all to service_role using (true) with check (true);
