# MIGRATION.md

이 문서는 DB schema, RPC, RLS, seed, 데이터 보정 작업의 변경 절차를 정리한다.

DB 변경이 생기기 전까지 프로젝트별 migration log는 비워둘 수 있다. 다만 Woomi 표준 DB는 Supabase PostgreSQL을 기준으로 하므로 migration 전략은 아래 원칙을 따른다.

---

## 1. Migration Rules

- 운영 데이터를 잃는 변경은 사용자 승인 없이 수행하지 않는다.
- destructive migration은 백업/복구 계획을 먼저 적는다.
- RLS 변경은 권한 매트릭스와 함께 검토한다.
- RPC/function 추가 시 호출하는 repository와 API 문서를 함께 갱신한다.
- schema 변경 후 `.agents/data/DB_SCHEMA.md`와 관련 API 계약을 갱신한다.
- migration 파일은 수동으로 이름을 지어 만들지 않는다. Supabase CLI의 `supabase migration new <name>`를 우선 사용한다.
- migration은 한 번 적용된 뒤 수정하지 않는다. 잘못된 migration은 새 migration으로 보정한다.
- migration은 가능한 작고 되돌릴 수 있게 나눈다.
- schema 변경과 data backfill은 가능하면 분리한다.
- production migration은 사용자 승인 없이 실행하지 않는다.

---

## 2. Supabase PostgreSQL Strategy

표준 흐름:

1. 변경 의도를 정리한다.
2. local 또는 dev DB에서 SQL을 검증한다.
3. Supabase advisor 또는 SQL review로 보안/성능 문제를 확인한다.
4. migration 파일을 생성한다.
5. migration SQL을 작성한다.
6. local/dev에 적용해 검증한다.
7. 관련 코드, API 계약, DB schema 문서를 함께 갱신한다.
8. production 적용 전 rollback 계획을 작성한다.

명령은 프로젝트의 Supabase CLI 버전에 따라 달라질 수 있으므로 실행 전 `--help`로 확인한다.

```bash
supabase --help
supabase migration --help
supabase db --help
```

새 migration 생성:

```bash
supabase migration new <descriptive_name>
```

migration 이름 기준:

```txt
add_site_documents
add_user_role_policy
rename_dcr_site_id_to_site_id
backfill_organization_member_people
```

금지:

- timestamp가 붙은 migration 파일명을 AI가 임의로 만들어내기
- 운영 DB에서 직접 수정한 뒤 migration을 남기지 않기
- local/dev 검증 없이 production에 SQL 실행
- schema 변경, RLS 변경, API 변경을 서로 다른 작업으로 흩어놓기

---

## 3. Migration Types

| 유형 | 예 | 원칙 |
|---|---|---|
| additive schema | table/column/index 추가 | 가장 안전하다. 기본값으로 선호 |
| contract change | column rename, response 구조 변경 | 코드와 API 계약을 동시에 갱신 |
| destructive | drop column/table, type 축소 | 사용자 승인, 백업, rollback 필요 |
| RLS/security | policy, role, grant 변경 | 권한 매트릭스와 테스트 필요 |
| RPC/function | PostgreSQL function 변경 | 호출 repository와 API 문서 동시 갱신 |
| backfill | 기존 데이터 보정 | dry-run, 영향 row 수, 재실행 가능성 확인 |
| seed/reference | 기준 데이터 추가 | idempotent하게 작성 |

---

## 4. Safe Migration Patterns

### 4.1 컬럼 추가

안전한 순서:

1. nullable column 또는 안전한 default가 있는 column 추가
2. 앱 코드에서 새 column을 쓰도록 변경
3. backfill
4. 필요하면 `not null` 추가

주의:

- 큰 테이블에 무거운 default/not null을 한 번에 걸지 않는다.
- 기존 row에 어떤 값이 들어갈지 먼저 정한다.

### 4.2 컬럼명 변경

안전한 순서:

1. 새 column 추가
2. dual write 또는 backfill
3. 읽기 경로를 새 column으로 변경
4. 충분히 검증 후 이전 column 제거

작은 내부 프로젝트에서는 단순 rename도 가능하지만, API/프론트/외부 연동이 있으면 위 순서를 우선한다.

### 4.3 Constraint 추가

PostgreSQL은 `add constraint if not exists`를 지원하지 않는다. 중복 실행 가능성이 있는 migration은 `pg_constraint`를 확인한다.

```sql
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'example_status_check'
  ) then
    alter table public.example
    add constraint example_status_check
    check (status in ('draft', 'active', 'archived'));
  end if;
end $$;
```

### 4.4 Index 추가

- foreign key 컬럼 index를 우선 검토한다.
- 대형 테이블에서는 lock 영향을 검토한다.
- query pattern 없이 index를 과도하게 추가하지 않는다.
- unique index는 기존 중복 데이터가 없는지 먼저 확인한다.

### 4.5 RLS 변경

RLS 변경 전 확인:

```txt
Table:
Roles:
SELECT policy:
INSERT policy:
UPDATE policy:
DELETE policy:
Admin bypass path:
Test users:
```

주의:

- `UPDATE`는 SELECT policy가 없으면 대상 row를 찾지 못할 수 있다.
- 권한 판단에 user-editable metadata를 사용하지 않는다.
- policy를 완화하는 변경은 production 적용 전 별도 승인을 받는다.

### 4.6 Backfill

backfill은 재실행해도 깨지지 않게 작성한다.

필수 기록:

```txt
Affected rows estimate:
Batching needed:
Can rerun safely:
Before count:
After count:
Rollback method:
```

대량 데이터는 한 번에 update하지 말고 batch 처리 또는 별도 운영 절차를 검토한다.

---

## 5. Pre-Flight Checklist

```txt
Migration name:
Purpose:
Affected tables:
Affected columns:
Affected RPC/functions:
Affected RLS policies:
Affected APIs:
Affected frontend screens:
Backfill needed:
Data loss risk:
Lock risk:
Rollback plan:
Test data:
Docs updated:
```

---

## 6. Rollback Strategy

rollback은 migration 작성 시점에 함께 적는다.

rollback 분류:

| 분류 | 설명 |
|---|---|
| simple rollback | 새로 추가한 table/index/function 제거처럼 영향이 제한적 |
| forward fix | 이미 운영 데이터가 바뀌어 이전 migration을 되돌리지 않고 새 migration으로 보정 |
| manual recovery | 백업, export, 관리자 검토가 필요한 복구 |
| not safely reversible | 데이터 손실 때문에 자동 rollback 불가 |

destructive migration은 반드시 다음을 적는다.

```txt
Backup location:
Restore command/process:
Data loss scope:
Approval:
```

---

## 7. Migration Log

| 날짜 | 파일/버전 | 변경 요약 | 영향 범위 | 롤백 |
|---|---|---|---|---|
| YYYY-MM-DD | `<migration-file>` | `<summary>` | `<tables/apis>` | `<rollback>` |

---

## 8. Notes

아직 프로젝트별 migration 기록이 없다. 실제 DB 변경이 생기면 이 문서의 checklist와 log를 함께 갱신한다.
