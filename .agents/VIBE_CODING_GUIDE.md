# VIBE_CODING_GUIDE.md

이 문서는 비개발자가 이 저장소를 복사해 자기 프로젝트의 AI 코딩 템플릿으로 쓰기 위한 운영 가이드다.

목표는 AI에게 "알아서 만들어줘"라고 맡기는 것이 아니라, Codex, VS Code GitHub Copilot, Claude Code가 같은 규칙을 읽고 같은 방향으로 움직이도록 프로젝트 기억을 먼저 준비하는 것이다.

---

## 1. 이 템플릿으로 할 수 있는 일

이 저장소를 복사하면 다음 기준선을 함께 가져간다.

| 구분 | 역할 | 주요 위치 |
|---|---|---|
| 공통 규칙 | 세 도구가 함께 따라야 하는 프로젝트 기준 | `AGENTS.md`, `.agents/` |
| Claude Code | Claude가 읽는 진입 문서, 명령, 스킬, 훅 | `CLAUDE.md`, `.claude/` |
| Codex | Codex가 읽는 진입 문서, 프롬프트, 스킬 | `AGENTS.md`, `.codex/` |
| GitHub Copilot | VS Code Copilot이 읽는 지침과 프롬프트 | `.github/copilot-instructions.md`, `.github/` |
| 안전장치 | 민감 파일 수정, main 직접 푸시 등을 막는 장치 | `.githooks/`, `.claude/settings.json` |

비개발자는 이 템플릿을 "AI에게 프로젝트 규칙을 미리 알려주는 설명서 묶음"으로 이해하면 된다.

---

## 2. 10분 시작 가이드

### 2.1 프로젝트에 복사하기

새 프로젝트 루트에 아래 파일과 폴더를 복사한다.

```text
AGENTS.md
CLAUDE.md
CODEX.md
.agents/
.claude/
.codex/
.github/
.githooks/
```

Git 훅을 쓰려면 프로젝트 루트에서 한 번 실행한다.

```bash
git config core.hooksPath .githooks
```

Windows에서 Git Bash나 WSL을 쓴다면 실행 권한도 부여한다.

```bash
chmod +x .githooks/*
```

### 2.2 반드시 바꿀 문서

처음 복사한 뒤 아래 순서로 내용을 자기 프로젝트에 맞춘다.

| 순서 | 문서 | 무엇을 바꾸나 |
|---|---|---|
| 1 | `README.md` | 프로젝트 이름, 한 줄 소개, 사용 방법 |
| 2 | `AGENTS.md` | 프로젝트 설명, 작업 라우팅 규칙 |
| 3 | `.agents/STACK.md` | 사용하는 도구, 프레임워크, 배포 방식 |
| 4 | `.agents/ARCHITECTURE.md` | 화면, 서버, 데이터가 나뉘는 방식 |
| 5 | `.agents/ui/DESIGN.md` | 색상, 글꼴, 버튼, 화면 분위기 |
| 6 | `.agents/code/PROJECT_STRUCTURE.md` | 파일을 어디에 둘지 |

처음에는 완벽할 필요가 없다. 대신 비워두지 말고 현재 아는 만큼 적는다.

### 2.3 AI에게 처음 시킬 말

Codex, Claude Code, Copilot Chat에 공통으로 이렇게 시작한다.

```text
이 프로젝트는 이 저장소의 AI 코딩 템플릿을 사용합니다.
먼저 AGENTS.md의 Task Routing을 확인하고, 필요한 문서만 읽은 뒤
현재 프로젝트 규칙을 요약해 주세요.
아직 코드는 수정하지 말고, 내가 채워야 할 빈칸과 위험한 가정을 알려 주세요.
```

한 번의 복사-붙여넣기로 AI가 온보딩 전체를 단계별로 주도하게 하려면, 루트 [`QUICKSTART.md`](../QUICKSTART.md)의 **프롬프트 A(기존 프로젝트 적용)** 또는 **프롬프트 B(새 프로젝트 시작)**를 그대로 붙여넣는다.

---

## 3. 비개발자용 작업 루프

새 기능이나 화면을 만들 때는 매번 같은 순서를 반복한다.

