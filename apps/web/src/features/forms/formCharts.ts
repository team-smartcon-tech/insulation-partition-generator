/**
 * 엑셀 차트(막대·꺾은선)를 읽는다.
 *
 * 차트는 exceljs 가 내주지 않아 원본 압축에서 직접 연다(도형과 같은 길: 시트 → 그림판 → 차트).
 * 값은 차트 안에 **저장해 둔 값**(numCache·strCache)을 쓴다 — 칸 수식을 다시 계산하지 않아도 되고,
 * 원본을 저장할 때 엑셀이 그린 모습과 같다.
 *
 * 회사 양식에 실제로 있는 것만 다룬다(9.4 경영검토: 묶은 세로 막대, 3차원 묶은·누적 세로 막대).
 * 3차원은 평면으로 그린다. 원형·분산형 등은 읽지 않는다 — 자리 표시도 없이 빠지지 않도록
 * 그런 차트는 빈 틀과 제목만 남긴다.
 */
import { DEFAULT_THEME } from "./colors.ts";
import type { ThemeColors } from "./colors.ts";
import {
  anchorsOf,
  child,
  childElements,
  findBlocks,
  ownAttr,
  readAnchor,
  readColor,
  resolvePath,
  toPx,
  unescapeXml,
  type ShapeContext,
} from "./formShapes.ts";
import type { FormChart, FormChartGroup } from "./types";
import { readZipIndex, readZipText } from "./zip.ts";

const EMU_PER_PX = 914400 / 96;

const allText = (xml: string | undefined) =>
  xml ? findBlocks(xml, "t").map((t) => unescapeXml(t.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>$/, ""))).join("") : "";

/** `<c:pt idx="3"><c:v>12</c:v></c:pt>` 들을 자리 번호대로 */
function readPoints(cache: string | undefined): { count: number; values: Map<number, string> } {
  const values = new Map<number, string>();
  if (!cache) return { count: 0, values };
  const count = Number(ownAttr(child(cache, "ptCount"), "val") ?? 0);
  for (const pt of findBlocks(cache, "pt")) {
    const idx = Number(ownAttr(pt, "idx") ?? -1);
    const v = findBlocks(pt, "v")[0];
    if (idx >= 0 && v !== undefined) values.set(idx, unescapeXml(v.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>$/, "")));
  }
  return { count: Math.max(count, values.size ? Math.max(...values.keys()) + 1 : 0), values };
}

/** 분류(가로축) 이름 — 글자 캐시가 없으면 숫자 캐시 */
function readCategories(ser: string): string[] {
  const cat = child(ser, "cat");
  if (!cat) return [];
  const ref = child(cat, "strRef") ?? child(cat, "numRef") ?? child(cat, "multiLvlStrRef");
  const cache = child(ref ?? "", "strCache") ?? child(ref ?? "", "numCache") ?? child(cat, "strLit") ?? child(cat, "numLit");
  const { count, values } = readPoints(cache);
  return Array.from({ length: count }, (_, i) => values.get(i) ?? "");
}

function readSeries(ser: string, ctx: ShapeContext): FormChartGroup["series"][number] {
  const tx = child(ser, "tx");
  const name = tx ? (readPoints(child(child(tx, "strRef") ?? "", "strCache")).values.get(0) ?? allText(tx)) : "";
  const val = child(ser, "val");
  const cache = child(child(val ?? "", "numRef") ?? "", "numCache") ?? child(val ?? "", "numLit");
  const { count, values } = readPoints(cache);
  const spPr = child(ser, "spPr");
  const fill = spPr ? child(spPr, "solidFill") : undefined;
  const line = spPr ? child(child(spPr, "ln") ?? "", "solidFill") : undefined;
  return {
    name,
    color: readColor(fill ?? line, ctx),
    values: Array.from({ length: count }, (_, i) => {
      const raw = values.get(i);
      const n = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    }),
  };
}

function readChart(xml: string, ctx: ShapeContext): Omit<FormChart, "left" | "top" | "width" | "height"> {
  const chart = child(xml.slice(xml.search(/<[A-Za-z]/)), "chart") ?? xml;
  const plot = child(chart, "plotArea") ?? "";
  const groups: FormChartGroup[] = [];
  let categories: string[] = [];
  for (const element of childElements(plot)) {
    const type = /^bar(3D)?Chart$/.test(element.name) ? "bar" : /^line(3D)?Chart$/.test(element.name) ? "line" : null;
    if (!type) continue;
    const series = findBlocks(element.xml, "ser");
    if (categories.length === 0 && series[0]) categories = readCategories(series[0]);
    const grouping = ownAttr(child(element.xml, "grouping"), "val");
    groups.push({
      type,
      direction: ownAttr(child(element.xml, "barDir"), "val") === "bar" ? "bar" : "col",
      grouping:
        grouping === "stacked" || grouping === "percentStacked" || grouping === "standard" ? grouping : "clustered",
      series: series.map((ser) => readSeries(ser, ctx)),
    });
  }
  const title = child(chart, "title");
  const valAx = child(plot, "valAx");
  return {
    title: title ? allText(title) || undefined : undefined,
    valueTitle: valAx ? allText(child(valAx, "title")) || undefined : undefined,
    categories,
    groups,
  };
}

