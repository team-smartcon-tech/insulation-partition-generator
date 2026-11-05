-- 스마트 공정표 — 코어별 옥탑 층수 (2026-10-30)
--
-- 옥탑도 층수가 있고 코어마다 다를 수 있다(예: 1코어 옥탑 2층, 2코어 옥탑 1층).
-- core_top_floors 와 같은 순서의 배열로 둔다. core_rooftop_floors[i] = (i+1)코어의 옥탑 층수(0 = 없음).
-- has_rooftop 은 계속 "옥탑이 있는 코어가 하나라도 있나" 로 맞춘다.
-- 추가만 하는 변경. 기존 행은 null 로 남고, 읽을 때 has_rooftop 이면 코어마다 1층, 아니면 0층으로 본다.

alter table public.gantt_buildings
  add column if not exists core_rooftop_floors int[];

comment on column public.gantt_buildings.core_rooftop_floors is
  '코어별 옥탑 층수. [1코어, 2코어, …], 0 = 없음. core_top_floors 와 길이가 같다. null 이면 has_rooftop 기준 1/0.';
