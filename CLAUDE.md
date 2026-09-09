# CLAUDE.md

Claude Code 전용 보충 규칙. 공통 규칙의 1차 소스는 [`AGENTS.md`](./AGENTS.md)다.

읽는 순서(§1 How To Read), 작업 라우팅(§2 Task Routing), 승인 없는 작업 금지(§6 Non-Negotiable Rules), 충돌 우선순위(§8 Conflict Resolution Priority), 버전·CHANGELOG(§10 Versioning & Changelog)는 `AGENTS.md`를 따른다. 이 문서는 그것을 다시 쓰지 않고, **Claude Code에만 있는 것**만 담는다.

---

## Commands & Skills

반복 작업은 [`.claude/commands/`](./.claude/commands/), 복잡한 작업은 [`.claude/skills/`](./.claude/skills/)를 먼저 확인한다. 목록은 디렉터리에서 직접 본다. 명령 문서가 `AGENTS.md`와 충돌하면 `AGENTS.md`가 이기고, 명령 문서 갱신을 제안한다.

**이 저장소를 처음 여는 사람에게는 `/onboard`를 먼저 안내한다.** 사용자가 "이게 뭐하는 폴더냐", "뭐부터 해야 하냐", "어떻게 쓰는 거냐" 같은 첫 질문을 하면, 문서를 읽으라고 넘기지 말고 `/onboard`로 유도한다. 환경 설정부터 첫 커밋까지 데려간다.

---

## Hooks

Claude Code hooks는 [`.claude/settings.json`](./.claude/settings.json)에 정의하고, 판정 로직은 [`scripts/agent-guard.cjs`](./scripts/agent-guard.cjs)에 있다. `node scripts/agent-guard.cjs --selftest`로 규칙을 확인한다.

Git hook은 도구와 무관하게 Git 레벨에서 동작한다. 프로젝트 루트에서 활성화한다.

```bash
git config core.hooksPath .githooks
```

---

## Claude 전용 안전 규칙

`.claude/settings.local.json`에 `git`, `wrangler`, `supabase`, `deploy` 계열 명령을 allowlist로 추가하지 않는다. 이 파일은 `.gitignore` 대상이라 `AGENTS.md` §6(Non-Negotiable Rules) 승인 규칙이 조용히 사전 승인되고 PR 리뷰에도 보이지 않는다.

금지 이유가 "리뷰에 보이지 않는 곳에서 승인이 사라지는 것"이므로, **git에 추적되는 [`.claude/settings.json`](./.claude/settings.json)의 `permissions.allow`에 명시적으로 넣는 것은 여기 해당하지 않는다.** 등재 대상은 `AGENTS.md` §6이 사전 승인으로 규정한 로컬 git 작업과 읽기 전용 조회뿐이다.

**등재 규칙은 접두사 매칭이므로 플래그까지 좁혀서 쓴다.** `Bash(git config core.hooksPath:*)` 같은 넓은 규칙은 `git config core.hooksPath /dev/null`을 함께 허용해 `.githooks/` 안전장치를 프롬프트 없이 끌 수 있다. 같은 이유로 아래는 좁혀 두었다.

| 쓰지 않는 규칙 | 이유 | 대신 쓰는 것 |
|---|---|---|
| `git config core.hooksPath:*` | 훅 경로를 딴 데로 돌려 안전장치를 끌 수 있다 | `git config core.hooksPath .githooks` (완전 일치) |
| `git switch:*` | `--discard-changes`가 미커밋 작업을 지운다 | `git switch -c:*` (새 브랜치 생성만) |
| `git branch:*` | `-D`가 머지 안 된 브랜치를 지운다 | `git branch --show-current`, `--list` |
| `git remote:*` | `add`·`set-url`이 푸시 목적지를 바꾼다 | `git remote -v`, `get-url` |

`git push`, `gh repo create`, `gh pr create`도 **의도적으로 뺐다** — 저장소 밖으로 나가는 작업의 권한 프롬프트가 §6이 요구하는 마지막 확인 지점이다. 여기에 추가할 때는 그 규칙이 어떤 플래그까지 함께 허용하는지 먼저 따지고, PR에서 그 사실이 보이는지 확인한다.

---

## 규칙을 바꿀 때

공통으로 적용될 규칙은 이 문서가 아니라 `AGENTS.md`·`.agents/*`에 반영한다. 그래야 Claude Code, Codex, Copilot이 같은 기준으로 일한다. 저장소의 규칙·문서·스캐폴드·훅을 바꾸면 `AGENTS.md` §10(Versioning & Changelog)에 따라 `CHANGELOG.md`와 표준 버전·최종 수정일을 갱신한다.
