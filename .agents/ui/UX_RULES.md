# UX_RULES.md

이 문서는 Woomi 표준 웹 서비스의 UX 상태와 사용자 흐름 기준을 정의한다.

이 문서는 표준 제공 템플릿이다. 프로젝트에 적용할 때는 실제 사용자, 권한 구조, 주요 업무 흐름, 모바일 사용 여부, 접근성 요구사항을 확인하고 프로젝트에 맞게 수정한다. 단, loading/empty/error/permission 상태를 고려해야 한다는 기본 원칙은 유지한다.

---

## 1. Required States

모든 주요 화면과 기능은 아래 상태를 고려한다.

```txt
loading
empty
error
success
forbidden
not found
offline or network failure
```

AI 에이전트는 새 화면을 만들 때 happy path만 구현하지 않는다.

---

## 2. Loading

- 사용자 action 직후 피드백을 제공한다.
- 저장/삭제/업로드 중에는 중복 제출을 막는다.
- 긴 작업은 진행 상태 또는 대기 메시지를 표시한다.
- skeleton은 실제 레이아웃과 비슷해야 한다.
- 현재 처리 중인 대상이나 active state가 있으면 사용자가 볼 수 있어야 한다.

---

## 3. Empty State

empty state에는 다음 중 필요한 것을 포함한다.

- 현재 데이터가 없다는 사실
- 사용자가 다음에 할 수 있는 action
- 권한이 없어서 비어 보이는지, 실제로 없는지 구분

예:

```txt
등록된 현장이 없습니다.
새 현장을 추가하려면 [현장 추가]를 선택하세요.
```

---

## 4. Error State

- 사용자가 이해할 수 있는 문구를 보여준다.
- 기술적인 provider error를 그대로 노출하지 않는다.
- 재시도 가능한 오류는 retry action을 제공한다.
- 권한 오류와 서버 오류를 구분한다.
- destructive action 실패 시 사용자가 현재 데이터 상태를 알 수 있게 한다.

---

## 5. Forms

- 필수 입력은 명확히 표시한다.
- validation error는 필드 근처에 표시한다.
- 저장 성공/실패 피드백을 제공한다.
- 취소 또는 뒤로 가기 시 입력 손실 가능성을 검토한다.
- 숫자, 날짜, 전화번호 등은 형식과 예시를 제공한다.
- 숫자, 금액, 수량, 면적, 기간처럼 의미가 있는 값은 단위와 정밀도를 보존한다.
- 유효하지 않은 값은 조용히 보정하지 않고 명확한 메시지와 함께 거부한다.
- 서버 validation error를 form error로 매핑한다.

---

## 6. Permissions

권한에 따라 UI를 숨길 수 있지만, 사용자가 혼란스럽지 않아야 한다.

- 접근할 수 없는 페이지는 forbidden 상태를 보여준다.
- 메뉴 숨김과 API 권한 검사는 둘 다 필요하다.
- 관리자/일반 사용자 역할에 따라 action 노출 기준을 일관되게 한다.
- 권한 오류는 "로그인이 필요합니다", "접근 권한이 없습니다"를 구분한다.

---

## 7. Destructive Actions

삭제, 초기화, 덮어쓰기, 운영 데이터 변경은 확인 절차를 둔다.

확인 dialog에 포함할 것:

```txt
무엇이 변경되는가
되돌릴 수 있는가
영향 범위
확인 action
취소 action
```

대량 작업은 dry-run 또는 preview를 우선한다.

상태를 바꾸는 편집 작업은 가능한 한 undo, confirm, preview 중 하나를 제공한다. 임시 preview 데이터는 사용자가 확정하기 전까지 실제 데이터로 저장하지 않는다.

---

## 8. File Upload

- 허용 확장자, MIME, 크기를 명시한다.
- 업로드 진행/성공/실패 상태를 표시한다.
- private 파일은 인증 없이 접근 가능한 URL을 바로 노출하지 않는다.
- 실패한 업로드는 재시도 또는 제거가 가능해야 한다.

---

## 9. Navigation

- 현재 위치를 알 수 있어야 한다.
- 현재 선택된 메뉴, 탭, 필터, 보기 상태는 화면에서 확인 가능해야 한다.
- 목록 -> 상세 -> 편집 -> 저장 후 돌아갈 위치가 예측 가능해야 한다.
- browser back 동작이 데이터 손실을 만들지 않게 한다.
- 관리자 화면과 사용자 화면의 navigation을 섞지 않는다.
- 보기 전환, 필터 변경, 정렬 변경이 사용자의 선택 상태를 예기치 않게 바꾸지 않게 한다.

---

## 10. Keyboard And Shortcuts

프로젝트가 keyboard shortcut을 제공한다면 아래 원칙을 따른다.

- shortcut은 활성 범위(scope)가 명확해야 한다.
- 입력창, dialog, editor, 검색창 입력을 global shortcut이 방해하지 않아야 한다.
- shortcut이 mode를 켜거나 끄면 같은 상태가 화면에도 보여야 한다.
- shortcut 동작이 바뀌면 관련 help text 또는 `.agents/ui/SHORTCUTS.md` 같은 프로젝트별 문서를 갱신한다.

---

## 11. Panels And Dense UI

- panel, sidebar, drawer, toolbar는 주요 작업 영역을 과도하게 가리지 않는다.
- panel은 빠르게 훑어볼 수 있어야 한다.
- 앱 안에는 긴 설명 문단보다 label, helper text, tooltip, empty state를 우선한다.
- 고급 설정은 compact section, disclosure, menu로 분리한다.
- 자주 쓰는 label과 action 위치는 안정적으로 유지해 사용자가 muscle memory를 만들 수 있게 한다.

---

## 12. Feedback

- 성공한 routine action은 status message나 toast로 짧게 알린다.
- destructive, blocking, unrecoverable decision은 dialog로 확인한다.
- error text는 user-safe하고 다음 행동을 알려야 한다.
- stack trace, provider raw error, secret, 내부 구현 정보는 UI에 노출하지 않는다.

---

## 13. Mobile

- 주요 action은 터치하기 쉬운 크기여야 한다.
- bottom action이나 sticky action을 사용할 때 콘텐츠를 가리지 않는다.
- 입력 폼은 모바일 키보드에 가려지지 않게 한다.
- table은 모바일 대체 표현을 검토한다.

---

## 14. UX Documentation

에이전트는 반복되는 UX 패턴이나 공통 정책이 생기면 이 문서 또는 프로젝트별 UX 문서에 기록한다.

기록이 필요한 예:

- 새로운 loading/empty/error 패턴
- 권한별 화면 노출 정책
- destructive action 확인 정책
- form validation 또는 숫자/단위 입력 정책
- shortcut, navigation, selection, active state 정책
- 공통 panel, drawer, dialog 사용 규칙

단순 문구 수정이나 일회성 화면 보정은 문서 갱신을 강제하지 않는다.

---

## 15. AI Checklist

UI 작업 후 에이전트는 작업 범위에 맞게 아래를 확인한다.

```txt
Loading state:
Empty state:
Error state:
Permission state:
Mobile layout:
Keyboard/form behavior:
Destructive action confirmation:
API failure behavior:
Active/selected state visibility:
Shortcut scope:
UX documentation update needed:
```
