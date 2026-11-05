/**
 * 홈 카드 상태 배지 — 관리자가 카드마다 "출처 + 상태" 두 칸을 지정한다 (market_home_order.card_badges).
 *   출처: 본사(본사 작성) / 현장(현장 개발)
 *   상태: 사내기준 / 운영중 / 검증중
 * 값 집합은 worker market.ts 의 BADGE_ORIGINS / BADGE_STATUSES 와 같아야 한다.
 */

export type BadgeOrigin = "hq" | "site";
export type BadgeStatus = "standard" | "operating" | "testing";

export interface CardBadge {
  origin?: BadgeOrigin;
  status?: BadgeStatus;
}

export type CardBadgeMap = Record<string, CardBadge>;

export const BADGE_ORIGIN_OPTIONS: { value: BadgeOrigin; label: string; title: string }[] = [
  { value: "hq", label: "본사", title: "본사 작성" },
  { value: "site", label: "현장", title: "현장 개발" },
];

export const BADGE_STATUS_OPTIONS: { value: BadgeStatus; label: string }[] = [
  { value: "standard", label: "사내기준" },
  { value: "operating", label: "운영중" },
  { value: "testing", label: "검증중" },
];

/** 출처 칸 색 — 본사=브랜드 남색, 현장=초록 */
export const BADGE_ORIGIN_CLASS: Record<BadgeOrigin, string> = {
  hq: "bg-[#004791] text-white",
  site: "bg-emerald-600 text-white",
};

/** 상태 칸 색 — 사내기준=남색 글자, 운영중=초록 글자, 검증중=호박색(주의) */
export const BADGE_STATUS_CLASS: Record<BadgeStatus, string> = {
  standard: "bg-white text-[#004791]",
  operating: "bg-white text-emerald-700",
  testing: "bg-amber-50 text-amber-700",
};

export function originLabel(v?: BadgeOrigin) {
  return BADGE_ORIGIN_OPTIONS.find((o) => o.value === v)?.label;
}

export function statusLabel(v?: BadgeStatus) {
  return BADGE_STATUS_OPTIONS.find((o) => o.value === v)?.label;
}

/** 카드 하나의 배지를 바꾼 새 맵 — 두 칸 모두 비면 키를 지운다 */
export function setCardBadge(map: CardBadgeMap, key: string, patch: Partial<CardBadge>): CardBadgeMap {
  const next: CardBadge = { ...map[key], ...patch };
  if (!next.origin) delete next.origin;
  if (!next.status) delete next.status;
  const out = { ...map };
  if (next.origin || next.status) out[key] = next;
  else delete out[key];
  return out;
}
