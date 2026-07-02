# 하네스 엔지니어링 4계층을 템플릿에 도입 (실행 계획서)

> 이 문서는 **나중에 실행할 수 있도록** 각 파일의 초안 내용까지 포함한 상세 계획서다.
> 실행 시에는 아래 "실행 체크리스트" 순서대로 파일을 생성/수정하면 된다.

---

## 1. Context (왜 하는가)

`woomi-coding-agent-template` 저장소는 현재 **Rules 계층**(`AGENTS.md` + `.agents/`)만 갖춘 상태다. 하지만 `.userdocs/harness-engineering/SKILL.claude.md`가 제시하는 표준은 **Commands → Skills → Rules → Hooks** 4계층 하네스다. Rules만 있으면 "참고하라"는 지시만 가능하고, 반복 작업은 매번 새로 풀고, 시크릿 커밋·main 푸시 같은 위험 행동도 문서로만 막는다.

이 변경의 목적: **템플릿 자체가 4계층 하네스의 표준 스캐폴드**가 되게 한다. 다운스트림 프로젝트가 템플릿을 복사하면 슬래시 명령·스킬·훅까지 한 번에 따라가도록.

**지원 도구**: Claude Code(`.claude/`) + GitHub Copilot(`.github/`). Codex CLI는 범위 제외.

---

## 2. 최종 디렉토리 구조

```
.
├── AGENTS.md                       # (수정) 섹션 12 "Harness Layers" 추가
├── README.md                       # (수정) 하네스 계층 설명 추가
├── .gitignore                      # (수정) .claude/settings.local.json 제외
├── .agents/                        # (기존 Rules 본문, 변경 없음)
├── .userdocs/harness-engineering/  # (기존 가이드, 변경 없음)
├── .claude/                        # [신규] Claude Code 하네스
│   ├── commands/
│   │   ├── commit.md
│   │   ├── review-pr.md
│   │   ├── new-feature.md
│   │   └── new-api.md
│   ├── skills/
│   │   ├── db-migration/SKILL.md
│   │   └── component-generator/SKILL.md
│   └── settings.json
├── .github/                        # [신규] Copilot 하네스
│   ├── copilot-instructions.md
│   ├── prompts/
│   │   ├── commit.prompt.md
│   │   ├── review-pr.prompt.md
│   │   ├── new-feature.prompt.md
│   │   └── new-api.prompt.md
│   └── instructions/
│       ├── db-migration.instructions.md
│       └── component-generator.instructions.md
└── .githooks/                      # [신규] 도구 무관 Git 훅 (Protection)
    ├── README.md
    ├── pre-commit
    └── pre-push
```

---

## 3. 계층별 설계 근거

### Commands (4개)
팀이 반복하는 4개 작업만 박제(가이드의 "작게 시작" 원칙). 본문은 `.agents/` 문서로 **라우팅하는 포인터**이지, 규칙을 중복 서술하지 않는다.

| 명령 | 목적 | 참조 문서 |
|---|---|---|
| `/commit` | 변경사항 요약 → 컨벤션 메시지 → git commit | `.agents/code/CODE_STYLE.md` |
| `/review-pr` | PR diff 기반 코드 리뷰 | `CODE_STYLE.md`, `ARCHITECTURE.md` |
| `/new-feature` | 새 화면/기능 생성 | `AGENTS.md`의 `Task Routing` 중 `새 화면/UI` 또는 `프론트엔드 기능` + `.agents/ui/` |
| `/new-api` | 새 API 엔드포인트 구현 | `AGENTS.md`의 `Task Routing` 중 `API/백엔드` + `.agents/data/` |

### Skills (2개)
복잡한 체크리스트가 필요한 2개만 우선 제공. 나머지는 "반복 관찰 후 승격" 원칙.

- `db-migration` — 스키마 변경 시 `.agents/data/DB_SCHEMA.md` 갱신 → 마이그레이션 파일 → 롤백 플랜 순서 강제.
- `component-generator` — 공통 컴포넌트 생성 시 `.agents/ui/COMPONENTS.md` + `DESIGN.md` 체크리스트 기반.

### Rules (강화)
`AGENTS.md`에 **§12 "Harness Layers"** 섹션 추가. 새 규칙 문서는 만들지 않는다.

