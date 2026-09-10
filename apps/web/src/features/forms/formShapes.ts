/**
 * 엑셀 도형(순서도 상자·화살표)을 읽는다.
 *
 * exceljs 는 셀·서식·그림까지는 주지만 **도형은 아예 내주지 않는다.** 그런데 업무
 * 양식의 프로세스 도(圖)는 대부분 도형으로 그려져 있어, 안 읽으면 그 시트가 통째로
 * 빈 화면이 된다. 그래서 .xlsx 압축을 직접 열어 `xl/drawings/drawing*.xml` 을 읽는다.
 *
 * 다루는 범위: 업무 양식 순서도에 실제로 쓰이는 것 — 사각형·타원·마름모·순서도
 * 기호·직선 연결선. **곡선 연결선, 그룹으로 묶은 도형, SmartArt, 차트는 못 읽는다.**
 * 이건 이 파일을 키워서 될 일이 아니라 도형 엔진을 만드는 일이라 선을 그어 둔다.
 */
import type { FormShape, FormShapeKind } from "./types";
import { readZipIndex, readZipText } from "./zip.ts";

/** 엑셀 도면 좌표 단위(EMU) → px. 914400 EMU = 1인치, 화면은 96dpi. */
const EMU_PER_PX = 914400 / 96;
/** 선 굵기 단위(EMU) → pt. 12700 EMU = 1pt. */
const EMU_PER_PT = 12700;
const PT_TO_PX = 96 / 72;
/** 굵기를 안 적은 선의 기본값(엑셀 기본 0.75pt) */
const DEFAULT_LINE_PT = 0.75;

/**
 * 테마 색 이름 → 기본 Office 테마의 색.
 *
 * 정확히 하려면 `xl/theme/theme1.xml` 을 읽어야 하지만, 업무 양식의 순서도는 거의
 * 검정 선·흰 배경이라 되돌아오는 값이 그게 전부다. 테마를 바꾼 파일에서 색이 조금
 * 다를 수 있다 — 모양이 틀리는 것보다 낫다고 보고 기본값으로 간다.
 */
const SCHEME_COLORS: Record<string, string> = {
  tx1: "#000000",
  dk1: "#000000",
  tx2: "#44546a",
  dk2: "#44546a",
  bg1: "#ffffff",
  lt1: "#ffffff",
  bg2: "#e7e6e6",
  lt2: "#e7e6e6",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
};

/** 엑셀 도형 이름 → 화면에 그릴 모양. 없는 것은 네모로 떨어진다. */
const SHAPE_KINDS: Record<string, FormShapeKind> = {
  rect: "box",
  flowChartProcess: "box",
  flowChartPredefinedProcess: "box",
  flowChartDocument: "document",
  flowChartInputOutput: "box",
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

// ─── 작은 XML 도우미 ────────────────────────────────────────
// 정식 XML 파서를 쓰지 않는 이유: 브라우저의 DOMParser 는 Node 테스트에 없고,
// 파서를 새로 들이기에는 읽을 것이 이 정도로 좁다. 대신 **여는 태그와 짝 닫는
// 태그를 직접 찾는** 방식이라 중첩된 같은 이름 태그에는 쓰지 않는다.

/** 이름이 같은 요소들의 원문 조각을 잘라 온다. 네임스페이스 접두사는 아무거나 허용. */
function findBlocks(xml: string, localName: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const open = new RegExp(`<([A-Za-z0-9_]+:)?${localName}(\\s[^>]*)?>`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml))) {
    const close = `</${match[1] ?? ""}${localName}>`;
    const end = xml.indexOf(close, open.lastIndex);
    if (end < 0) continue;
    out.push(xml.slice(match.index, end + close.length));
    open.lastIndex = end + close.length;
  }
  return out;
}

/** `<xdr:col>2</xdr:col>` 같은 홑값 요소의 내용 */
function tagNumber(xml: string, localName: string): number {
  const match = new RegExp(`<([A-Za-z0-9_]+:)?${localName}>(-?\\d+)</`).exec(xml);
  return match ? Number(match[2]) : 0;
}

