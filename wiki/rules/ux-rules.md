---
type: rule
updated: 2026-08-19
tags: [area/ui]
---

# UX 규칙

모든 주요 화면이 고려해야 할 상태와 사용자 흐름. AI 에이전트는 happy path만 구현하지 않는다.

## 일곱 가지 상태

모든 주요 화면·기능은 **loading, empty, error, success, forbidden, not found, offline/network failure**를 고려한다.

- **Loading** — action 직후 피드백. 저장/삭제/업로드 중 중복 제출 차단. skeleton은 실제 레이아웃과 유사하게.
- **Empty** — 데이터 없음 사실 + 다음 action + 권한 때문인지 실제 없음인지 구분.
- **Error** — user-safe 문구. 기술적 provider error 노출 금지. 재시도 가능하면 retry 제공. 권한 오류와 서버 오류 구분 — [에러 처리](error-handling.md).

## 폼

필수 입력 표시, 필드 근처 validation, 의미 있는 값(숫자/금액/면적/기간)의 단위·정밀도 보존. 유효하지 않은 값은 조용히 보정하지 말고 명확히 거부한다. 서버 validation error는 form error로 매핑한다.

## 권한

메뉴 숨김과 API 권한 검사는 **둘 다** 필요하다. "로그인이 필요합니다"와 "접근 권한이 없습니다"를 구분한다.

## 선택과 일괄 작업

목록·표에서 여러 행을 다루는 화면은 개별 조작만 제공하지 않는다. 각 행에 선택 체크박스, 헤더에 전체 선택/해제(일부 선택은 indeterminate 표시)를 두고, 선택이 있으면 선택 개수와 일괄 작업 툴바를 노출한다 — [공통 컴포넌트](components.md)의 SheetGrid 규칙과 짝.

여러 항목을 **한 번에 만드는 흐름**(CSV·붙여넣기·여러 행 추가)과 **동시에 고치는 흐름**을 함께 지원한다. 일괄 작업은 실행 전 대상 건수와 변경 내용을 preview로 보여주고 아래 파괴적 작업 규칙을 따른다. 선택 상태는 필터·정렬·페이지 이동 시 예측 가능하게 다룬다 — 페이지를 넘겨도 선택이 유지되는지를 명확히 하거나 화면에 표시한다. 체크박스는 공용 `Checkbox`를 쓰고, 표는 SheetGrid의 선택 열(`focusable:false`)로 구성한다.

## 파괴적 작업

확인 dialog에 변경 내용/되돌림 가능 여부/영향 범위/확인·취소 action을 포함한다. 대량 작업은 dry-run·preview 우선. preview 데이터는 확정 전 실제 저장 금지.

## 파일 업로드

허용 확장자·MIME·크기를 명시하고, 진행/성공/실패 상태를 표시한다. 실패한 업로드는 재시도 또는 제거가 가능해야 한다. private 파일은 인증 없이 접근 가능한 URL을 바로 노출하지 않는다 — [절대 금지·필수 규칙](non-negotiable-rules.md).

## 이동과 현재 위치

현재 위치를 알 수 있어야 한다 — 선택된 메뉴·탭·필터·보기 상태가 화면에서 확인 가능해야 한다. 목록 → 상세 → 편집 → 저장 후 돌아갈 위치가 예측 가능해야 하고, browser back이 데이터 손실을 만들지 않게 한다. 관리자 화면과 사용자 화면의 navigation을 섞지 않는다. 보기 전환·필터 변경·정렬 변경이 사용자의 선택 상태를 예기치 않게 바꾸지 않게 한다.

## 키보드와 단축키

단축키를 제공하는 프로젝트에만 적용된다. 단축키는 활성 범위(scope)가 명확해야 하고, 입력창·dialog·editor·검색창 입력을 global shortcut이 방해하지 않아야 한다. 단축키가 mode를 켜거나 끄면 같은 상태가 화면에도 보여야 한다. 동작이 바뀌면 관련 help text 또는 프로젝트별 단축키 문서를 갱신한다.

## 패널과 밀도 높은 UI

panel·sidebar·drawer·toolbar는 주요 작업 영역을 과도하게 가리지 않고, 빠르게 훑어볼 수 있어야 한다. 앱 안에는 긴 설명 문단보다 label·helper text·tooltip·empty state를 우선한다. 고급 설정은 compact section·disclosure·menu로 분리한다. 자주 쓰는 label과 action 위치는 안정적으로 유지해 muscle memory가 생기게 한다 — [디자인 원칙](design-principles.md)의 정보 밀도 우선과 짝.

## 피드백

성공한 routine action은 status message나 toast로 짧게 알린다. 파괴적·blocking·되돌릴 수 없는 결정은 dialog로 확인한다. error text는 user-safe하고 **다음 행동을 알려야** 한다.

## 모바일

iPhone 19.5:9, Galaxy 19.5:9~20:9를 최소 기준으로 세로·가로를 검수하되, 프로젝트의 실제 지원 기기가 정해지면 그것을 우선한다. safe area, 주소창·도구막대에 따라 변하는 viewport, 회전 후 레이아웃을 확인한다. 주요 action은 터치하기 쉬운 크기로, bottom/sticky action은 콘텐츠를 가리지 않게, 입력 폼은 모바일 키보드에 가려지지 않게 한다. 표는 모바일 대체 표현을 검토한다.

## UX 문서화

반복되는 UX 패턴이나 공통 정책이 생기면 `.agents/ui/UX_RULES.md` 또는 프로젝트별 UX 문서에 기록한다 — 이것은 [절대 금지·필수 규칙](non-negotiable-rules.md)의 필수 항목이다. 기록이 필요한 예: 새로운 loading/empty/error 패턴, 권한별 화면 노출 정책, 파괴적 작업 확인 정책, 폼 검증·숫자·단위 입력 정책, 단축키·navigation·선택·active state 정책, 공통 panel/drawer/dialog 사용 규칙. 단순 문구 수정이나 일회성 화면 보정은 문서 갱신을 강제하지 않는다.

## 금지

stack trace, provider raw error, secret, 내부 구현 정보를 UI에 노출하지 않는다. private 파일은 인증 없이 접근 가능한 URL을 바로 노출하지 않는다 — [절대 금지·필수 규칙](non-negotiable-rules.md).

## AI 체크리스트

UI 작업 후 작업 범위에 맞게 확인한다: Loading / Empty / Error / Permission 상태, Mobile layout, Desktop 16:9 layout, iPhone·Galaxy viewport와 safe area, 행 선택(체크박스·전체 선택·indeterminate), 일괄 등록·수정과 일괄 작업 툴바, 키보드·폼 동작, 파괴적 작업 확인, API 실패 동작.

## 함께 보기

- [디자인 원칙](design-principles.md)
- [공통 컴포넌트](components.md)
- [에러 처리](error-handling.md)
- [진입 규칙](agents-entry.md)

## 출처

- [원본 · .agents/ui/UX_RULES.md](../sources/ux-rules.md)
