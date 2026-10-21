-- ============================================================
-- Migration: 0001_smart_forms_init
-- 적용 대상: 스마트폼 전용 새 Supabase 프로젝트 (public 스키마 + storage.buckets)
--   ※ IPG(yzercziwazfrjsjnmbhr)·SSX(DCR kejieugtzuksqpgtxbwg, shdsgyzzwtteqdbhkvny) 에 적용 금지.
--     IPG 에는 아래 표가 이미 있고, SSX 는 이 표와 상관없는 공용 DB 다.
--
-- 왜 docs/ 에 있나: IPG 저장소의 supabase/migrations 에 두면 IPG 에 적용될 수 있다.
--   스마트폼 새 저장소를 만들면 그 저장소의 첫 마이그레이션으로 옮겨 쓴다.
--
-- 내용: IPG 의 스마트폼 마이그레이션 7개를 순서대로 적용한 결과를 한 파일로 합쳤다.
--   나중에 alter 로 더한 칸은 create table 안에 넣었다(컬럼 순서도 원래 적용 순서 그대로 — 끝에 붙는다).
--   원천:
--     20260911000001_form_taxonomy.sql
--     20260929024537_add_smart_forms_server_storage.sql
--     20260929043506_add_form_sites_members.sql
--     20260929234733_add_form_feedback.sql
--     20261013090000_add_form_documents_sheet_depts.sql
--     20261015090000_add_form_sites_qmp_settings.sql
--     20261015100000_add_form_documents_sheet_edited_at.sql
--
-- 접근: service_role 만 (RLS). Worker 가 service key 로 접근하고 로그인·권한 검사도 Worker 가 한다.
-- 기존 데이터: 새 프로젝트라 없다. 지우는 명령 없음. 여러 번 돌려도 같다(if not exists).
-- ============================================================

-- 1) 코드표 — 1차 분류마다 한 벌 ---------------------------------------------
create table if not exists public.form_taxonomy (
  -- 서류가 "어느 코드표 소속인지"를 이 id 로 기억한다. 1차 분류 이름을 바꿔도 서류가
  -- 떨어져 나가지 않도록 이름이 아니라 id 로 묶는다.
  id           text primary key,
  -- 지금은 회사 전체 공용이라 'company'. 나중에 현장별 코드표가 필요해지면 이 값을 늘린다.
  scope        text not null default 'company',
  -- 1차 분류 이름(예: '공무관련'). 코드표 엑셀의 시트 이름에서 온다.
  division     text not null default '',
  -- 트리에 보이는 순서
  sort_order   int  not null default 0,
  file_name    text not null,
  -- [{ code, name, items: [{ code, name, groupCode }] }]
  groups       jsonb not null,
  -- 같은 코드에 다른 이름이 붙은 코드 목록(화면 경고용)
  conflicts    jsonb not null default '[]'::jsonb,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

comment on table public.form_taxonomy is
  '우미 양식 모음집 서류 분류 코드표. 1차 분류마다 한 벌. 전 직원이 보고 본사 관리자만 바꾼다.';

-- 같은 범위 안에서 1차 분류 이름은 하나만(이름 없는 코드표는 제외)
create unique index if not exists uq_form_taxonomy_division
  on public.form_taxonomy (scope, division)
  where division <> '';

-- 2) 코드표 이력 — 바꿀 때마다 이전 것을 쌓는다(추가만 하고 고치지 않는다) -----
create table if not exists public.form_taxonomy_history (
  id            uuid primary key default gen_random_uuid(),
  taxonomy_id   text not null,
  division      text not null default '',
  file_name     text not null,
  groups        jsonb not null,
  conflicts     jsonb not null default '[]'::jsonb,
  -- 이 이력을 남긴 사람(= 새 코드표로 바꾼 사람)
  replaced_by   text,
  replaced_at   timestamptz not null default now()
);

comment on table public.form_taxonomy_history is
  '코드표를 바꾸기 직전의 내용. 잘못된 파일을 올렸을 때 되돌리는 용도. 추가만 한다.';

create index if not exists idx_form_taxonomy_history_taxonomy
  on public.form_taxonomy_history (taxonomy_id, replaced_at desc);

-- 3) 본사 관리자 명단 ----------------------------------------------------------
create table if not exists public.form_admins (
  -- 로그인 이메일로 판단한다. 대소문자 차이로 빠지지 않게 소문자로 넣는다(Worker 가 맞춘다).
  email        text primary key,
  name         text,
  added_by     text,
  added_at     timestamptz not null default now()
);

comment on table public.form_admins is
  '코드표를 바꿀 수 있는 본사 관리자. super_admin/system_admin 등급은 여기 없어도 바꿀 수 있다.';

