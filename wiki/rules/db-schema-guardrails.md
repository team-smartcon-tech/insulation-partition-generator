---
type: rule
updated: 2026-08-19
tags: [area/데이터]
---

# DB 스키마 가드레일

Supabase PostgreSQL 스키마 설계에서 잘못된 데이터를 막는 규칙. 가드레일을 위반하는 스키마는 만들기 전에 이유를 설명하고 사용자 승인을 받는다.

## 네이밍과 타입

- 테이블·컬럼·constraint·index는 소문자 `snake_case`. 모든 주요 테이블은 primary key.
- 시간은 `timestamptz`, 금액·정확 계산은 `float` 대신 `numeric`, 단순 문자열은 `varchar(n)`보다 `text`, 상태값은 `text + check constraint` 또는 명시적 enum.
- FK로 표현 가능한 관계를 문자열이나 중복 id 배열로 대체하지 않는다.

## Constraint

DB constraint는 잘못된 데이터를 막는 마지막 방어선이다(`not null`/`unique`/`check`/`fk`/`on delete`). `on delete cascade`는 손실 범위가 명확할 때만 쓰고, 보존해야 할 기록은 soft delete를 우선한다. constraint 추가는 `pg_constraint`를 확인하는 `do $$` block으로 한다 — [마이그레이션](migration.md).

## 정규화와 jsonb

기본은 과하지 않은 정규화. 역정규화는 이유가 있을 때만 하고 Source of truth·Sync strategy·Stale tolerance를 기록한다. `jsonb`는 외부 API 원본·스냅샷 보관에 허용하되, 자주 검색·조인·권한 판정에 쓰는 값은 컬럼으로 승격한다.

금지: 이유 없는 중복 저장, 거대 jsonb 몰아넣기, 관계형 데이터의 comma-separated 저장, 제약 없는 자유 문자열 상태값, 프론트 화면 구조 그대로의 테이블 설계.

## RLS

- 사용자/조직/현장/tenant별 데이터는 RLS를 켠다. `auth.uid()`만 복사해 전 테이블에 붙이지 않는다.
- `UPDATE`에는 SELECT policy도 필요하다(없으면 대상 row를 못 찾는다).
- 권한 판단에 `user_metadata`를 쓰지 않는다 — app metadata 또는 별도 권한 테이블.
- `security definer` function은 exposed schema에 두지 않고, view는 `security_invoker = true`를 검토한다.

## Index

AI가 index를 자동 생성하지 않는다. query pattern·table size·write frequency 근거를 적어 create/defer/reject를 제안하고, production 대형 테이블·unique/복합/partial/expression·jsonb GIN index는 사용자 승인이 필요하다.

## 함께 보기

- [마이그레이션](migration.md)
- [API 계약과 도메인 모델](api-contract.md)
- [절대 금지·필수 규칙](non-negotiable-rules.md)
- [기술 스택](stack.md)
- [진입 규칙](agents-entry.md)
- [작업 흐름](workflow.md)

## 출처

- [원본 · .agents/data/DB_SCHEMA.md](../sources/db-schema.md)
