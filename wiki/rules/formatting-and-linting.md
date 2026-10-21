---
type: rule
updated: 2026-10-21
tags: [area/코드품질, area/도구]
---

# 포맷과 린트 기준

> **이 저장소(insulation-partition-generator)에는 미도입이다.** 아래는 템플릿 저장소가 2.18-draft 에서 정한 기준과 그 근거다(2026-10-21 템플릿 2.27-draft 적용 때 사용자 결정으로 설정 파일·CI 를 들여오지 않았다 — `AGENTS.md` 11장). 도입할 때의 출발점으로 읽는다.

Prettier 와 ESLint 의 설정, 그리고 **왜 그 범위로 정했는지**. 설정 파일만 보면 "왜 이것만 켰지"를 알 수 없어서 남긴다. 스타일 규칙 자체는 [코드 스타일](code-style.md), 검증 명령은 [테스트와 검증](testing.md), 스택 안에서의 자리는 [기술 스택](stack.md).

도입: 2026-09-13 (`2.18-draft`). **그 전에는 포매터도 린터도 없었다.**

## 한 줄 요약

| 도구 | 맡는 것 | 대상 |
| --- | --- | --- |
| Prettier | 모양 (줄바꿈·들여쓰기·따옴표) | 소스만 (`*.md`·`docs/` 제외) |
| ESLint | 버그 (미사용 코드·훅 규칙·문자열화) | `apps/web/app` |

**둘은 겹치지 않는다.** ESLint 8.53 에서 포맷 규칙이 전부 deprecated 됐고, typescript-eslint 도 자기 포맷 규칙을 `@stylistic` 으로 분리해 내보냈다. 그래서 "prettier 와 eslint 는 충돌하니 조심하라"는 조언은 **지금 이 구성에는 해당하지 않는다** — 아래 `eslint-config-prettier` 절 참조.

## 왜 넣었나 — 0건인데도

도입 직전 실측(47파일 2,702줄)에서 ESLint 최소 구성 지적은 **0건**이었다. 그래서 처음 권고는 "미룬다" 였고, **그게 틀렸다.**

0건은 **지금 쌓인 빚**을 잰 값이다. 린터의 값은 **앞으로 생길 빚을 막는 것**이고, 이 저장소는 파생 프로젝트의 출발점이라 정확히 그 값이 본체다.

증거는 파생 프로젝트 자신이다. Smart Planner 는 4.7만 줄까지 자란 뒤에 ESLint 를 도입했는데, 그 시점에 `rules-of-hooks`·`exhaustive-deps` 는 **0건이었다.** 처음부터 켜져 있었다면 계속 0이었을 것이고, 352건을 재고 오탐을 걸러내는 작업 자체가 없었다. 반대로 **켜져 있지 않았기 때문에** `no-base-to-string` 이 잡는 버그는 43곳까지 번졌다.

## 이 스캐폴드의 버그는 파생 프로젝트 수만큼 복제된다

도입과 함께 고친 것이 하나 있다 — `apps/web/app/routes/login.tsx` 의 `String(form.get("email") ?? "")`.

```ts
const email = String(form.get("email") ?? "") // FormData#get 은 string | File | null
```

`File` 이 들어오면 `[object File]` 이 그대로 저장·전송된다. **타입 검사는 이걸 못 잡는다** — `String()` 은 어떤 값이든 받기 때문이다. `~/shared/lib/form-data` 의 `formString(fd, key)` 로 정리했다.

중요한 건 이게 **한 파일의 버그가 아니라는 점**이다. Smart Planner 에서 같은 패턴이 43곳에서 나왔고, 그 43곳의 출발점이 여기서 복사해 간 로그인 action 이다. 스캐폴드의 버그는 복사한 프로젝트 수만큼 늘어난다 — 그래서 스캐폴드 코드의 결함은 파생 프로젝트의 같은 결함보다 **비싸다.**

## Prettier

```json
{ "printWidth": 100, "semi": false, "endOfLine": "auto" }
```

