-- ============================================================
-- Migration: 20261105090000_market_home_card_badges
-- 적용 대상: 스마트 툴박스 전용 Supabase 프로젝트 (ref yzercziwazfrjsjnmbhr, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지.
-- 내용: 홈 카드 상태 배지 — 관리자가 카드마다 출처(본사/현장)와 상태(사내기준/운영중/검증중)를 지정한다.
--   card_badges: { "{카드 키}": { "origin": "hq"|"site", "status": "standard"|"operating"|"testing" } }
--   카드 키 형식은 card_keys 와 같다 ("tool:{id}" / "market:{uuid}"). 키가 없으면 배지 없음.
--   순서와 같은 단일 행(id='home')에 두고 순서 편집 저장 때 함께 통째로 교체한다 — 관리자 1인 편집, 마지막 저장 우선.
-- 순서: 추가형 — 이 마이그레이션 먼저, 코드 배포 다음.
--   코드는 select=* 로 읽어 컬럼이 없으면 배지 없음으로, 저장은 배지 없이 순서만 저장하도록 폴백한다.
-- 롤백: 코드 revert 후 alter table public.market_home_order drop column card_badges;
-- ============================================================

alter table public.market_home_order
  add column if not exists card_badges jsonb not null default '{}'::jsonb;

comment on column public.market_home_order.card_badges is
  '카드 키 → { origin: hq|site, status: standard|operating|testing } 상태 배지. 없는 키는 배지 없음.';
