---
type: rule
updated: 2026-08-19
tags: [area/데이터, area/api]
---

# API 계약과 도메인 모델

작업이 진행되며 채워 가는 두 개의 살아있는 문서. 시작 시 억지로 완성하지 않고, 실제 구현으로 확인된 것만 기록한다.

## API 계약 (API_CONTRACT.md)

갱신 시점: 새 endpoint 추가, request/response 구조 변경, error code·사용자 메시지 변경, 인증/권한 조건 변경, 프론트 API client·TanStack Query hook·form schema에 영향이 있을 때. 바뀌면 **같은 작업에서** 갱신한다.

기록 항목: Endpoint / Method / Purpose / Auth required / Allowed roles / Request params·body / Response / Error codes / Related service·repository / Related DB tables·RPC / Related frontend usage / Notes.

## 도메인 모델 (DOMAIN_MODEL.md)

작성 시점: 핵심 도메인 이름 확정, 엔티티 관계가 코드/DB에 반영, 상태값·권한·생명주기 규칙 발생, 도메인 용어가 팀에서 반복 사용될 때.

기록 항목: Domain / Purpose / Main users / Core entities / Entity relationships / Status lifecycle / Role·permission rules / Important invariants / Related screens·APIs·tables / Open questions.

## 왜 중요한가

계약·도메인 문서가 코드와 함께 갱신되어야 프론트와 백엔드가 어긋나지 않고, AI가 다음 작업에서 정확한 컨텍스트를 읽는다. Status lifecycle과 권한 규칙은 DB check constraint·RLS([DB 스키마 가드레일](db-schema-guardrails.md))와 API의 Allowed roles([API 계층 규칙](api-layers.md))로 직결된다.

이 위키에 정리한 시점(2026-08-06) 기준으로 두 문서의 기록 본문은 아직 비어 있는 템플릿 상태다.

## 함께 보기

- [API 계층 규칙](api-layers.md)
- [DB 스키마 가드레일](db-schema-guardrails.md)
- [마이그레이션](migration.md)
- [작업 흐름](workflow.md)
- [좋은 예시와 금지 예시](examples.md)

## 출처

- [원본 · .agents/data/API_CONTRACT.md](../sources/api-contract.md)
- [원본 · .agents/data/DOMAIN_MODEL.md](../sources/domain-model.md)
