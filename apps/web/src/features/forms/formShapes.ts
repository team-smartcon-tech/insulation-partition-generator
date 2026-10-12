/**
 * 엑셀 도형(순서도 상자·화살표)을 읽는다.
 *
 * exceljs 는 셀·서식·그림까지는 주지만 **도형은 아예 내주지 않는다.** 그런데 업무
 * 양식의 프로세스 도(圖)는 대부분 도형으로 그려져 있어, 안 읽으면 그 시트가 통째로
 * 빈 화면이 된다. 그래서 .xlsx 압축을 직접 열어 `xl/drawings/drawing*.xml` 을 읽는다.
 *
 * 다루는 범위: 업무 양식 순서도에 실제로 쓰이는 것 — 사각형·타원·마름모·순서도 기호,
 * 굵은 화살표·갈매기표, 자유형(점으로 그린 선), 직선·꺾인 연결선, 묶음(그룹, 여러 겹).
 * **곡선 연결선, SmartArt, 차트는 못 읽는다.** 이건 이 파일을 키워서 될 일이 아니라
 * 도형 엔진을 만드는 일이라 선을 그어 둔다.
 */
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, schemeColor, DEFAULT_THEME } from "./colors.ts";
import type { ThemeColors } from "./colors.ts";
import type { FormShape, FormShapeKind, FormShapePath } from "./types";
import { readZipIndex, readZipText } from "./zip.ts";

/** 엑셀 도면 좌표 단위(EMU) → px. 914400 EMU = 1인치, 화면은 96dpi. */
const EMU_PER_PX = 914400 / 96;
/** 선 굵기 단위(EMU) → pt. 12700 EMU = 1pt. */
const EMU_PER_PT = 12700;
const PT_TO_PX = 96 / 72;
/** 굵기를 안 적은 선의 기본값(엑셀 기본 0.75pt) */
const DEFAULT_LINE_PT = 0.75;
/** 글자 안쪽 여백 기본값(EMU) — 좌우 0.1인치, 위아래 0.05인치 */
const DEFAULT_INSET_X = 91440;
const DEFAULT_INSET_Y = 45720;

/** 엑셀 도형 이름 → 화면에 그릴 모양. 없는 것은 네모로 떨어진다. */
const SHAPE_KINDS: Record<string, FormShapeKind> = {
  rect: "box",
  flowChartProcess: "box",
  flowChartDocument: "document",
  roundRect: "roundBox",
  flowChartAlternateProcess: "roundBox",
  flowChartTerminator: "roundBox",
  ellipse: "ellipse",
  flowChartConnector: "ellipse",
  flowChartDecision: "diamond",
  diamond: "diamond",
  line: "line",
  straightConnector1: "line",
  bentConnector2: "line",
  bentConnector3: "line",
};

/** DrawingML 이 이름으로 부르는 기본 색 중 양식에 나오는 것 */
const PRESET_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  gray: "#808080",
  grey: "#808080",
};

interface Context {
  theme: ThemeColors;
}

// ─── 작은 XML 도우미 ────────────────────────────────────────
// 정식 XML 파서를 쓰지 않는 이유: 브라우저의 DOMParser 는 Node 테스트에 없고,
// 파서를 새로 들이기에는 읽을 것이 이 정도로 좁다. 대신 여는·닫는 태그를 **깊이를 세며**
// 짝을 맞춘다 — 묶음 안에 묶음(grpSp 안 grpSp)이 흔해서, 첫 닫는 태그에서 끊으면
// 바깥 묶음이 반쪽만 읽혀 안쪽 도형이 통째로 사라진다.

const TAG = /<(\/)?([A-Za-z0-9_]+:)?([A-Za-z0-9_]+)((?:\s[^>]*?)?)(\/)?>/g;

/** `xml` 안의 이름이 같은 요소들(가장 바깥 것만). 네임스페이스 접두사는 아무거나 허용. */
function findBlocks(xml: string, localName: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const tag = new RegExp(TAG.source, "g");
  let start = -1;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml))) {
    if (match[3] !== localName) continue;
    const closing = Boolean(match[1]);
    const selfClosing = Boolean(match[5]);
    if (!closing) {
      if (depth === 0) start = match.index;
      if (selfClosing) {
        if (depth === 0) out.push(match[0]);
      } else depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) out.push(xml.slice(start, tag.lastIndex));
    }
  }
  return out;
}

interface Element {
  name: string;
  xml: string;
}

/** 요소 하나(`xml` 이 그 요소로 시작)의 바로 아래 자식들을 **적힌 순서대로**. */
function childElements(xml: string): Element[] {
  const tag = new RegExp(TAG.source, "g");
  const root = tag.exec(xml);
  if (!root || root[5]) return [];
  const out: Element[] = [];
  let depth = 0;
  let start = -1;
  let name = "";
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml))) {
    const closing = Boolean(match[1]);
    const selfClosing = Boolean(match[5]);
    if (depth === 0) {
      if (closing) break; // 뿌리 요소가 닫혔다
      if (selfClosing) {
        out.push({ name: match[3], xml: match[0] });
        continue;
      }
      start = match.index;
      name = match[3];
      depth = 1;
    } else if (closing) {
      depth--;
      if (depth === 0) out.push({ name, xml: xml.slice(start, tag.lastIndex) });
    } else if (!selfClosing) depth++;
  }
  return out;
}

function child(xml: string, localName: string): string | undefined {
  return childElements(xml).find((element) => element.name === localName)?.xml;
}

