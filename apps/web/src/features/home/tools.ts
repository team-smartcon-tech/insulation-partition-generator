/**
 * 도구 레지스트리 — 시공샵 자동화 플랫폼의 도구 목록(단일 원천).
 *
 * 새 도구 추가 방법:
 *   1) 아래 TOOLS 배열에 항목 한 줄 추가 (status: "available", path: "/tools/xxx")
 *   2) 해당 도구 페이지 컴포넌트를 features/xxx/ 에 작성
 *   3) App.tsx 에 <Route path="/tools/xxx"> 연결
 * → 홈(HomePage)은 이 배열을 읽어 카드를 자동으로 그린다.
 */
import { Square, TowerControl, type LucideIcon } from "lucide-react";

export type ToolStatus = "available" | "comingSoon";

export interface ToolDef {
  /** 고유 id (레지스트리 키) */
  id: string;
  /** 화면에 표시할 도구 이름 */
  name: string;
  /** 한 줄 설명 */
  description: string;
  /** 라우트 경로 (available 일 때만 의미 있음) */
  path: string;
  /** 카드 아이콘 (lucide) */
  icon: LucideIcon;
  /** 사용 가능 / 준비 중 */
  status: ToolStatus;
  /** 카드에 표시할 태그(칩) */
  tags?: string[];
  /** 카드 썸네일 이미지 경로(public 기준). 없거나 로드 실패 시 아이콘 썸네일로 폴백 */
  thumbnail?: string;
  /** 도구 전용 로고(심볼) 경로. 있으면 카드 제목 앞과 썸네일 폴백에 lucide 아이콘 대신 쓴다 */
  logo?: string;
  /** 게시(App Market) 도구들보다 뒤에 놓는다. 기본은 내장 도구가 앞 */
  sortLast?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    id: "insulation",
    name: "단열 Layout",
    description: "외벽선을 트레이싱해 전개 입면을 만들고, 세대별 단열재·오프닝을 배치합니다.",
    path: "/tools/insulation",
    icon: Square,
    status: "available",
    tags: ["단열", "도면·산출", "웹앱"],
    thumbnail: "/thumbs/insulation-logo.png",
    logo: "/brand/mark-insul-layout.svg",
  },
  {
    id: "tc-rental",
    name: "TC/HOIST 발주의뢰서",
    description:
      "동별 골조 공정으로 임대기간을 산정하고, 회사 표준 양식 그대로 발주의뢰서를 만듭니다.",
    path: "/tools/tc-rental",
    icon: TowerControl,
    status: "available",
    tags: ["타워크레인", "호이스트", "발주의뢰서"],
    thumbnail: "/brand/logo-tc-rental.svg",
    logo: "/brand/mark-tc-rental.svg",
    sortLast: true,
  },
  // 빈 자리표시자 카드는 두지 않는다 — 홈은 "준비 중" 섹션에 컴팩트 타일로만 노출한다.
];