-- 4) 현장 ----------------------------------------------------------------------
create table if not exists public.form_sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 목록에 보일 순서. 같은 값이면 이름 순.
  sort_order  int  not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- (20260929043506) 현장 조직과 기본 결재선. 모양이 자주 바뀌고 DB 가 안을 검색할 일이 없어 통째로 담는다.
  members       jsonb not null default '[]'::jsonb,
  line_defaults jsonb not null default '{}'::jsonb,
  -- (20261015090000) 현장마다 계획서를 따로 승인받아 작성 주기가 다르다.
  qmp_settings  jsonb not null default '{}'::jsonb
);

comment on table public.form_sites is
  '스마트폼 현장. 현장 서류함 하나가 현장 하나에 딸린다.';
comment on column public.form_sites.members is
  '현장 조직 — 결재선에서 고르는 사람 명단. 화면이 통째로 읽고 통째로 쓴다.';
comment on column public.form_sites.line_defaults is
  '그 현장의 기본 결재선(칸 이름 → 사람들). 새 서류의 결재선을 미리 채우는 데 쓴다.';
comment on column public.form_sites.qmp_settings is
  '품질관리계획서 설정 { startDate, cycles: {서식번호: 주기}, excluded: [절 번호], updatedAt, updatedBy }';

-- 같은 이름의 현장이 둘이면 어느 쪽 서류인지 사람이 구분할 수 없다.
create unique index if not exists uq_form_sites_name on public.form_sites (name);

-- 5) 서류(파일) ----------------------------------------------------------------
create table if not exists public.form_documents (
  id           uuid primary key default gen_random_uuid(),

  -- template = 본사가 배포한 원본(현장 공통), site = 그 현장의 작성본
  kind         text not null check (kind in ('template', 'site')),
  -- 배포 양식은 현장이 없다. 현장 서류는 반드시 현장이 있다(아래 check).
  site_id      uuid references public.form_sites (id) on delete cascade,

  -- 코드표의 어느 칸인가. 코드표를 지워도 서류는 남아야 하므로 set null.
  taxonomy_id  text references public.form_taxonomy (id) on delete set null,
  code         text,

  title        text not null,
  file_name    text not null,

  -- 엑셀이 아니라 **파일째 보관하는 첨부**인가(한글·PDF·도면·사진·압축).
  -- 첨부는 sheets 가 없고 화면에서 칸을 채울 수 없다.
  attachment   boolean not null default false,

  -- 파일 원본. Storage 버킷 `form-files`, 경로는 `{kind}/{id}/{file_name}`.
  file_bucket  text,
  file_path    text,
  file_size    bigint,
  content_type text,

  -- 화면에 그릴 격자(병합·테두리·칸 크기·글꼴). 이게 있어 열 때마다 엑셀을 다시 읽지 않는다.
  sheets       jsonb,
  -- sheets 를 만든 파서 판번호(apps/web/src/features/forms/formParser.ts PARSER_VERSION).
  -- 올라가면 원본 파일에서 다시 읽어 갱신한다.
  parser_version int,

  -- 사용자가 적은 것들. 컬럼명이 values 가 아닌 이유: values 는 SQL 예약어다.
  cell_values    jsonb not null default '{}'::jsonb,
  custom_sheets  jsonb not null default '[]'::jsonb,
  extra_rows     jsonb not null default '{}'::jsonb,
  approval_lines jsonb not null default '{}'::jsonb,
  approvals      jsonb not null default '{}'::jsonb,

  -- 현장 서류: 어느 배포 양식에서 만들었나("새 판 있음" 판단에 쓴다)
  template_id          uuid references public.form_documents (id) on delete set null,
  template_uploaded_at timestamptz,
  -- 배포 양식: 한 번에 여러 칸으로 함께 배포한 묶음 번호.
  -- 저장이 칸마다 따로라 시각이 몇 ms 씩 다른데, 그 차이를 "새 판"으로 오해하지 않으려면 필요하다.
  batch_id             uuid,

  uploaded_by   text,
  uploader_name text,

  -- 본사 점검 — 본사 사람이 현장에 가지 않고 서류를 확인한다.
  --   none      = 아직 점검 대상 아님
  --   requested = 현장이 점검을 요청함
  --   ok        = 본사가 확인함
  --   fix       = 본사가 보완을 요청함(review_note 에 사유)
  review_status text not null default 'none'
                  check (review_status in ('none', 'requested', 'ok', 'fix')),
  reviewed_by   text,
  reviewer_name text,
  reviewed_at   timestamptz,
  review_note   text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- (20261013090000) 품질관리계획서 서식(시트)마다 작성 부서. 예: {"QA-4.3-2": "공사"}
  sheet_depts     jsonb not null default '{}'::jsonb,
  -- (20261015100000) 장마다 마지막으로 글자를 고친 때. "N일째 기록 없음" 알림용.
  sheet_edited_at jsonb not null default '{}'::jsonb,

  -- 배포 양식에 현장이 붙어 있거나 현장 서류에 현장이 없으면 목록이 어긋난다.
  constraint form_documents_site_matches_kind check (
    (kind = 'template' and site_id is null) or (kind = 'site' and site_id is not null)
  )
);

comment on table public.form_documents is
  '스마트폼 서류 1건 = 파일 1개(+ 엑셀이면 격자와 적은 글자). 파일 원본은 Storage(form-files).';
