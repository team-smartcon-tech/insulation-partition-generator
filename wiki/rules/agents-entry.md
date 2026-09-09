---
type: rule
updated: 2026-08-19
tags: [area/규칙, area/프로세스]
---

# 진입 규칙

모든 AI 에이전트가 이 저장소에서 일을 시작할 때 가장 먼저 읽는 공통 규칙. 작업 유형을 분류하고 필요한 문서로만 라우팅한다.

## 무엇인가

`AGENTS.md`는 구현 방법을 길게 설명하지 않는다. 작업을 분류하고, 필요한 `.agents/*` 문서로 보내며, 보안·배포·데이터 손실 금지 규칙만 직접 가진다. 기준 레퍼런스는 CTPA Hono Worker 계층 아키텍처다.

## 읽는 순서

작은 작업에서 모든 문서를 읽지 않는다. 기본 순서는 이렇다.

1. `AGENTS.md`
2. Task Routing 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서만 확인
4. 실제 코드와 설정 파일 확인
5. 해당 도구의 command/prompt/skill 확인

`WORKFLOW.md`는 상시 필독이 아니라, 큰 기능·PR/push·리뷰·배포·DB/API 계약 변경처럼 절차가 중요할 때 읽는다.

## Task Routing (요약)

작업 유형별로 먼저 읽을 문서가 정해져 있다. 예: 새 화면은 [디자인 원칙](design-principles.md)·[UX 규칙](ux-rules.md)·[공통 컴포넌트](components.md), API/백엔드는 [API 계층 규칙](api-layers.md)·[에러 처리](error-handling.md)·[계층 아키텍처](layered-architecture.md), DB는 [DB 스키마 가드레일](db-schema-guardrails.md)·[마이그레이션](migration.md), 배포는 [배포](deployment.md).

## 충돌이 나면

문서가 서로 어긋나면 우선순위는 ① 실제 코드·설정 → ② 가장 가까운 하위 `AGENTS.md` → ③ 프로젝트 Override → ④ 루트 `AGENTS.md` → ⑤ 작업별 `.agents/*` → ⑥ 도구별 문서 → ⑦ 예시 순이다. 단, 보안·배포·데이터 손실 금지 규칙은 프로젝트 문서로 완화할 수 없다.

## 이 프로젝트에서 정한 것

- **도구별 문서(`CLAUDE.md` 등)에는 `AGENTS.md`와 겹치는 규칙을 두지 않고 포인터만 둔다.** 근거 규칙은 `AGENTS.md` §5("도구별 문서에는 공통 규칙을 숨기지 않는다. 공통 규칙은 `AGENTS.md` 또는 `.agents/*`에 반영한다"). 이를 적용해 `CLAUDE.md`를 경량화했고, 읽는 순서·작업 라우팅·승인 금지·충돌 우선순위·버전 규칙은 §1·§2·§6·§8·§10을 가리키게 했다. 섹션 참조는 번호와 제목을 함께 적어 재번호에 견디게 했다.
- **위키를 능동적으로 쓴다.** 읽는 순서(§1)에 "`wiki/`가 있으면 작업 전 위키를 찾고, 남길 것이 생기면 먼저 남기자고 제안한다"가 들어갔다 — [팀 위키](team-wiki.md).

출처: 인용한 규칙 자체는 [원본 · AGENTS.md](../sources/agents-md.md)(§5, §1). **적용 결과(무엇을 어떻게 경량화했나)는 `AGENTS.md`에 없다** — 근거는 루트 [`CLAUDE.md`](../../CLAUDE.md)의 실제 구성과 [기록](../log.md) 2026-08-13·2026-08-14 항목이다.

## 왜 중요한가

컨텍스트가 정확할수록 결과가 좋다. 필요한 문서만 읽게 라우팅하는 것이 이 저장소의 첫 번째 장치다. 이 위키도 같은 이유로 존재한다 — [팀 위키](team-wiki.md).

## 함께 보기

- [절대 금지·필수 규칙](non-negotiable-rules.md)
- [작업 흐름](workflow.md)
- [바이브코딩 가이드](vibe-coding-guide.md)
- [팀 위키](team-wiki.md)
- [프로젝트 구조](project-structure.md)
- [NestJS 프로젝트 규칙](nestjs.md)
- [좋은 예시와 금지 예시](examples.md)

## 출처

- [원본 · AGENTS.md](../sources/agents-md.md)
