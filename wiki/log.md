---
type: log
updated: 2026-10-21
tags: [wiki/log]
---

# 기록

넣은 자료를 시간순으로 남깁니다. **덧붙이기만 하고 지우지 않습니다.**

나중에 "이건 왜 넣었더라"를 답하는 자리입니다. 템플릿 저장소 자체의 위키 이력(2026-08-06 ~ 2026-09-15)은 이 저장소의 일이 아니라서 가져오지 않았습니다 — 필요하면 템플릿 저장소 `wiki/log.md` 를 봅니다.

---

## 2026-10-21 · 만들기 · Woomi 코딩 에이전트 템플릿 2.27-draft 적용, 위키 볼트 생성

- 왜 남기나: 이 저장소는 2026-07-02 에 템플릿 2.0-draft 를 복사해 시작했고 그 뒤 템플릿만 2.27-draft 까지 바뀌었다. 에이전트 규칙·훅·위키를 최신 표준으로 맞추려고.
- 한 것: 템플릿 문서·명령·훅(`scripts/agent-guard.cjs`)·opencode 설정·`docs/ai/`·이 위키를 3-way 병합으로 들여왔다. 프로젝트 고유 내용(`AGENTS.md` 0장·11장, `CLAUDE.md` 0장 빠른 참조)은 유지했다.
- 정한 것과 이유: CI(`pr-checks`·`tag-version`)·Prettier·ESLint·`.nvmrc`·`CHANGELOG.md` 는 **들여오지 않았다**(사용자 결정). 템플릿 문서가 이것들을 전제로 한 곳은 지우지 않고 `AGENTS.md` 11장 "들여오지 않은 것" 표로 "미도입" 을 표시했다.
- 규칙 정리본(`rules/`)·원본 기록(`sources/`)은 템플릿 것을 그대로 두었다 — 원본(`.agents/*`)이 같은 표준이고, 이 저장소의 차이는 원본 쪽 Project Override 가 가진다.
- 남은 것: `systems/`(단열 Layout·TC 임대계획·App Market·스마트폼 화면 지식)는 아직 없다. 해당 화면을 다룰 때 만든다.
- 같은 날 보강(리드 지시): 템플릿 전제를 주의 없이 지시하던 문서 18개(`.agents` 9·`wiki/rules` 9)에 "이 저장소 주의" 단락을 붙였다(본문 규칙은 그대로). `docs/브라우저-검증-절차.md` 를 들여오고 머리말에 실제 dev 포트(5473)·DCR 로그인을 적었다. 루트 `CHANGELOG.md` 를 제품 기준으로 새로 만들었다. `.opencode` 심볼릭 링크는 빼고 `opencode.json` 이 `.claude/skills` 를 직접 읽게 했다.
- 같은 날 결정(사용자): opencode 를 쓰지 않기로 해 `opencode.json`·`.opencode/` 를 뺐다. 위 두 줄의 opencode 설정·링크 서술은 이 결정으로 무효다.
- 같은 날: 템플릿 2.28-draft 의 `scripts/agent-guard.cjs` 를 받았다(`+` 붙은 main 대상 refspec 차단). 기반 템플릿 표준을 2.28-draft 로 올렸다.
- 같은 날 결정 반영: git 승인 경계는 템플릿 6장대로(브랜치·로컬 커밋은 사전 승인). 옛 "경로에 `secret` 이 들어간 파일 편집 차단" 훅은 `.claude/settings.json` 에 별도 훅으로 되살렸다 — 템플릿 `agent-guard.cjs` 는 값 파일만 막아 `secretStore.ts` 같은 경로가 통과했기 때문이다. `.agents/skills` 템플릿 사본과 `.userdocs/` 는 정리 보류.
- 같은 날 독립 검증 반영: 템플릿 `agent-guard.cjs bash` 가 `git push origin +main` 을 통과시키고, `.codex/hooks.json` 에서는 옛 secret 경로 차단이 빠져 있었다. 옛 main push·secret 경로 훅과 강제 푸시 차단을 `.claude`·`.codex` 양쪽에 별도 훅으로 두었다(공용 스크립트는 그대로).
