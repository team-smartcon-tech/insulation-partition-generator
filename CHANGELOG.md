# CHANGELOG

insulation-partition-generator(표시명 **단열 Layout** 런처)의 **제품** 변경 기록이다. 이 파일이 제품 버전의 단일 출처다.

**규칙**: 에이전트 규칙(`AGENTS.md`·`.agents/*`)·훅·앱 코드·DB 에 영향을 주는 변경이 생기면 같은 작업에서 이 파일에 항목을 더한다. 기준은 [`AGENTS.md`](./AGENTS.md) 10장·11장.

버전 형식은 `MAJOR.MINOR.PATCH` 다(10장 "분기한 프로젝트는 제품 버전을 따로 둔다"). 기반 템플릿 표준 번호(`2.27-draft` 등)는 이 파일이 아니라 `AGENTS.md` 머리말 "표준 버전" 에만 적는다. 태그 자동화는 없다.

---

## [Unreleased]

### 변경 — 로그인 화면 배경 애니메이션 ("도면 위에 골조가 올라간다")

- 정적이던 딥블루 배경에 드래프팅 장면을 깔았다. 등각 와이어프레임 골조 세 동과 타워크레인이 선 단위로 그려지고(첫 진입 시 한 번, 약 5초), 그 뒤로는 트롤리가 지브를 오가고 레벨 스캔선이 아래에서 위로 쓸고 지나간다. 도면 격자(가는 선 + 5칸마다 굵은 선)가 천천히 흐르고, CAD 커서 같은 헤어라인 두 줄이 서로 다른 주기로 화면을 오간다. 치수선(`15,000` · `FL+40.6`)도 도면처럼 붙는다.
- 헤드라인·도구 줄·로그인 카드는 순서대로 떠오른다. `prefers-reduced-motion` 이면 그리기·이동 애니메이션을 모두 끄고 완성된 그림만 보여 준다.
- 구현은 SVG + CSS 키프레임뿐이라 매 프레임 JS 가 돌지 않는다. 선 데이터는 `features/auth/loginScene.ts`(순수 계산), 화면은 `LoginBackdrop.tsx`, 키프레임은 `index.css`. 탑이 헤드라인과 카드 사이 빈 틈에 서도록 자리를 잡고, lg 미만에서는 카드 뒤에 옅게 깔린다.

### 추가 — 단열 Layout: 단열재 자재 발주의뢰서 (회사 표준 양식)

- 리본 「물량 ▸ 발주의뢰서」·워크플로 레일 「단열재 발주의뢰서 (회사 양식)」 버튼. 실행예산 내역서(`2-2 건축(기)` · `11-3 건축(확+옵)` 시트가 든 xlsx)를 올리면 품명이 `단열재` 인 지급자재 줄을 공종별로 찾아 **발주수량 검토 → 자재청구서** 를 채우고, 표지 · 자재청구서 · 발주수량 검토 + 내역서 2장(값만)으로 내려받는다. 타워크레인 발주의뢰서와 같이 원본 양식 `public/templates/insul-order-template.xlsx` 의 셀 값만 바꾼다.
- 세대 외벽 품목(`09.내장목공사`)은 두께 합이 맞는 노출 프리셋(직접외기 150 = 95+55, 간접외기 110 = 55+55)으로 **겹별 세분화**("겹침이음 시공 규격 세분화") — 수량은 두께별 주문 판수(현장산출서 CSV 와 같은 묶음으로 재단) × 정척 면적을 (노출·겹)별 시공 면적 비율로 나눈 값 — 두께별 합계가 CSV 와 일치한다. 줄마다 적용을 끄거나 수량을 고칠 수 있다. 기본/확장은 Layout 이 가르지 않아 기본 칸에 넣는다.
- 맨 뒤에 **「현장산출검토」** 시트 — 검토 결론(두께별 산출·실면적·로스율) + ① 단위세대 타입별 수량 + ② 동별 집계표를 보고서 꼴로. 현장식 산출서 CSV 와 같은 계산(`buildSiteReport`)을 쓴다.
- 내역서 2장은 접어 둔 행 그룹·숨김·인쇄 설정까지 그대로 따라온다. ExcelJS 가 `<sheetPr>` 자식 순서를 어겨 Excel 이 못 열던 문제는 저장 때 바로잡는다.
- 보드 셀에 세그먼트 번호(`seg`)를 실어 노출타입별로 집계할 수 있게 했다(두께만으로는 직접 2P 와 간접 1P/2P 의 55T 를 가를 수 없다).
- 시험: `tests/insul-order-lines.test.mjs`(파서·제안), `tests/insul-order-form.test.mjs`(양식 채우기 — 실제 템플릿에 가짜 내역서).