/** `<xdr:col>2</xdr:col>` 같은 홑값 요소의 내용 */
function tagNumber(xml: string, localName: string): number {
  const match = new RegExp(`<([A-Za-z0-9_]+:)?${localName}>(-?\\d+)</`).exec(xml);
  return match ? Number(match[2]) : 0;
}

/** 특정 요소의 속성값 */
function attrOf(xml: string | undefined, localName: string, attr: string): string | undefined {
  if (!xml) return undefined;
  const match = new RegExp(`<([A-Za-z0-9_]+:)?${localName}(\\s[^>]*)?\\b${attr}="([^"]*)"`).exec(xml);
  return match?.[3];
}

/** 요소 자신(여는 태그)의 속성값 — 안쪽 자식의 같은 이름 속성을 잘못 집지 않게 */
function ownAttr(xml: string | undefined, attr: string): string | undefined {
  if (!xml) return undefined;
  const open = /^<[^>]*>/.exec(xml)?.[0] ?? "";
  return new RegExp(`\\b${attr}="([^"]*)"`).exec(open)?.[1];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

// ─── 색 ────────────────────────────────────────────────────

/** 백분율 속성(`val="75000"` = 75%)을 0~1 로. 없으면 null. */
function percent(chunk: string, name: string): number | null {
  const match = new RegExp(`<([A-Za-z0-9_]+:)?${name}\\s+val="(-?\\d+)"`).exec(chunk);
  return match ? Number(match[2]) / 100000 : null;
}

/**
 * 색 조각에서 CSS 색을 뽑는다.
 *
 * 엑셀은 기준색 하나에 보정을 얹어 색을 만든다. 이걸 무시하면 원본과 전혀 다른 색이 된다.
 *  - `lumMod`/`lumOff`: 밝기 보정. "검정, 25% 더 밝게"(#404040)나 워터마크의 연분홍이 이것.
 *    이걸 빼먹으면 워터마크 배경이 글자와 같은 진한 색이 되어 **글자가 안 보인다.**
 *  - `shade`/`tint`: 어둡게·밝게.
 *  - `alpha`: 투명도. 워터마크가 표를 가리지 않고 비쳐 보이게 하는 값이다.
 *
 * 보정은 **그 색 요소 안쪽에서만** 찾는다. 조각 전체에서 찾으면 옆에 있는 다른 색의
 * 보정값을 끌어다 쓴다(예: 글자 서식 안에 윤곽선 색과 채움 색이 함께 있는 경우).
 */
function readColor(chunk: string | undefined, ctx: Context): string | undefined {
  if (!chunk) return undefined;

  const open = /<([A-Za-z0-9_]+:)?(srgbClr|sysClr|schemeClr|prstClr)(\s[^>]*?)?(\/)?>/.exec(chunk);
  if (!open) return undefined;
  const [matched, prefix = "", tag, attrs = "", selfClosing] = open;

  let inner = "";
  if (!selfClosing) {
    const close = `</${prefix}${tag}>`;
    const end = chunk.indexOf(close, open.index);
    if (end >= 0) inner = chunk.slice(open.index + matched.length, end);
  }

  let base: string | undefined;
  if (tag === "srgbClr") base = /\bval="([0-9A-Fa-f]{6})"/.exec(attrs)?.[1];
  else if (tag === "sysClr") base = /\blastClr="([0-9A-Fa-f]{6})"/.exec(attrs)?.[1];
  else if (tag === "prstClr") base = PRESET_COLORS[/\bval="(\w+)"/.exec(attrs)?.[1] ?? ""]?.slice(1);
  else {
    const name = /\bval="([A-Za-z0-9]+)"/.exec(attrs)?.[1] ?? "";
    base = (schemeColor(ctx.theme, name) ?? "#000000").slice(1);
  }
  if (!base) return undefined;

  let [r, g, b] = hexToRgb(base);

  const lumMod = percent(inner, "lumMod");
  const lumOff = percent(inner, "lumOff");
  if (lumMod !== null || lumOff !== null) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const lit = Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0)));
    [r, g, b] = hslToRgb(h, s, lit);
  }
  const shade = percent(inner, "shade");
  if (shade !== null) [r, g, b] = [r * shade, g * shade, b * shade];
  const tint = percent(inner, "tint");
  if (tint !== null) [r, g, b] = [r, g, b].map((c) => c + (255 - c) * (1 - tint)) as [number, number, number];

  const alpha = percent(inner, "alpha");
  if (alpha !== null && alpha < 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  }
  return rgbToHex(r, g, b).toLowerCase();
}

/** 엑셀 선 모양 → 화면. 종류가 많지만 화면에서 구분되는 것은 실선·파선·점선뿐이다. */
function readDash(value: string | undefined): FormShape["dash"] {
  if (!value || value === "solid") return undefined;
  if (value.toLowerCase().includes("dot") && !value.toLowerCase().includes("dash")) return "dotted";
  return "dashed";
}

// ─── 글자 ──────────────────────────────────────────────────

/** 도형 안 글자. 문단(`a:p`)은 줄바꿈으로, 문단 안 조각(`a:r`)은 이어 붙이고 `a:br` 은 줄을 바꾼다. */
function readText(txBody: string | undefined): string {
  if (!txBody) return "";
  const text = findBlocks(txBody, "p")
    .map((paragraph) =>
      childElements(paragraph)
        .map((piece) => {
          if (piece.name === "br") return "\n";
          if (piece.name !== "r" && piece.name !== "fld") return "";
          const run = findBlocks(piece.xml, "t")[0] ?? "";
          return unescapeXml(run.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>$/, ""));
        })
        .join(""),
    )
    .join("\n")
    .replace(/\n+$/, "");
  // 보이지 않는 공백(줄바꿈 없는 공백   등)만 든 도형은 글자 없는 도형이다. 그대로 두면
  // 합치기 규칙이 "글자가 있다"로 보고 건너뛰어, 마름모 위에 글자 상자가 겹쳐 그려진다.
  return text.trim() === "" ? "" : text;
}

