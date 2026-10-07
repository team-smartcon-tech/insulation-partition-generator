-- ============================================================
-- Migration: 20261007061356_market_apps_section_distribution
-- 적용 대상: 오토콘(AutoCon) 전용 Supabase 프로젝트 (ref yzercziwazfrjsjnmbhr, public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 반드시 이 프로젝트 전용 DB에만 적용.
-- 내용: App Market 게시물에 홈 섹션 구분 + 설치형(다운로드) 배포 방식 추가.
--   - section        : 홈에서 묶일 섹션 ('construction' 시공 도구 | 'cad' CAD 도구)
--   - distribution   : 'web'(deploy_url 을 새 탭으로 연다) | 'download'(deploy_url 의 설치파일을 Worker 가 중계)
--   - download_count : 설치형 다운로드 횟수 (Worker 중계 시 +1)
-- 안전성: 상수 기본값 컬럼 추가만 한다 → PG11+ 에서 테이블 재작성 없이 즉시 끝나고,
--   기존 행은 기본값(시공 도구 · 웹앱 · 0)으로 채워진다. 기존 Worker 는 컬럼을 명시해 조회하므로 영향 없음.
-- 순서: 이 마이그레이션을 먼저 적용한 뒤 새 Worker 를 배포한다(새 Worker 가 이 컬럼들을 조회한다).
-- 롤백: drop function market_app_bump_download(uuid);
--       alter table market_apps drop column section, drop column distribution, drop column download_count;
--       (이전 Worker 로 먼저 되돌린 뒤 실행. CAD 분류·다운로드 수는 사라진다)
-- ============================================================

alter table public.market_apps
  add column if not exists section        text not null default 'construction',
  add column if not exists distribution   text not null default 'web',
  add column if not exists download_count int  not null default 0;

comment on column public.market_apps.section is
  '홈 섹션: construction(시공 도구) | cad(CAD 도구). 허용 값 검증은 Worker(market.ts)에서 한다.';
comment on column public.market_apps.distribution is
  '배포 방식: web(deploy_url 로 이동) | download(deploy_url 의 설치파일을 Worker 가 중계 — URL 은 일반 사용자에게 내려주지 않는다).';
comment on column public.market_apps.download_count is
  '설치형 다운로드 횟수. Worker 의 /download 중계 시 market_app_bump_download 로 +1.';

-- 다운로드 수 +1 (조회수 함수와 같은 방식 — 동시 요청에서도 유실 없도록 원자적 갱신)
create or replace function public.market_app_bump_download(p_app_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.market_apps
     set download_count = download_count + 1
   where id = p_app_id;
$$;

comment on function public.market_app_bump_download(uuid) is
  '설치형 다운로드 중계 시 다운로드 수 +1 (원자적).';

grant execute on function public.market_app_bump_download(uuid) to service_role;
