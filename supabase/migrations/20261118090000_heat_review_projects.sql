-- ============================================================
-- Migration: 20261118090000_heat_review_projects
-- 적용 대상: 스마트덱 전용 Supabase (ref yzercziwazfrjsjnmbhr)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: 동절기 열원검토 도구의 저장 계층 (현장 → 세부 프로젝트 → REV)
--   - heat_review_projects  : 현장 안의 세부 프로젝트(검토서)
--   - heat_review_revisions : append-only 스냅샷(REV). 검토서 전체를 plan jsonb 로 보관
--
-- 현장은 새로 만들지 않고 elev_sites 를 공유한다(단열 MAKER · TC 임대계획과 같은 현장 목록).
-- 구조는 20260918000001_tc_rental_projects 와 같다.
--
-- 도면(DXF)은 담지 않는다 — 수십~백 MB 라 브라우저에만 둔다. 구역 좌표는 plan 에 들어 있다.
--
-- 배포 순서: 이 마이그레이션을 **먼저** 적용하고 코드를 배포한다.
-- 롤백: 역순 — 코드를 먼저 되돌리고 테이블을 지운다.
--   drop table if exists public.heat_review_revisions;
--   drop table if exists public.heat_review_projects;
--   (elev_sites 는 다른 도구가 쓰므로 절대 지우지 않는다)
-- ============================================================

-- 1) 세부 프로젝트
create table if not exists public.heat_review_projects (
  id            uuid primary key default gen_random_uuid(),
  -- 소속 현장. NULL = 미분류 (현장이 지워져도 검토서는 남는다)
  site_id       uuid references public.elev_sites(id) on delete set null,
  name          text not null,
  description   text,
  latest_rev_no int  not null default 0,
  latest_rev_id uuid,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.heat_review_projects is
  '동절기 열원검토 세부 프로젝트. 현장은 elev_sites 공유, 리비전은 heat_review_revisions.';

create index if not exists idx_heat_review_projects_site
  on public.heat_review_projects (site_id, updated_at desc);

-- 2) 리비전 (append-only 스냅샷)
create table if not exists public.heat_review_revisions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.heat_review_projects(id) on delete cascade,
  rev_no      int  not null,
  memo        text,
  -- 복원용 검토서 전체 (zones/conditions/heaters/cost/appliedHeaters/drawings 메타). 화면이 그대로 읽는다.
  plan        jsonb not null,
  -- 목록에서 빠르게 보여줄 요약 (구역 수, 열원 대수, 동절기 금액). plan 을 열지 않고 카드에 쓴다.
  summary     jsonb,
  schema_ver  int  not null default 1,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (project_id, rev_no)
);

comment on table public.heat_review_revisions is
  '동절기 열원검토 리비전(append-only). plan=복원용 검토서, summary=목록 표시용 요약.';

create index if not exists idx_heat_review_rev_project
  on public.heat_review_revisions (project_id, rev_no desc);

-- 3) 권한 및 RLS (service_role 전용 — Worker 가 service key 로 접근)
grant all privileges on table public.heat_review_projects  to service_role;
grant all privileges on table public.heat_review_revisions to service_role;

alter table public.heat_review_projects  enable row level security;
alter table public.heat_review_revisions enable row level security;

drop policy if exists "service_role_all" on public.heat_review_projects;
create policy "service_role_all" on public.heat_review_projects
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.heat_review_revisions;
create policy "service_role_all" on public.heat_review_revisions
  for all to service_role using (true) with check (true);
