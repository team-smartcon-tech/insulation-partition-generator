# woomi-coding-agent-template

Woomi의 바이브 코딩 프로젝트를 같은 기준으로 시작하기 위한 **AI 에이전트 표준 템플릿**입니다.

이 저장소는 특정 제품 코드가 아니라, 새 웹 서비스 프로젝트를 만들 때 복사해 가는 규칙, 문서, 프롬프트, 스킬, 훅 묶음입니다.

- 표준 버전: `2.0-draft`
- 최종 수정일: 2026-05-28
- 기준 레퍼런스: CTPA Hono Worker layered architecture
- 기본 대상: React Router v7 + Hono/Cloudflare Worker + Supabase PostgreSQL 프로젝트

---

## 목적

- 프로젝트마다 코드 구조와 품질 기준이 흔들리는 문제를 줄입니다.
- AI 에이전트가 임의 패턴으로 코드를 생성하는 것을 막습니다.
- 비개발자, 개발자, AI 에이전트가 같은 문서를 보고 작업하게 합니다.
- 아키텍처, 기술스택, 워크플로우, 배포, DB 변경 기준을 프로젝트 시작 시점부터 고정합니다.

---

## 핵심 원칙

`AGENTS.md`가 1차 소스입니다.

Claude Code, Codex, GitHub Copilot 전용 문서와 명령은 모두 `AGENTS.md`와 `.agents/` 하위 문서를 보조합니다. 도구별 문서에만 중요한 규칙을 숨기지 않습니다.

표준 제공 문서는 고정된 절대 규칙이 아니라 **새 프로젝트의 출발 템플릿**입니다. 프로젝트에 적용할 때는 실제 코드, 프레임워크, 배포 방식, API 계약, 디자인 시스템을 확인한 뒤 프로젝트에 맞게 수정해야 합니다.

---

## 문서 지도

| 파일 | 역할 |
|---|---|
| `AGENTS.md` | 모든 에이전트가 먼저 읽는 공통 진입 규칙 |
| `CLAUDE.md` | Claude Code 전용 보충 규칙 |
| `CODEX.md` | Codex 전용 보충 규칙 |
| `.agents/ARCHITECTURE.md` | 표준 아키텍처와 레이어 경계 |
| `.agents/STACK.md` | 표준 기술스택 |
| `.agents/WORKFLOW.md` | 작업, PR, push, 리뷰 흐름 |
| `.agents/DEPLOYMENT.md` | Cloudflare/Wrangler/GitHub Actions 배포 기준 |
| `.agents/TOOLING.md` | MCP, 브라우저 자동화, 외부 도구 사용 기준 |
| `.agents/code/*` | 코드 구조, API, 테스트, 에러 처리 기준 |
| `.agents/data/*` | 도메인 모델, DB schema, API 계약, migration 기록 |
| `.agents/ui/*` | 디자인, UX, 컴포넌트 기준 |
| `.agents/examples/*` | 좋은 예시와 금지 예시 |
| `.userdocs/*` | 템플릿 설계 과정에서 만든 참고 문서. 모든 프로젝트에 반드시 복사할 필요는 없음 |

---

## 디렉토리 구조

```txt
.
├── AGENTS.md
├── CLAUDE.md
├── CODEX.md
├── .agents/
│   ├── ARCHITECTURE.md
│   ├── STACK.md
│   ├── WORKFLOW.md
│   ├── DEPLOYMENT.md
│   ├── TOOLING.md
│   ├── code/
│   ├── data/
│   ├── ui/
│   └── examples/
├── .claude/
│   ├── commands/
│   ├── skills/
│   └── settings.json
├── .codex/
│   ├── prompts/
│   ├── skills/
│   └── hooks.json
├── .github/
│   ├── prompts/
│   └── instructions/
├── .githooks/
└── .userdocs/              # 참고 문서와 설계 기록
```

---

