# CODEX.md

이 문서는 Codex 전용 보충 규칙이다.

공통 규칙의 1차 소스는 항상 [`AGENTS.md`](./AGENTS.md)다. Codex 전용 문서는 `AGENTS.md`와 `.agents/` 문서를 대체하지 않는다.

---

## 1. Reading Order

Codex는 작업 시작 전 아래 순서로 확인한다.

1. [`AGENTS.md`](./AGENTS.md)
2. `AGENTS.md`의 `Task Routing` 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서만 확인
4. 실제 코드와 설정 파일 확인
5. 해당 작업에 맞는 `.codex/prompts/` 또는 `.codex/skills/`

표준 제공 문서는 템플릿이다. 기존 프로젝트에 적용할 때는 실제 코드와 설정을 먼저 확인하고 프로젝트에 맞게 수정한다.

`WORKFLOW.md`는 큰 기능, PR/push, 리뷰, 배포, DB/API 계약 변경처럼 절차가 중요한 작업에서 읽는다.

---

## 2. Codex Prompts

반복 작업은 `.codex/prompts/`를 우선 확인한다.

```txt
.codex/prompts/new-feature.md
.codex/prompts/new-api.md
.codex/prompts/review-pr.md
.codex/prompts/commit.md
```

프롬프트 문서가 오래되었거나 `AGENTS.md`와 충돌하면 `AGENTS.md`를 우선하고, 프롬프트 문서 갱신을 제안한다.

---

## 3. Codex Skills

복잡한 작업은 `.codex/skills/`를 확인한다.

```txt
.codex/skills/component-generator/
.codex/skills/db-migration/
```

DB, Supabase, migration, 배포, 보안 작업은 관련 `.agents/data/*`, `.agents/DEPLOYMENT.md`를 함께 확인한다.

---

## 4. Hooks

Codex hooks는 [`.codex/hooks.json`](./.codex/hooks.json)에 정의한다.

`Bash` 매처의 `main` 직접 push 차단은 동작이 확인되었다. 반면 **`Write`/`Edit` 매처의 민감 파일 차단은 Codex 버전에 따라 발화가 보장되지 않는다.** 없는 보호를 있다고 가정하지 말고, Codex 를 쓸 때는 아래 git hook 활성화를 필수로 본다.

Git hook은 도구와 무관하게 Git 레벨에서 동작한다. 프로젝트 루트에서 실행한다.

```bash
git config core.hooksPath .githooks
```

---

## 5. Work Rules

`git` 작업의 승인 경계는 `AGENTS.md` 6장(Non-Negotiable Rules)의 "git 작업 경계"를 따른다. 저장소 안에서 끝나는 작업(`git init`, 브랜치 생성, `git add`, `git commit`)은 사전 승인, 밖으로 나가는 작업(`git push`, `git pull`, PR 생성, 원격 저장소 생성)은 되돌리기 어렵다는 사실을 알린 뒤 진행한다.

Codex는 다음을 사용자 승인 없이 수행하지 않는다.

- production 배포
- 운영 DB 변경
- destructive filesystem command
- 사용자 변경사항 되돌리기

PR, push, 배포 작업은 `.agents/WORKFLOW.md`와 `.agents/DEPLOYMENT.md`를 따른다.

---

## 6. Editing Rules

파일 수정은 기존 프로젝트 패턴을 우선한다.

수동 코드 수정은 patch 기반으로 작게 수행하고, 관련 없는 리팩터링을 섞지 않는다.

문서와 코드가 충돌하면 실제 코드와 가까운 하위 `AGENTS.md`를 우선한다. 단, 보안, 배포, 데이터 손실 관련 금지 규칙은 완화하지 않는다.

---

## 7. Updating Rules

Codex 전용 규칙만 바꾸지 않는다.

공통으로 적용되어야 하는 규칙은 반드시 아래 중 하나에 반영한다.

- `AGENTS.md`
- `.agents/ARCHITECTURE.md`
- `.agents/STACK.md`
- `.agents/WORKFLOW.md`
- 작업 유형별 `.agents/*` 문서

그래야 Claude Code, Codex, GitHub Copilot이 같은 기준으로 작업한다.

저장소의 규칙·문서·스캐폴드·훅을 바꾸면 같은 작업에서 `CHANGELOG.md`에 항목을 추가하고 `AGENTS.md`·`README.md`의 표준 버전과 최종 수정일을 갱신한다. 기준은 `AGENTS.md` 10장(Versioning & Changelog)을 따른다.
