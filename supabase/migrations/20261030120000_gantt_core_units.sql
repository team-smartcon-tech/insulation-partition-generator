-- 스마트 공정표 — 코어별 세대수 (2026-10-30)
--
-- 코어 하나가 한 층에서 맡는 세대 수 (예: 2세대, 5세대 동의 3+2). core_top_floors 와 같은 순서.
-- 스마트웍스 옵션마감 「동/라인 설정」 에서 불러올 때 묶인 라인 수가 들어간다. 0 = 모름.
-- 추가만 하는 변경.

alter table public.gantt_buildings
  add column if not exists core_units int[];

comment on column public.gantt_buildings.core_units is
  '코어별 세대수 (한 층에서 그 코어가 맡는 세대 수). core_top_floors 와 같은 순서. 0 = 모름.';
