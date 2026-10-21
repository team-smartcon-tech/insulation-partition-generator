---
description: 현재 브랜치의 PR diff를 리뷰한다
---

# /review-pr

1. `git diff $(git merge-base HEAD main)...HEAD`로 전체 변경 범위 확인.
2. `wiki/`가 있으면 `wiki/index.md`와 변경 영역에 직접 관련된 `wiki/rules/`·`wiki/systems/`·`wiki/patterns/` 페이지만 확인. 위키는 보조 자료이며 실제 코드·설정 또는 `.agents/*` 원본과 다르면 원본을 기준으로 리뷰하고 위키 드리프트를 언급.
3. `.agents/ARCHITECTURE.md`의 레이어 책임 위반이 없는지 검토.
4. `.agents/code/CODE_STYLE.md` 기준으로 네이밍·구조 위반 체크.
5. 테스트 커버리지, 에러 처리, 중복 구현 여부를 확인.
6. 리뷰 결과를 "Must fix / Nit / Question" 세 구간으로 요약하고 마지막에 `Wiki: checked`, `updated`, 또는 `not needed`와 근거를 남김.