1. 만들고 싶은 것을 사람 말로 적는다.
2. AI에게 바로 구현시키지 말고 먼저 계획을 요청한다.
3. 계획이 맞으면 작은 단위로 구현을 맡긴다.
4. 화면이나 동작을 직접 확인한다.
5. 잘못된 점을 구체적으로 말해 다시 고친다.
6. 반복해서 배운 규칙은 `.agents/` 문서에 남긴다.

좋은 요청 예시는 다음과 같다.

```text
관리자가 고객 목록을 볼 수 있는 화면을 만들고 싶어.
먼저 이 저장소의 AGENTS.md Task Routing을 확인하고,
새 화면/UI에 필요한 문서만 읽은 뒤
기존 구조에 맞는 구현 계획을 제안해줘.
비개발자가 확인할 수 있게 화면 상태, 버튼, 에러 상황까지 설명해줘.
```

피해야 할 요청은 다음과 같다.

```text
예쁘고 세련되게 대시보드 만들어줘.
```

이런 요청은 AI가 임의 색상, 임의 레이아웃, 임의 구조를 만들기 쉽다. 항상 어떤 사용자가, 어떤 상황에서, 무엇을 할 수 있어야 하는지 말한다.

---

## 4. 세 도구를 함께 쓰는 방법

### 4.1 Codex

Codex는 저장소 전체를 읽고 계획, 구현, 검증을 이어가기 좋다.

권장 사용:

- 새 기능을 만들기 전 구조 분석 요청
- 여러 파일에 걸친 문서 정리
- 테스트나 빌드 결과 확인
- 변경 전후 영향 범위 설명

첫 요청 예시:

```text
AGENTS.md의 Task Routing을 먼저 확인하고,
이 작업에 필요한 .agents 문서만 읽은 뒤
이 작업이 어떤 문서 규칙을 따라야 하는지 요약한 뒤 진행해줘.
불확실한 점은 먼저 계획으로 정리해줘.
```

### 4.2 VS Code GitHub Copilot

Copilot은 VS Code 안에서 현재 파일을 보며 작은 수정을 빠르게 할 때 좋다.

권장 사용:

- 현재 파일 설명 받기
- 짧은 함수나 문장 다듬기
- 에러 메시지 해석
- Pull Request 설명 초안 만들기

첫 요청 예시:

```text
이 저장소는 AGENTS.md와 .github/copilot-instructions.md를 기준으로 작업합니다.
현재 파일을 그 규칙에 맞게 검토하고, 수정이 필요한 부분만 제안해 주세요.
```

### 4.3 Claude Code

Claude Code는 `CLAUDE.md`, 명령, 스킬, 훅을 묶어 반복 작업을 안정적으로 처리하기 좋다.

권장 사용:

- `/new-feature`, `/new-api`, `/review-pr`, `/commit` 같은 반복 워크플로우
- Claude 전용 스킬 사용
- 작업이 끝난 뒤 프로젝트 기억 갱신
- 훅을 통한 위험 행동 차단

첫 요청 예시:

```text
CLAUDE.md와 AGENTS.md를 먼저 읽고,
이 프로젝트의 작업 순서를 따른 뒤 새 기능 계획을 작성해줘.
구현 전에 어떤 문서를 참고했는지도 알려줘.
```

---

## 5. Claude MD Management 적용

Claude MD Management는 Claude Code에서 `CLAUDE.md`의 품질을 점검하고, 작업 중 배운 내용을 문서에 반영하도록 돕는 Anthropic 공식 플러그인이다.

공식 페이지: https://claude.com/plugins/claude-md-management

### 5.1 설치

Claude Code에서 플러그인 페이지의 설치 안내를 따른다.

설치 후 Claude Code에 이렇게 요청한다.

```text
audit my CLAUDE.md files
```

Claude는 `CLAUDE.md`가 너무 길거나, 명령어가 빠졌거나, 프로젝트 주의사항이 부족한지 점검한다.

### 5.2 작업 후 기억 갱신

중요한 작업이 끝난 뒤 Claude Code에서 실행한다.

```text
/revise-claude-md
```

