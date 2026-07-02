# GitHub Copilot Instructions

이 저장소의 에이전트 규칙은 루트 `AGENTS.md`를 **1차 소스**로 삼는다.
Copilot은 작업 시작 전 반드시 다음 순서로 문서를 참고한다:

1. `AGENTS.md` (진입점)
2. `AGENTS.md`의 `Task Routing` 표에서 작업 유형 확인
3. 필요한 `.agents/*` 문서
4. 실제 코드와 설정 파일

재사용 가능한 워크플로우는 `.github/prompts/*.prompt.md`,
시나리오별 스킬은 `.github/instructions/*.instructions.md`에 있다.

비개발자가 이 템플릿을 복사해 사용하는 경우 `.agents/VIBE_CODING_GUIDE.md`도 함께 참고한다. 이 문서는 Codex, Claude Code, GitHub Copilot을 공통 규칙으로 운영하는 방법과 Claude MD Management를 통한 문서 갱신 루틴을 설명한다.
