# COMPONENTS.md

이 문서는 프로젝트에서 반복 사용되는 UI 컴포넌트와 사용 기준을 진행 중에 정리하는 문서다.

프로젝트 시작 시 모든 컴포넌트를 미리 정의하지 않는다. 실제 화면 구현 중 공통화된 컴포넌트만 추가한다.

---

## 작성 시점

- 같은 UI 패턴이 두 번 이상 반복될 때
- 공통 버튼, 입력, 테이블, 다이얼로그, 배지, 카드, 레이아웃 컴포넌트가 생길 때
- 특정 컴포넌트 사용법을 AI가 반복해서 틀릴 때
- deprecated된 컴포넌트나 대체 컴포넌트가 생길 때

---

## 작성할 내용

```txt
Component:
Location:
Purpose:
When to use:
When not to use:
Required props:
Common variants:
Accessibility notes:
Mobile notes:
Examples:
Deprecated alternatives:
```

---

## Component Notes

이 컴포넌트들은 `apps/web` 스캐폴드에서 제공된다. 위치 규칙은 PROJECT_STRUCTURE.md를 따른다.

| 컴포넌트 | 위치 | 용도 | 주요 props | 상태·접근성 메모 |
| --- | --- | --- | --- | --- |
| Button | `app/shared/ui/button.tsx` | 액션 버튼 | `variant?: primary\|secondary\|outline\|ghost\|danger`, `size?: sm\|md\|lg\|icon`, 나머지 `<button>` 속성 | `focus-visible` 링, `disabled` 시 흐림. 아이콘 버튼은 `size="icon"` + `aria-label` |
| Input | `app/shared/ui/input.tsx` | 단일 행 입력 | native `<input>` 속성 | 오류는 `aria-invalid`로 표시(`aria-[invalid=true]` 시 danger 테두리) |
| Textarea | `app/shared/ui/textarea.tsx` | 여러 행 입력 | native `<textarea>` 속성 | 오류는 `aria-invalid`로 표시 |
| Select | `app/shared/ui/select.tsx` | 드롭다운 선택 | native `<select>` 속성 | `focus-visible` 링, `disabled` 지원 |
| Checkbox | `app/shared/ui/checkbox.tsx` | 체크박스 | native `<input>` 속성(type 고정) + `ref` | 라벨과 함께 사용. `focus-visible` 링. `ref`로 `indeterminate`(부분 선택) 설정 — 전체 선택 헤더 등 |
| Card 계열 | `app/shared/ui/card.tsx` | 콘텐츠 묶음 컨테이너 | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `rounded-lg` 고정. 카드 안 카드 중첩 금지 |
| Badge | `app/shared/ui/badge.tsx` | 상태·라벨 표기 | `tone?: neutral\|primary\|success\|warning\|danger\|info` | 시맨틱 토큰 톤만 사용. 텍스트 대비 유지 |
| SheetGrid | `app/shared/ui/sheet-grid.tsx` | **표 데이터(기본값)** | `columns: SheetColumn<T>[]`, `rows: T[]`, `rowKey(row,i)=>string`, `empty?`, `rowClassName?`, `className?` | 엑셀식 셀 키보드 주행(↑↓←→/Enter)·드래그 범위 선택·`Ctrl/⌘+C` TSV 복사·스티키 헤더·좌우 열 고정. 열은 `cell()`로 렌더, 색인·작업 열은 `focusable:false`, 편집 셀은 `cell()` 안에 input/select. 가로 스크롤(min-w) 기반 |
| Table 계열 | `app/shared/ui/table.tsx` | 표 마크업 프리미티브(저수준) | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` | 새 표는 SheetGrid 로 만든다. 이 프리미티브는 SheetGrid 가 과한 단순 정적 표에만 쓴다 |
| Skeleton | `app/shared/ui/skeleton.tsx` | 로딩 자리표시 | className으로 크기 지정 | 로딩 상태 전용. `animate-pulse` |
| Field | `app/shared/ui/field.tsx` | 폼 필드 래퍼 | `{ label, htmlFor?, required?, hint?, error?, children }` | `error` 우선 표시, 없으면 `hint`. `htmlFor`로 라벨 연결 |
| PageHeader | `app/shared/ui/page-header.tsx` | 화면 제목·액션 영역 | `{ title, description?, actions? }` | 반응형(모바일 세로 / 데스크톱 가로 정렬) |
| StatCard | `app/shared/ui/stat-card.tsx` | KPI 지표 카드 | `{ label, value, icon?, delta?: { value, trend } }` | `trend`(up/down/flat)에 따라 시맨틱 색 |
| EmptyState | `app/shared/ui/empty-state.tsx` | 빈 상태·무결과 안내 | `{ icon?, title, description?, action? }` | 목록 비었을 때/검색 무결과에 사용 |
| ErrorState | `app/shared/ui/error-state.tsx` | 오류 상태 | `{ title?, description?, onRetry?, action? }` | `onRetry` 있으면 다시 시도 버튼. 루트 ErrorBoundary에서도 사용 |
| Placeholder | `app/shared/ui/placeholder.tsx` | 스캐폴드 가이드 블록 | `{ title, description?, icon? }` | 점선 안내. 실제 위젯으로 교체 대상 |
| ConfirmPanel | `app/shared/ui/confirm-panel.tsx` | 파괴적 작업 확인 | `{ title, description, confirmLabel?, cancelLabel?, onConfirm, onCancel, pending? }` | 삭제/초기화 전 인라인 확인. `pending` 시 처리 중 표시 |
| ItemStatusBadge | `app/entities/item/ui/item-status-badge.tsx` | 항목 상태 배지(도메인) | `{ status: ItemStatus }` | 상태→톤 매핑 내장(active/pending/archived). Badge 기반 |

---

## 표(Table) 규칙

- 표를 만들 때는 **`SheetGrid` 를 기본으로 사용한다.** 새로 `<table>` 을 직접 짜거나 `Table` 프리미티브로 표를 조립하지 않는다.
- 열은 `SheetColumn<T>` 배열로 선언한다. `cell(row, pos)` 로 셀을 렌더하고, 범위 복사(TSV)를 지원하려면 `copyText(row)` 를 채운다.
- 색인(No)·선택·작업 버튼 열은 `focusable: false`, 좌/우 고정은 `sticky: "left" | "right"` 로 둔다.
- 편집 가능한 셀은 `cell()` 안에 `input`/`select`/`button` 을 넣으면 키보드 주행이 그 컨트롤로 포커스한다.
- **다중 선택·일괄 작업**(여러 항목 작성/수정 화면 필수): 첫 열에 `focusable:false` 선택 열을 두고 행마다 공용 `Checkbox`, 헤더에 전체 선택/indeterminate 체크박스를 둔다. 선택이 있으면 선택 개수 + 일괄 작업 툴바(일괄 수정/삭제/상태 변경)를 노출한다. 선택 상태(선택 id 집합)는 호출부가 관리하고, SheetGrid 는 셸만 제공한다. 세부 UX 정책은 UX_RULES.md §14(Selection And Bulk Actions)를 따른다.
- 로딩/빈 상태/오류 상태는 SheetGrid 밖에서 `Skeleton` / `EmptyState` / `ErrorState` 로 분기한다(예: `app/routes/items.tsx`).
- 예시: `app/routes/items.tsx` — 검색·필터·상태 분기 + `SheetGrid` 목록 + 선택 체크박스(전체 선택/indeterminate) + 일괄 상태 변경·일괄 삭제 툴바.

---

## 버전·변경 이력 노출 규칙

운영자가 "지금 배포된 게 어느 버전인지"를 화면에서 확인할 수 있어야 한다. 문의 대응·회귀 추적의 출발점이기 때문이다.

- **위치**: 앱 셸 **좌측 하단**(사이드바 최하단). 스캐폴드 구현은 `app/shared/ui/version-info.tsx`, 배선은 `app/routes/_app.tsx`.
- **버전 문자열은 `CHANGELOG.md` 최상단 `## [x.y-단계]` 헤딩에서 파생한다.** 별도 상수를 두지 않는다 — 두면 반드시 어긋난다. 파싱·캐시는 `app/shared/lib/version.server.ts`.
- **변경 이력 본문은 서버 경유로만 내려보낸다.** 변경 이력에는 수정된 취약점의 파일·경로가 남기 마련이라, 클라이언트 번들(`?raw` import)이나 정적 자산(`public/`)에 넣으면 **로그인 없이 읽힌다.** 로그인 가드가 걸린 loader(스캐폴드: `routes/changelog.tsx`)에서만 읽고, 열 때 fetch 한다.
  - 서버 렌더 프레임워크가 아닌 스택(예: SPA + Worker)에서는 인증을 통과한 API 엔드포인트로 대체한다. 원칙은 같다 — **비로그인 접근 경로에 변경 이력을 두지 않는다.**
- **렌더는 `Markdown`**(`app/shared/ui/markdown.tsx`)을 쓴다. 경량 파서(`shared/lib/markdown.ts`, 의존성 없음)가 입력을 먼저 HTML 이스케이프한 뒤 허용 구문만 되살리므로 raw HTML/스크립트가 통과하지 못한다. 마크다운 렌더링용 라이브러리를 새로 추가하지 않는다.
- 사이드바 접힘(collapsed) 상태에서는 아이콘만 남기고 버전 문자열을 숨긴다.