이 명령은 다음 내용을 `CLAUDE.md`나 로컬 문서에 반영할지 제안한다.

- 새로 알게 된 실행 명령
- 자주 틀리는 프로젝트 규칙
- 환경 설정 주의사항
- 반복되는 작업 절차

제안은 diff로 확인한 뒤 승인한다. 자동으로 모두 반영하지 않는다.

### 5.3 세 도구 공통으로 유지하는 법

Claude MD Management는 Claude Code 전용이지만, 최종 규칙은 세 도구가 함께 읽을 수 있어야 한다.

따라서 Claude가 `CLAUDE.md` 갱신을 제안하면 아래도 함께 확인한다.

| 갱신 내용 | 함께 볼 문서 |
|---|---|
| 모든 도구가 알아야 하는 규칙 | `AGENTS.md`, `.agents/` |
| Claude 전용 사용법 | `CLAUDE.md`, `.claude/` |
| Codex 프롬프트와 관련된 절차 | `.codex/prompts/`, `.codex/skills/` |
| Copilot에서 따라야 하는 지침 | `.github/copilot-instructions.md`, `.github/` |

공통 규칙은 `CLAUDE.md`에만 두지 않는다. 반드시 `AGENTS.md`나 `.agents/`에도 남긴다.

---

## 6. Commands, Skills, Rules, Hooks

바이브 코딩 템플릿은 네 계층으로 운영한다.

| 계층 | 언제 쓰나 | 예시 |
|---|---|---|
| Commands | 자주 반복하는 작업 절차 | 새 기능, 리뷰, 커밋 |
| Skills | 체크리스트가 필요한 복잡 작업 | DB 변경, 공통 컴포넌트 생성 |
| Rules | 모든 작업에 항상 적용되는 기준 | 아키텍처, 코드 스타일, 디자인 |
| Hooks | 반드시 막아야 하는 위험 행동 | 민감 파일 수정, main 직접 푸시 |

운영 원칙은 간단하다.

- 한 번만 필요한 말은 AI 채팅에 쓴다.
- 여러 번 반복되는 말은 문서에 적는다.
- 특정 작업 절차는 Command나 Skill로 만든다.
- AI가 계속 어기는 규칙은 Hook으로 막는다.

---

## 7. UI 작업에서 디자인 슬롭 막기

AI에게 "예쁘게"라고 말하면 결과가 매번 달라진다. UI 작업 전에는 `.agents/ui/DESIGN.md`를 먼저 채운다.

최소한 아래 항목은 적는다.

- 브랜드 분위기
- 주요 색상
- 버튼 모양
- 카드와 표 스타일
- 모바일 대응 기준
- 사용하지 말아야 할 색상이나 효과

요청 예시:

```text
.agents/ui/DESIGN.md를 먼저 읽고,
그 디자인 규칙을 벗어나지 않는 고객 목록 화면을 계획해줘.
새 색상이나 새 컴포넌트가 필요하면 구현 전에 이유를 설명해줘.
```

---

## 8. 작업 전 체크리스트

AI에게 구현을 맡기기 전에 확인한다.

- 무엇을 만들지 한 문장으로 설명할 수 있다.
- 누가 사용할 기능인지 알고 있다.
- 성공한 상태와 실패한 상태를 말할 수 있다.
- 참고해야 할 기존 화면이나 문서가 있다.
- AI가 마음대로 정하면 안 되는 조건을 적었다.

작업이 끝난 뒤 확인한다.

- 실제로 화면이나 동작을 확인했다.
- 바뀐 파일 목록을 이해했다.
- 테스트나 빌드를 실행했는지 확인했다.
- 새로 배운 규칙을 `.agents/`나 `CLAUDE.md`에 남길지 판단했다.
- Claude Code를 썼다면 필요할 때 `/revise-claude-md`를 실행했다.

---

## 9. 참고 자료

- 함께해요 바이브 코딩: https://wikidocs.net/book/19470
- Agent Skills 생태계: https://wikidocs.net/338125
- DESIGN.md 가드레일: https://wikidocs.net/344578
- 하네스 엔지니어링: https://wikidocs.net/338973
- Claude MD Management: https://claude.com/plugins/claude-md-management
