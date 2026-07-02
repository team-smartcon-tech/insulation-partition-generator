---
name: harness-engineering
description: AI 에이전트가 자율 동작 시 안전하고 일관되게 작동하도록 '하네스(안전장치)'를 구축하는 가이드. Commands → Skills → Rules → Hooks 순서로 점진적으로 쌓아 올린다. 에이전트 환경을 설계·구성하거나 보안/일관성 문제를 다룰 때 사용.
---

# Harness Engineering

AI 엔지니어링 패턴은 **프롬프트 → 컨텍스트 → 하네스** 엔지니어링으로 진화했다.
하네스 엔지니어링은 에이전트가 의도치 않은 방향으로 튀거나 보안 위험을 만들지 않도록 **환경 자체를 설계**하는 작업이다.

## 진화 단계 요약

| 시기 | 패턴 | 핵심 기법 |
|---|---|---|
| 2022~2023 | 프롬프트 엔지니어링 | Persona, CoT, ReAct |
| 2023~2024 | 컨텍스트 엔지니어링 | System Prompt, Chat History, RAG, MCP |
| 2025~ | 하네스 엔지니어링 | Commands, Rules, Skills, Hooks |

## 4대 핵심 요소

### 1. Commands — 프롬프트 템플릿
- 반복 작업을 슬래시 명령으로 박제 (`/commit`, `/review-pr` 등)
- 워크플로우를 미리 정의해 재사용성을 높인다.

### 2. Rules — 항상 참고하는 규칙
- `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `copilot-instructions.md` 등
- 코딩 컨벤션, 아키텍처, 금기 사항을 문서화해 일관성 유지.

### 3. Skills — 패키지화된 능력
- 단순 프롬프트 + 예시 + 스크립트 + 참고 문서를 한 디렉토리에 묶음.
- 특정 시나리오용 고도화된 작업을 호출 한 번으로 수행.

### 4. Hooks — 프로그래밍 강제 장치
AI 판단에 맡기지 않고 코드로 동작을 강제한다. 두 가지 용도:
- **Protection**: 민감 파일 접근 차단, `main` 브랜치 직접 푸시 금지, 시크릿 파일 커밋 차단.
- **Reminder**: TDD 절차 미준수 시 경고, 린트 실패 시 차단, 컨벤션 위반 알림.

## 구축 순서 (권장)

처음부터 완벽한 시스템을 만들지 말고 **작게 시작해 점진적으로 확장**한다:

```
Commands → Skills → Rules → Hooks
```

1. 자주 반복되는 작업을 Command로 박제
2. 복잡한 작업은 Skill로 패키지화
3. 반복적으로 강조하던 가이드는 Rule로 승격
4. AI가 계속 어기는 규칙은 Hook으로 강제

## 핵심 원칙

- **맞춤형 우선**: 기성 프레임워크를 그대로 쓰지 말고 팀/개인 워크플로우에 맞춰 만든다.
- **점진적 구축**: 한 번에 큰 시스템을 설계하지 않는다.
- **AI 판단 vs 강제**: 일관성이 중요하면 Hook, 유연성이 중요하면 Rule/Skill.
- **에이전트 환경 구축이 곧 본업**: 코드를 직접 짜기보다, 에이전트가 잘 작동할 환경을 만드는 것이 핵심 업무가 됨.

## 도구별 매핑

| 요소 | Claude Code | Codex CLI | GitHub Copilot |
|---|---|---|---|
| Commands | `~/.claude/commands/*.md` | `~/.codex/prompts/*.md` | `.github/prompts/*.prompt.md` |
| Rules | `CLAUDE.md` | `AGENTS.md` | `.github/copilot-instructions.md` |
| Skills | `~/.claude/skills/<n>/SKILL.md` | `~/.codex/skills/<n>/SKILL.md` | `.github/instructions/*.instructions.md` |
| Hooks | `settings.json` hooks | (제한적) | (Husky 등 git hooks) |

## 참고 영상
https://youtu.be/ryyEm2MKwtg
