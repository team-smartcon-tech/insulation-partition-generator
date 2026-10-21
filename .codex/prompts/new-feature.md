---
description: 새 화면/기능 생성 워크플로우
---

# /new-feature

이 prompt는 shim이다. 실제 기준은 아래 문서를 따른다.

1. `AGENTS.md`의 `Task Routing` 중 `새 화면/UI` 또는 `프론트엔드 기능`
2. `.agents/ui/DESIGN.md`
3. `.agents/ui/UX_RULES.md`
4. `.agents/ui/COMPONENTS.md`
5. `.agents/code/PROJECT_STRUCTURE.md`와 `.agents/code/CODE_STYLE.md`

`wiki/`가 있으면 구현 전에 `wiki/index.md`와 이 기능에 직접 관련된 `wiki/rules/`·`wiki/systems/`·`wiki/patterns/` 페이지만 확인한다. 위키와 실제 코드·설정 또는 `.agents/*` 원본이 다르면 원본을 따른 뒤 위키 드리프트를 기록한다.

기존 유사 화면과 컴포넌트를 먼저 찾고, 없을 때만 새로 만든다.

완료 보고에 `Wiki: checked`, `updated`, 또는 `not needed`와 짧은 근거를 남긴다. 재사용 가능한 결정이나 해결책이 생겼을 때만 `/wiki-log-today` 기록을 제안한다.
