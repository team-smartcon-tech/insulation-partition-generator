-- 택트 인원 탭 — 고정 일수 공종 (2026-10-31, 사용자: 방바닥통미장처럼 인당 생산성이 중요하지 않은 공종)
-- mode: 'rate' = 물량 ÷ 생산성으로 인원 산정(기존), 'fixed' = 구간당 일수(fixed_days)·팀 인원(crew)을 직접.
-- 고정 일수 공종은 물량·생산성을 쓰지 않으므로 비워도 되게 not null 을 푼다(값이 있으면 여전히 > 0).
-- 20261031100000_gantt_takt_crew.sql(crew 칸) 다음에 적용한다.

alter table public.gantt_takt_trades
  add column if not exists mode text not null default 'rate' check (mode in ('rate', 'fixed')),
  add column if not exists fixed_days numeric check (fixed_days is null or fixed_days > 0);

alter table public.gantt_takt_trades alter column qty_per_unit drop not null;
alter table public.gantt_takt_trades alter column productivity drop not null;
-- 기존 check(> 0)는 null 이면 통과하므로 그대로 둔다

comment on column public.gantt_takt_trades.mode is '산정 방식: rate = 물량÷생산성 인원 산정, fixed = 구간당 일수·팀 인원 직접';
comment on column public.gantt_takt_trades.fixed_days is '고정 일수 공종의 구간당 작업일 (mode = fixed)';

-- 저장 함수에 mode·fixed_days 를 더하고 물량·생산성 빈 값을 null 로 (인자·나머지 동작은 같다)
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

  insert into gantt_takt_trades (site_id, sort_order, stage, name, unit, qty_per_unit, productivity, wait_days, crew, mode, fixed_days)
  select p_site_id, t.ord - 1, (t.v->>'stage')::int, t.v->>'name', coalesce(t.v->>'unit', ''),
         nullif(t.v->>'qty_per_unit', '')::numeric, nullif(t.v->>'productivity', '')::numeric,
         coalesce((t.v->>'wait_days')::numeric, 0),
         nullif(t.v->>'crew', '')::int,
         coalesce(nullif(t.v->>'mode', ''), 'rate'),
         nullif(t.v->>'fixed_days', '')::numeric
  from jsonb_array_elements(p_trades) with ordinality as t(v, ord);
end;
$$;

revoke all on function public.gantt_takt_save(text, jsonb, jsonb, text) from public, anon, authenticated;