### Hooks (두 채널)

**Claude Code (`.claude/settings.json`)** — Protection + Reminder
- `PreToolUse` Write/Edit: `.env`, `*.pem`, `*secret*` 차단.
- `PreToolUse` Bash: `git push.*main` 패턴 차단.
- `PostToolUse` Edit on `.agents/`: 문서 갱신 리마인드.

**Git hooks (`.githooks/`, 도구 무관)**
- `pre-commit`: `.env` / 고엔트로피 문자열 검출.
- `pre-push`: `main` 브랜치 푸시 차단.
- 활성화: `git config core.hooksPath .githooks`.

---

## 4. 파일별 초안 내용

> 아래 내용들은 실행 시 **거의 그대로 복사**해서 쓰면 된다. 프로젝트별 세부는 TODO 주석으로 표시.

### 4.1 `.claude/commands/commit.md`

```markdown
---
description: 스테이징된 변경을 컨벤션에 맞춰 커밋한다
---

# /commit

1. `git status`와 `git diff --staged`로 변경사항을 확인한다.
2. `.agents/code/CODE_STYLE.md`의 커밋 메시지 컨벤션을 따른다.
3. 변경 "왜"를 1~2문장으로 요약한 제목 + 필요 시 본문으로 메시지 작성.
4. `.env`, 시크릿, 대용량 바이너리가 스테이징되어 있으면 중단하고 사용자에게 알린다.
5. `git commit` 실행. 훅 실패 시 원인을 수정하고 **새 커밋** 생성(amend 금지).
```

### 4.2 `.claude/commands/review-pr.md`

```markdown
---
description: 현재 브랜치의 PR diff를 리뷰한다
---

# /review-pr

1. `git diff $(git merge-base HEAD main)...HEAD`로 전체 변경 범위 확인.
2. `.agents/ARCHITECTURE.md`의 레이어 책임 위반이 없는지 검토.
3. `.agents/code/CODE_STYLE.md` 기준으로 네이밍·구조 위반 체크.
4. 테스트 커버리지, 에러 처리, 중복 구현 여부를 확인.
5. 리뷰 결과를 "Must fix / Nit / Question" 세 구간으로 요약.
```

### 4.3 `.claude/commands/new-feature.md`

```markdown
---
description: 새 화면/기능 생성 워크플로우
---

# /new-feature

`AGENTS.md`의 `Task Routing` 중 `새 화면/UI` 또는 `프론트엔드 기능`을 따라 진행한다:

1. `.agents/ARCHITECTURE.md` — 기능이 들어갈 레이어 확인.
2. `.agents/ui/DESIGN.md` — 디자인 시스템 확인.
3. `.agents/ui/COMPONENTS.md` — 재사용 가능한 컴포넌트 탐색.
4. `.agents/code/CODE_STYLE.md` — 파일 구조/네이밍 확인.
5. 기존 유사 기능을 먼저 찾아 패턴을 맞춘다. 없을 때만 신규 생성.
```

### 4.4 `.claude/commands/new-api.md`

```markdown
---
description: 새 API 엔드포인트 구현 워크플로우
---

# /new-api

`AGENTS.md`의 `Task Routing` 중 `API/백엔드`를 따라 진행한다:

1. `.agents/ARCHITECTURE.md` — 어느 서비스/레이어에 속하는지 확인.
2. `.agents/data/API_CONTRACT.md` — 요청/응답 스펙 정의 또는 참조.
3. `.agents/data/DOMAIN_MODEL.md` — 엔티티 관계 확인.
4. `.agents/data/DB_SCHEMA.md` — DB 변경 필요 여부 판단. 필요 시 `db-migration` 스킬 호출.
5. `.agents/code/CODE_STYLE.md` + `ERROR_HANDLING.md`로 구현.
```

### 4.5 `.claude/skills/db-migration/SKILL.md`