세 값 다 실측 근거가 있다.

- **`semi: false`** — 세미콜론으로 끝나는 줄 163/2,702. 기본값 `true` 면 전 파일에 세미콜론이 박힌다.
- **`endOfLine: "auto"`** — `core.autocrlf=true` 이고 `.ts`/`.tsx` 는 `.gitattributes` 의 `eol=lf` 대상이 **아니라** 작업 트리가 CRLF 다. 기본값 `lf` 면 실행할 때마다 git 경고가 쏟아진다.
- 따옴표는 설정하지 않았다 — 기본값(큰따옴표)이 이미 관행과 같다(import 163 vs 2).

### 포맷하지 않는 것 — 소스가 아닌 것

`.prettierignore` 로 `*.md` 와 `docs/` 를 뺀다.

- **마크다운**: 이 저장소는 **문서가 본체**다(`AGENTS.md` + `.agents/` 22종 + `wiki/` 47면 + 루트 문서 5종). prettier 는 표 셀을 정렬할 때 폭을 **글자 수로 세어** 한글 표를 오히려 어긋나게 하고, 표 한 줄만 고쳐도 전체가 재정렬돼 문서 diff 가 매번 부풀어 오른다.
- **`docs/`**: `exec-brief/*.dc.html` 은 손으로 만든 발표 슬라이드 원본이다. 포맷하면 원본과 대조할 수 없게 된다. 설계 기록도 여기 있다.

기준은 **"소스가 아닌 것은 포맷하지 않는다"** 다.

### 대량 재포맷과 blame

재포맷 커밋은 설정 커밋과 **분리한다.** `.git-blame-ignore-revs` 가 재포맷 커밋만 가리켜야 설정 변경 이력까지 함께 가려지지 않는다. 로컬 적용은 한 번(GitHub 은 자동으로 읽는다):

