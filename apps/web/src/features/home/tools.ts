/**
 * 도구 레지스트리 — 시공샵 자동화 플랫폼의 도구 목록(단일 원천).
 *
 * 새 도구 추가 방법:
 *   1) 아래 TOOLS 배열에 항목 한 줄 추가 (status: "available", path: "/tools/xxx")
 *   2) 해당 도구 페이지 컴포넌트를 features/xxx/ 에 작성
 *   3) App.tsx 에 <Route path="/tools/xxx"> 연결
 * → 홈(HomePage)은 이 배열을 읽어 카드를 자동으로 그린다.
 */
import {
  CalendarRange,
  ClipboardCheck,
  Flame,
  Square,
  TowerControl,
  type LucideIcon, LayoutGrid } from "lucide-react";
import type { SectionId } from "@/features/market/types";

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
  /** 홈 섹션 (market/types.ts SECTIONS). 없으면 시공 도구 */
  section?: SectionId;
  /** 카드 아래 작성자 줄 (예: "김은상 · PI팀"). 없으면 "우미 · 스마트 툴박스" */
  author?: string;
  /**
   * 이 이메일(스마트웍스 로그인 계정)로 들어온 사람에게만 보인다. 없으면 모두에게 보인다.
   * 시범 운영용 — 홈 카드와 화면 진입(App.tsx ToolGate)을 가리는 것이지 보안 경계가 아니다.
   */
  allowedEmails?: string[];
}

/** 이 사용자가 도구를 볼 수 있는가 — 명단이 없으면 모두 허용, 있으면 이메일이 명단에 있어야 한다 */
export function canSeeTool(tool: ToolDef, email: string | null | undefined): boolean {
  if (!tool.allowedEmails) return true;
  const e = (email ?? "").trim().toLowerCase();
  return e !== "" && tool.allowedEmails.some((a) => a.toLowerCase() === e);
}

export const TOOLS: ToolDef[] = [
  {
    id: "insulation",
    name: "단열 MAKER",
    description: "외벽선을 트레이싱해 전개 입면을 만들고, 세대별 단열재·오프닝을 배치합니다.",
    path: "/tools/insulation",
    icon: Square,
    status: "available",
    tags: ["단열", "도면·산출", "웹앱"],
    thumbnail: "/thumbs/insulation-maker.png",
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
  {
    id: "heat-review",
    name: "동절기 열원검토",
    description:
      "도면 위에 보양 구역(CJ·세대)을 그려 손실열량과 열풍기·펠릿난로 필요 대수를 산정하고, 열원별 동절기 투입 금액을 비교합니다.",
    path: "/tools/heat-review",
    icon: Flame,
    status: "available",
    tags: ["한중콘크리트", "열풍기", "보양"],
    thumbnail: "/brand/logo-heat-review.svg",
    logo: "/brand/mark-heat-review.svg",
    sortLast: true,
  },
  {
    id: "slab-zone",
    name: "슬래브 구분도",
    description:
      "구조평면도(DXF)의 슬래브 기호를 읽어 데크·PC·RC 영역을 색으로 나누고, 종류별 면적과 비율을 계산합니다.",
    path: "/tools/slab-zone",
    icon: LayoutGrid,
    status: "available",
    tags: ["구조평면도", "데크·PC·RC", "면적 비율"],
    thumbnail: "/brand/logo-slab-zone.svg",
    logo: "/brand/mark-slab-zone.svg",
    sortLast: true,
    // 시범 운영 — 차승호 · 김진욱 · 양형직만 (2026-11-19)
    allowedEmails: ["chash@wm.co.kr", "ukuk1212@wm.co.kr", "hjyang@wm.co.kr"],
  },
  {
    id: "gantt",
    name: "스마트 공정표",
    description:
      "스마트웍스 작업일보를 읽어 골조 공정을 동·층·단계로 해석하고, 실적 기준으로 앞으로의 공정을 반일 단위로 자동 재산정합니다.",
    path: "/tools/gantt",
    icon: CalendarRange,
    status: "available",
    tags: ["골조 공정", "작업일보", "간트"],
    thumbnail: "/brand/logo-gantt.svg",
    logo: "/brand/mark-gantt.svg",
    sortLast: true,
    author: "김은상 · PI팀",
  },
  {
    // 별도 서비스(wm-pi/Inspection-Request). /tools/inspection 은 검측요청 주소로 이동만 한다.
    id: "inspection",
    name: "검측요청서",
    description:
      "시공사가 감리단에 검측을 요청하고 전자서명하며, 감리단이 현장검측 사진과 결과통보를 발행합니다. 스마트웍스 계정으로 로그인합니다.",
    path: "/tools/inspection",
    icon: ClipboardCheck,
    status: "available",
    tags: ["검측", "전자서명", "감리"],
    thumbnail: "/brand/logo-inspection.svg",
    logo: "/brand/mark-inspection.svg",
    sortLast: true,
    author: "김은상 · PI팀",
  },
  // 빈 자리표시자 카드는 두지 않는다 — 홈은 "준비 중" 섹션에 컴팩트 타일로만 노출한다.
];
