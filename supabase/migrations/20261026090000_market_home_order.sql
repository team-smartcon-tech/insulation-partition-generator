-- ============================================================
-- Migration: 20261026090000_market_home_order
-- 적용 대상: 스마트 툴박스 전용 Supabase 프로젝트 (ref yzercziwazfrjsjnmbhr, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: 홈 카드 표시 순서 — 관리자가 정한 순서를 모든 사용자에게 같게 보여준다.
--   card_keys: 카드 키 배열 ("tool:{내장 도구 id}" / "market:{market_apps.id}").
--   배열에 없는 카드(새로 게시된 도구 등)는 화면에서 기본 순서로 뒤에 붙는다.
--   한 행(id='home')만 두고 배열 통째로 교체한다 — 관리자 1인 편집이라 마지막 저장 우선.
-- 순서: 추가형 — 이 마이그레이션 먼저, 코드 배포 다음.
--   코드는 테이블이 없으면 빈 순서(기본 정렬)로 동작한다.
-- 롤백: 코드 revert 후 drop table public.market_home_order;
-- ============================================================

create table if not exists public.market_home_order (
  id          text primary key default 'home' check (id = 'home'),
  card_keys   text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  text
);

comment on table public.market_home_order is
  '홈(런처) 카드 표시 순서. 단일 행(id=home), card_keys 배열 순서대로 섹션 안에서 정렬.';

grant all privileges on table public.market_home_order to service_role;

alter table public.market_home_order enable row level security;

drop policy if exists "service_role_all" on public.market_home_order;
create policy "service_role_all" on public.market_home_order
  for all to service_role using (true) with check (true);
