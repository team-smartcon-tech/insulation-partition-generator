/**
 * 공정표 셀 팔레트 — 현장에서 쓰던 예정공정표의 색 규약을 그대로 옮긴 것.
 *
 * 색만으로 구분하지 않는다: 모든 셀에 층 라벨 텍스트가 함께 들어가고,
 * 추정 구간은 색이 아니라 빗금(패턴)으로 구분한다.
 */

export interface SegmentStyle {
  bg: string;
  text: string;
  border: string;
}

/** 층 번호 → 셀 스타일 */
export function segmentStyle(floor: number, aboveFloors: number): SegmentStyle {
  // 옥탑
  if (floor > aboveFloors) {
    return { bg: "#cfe6fb", text: "#1e4b73", border: "#a9d0ef" };
  }
  // 기초
  if (floor === 0) {
    return { bg: "#cdebd8", text: "#1d5637", border: "#a6d7ba" };
  }
  // 지하 — 층마다 번갈아 칠해 경계를 읽기 쉽게 한다
  if (floor < 0) {
    return Math.abs(floor) % 2 === 0
      ? { bg: "#f3c4e4", text: "#6b2358", border: "#e2a5cf" }
      : { bg: "#d6d8dc", text: "#3f444c", border: "#bcbfc6" };
  }
  // 최상층 — 골조 완료 시점이라 한눈에 띄어야 한다
  if (floor === aboveFloors) {
    return { bg: "#e8433c", text: "#ffffff", border: "#c9332d" };
  }
  if (floor === 1) {
    return { bg: "#dcefd0", text: "#2d5320", border: "#bfdfae" };
  }
  if (floor <= 3) {
    return { bg: "#fbdccd", text: "#7a3c1d", border: "#f0c0a8" };
  }
  return { bg: "#fdec6e", text: "#5c4a06", border: "#ead84a" };
}

/** 추정 구간에 덮는 빗금 — 색맹 사용자도 실측과 구분할 수 있게 패턴으로 준다 */
export const ESTIMATED_PATTERN =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.85) 0 3px, rgba(255,255,255,0) 3px 7px)";

/**
 * 호기 색 — 배정 매트릭스와 임대 간트에서 같은 호기는 같은 색으로 보인다.
 *
 * 타워크레인과 호이스트가 같은 번호에서 같은 색이면 "T/C 1" 과 "H/C 1" 이 헷갈린다.
 * 그래서 호이스트는 팔레트를 4칸 밀어 같은 자리에서 다른 색이 나오게 한다.
 * (호기 번호는 종류별로 따로 매겨지므로 색까지 같으면 구분할 단서가 글자뿐이다)
 */
const UNIT_COLORS = [
  "#0a63b8",
  "#e07b2c",
  "#2f9e6e",
  "#9a4fc4",
  "#d2456e",
  "#1f9bb5",
  "#8a7b25",
  "#5a6b8c",
];

const HOIST_OFFSET = 4;

export function unitColor(no: number, kind: "tc" | "hc" = "tc"): string {
  const shift = kind === "hc" ? HOIST_OFFSET : 0;
  return UNIT_COLORS[(no - 1 + shift) % UNIT_COLORS.length];
}
