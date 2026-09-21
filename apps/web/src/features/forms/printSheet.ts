/**
 * 복합기 인쇄 — 화면의 시트를 **엑셀에 적힌 인쇄 설정 그대로** 종이에 맞춘다.
 *
 * 양식마다 용지(A4·A3), 방향(가로·세로), 여백, **배율**이 엑셀 파일에 들어 있다. 그걸 무시하고
 * 브라우저 기본값(A4 세로)으로 뽑으면 21열짜리 대장이 두 장으로 잘린다. 그래서 인쇄할 때
 * `@page` 규칙을 그 값으로 만들어 넣고, 배율도 엑셀이 쓰는 규칙(`excelScale`)으로 정한다.
 *
 * 목표는 "보기 좋게"가 아니라 **엑셀에서 뽑은 것과 같은 종이**다. 실제로 엑셀(COM)로 같은 시트를
 * PDF 로 내보내 장수·용지를 맞춰 보고 정했다.
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
 * 인쇄 배율 — **엑셀 [페이지 설정]에 적힌 규칙을 그대로 따른다.** 여기서 내 나름의 "한 장에
 * 맞추기"를 하면 엑셀과 장수도, 글자 크기도 달라진다(사용자 지적: "엑셀에서 출력하는 거랑
 * 동일해야 된다").
 *
 * 엑셀의 두 가지 방식:
 * - **페이지에 맞추기**(`fitToPage`): 가로 `fitToWidth` 장, 세로 `fitToHeight` 장에 맞춰 줄인다.
 *   `0` 은 그 방향은 맞추지 않는다는 뜻이다 — 현장 양식은 대개 `가로 1장 / 세로 제한 없음`이라,
 *   줄이 늘어나면 엑셀에서도 둘째 장으로 넘어간다. **줄이기만 하고 키우지는 않는다**(엑셀과 같다).
 * - **고정 배율**(`scale`, 기본 100%): 적힌 대로 쓴다. 넘치면 엑셀처럼 여러 장으로 나간다.
 */
export function excelScale(
  page: FormPageSetup | undefined,
  content: { width: number; height: number },
): number {
  const size = printableSizePx(page);
  if (page?.fitToPage) {
    const wide = page.fitToWidth ?? 1;
    const tall = page.fitToHeight ?? 1;
    let scale = 1;
    if (wide > 0 && content.width > 0) scale = Math.min(scale, (size.width * wide) / content.width);
    if (tall > 0 && content.height > 0) scale = Math.min(scale, (size.height * tall) / content.height);
    return scale;
  }
  const percent = page?.scale;
  return percent !== undefined && Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
}

/** 머리글·바닥글 한 토막 — 글꼴이 바뀔 때마다 나뉜다. */
export interface HeaderFooterRun {
  text: string;
  /** 글자 크기(pt) */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  font?: string;
}

/** 머리글·바닥글은 왼쪽·가운데·오른쪽 세 자리로 나뉜다. */
export interface HeaderFooterParts {
  left: HeaderFooterRun[];
  center: HeaderFooterRun[];
  right: HeaderFooterRun[];
}

export const isEmptyHeaderFooter = (parts: HeaderFooterParts) =>
  parts.left.length === 0 && parts.center.length === 0 && parts.right.length === 0;

/**
 * 엑셀 머리글·바닥글 문자열을 푼다.
 *
 * 엑셀은 `&R&"맑은 고딕,굵게"&9QA-4.3-4` 처럼 한 줄에 자리(`&L&C&R`)·글꼴(`&"이름,모양"`)·
 * 크기(`&9`)·쪽번호(`&P`, `&N`)를 섞어 적는다. 현장 양식 190장 중 162장에 바닥글이 있고,
 * 거의 모두 **오른쪽에 서식 번호**(QA-4.3-4)가 들어 있다 — 빠지면 엑셀로 뽑은 종이와 달라진다.
 */