/**
 * 시트 이름 → 그 시트의 차트들. 도형 읽기(`parseWorkbookShapes`)와 같은 길로 시트 → 그림판 → 차트를 찾는다.
 */
export async function parseWorkbookCharts(
  data: ArrayBuffer,
  sizes: Map<string, { colWidths: number[]; rowHeights: number[] }>,
  defaults: { col: number; row: number },
  theme: ThemeColors = DEFAULT_THEME,
): Promise<Map<string, FormChart[]>> {
  const ctx: ShapeContext = { theme };
  const result = new Map<string, FormChart[]>();
  const index = readZipIndex(data);
  if (index.size === 0) return result;
  const workbookXml = await readZipText(data, index, "xl/workbook.xml");
  const relsXml = await readZipText(data, index, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return result;

  const relTargets = (rels: string) => {
    const map = new Map<string, string>();
    for (const rel of rels.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      const id = /\bId="([^"]+)"/.exec(rel)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(rel)?.[1];
      if (id && target) map.set(id, target);
    }
    return map;
  };
  const sheetTargets = relTargets(relsXml);

  for (const sheetTag of workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = /\bname="([^"]*)"/.exec(sheetTag)?.[1];
    const target = sheetTargets.get(/\br:id="([^"]+)"/.exec(sheetTag)?.[1] ?? "");
    if (!name || !target) continue;
    const sheetPath = resolvePath("xl/workbook.xml", target);
    const sheetRels = await readZipText(data, index, sheetPath.replace(/([^/]+)$/, "_rels/$1.rels"));
    const drawingTarget = sheetRels
      ? [...relTargets(sheetRels).values()].find((path) => path.includes("drawings/drawing"))
      : undefined;
    if (!drawingTarget) continue;
    const drawingPath = resolvePath(sheetPath, drawingTarget);
    const drawingXml = await readZipText(data, index, drawingPath);
    const drawingRels = await readZipText(data, index, drawingPath.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (!drawingXml || !drawingRels) continue;
    const chartTargets = relTargets(drawingRels);

    const size = sizes.get(unescapeXml(name));
    const colWidths = size?.colWidths ?? [];
    const rowHeights = size?.rowHeights ?? [];
    const charts: FormChart[] = [];
    for (const anchor of anchorsOf(drawingXml)) {
      if (!anchor.xml.includes("graphicFrame")) continue;
      const chartRef = /<[A-Za-z0-9]*:?chart\b[^>]*\br:id="([^"]+)"/.exec(anchor.xml)?.[1];
      const chartTarget = chartRef ? chartTargets.get(chartRef) : undefined;
      if (!chartTarget) continue;
      const chartXml = await readZipText(data, index, resolvePath(drawingPath, chartTarget));
      if (!chartXml) continue;

      const parts = childElements(anchor.xml);
      const from = readAnchor(parts.find((part) => part.name === "from")?.xml);
      const to = readAnchor(parts.find((part) => part.name === "to")?.xml);
      if (!from) continue;
      const left = toPx(colWidths, defaults.col, from.col, from.colOff);
      const top = toPx(rowHeights, defaults.row, from.row, from.rowOff);
      let width: number;
      let height: number;
      if (to) {
        width = toPx(colWidths, defaults.col, to.col, to.colOff) - left;
        height = toPx(rowHeights, defaults.row, to.row, to.rowOff) - top;
      } else {
        const ext = parts.find((part) => part.name === "ext")?.xml;
        width = Number(ownAttr(ext, "cx") ?? 0) / EMU_PER_PX;
        height = Number(ownAttr(ext, "cy") ?? 0) / EMU_PER_PX;
      }
      if (!(width > 0) || !(height > 0)) continue;
      try {
        charts.push({ left, top, width, height, ...readChart(chartXml, ctx) });
      } catch {
        // 차트 하나를 못 읽어도 양식은 연다.
      }
    }
    if (charts.length > 0) result.set(unescapeXml(name), charts);
  }
  return result;
}
