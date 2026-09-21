/**
 * 복합기 인쇄 — 화면의 시트를 **엑셀에 적힌 용지 설정 그대로** 종이에 맞춘다.
 *
 * 양식마다 용지(A4·A3), 방향(가로·세로), 여백이 엑셀 파일에 들어 있다. 그걸 무시하고 브라우저
 * 기본값(A4 세로)으로 뽑으면 21열짜리 대장이 두 장으로 잘린다. 그래서 인쇄할 때 `@page` 규칙을
 * 그 값으로 만들어 넣고, 표 너비를 인쇄 가능한 폭에 맞춘다(키우지는 않는다).
 */
import type { FormPageSetup } from "./types";

/** 엑셀 용지 번호 → CSS `@page size` 이름. 모르는 번호는 A4 로 본다(현장 양식은 거의 A4·A3). */
const PAPER_NAMES: Record<number, string> = {
  1: "letter",
  5: "legal",
  8: "A3",
  9: "A4",
  11: "A5",
  12: "B4",
  13: "B5",
};

/** 용지 실제 크기(mm) — 폭 계산에 쓴다. */
const PAPER_SIZES_MM: Record<string, { width: number; height: number }> = {
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
};

const MM_PER_INCH = 25.4;
/** CSS 는 1인치를 96px 로 본다. */
const PX_PER_INCH = 96;
/** 엑셀에 여백이 없을 때 쓰는 기본값(엑셀 기본 좌우 0.7인치보다 좁게 — 표가 한 장에 더 잘 들어간다). */
const DEFAULT_MARGIN_MM = 10;

export const paperName = (paperSize: number | undefined) =>
  (paperSize !== undefined && PAPER_NAMES[paperSize]) || "A4";

const mm = (inches: number | undefined, fallback: number) =>
  inches !== undefined && Number.isFinite(inches) ? Math.round(inches * MM_PER_INCH * 10) / 10 : fallback;

/** 인쇄에 쓸 여백(mm). 엑셀 값(인치)을 따르고, 없으면 기본값. */
export function marginsMm(page: FormPageSetup | undefined) {
  return {
    top: mm(page?.margins?.top, DEFAULT_MARGIN_MM),
    right: mm(page?.margins?.right, DEFAULT_MARGIN_MM),
    bottom: mm(page?.margins?.bottom, DEFAULT_MARGIN_MM),
    left: mm(page?.margins?.left, DEFAULT_MARGIN_MM),
  };
}

/** 종이에서 표가 들어갈 수 있는 크기(px) */
export function printableSizePx(page: FormPageSetup | undefined): { width: number; height: number } {
  const paper = PAPER_SIZES_MM[paperName(page?.paperSize)] ?? PAPER_SIZES_MM.A4;
  const landscape = page?.orientation === "landscape";
  const widthMm = landscape ? paper.height : paper.width;
  const heightMm = landscape ? paper.width : paper.height;
  const margins = marginsMm(page);
  const px = (mmValue: number) => (mmValue / MM_PER_INCH) * PX_PER_INCH;
  return {
    width: px(widthMm - margins.left - margins.right),
    height: px(heightMm - margins.top - margins.bottom),
  };
}

export const printableWidthPx = (page: FormPageSetup | undefined) => printableSizePx(page).width;

/**
 * 이보다 더 줄여야 한 장에 들어가는 시트는 **한 장에 억지로 넣지 않는다**. 줄을 많이 더한
 * 대장을 한 장에 우겨넣으면 글자가 읽을 수 없게 작아진다 — 그런 서류는 엑셀에서도 여러 장이다.
 */
const MIN_SINGLE_PAGE_SCALE = 0.5;

/**
 * 표를 종이에 맞추는 배율. **줄이기만 한다** — 좁은 양식을 늘리면 글자가 뭉개진다.
 *
 * 가로뿐 아니라 **세로도 본다.** 폭만 맞추면 조금 넘치는 양식이 둘째 장으로 밀려, 엑셀에서 한 장
 * 나오던 서류가 두 장으로 나온다(사용자 신고: 순서도 한 장이 두 장으로). 다만 아주 긴 대장까지
 * 한 장에 욱여넣지는 않는다({@link MIN_SINGLE_PAGE_SCALE}).
 */
export function fitScale(
  tableWidthPx: number,
  tableHeightPx: number,
  page: FormPageSetup | undefined,
): number {
  if (!(tableWidthPx > 0)) return 1;
  const size = printableSizePx(page);
  const byWidth = Math.min(1, size.width / tableWidthPx);
  if (!(tableHeightPx > 0)) return byWidth;
  const onePage = Math.min(byWidth, size.height / tableHeightPx);
  return onePage >= MIN_SINGLE_PAGE_SCALE ? onePage : byWidth;
}

/** 인쇄할 때 넣을 `@page` 규칙 */
export function pageRule(page: FormPageSetup | undefined): string {
  const margins = marginsMm(page);
  const orientation = page?.orientation === "landscape" ? " landscape" : " portrait";
  return `@page { size: ${paperName(page?.paperSize)}${orientation}; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; }`;
}

/** 사람이 읽을 용지 설명: `A4 가로` */
export const paperLabel = (page: FormPageSetup | undefined) =>
  `${paperName(page?.paperSize)} ${page?.orientation === "landscape" ? "가로" : "세로"}`;
