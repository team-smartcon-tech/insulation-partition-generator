/**
 * 양식을 엑셀 파일로 내려받는다.
 *
 * 두 가지를 준다:
 *  - **채운 내용 포함**: 올린 원본에 화면에서 적은 글자를 덮어써서 내려받는다.
 *  - **원본 그대로**: 올릴 때의 빈 양식 파일.
 *
 * 만드는 방법이 중요하다. 엑셀 라이브러리로 **다시 저장하면 도형이 사라진다**(실제로
 * 순서도가 통째로 날아갔다 — 테스트로 잡았다). 그래서 원본 .xlsx 를 열어 **글자가 적힌
 * 시트 파일 하나만 고치고 나머지는 압축된 바이트 그대로 복사**한다. 우리가 모르는 것
 * (차트·SmartArt·수식·인쇄 설정)은 손대지 않으니 그대로 남는다.
 */
import {
  DRAWING_CONTENT_TYPE,
  EMPTY_DRAWING,
  EMPTY_RELS,
  REL_DRAWING,
  REL_IMAGE,
  REL_WORKSHEET,
  addRelationship,
  insertDrawingTag,
  maxShapeId,
  sheetGeometry,
  stampAnchorsXml,
  type ApprovalStamp,
} from "./approvalExport.ts";
import {
  addSheetToWorkbook,
  copiedSheetXml,
  copyPrintArea,
  stripSampleAnchors,
} from "./sheetCopyExport.ts";
import type { FormValues } from "./types";

const SHEET_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
/** 관계 파일 경로(`xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels`) */
const relsPathOf = (partPath: string) => partPath.replace(/([^/]+)$/, "_rels/$1.rels");
/** 관계 파일에서 id 로 대상 경로 찾기 */
function relTarget(relsXml: string, id: string): string | undefined {
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    if (new RegExp(`\\bId="${id}"`).test(rel)) return /\bTarget="([^"]+)"/.exec(rel)?.[1];
  }
  return undefined;
}
import { crc32, deflateText, readZipIndex, readZipItems, readZipText, writeZip } from "./zip.ts";

/** `3:2` → 3행 2열. 셀 키는 저장 때부터 이 모양이다. */
function parseCellKey(key: string): { row: number; col: number } | null {
  const [row, col] = key.split(":").map(Number);
  if (!Number.isFinite(row) || !Number.isFinite(col) || row < 1 || col < 1) return null;
  return { row, col };
}

