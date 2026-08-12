/**
 * App Market(홈 게시 도구) 타입 — Worker /api/market/* 응답 형태.
 * DB 컬럼명(snake_case)을 그대로 쓴다(변환 계층 없이 단순 유지).
 */

/** 카드 목록 1건 */
export interface MarketAppSummary {
  id: string;
  title: string;
  description: string | null;
  deploy_url: string;
  repo_url: string | null;
  platform_type: string;
  location: string;
  category: string;
  version: string | null;
  team: string | null;
  owners: string[];
  tags: string[];
  status: string;
  view_count: number;
  like_count: number;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  /** 첫 스크린샷의 임시 URL (없으면 null) */
  thumbnail_url: string | null;
  /** 현재 사용자가 좋아요 했는지 */
  liked: boolean;
}

export interface MarketShot {
  /** 1시간짜리 임시 URL — 매번 바뀌므로 식별자로 쓰지 않는다 */
  url: string;
  /** Storage 경로 — 수정 시 "이 이미지는 유지" 를 지시하는 식별자 */
  path: string;
  name: string;
  mime: string;
}

/** 상세 1건 — 목록 필드 + 전체 스크린샷 */
export interface MarketAppDetail extends Omit<MarketAppSummary, "thumbnail_url"> {
  screenshots: MarketShot[];
}

export interface MarketAppVersion {
  id: string;
  version: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** 게시 폼 입력값 (스크린샷 파일은 별도 인자로 전달) */
export interface MarketAppInput {
  title: string;
  deployUrl: string;
  repoUrl: string;
  platformType: string;
  location: string;
  category: string;
  version: string;
  team: string;
  description: string;
  owners: string[];
  tags: string[];
}

/** 폼 select 선택지 — 화면과 서버 기본값이 어긋나지 않도록 여기서 한 번만 정의 */
export const PLATFORM_TYPES = ["웹앱", "모바일", "데스크톱", "스크립트·CLI", "플러그인"] as const;

export const CATEGORIES = [
  "웹앱",
  "도면·산출",
  "현장관리",
  "안전보건",
  "데이터·분석",
  "기타",
] as const;

export const LOCATIONS = ["본사", "현장"] as const;