/** 60000분의 1도 → 도. -180~180 으로 좁혀 CSS 회전에 그대로 쓴다. */
function rotationDegrees(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const degrees = Number(raw) / 60000;
  if (!Number.isFinite(degrees)) return undefined;
  const normalized = ((degrees % 360) + 360) % 360;
  const signed = normalized > 180 ? normalized - 360 : normalized;
  return Math.abs(signed) < 0.01 ? undefined : Math.round(signed * 100) / 100;
}

// ─── 자리 ──────────────────────────────────────────────────

interface Anchor {
  col: number;
  colOff: number;
  row: number;
  rowOff: number;
}

function readAnchor(part: string | undefined): Anchor | null {
  if (!part) return null;
  return {
    col: tagNumber(part, "col"),
    colOff: tagNumber(part, "colOff"),
    row: tagNumber(part, "row"),
    rowOff: tagNumber(part, "rowOff"),
  };
}

/** 몇 번째 칸 + 그 칸 안에서의 치우침 → 격자 왼쪽 위에서의 px */
function toPx(sizes: number[], fallback: number, index: number, offsetEmu: number): number {
  let px = 0;
  for (let i = 0; i < index; i++) px += sizes[i] ?? fallback;
  return px + offsetEmu / EMU_PER_PX;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ─── 선·채움 ───────────────────────────────────────────────

/**
 * 선·테두리 색. 없으면 undefined(= 테두리를 그리지 않는다).
 *
 * `<a:ln><a:noFill/></a:ln>` 는 "테두리 없음"을 **명시**한 것이다. 이걸 못 읽고 기본 검정을
 * 넣으면, 글자만 띄우려고 둔 상자(순서도의 Yes/No 라벨, 마름모 위 글자)에 네모 테두리가 생긴다.
 * `<a:ln>` 에 색이 없으면 도형 스타일(`lnRef`)을 따르고, 스타일도 없으면 테두리가 없다.
 */
function readLine(style: string | undefined, lineBlock: string, ctx: Context): string | undefined {
  if (lineBlock) {
    if (/<([A-Za-z0-9_]+:)?noFill\s*\/>/.test(lineBlock)) return undefined;
    const color = readColor(lineBlock, ctx);
    if (color) return color;
  }
  const lnRef = style ? findBlocks(style, "lnRef")[0] : undefined;
  if (Number(ownAttr(lnRef, "idx") ?? 0) > 0) return readColor(lnRef, ctx) ?? "#000000";
  // 굵기만 적고 색을 안 적은 선은 예전처럼 검정으로 둔다(알 수 없는 파일에서 선이 사라지지 않게).
  return lineBlock ? "#000000" : undefined;
}

/**
 * 채움 색. 없으면 undefined(투명).
 *
 * spPr 에 채움을 적었으면 그걸 쓰고, 아무것도 안 적었으면 도형 스타일(`fillRef`)을 따른다 —
 * 엑셀에서 그냥 그린 네모가 파란색인 이유가 이것이다. 그림자·윤곽선 색을 채움으로 잘못
 * 집지 않도록 `ln`·`effectLst` 는 빼고 본다.
 */
function readFill(spPr: string, style: string | undefined, ctx: Context): string | undefined {
  const own = childElements(spPr);
  for (const element of own) {
    if (element.name === "noFill") return undefined;
    if (element.name === "solidFill" || element.name === "gradFill" || element.name === "pattFill") {
      return readColor(element.xml, ctx);
    }
  }
  const fillRef = style ? findBlocks(style, "fillRef")[0] : undefined;
  if (Number(ownAttr(fillRef, "idx") ?? 0) > 0) return readColor(fillRef, ctx);
  return undefined;
}

/**
 * 꺾인 연결선의 꺾는 자리(틀 너비에 대한 비율). 직선이면 undefined.
 *
 * bentConnector3 은 "가로로 가다 → 세로로 꺾고 → 다시 가로로" 가는 선이고, 꺾는 자리를
 * `adj1`(너비의 10만분율)로 적는다. 되돌아가는 화살표는 이 값이 음수로 수백 배라 선이 상자
 * 밖으로 크게 돌아 나간다. 직선으로 그리면 상자 가장자리에 달라붙어 흐름이 안 보인다.
 */
function elbowRatio(prst: string, adjust: Record<string, number>): number | undefined {
  if (prst === "bentConnector2") return 1;
  if (prst !== "bentConnector3") return undefined;
  const value = adjust.adj1 ?? adjust.adj;
  return value === undefined ? 0.5 : value / 100000;
}

/** 프리셋 도형의 조정값(`<a:gd name="adj1" fmla="val 50000"/>`) */
function readAdjust(geometry: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const gd of findBlocks(child(geometry ?? "", "avLst") ?? "", "gd")) {
    const name = ownAttr(gd, "name");
    const value = /^val\s+(-?\d+)$/.exec(ownAttr(gd, "fmla") ?? "")?.[1];
    if (name && value !== undefined) out[name] = Number(value);
  }
  return out;
}

// ─── 윤곽선 ────────────────────────────────────────────────

type Point = [number, number];