## 새 프로젝트에 적용하는 방법

> **비개발자라면 먼저 [`QUICKSTART.md`](./QUICKSTART.md)를 보세요.** 복사-붙여넣기 한 번으로 AI가 온보딩을 주도하는 프롬프트 2종(기존 프로젝트 적용 / 새 프로젝트 시작)이 들어 있습니다. 아래는 직접 단계를 밟고 싶은 경우의 설명입니다.

1. 이 저장소를 복사하거나 템플릿으로 새 프로젝트를 시작합니다.
2. `AGENTS.md`의 `Project Overview`를 채웁니다.
3. `.agents/STACK.md`에서 실제 기술스택과 다른 부분을 수정합니다.
4. `.agents/ARCHITECTURE.md`에서 실제 앱/Worker/도메인 구조를 수정합니다.
5. `.agents/code/*`, `.agents/ui/*` 문서를 실제 프로젝트 규칙에 맞게 조정합니다.
6. `.agents/data/*`, `.agents/examples/*`는 실제 구현이 생기면서 채웁니다.
7. Git hook을 사용할 경우 아래를 실행합니다.

```bash
git config core.hooksPath .githooks
```

Windows에서도 Git Bash 또는 WSL을 쓰면 같은 명령을 사용할 수 있습니다.

Windows PowerShell에서 한국어 문서를 확인할 때는 UTF-8 인코딩을 명시합니다.

```powershell
Get-Content -Raw -Encoding UTF8 AGENTS.md
Get-Content -Raw -Encoding UTF8 .agents\WORKFLOW.md
```

---

## 에이전트 읽기 순서

작업 전 기본 순서:

1. `AGENTS.md`
2. `AGENTS.md`의 `Task Routing` 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서만 확인
4. 실제 코드와 설정 파일 확인
5. 해당 도구의 command/prompt/skill 확인

`WORKFLOW.md`는 모든 작업의 상시 필독 문서가 아니라, 큰 기능, PR/push, 리뷰, 배포, DB/API 계약 변경처럼 절차가 중요한 작업에서 읽습니다.

도구별 추가 문서:

- Claude Code: `CLAUDE.md`, `.claude/commands/`, `.claude/skills/`
- Codex: `CODEX.md`, `.codex/prompts/`, `.codex/skills/`
- GitHub Copilot: `.github/prompts/`, `.github/instructions/`

---

## 하네스 계층

이 템플릿은 AI 에이전트가 안전하게 반복 작업을 수행하도록 4계층 하네스를 둡니다.

| 계층 | 역할 | 위치 |
|---|---|---|
| Commands/Prompts | 반복 작업 명령 | `.claude/commands/`, `.codex/prompts/`, `.github/prompts/` |
| Skills | 복잡 작업 체크리스트 | `.claude/skills/`, `.codex/skills/`, `.github/instructions/` |
| Rules | 공통 규칙 | `AGENTS.md`, `.agents/` |
| Hooks | 위험 행동 차단 | `.claude/settings.json`, `.codex/hooks.json`, `.githooks/` |

---

## 절대 금지

- 실제 secret이 들어간 `.env` 커밋
- service role key 프론트엔드 노출
- 사용자 승인 없는 자동 배포
- 사용자 승인 없는 `git commit`, `git push`, `git pull`
- 운영 DB destructive migration 자동 실행
- 템플릿 규칙을 실제 프로젝트 코드보다 우선해 강제 적용

---

## 운영 방식

이 템플릿은 한 번 작성하고 끝나는 문서가 아닙니다.

프로젝트에서 반복 실수가 발견되면 `.agents/examples/BAD_EXAMPLES.md`에 남기고, 좋은 패턴이 굳어지면 `.agents/examples/GOOD_EXAMPLES.md`에 남깁니다. 스택, 배포, DB, API 계약이 바뀌면 관련 `.agents/*` 문서를 같은 작업에서 갱신합니다.
