---
type: rule
updated: 2026-08-19
tags: [area/ui]
---

# 공통 컴포넌트

반복 사용되는 공통 UI 컴포넌트와 사용 기준. 시작 시 미리 다 정의하지 않고, 실제 화면 구현 중 공통화된 것만 추가한다.

## 언제 기록하나

같은 패턴이 두 번 이상 반복될 때, 공통 버튼/입력/테이블/다이얼로그/배지/카드/레이아웃이 생길 때, AI가 사용법을 반복해 틀릴 때, deprecated/대체 컴포넌트가 생길 때.

기록 항목: Component / Location / Purpose / When (not) to use / Required props / Common variants / Accessibility notes / Mobile notes / Examples / Deprecated alternatives.

## 제공 컴포넌트 (apps/web 스캐폴드)

대부분 `app/shared/ui/`에 있고, 위치 규칙은 [프로젝트 구조](project-structure.md)를 따른다.

- **Button** — `variant`(primary/secondary/outline/ghost/danger), `size`(sm/md/lg/icon). 아이콘 버튼은 `size="icon"` + `aria-label` 필수.
- **Input/Textarea** — 오류는 `aria-invalid`로 표시(danger 테두리).
- **Select** — native `<select>` 속성. `focus-visible` 링, `disabled` 지원.
- **Checkbox** — native 속성 + `ref`. 라벨과 함께 쓰고, `ref`로 `indeterminate`(부분 선택)를 설정한다 — 전체 선택 헤더가 이걸 쓴다.
- **Field** — 폼 필드 래퍼(`{ label, htmlFor?, required?, hint?, error?, children }`). `error`가 있으면 우선 표시하고 없으면 `hint`. `htmlFor`로 라벨을 연결한다.
- **Badge** — 시맨틱 톤(neutral/primary/success/warning/danger/info)만 사용.
- **PageHeader** — 화면 제목·설명·액션 영역(`{ title, description?, actions? }`). 모바일 세로 / 데스크톱 가로로 반응한다.
- **StatCard** — KPI 지표 카드(`{ label, value, icon?, delta?: { value, trend } }`). `trend`(up/down/flat)에 따라 시맨틱 색.
- **Placeholder** — 스캐폴드 가이드용 점선 안내 블록. **실제 위젯으로 교체할 대상**이다.
- **SheetGrid** — **표 데이터의 기본값.** 엑셀식 셀 키보드 주행·드래그 범위 선택·TSV 복사·스티키 헤더·열 고정 지원. 새 표는 SheetGrid로 만들고, `Table` 프리미티브는 SheetGrid가 과한 단순 정적 표에만 쓴다. 다중 행 화면은 선택 열 + 일괄 작업 툴바를 둔다 — [UX 규칙](ux-rules.md).
- **Card 계열** — `rounded-lg` 고정, 카드 안 카드 중첩 금지 — [디자인 원칙](design-principles.md).
- **상태 전용** — Skeleton(로딩, `animate-pulse`), EmptyState, ErrorState(`onRetry` 시 재시도 버튼, 루트 ErrorBoundary에서도 사용), ConfirmPanel(파괴적 작업 인라인 확인, `pending` 지원). [UX 규칙](ux-rules.md)의 상태들을 실제 컴포넌트로 구현한 것이다.

도메인 컴포넌트 예: `ItemStatusBadge`(`app/entities/item/ui/`)는 상태→톤 매핑(active/pending/archived)을 내장하고 Badge를 기반으로 한다.

## 버전·변경 이력 노출

운영자가 배포 버전을 화면에서 확인할 수 있어야 한다. 사이드바 좌측 하단에 버전을 표시하고(`version-info.tsx`), 버전 문자열은 별도 상수 없이 **`CHANGELOG.md` 최상단 헤딩에서 파생**한다. 변경 이력 본문은 취약점 경로가 남을 수 있어 **로그인 가드가 걸린 서버 경유로만** 내려보낸다 — 클라이언트 번들(`?raw` import)이나 `public/`에 넣지 않는다. 서버 렌더 프레임워크가 아닌 스택(SPA + Worker 등)에서는 인증을 통과한 API 엔드포인트로 대체하되 원칙은 같다.

렌더는 공용 `Markdown`(`app/shared/ui/markdown.tsx`)을 쓴다. 의존성 없는 경량 파서가 입력을 먼저 HTML 이스케이프한 뒤 허용 구문만 되살리므로 raw HTML/스크립트가 통과하지 못한다. **마크다운 렌더링용 라이브러리를 새로 추가하지 않는다.** 사이드바가 접힌 상태에서는 아이콘만 남기고 버전 문자열을 숨긴다.

## 함께 보기

- [디자인 원칙](design-principles.md)
- [UX 규칙](ux-rules.md)
- [프로젝트 구조](project-structure.md)
- [진입 규칙](agents-entry.md)
- [좋은 예시와 금지 예시](examples.md)

## 출처

- [원본 · .agents/ui/COMPONENTS.md](../sources/components.md)