/** px 좌표로 만든 윤곽선을 틀 비율(0~1)로 바꾼다. */
function normalize(
  pieces: { op: "M" | "L" | "C" | "Q" | "Z"; points: Point[] }[],
  width: number,
  height: number,
  options: { fill?: boolean; stroke?: boolean } = {},
): FormShapePath {
  return {
    segments: pieces.map(({ op, points }) => ({
      op,
      points: points.flatMap(([x, y]) => [
        Math.round((x / width) * 10000) / 10000,
        Math.round((y / height) * 10000) / 10000,
      ]),
    })),
    fill: options.fill ?? true,
    stroke: options.stroke ?? true,
  };
}

function polygon(points: Point[]) {
  return [
    { op: "M" as const, points: [points[0]] },
    ...points.slice(1).map((point) => ({ op: "L" as const, points: [point] })),
    { op: "Z" as const, points: [] },
  ];
}

const pin = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 프리셋 도형 중 네모로 그리면 뜻이 달라지는 것들의 윤곽선.
 * 식은 DrawingML 규격(presetShapeDefinitions)을 그대로 옮겼다 — 화살촉 크기가 짧은 변(ss)에 비례한다.
 */
function presetPaths(
  prst: string,
  width: number,
  height: number,
  adjust: Record<string, number>,
): FormShapePath[] | undefined {
  const w = width;
  const h = height;
  if (!(w > 0) || !(h > 0)) return undefined;
  const ss = Math.min(w, h);
  const hc = w / 2;
  const vc = h / 2;
  const adj = (name: string, fallback: number) => adjust[name] ?? fallback;

  switch (prst) {
    case "downArrow":
    case "upArrow": {
      const a1 = pin(0, adj("adj1", 50000), 100000);
      const a2 = pin(0, adj("adj2", 50000), (100000 * h) / ss);
      const dy = (ss * a2) / 100000;
      const x1 = hc - (w * a1) / 200000;
      const x2 = hc + (w * a1) / 200000;
      const points: Point[] =
        prst === "downArrow"
          ? [[0, h - dy], [x1, h - dy], [x1, 0], [x2, 0], [x2, h - dy], [w, h - dy], [hc, h]]
          : [[0, dy], [hc, 0], [w, dy], [x2, dy], [x2, h], [x1, h], [x1, dy]];
      return [normalize(polygon(points), w, h)];
    }
    case "rightArrow":
    case "leftArrow": {
      const a1 = pin(0, adj("adj1", 50000), 100000);
      const a2 = pin(0, adj("adj2", 50000), (100000 * w) / ss);
      const dx = (ss * a2) / 100000;
      const y1 = vc - (h * a1) / 200000;
      const y2 = vc + (h * a1) / 200000;
      const points: Point[] =
        prst === "rightArrow"
          ? [[0, y1], [w - dx, y1], [w - dx, 0], [w, vc], [w - dx, h], [w - dx, y2], [0, y2]]
          : [[0, vc], [dx, 0], [dx, y1], [w, y1], [w, y2], [dx, y2], [dx, h]];
      return [normalize(polygon(points), w, h)];
    }
    case "chevron": {
      const x1 = (ss * pin(0, adj("adj", 50000), (100000 * w) / ss)) / 100000;
      return [normalize(polygon([[0, 0], [w - x1, 0], [w, vc], [w - x1, h], [0, h], [x1, vc]]), w, h)];
    }
    case "homePlate": {
      const dx = (ss * pin(0, adj("adj", 50000), (100000 * w) / ss)) / 100000;
      return [normalize(polygon([[0, 0], [w - dx, 0], [w, vc], [w - dx, h], [0, h]]), w, h)];
    }
    case "triangle": {
      const x1 = (w * pin(0, adj("adj", 50000), 100000)) / 100000;
      return [normalize(polygon([[0, h], [x1, 0], [w, h]]), w, h)];
    }
    case "parallelogram": {
      const x2 = (ss * pin(0, adj("adj", 25000), (100000 * w) / ss)) / 100000;
      return [normalize(polygon([[0, h], [x2, 0], [w, 0], [w - x2, h]]), w, h)];
    }
    case "flowChartInputOutput":
      return [normalize(polygon([[0, h], [w / 5, 0], [w, 0], [(w * 4) / 5, h]]), w, h)];
    case "flowChartPredefinedProcess":
      return [
        normalize(polygon([[0, 0], [w, 0], [w, h], [0, h]]), w, h),
        normalize(
          [
            { op: "M", points: [[w / 8, 0]] },
            { op: "L", points: [[w / 8, h]] },
            { op: "M", points: [[(w * 7) / 8, 0]] },
            { op: "L", points: [[(w * 7) / 8, h]] },
          ],
          w,
          h,
          { fill: false },
        ),
      ];
    default:
      return undefined;
  }
}

/**
 * 자유형 도형(`custGeom`) — 사용자가 점을 찍어 그린 선. 대각선·꺾인 선·범례 칸 채움에 쓰인다.
 * 좌표는 path 의 w·h(없으면 도형 자체 크기) 기준이라 그 비율로 옮긴다.
 * 점을 이름(수식)으로 적은 것과 호(arcTo)는 계산하지 않고 그 조각만 건너뛴다.
 */
