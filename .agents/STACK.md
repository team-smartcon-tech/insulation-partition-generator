# STACK.md

이 문서는 Woomi 신규 프로젝트의 표준 기술스택을 정의한다. 스택 변경이 필요한 경우 사유와 영향 범위를 문서화한 뒤 합의 후 반영한다.

---

## 1. Frontend

- React
- React Router v7 Framework Mode
- TypeScript
- TanStack Query
- Zustand
- React Hook Form
- Zod
- 프로젝트별 디자인 시스템

신규 프로젝트에서 `React + Vite`만으로 프론트엔드 표준을 끝내지 않는다. React는 UI 라이브러리이고, Vite는 빌드 도구다. Woomi 신규 프로젝트의 기본 프론트엔드 프레임워크는 **React Router v7 Framework Mode**다.

기본 조합:

- Framework: React Router v7 Framework Mode
- Rendering/routing/data boundary: React Router route modules, loader/action, error boundary
- Server state: TanStack Query
- Local/client state: Zustand
- Form: React Hook Form
- Validation: Zod
- API client: 프로젝트 공통 fetch wrapper
- UI: 프로젝트별 디자인 시스템

디자인 시스템이 없는 경우 MUI, Tailwind + shadcn/ui, Radix 기반 컴포넌트 중 하나로 통일한다. 한 프로젝트 안에서 UI 프레임워크를 섞지 않는다.

---

## 2. Frontend State/Data Rules

| 도구 | 담당 | 사용 기준 |
|---|---|---|
| React Router v7 | 라우팅, route loader/action, navigation, error boundary | URL 진입, route 단위 초기 데이터, 간단한 form action |
| TanStack Query | 서버 데이터 캐시/동기화 | 여러 컴포넌트가 공유하거나 갱신/무효화/mutation 동기화가 필요한 API 데이터 |
| Zustand | 클라이언트 UI 상태 | URL로 표현하기 어렵고 여러 화면이 공유하는 UI 상태 |
| React Hook Form | 복잡한 폼 상태 | 동적 필드, 중첩 필드, dirty/touched/errors, 임시 저장이 필요한 폼 |
| Zod | 입력/API 데이터 검증 | form 값, API 요청/응답, shared schema 계약 검증 |

우선순위:

- route 진입에 꼭 필요한 초기 데이터는 React Router `loader`를 우선 고려한다.
- 간단한 제출은 React Router `Form/action`을 우선 고려한다.
- 서버 데이터 캐시, mutation 후 목록 갱신, background refetch가 필요하면 TanStack Query를 사용한다.
- 검색어, 필터, 페이지 번호처럼 URL로 표현 가능한 상태는 URL search params에 둔다.
- 사이드바, 패널 접힘, 현재 선택 컨텍스트처럼 URL로 표현하기 어려운 전역 UI 상태만 Zustand에 둔다.
- 복잡한 업무 입력 폼은 React Hook Form + Zod를 사용한다.

---

## 3. TypeScript

- 제품 코드는 TypeScript를 기본으로 한다.
- 타입은 API 요청/응답, DB row, 권한 role, 도메인 상태값, form 입력값, Worker Env, service binding, `packages/shared` schema 같은 경계에 우선 적용한다.
- 작은 함수 내부 변수, 단순 map/filter 중간값, 명확히 추론되는 값은 TypeScript 추론을 활용한다.
- 복잡한 제네릭, 조건부 타입 남발, 타입 체조는 금지한다.
- 일회성 스크립트, 단순 설정 파일, 버릴 프로토타입은 JavaScript를 허용할 수 있다.

TypeScript `strict mode`는 `tsconfig`의 `"strict": true`를 켜서 더 엄격한 타입 검사를 적용한다는 뜻이다. 대표적으로 `null`/`undefined` 가능성, 암묵적 `any`, 함수 인자/반환 타입 불일치 같은 실수를 빌드 전에 잡는다.

strict mode는 타입을 복잡하게 만들라는 뜻이 아니다. 제품 코드의 경계는 명확히 타입으로 보호하되, 내부 구현은 단순한 타입과 추론을 우선한다.

---

## 4. Backend

- Cloudflare Workers 또는 Cloudflare Pages Functions
- Hono
- TypeScript strict mode
- Zod
- Supabase JS

---

## 5. Database

- Supabase PostgreSQL
- PostgreSQL function/RPC
- RLS가 필요한 서비스는 정책 문서를 반드시 둔다.

---

## 6. Storage / Infra

- Cloudflare R2 또는 Supabase Storage
- Cloudflare Cron Triggers 또는 Queue
- Wrangler

---

## 7. Tooling

