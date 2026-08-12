/**
 * 도구 레지스트리 — 시공샵 자동화 플랫폼의 도구 목록(단일 원천).
 *
 * 새 도구 추가 방법:
 *   1) 아래 TOOLS 배열에 항목 한 줄 추가 (status: "available", path: "/tools/xxx")
 *   2) 해당 도구 페이지 컴포넌트를 features/xxx/ 에 작성
 *   3) App.tsx 에 <Route path="/tools/xxx"> 연결
 * → 홈(HomePage)은 이 배열을 읽어 카드를 자동으로 그린다.
 */
import { Square, Scissors, type LucideIcon } from "lucide-react";

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
}

export const TOOLS: ToolDef[] = [
  {
    id: "insulation",
    name: "단열재 나누기도",
    description: "외벽선을 트레이싱해 전개 입면을 만들고, 세대별 단열재·오프닝을 배치합니다.",
    path: "/tools/insulation",
    icon: Square,
    status: "available",
    tags: ["단열", "도면·산출", "웹앱"],
    thumbnail: "/thumbs/insulation.png",
  },
  // ── 준비 중 (개발 예정) ──
  {
    id: "joint-cutting",
    name: "줄눈컷팅 자동화",
    description: "타일 줄눈 라인을 인식해 컷팅 경로와 수량을 자동으로 산출합니다.",
    path: "",
    icon: Scissors,
    status: "comingSoon",
    tags: ["타일", "컷팅"],
  },
  // 빈 자리표시자 카드는 두지 않는다 — 홈은 "준비 중" 섹션에 컴팩트 타일로만 노출한다.
];