```markdown
---
name: db-migration
description: DB 스키마 변경을 문서·마이그레이션·롤백 세 단계로 안전하게 수행한다. 스키마 변경, 컬럼 추가/삭제, 인덱스 수정 요청 시 사용.
---

# DB Migration Skill

## 수행 순서 (필수)

1. **문서 갱신** — `.agents/data/DB_SCHEMA.md`에 변경될 테이블/컬럼 반영.
2. **마이그레이션 파일 생성** — 프로젝트 규칙에 맞는 위치/네이밍으로 생성.
3. **롤백 플랜 작성** — 마이그레이션 파일 상단 주석에 롤백 SQL 또는 절차 기록.

## 금지 사항

- 문서 없이 스키마 변경 금지 (`AGENTS.md`의 DB 라우팅 규칙과 `.agents/data/DB_SCHEMA.md`, `.agents/data/MIGRATION.md` 참고).
- NOT NULL 컬럼을 기본값 없이 대용량 테이블에 추가 금지.
- 운영 중인 컬럼 drop은 먼저 사용 여부를 grep으로 확인.

## 체크리스트

- [ ] `.agents/data/DB_SCHEMA.md` 갱신했는가
- [ ] 마이그레이션 파일에 롤백 절차가 있는가
- [ ] 기존 쿼리/ORM 코드가 영향받지 않는가
- [ ] 인덱스 변경이 필요한가
```

### 4.6 `.claude/skills/component-generator/SKILL.md`

```markdown
---
name: component-generator
description: 공통 UI 컴포넌트를 디자인 시스템과 재사용 규칙에 맞춰 생성한다. 새 컴포넌트, 공통 UI 블록, 재사용 위젯 요청 시 사용.
---

# Component Generator Skill

## 수행 순서 (필수)

1. **재사용 탐색** — `.agents/ui/COMPONENTS.md`에서 유사 컴포넌트가 이미 있는지 먼저 찾는다. 있으면 확장을 우선.
2. **디자인 규칙 확인** — `.agents/ui/DESIGN.md`의 색상·간격·타이포그래피 토큰만 사용.
3. **UX 규칙 확인** — `.agents/ui/UX_RULES.md`의 상태(로딩/에러/빈) 패턴 반영.
4. **위치 결정** — `.agents/code/PROJECT_STRUCTURE.md`의 컴포넌트 디렉토리 규칙 따름.
5. **Props/타입 정의** — 기존 컴포넌트의 Props 네이밍 패턴과 일관되게.

## 체크리스트

- [ ] 유사 컴포넌트를 먼저 검색했는가
- [ ] 디자인 토큰만 사용했는가 (하드코딩 색상/간격 없음)
- [ ] 로딩/에러/빈 상태가 정의되었는가
- [ ] 접근성(aria-*, 키보드)이 고려되었는가
```

### 4.7 `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=(i.tool_input&&i.tool_input.file_path)||'';if(/(^|[\\\\/])\\.env($|\\.)|\\.pem$|secret/i.test(p)){console.error('BLOCK: 민감 파일 수정 금지: '+p);process.exit(2);}\""
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));const c=(i.tool_input&&i.tool_input.command)||'';if(/git\\s+push[^|&;]*\\bmain\\b/.test(c)){console.error('BLOCK: main 브랜치 직접 푸시 금지');process.exit(2);}\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=(i.tool_input&&i.tool_input.file_path)||'';if(p.includes('.agents/')){console.log('REMINDER: .agents/ 문서를 변경했습니다. 관련 Command/Skill도 갱신이 필요한지 확인하세요.');}\""
          }
        ]
      }
    ]
  }
}
```

> 주의: 훅 스크립트는 Node가 설치된 환경 기준. Python/Bash로 바꿔도 무방.

### 4.8 `.github/copilot-instructions.md`

```markdown
# GitHub Copilot Instructions

이 저장소의 에이전트 규칙은 루트 `AGENTS.md`를 **1차 소스**로 삼는다.
Copilot은 작업 시작 전 반드시 다음 순서로 문서를 참고한다:

1. `AGENTS.md` (진입점)
2. `.agents/ARCHITECTURE.md`
3. 작업 유형별 문서 (`AGENTS.md`의 `Task Routing` 참고)

