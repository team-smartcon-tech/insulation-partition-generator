---
type: rule
updated: 2026-08-19
tags: [area/프로세스]
---

# 바이브코딩 가이드

비개발자가 이 저장소를 복사해 자기 프로젝트의 AI 코딩 템플릿으로 쓰기 위한 운영 가이드. 세 도구가 같은 규칙을 읽고 같은 방향으로 움직이게 한다.

## 도입 순서

템플릿을 도입할 때 `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.agents/`, `.claude/`, `.codex/`, `.github/`, `.githooks/`를 루트에 복사하고 `git config core.hooksPath .githooks`로 훅을 건다.

AI가 온보딩 전체를 주도하게 하려면 루트 `QUICKSTART.md`의 프롬프트 A(기존 프로젝트)/B(새 프로젝트)를 붙여넣고, Claude Code에서는 `/onboard`를 쓴다.

복사 뒤 문서를 정해진 순서로 내 프로젝트에 맞춘다: `README.md` → `AGENTS.md` → [기술 스택](stack.md) → [계층 아키텍처](layered-architecture.md) → [디자인 원칙](design-principles.md) → [프로젝트 구조](project-structure.md). 완벽하지 않아도 비워두지 말고 아는 만큼 적는다.

## 세 도구의 역할

- **Codex** — 저장소 전체를 읽고 계획·구현·검증.
- **GitHub Copilot** — VS Code 안에서 현재 파일 소규모 수정.
- **Claude Code** — 명령·스킬·훅으로 반복 작업 처리(`/new-feature`, `/new-api`, `/review-pr`, `/commit`). 처음 오는 사람은 `/onboard` — 환경 확인부터 첫 커밋 1개까지 데려간다. 종료 조건이 로컬 커밋이고 원격 저장소·PR은 그 뒤 안내인 이유는, GitHub 계정 만들기를 온보딩 안으로 끌어들이지 않기 위해서다. Codex·Copilot에는 없는 명령이다.

## 운영 4계층

일을 네 계층으로 나눈다. **Commands**(반복 절차), **Skills**(체크리스트가 필요한 복잡 작업), **Rules**(항상 적용되는 기준), **Hooks**(막아야 할 위험 행동). 이 위키의 네 명령(`/wiki-add-source` 등)과 `/onboard`도 같은 Commands 계층이다 — [팀 위키](team-wiki.md).

## DB를 AI가 직접 확인하게 하기 (선택)

Supabase를 쓰는 프로젝트라면 Supabase MCP를 연결해 AI가 실제 DB 구조를 읽어 문서와 대조하게 할 수 있다. 명령 한 줄 + 브라우저 로그인이고, 비밀키를 어디에도 붙여넣지 않으며, 읽기 전용·개발 프로젝트 한정이다 — [도구 사용 기준](tooling.md).

## 비개발자 작업 루프

사람 말로 적기 → 구현 대신 계획 먼저 요청 → 작은 단위 구현 → 직접 확인 → 구체적으로 지적해 재수정 → 배운 규칙을 `.agents/*`에 남기기.

## 지킬 것

- 공통 규칙은 `CLAUDE.md`에만 두지 않는다. 반드시 `AGENTS.md`나 `.agents/*`에도 남긴다.
- `/revise-claude-md`의 제안을 자동으로 다 반영하지 않고 diff로 확인한 뒤 승인한다.
- "알아서 만들어줘"로 맡기지 않고, 어떤 사용자가·어떤 상황에서·무엇을 할 수 있어야 하는지 명시한다(범위를 준다).

## 함께 보기

- [진입 규칙](agents-entry.md)
- [작업 흐름](workflow.md)
- [디자인 원칙](design-principles.md)
- [팀 위키](team-wiki.md)

## 출처

- [원본 · .agents/VIBE_CODING_GUIDE.md](../sources/vibe-coding-guide.md)
