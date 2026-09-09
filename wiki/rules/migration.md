---
type: rule
updated: 2026-08-19
tags: [area/데이터]
---

# 마이그레이션

DB schema·RPC·RLS·seed·데이터 보정의 변경 절차. Supabase PostgreSQL 기준이다.

## 기본 원칙

- migration 파일은 수동 명명하지 않고 `supabase migration new <name>`을 우선 사용한다. 이름은 서술형(`add_site_documents`).
- Supabase MCP가 연결돼 있으면 변경 전에 실제 스키마를 조회해 `DB_SCHEMA.md`와 대조한다. 문서와 실제가 다르면 **문서를 실제 DB에 맞춘 뒤** migration을 설계한다. 단 MCP는 조회 전용이고, 생성·적용은 항상 Supabase CLI로 한다 — [도구 사용 기준](tooling.md).
- 한 번 적용된 migration은 수정하지 않고 새 migration으로 보정한다.
- 가능한 작고 되돌릴 수 있게 분할하고, schema 변경과 data backfill은 분리한다.

## 표준 흐름 8단계

변경 의도 정리 → local/dev SQL 검증 → advisor/SQL review → migration 파일 생성 → SQL 작성 → local/dev 적용 검증 → 코드·API 계약·스키마 문서 갱신 → production 전 rollback 계획 작성.

## 유형별 원칙

additive(가장 안전, 기본 선호) / contract change(코드·API 동시 갱신 — [API 계약과 도메인 모델](api-contract.md)) / destructive(승인·백업·rollback 필수) / RLS·security(권한 매트릭스·테스트) / RPC·function(호출 repository·문서 동시 갱신) / backfill(dry-run·영향 row 수·재실행 가능성) / seed(idempotent).

## 안전 패턴

- 컬럼 추가: nullable/안전 default → 코드 변경 → backfill → 필요 시 not null.
- 컬럼명 변경: 새 컬럼 추가 → dual write/backfill → 읽기 경로 전환 → 검증 후 제거.
- unique index는 기존 중복 데이터부터 확인. 대형 테이블 index는 lock 영향 검토.
- backfill은 idempotent하게 쓰고 Affected rows·Batching·Before/After count·Rollback method를 기록한다.

## 금지

- 운영 데이터를 잃는 변경·production migration을 사용자 승인 없이 실행 — [절대 금지·필수 규칙](non-negotiable-rules.md)
- AI가 timestamp 붙은 migration 파일명을 임의 생성
- 운영 DB를 직접 수정하고 migration 미기록
- local/dev 검증 없이 production SQL 실행
- schema·RLS·API 변경을 서로 다른 작업으로 흩뜨리기

## Rollback 분류

simple rollback / forward fix / manual recovery / not safely reversible(데이터 손실로 자동 rollback 불가). destructive는 Backup location·Restore process·Data loss scope·Approval을 먼저 적는다.

## 함께 보기

- [DB 스키마 가드레일](db-schema-guardrails.md)
- [API 계약과 도메인 모델](api-contract.md)
- [테스트와 검증](testing.md)
- [배포](deployment.md)
- [작업 흐름](workflow.md)
- [진입 규칙](agents-entry.md)
- [NestJS 프로젝트 규칙](nestjs.md)

## 출처

- [원본 · .agents/data/MIGRATION.md](../sources/migration.md)