### 제거 — 스마트폼 (이관 완료)

- 스마트폼은 2026-10-21 새 저장소(`woomi-ai-innovation/2026-leesy121212-alt`)·새 주소(https://smart-forms.jogh.workers.dev)·새 Supabase 로 이관을 마쳤다. 이 저장소에서는 코드를 지운다.
- 지운 것: 홈 내장 카드(`tools.ts` 의 `forms`)와 로고 2개, `/tools/forms` 라우트, `apps/web/src/features/forms/`, 스마트폼만 쓰던 `components/layout/SmartShell.tsx`·`features/profile/`(결재 서명), Worker `/api/forms`(`forms.ts`), 시험 `tests/form-*`·`signature.test.mjs`·`tests/fixtures/`.
- 홈에서 새 주소로 가는 연결은 사용자가 따로 만들었다. 옛 경로 리다이렉트는 두지 않는다.
- DB `form_*` 6개·버킷 `form-files` 는 되돌리기용으로 **2026-11-04 까지 보존**한다. 삭제는 별도 승인. 복사 도구(`scripts/smart-forms-split/`)와 이관 계획서도 그때까지 남긴다.

## [0.1.0] - 2026-10-21

번호는 루트 `package.json` 의 `version`(0.1.0)에 맞췄다.

### 변경 — 에이전트 템플릿

- **Woomi 코딩 에이전트 템플릿 2.0-draft → 2.27-draft 적용.** 에이전트 규칙 문서·명령(위키 4종 x Claude/Codex/Copilot)·훅(`scripts/agent-guard.cjs`, `.githooks/`)·`docs/ai/`·`wiki/`·`docs/브라우저-검증-절차.md` 를 3-way 병합으로 들여왔다.
- 같은 날 템플릿 2.28-draft 변경을 받았다: opencode 제거, `scripts/agent-guard.cjs` 가 `+` 붙은 main 대상 refspec 도 막는다.
- **들여오지 않은 것**(사용자 결정): CI(`pr-checks`·`tag-version`), Prettier·ESLint, `.nvmrc`, `/onboard`, opencode(팀이 쓰지 않기로 함). 목록과 이유는 `AGENTS.md` 11장.
- 이 `CHANGELOG.md` 를 제품 기준으로 새로 만들었다.
- 안전 훅 보존: 템플릿 훅에 더해, 이 저장소가 쓰던 "경로에 `secret`·`.env`·`*.pem`" 편집 차단과 `main` 직접 푸시 차단(`+main`·`HEAD:main` 포함) 훅을 **`.claude/settings.json`·`.codex/hooks.json` 모두**에 그대로 남겼다. 강제 푸시(`--force`·`-f`) 차단 훅을 더했다.

### 추가 — 스마트폼 독립 이관 준비 (PR #58)

- 스마트폼(`/tools/forms`)을 별도 저장소(`woomi-ai-innovation/2026-leesy121212-alt`)로 옮기기 위한 계획서·초기 스키마·데이터 복사 도구(`docs/2026-10-21-스마트폼-독립이관계획.md`, `docs/smart-forms-split/`, `scripts/smart-forms-split/`). 이관이 끝나 안정될 때까지 이 저장소의 스마트폼 코드·테이블은 지우지 않는다.

---

이 이전의 변경은 `git log` 이력을 본다(2026-07-02 SSX 에서 독립 이관한 뒤의 기록).