- pnpm workspace
- TypeScript project references
- Vitest
- **Prettier** (`.prettierrc.json`, `.prettierignore`)
- **ESLint 9 flat config** (`eslint.config.mjs`)
- GitHub Actions — `pr-checks.yml`(필수 검사), `tag-version.yml`(태그)

아래는 **프로젝트에서 도입한 경우에만** 기준으로 삼는다.

- Wrangler

### Prettier — 값과 그 근거

```json
{ "printWidth": 100, "semi": false, "endOfLine": "auto" }
```

- **`semi: false`** — 이 스캐폴드는 세미콜론을 쓰지 않는다(도입 시점 실측: 세미콜론으로 끝나는 줄 163/2,702). 기본값 `true` 로 두면 전 파일에 세미콜론이 박힌다.
- **`endOfLine: "auto"`** — `core.autocrlf=true` 환경이고 `.ts`/`.tsx` 는 `.gitattributes` 의 `eol=lf` 대상이 아니라 작업 트리가 CRLF 다. 기본값 `lf` 로 두면 실행할 때마다 git 이 "LF will be replaced by CRLF" 경고를 쏟아낸다.
- 따옴표는 설정하지 않았다 — 기본값(큰따옴표)이 이미 관행과 같다(import 163 vs 2).

**포맷하지 않는 것 — 소스가 아닌 것.** `.prettierignore` 로 `*.md` 와 `docs/` 를 뺀다. 이 저장소는 **문서가 본체**다(`AGENTS.md`·`.agents/` 22종·`wiki/` 46면). prettier 는 표 셀을 정렬할 때 폭을 글자 수로 세어 한글 표를 오히려 어긋나게 하고, 표 한 줄만 고쳐도 전체가 재정렬돼 문서 diff 가 매번 부풀어 오른다. `docs/exec-brief/` 의 `*.dc.html` 은 손으로 만든 발표 슬라이드 원본이라 포맷하면 원본과 대조할 수 없게 된다.

**대량 재포맷은 설정 커밋과 분리한다.** `.git-blame-ignore-revs` 가 재포맷 커밋만 가리켜야 설정 변경 이력까지 함께 가려지지 않는다. 로컬 적용은 `git config blame.ignoreRevsFile .git-blame-ignore-revs` 한 번(GitHub 은 자동으로 읽는다).

### ESLint — 최소 구성, 그리고 늘리는 방법

켠 것은 이것뿐이다.

- `@eslint/js` recommended
- `typescript-eslint` recommended (**타입 인지 세트 아님**)
- `react-hooks` 에서 **두 규칙만** — `rules-of-hooks`, `exhaustive-deps`
- `@typescript-eslint/no-base-to-string` (타입 정보 필요)
- `@typescript-eslint/no-unused-vars` 재설정 — `argsIgnorePattern: "^_"`

**이 구성으로 이 스캐폴드는 0건이다.** 빚을 치우려고 넣은 게 아니라 **앞으로 생길 빚을 막으려고** 넣는다 — 이 저장소는 파생 프로젝트의 출발점이고, 켜진 채로 출발하면 계속 0으로 남는다.

`no-base-to-string` 이 잡는 것:

```ts
`${form.get("name") ?? ""}`   // FormData.get 은 string | File | null
```

`File` 이 들어오면 `[object File]` 이 그대로 저장·전송된다. **타입 검사는 이걸 못 잡는다** — `String()` 은 어떤 값이든 받기 때문이다. 이 스캐폴드의 로그인 action 에 실제로 있었고(`~/shared/lib/form-data` 의 `formString()` 으로 정리), 파생 프로젝트에서는 같은 패턴이 **43곳까지 번진 뒤에야** 발견됐다. 그 43곳의 출발점이 여기 복사해 간 로그인 action 이다.

**규칙을 늘릴 때 recommended 세트를 통째로 펼치지 않는다.** 지적 건수를 먼저 재고, 오탐 비중을 확인한 뒤 규칙 단위로 켠다. 파생 프로젝트 실측이 그 방법의 값을 보여 준다 — 타입 인지 세트 전체는 352건이 나왔는데 `no-floating-promises` 26건·`no-misused-promises` 11건이 거의 전부 React Router v7 의 `fetcher.submit(...)` 정상 사용법이었고 `no-unsafe-argument` 116건은 잡음이었다. 진짜 버그(`no-base-to-string`)가 그 안에 묻힌다.

### `eslint-config-prettier` — 넣되, 이유는 다르다

배열 **마지막 원소**로 넣는다. 다만 흔한 설명("충돌이 심해서")은 이 구성에 맞지 않는다.

