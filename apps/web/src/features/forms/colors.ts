/**
 * 엑셀 색 계산 — 셀(exceljs)과 도형(DrawingML)이 같이 쓴다.
 *
 * 엑셀은 색을 "#RRGGBB" 로만 적지 않는다. 대부분의 양식은 **테마 색 + 밝기 보정**으로
 * 적혀 있다(예: "흰색, 배경 1, 15% 더 어둡게" = 테마 0번 + tint -0.15). 이걸 못 읽으면
 * 회색 제목줄·칸 배경·회색 테두리가 전부 사라져 원본과 딴판이 된다.
 */

/**
 * 테마 색 12개. **엑셀 셀 서식의 theme 번호 순서**다(0=lt1, 1=dk1, 2=lt2, 3=dk2 …).
 * 테마 XML 은 dk1·lt1·dk2·lt2 순으로 적혀 있어 앞의 두 쌍이 뒤바뀐다 — 헷갈리기 쉬운 곳.
 */
export type ThemeColors = string[];

/** 기본 Office 테마(2013~2022). 테마 파일을 못 읽을 때 쓴다. */
export const DEFAULT_THEME: ThemeColors = [
  "#FFFFFF", // 0 lt1 (bg1)
  "#000000", // 1 dk1 (tx1)
  "#E7E6E6", // 2 lt2 (bg2)
  "#44546A", // 3 dk2 (tx2)
  "#4472C4", // 4 accent1
  "#ED7D31", // 5 accent2
  "#A5A5A5", // 6 accent3
  "#FFC000", // 7 accent4
  "#5B9BD5", // 8 accent5
  "#70AD47", // 9 accent6
  "#0563C1", // 10 hlink
  "#954F72", // 11 folHlink
];

const THEME_SLOTS = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/** 도형 XML 이 쓰는 테마 색 이름 → 테마 번호. `tx1` 은 `dk1` 의 별명이다. */
const SCHEME_ALIASES: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };

export function schemeColor(theme: ThemeColors, name: string): string | undefined {
  const index = THEME_SLOTS.indexOf(SCHEME_ALIASES[name] ?? name);
  return index >= 0 ? theme[index] : undefined;
}

/** `xl/theme/theme1.xml` 에서 테마 색을 읽는다. 못 읽은 칸은 기본 테마 값으로 채운다. */
export function parseThemeXml(xml: string | null | undefined): ThemeColors {
  if (!xml) return DEFAULT_THEME;
  const scheme = /<([A-Za-z0-9_]+:)?clrScheme\b[\s\S]*?<\/([A-Za-z0-9_]+:)?clrScheme>/.exec(xml)?.[0];
  if (!scheme) return DEFAULT_THEME;
  return THEME_SLOTS.map((slot, index) => {
    const block = new RegExp(`<([A-Za-z0-9_]+:)?${slot}>([\\s\\S]*?)</([A-Za-z0-9_]+:)?${slot}>`).exec(scheme)?.[2] ?? "";
    const hex =
      /srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ??
      /sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
    return hex ? `#${hex.toUpperCase()}` : DEFAULT_THEME[index];
  });
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/** 밝기 보정은 HSL 의 L 에만 걸리므로 RGB↔HSL 을 오간다. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

/**
 * 셀 서식의 tint(-1~1). 음수면 어둡게, 양수면 밝게 — 엑셀 규칙 그대로 L 에만 건다.
 * "흰색, 15% 더 어둡게"(tint -0.15)가 #D9D9D9 가 되는 식이다.
 */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex.toUpperCase();
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const lit = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return rgbToHex(...hslToRgb(h, s, Math.min(1, Math.max(0, lit))));
}

/**
 * 엑셀 옛 색 번호표(indexed). 오래된 양식은 색을 번호로 적는다.
 * 64·65 는 "시스템 기본 글자색/배경색"이라 색을 정하지 않은 것으로 본다.
 */
const INDEXED_COLORS = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/**
 * exceljs 가 주는 색 객체(`{argb}` · `{theme, tint}` · `{indexed}`) → "#RRGGBB".
 * 정하지 않은 색(자동)은 undefined — 화면에서 기본값을 쓴다.
 */
export function excelColor(color: unknown, theme: ThemeColors = DEFAULT_THEME): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  const record = color as { argb?: unknown; theme?: unknown; tint?: unknown; indexed?: unknown };
  const tint = typeof record.tint === "number" ? record.tint : 0;

  if (typeof record.argb === "string") {
    const value = record.argb.trim();
    let hex: string | undefined;
    if (value.length === 8) {
      // 완전 투명은 "색 없음"으로 본다.
      if (value.slice(0, 2) === "00") return undefined;
      hex = value.slice(2);
    } else if (value.length === 6) hex = value;
    return hex && /^[0-9A-Fa-f]{6}$/.test(hex) ? applyTint(`#${hex}`, tint) : undefined;
  }
  if (typeof record.theme === "number") {
    const base = theme[record.theme];
    return base ? applyTint(base, tint) : undefined;
  }
  if (typeof record.indexed === "number") {
    const base = INDEXED_COLORS[record.indexed];
    return base ? applyTint(`#${base}`, tint) : undefined;
  }
  return undefined;
}
