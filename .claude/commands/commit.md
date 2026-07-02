---
description: 스테이징된 변경을 컨벤션에 맞춰 커밋한다
---

# /commit

1. `git status`와 `git diff --staged`로 변경사항을 확인한다.
2. `.agents/WORKFLOW.md`의 commit 메시지 컨벤션을 따른다.
3. 변경 "왜"를 1~2문장으로 요약한 제목 + 필요 시 본문으로 메시지 작성.
4. `.env`, 시크릿, 대용량 바이너리가 스테이징되어 있으면 중단하고 사용자에게 알린다.
5. `git commit` 실행. 훅 실패 시 원인을 수정하고 **새 커밋** 생성(amend 금지).
