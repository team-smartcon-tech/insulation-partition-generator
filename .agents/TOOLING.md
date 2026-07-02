# TOOLING.md

이 문서는 Woomi 바이브코딩 프로젝트에서 AI 에이전트가 MCP, 브라우저 자동화, 문서/스프레드시트 도구, 외부 API 같은 도구를 사용할 때의 기준을 정의한다.

MCP는 프로젝트 아키텍처가 아니라 **에이전트가 외부 도구와 데이터에 접근하는 방식**이다. 따라서 모든 프로젝트가 같은 MCP 서버를 가져야 하는 것은 아니며, 프로젝트별로 필요한 도구만 연결한다.

---

## 1. Basic Principles

- 도구를 쓰기 전에 어떤 데이터에 접근하는지 확인한다.
- read-only 조회와 write/delete/deploy 작업을 구분한다.
- 사용자 승인 없이 production 데이터, secret, 결제, 배포, 운영 DB를 변경하지 않는다.
- 도구 결과가 실제 코드나 설정과 충돌하면 실제 코드와 설정을 우선한다.
- 도구가 실패하면 임의 추측으로 결과를 확정하지 않고 실패 이유를 보고한다.

---

## 2. When To Use MCP

MCP 또는 외부 도구는 아래 상황에서 사용한다.

| 상황 | 예 |
|---|---|
| 프로젝트 외부 데이터 조회 | Supabase, Google Calendar, Jira, Notion, GitHub |
| 로컬 앱 검증 | 브라우저 자동화, screenshot, interaction check |
| 문서 산출물 생성 | docx, pptx, spreadsheet |
| 운영 도구 확인 | Cloudflare, deployment status, logs |
| 반복 작업 자동화 | PR 확인, schema inspection, migration review |

단순 코드 수정, 문구 수정, 명확한 단일 파일 변경은 MCP 사용을 강제하지 않는다.

---

## 3. Approval Boundary

사용자 승인 없이 가능한 작업:

- read-only 조회
- 로컬 파일 분석
- 로컬 테스트 실행
- 로컬 브라우저 검증
- 문서 초안 생성

사용자 승인 없이 금지:

- `git commit`, `git push`, `git pull`
- production 배포
- 운영 DB 변경
- 운영 secret 변경
- 외부 서비스 데이터 생성/수정/삭제
- 결제, 알림 발송, 고객 데이터 변경
- destructive filesystem command

프로젝트별 도구가 자체 승인 UI를 제공하더라도, 이 문서와 `AGENTS.md`의 금지 규칙을 우선한다.

---

## 4. Secret And Privacy

- MCP 설정 파일에 실제 secret을 커밋하지 않는다.
- access token, service role key, private key, cookie, session 값을 대화나 문서에 노출하지 않는다.
- 외부 도구 응답에 민감 정보가 포함되면 필요한 최소 내용만 요약한다.
- 사용자 데이터, 고객 데이터, 운영 로그를 예시 데이터처럼 재사용하지 않는다.
- screenshot이나 문서 산출물에 민감 정보가 보이면 마스킹하거나 사용자에게 알린다.

---

## 5. Project Setup Notes

프로젝트에서 MCP나 외부 도구를 실제로 사용한다면 아래 내용을 프로젝트 문서에 남긴다.

```txt
Tool name:
Purpose:
Read scope:
Write scope:
Required secrets:
Approval needed for:
Owner:
Fallback when unavailable:
```

설정 위치 예:

```txt
.claude/settings.json
.codex/hooks.json
.github/instructions/
.agents/TOOLING.md Project Override
```

도구별 설정 방식은 다르므로, 공통 규칙은 이 문서에 두고 실제 연결 방법은 도구별 문서에 둔다.

---

## 6. Browser And Visual Verification

로컬 웹앱이나 UI 변경을 검증할 때 브라우저 도구를 사용할 수 있다.

- 화면이 실제로 렌더링되는지 확인한다.
- 주요 버튼, 입력, navigation이 동작하는지 확인한다.
- desktop/mobile viewport에서 layout 깨짐을 확인한다.
- screenshot을 찍었다면 민감 정보가 포함되지 않았는지 확인한다.

브라우저 검증은 UI 작업의 품질을 높이기 위한 도구이며, 모든 작은 문구 수정에 강제하지 않는다.

---

## 7. Reporting

도구를 사용한 작업의 최종 보고에는 필요한 경우 아래를 포함한다.

```txt
Tools used:
Read-only or write:
External data touched:
Approval required:
Validation result:
Tool failures:
```

도구를 사용하지 못했거나 사용할 필요가 없었던 경우도 짧게 이유를 적는다.