export function parseHeaderFooter(
  text: string | undefined,
  context: { sheetName?: string; pages?: number } = {},
): HeaderFooterParts {
  const parts: HeaderFooterParts = { left: [], center: [], right: [] };
  if (!text) return parts;

  let section: keyof HeaderFooterParts = "left"; // 자리를 안 적으면 왼쪽이다
  let style: Omit<HeaderFooterRun, "text"> = {};
  let buffer = "";

  const flush = () => {
    if (buffer !== "") parts[section].push({ text: buffer, ...style });
    buffer = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "&") {
      buffer += text[index];
      continue;
    }
    const next = text[index + 1];
    if (next === undefined) break;
    if (next === "&") {
      buffer += "&"; // `&&` 는 글자 & 하나
      index += 1;
      continue;
    }
    if (next === '"') {
      // &"맑은 고딕,굵게" — 글꼴 이름과 모양
      const end = text.indexOf('"', index + 2);
      if (end === -1) break;
      flush();
      const [font, shape = ""] = text.slice(index + 2, end).split(",");
      style = {
        ...style,
        font: font && font !== "-" ? font : undefined,
        bold: /bold|굵게/i.test(shape) || undefined,
        italic: /italic|기울임/i.test(shape) || undefined,
      };
      index = end;
      continue;
    }
    if (/\d/.test(next)) {
      const digits = text.slice(index + 1).match(/^\d+/)![0];
      flush();
      style = { ...style, size: Number(digits) };
      index += digits.length;
      continue;
    }
    const letter = next.toUpperCase();
    index += 1;
    if (letter === "L" || letter === "C" || letter === "R") {
      flush();
      section = letter === "L" ? "left" : letter === "C" ? "center" : "right";
      continue;
    }
    if (letter === "B") {
      flush();
      style = { ...style, bold: !style.bold || undefined };
      continue;
    }
    if (letter === "I") {
      flush();
      style = { ...style, italic: !style.italic || undefined };
      continue;
    }
    // 쪽 번호는 웹 인쇄에서 장마다 다르게 찍을 수 없다. 한 장짜리일 때만 채우고,
    // 여러 장이면 비워 둔다 — 틀린 번호를 찍는 것보다 낫다.
    if (letter === "P") {
      buffer += context.pages === 1 ? "1" : "";
      continue;
    }
    if (letter === "N") {
      buffer += context.pages !== undefined ? String(context.pages) : "";
      continue;
    }
    if (letter === "A") {
      buffer += context.sheetName ?? "";
      continue;
    }
    if (letter === "D") {
      buffer += new Date().toLocaleDateString("ko-KR");
      continue;
    }
    if (letter === "T") {
      buffer += new Date().toLocaleTimeString("ko-KR");
      continue;
    }
    // 나머지(&U 밑줄, &F 파일 이름, &Z 경로 …)는 글자로 옮기지 않는다.
  }
  flush();
  return parts;
}

/** 엑셀 기본 머리글·바닥글 여백(인치) */
const DEFAULT_HF_MARGIN_IN = 0.3;

/**
 * 종이 끝에서 바닥글까지(mm). 엑셀은 **아래 여백 안쪽**, 종이 끝에서 이만큼 떨어진 곳에 찍는다.
 *
 * 웹에서는 인쇄 영역 밖(음수 위치)에 두면 크롬이 그걸 "넘친 내용"으로 보고 **빈 장을 한 장 더**
 * 만든다(실제로 그랬다). 그래서 아래 여백 자체를 여기까지 줄이고, 바닥글은 그 맨 아래에 놓는다.
 * 배율 계산에 쓰는 인쇄 영역(`printableSizePx`)은 엑셀 여백 그대로 두어야 장수가 같다.
 */
export function footerMarginMm(page: FormPageSetup | undefined): number {
  return mm(page?.footerMargin, Math.round(DEFAULT_HF_MARGIN_IN * MM_PER_INCH * 10) / 10);
}

/** 머리글은 위 여백 안쪽, 종이 위끝에서 `header` 만큼 떨어진 곳. */
export function headerOffsetMm(page: FormPageSetup | undefined): number {
  const top = marginsMm(page).top;
  const header = mm(page?.headerMargin, Math.round(DEFAULT_HF_MARGIN_IN * MM_PER_INCH * 10) / 10);
  return Math.round((header - top) * 10) / 10;
}

/**
 * 인쇄할 때 넣을 `@page` 규칙.
 *
 * `bottomMm` 은 바닥글이 있을 때만 넘긴다 — 바닥글을 찍을 자리만큼 아래 여백을 줄여야
 * 여백 안쪽(엑셀과 같은 자리)에 들어간다.
 */
export function pageRule(page: FormPageSetup | undefined, override: { bottomMm?: number } = {}): string {
  const margins = marginsMm(page);
  const bottom = override.bottomMm ?? margins.bottom;
  const orientation = page?.orientation === "landscape" ? " landscape" : " portrait";
  return `@page { size: ${paperName(page?.paperSize)}${orientation}; margin: ${margins.top}mm ${margins.right}mm ${bottom}mm ${margins.left}mm; }`;
}

/** 사람이 읽을 용지 설명: `A4 가로` */
export const paperLabel = (page: FormPageSetup | undefined) =>
  `${paperName(page?.paperSize)} ${page?.orientation === "landscape" ? "가로" : "세로"}`;