function customPaths(geometry: string, frameW: number, frameH: number): FormShapePath[] {
  const out: FormShapePath[] = [];
  for (const path of findBlocks(child(geometry, "pathLst") ?? "", "path")) {
    const pathW = Number(ownAttr(path, "w") ?? frameW) || frameW;
    const pathH = Number(ownAttr(path, "h") ?? frameH) || frameH;
    if (!(pathW > 0) || !(pathH > 0)) continue;

    const pieces: { op: "M" | "L" | "C" | "Q" | "Z"; points: Point[] }[] = [];
    const ops: Record<string, "M" | "L" | "C" | "Q" | "Z"> = {
      moveTo: "M",
      lnTo: "L",
      cubicBezTo: "C",
      quadBezTo: "Q",
      close: "Z",
    };
    for (const step of childElements(path)) {
      const op = ops[step.name];
      if (!op) continue;
      const points = findBlocks(step.xml, "pt").map(
        (pt) => [Number(ownAttr(pt, "x")), Number(ownAttr(pt, "y"))] as Point,
      );
      if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) continue;
      pieces.push({ op, points });
    }
    if (pieces.length === 0) continue;
    out.push(
      normalize(pieces, pathW, pathH, {
        fill: ownAttr(path, "fill") !== "none",
        stroke: ownAttr(path, "stroke") !== "0" && ownAttr(path, "stroke") !== "false",
      }),
    );
  }
  return out;
}

// ─── 도형 하나 ─────────────────────────────────────────────

/** 글자 틀(`bodyPr`)에서 여백·세로 자리·줄바꿈·세로쓰기를 읽는다. */
function readBodyLayout(bodyPr: string | undefined): Partial<FormShape> {
  const inset = (name: string, fallback: number) => Number(ownAttr(bodyPr, name) ?? fallback) / EMU_PER_PX;
  const anchor = ownAttr(bodyPr, "anchor");
  const vert = ownAttr(bodyPr, "vert");
  return {
    inset: [inset("tIns", DEFAULT_INSET_Y), inset("rIns", DEFAULT_INSET_X), inset("bIns", DEFAULT_INSET_Y), inset("lIns", DEFAULT_INSET_X)],
    // 엑셀 규격의 기본은 "위"다. 순서도 상자는 보통 ctr 로 적혀 있다.
    valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    noWrap: ownAttr(bodyPr, "wrap") === "none" || undefined,
    vertical: vert === "vert" || vert === "vert270" || vert === "eaVert" ? vert : undefined,
  };
}

/** 도형 하나(`sp`/`cxnSp`)의 서식을 읽는다. 자리·크기는 부르는 쪽이 정해 넘긴다. */
function buildShape(block: string, rect: Rect, ctx: Context): FormShape {
  const { left, top, width, height } = rect;
  const parts = childElements(block);
  const spPr = parts.find((part) => part.name === "spPr")?.xml ?? "";
  const style = parts.find((part) => part.name === "style")?.xml;
  const txBody = parts.find((part) => part.name === "txBody")?.xml;
  const lineBlock = child(spPr, "ln") ?? "";
  const xfrm = child(spPr, "xfrm");
  const prstGeom = child(spPr, "prstGeom");
  const custGeom = child(spPr, "custGeom");

  const prst = ownAttr(prstGeom, "prst") ?? (custGeom ? "custGeom" : "rect");
  const adjust = readAdjust(prstGeom);

  let kind: FormShapeKind =
    SHAPE_KINDS[prst] ?? (prst.toLowerCase().includes("connector") ? "line" : "box");
  let paths: FormShapePath[] | undefined;
  if (custGeom) {
    const extW = Number(attrOf(xfrm, "ext", "cx") ?? 0);
    const extH = Number(attrOf(xfrm, "ext", "cy") ?? 0);
    paths = customPaths(custGeom, extW, extH);
  } else if (!SHAPE_KINDS[prst]) {
    paths = presetPaths(prst, Math.abs(width), Math.abs(height), adjust);
  }
  if (paths && paths.length > 0) kind = "path";
  else paths = undefined;

  const lineWidthEmu = Number(ownAttr(lineBlock, "w") ?? 0);
  const paragraphs = txBody ? findBlocks(txBody, "p") : [];
  const firstRun =
    paragraphs.map((p) => findBlocks(p, "rPr")[0]).find(Boolean) ??
    (txBody ? findBlocks(txBody, "endParaRPr")[0] ?? findBlocks(txBody, "defRPr")[0] : undefined) ??
    "";
  const sizeHundredths = Number(ownAttr(firstRun, "sz") ?? 0);
  const algn = txBody ? attrOf(txBody, "pPr", "algn") : undefined;
  const fontRef = style ? findBlocks(style, "fontRef")[0] : undefined;

  return {
    kind,
    left,
    top,
    width: Math.abs(width),
    height: Math.abs(height),
    flipH: ownAttr(xfrm, "flipH") === "1",
    flipV: ownAttr(xfrm, "flipV") === "1",
    arrowStart: Boolean(attrOf(lineBlock, "headEnd", "type")?.replace("none", "")),
    arrowEnd: Boolean(attrOf(lineBlock, "tailEnd", "type")?.replace("none", "")),
    text: readText(txBody),
    fill: readFill(spPr, style, ctx),
    line: readLine(style, lineBlock, ctx),
    lineWidth: (lineWidthEmu > 0 ? lineWidthEmu / EMU_PER_PT : DEFAULT_LINE_PT) * PT_TO_PX,
    dash: readDash(attrOf(lineBlock, "prstDash", "val")),
    // 회전은 60000분의 1도 단위로 들어온다. 워터마크가 비스듬히 걸려 있는 경우다.
    rotation: rotationDegrees(ownAttr(xfrm, "rot")),
    elbow: elbowRatio(prst, adjust),
    paths,
    fontSize: sizeHundredths > 0 ? sizeHundredths / 100 : undefined,
    fontFamily: attrOf(firstRun, "latin", "typeface") ?? attrOf(firstRun, "ea", "typeface"),
    bold: ownAttr(firstRun, "b") === "1",
    // 글자 색을 안 적었으면 도형 스타일의 글자 색(fontRef)을 따른다.
    color: readColor(firstRun, ctx) ?? readColor(fontRef, ctx),
    align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "l" ? "left" : undefined,
    ...(txBody ? readBodyLayout(child(txBody, "bodyPr")) : {}),
  };
}

