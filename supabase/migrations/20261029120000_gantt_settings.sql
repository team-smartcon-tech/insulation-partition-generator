-- 스마트 공정표 — 현장 규모·설정 (Smart Gantt Chart 이관, 2026-10-29)
--
-- 현장(site)은 스마트웍스(dcr-app) 의 site id(text) 를 그대로 쓴다 — 작업일보가 그 id 로 연결된다.
-- 작업일보 자체는 dcr-app DB 를 읽기 전용으로 조회하므로 여기에 두지 않는다.
-- 두 표 모두 service_role 로만 읽고 쓴다(RLS 켜고 정책 없음). 브라우저는 Worker 를 거친다.

-- 1) 현장별 공정 설정 (설계 §5: 자원 용량·반일 옵션·팀 운영 제약). 통째로 jsonb 로 두어
--    옵션이 늘어도 표를 안 바꾼다. 모양은 packages/gantt-engine siteSettingsSchema 가 검증한다.
create table if not exists public.gantt_site_settings (
  site_id     text primary key,
  settings    jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

comment on table public.gantt_site_settings is
  '스마트 공정표 현장별 설정(철근팀 수, 갱폼 단위, 반일 옵션, 오후 단독투입 불가 등). site_id = dcr site id.';

-- 2) 현장별 동 목록과 규모. 일보의 "401동" 과 building_no 로 맞춘다.
create table if not exists public.gantt_buildings (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null,
  building_no   int  not null,              -- 401
  name          text not null,              -- "401동"
  cores         int  not null default 1,    -- 코어 수 (현재는 저장만, 엔진 단위는 동)
  base_floor    int  not null default 3,    -- 기준층 시작 층 (갱폼이 붙는 층)
  top_floor     int  not null,              -- 최상층. 이 층 타설이 끝나면 사이클에서 빠진다
  has_rooftop   boolean not null default false,
  current_floor int,                        -- 일보가 없을 때의 출발 층 (일보가 있으면 일보 우선)
  updated_by    text,
  updated_at    timestamptz not null default now(),
  unique (site_id, building_no)
);

comment on table public.gantt_buildings is
  '스마트 공정표 현장별 동 목록·규모. 최상층(top_floor)이 있어야 11월 이후 계획이 맞는다 (설계 §8-2).';

create index if not exists gantt_buildings_site_idx on public.gantt_buildings (site_id);

alter table public.gantt_site_settings enable row level security;
alter table public.gantt_buildings      enable row level security;
-- 정책 없음: anon/authenticated 는 접근 불가, service_role 만 (Worker 전용)
