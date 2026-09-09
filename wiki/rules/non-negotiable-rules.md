---
type: rule
updated: 2026-08-19
tags: [area/규칙, area/보안]
---

# 절대 금지·필수 규칙

프로젝트 사정과 무관하게 완화할 수 없는 보안·배포·데이터 손실 규칙. 문서 충돌 우선순위에서도 이 규칙만은 예외 없이 이긴다.

## 절대 금지

- API key, service role key, JWT secret 하드코딩
- 실제 값이 들어간 `.env` 커밋
- 프론트엔드에 서버 secret 노출
- 인증 없이 private storage URL 발급
- 안전 훅이나 보호 규칙을 우회하는 옵션(`--no-verify`, `-n`, `--force`)을 붙인 commit/push
- 사용자 승인 없는 production 배포
- 사용자 승인 없는 운영 DB 변경
- 사용자 승인 없는 destructive migration
- 사용자 승인 없는 운영 secret 변경
- 사용자 승인 없는 외부 서비스 데이터 생성/수정/삭제 — 결제, 알림 발송, 고객 데이터 변경 포함
- destructive filesystem command
- secret 값을 대화, 보고, 문서에 출력
- `git reset --hard` 또는 사용자 변경사항 되돌리기
- 템플릿 규칙을 실제 프로젝트 코드보다 우선해 기계적으로 강제

## 필수

- **git 작업 경계.** 저장소 안에서 끝나는 작업(`git init`, 브랜치 생성, `git add`, `git commit`)은 사전 승인된 것으로 보고 매번 묻지 않는다. 저장소 밖으로 나가는 작업(`git push`, `git pull`, PR 생성, 원격 저장소 생성)은 되돌리기 어렵다는 사실을 한 줄로 알린 뒤 진행한다 — [작업 흐름](workflow.md).
- secret은 환경변수 또는 platform secret으로 관리한다.
- MCP와 외부 도구는 read-only 조회와 write/delete/deploy 작업을 구분해서 사용한다 — [도구 사용 기준](tooling.md).
- 파일 업로드는 확장자, MIME, 크기, 권한을 검증한다.
- DB/API/배포 변경은 관련 `.agents/*` 문서를 함께 갱신한다.
- 반복되는 UX 패턴이나 공통 화면 정책이 생기면 `.agents/ui/UX_RULES.md` 또는 프로젝트별 UX 문서에 기록한다 — [UX 규칙](ux-rules.md).
- 검증하지 못한 항목은 최종 보고에 명시한다 — [테스트와 검증](testing.md).

## 왜 중요한가

이 규칙들은 되돌릴 수 없는 실수(secret 유출, 운영 데이터 손실, 승인 없는 배포)를 막는 마지막 방어선이다. 프로젝트별 Override로도 완화할 수 없다는 점이 다른 모든 규칙과의 차이다.

## 함께 보기

- [진입 규칙](agents-entry.md)
- [작업 흐름](workflow.md)
- [배포](deployment.md)
- [도구 사용 기준](tooling.md)
- [마이그레이션](migration.md)
- [코드 스타일](code-style.md)
- [DB 스키마 가드레일](db-schema-guardrails.md)
- [UX 규칙](ux-rules.md)

## 출처

- [원본 · AGENTS.md](../sources/agents-md.md)