comment on column public.form_documents.sheet_depts is
  '시트 이름 → 그 장을 쓰는 부서(품질·공무·공사). 품질관리계획서 서류 현황용.';
comment on column public.form_documents.sheet_edited_at is
  '시트 이름 → 마지막으로 글자를 고친 때(ms). 작성 일정의 "N일째 기록 없음" 알림용';

-- 현장 서류함 목록: 이 현장의 이 칸에 무엇이 있나
create index if not exists idx_form_documents_site_slot
  on public.form_documents (site_id, taxonomy_id, code)
  where kind = 'site';

-- 배포 양식함 목록: 이 칸에 배포된 원본이 무엇인가(최근 판이 먼저)
create index if not exists idx_form_documents_templates
  on public.form_documents (taxonomy_id, code, created_at desc)
  where kind = 'template';

-- 본사 점검함: 점검할 것만 모아 본다(대부분의 행은 'none' 이라 부분 인덱스가 작다)
create index if not exists idx_form_documents_review
  on public.form_documents (review_status, updated_at desc)
  where review_status <> 'none';

-- 최근 순 목록
create index if not exists idx_form_documents_updated
  on public.form_documents (updated_at desc);

-- 6) 오류·개선 의견 ------------------------------------------------------------
create table if not exists public.form_feedback (
  id            uuid primary key default gen_random_uuid(),

  -- 오류 신고인가 개선 의견인가. 화면에서 고른다.
  kind          text not null default 'bug' check (kind in ('bug', 'idea')),
  title         text not null,
  body          text not null default '',
  -- 어느 화면·서류에서 생긴 일인가(자유 입력). 본사가 재현해 볼 때 쓴다.
  where_at      text,

  -- 처리 상태. 본사만 바꾼다.
  status        text not null default 'open' check (status in ('open', 'doing', 'done', 'wont')),
  reply         text,
  replied_by    text,
  replied_at    timestamptz,

  -- 올린 사람. 로그인 정보를 Worker 가 적는다(화면이 보낸 값은 믿지 않는다).
  author_id     text,
  author_name   text,
  author_email  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.form_feedback is
  '스마트폼 오류 신고·개선 의견. 직원 누구나 올리고 모두가 본다. 상태와 답은 본사 관리자만 적는다.';
comment on column public.form_feedback.kind is 'bug=오류 신고, idea=개선 의견';
comment on column public.form_feedback.status is 'open=접수, doing=확인 중, done=처리 완료, wont=하지 않음';
comment on column public.form_feedback.where_at is '어느 화면·서류에서 생겼나(자유 입력)';

-- 목록은 늘 최신순으로 읽는다.
create index if not exists idx_form_feedback_created on public.form_feedback (created_at desc);
-- 본사가 "아직 안 본 것"만 추릴 때.
create index if not exists idx_form_feedback_status on public.form_feedback (status, created_at desc);

-- 7) 권한 및 RLS (service_role 전용 — 워커가 service key로 접근) ----------------
grant all privileges on table public.form_taxonomy         to service_role;
grant all privileges on table public.form_taxonomy_history to service_role;
grant all privileges on table public.form_admins           to service_role;
grant all privileges on table public.form_sites            to service_role;
grant all privileges on table public.form_documents        to service_role;
grant all privileges on table public.form_feedback         to service_role;
-- 원본 그대로: revoke 는 form_feedback 에만 있었다. 다른 표는 RLS 정책이 service_role 뿐이라 막힌다.
revoke all privileges on table public.form_feedback from anon, authenticated;

alter table public.form_taxonomy         enable row level security;
alter table public.form_taxonomy_history enable row level security;
alter table public.form_admins           enable row level security;
alter table public.form_sites            enable row level security;
alter table public.form_documents        enable row level security;
alter table public.form_feedback         enable row level security;

drop policy if exists "service_role_all" on public.form_taxonomy;
create policy "service_role_all" on public.form_taxonomy
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_taxonomy_history;
create policy "service_role_all" on public.form_taxonomy_history
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_admins;
create policy "service_role_all" on public.form_admins
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_sites;
create policy "service_role_all" on public.form_sites
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_documents;
create policy "service_role_all" on public.form_documents
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_feedback;
create policy "service_role_all" on public.form_feedback
  for all to service_role using (true) with check (true);

-- 8) Storage 버킷 form-files ---------------------------------------------------
-- 원 마이그레이션은 버킷을 SQL 로 만들지 않고 주석으로만 남겼다(한 파일 최대 100MB 라고 적혀 있다).
-- 그런데 IPG 운영 버킷의 실제 한도는 50MB(52428800)였다. 옮긴 뒤 올라가던 파일이 막히지 않게 실측값을 따른다.
-- 비공개: Worker 가 service key 로만 읽고 쓰고, 브라우저에는 짧은 유효시간의 주소만 내어 준다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('form-files', 'form-files', false, 52428800)
on conflict (id) do nothing;
