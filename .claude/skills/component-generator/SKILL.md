---
name: component-generator
description: 공통 UI 컴포넌트를 디자인 시스템과 재사용 규칙에 맞춰 생성한다. 새 컴포넌트, 공통 UI 블록, 재사용 위젯 요청 시 사용.
---

# Component Generator Skill

## 수행 순서 (필수)

1. **재사용 탐색** — `.agents/ui/COMPONENTS.md`에서 유사 컴포넌트가 이미 있는지 먼저 찾는다. 있으면 확장을 우선.
2. **디자인 규칙 확인** — `.agents/ui/DESIGN.md`의 색상·간격·타이포그래피 토큰만 사용.
3. **UX 규칙 확인** — `.agents/ui/UX_RULES.md`의 상태(로딩/에러/빈) 패턴 반영.
4. **위치 결정** — `.agents/code/PROJECT_STRUCTURE.md`의 컴포넌트 디렉토리 규칙 따름.
5. **Props/타입 정의** — 기존 컴포넌트의 Props 네이밍 패턴과 일관되게.

## 체크리스트

- [ ] 유사 컴포넌트를 먼저 검색했는가
- [ ] 디자인 토큰만 사용했는가 (하드코딩 색상/간격 없음)
- [ ] 로딩/에러/빈 상태가 정의되었는가
- [ ] 접근성(aria-*, 키보드)이 고려되었는가