재사용 가능한 워크플로우는 `.github/prompts/*.prompt.md`,
시나리오별 스킬은 `.github/instructions/*.instructions.md`에 있다.
```

### 4.9 `.github/prompts/*.prompt.md` (4개)

Claude Commands 본문과 **동일 내용**을 복사하되 frontmatter만 Copilot 규격으로 바꾼다:

```markdown
---
mode: agent
description: 스테이징된 변경을 컨벤션에 맞춰 커밋한다
---

# /commit

(본문은 .claude/commands/commit.md와 동일)
```

`review-pr.prompt.md`, `new-feature.prompt.md`, `new-api.prompt.md`도 같은 방식.

### 4.10 `.github/instructions/*.instructions.md` (2개)

Skills 본문과 동일 내용. frontmatter에 `applyTo` glob 추가:

```markdown
---
description: DB 스키마 변경 워크플로우
applyTo: "**/migrations/**,**/.agents/data/**"
---

(본문은 .claude/skills/db-migration/SKILL.md와 동일)
```

```markdown
---
description: 공통 UI 컴포넌트 생성 워크플로우
applyTo: "**/components/**"
---

(본문은 .claude/skills/component-generator/SKILL.md와 동일)
```

### 4.11 `.githooks/pre-commit`

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1) .env 계열 파일 차단
if git diff --cached --name-only | grep -E '(^|/)\.env($|\.)' >/dev/null; then
  echo "ERROR: .env 파일은 커밋할 수 없습니다."
  exit 1
fi

# 2) 고엔트로피 시크릿 휴리스틱 (AWS, GitHub, 일반 토큰)
if git diff --cached -U0 | grep -E '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' >/dev/null; then
  echo "ERROR: 시크릿으로 보이는 문자열이 감지되었습니다."
  exit 1
fi

exit 0
```

### 4.12 `.githooks/pre-push`

```bash
#!/usr/bin/env bash
set -euo pipefail

protected_branch="main"
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"

if [ "$current_branch" = "$protected_branch" ]; then
  echo "ERROR: $protected_branch 브랜치 직접 푸시는 금지되어 있습니다. PR을 통해 병합하세요."
  exit 1
fi

exit 0
```

### 4.13 `.githooks/README.md`

```markdown
# Git Hooks

이 디렉토리의 훅은 **도구 무관**하게 Git 레벨에서 동작한다.

## 활성화

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
```

## 포함된 훅

- `pre-commit` — `.env`/시크릿 문자열 커밋 차단.
- `pre-push` — `main` 브랜치 직접 푸시 차단.
```

### 4.14 `AGENTS.md` §12 신규 섹션

`AGENTS.md` 맨 아래(§11 다음)에 추가:

```markdown
---

## 12. Harness Layers

이 저장소는 `.userdocs/harness-engineering/` 가이드를 따르는 4계층 하네스를 갖춘다.

| 계층 | 위치 | 언제 |
|---|---|---|
| Commands | `.claude/commands/`, `.github/prompts/` | 반복 워크플로우 실행 시 (`/commit`, `/new-feature` 등) |
| Skills | `.claude/skills/`, `.github/instructions/` | 복잡한 시나리오 수행 시 (`db-migration`, `component-generator`) |
| Rules | `AGENTS.md`, `.agents/` | 모든 작업의 기준선 |
| Hooks | `.claude/settings.json`, `.githooks/` | 위험 행동 자동 차단 |

**에이전트는 작업 시작 전, 해당하는 Command/Skill이 있는지 먼저 확인한다.**
```

§4 Agent Reading Order 맨 아래에 한 줄 추가:
```
4. 작업을 시작하기 전에 `.claude/commands/`, `.claude/skills/`에 해당 작업용 Command/Skill이 있는지 확인한다.
```

### 4.15 `README.md` 수정

"핵심 문서" 섹션 아래에 추가:

```markdown
## 하네스 계층 (Harness Layers)

이 템플릿은 `.userdocs/harness-engineering/` 가이드의 4계층 하네스를 기본 장착한다:

- **Commands** — `.claude/commands/`, `.github/prompts/`
- **Skills** — `.claude/skills/`, `.github/instructions/`
- **Rules** — `AGENTS.md`, `.agents/`
- **Hooks** — `.claude/settings.json`, `.githooks/`
```

"사용 방법 2) 프로젝트 맞춤값으로 초기 세팅" 말미에 추가:

```markdown
- Git 훅 활성화: `git config core.hooksPath .githooks && chmod +x .githooks/*`
```

### 4.16 `.gitignore` 수정

```
.claude/settings.local.json
```

한 줄 추가 (Claude Code가 사용자별 로컬 설정을 여기에 저장).

---

## 5. 실행 체크리스트 (순서대로)

실행 시점에 이 순서로 진행:

- [ ] `.claude/commands/` 디렉토리 생성 + 4개 파일 작성 (§4.1~4.4)
- [ ] `.claude/skills/db-migration/SKILL.md` 작성 (§4.5)
- [ ] `.claude/skills/component-generator/SKILL.md` 작성 (§4.6)
- [ ] `.claude/settings.json` 작성 (§4.7)
- [ ] `.github/copilot-instructions.md` 작성 (§4.8)
- [ ] `.github/prompts/` 4개 파일 작성 (§4.9)
- [ ] `.github/instructions/` 2개 파일 작성 (§4.10)
- [ ] `.githooks/pre-commit` 작성 + 실행 권한 (§4.11)
- [ ] `.githooks/pre-push` 작성 + 실행 권한 (§4.12)
- [ ] `.githooks/README.md` 작성 (§4.13)
- [ ] `AGENTS.md` §12 및 §4 한 줄 추가 (§4.14)
- [ ] `README.md` 두 섹션 추가 (§4.15)
- [ ] `.gitignore` 한 줄 추가 (§4.16)
- [ ] 검증 (§6) 수행

---

## 6. 검증 방법

1. **구조 확인**
   ```bash
   ls .claude/commands .claude/skills .github/prompts .github/instructions .githooks
   ```
   모든 디렉토리에 파일이 존재하는지.

2. **Claude Code 실제 호출**
   - 이 저장소를 Claude Code로 연다.
   - 슬래시 목록에 `/commit`, `/review-pr`, `/new-feature`, `/new-api`가 뜨는지.
   - 스킬 목록에 `db-migration`, `component-generator`가 뜨는지.

3. **Hook Protection 검증**
   - `echo 'SECRET=abc' > .env && git add -f .env && git commit -m test` → **pre-commit 차단** 확인.
   - `git checkout main && git push --dry-run` → **pre-push 차단** 확인.
   - Claude Code에서 `.env` 편집 시도 → **PreToolUse 차단** 확인.
   - Claude Code에서 `git push origin main` 실행 시도 → **Bash 훅 차단** 확인.

4. **Copilot 스캐폴드 확인**
   - VS Code + Copilot에서 `.github/prompts/commit.prompt.md`를 `#` 멘션으로 불러올 수 있는지.
   - `.github/instructions/db-migration.instructions.md`의 `applyTo` glob이 `migrations/` 파일을 건드릴 때 자동 활성화되는지.

5. **문서 정합성**
   - `README.md`, `AGENTS.md`에 추가된 경로 문자열이 실제 파일과 정확히 일치하는지.
   - `AGENTS.md` §12의 표에 적힌 경로에 실제로 파일이 있는지.

---

## 7. 참고 및 재사용 자원

- `.userdocs/harness-engineering/SKILL.claude.md` — 4계층 정의·도구 매핑·구축 순서 원칙.
- `AGENTS.md`의 `Task Routing` — Command 본문이 이 라우팅 표를 참조만 하고 중복 기술하지 않도록.
- `.agents/code/`, `.agents/ui/`, `.agents/data/` — Skill 체크리스트가 포인터로만 참조.
- 가이드 핵심 원칙(재강조):
  - **맞춤형 우선** — 기성 프레임워크를 그대로 쓰지 않는다.
  - **점진적 구축** — Commands 4개 + Skills 2개로 시작, 관찰 후 확장.
  - **AI 판단 vs 강제** — 일관성 필요 = Hook, 유연성 필요 = Rule/Skill.

---

## 8. 범위 외 (의도적으로 제외)

- **Codex CLI 지원** — 사용자 결정에 따라 이번 범위 아님. 향후 필요 시 `.codex/` 미러링.
- **추가 Skill** — test-writer, api-client-generator 등은 반복 관찰 후 승격 원칙대로 나중에.
- **CI/CD 훅** — GitHub Actions 워크플로우는 별도 작업으로 분리.
- **husky 도입** — 외부 의존성 없는 `.githooks/` 방식을 선호.