/** 도형의 자기 틀(xfrm) — 묶음 안에서 자리를 정할 때 쓴다. */
function frameOf(element: Element): { x: number; y: number; w: number; h: number } {
  const props =
    element.name === "grpSp"
      ? child(element.xml, "grpSpPr")
      : child(element.xml, "spPr");
  const xfrm = child(props ?? "", "xfrm");
  return {
    x: Number(attrOf(xfrm, "off", "x") ?? 0),
    y: Number(attrOf(xfrm, "off", "y") ?? 0),
    w: Number(attrOf(xfrm, "ext", "cx") ?? 0),
    h: Number(attrOf(xfrm, "ext", "cy") ?? 0),
  };
}

/**
 * 묶인 도형들을 푼다.
 *
 * 엑셀에서 도형 여러 개를 묶으면(`grpSp`) 안쪽 도형의 좌표가 **그룹만의 좌표계**로
 * 바뀐다. 그룹의 `chOff`/`chExt` 가 그 좌표계의 원점과 크기이고, 화면에서 그룹이
 * 차지하는 자리는 앵커(또는 바깥 그룹)가 정한다. 둘 사이를 비례로 옮겨야 제자리에 온다.
 *
 * 자식은 **적힌 순서대로** 내보낸다. 순서가 곧 겹치는 순서라, 묶음을 먼저 풀고 상자를
 * 나중에 모으면 흰 상자가 화살표를 덮거나 반대로 회색 배경이 상자를 가린다.
 * 그룹 틀 자체의 회전·뒤집기는 다루지 않는다(샘플 양식에는 없다).
 */
function readGroup(group: string, box: Rect, ctx: Context): FormShape[] {
  const xfrm = child(child(group, "grpSpPr") ?? "", "xfrm") ?? "";
  const childX = Number(attrOf(xfrm, "chOff", "x") ?? 0);
  const childY = Number(attrOf(xfrm, "chOff", "y") ?? 0);
  const childW = Number(attrOf(xfrm, "chExt", "cx") ?? 0);
  const childH = Number(attrOf(xfrm, "chExt", "cy") ?? 0);
  // 자식 좌표계 크기를 모르면 비례를 낼 수 없다. 그때는 손대지 않는다.
  if (!(childW > 0) || !(childH > 0)) return [];

  const scaleX = box.width / childW;
  const scaleY = box.height / childH;
  const place = (frame: { x: number; y: number; w: number; h: number }): Rect => ({
    left: box.left + (frame.x - childX) * scaleX,
    top: box.top + (frame.y - childY) * scaleY,
    width: frame.w * scaleX,
    height: frame.h * scaleY,
  });

  const shapes: FormShape[] = [];
  for (const element of childElements(group)) {
    if (element.name === "grpSp") {
      shapes.push(...readGroup(element.xml, place(frameOf(element)), ctx));
    } else if (element.name === "sp" || element.name === "cxnSp") {
      const rect = place(frameOf(element));
      if (!(rect.width > 0) && !(rect.height > 0)) continue;
      shapes.push(buildShape(element.xml, rect, ctx));
    }
  }
  return shapes;
}

/**
 * 앵커 칸을 도형의 "돌리기 전" 틀로 바꾼다.
 *
 * 90°·270° 근처로 돌린 도형은 엑셀이 앵커에 **돌린 뒤 모습**의 칸을 적는다(가로·세로가 바뀐 채).
 * 그 칸을 그대로 쓰고 그리는 쪽에서 회전을 또 걸면 두 번 돌아가 가로선이 세로선이 된다.
 * 가운데는 그대로 두고 가로·세로를 되돌려, 회전은 그리는 쪽에서 한 번만 걸리게 한다.
 * 그룹 안 도형은 앵커가 아니라 틀 좌표(xfrm)로 자리를 잡으므로 여기를 거치지 않는다.
 */
function unrotatedFrame(block: string, box: Rect): Rect {
  const spPr = child(block, "spPr") ?? "";
  const rotation = rotationDegrees(ownAttr(child(spPr, "xfrm"), "rot"));
  if (rotation === undefined) return box;
  const quarter = Math.abs(rotation) % 180;
  if (quarter < 45 || quarter >= 135) return box;
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  return {
    left: centerX - box.height / 2,
    top: centerY - box.width / 2,
    width: box.height,
    height: box.width,
  };
}

