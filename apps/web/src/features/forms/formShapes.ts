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

/** 앵커 하나(도형 하나)를 화면에 그릴 값으로 바꾼다. */
function readShape(
  block: string,
  colWidths: number[],
  rowHeights: number[],
  defaultCol: number,
  defaultRow: number,
): FormShape | null {
  // 그림(pic)은 exceljs 가 이미 주므로 여기서 다시 담지 않는다 — 두 번 그려진다.
  const isShape = /<([A-Za-z0-9_]+:)?(sp|cxnSp)(\s|>)/.test(block);
  if (!isShape) return null;

  const from = readAnchor(block, "from");
  if (!from) return null;
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
    const ext = findBlocks(block, "spPr")[0] ?? "";
    width = Number(attrOf(ext, "ext", "cx") ?? 0) / EMU_PER_PX;
    height = Number(attrOf(ext, "ext", "cy") ?? 0) / EMU_PER_PX;
  }

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
        const shape = readShape(block, colWidths, rowHeights, defaults.col, defaults.row);
        // 세로선은 너비가, 가로선은 높이가 0 이다. 둘 다 0 일 때만 버린다.
        if (shape && (shape.width > 0 || shape.height > 0)) shapes.push(shape);
      }
    }
    if (shapes.length > 0) result.set(unescapeXml(name), mergeDecorativeFrames(shapes));
  }

  return result;
}
