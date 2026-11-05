-- 택트 인원 탭 — 공종별 인원 직접 지정 (2026-10-31, 사용자: 인원을 줄였다 늘렸다)
-- crew: null = 자동(택트에 맞춘 최소 인원), 값이 있으면 그 인원. 추가만 하는 변경(기존 줄은 null = 자동).

alter table public.gantt_takt_trades
  add column if not exists crew int check (crew is null or crew > 0);

comment on column public.gantt_takt_trades.crew is
  '인원 직접 지정. null 이면 자동(max(1, 올림(구간 인·일 ÷ 택트))).';

-- 저장 함수에 crew 를 더한다 (인자·나머지 동작은 같다)
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

  insert into gantt_takt_trades (site_id, sort_order, stage, name, unit, qty_per_unit, productivity, wait_days, crew)
  select p_site_id, t.ord - 1, (t.v->>'stage')::int, t.v->>'name', coalesce(t.v->>'unit', ''),
         (t.v->>'qty_per_unit')::numeric, (t.v->>'productivity')::numeric, coalesce((t.v->>'wait_days')::numeric, 0),
         nullif(t.v->>'crew', '')::int
  from jsonb_array_elements(p_trades) with ordinality as t(v, ord);
end;
$$;

revoke all on function public.gantt_takt_save(text, jsonb, jsonb, text) from public, anon, authenticated;