/** 앵커 하나를 화면에 그릴 도형들로 바꾼다. 그룹이면 여러 개가 나온다. */
function readAnchorShapes(
  anchor: Element,
  colWidths: number[],
  rowHeights: number[],
  defaultCol: number,
  defaultRow: number,
  ctx: Context,
): FormShape[] {
  const parts = childElements(anchor.xml);
  // 그림(pic)은 exceljs 가 이미 주므로 여기서 다시 담지 않는다 — 두 번 그려진다.
  const shape = parts.find((part) => part.name === "sp" || part.name === "cxnSp" || part.name === "grpSp");
  if (!shape) return [];

  let box: Rect;
  if (anchor.name === "absoluteAnchor") {
    const pos = parts.find((part) => part.name === "pos")?.xml;
    const ext = parts.find((part) => part.name === "ext")?.xml;
    box = {
      left: Number(ownAttr(pos, "x") ?? 0) / EMU_PER_PX,
      top: Number(ownAttr(pos, "y") ?? 0) / EMU_PER_PX,
      width: Number(ownAttr(ext, "cx") ?? 0) / EMU_PER_PX,
      height: Number(ownAttr(ext, "cy") ?? 0) / EMU_PER_PX,
    };
  } else {
    const from = readAnchor(parts.find((part) => part.name === "from")?.xml);
    if (!from) return [];
    const left = toPx(colWidths, defaultCol, from.col, from.colOff);
    const top = toPx(rowHeights, defaultRow, from.row, from.rowOff);
    const to = readAnchor(parts.find((part) => part.name === "to")?.xml);
    let width: number;
    let height: number;
    if (to) {
      width = toPx(colWidths, defaultCol, to.col, to.colOff) - left;
      height = toPx(rowHeights, defaultRow, to.row, to.rowOff) - top;
    } else {
      // 한 칸에 고정된 도형은 크기를 앵커의 ext 로 따로 적는다.
      const ext = parts.find((part) => part.name === "ext")?.xml;
      width = Number(ownAttr(ext, "cx") ?? 0) / EMU_PER_PX;
      height = Number(ownAttr(ext, "cy") ?? 0) / EMU_PER_PX;
    }
    box = { left, top, width: Math.abs(width), height: Math.abs(height) };
  }

  if (shape.name === "grpSp") return readGroup(shape.xml, box, ctx);
  return [buildShape(shape.xml, unrotatedFrame(shape.xml, box), ctx)];
}

/** 도면의 앵커들을 적힌 순서대로. 호환용 겉싸개(mc:AlternateContent)는 벗겨 낸다. */
function anchorsOf(drawingXml: string): Element[] {
  const root = drawingXml.slice(drawingXml.search(/<[A-Za-z]/));
  const out: Element[] = [];
  for (const element of childElements(root)) {
    if (element.name === "AlternateContent") {
      const choice = child(element.xml, "Choice") ?? child(element.xml, "Fallback");
      out.push(...childElements(choice ?? "").filter((inner) => inner.name.endsWith("Anchor")));
    } else if (element.name.endsWith("Anchor")) {
      out.push(element);
    }
  }
  return out;
}

/** 안쪽 도형이 바깥 도형에 완전히 들어가 있나. 손으로 그린 값이라 1px 은 봐준다. */
function contains(outer: FormShape, inner: FormShape): boolean {
  const slack = 1;
  return (
    inner.left >= outer.left - slack &&
    inner.top >= outer.top - slack &&
    inner.left + inner.width <= outer.left + outer.width + slack &&
    inner.top + inner.height <= outer.top + outer.height + slack
  );
}

/**
 * 글자 없는 도형 안에 글자 도형이 하나 들어 있으면 둘을 하나로 합친다.
 *
 * 엑셀에서 흔한 패턴이다 — 모양을 내려고 장식용 도형(순서도 "문서" 기호 등)을 두고,
 * 그 안에 글자용 사각형을 얹는다. 엑셀 화면에서는 테두리가 겹쳐도 티가 잘 안 나지만,
 * 그대로 옮기면 **네모 안에 네모**가 되어 지저분하다.
 *
 * 바깥 윤곽선을 남기고 안쪽 글자를 그 자리에 넣는다. 바깥에 이미 글자가 있거나
 * 안에 글자 도형이 둘 이상이면 손대지 않는다 — 그건 겹쳐 놓은 의도가 따로 있는 것이다.
 * 선·자유형은 틀이 아니라 그림이라 바깥이 되지 않는다.
 */
function mergeDecorativeFrames(shapes: FormShape[]): FormShape[] {
  const absorbed = new Set<number>();
  const result = shapes.map((shape) => ({ ...shape }));

  result.forEach((outer, outerIndex) => {
    if (outer.kind === "line" || outer.kind === "path" || outer.text.trim() !== "") return;

    const insiders = result
      .map((shape, index) => ({ shape, index }))
      .filter(
        ({ shape, index }) =>
          index !== outerIndex &&
          !absorbed.has(index) &&
          shape.kind !== "line" &&
          shape.text.trim() !== "" &&
          contains(outer, shape),
      );
    if (insiders.length !== 1) return;

    const { shape: inner, index } = insiders[0];
    absorbed.add(index);
    outer.text = inner.text;
    outer.fontSize = inner.fontSize;
    outer.fontFamily = inner.fontFamily;
    outer.bold = inner.bold;
    outer.color = inner.color;
    outer.align = inner.align;
    outer.valign = inner.valign;
    outer.noWrap = inner.noWrap;
    outer.vertical = inner.vertical;
    // 글자는 안쪽 상자 자리에 있었다. 바깥 틀 기준 여백으로 옮겨 같은 자리에 둔다.
    const [t, r, b, l] = inner.inset ?? [0, 0, 0, 0];
    outer.inset = [
      inner.top - outer.top + t,
      outer.left + outer.width - (inner.left + inner.width) + r,
      outer.top + outer.height - (inner.top + inner.height) + b,
      inner.left - outer.left + l,
    ];
  });

  return result.filter((_, index) => !absorbed.has(index));
}

