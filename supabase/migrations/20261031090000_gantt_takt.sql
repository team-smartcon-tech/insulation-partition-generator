-- 스마트 공정표 「택트 인원」 탭 — 현장별 마감 택트 입력 저장 (2026-10-31)
--
-- 현장은 공정표와 같은 스마트웍스(dcr) site id(text) — gantt_site_settings 와 같은 키. 현장마다 한 벌.
-- 공종 표(gantt_takt_trades)는 저장할 때 통째로 바꾼다(gantt_takt_save — 한 트랜잭션).
-- 기존 gantt_* 표와 같은 규칙: RLS 켜고 정책 없음 → service_role(Worker)만.
-- 계산은 packages/gantt-engine src/takt/crew.ts, 입력 검사도 Worker 가 같은 함수로 한다.

create table if not exists public.gantt_takt_sites (
  site_id          text primary key,                                     -- dcr site id
  units_per_floor  int  not null check (units_per_floor > 0),            -- 층당 세대수
  zone_floors      int  not null check (zone_floors > 0),                -- 구간 층수
  takt_days        numeric not null check (takt_days > 0),               -- 택트(구간당 작업일수)
  building_floors  int[] not null,                                       -- 동별 층수
  frame_zone_days  numeric check (frame_zone_days is null or frame_zone_days > 0), -- 골조 구간 층수 소요일 (경고용, 선택)
  updated_by       text,
  updated_at       timestamptz not null default now()
);

comment on table public.gantt_takt_sites is
  '스마트 공정표 택트 인원 탭 — 현장별 입력(층당 세대수·구간 층수·택트·동별 층수). 공종은 gantt_takt_trades.';

create table if not exists public.gantt_takt_trades (
  id             uuid primary key default gen_random_uuid(),
  site_id        text not null references public.gantt_takt_sites (site_id) on delete cascade,
  sort_order     int  not null,                                  -- 화면 순서
  stage          int  not null check (stage > 0),                -- 단계 (같은 번호 = 같은 구간 동시)
  name           text not null,
  unit           text not null default '',
  qty_per_unit   numeric not null check (qty_per_unit > 0),      -- 세대당 물량
  productivity   numeric not null check (productivity > 0),      -- 1인1일 생산성
  wait_days      numeric not null default 0 check (wait_days >= 0) -- 후속 대기일
);

comment on table public.gantt_takt_trades is
  '스마트 공정표 택트 인원 탭 공종 표. 값은 예시값에서 시작해 현장 실적 품셈으로 바꾼다.';

create index if not exists gantt_takt_trades_site_idx on public.gantt_takt_trades (site_id, sort_order);

alter table public.gantt_takt_sites  enable row level security;
alter table public.gantt_takt_trades enable row level security;
-- 정책 없음: service_role 만 (Worker 전용)

-- 현장 입력 + 공종 표 저장 (한 트랜잭션, 현장 줄은 upsert, 공종은 지우고 다시 넣는다)
-- p_site: {units_per_floor, zone_floors, takt_days, building_floors[], frame_zone_days}
-- p_trades: [{stage, name, unit, qty_per_unit, productivity, wait_days}] — 배열 순서가 sort_order
create or replace function public.gantt_takt_save(p_site_id text, p_site jsonb, p_trades jsonb, p_user text)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into gantt_takt_sites (site_id, units_per_floor, zone_floors, takt_days, building_floors, frame_zone_days, updated_by, updated_at)
  values (
    p_site_id,
    (p_site->>'units_per_floor')::int,
    (p_site->>'zone_floors')::int,
    (p_site->>'takt_days')::numeric,
    array(select jsonb_array_elements_text(p_site->'building_floors')::int),
    nullif(p_site->>'frame_zone_days', '')::numeric,
    p_user,
    now()
  )
  on conflict (site_id) do update set
    units_per_floor = excluded.units_per_floor,
    zone_floors     = excluded.zone_floors,
    takt_days       = excluded.takt_days,
    building_floors = excluded.building_floors,
    frame_zone_days = excluded.frame_zone_days,
    updated_by      = excluded.updated_by,
    updated_at      = excluded.updated_at;

  delete from gantt_takt_trades where site_id = p_site_id;

  insert into gantt_takt_trades (site_id, sort_order, stage, name, unit, qty_per_unit, productivity, wait_days)
  select p_site_id, t.ord - 1, (t.v->>'stage')::int, t.v->>'name', coalesce(t.v->>'unit', ''),
         (t.v->>'qty_per_unit')::numeric, (t.v->>'productivity')::numeric, coalesce((t.v->>'wait_days')::numeric, 0)
  from jsonb_array_elements(p_trades) with ordinality as t(v, ord);
end;
$$;

revoke all on function public.gantt_takt_save(text, jsonb, jsonb, text) from public, anon, authenticated;
