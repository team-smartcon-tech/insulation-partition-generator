---
description: 현재 브랜치의 PR diff를 리뷰한다
---

# /review-pr

1. `git diff $(git merge-base HEAD main)...HEAD`로 전체 변경 범위 확인.
2. `.agents/ARCHITECTURE.md`의 레이어 책임 위반이 없는지 검토.
3. `.agents/code/CODE_STYLE.md` 기준으로 네이밍·구조 위반 체크.
4. 테스트 커버리지, 에러 처리, 중복 구현 여부를 확인.
5. 리뷰 결과를 "Must fix / Nit / Question" 세 구간으로 요약.