/** 특정 요소의 속성값 */
function attrOf(xml: string, localName: string, attr: string): string | undefined {
  const match = new RegExp(`<([A-Za-z0-9_]+:)?${localName}(\\s[^>]*)?\\b${attr}="([^"]*)"`).exec(xml);
  return match?.[3];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

// ─── 색 ────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** 밝기 보정은 HSL 의 L 에만 걸리므로 RGB↔HSL 을 오간다. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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
 *  - `alpha`: 투명도. 워터마크가 표를 가리지 않고 비쳐 보이게 하는 값이다.
 *
 * 보정은 **그 색 요소 안쪽에서만** 찾는다. 조각 전체에서 찾으면 옆에 있는 다른 색의
 * 보정값을 끌어다 쓴다(예: 글자 서식 안에 윤곽선 색과 채움 색이 함께 있는 경우).
 */
function readColor(chunk: string | undefined): string | undefined {
  if (!chunk) return undefined;

  const open = /<([A-Za-z0-9_]+:)?(srgbClr|sysClr|schemeClr)(\s[^>]*?)?(\/)?>/.exec(chunk);
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
  else {
    const name = /\bval="([A-Za-z0-9]+)"/.exec(attrs)?.[1];
    base = (SCHEME_COLORS[name ?? ""] ?? "#000000").replace("#", "");
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

  const alpha = percent(inner, "alpha");
  if (alpha !== null && alpha < 1) return `rgba(${r}, ${g}, ${b}, ${alpha})`;

  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** 엑셀 선 모양 → 화면. 종류가 많지만 화면에서 구분되는 것은 실선·파선·점선뿐이다. */
function readDash(value: string | undefined): FormShape["dash"] {
  if (!value || value === "solid") return undefined;
  if (value.toLowerCase().includes("dot") && !value.toLowerCase().includes("dash")) return "dotted";
  return "dashed";
}

/** 도형 안 글자. 문단(`a:p`)은 줄바꿈으로, 문단 안 조각(`a:r`)은 이어 붙인다. */
function readText(txBody: string | undefined): string {
  if (!txBody) return "";
  return findBlocks(txBody, "p")
    .map((paragraph) =>
      findBlocks(paragraph, "t")
        .map((run) => unescapeXml(run.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>$/, "")))
        .join(""),
    )
    .join("\n")
    .replace(/\n+$/, "");
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

interface Anchor {
  col: number;
  colOff: number;
  row: number;
  rowOff: number;
}

function readAnchor(block: string, which: "from" | "to"): Anchor | null {
  const part = findBlocks(block, which)[0];
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

/** 도형 하나(`sp`/`cxnSp`)의 서식을 읽는다. 자리·크기는 부르는 쪽이 정해 넘긴다. */
function buildShape(block: string, rect: Rect): FormShape {
  const { left, top, width, height } = rect;
  const spPr = findBlocks(block, "spPr")[0] ?? "";
  const lineBlock = findBlocks(spPr, "ln")[0] ?? "";
  // 선 색과 채움 색이 둘 다 solidFill 이라, 선 부분을 들어낸 나머지에서 채움을 찾는다.
  const fillArea = lineBlock ? spPr.replace(lineBlock, "") : spPr;

  const prst = attrOf(spPr, "prstGeom", "prst") ?? "rect";
  const kind = SHAPE_KINDS[prst] ?? (prst.toLowerCase().includes("connector") ? "line" : "box");

  const noFill = /<([A-Za-z0-9_]+:)?noFill\s*\/>/.test(fillArea);
  const lineWidthEmu = Number(attrOf(spPr, "ln", "w") ?? 0);

  const txBody = findBlocks(block, "txBody")[0];
  const firstRun = txBody ? (findBlocks(txBody, "rPr")[0] ?? "") : "";
  const sizeHundredths = Number(attrOf(txBody ?? "", "rPr", "sz") ?? 0);
  const algn = attrOf(txBody ?? "", "pPr", "algn");

  return {
    kind,
    left,
    top,
    width: Math.abs(width),
    height: Math.abs(height),
    flipH: attrOf(spPr, "xfrm", "flipH") === "1",
    flipV: attrOf(spPr, "xfrm", "flipV") === "1",
    arrowStart: Boolean(attrOf(lineBlock, "headEnd", "type")?.replace("none", "")),
    arrowEnd: Boolean(attrOf(lineBlock, "tailEnd", "type")?.replace("none", "")),
    text: readText(txBody),
    fill: noFill ? undefined : readColor(fillArea),
    line: readColor(lineBlock) ?? "#000000",
    lineWidth:
      (lineWidthEmu > 0 ? lineWidthEmu / EMU_PER_PT : DEFAULT_LINE_PT) * PT_TO_PX,
    dash: readDash(attrOf(lineBlock, "prstDash", "val")),
    // 회전은 60000분의 1도 단위로 들어온다. 워터마크가 비스듬히 걸려 있는 경우다.
    rotation: rotationDegrees(attrOf(spPr, "xfrm", "rot")),
    fontSize: sizeHundredths > 0 ? sizeHundredths / 100 : undefined,
    fontFamily: attrOf(firstRun, "latin", "typeface"),
    bold: attrOf(txBody ?? "", "rPr", "b") === "1",
    color: readColor(firstRun) ?? undefined,
    align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "l" ? "left" : undefined,
  };
}

/**
 * 그룹으로 묶인 도형들을 푼다.
 *
 * 엑셀에서 도형 여러 개를 묶으면(`grpSp`) 안쪽 도형의 좌표가 **그룹만의 좌표계**로
 * 바뀐다. 그룹의 `chOff`/`chExt` 가 그 좌표계의 원점과 크기이고, 화면에서 그룹이
 * 차지하는 자리는 앵커가 정한다. 둘 사이를 비례로 옮겨야 제자리에 온다.
 *
 * 그룹을 통째로 건너뛰면 묶인 상자들이 화면에서 사라진다 — 순서도의 첫 상자가
 * 글자 없는 빈 네모로 나오던 원인이 이것이었다.
 */
function readGroup(group: string, box: Rect): FormShape[] {
  const xfrm = findBlocks(findBlocks(group, "grpSpPr")[0] ?? "", "xfrm")[0] ?? "";
  const childX = Number(attrOf(xfrm, "chOff", "x") ?? 0);
  const childY = Number(attrOf(xfrm, "chOff", "y") ?? 0);
  const childW = Number(attrOf(xfrm, "chExt", "cx") ?? 0);
  const childH = Number(attrOf(xfrm, "chExt", "cy") ?? 0);
  // 자식 좌표계 크기를 모르면 비례를 낼 수 없다. 그때는 손대지 않는다.
  if (!(childW > 0) || !(childH > 0)) return [];

  const scaleX = box.width / childW;
  const scaleY = box.height / childH;

  // 안쪽에 또 묶인 그룹이 있으면 먼저 떼어 내 재귀로 풀고, 남은 것에서 도형을 찾는다.
  let rest = group;
  const shapes: FormShape[] = [];
  for (const inner of findBlocks(group.slice(group.indexOf(">") + 1), "grpSp")) {
    rest = rest.replace(inner, "");
    const innerXfrm = findBlocks(findBlocks(inner, "grpSpPr")[0] ?? "", "xfrm")[0] ?? "";
    shapes.push(
      ...readGroup(inner, {
        left: box.left + (Number(attrOf(innerXfrm, "off", "x") ?? 0) - childX) * scaleX,
        top: box.top + (Number(attrOf(innerXfrm, "off", "y") ?? 0) - childY) * scaleY,
        width: Number(attrOf(innerXfrm, "ext", "cx") ?? 0) * scaleX,
        height: Number(attrOf(innerXfrm, "ext", "cy") ?? 0) * scaleY,
      }),
    );
  }

  for (const child of [...findBlocks(rest, "sp"), ...findBlocks(rest, "cxnSp")]) {
    const childXfrm = findBlocks(findBlocks(child, "spPr")[0] ?? "", "xfrm")[0] ?? "";
    const width = Number(attrOf(childXfrm, "ext", "cx") ?? 0) * scaleX;
    const height = Number(attrOf(childXfrm, "ext", "cy") ?? 0) * scaleY;
    if (!(width > 0) && !(height > 0)) continue;
    shapes.push(
      buildShape(child, {
        left: box.left + (Number(attrOf(childXfrm, "off", "x") ?? 0) - childX) * scaleX,
        top: box.top + (Number(attrOf(childXfrm, "off", "y") ?? 0) - childY) * scaleY,
        width,
        height,
      }),
    );
  }
  return shapes;
}

/** 앵커 하나를 화면에 그릴 도형들로 바꾼다. 그룹이면 여러 개가 나온다. */
function readAnchorShapes(
  block: string,
  colWidths: number[],
  rowHeights: number[],
  defaultCol: number,
  defaultRow: number,
): FormShape[] {
  // 그림(pic)은 exceljs 가 이미 주므로 여기서 다시 담지 않는다 — 두 번 그려진다.
  if (!/<([A-Za-z0-9_]+:)?(sp|cxnSp|grpSp)(\s|>)/.test(block)) return [];

  const from = readAnchor(block, "from");
  if (!from) return [];
  const left = toPx(colWidths, defaultCol, from.col, from.colOff);
  const top = toPx(rowHeights, defaultRow, from.row, from.rowOff);

  const to = readAnchor(block, "to");
  let width: number;
  let height: number;
  if (to) {
    width = toPx(colWidths, defaultCol, to.col, to.colOff) - left;
    height = toPx(rowHeights, defaultRow, to.row, to.rowOff) - top;
  } else {
    // 한 칸에 고정된 도형은 크기를 따로 적는다.
    const spPr = findBlocks(block, "spPr")[0] ?? findBlocks(block, "grpSpPr")[0] ?? "";
    width = Number(attrOf(spPr, "ext", "cx") ?? 0) / EMU_PER_PX;
    height = Number(attrOf(spPr, "ext", "cy") ?? 0) / EMU_PER_PX;
  }
  const box: Rect = { left, top, width: Math.abs(width), height: Math.abs(height) };

  const group = findBlocks(block, "grpSp")[0];
  if (group) return readGroup(group, box);
  return [buildShape(block, box)];
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
 */
function mergeDecorativeFrames(shapes: FormShape[]): FormShape[] {
  const absorbed = new Set<number>();
  const result = shapes.map((shape) => ({ ...shape }));

  result.forEach((outer, outerIndex) => {
    if (outer.kind === "line" || outer.text !== "") return;

    const insiders = result
      .map((shape, index) => ({ shape, index }))
      .filter(
        ({ shape, index }) =>
          index !== outerIndex &&
          !absorbed.has(index) &&
          shape.kind !== "line" &&
          shape.text !== "" &&
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
 * 시트 이름 → 그 시트의 도형 목록.
 *
 * 시트와 그림 파일의 연결은 `_rels` 를 따라가야 안다. 파일 이름이 순서대로 붙는다는
 * 보장이 없어(sheet1.xml 이 두 번째 시트일 수 있다) 번호로 짐작하면 안 된다.
 */
export async function parseWorkbookShapes(
  data: ArrayBuffer,
  sizes: Map<string, { colWidths: number[]; rowHeights: number[] }>,
  defaults: { col: number; row: number },
): Promise<Map<string, FormShape[]>> {
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
    for (const kind of ["twoCellAnchor", "oneCellAnchor"]) {
      for (const block of findBlocks(drawingXml, kind)) {
        for (const shape of readAnchorShapes(
          block,
          colWidths,
          rowHeights,
          defaults.col,
          defaults.row,
        )) {
          // 세로선은 너비가, 가로선은 높이가 0 이다. 둘 다 0 일 때만 버린다.
          if (shape.width > 0 || shape.height > 0) shapes.push(shape);
        }
      }
    }
    if (shapes.length > 0) result.set(unescapeXml(name), mergeDecorativeFrames(shapes));
  }

  return result;
}
