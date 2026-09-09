---
type: rule
updated: 2026-08-06
tags: [area/ui]
---

# 디자인 원칙

업무용 SaaS/관리자/운영 시스템의 기본 디자인 기준. 장식보다 정보 밀도와 스캔 가능성을 우선하는 "조용하고 실용적인" 화면을 만든다.

## 화면 비율

- 데스크톱은 항상 16:9(기본 검수 1920×1080)로 설계·검수한다. 단, 앱 컨테이너에 고정 `aspect-ratio`를 걸어 스크롤/접근성을 제한하지는 않는다.
- 모바일은 임의 단일 너비가 아니라 iPhone 19.5:9, Galaxy 19.5:9~20:9를 참고하고 `env(safe-area-inset-*)`와 동적 viewport 높이를 고려한다.

## 레이아웃과 비주얼

- 화면을 navigation/content/action 영역으로 나눈다.
- card 안에 card를 중첩하지 않는다. card radius는 기본 8px 이하 권장.
- 색상은 의미(danger/warning/success/info) 기준으로 프로젝트 전체에서 일관되게 쓴다. 단조로운 단일 hue 팔레트는 피한다.
- 타이포는 크기가 아닌 계층으로 구분하고, compact panel/sidebar/table 안에서 hero-scale type을 쓰지 않는다.

## 안티패턴 (금지)

화면 안 긴 기능 설명, 장식용 gradient orb/blob/bokeh 배경, card 중첩, 버튼에 긴 문장, 정보보다 장식 많은 dashboard, 설명 없이 사라지는 action, 너무 작은 클릭 영역.

## 왜 중요한가

"예쁘게"라는 모호한 요청은 디자인 슬롭을 만든다. UI 작업 전에 이 문서의 Project Customization(브랜드 분위기, 주요 색상, 버튼 모양, 금지 색상·효과)을 먼저 채워야 AI가 일관된 화면을 만든다 — [바이브코딩 가이드](vibe-coding-guide.md).

템플릿의 색/밀도/컴포넌트 기준을 기존 제품 경험 위에 기계적으로 덮어쓰지 않는다.

## 함께 보기

- [UX 규칙](ux-rules.md)
- [공통 컴포넌트](components.md)
- [바이브코딩 가이드](vibe-coding-guide.md)
- [진입 규칙](agents-entry.md)

## 출처

- [원본 · .agents/ui/DESIGN.md](../sources/design.md)
