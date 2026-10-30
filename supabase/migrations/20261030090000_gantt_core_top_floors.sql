-- 스마트 공정표 — 코어별 최상층 (2026-10-30)
--
-- 같은 동이라도 코어마다 최상층이 다를 수 있다(예: 401동 1코어 42층, 2코어 37층).
-- 동 한 줄 안에 코어별 최상층을 배열로 둔다. 동 번호 유일키(site_id, building_no)는 그대로.
--   core_top_floors[i] = (i+1)코어의 최상층. 길이 = cores.
--   top_floor 는 계속 "동의 최상층" = 코어 중 가장 높은 층 (엔진은 동 단위로 이 값을 쓴다).
-- 추가만 하는 변경이라 기존 행은 null 로 남고, 읽을 때 [top_floor × cores] 로 본다.

alter table public.gantt_buildings
  add column if not exists core_top_floors int[];

comment on column public.gantt_buildings.core_top_floors is
  '코어별 최상층. [1코어, 2코어, …]. null 이면 모든 코어가 top_floor. top_floor = 이 배열의 최댓값.';
