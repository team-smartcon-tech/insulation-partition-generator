-- 스마트폼: 현장별 품질관리계획서 설정(2026-10-15 사용자 승인).
-- 착공일·서식별 작성 주기(주간·월간·분기·반기·연간·한 번·준공 때·수시)·적용 제외 절을 통째로(jsonb) 담는다.
-- 현장마다 계획서를 따로 승인받아 주기가 다르다. 빈 칸으로 더하므로 기존 자료에는 영향이 없다.
-- 되돌리기: alter table public.form_sites drop column qmp_settings;
alter table public.form_sites
  add column if not exists qmp_settings jsonb not null default '{}'::jsonb;

comment on column public.form_sites.qmp_settings is
  '품질관리계획서 설정 { startDate, cycles: {서식번호: 주기}, excluded: [절 번호], updatedAt, updatedBy }';
