# CHANGELOG

insulation-partition-generator(표시명 **단열 Layout** 런처)의 **제품** 변경 기록이다. 이 파일이 제품 버전의 단일 출처다.

**규칙**: 에이전트 규칙(`AGENTS.md`·`.agents/*`)·훅·앱 코드·DB 에 영향을 주는 변경이 생기면 같은 작업에서 이 파일에 항목을 더한다. 기준은 [`AGENTS.md`](./AGENTS.md) 10장·11장.

버전 형식은 `MAJOR.MINOR.PATCH` 다(10장 "분기한 프로젝트는 제품 버전을 따로 둔다"). 기반 템플릿 표준 번호(`2.27-draft` 등)는 이 파일이 아니라 `AGENTS.md` 머리말 "표준 버전" 에만 적는다. 태그 자동화는 없다.

---

## [0.1.0] - 2026-10-21

번호는 루트 `package.json` 의 `version`(0.1.0)에 맞췄다.

### 변경 — 에이전트 템플릿

- **Woomi 코딩 에이전트 템플릿 2.0-draft → 2.27-draft 적용.** 에이전트 규칙 문서·명령(위키 4종 x Claude/Codex/Copilot)·훅(`scripts/agent-guard.cjs`, `.githooks/`)·opencode 설정·`docs/ai/`·`wiki/`·`docs/브라우저-검증-절차.md` 를 3-way 병합으로 들여왔다.
- **들여오지 않은 것**(사용자 결정): CI(`pr-checks`·`tag-version`), Prettier·ESLint, `.nvmrc`, `/onboard`, `.opencode` 심볼릭 링크. 목록과 이유는 `AGENTS.md` 11장.
- 이 `CHANGELOG.md` 를 제품 기준으로 새로 만들었다.
- opencode 셸 허용을 검사 명령만으로 좁히고 위험 명령은 deny(모든 에이전트).
- 안전 훅 보존: 템플릿 훅에 더해, 이 저장소가 쓰던 "경로에 `secret`·`.env`·`*.pem`" 편집 차단과 `main` 직접 푸시 차단(`+main`·`HEAD:main` 포함) 훅을 **`.claude/settings.json`·`.codex/hooks.json` 모두**에 그대로 남겼다. 강제 푸시(`--force`·`-f`) 차단 훅을 더했다.

### 추가 — 스마트폼 독립 이관 준비 (PR #58)

- 스마트폼(`/tools/forms`)을 별도 저장소(`woomi-ai-innovation/2026-leesy121212-alt`)로 옮기기 위한 계획서·초기 스키마·데이터 복사 도구(`docs/2026-10-21-스마트폼-독립이관계획.md`, `docs/smart-forms-split/`, `scripts/smart-forms-split/`). 이관이 끝나 안정될 때까지 이 저장소의 스마트폼 코드·테이블은 지우지 않는다.

---

이 이전의 변경은 `git log` 이력을 본다(2026-07-02 SSX 에서 독립 이관한 뒤의 기록).
