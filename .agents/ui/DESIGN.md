# DESIGN.md

이 문서는 Woomi 표준 웹 서비스의 기본 디자인 원칙을 정의한다.

프로젝트별 브랜드 색, 폰트, 컴포넌트 라이브러리는 달라질 수 있지만, 정보 구조와 사용성 기준은 이 문서를 따른다.

이 문서는 표준 제공 템플릿이다. 새 프로젝트 또는 기존 프로젝트에 적용할 때는 실제 브랜드, 디자인 시스템, 컴포넌트 라이브러리, 사용자 환경을 확인하고 프로젝트에 맞게 수정한다. 템플릿의 색/밀도/컴포넌트 기준을 기존 제품 경험 위에 기계적으로 덮어쓰지 않는다.

---

## 1. Design Direction

업무용 SaaS, 관리자 도구, 운영 시스템은 조용하고 실용적인 화면을 우선한다.

- 장식보다 정보 밀도와 스캔 가능성을 우선한다.
- 마케팅 랜딩처럼 큰 hero, 과도한 카드, 장식 gradient를 남용하지 않는다.
- 반복 업무자가 빠르게 비교, 입력, 수정, 확인할 수 있어야 한다.
- 모바일 사용이 필요한 현장 업무는 터치 영역과 단일 작업 흐름을 우선한다.

---

## 2. Layout

- 데스크톱 웹 화면은 항상 16:9 화면 비율을 기준으로 설계하고 검수한다. 기본 검수 해상도는 1920×1080이며, 1600×900과 1366×768에서도 핵심 콘텐츠와 주요 action이 잘리거나 겹치지 않아야 한다.
- 16:9 기준은 브라우저 viewport의 설계·검수 기준이다. 앱 컨테이너에 고정 `aspect-ratio`를 적용해 스크롤이나 접근성을 제한하지 않는다.
- 화면은 명확한 navigation, content, action 영역으로 나눈다.
- dashboard는 요약, 목록, 주요 action이 한 화면에서 스캔 가능해야 한다.
- form은 관련 필드를 묶고, 저장/취소 action 위치를 일관되게 둔다.
- table/list는 필터, 검색, 정렬, 페이지네이션 위치를 일관되게 둔다.
- page section을 불필요하게 card 안에 또 card로 감싸지 않는다.

---

## 3. Components

우선 사용하는 UI 패턴:

- icon button: 도구성 action
- segmented control: mode 선택
- checkbox/toggle: boolean 설정
- select/menu: 제한된 option
- input/stepper/slider: 숫자 또는 자유 입력
- tabs: 같은 대상의 view 전환
- modal/dialog: 현재 흐름을 잠시 멈추는 확인/입력
- toast: 저장 완료 같은 짧은 피드백

컴포넌트 사용 기준은 `.agents/ui/COMPONENTS.md`에 축적한다.

---

## 4. Visual Rules

- 색상은 의미 기준으로 사용한다.
- 하나의 hue만 반복하는 단조로운 팔레트를 피한다.
- danger/warning/success/info 색은 프로젝트 전체에서 일관되게 쓴다.
- card radius는 기본 8px 이하를 권장한다.
- 버튼, input, table row 높이는 반복 작업에 맞게 안정적인 크기를 유지한다.
- text가 버튼/카드/셀 안에서 잘리지 않게 한다.
- letter spacing은 기본값을 유지한다.
- viewport width에 따라 font-size를 과도하게 스케일하지 않는다.

---

## 5. Typography

- 업무 화면의 제목은 크기보다 계층으로 구분한다.
- compact panel, sidebar, table 안에서는 hero-scale type을 쓰지 않는다.
- 숫자, 금액, 날짜, 상태는 비교하기 쉽게 정렬한다.
- 한국어 문구는 자연스럽고 짧게 쓴다.

---

## 6. Responsive

- 모바일 화면은 임의의 단일 너비만 기준으로 만들지 않는다. 최신 iPhone과 Galaxy의 대표적인 세로·가로 화면 비율과 viewport를 참고해 구현하고 검수한다.
- 최소한 iPhone 계열의 19.5:9 화면과 Galaxy 계열의 19.5:9~20:9 화면을 포함해 확인하며, 특정 기기명이나 픽셀값에 종속된 레이아웃을 만들지 않는다.
- notch, Dynamic Island, 카메라 홀, 홈 인디케이터가 콘텐츠와 action을 가리지 않도록 `env(safe-area-inset-*)`와 모바일 브라우저의 동적 viewport 높이를 고려한다.
- 모바일에서 primary action이 손가락으로 누르기 쉬워야 한다.
- sidebar가 있는 앱은 모바일에서 drawer, bottom nav, simplified nav 중 하나를 명확히 선택한다.
- table은 모바일에서 card list, horizontal scroll, column priority 중 하나로 전환한다.
- text와 action이 겹치지 않게 안정적인 min/max width를 둔다.

---

## 7. Anti-Patterns

금지:

- 기능 설명을 화면 안에 길게 늘어놓기
- 장식용 gradient orb/blob/bokeh 배경
- card 안에 card를 반복 중첩
- 버튼에 긴 문장 넣기
- 정보보다 장식이 많은 dashboard
- 상태/권한에 따라 사라지는 action에 설명 없음
- 클릭 가능한 영역이 너무 작음

---

## 8. Project Customization

프로젝트별로 아래를 채운다.

```txt
Brand color:
Accent color:
Font:
Component library:
Icon library:
Density: compact / normal / spacious
Mobile priority:
Accessibility notes:
```
