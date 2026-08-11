-- ============================================================
-- Migration: 20260811000001_market_apps
-- 적용 대상: 오토콘(AutoCon) 전용 Supabase 프로젝트 (ref yzercziwazfrjsjnmbhr, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 반드시 이 프로젝트 전용 DB에만 적용.
-- 내용: 홈(런처)에 관리자가 직접 "게시"하는 외부 도구 카탈로그.
--   - market_apps          : 게시된 도구 1건 (카드 + 상세 페이지의 원천)
--   - market_app_versions  : 버전 이력 (상세 페이지 하단)
--   - market_app_likes     : 사용자별 좋아요 (like_count 는 여기서 동기화되는 캐시 컬럼)
--   - Storage 버킷 market-shots : 스크린샷 원본(비공개, 조회 시 signed URL)
-- 접근: service_role 만 (RLS). Worker 가 service key 로 접근.
-- ※ 기존 elev_projects / elev_revisions(단열재 나누기도)는 건드리지 않는다.
-- ============================================================

-- 1) 게시된 도구
create table if not exists public.market_apps (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  -- 카드와 상세 페이지에 공용으로 쓰는 한두 줄 설명
  description    text,
  -- "바로가기" 대상 (외부 사이트 주소) — 필수
  deploy_url     text not null,
  repo_url       text,
  platform_type  text not null default '웹앱',
  location       text not null default '본사',
  category       text not null default '웹앱',
  -- 현재 버전 표시값 (이력은 market_app_versions)
  version        text,
  team           text,
  -- 담당자 이름 목록 (여러 명)
  owners         text[] not null default '{}',
  tags           text[] not null default '{}',
  -- [{ bucket, path, name, size, mime }] — 첫 번째가 목록 썸네일
  screenshots    jsonb  not null default '[]'::jsonb,
  -- published | hidden (현재는 published 만 노출)
  status         text not null default 'published',
  view_count     int  not null default 0,
  like_count     int  not null default 0,
  author_id      text,
  author_name    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.market_apps is
  '오토콘 홈에 게시되는 외부 도구 카탈로그. 카드/상세 페이지의 단일 원천.';

create index if not exists idx_market_apps_status_created
  on public.market_apps (status, created_at desc);

-- 2) 버전 이력
create table if not exists public.market_app_versions (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.market_apps(id) on delete cascade,
  version         text not null,
  note            text,
  created_by      text,
  created_by_name text,
  created_at      timestamptz not null default now()
);

comment on table public.market_app_versions is
  '게시 도구의 버전 이력. 게시 시 최초 1건 자동 생성, 이후 관리자가 추가.';

create index if not exists idx_market_app_versions_app
  on public.market_app_versions (app_id, created_at desc);

-- 3) 좋아요 (사용자 1인 1건)
create table if not exists public.market_app_likes (
  app_id     uuid not null references public.market_apps(id) on delete cascade,
  user_id    text not null,
  created_at timestamptz not null default now(),
  primary key (app_id, user_id)
);

comment on table public.market_app_likes is
  '사용자별 좋아요. market_apps.like_count 는 이 테이블에서 동기화되는 캐시.';

-- 4) 카운터 함수 (동시 요청에서도 유실 없도록 원자적 갱신)
create or replace function public.market_app_bump_view(p_app_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.market_apps
     set view_count = view_count + 1
   where id = p_app_id;
$$;

comment on function public.market_app_bump_view(uuid) is
  '상세 페이지 진입 시 조회수 +1 (원자적).';

create or replace function public.market_app_sync_like_count(p_app_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update public.market_apps a
     set like_count = (select count(*) from public.market_app_likes l where l.app_id = a.id)
   where a.id = p_app_id
  returning a.like_count;
$$;

comment on function public.market_app_sync_like_count(uuid) is
  '좋아요 토글 후 like_count 를 likes 테이블 실제 건수로 재동기화하고 결과를 돌려준다.';

-- 5) 스크린샷 버킷 (비공개 — 조회는 Worker 가 signed URL 로 중계)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'market-shots',
  'market-shots',
  false,
  10485760, -- 10MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- 6) 권한 및 RLS (service_role 전용 — 워커가 service key로 접근)
grant all privileges on table public.market_apps         to service_role;
grant all privileges on table public.market_app_versions to service_role;
grant all privileges on table public.market_app_likes    to service_role;
grant execute on function public.market_app_bump_view(uuid)        to service_role;
grant execute on function public.market_app_sync_like_count(uuid)  to service_role;

alter table public.market_apps         enable row level security;
alter table public.market_app_versions enable row level security;
alter table public.market_app_likes    enable row level security;

drop policy if exists "service_role_all" on public.market_apps;
create policy "service_role_all" on public.market_apps
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.market_app_versions;
create policy "service_role_all" on public.market_app_versions
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.market_app_likes;
create policy "service_role_all" on public.market_app_likes
  for all to service_role using (true) with check (true);
