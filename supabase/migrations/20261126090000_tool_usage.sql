-- ============================================================
-- Migration: 20261126090000_tool_usage
-- 적용 대상: 스마트 툴박스 전용 Supabase 프로젝트 (ref yzercziwazfrjsjnmbhr, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: 홈 카드 전체에 조회·좋아요 숫자를 보이고, 연말에 도구별 이용 빈도를 낼 수 있게 한다.
--   - tool_card_stats   : 내장 도구(코드에 박힌 TOOLS) 카드의 조회·좋아요 누적 수. 키는 "tool:{id}".
--                         게시 도구는 종전대로 market_apps.view_count / like_count 를 쓴다.
--   - tool_card_likes   : 내장 도구 좋아요 (사용자 1인 1건). like_count 는 여기서 동기화되는 캐시.
--   - tool_usage_events : 이용 기록 1건 = 1행. 카드 키("tool:{id}" / "market:{uuid}") + 종류 + 사용자 + 시각.
--                         open(내장 도구 진입) · view(게시 도구 상세 조회) · launch(게시 도구 바로가기) · download(설치파일 받기)
--   - tool_usage_summary(연도) : 도구·종류·월별 횟수와 이용자 수(중복 제거). 월 경계는 한국 시각.
-- 동시성: 조회수는 원자적 증감 SQL, 좋아요는 PK(1인 1건) + 실제 건수 재동기화 — 별도 잠금 없음.
-- 순서: 추가형 — 이 마이그레이션 먼저, 코드 배포 다음.
--   코드는 테이블이 없어도 홈·도구 진입이 깨지지 않게 짰다(숫자만 안 보이고 기록이 안 쌓인다).
-- 롤백: 코드 revert 후
--   drop function public.tool_usage_summary(int); drop function public.tool_card_sync_like_count(text);
--   drop function public.tool_card_bump_view(text);
--   drop table public.tool_usage_events; drop table public.tool_card_likes; drop table public.tool_card_stats;
-- ============================================================

-- 1) 내장 도구 카드 누적 수
create table if not exists public.tool_card_stats (
  card_key   text primary key,
  view_count int not null default 0,
  like_count int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.tool_card_stats is
  '내장 도구(tool:{id}) 홈 카드의 조회·좋아요 누적 수. 게시 도구는 market_apps 의 카운터를 쓴다.';

-- 2) 내장 도구 좋아요 (사용자 1인 1건)
create table if not exists public.tool_card_likes (
  card_key   text not null,
  user_id    text not null,
  created_at timestamptz not null default now(),
  primary key (card_key, user_id)
);

comment on table public.tool_card_likes is
  '내장 도구 좋아요. tool_card_stats.like_count 는 이 테이블에서 동기화되는 캐시.';

-- 3) 이용 기록
create table if not exists public.tool_usage_events (
  id         bigint generated always as identity primary key,
  card_key   text not null,
  event      text not null check (event in ('open', 'view', 'launch', 'download')),
  user_id    text,
  created_at timestamptz not null default now()
);

comment on table public.tool_usage_events is
  '도구 이용 기록(1건 1행). open=내장 도구 진입, view=게시 도구 상세 조회, launch=게시 도구 바로가기, download=설치파일 받기.';

create index if not exists idx_tool_usage_events_created
  on public.tool_usage_events (created_at);
create index if not exists idx_tool_usage_events_key_created
  on public.tool_usage_events (card_key, created_at);

-- 4) 카운터 함수 (동시 요청에서도 유실 없도록 원자적 갱신)
create or replace function public.tool_card_bump_view(p_card_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.tool_card_stats (card_key, view_count)
  values (p_card_key, 1)
  on conflict (card_key) do update
     set view_count = public.tool_card_stats.view_count + 1,
         updated_at = now();
$$;

comment on function public.tool_card_bump_view(text) is
  '내장 도구 진입 시 조회수 +1 (행이 없으면 만든다, 원자적).';

create or replace function public.tool_card_sync_like_count(p_card_key text)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.tool_card_stats (card_key, like_count)
  values (p_card_key, (select count(*) from public.tool_card_likes l where l.card_key = p_card_key))
  on conflict (card_key) do update
     set like_count = excluded.like_count,
         updated_at = now()
  returning like_count;
$$;

comment on function public.tool_card_sync_like_count(text) is
  '좋아요 토글 후 like_count 를 likes 테이블 실제 건수로 재동기화하고 결과를 돌려준다.';

-- 5) 연간 이용 집계 — 한 번에 세 묶음을 돌려준다.
--    (card_key, event, month) : 월별   /  (card_key, event, month=null) : 도구별 연간
--    (card_key=null, event=null, month=null) : 전체 (users = 그 해 한 번이라도 쓴 사람 수)
create or replace function public.tool_usage_summary(p_year int)
returns table (card_key text, event text, month int, cnt bigint, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.k, s.ev, s.m, count(*), count(distinct s.uid)
    from (
      select e.card_key as k,
             e.event    as ev,
             extract(month from e.created_at at time zone 'Asia/Seoul')::int as m,
             e.user_id  as uid
        from public.tool_usage_events e
       where e.created_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Asia/Seoul')
         and e.created_at <  make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Asia/Seoul')
    ) s
   group by grouping sets ((s.k, s.ev, s.m), (s.k, s.ev), ());
$$;

comment on function public.tool_usage_summary(int) is
  '연간 도구 이용 집계 — 도구·종류·월별 횟수와 이용자 수(중복 제거). 월 경계는 한국 시각.';

-- 6) 권한 및 RLS (service_role 전용 — 워커가 service key로 접근)
grant all privileges on table public.tool_card_stats   to service_role;
grant all privileges on table public.tool_card_likes   to service_role;
grant all privileges on table public.tool_usage_events to service_role;
-- security definer 함수는 기본으로 누구나 실행할 수 있다 — 집계·카운터가 anon 키로 불리지 않게 막는다.
revoke execute on function public.tool_card_bump_view(text)       from public, anon, authenticated;
revoke execute on function public.tool_card_sync_like_count(text) from public, anon, authenticated;
revoke execute on function public.tool_usage_summary(int)         from public, anon, authenticated;
grant execute on function public.tool_card_bump_view(text)       to service_role;
grant execute on function public.tool_card_sync_like_count(text) to service_role;
grant execute on function public.tool_usage_summary(int)         to service_role;

alter table public.tool_card_stats   enable row level security;
alter table public.tool_card_likes   enable row level security;
alter table public.tool_usage_events enable row level security;

drop policy if exists "service_role_all" on public.tool_card_stats;
create policy "service_role_all" on public.tool_card_stats
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.tool_card_likes;
create policy "service_role_all" on public.tool_card_likes
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.tool_usage_events;
create policy "service_role_all" on public.tool_usage_events
  for all to service_role using (true) with check (true);