실제로 끄는 건 `no-unexpected-multiline` 하나뿐이다 — 이 패키지가 끄는 358개 중 우리가 켠 규칙과의 교집합이 그것뿐이고, 358개 중 19개는 지금 typescript-eslint 에 존재하지도 않는 옛 설정 호환용 목록이다. 그래도 넣는 이유는 **보험**이다. 나중에 누가(사람이든 에이전트든) `@stylistic` 같은 포맷 규칙 프리셋을 추가했을 때 조용히 막아 준다.

**주의: 무딘 도구다.** 358개를 무조건 끄고 배열 마지막에 있으므로, 그 목록의 규칙을 나중에 **의도적으로** 켜려 하면 말없이 무시된다. 그때는 이것 뒤에 다시 켠다.

### 하지 말 것

- `String(...)` 로 감싸거나 `as string` 으로 캐스팅해 `no-base-to-string` 을 침묵시키지 않는다. 버그를 그대로 두고 경고만 끄는 짓이다. 타입 가드로 좁히거나 `formString()` 같은 헬퍼를 쓴다.
- `// eslint-disable` 로 넘어가지 않는다. 정말 필요하면 **왜** 필요한지 같은 줄에 적는다.
- 마크다운과 `docs/` 를 포맷 대상에 다시 넣지 않는다.

---

## 8. Add-ons

NestJS를 사용하는 프로젝트는 `.agents/code/NEST_GUIDE.md`와 `.agents/code/NEST_CF_WORKER.md`를 추가로 따른다.

---

## 9. Project Override (insulation-partition-generator)

실제 값은 `package.json`(루트·`apps/*`·`packages/*`)에서 2026-10-21 에 확인했다. 표준과 다른 점만 적는다.

- 프론트엔드 프레임워크: (표준) React Router v7 Framework Mode 대신 → **Vite + React + wouter** 사용.
  - 사유: 이 프로젝트는 SSX의 기존 "단열재 나누기도" **단일 화면 도구를 "동작 그대로" 이관**하며 시작했다. 원본이 Vite+wouter 기반이라 검증된 코드를 그대로 옮기는 편이 안전·신속했다. 이후 홈(런처)에 도구가 늘었지만 라우팅은 그대로 wouter(`apps/web/src/App.tsx`)다.
  - 실제 버전대: React 19, Vite 7, wouter 3, TanStack Query 5, Tailwind CSS 4(`@tailwindcss/vite`), TypeScript 5.6.
  - UI: Tailwind + shadcn/ui 방식(`apps/web/src/components/ui/button.tsx`, `class-variance-authority`, `@radix-ui/react-slot`), 아이콘 `lucide-react`, 토스트 `sonner`.
  - 도면·문서 처리: 사내 DXF 엔진 `@jakkelab-aec/rw-dxf-engine-ts`(`vendor/*.tgz`), `exceljs`·`xlsx`, `jszip`, `pdfjs-dist`, `three`.
- 상태 관리: 원본이 로컬 컴포넌트 상태 중심이므로 Zustand는 현재 미사용(필요 시 도입).
- **미사용**: Zod, React Hook Form, Supabase JS. 입력 검증은 손으로 쓴다.
- 백엔드: Hono 4 + `jose`(세션 JWT). Supabase 는 SDK 대신 **REST/Storage 를 `fetch` 로 직접** 부른다(`apps/worker/src/supabaseClient.ts`, `index.ts` 안에도 같은 헬퍼가 남아 있다).
- 단일 Worker 가 SPA 정적 자산과 `/api/*` 를 함께 서빙한다(`apps/worker/wrangler.jsonc` `assets.run_worker_first`). Wrangler 4.
- 공유 코드: `packages/shared`(`@ipg/shared`, 공용 타입).
- Python 엔진: `engine/`(finish_takeoff — ezdxf·shapely·numpy·Pillow·openpyxl, pytest). 웹 빌드와 별개다.

### 7장 Tooling 의 실제 상태

- pnpm workspace: 사용(`pnpm-workspace.yaml` = `apps/*`, `packages/*`).
- TypeScript project references: **미사용** — 패키지마다 `tsc --noEmit`.
- Vitest: **미도입** — 단위 테스트는 Node 내장 러너(`node --experimental-strip-types --test tests/*.test.mjs`), 엔진은 pytest.
- Prettier·ESLint·GitHub Actions(`pr-checks.yml`·`tag-version.yml`): **미도입**(2026-10-21 사용자 결정 — 템플릿 2.27-draft 적용 때 CI 는 넣지 않았다). 위 7장의 값과 근거는 도입할 때의 기준으로만 읽는다. 루트 `lint` 스크립트(`pnpm -r lint`)는 있으나 lint 를 가진 패키지가 없다.
- Wrangler: 사용(`apps/worker`).