/** 견본 표시로 자주 쓰이는 말. 대소문자·앞뒤 공백은 무시하고 본다. */
const WATERMARK_WORDS = ["sample", "견본", "샘플", "예시", "specimen", "draft"];

/**
 * 이 도형이 "견본" 워터마크인가.
 *
 * 빈 양식 시트에는 실수로 그대로 쓰지 말라고 비스듬한 워터마크가 얹혀 있다. 그 시트를
 * 복사해 실제 문서를 만들 때는 지워져야 한다 — 남아 있으면 인쇄물에 "Sample" 이 찍힌다.
 *
 * 두 가지 중 하나면 워터마크로 본다:
 *  - 글자가 견본을 뜻하는 말이다(`Sample`, `견본` …)
 *  - **비스듬히 눕고 + 반투명**이다. 이 조합은 본문 도형에는 거의 없다 — 순서도 상자는
 *    똑바로 서 있고 불투명하다. 둘 중 하나만으로는 안 된다(기울기만 보면 비스듬한
 *    라벨이, 투명도만 보면 옅은 음영 상자가 함께 지워진다).
 */
export function isWatermark(shape: FormShape): boolean {
  const text = shape.text.trim().toLowerCase();
  if (text && WATERMARK_WORDS.some((word) => text === word || text.includes(word))) return true;

  const translucent = typeof shape.fill === "string" && shape.fill.startsWith("rgba(");
  return Boolean(shape.rotation) && translucent;
}

/**
 * "제출할 때 지우라"고 적어 둔 안내 상자인가.
 *
 * 견본 시트에는 `※ 제출시에는 해당 BOX 삭제 후 제출` 같은 빨간 점선 상자가 얹혀 있다.
 * 새 장을 만들 때 워터마크처럼 따라오면, 사용자가 매번 지워야 하는데 앱에서는 도형을
 * 지울 방법이 없어 그대로 인쇄된다. **상자 스스로 지우라고 말하는 경우만** 본다 —
 * `※ 주의사항` 처럼 작성할 때 참고하라는 안내는 지우지 않는다.
 */
export function isDeleteBeforeSubmitNote(shape: FormShape): boolean {
  const text = shape.text.replace(/\s+/g, "");
  if (!text) return false;
  return /(삭제|지우|제거)(후|하고|한후|해서)/.test(text) || /제출(시|전).*(삭제|지우|제거)/.test(text);
}

/** 견본 시트를 복사해 새 장을 만들 때 빼야 하는 도형 — 워터마크, 지우라고 적힌 안내 상자. */
export function isRemovedOnCopy(shape: FormShape): boolean {
  return isWatermark(shape) || isDeleteBeforeSubmitNote(shape);
}

/** 상대 경로(`../drawings/drawing1.xml`)를 압축파일 안의 절대 경로로 편다. */
function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "." || piece === "") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}

/**
 * 시트 이름 → 그 시트의 도형 목록(겹치는 순서 = 배열 순서, 뒤가 위).
 *
 * 시트와 그림 파일의 연결은 `_rels` 를 따라가야 안다. 파일 이름이 순서대로 붙는다는
 * 보장이 없어(sheet1.xml 이 두 번째 시트일 수 있다) 번호로 짐작하면 안 된다.
 */
export async function parseWorkbookShapes(
  data: ArrayBuffer,
  sizes: Map<string, { colWidths: number[]; rowHeights: number[] }>,
  defaults: { col: number; row: number },
  theme: ThemeColors = DEFAULT_THEME,
): Promise<Map<string, FormShape[]>> {
  const ctx: Context = { theme };
  const result = new Map<string, FormShape[]>();
  const index = readZipIndex(data);
  if (index.size === 0) return result;

  const workbookXml = await readZipText(data, index, "xl/workbook.xml");
  const relsXml = await readZipText(data, index, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return result;

  // 관계 id → 대상 경로
  const targets = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /\bId="([^"]+)"/.exec(rel)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel)?.[1];
    if (id && target) targets.set(id, target);
  }

  for (const sheetTag of workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = /\bname="([^"]*)"/.exec(sheetTag)?.[1];
    const relId = /\br:id="([^"]+)"/.exec(sheetTag)?.[1];
    if (!name || !relId) continue;
    const target = targets.get(relId);
    if (!target) continue;

    const sheetPath = resolvePath("xl/workbook.xml", target);
    const sheetRelsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
    const sheetRels = await readZipText(data, index, sheetRelsPath);
    if (!sheetRels) continue;

    const drawingTarget = (sheetRels.match(/<Relationship\b[^>]*\/?>/g) ?? [])
      .map((rel) => /\bTarget="([^"]+)"/.exec(rel)?.[1])
      .find((path) => path && path.includes("drawings/drawing"));
    if (!drawingTarget) continue;

    const drawingXml = await readZipText(data, index, resolvePath(sheetPath, drawingTarget));
    if (!drawingXml) continue;

    const size = sizes.get(unescapeXml(name));
    const colWidths = size?.colWidths ?? [];
    const rowHeights = size?.rowHeights ?? [];

    const shapes: FormShape[] = [];
    for (const anchor of anchorsOf(drawingXml)) {
      for (const shape of readAnchorShapes(anchor, colWidths, rowHeights, defaults.col, defaults.row, ctx)) {
        // 세로선은 너비가, 가로선은 높이가 0 이다. 둘 다 0 일 때만 버린다.
        if (shape.width > 0 || shape.height > 0) shapes.push(shape);
      }
    }
    if (shapes.length > 0) result.set(unescapeXml(name), mergeDecorativeFrames(shapes));
  }

  return result;
}
