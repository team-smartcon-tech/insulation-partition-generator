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
import type { FormValues } from "./types";
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
    const rowPattern = new RegExp(`<row[^>]*\\br="${rowNumber}"[^>]*(?:/>|>[\\s\\S]*?</row>)`);
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
      const cellPattern = new RegExp(`<c\\b[^>]*\\br="${change.ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
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
): Promise<FilledWorkbook> {
  const index = readZipIndex(data);
  const paths = await sheetPaths(data, index);
  const items = readZipItems(data);
  const skippedSheets: string[] = [];

  for (const [sheetName, cells] of Object.entries(values)) {
    if (Object.keys(cells).length === 0) continue;
    const path = paths.get(sheetName);
    if (!path) {
      skippedSheets.push(sheetName);
      continue;
    }
    const xml = await readZipText(data, index, path);
    if (!xml) {
      skippedSheets.push(sheetName);
      continue;
    }
    const patched = patchSheetXml(xml, cells);
    const { compressed, raw } = await deflateText(patched);
    const at = items.findIndex((item) => item.name === path);
    const replacement = {
      name: path,
      method: 8,
      crc32: crc32(raw),
      compressed,
      uncompressedSize: raw.length,
    };
    if (at >= 0) items[at] = replacement;
    else items.push(replacement);
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
