-- 스마트 공정표 — 동별 지하층 수 (2026-10-30, 설계 §8-2 2안: 지하·저층 예정 계산)
--
-- 일보에 아직 안 나온 동(착공 전)이 지하 맨 아래층(B{basement_floors})부터 재래식 순서표로 출발하는 데 쓴다.
-- 일보가 있는 동은 일보의 층이 우선이다. null = 모름(지하 출발 안 함), 0 = 지하 없음.
-- 추가만 하는 변경.

alter table public.gantt_buildings
  add column if not exists basement_floors int;

comment on column public.gantt_buildings.basement_floors is
  '지하층 수 (B3 까지면 3). 일보 없는 동의 지하 출발 층. null = 모름, 0 = 지하 없음.';