```
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## ESLint

최소 구성이다. 켠 것은 이것뿐이다.

- `@eslint/js` recommended
- `typescript-eslint` recommended (**타입 인지 세트 아님**)
- `react-hooks` 에서 **두 규칙만** — `rules-of-hooks`, `exhaustive-deps`
- `@typescript-eslint/no-base-to-string` (타입 정보 필요)
- `@typescript-eslint/no-unused-vars` 재설정 — `argsIgnorePattern: "^_"` (`routes/items.tsx` 의 `_args`)

### 왜 이것만인가

**타입 인지 규칙 전체를 안 켠 이유는 오탐 비중**이다. Smart Planner 실측 352건 중:

- `no-floating-promises` 26건·`no-misused-promises` 11건이 거의 전부 React Router v7 의 `fetcher.submit(...)` — 기다리지 않는 것이 정상 사용법이다.
- `no-unsafe-argument` 116건은 잡음이다.
- 진짜 버그(`no-base-to-string` 43건)가 저 안에 묻힌다. 그래서 **그 하나만 따로 켰다.**

**react-hooks recommended 를 펼치지 않는 이유**는 플러그인 v7 recommended 에 React Compiler 계열 규칙(`set-state-in-effect`, `refs`, `purity` 등)이 섞여 있어서다. 그건 린트 수정이 아니라 **리팩터링 작업**이다.

`pnpm lint` 가 수 초~20초 걸리는 건 정상이다 — 타입 정보를 쓰는 규칙이 하나 있다.

### `eslint-config-prettier` — 넣되, 이유는 다르다

배열 **마지막 원소**로 넣는다. 다만 흔한 설명("충돌이 심해서")은 이 구성에 맞지 않는다.

실제로 끄는 건 `no-unexpected-multiline` 하나뿐이다 — 이 패키지가 끄는 358개 중 우리가 켠 규칙과의 교집합이 그것뿐이고, 358개 중 19개는 지금 typescript-eslint 에 **존재하지도 않는** 옛 설정 호환용 목록이다.

그래도 넣는 이유는 **보험**이다. 나중에 누군가(사람이든 에이전트든) `@stylistic` 이나 포맷 규칙을 가진 프리셋을 추가했을 때 조용히 막아 준다. 그 사고를 나중에 디버깅하는 비용이 devDependency 하나보다 크다.

**주의: 무딘 도구다.** 358개를 무조건 끄고 배열 마지막에 있으므로, 그 목록의 규칙을 나중에 **의도적으로** 켜려 하면 말없이 무시된다. 그때는 이것 뒤에 다시 켠다.

## 게이트가 없으면 규칙이 아니라 권고다

설정을 넣는 것과 강제하는 것은 다르다. 이 저장소의 PR 필수 검사는 도입 직전까지 **0개**였다 — 유일한 워크플로 `tag-version.yml` 은 `main` push 에 태그만 붙인다. 그래서 `.github/workflows/pr-checks.yml` 을 함께 넣었다: 포맷 검사 → 타입 검사 → 린트 → 테스트 → 빌드 → 훅 자체 점검.

마지막 스텝(`agent-guard --selftest`)은 포맷·린트와 무관하지만 같은 이유로 들어갔다 — 로컬 훅이라 **CI 가 유일한 검사**다.

## 템플릿이 물려줄 것은 값이 아니라 방법

`printWidth 100` 이나 "어떤 규칙을 켜는가" 는 **이 코드베이스 실측**에 근거한 값이다. 복사해 간 프로젝트는 다른 코드베이스가 되므로 그 값을 그대로 표준으로 박으면 안 된다. 물려줄 것은 셋이다.

- **recommended 세트를 통째로 펼치지 않는다.** 지적 건수를 먼저 재고, 오탐 비중을 확인한 뒤 규칙 단위로 켠다.
- **소스가 아닌 것은 포맷하지 않는다.**
- **재포맷 커밋과 설정 커밋을 분리하고** `.git-blame-ignore-revs` 로 blame 을 보호한다.

## 하지 말 것

- **`String(...)` 로 감싸거나 `as string` 으로 캐스팅해 `no-base-to-string` 을 침묵시키지 않는다.** 버그를 그대로 두고 경고만 끄는 짓이다. 타입 가드로 좁히거나 `formString()` 같은 헬퍼를 쓴다.
- `// eslint-disable` 로 넘어가지 않는다. 정말 필요하면 **왜** 필요한지 같은 줄에 적는다.
- 마크다운과 `docs/` 를 포맷 대상에 다시 넣지 않는다.

## 명령

```
pnpm format         # 고친다
pnpm format:check   # CI 가 이걸 본다
pnpm lint           # 수 초~20초
pnpm lint:fix
```

## 나중에 다시 볼 것

**타입 인지 규칙 전체**는 지금 미룬 것이지 버린 것이 아니다. `fetcher.submit` 오탐을 걸러낼 방법이 생기거나, 이 스캐폴드가 커져 건수의 성격이 달라지면 다시 잰다. React Compiler 계열도 같다 — 리팩터링을 별건으로 잡을 때 켠다.

## 함께 보기

- [코드 스타일](code-style.md) — 무엇을 어떻게 쓰는가
- [테스트와 검증](testing.md) — 검증 명령과 우선순위
- [기술 스택](stack.md) — 툴링이 스택 안에서 어디에 있나
- [작업 흐름](workflow.md) — 언제 이 검증을 돌리나

## 출처

- [원본 · .agents/STACK.md](../sources/stack.md) — 7장 Tooling 이 이 페이지가 정리하는 규칙의 원본이다
- [원본 · .agents/code/CODE_STYLE.md](../sources/code-style.md) — 1장 Common Style 의 포맷 항목
- 실측값(2,702줄 중 세미콜론 163, import 163 vs 2, ESLint 0건, 재포맷 21파일)과 파생 프로젝트 비교 수치는 이 저장소와 Smart Planner 에서 직접 잰 것이다 — 템플릿 저장소의 `CHANGELOG.md` `2.18-draft`·`wiki/log.md` 2026-09-13(이 저장소에는 없다)