/** 1 → A, 27 → AA */
function columnName(col: number): string {
  let name = "";
  let rest = col;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 상대 경로를 압축파일 안의 절대 경로로 편다. */
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

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 시트 이름 → 압축파일 안의 시트 XML 경로 */
async function sheetPaths(data: ArrayBuffer, index: Map<string, unknown>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const workbookXml = await readZipText(data, index as never, "xl/workbook.xml");
  const relsXml = await readZipText(data, index as never, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return result;

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
    if (target) result.set(unescapeXml(name), resolvePath("xl/workbook.xml", target));
  }
  return result;
}

/** 한 칸을 "글자를 직접 품은 칸"으로 바꾼 XML 조각. 칸의 서식(s)은 그대로 물려받는다. */
function cellXml(ref: string, styleAttr: string, text: string): string {
  if (text === "") return `<c r="${ref}"${styleAttr}/>`;
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/**
 * 시트 XML 에서 칸 값만 갈아 끼운다.
 *
 * 있는 칸은 서식(`s="12"`)을 지키며 내용만 바꾸고, 없는 칸은 열 순서에 맞게 끼워 넣는다.
 * 줄(`<row>`) 자체가 없으면 줄도 만들어 넣는다.
 */
export function patchSheetXml(xml: string, cells: Record<string, string>): string {
  // 행 번호 → 그 행에서 바꿀 것들
  const byRow = new Map<number, { col: number; ref: string; text: string }[]>();
  for (const [key, text] of Object.entries(cells)) {
    const at = parseCellKey(key);
    if (!at) continue;
    const list = byRow.get(at.row) ?? [];
    list.push({ col: at.col, ref: `${columnName(at.col)}${at.row}`, text });
    byRow.set(at.row, list);
  }
  if (byRow.size === 0) return xml;

  let result = xml;
  for (const [rowNumber, changes] of [...byRow.entries()].sort(([a], [b]) => a - b)) {
    changes.sort((a, b) => a.col - b.col);

    // 1) 그 줄을 찾는다.
    // `[^>]*` 를 **최소로** 집는다. 욕심내면 `<row .../>` 의 `/` 까지 삼킨 뒤 다음 줄의 `</row>` 까지
    // 한 덩어리로 잡아, 사이에 있는 줄이 통째로 지워진다.
    const rowPattern = new RegExp(`<row[^>]*?\\br="${rowNumber}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    const rowMatch = rowPattern.exec(result);
    if (!rowMatch) {
      // 줄이 아예 없으면 새로 만들어 sheetData 안 제자리에 끼운다.
      const body = changes.map((change) => cellXml(change.ref, "", change.text)).join("");
      const newRow = `<row r="${rowNumber}">${body}</row>`;
      const next = new RegExp(`<row[^>]*\\br="(\\d+)"`, "g");
      let insertAt = -1;
      let found: RegExpExecArray | null;
      while ((found = next.exec(result))) {
        if (Number(found[1]) > rowNumber) {
          insertAt = found.index;
          break;
        }
      }
      if (insertAt < 0) {
        const close = result.indexOf("</sheetData>");
        insertAt = close >= 0 ? close : -1;
      }
      result = insertAt >= 0 ? result.slice(0, insertAt) + newRow + result.slice(insertAt) : result;
      continue;
    }

    let row = rowMatch[0];
    // 닫힌 형태(`<row .../>`)면 내용을 담을 수 있게 편다.
    if (row.endsWith("/>")) row = `${row.slice(0, -2)}></row>`;

    for (const change of changes) {
      // 위와 같은 이유로 최소 일치. `<c r="A1" s="44"/>` 에 글자를 쓰면 뒤따르는 칸들이 지워졌다
      // (실제로 복사한 장에서 제목 칸이 사라졌다).
      const cellPattern = new RegExp(`<c\\b[^>]*?\\br="${change.ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const cellMatch = cellPattern.exec(row);
      if (cellMatch) {
        const styleAttr = / s="(\d+)"/.exec(cellMatch[0])?.[0] ?? "";
        row = row.replace(cellMatch[0], cellXml(change.ref, styleAttr, change.text));
        continue;
      }
      // 없는 칸은 열 순서를 지켜 끼워 넣는다(엑셀은 칸이 열 순서대로 있기를 기대한다).
      const cells = [...row.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)];
      const after = cells.find((entry) => {
        const letters = entry[1];
        return letters.length > columnName(change.col).length
          ? true
          : letters.length === columnName(change.col).length && letters > columnName(change.col);
      });
      const piece = cellXml(change.ref, "", change.text);
      if (after) row = row.slice(0, after.index) + piece + row.slice(after.index);
      else row = row.replace("</row>", `${piece}</row>`);
    }
    result = result.replace(rowMatch[0], row);
  }
  return result;
}

/**
 * 인쇄 영역을 넓힌다 — 화면에서 줄을 더해 적었는데 인쇄 영역이 옛 끝 줄에 멈춰 있으면,
 * 내려받은 파일을 인쇄할 때 **더한 줄이 통째로 빠진다.**
 *
 * 인쇄 영역은 워크북의 이름 정의(`_xlnm.Print_Area`)에 시트별로 들어 있다
 * (`'시트명'!$A$1:$K$33`). 적은 줄이 그 끝 줄보다 아래면 끝 줄만 늘린다.
 */
export function extendPrintArea(workbookXml: string, lastRowBySheetIndex: Map<number, number>): string {
  return workbookXml.replace(
    /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*localSheetId="(\d+)"[^>]*>([\s\S]*?)<\/definedName>/g,
    (whole, sheetIndex: string, area: string) => {
      const needed = lastRowBySheetIndex.get(Number(sheetIndex));
      if (!needed) return whole;
      // 여러 조각(`A1:C9,E1:G9`)이면 조각마다 끝 줄을 본다.
      const next = area.replace(/(\$?[A-Z]+\$?)(\d+)(?=\s*(?:,|$))/g, (piece, column: string, row: string) =>
        Number(row) < needed ? `${column}${needed}` : piece,
      );
      return whole.replace(area, next);
    },
  );
}

export interface FilledWorkbook {
  bytes: ArrayBuffer;
  /** 엑셀에 없어 넣지 못한 시트 이름(앱에서 더한 월별 장 등) */
  skippedSheets: string[];
}

/**
 * 올린 원본에 적은 글자를 얹어 새 엑셀 바이트를 만든다.
 *
 * 앱에서 더한 시트(월별 장)는 원본 엑셀에 없는 시트라 여기서 만들 수 없다. 조용히 빼면
 * 적은 내용이 사라진 줄 모르고 넘어가므로, 뺀 시트 이름을 함께 돌려줘 화면에서 알린다.
 */
export async function buildFilledWorkbook(
  data: ArrayBuffer,
  values: FormValues,
  /** 시트 이름 → 결재칸에 찍을 도장(서명·구분선·이름). 날짜는 values 로 넘긴다. */
  stamps: Record<string, ApprovalStamp[]> = {},
  /** 앱에서 더한 장(월별 시트) — 원본 시트를 복사해 진짜 시트로 만들어 넣는다. */
  customSheets: { name: string; source: string }[] = [],
): Promise<FilledWorkbook> {
  const index = readZipIndex(data);
  const paths = await sheetPaths(data, index);
  const order = [...paths.keys()];
  const items = readZipItems(data);
  const skippedSheets: string[] = [];
  /** 시트 번호 → 글자를 적은 마지막 줄(인쇄 영역을 여기까지 늘린다) */
  const lastRowBySheetIndex = new Map<number, number>();

  // 손댄 XML 은 여기 담아 두고 읽는다 — 같은 파일(내용 형식 목록 등)을 여러 시트가 차례로 고친다.
  const edited = new Map<string, string>();
  const readText = async (name: string) => edited.get(name) ?? (await readZipText(data, index, name));
  const putText = async (name: string, text: string) => {
    edited.set(name, text);
    const { compressed, raw } = await deflateText(text);
    putItem({ name, method: 8, crc32: crc32(raw), compressed, uncompressedSize: raw.length });
  };
  function putItem(item: (typeof items)[number]) {
    const at = items.findIndex((entry) => entry.name === item.name);
    if (at >= 0) items[at] = item;
    else items.push(item);
  }
  const freeName = (make: (n: number) => string) => {
    let n = 1;
    while (items.some((item) => item.name === make(n))) n += 1;
    return make(n);
  };
  const newOverrides: { part: string; type: string }[] = [];
  let addedImages = false;

  /** 시트에 결재 도장을 얹는다. 시트에 그림 판(drawing)이 없으면 만들어 붙인다. 고친 시트 XML 을 돌려준다. */
  async function attachStamps(sheetPath: string, sheetXml: string, list: ApprovalStamp[]): Promise<string> {
    const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
    let sheetRels = (await readText(relsPath)) ?? EMPTY_RELS;
    let xml = sheetXml;
    let drawingPath: string;

    const existingId = /<drawing\b[^>]*\br:id="([^"]+)"/.exec(xml)?.[1];
    const existingTarget = existingId
      ? new RegExp(`<Relationship\\b[^>]*\\bId="${existingId}"[^>]*\\bTarget="([^"]+)"`).exec(sheetRels)?.[1] ??
        new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${existingId}"`).exec(sheetRels)?.[1]
      : undefined;
    if (existingTarget) {
      drawingPath = resolvePath(sheetPath, existingTarget);
    } else {
      drawingPath = freeName((n) => `xl/drawings/drawing${n}.xml`);
      const target = `../drawings/${drawingPath.split("/").pop()}`;
      const added = addRelationship(sheetRels, REL_DRAWING, target);
      sheetRels = added.xml;
      await putText(relsPath, sheetRels);
      xml = insertDrawingTag(xml, added.id);
      newOverrides.push({ part: `/${drawingPath}`, type: DRAWING_CONTENT_TYPE });
    }

    const drawingRelsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
    let drawingXml = (await readText(drawingPath)) ?? EMPTY_DRAWING;
    let drawingRels = (await readText(drawingRelsPath)) ?? EMPTY_RELS;
    // 다른 접두어로 쓴 그림 판이면 우리가 쓰는 접두어(xdr·a)를 뿌리에 알린다.
    drawingXml = drawingXml.replace(/<xdr:wsDr\b([^>]*)>/, (whole, attrs: string) => {
      let next = attrs;
      if (!/xmlns:a=/.test(next)) next += ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
      return `<xdr:wsDr${next}>`;
    });

    const geometry = sheetGeometry(xml);
    let nextId = maxShapeId(drawingXml) + 1;
    let anchors = "";
    for (const stamp of list) {
      const mediaPath = freeName((n) => `xl/media/approval${n}.png`);
      putItem({ name: mediaPath, method: 0, crc32: crc32(stamp.png), compressed: stamp.png, uncompressedSize: stamp.png.length });
      const rel = addRelationship(drawingRels, REL_IMAGE, `../media/${mediaPath.split("/").pop()}`);
      drawingRels = rel.xml;
      anchors += stampAnchorsXml(stamp, geometry, rel.id, nextId);
      nextId += 3;
      addedImages = true;
    }
    await putText(drawingPath, drawingXml.replace("</xdr:wsDr>", `${anchors}</xdr:wsDr>`));
    await putText(drawingRelsPath, drawingRels);
    return xml;
  }

  /**
   * 앱에서 더한 장을 진짜 시트로 만들어 붙인다 — 원본 시트 XML 을 그대로 복사하고 이름만 바꾼다.
   * 그림 판은 따로 복사해 견본 표시(워터마크·"제출 시 삭제" 상자)를 뺀다. 화면의 복사 규칙과 같다.
   */
  let workbookXml = (await readText("xl/workbook.xml")) ?? "";
  let workbookRels = (await readText("xl/_rels/workbook.xml.rels")) ?? EMPTY_RELS;
  let addedSheet = false;
  for (const custom of customSheets) {
    if (paths.has(custom.name)) continue; // 같은 이름의 진짜 시트가 이미 있다
    const sourcePath = paths.get(custom.source);
    const sourceXml = sourcePath ? await readText(sourcePath) : undefined;
    if (!sourcePath || !sourceXml || !workbookXml) {
      skippedSheets.push(custom.name);
      continue;
    }

    // 1) 그림 판 복사(견본 표시 빼고). 두 시트가 같은 그림 판을 가리키면 엑셀이 파일을 고친다.
    const sourceRels = (await readText(relsPathOf(sourcePath))) ?? EMPTY_RELS;
    const sourceDrawingId = /<drawing\b[^>]*\br:id="([^"]+)"/.exec(sourceXml)?.[1];
    const sourceDrawingTarget = sourceDrawingId ? relTarget(sourceRels, sourceDrawingId) : undefined;
    let newSheetRels: string | undefined;
    let drawingRelId: string | undefined;
    if (sourceDrawingTarget) {
      const sourceDrawingPath = resolvePath(sourcePath, sourceDrawingTarget);
      const sourceDrawing = await readText(sourceDrawingPath);
      if (sourceDrawing) {
        const newDrawingPath = freeName((n) => `xl/drawings/drawing${n}.xml`);
        await putText(newDrawingPath, stripSampleAnchors(sourceDrawing).xml);
        newOverrides.push({ part: `/${newDrawingPath}`, type: DRAWING_CONTENT_TYPE });
        // 그림 파일(로고 등)은 그대로 다시 쓴다 — 관계 파일만 복사하면 같은 media 를 가리킨다.
        const sourceDrawingRels = await readText(relsPathOf(sourceDrawingPath));
        if (sourceDrawingRels) await putText(relsPathOf(newDrawingPath), sourceDrawingRels);
        const rel = addRelationship(EMPTY_RELS, REL_DRAWING, `../drawings/${newDrawingPath.split("/").pop()}`);
        newSheetRels = rel.xml;
        drawingRelId = rel.id;
      }
    }

    // 2) 시트 XML 복사 → 새 파일로
    const newSheetPath = freeName((n) => `xl/worksheets/sheet${n}.xml`);
    await putText(newSheetPath, copiedSheetXml(sourceXml, drawingRelId));
    if (newSheetRels) await putText(relsPathOf(newSheetPath), newSheetRels);
    newOverrides.push({ part: `/${newSheetPath}`, type: SHEET_CONTENT_TYPE });

    // 3) 워크북에 등록하고 인쇄 영역도 따라 붙인다(새 시트는 맨 뒤).
    const wbRel = addRelationship(workbookRels, REL_WORKSHEET, `worksheets/${newSheetPath.split("/").pop()}`);
    workbookRels = wbRel.xml;
    workbookXml = addSheetToWorkbook(workbookXml, custom.name, wbRel.id);
    workbookXml = copyPrintArea(workbookXml, order.indexOf(custom.source), order.length, custom.name);
    order.push(custom.name);
    paths.set(custom.name, newSheetPath);
    addedSheet = true;
  }
  if (addedSheet) {
    await putText("xl/_rels/workbook.xml.rels", workbookRels);
    await putText("xl/workbook.xml", workbookXml);
  }

  const sheetNames = new Set([
    ...Object.entries(values).filter(([, cells]) => Object.keys(cells).length > 0).map(([name]) => name),
    ...Object.entries(stamps).filter(([, list]) => list.length > 0).map(([name]) => name),
  ]);
  for (const sheetName of sheetNames) {
    const cells = values[sheetName] ?? {};
    const path = paths.get(sheetName);
    if (!path) {
      skippedSheets.push(sheetName);
      continue;
    }
    const xml = await readText(path);
    if (!xml) {
      skippedSheets.push(sheetName);
      continue;
    }
    if (Object.keys(cells).length > 0) {
      const lastRow = Math.max(...Object.keys(cells).map((key) => Number(key.split(":")[0]) || 0));
      const sheetIndex = order.indexOf(sheetName);
      if (sheetIndex >= 0 && Number.isFinite(lastRow)) lastRowBySheetIndex.set(sheetIndex, lastRow);
    }

    let patched = patchSheetXml(xml, cells);
    if (stamps[sheetName]?.length) patched = await attachStamps(path, patched, stamps[sheetName]);
    await putText(path, patched);
  }

  // 새로 만든 그림 판·PNG 를 엑셀이 알아보도록 내용 형식 목록에 올린다.
  if (newOverrides.length > 0 || addedImages) {
    let types = (await readText("[Content_Types].xml")) ?? "";
    if (addedImages && !/<Default\b[^>]*Extension="png"/i.test(types)) {
      types = types.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
    }
    for (const { part, type } of newOverrides) {
      types = types.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`);
    }
    await putText("[Content_Types].xml", types);
  }

  // 인쇄 영역도 함께 늘린다(줄을 더해 적은 경우).
  const latestWorkbook = (await readText("xl/workbook.xml")) ?? "";
  if (latestWorkbook && lastRowBySheetIndex.size > 0) {
    const nextWorkbook = extendPrintArea(latestWorkbook, lastRowBySheetIndex);
    if (nextWorkbook !== latestWorkbook) await putText("xl/workbook.xml", nextWorkbook);
  }

  return { bytes: writeZip(items), skippedSheets };
}

/** 내려받을 파일 이름 — `101. 이해관계자.xlsx` → `101. 이해관계자 (작성본).xlsx` */
export function filledFileName(fileName: string): string {
  const base = fileName.replace(/\.xlsx$/i, "");
  return `${base} (작성본).xlsx`;
}

/** 바이트를 파일로 저장시킨다. 브라우저에서만 쓴다. */
export function downloadBytes(bytes: ArrayBuffer, fileName: string): void {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // 바로 지우면 저장이 시작되기 전에 주소가 끊길 수 있다.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
