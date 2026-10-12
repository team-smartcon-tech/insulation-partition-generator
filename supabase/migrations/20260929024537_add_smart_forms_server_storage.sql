-- ============================================================
-- Migration: 20260929024537_add_smart_forms_server_storage
-- 적용 대상: IPG 전용 Supabase 프로젝트 (public 스키마)
--   ※ SSX 공용 DB(DCR/DCR-dev)에 적용 금지 — 반드시 이 프로젝트 전용 DB에만 적용.
--
-- 왜: 스마트폼(/tools/forms)의 자료가 지금은 **각자 브라우저 안에만** 있다. 그래서
--     옆자리 직원이 열면 비어 있고, 큰 파일을 몇 개만 넣어도 저장소가 찬다.
--     현장이 올린 서류를 본사가 앉아서 점검하려면 파일과 목록이 서버에 있어야 한다.
--     목표는 현장 공유폴더(`Z:\01. 공사`)를 이 앱으로 대신하는 것이다.
--
-- 내용:
--   - form_sites     : 현장(부산장안 B1 …). 서류는 현장에 딸린다.
--   - form_documents : 서류 1건 = 파일 1개(+ 엑셀이면 격자와 적은 글자). 본사 점검 칸 포함.
--   파일 자체는 Storage 버킷 `form-files` 에 두고 여기에는 경로만 둔다.
--
-- 접근: service_role 만 (RLS). Worker 가 service key 로 접근하고 로그인·권한 검사도 Worker 가 한다.
--       브라우저는 Worker 가 발급한 짧은 유효시간의 주소로만 파일을 읽고 쓴다.
--
-- 기존 데이터: 건드리지 않는다. 새 표만 만들고 지우는 명령은 없다.
-- 되돌리기: `drop table public.form_documents, public.form_sites;` (아직 아무도 쓰지 않는 새 표)
-- ============================================================

-- 1) 현장 --------------------------------------------------------------------
create table if not exists public.form_sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 목록에 보일 순서. 같은 값이면 이름 순.
  sort_order  int  not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.form_sites is
  '스마트폼 현장. 현장 서류함 하나가 현장 하나에 딸린다.';

-- 같은 이름의 현장이 둘이면 어느 쪽 서류인지 사람이 구분할 수 없다.
create unique index if not exists uq_form_sites_name on public.form_sites (name);

-- 2) 서류(파일) --------------------------------------------------------------
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

  -- 배포 양식에 현장이 붙어 있거나 현장 서류에 현장이 없으면 목록이 어긋난다.
  constraint form_documents_site_matches_kind check (
    (kind = 'template' and site_id is null) or (kind = 'site' and site_id is not null)
  )
);

comment on table public.form_documents is
  '스마트폼 서류 1건 = 파일 1개(+ 엑셀이면 격자와 적은 글자). 파일 원본은 Storage(form-files).';

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

-- 3) 권한 및 RLS -------------------------------------------------------------
-- Worker 가 service key 로만 접근한다. 브라우저는 이 표에 직접 닿지 않는다.
grant all privileges on table public.form_sites     to service_role;
grant all privileges on table public.form_documents to service_role;

alter table public.form_sites     enable row level security;
alter table public.form_documents enable row level security;

drop policy if exists "service_role_all" on public.form_sites;
create policy "service_role_all" on public.form_sites
  for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.form_documents;
create policy "service_role_all" on public.form_documents
  for all to service_role using (true) with check (true);

-- ============================================================
-- 이 SQL 로는 만들 수 없는 것 — Storage 버킷
--   이름: form-files
--   Public bucket: 끔(비공개). Worker 가 service key 로만 읽고 쓰고,
--                  브라우저에는 짧은 유효시간의 주소만 내어 준다.
--   한 파일 최대: 100MB (현장 공유폴더의 공사현황보고가 42MB 였다)
-- 버킷이 없으면 목록·작성 내용은 저장되지만 파일 원본이 올라가지 않는다.
-- ============================================================
