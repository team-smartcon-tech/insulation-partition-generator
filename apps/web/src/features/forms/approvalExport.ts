/**
 * 결재 도장을 엑셀에 넣는다 — 서명 그림, 구분선, 이름을 **떠 있는 그림·도형**으로 결재칸 위에 얹는다.
 *
 * 칸을 고치지 않는 이유: 결재칸은 여러 칸을 합친 칸이라, 안에 선을 긋거나 이름 줄을 만들려면
 * 칸을 나눠야 하고 그러면 양식이 바뀐다. 엑셀의 그림·도형은 칸 위에 떠 있어서 양식을 건드리지
 * 않는다(원래 서명 그림도 엑셀에서는 이렇게 붙인다). 화면에서 보이는 모양(서명 · 선 · 이름)과 같게 만든다.
 *
 * 위치는 "몇 번째 칸에서 얼마나 떨어졌나"(twoCellAnchor)로 적는다 — 줄 높이를 바꿔도 결재칸을 따라간다.
 */

/** 결재칸 하나에 찍을 도장 */
export interface ApprovalStamp {
  /** 서명 자리(합친 칸)의 왼쪽 위와 크기 — 1부터 센다 */
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 서명 PNG 바이트 */
  png: Uint8Array;
  /** 서명 아래 이름(`이상영 대리`) */
  caption: string;
}

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
/** 엑셀 기본 글꼴(맑은 고딕/Calibri 11)의 숫자 폭(px). 열 너비(글자 수)를 px 로 바꿀 때 쓴다. */
const MAX_DIGIT_PX = 7;

/** 시트 XML 에서 열 너비·줄 높이를 읽어 EMU 로 돌려주는 함수들 */
export interface SheetGeometry {
  colEmu: (col: number) => number;
  rowEmu: (row: number) => number;
}

/** 파일에 적힌 열 너비(여백 포함 글자 수, 예: 화면 8.43자 = 9.140625) → px. 엑셀의 변환 규칙 그대로. */
export function columnWidthPx(width: number): number {
  return Math.trunc(((256 * width + Math.trunc(128 / MAX_DIGIT_PX)) / 256) * MAX_DIGIT_PX);
}

export function sheetGeometry(sheetXml: string): SheetGeometry {
  const format = /<sheetFormatPr\b[^>]*>/.exec(sheetXml)?.[0] ?? "";
  const defaultRowPt = Number(/\bdefaultRowHeight="([\d.]+)"/.exec(format)?.[1] ?? 15);
  const defaultColWidth = /\bdefaultColWidth="([\d.]+)"/.exec(format)?.[1];
  // 기본 열 너비가 적혀 있지 않으면 엑셀 기본(8.43자 = 64px).
  const defaultColPx = defaultColWidth ? columnWidthPx(Number(defaultColWidth)) : 64;

  const cols: { min: number; max: number; px: number }[] = [];
  for (const tag of sheetXml.match(/<col\b[^>]*\/?>/g) ?? []) {
    const min = Number(/\bmin="(\d+)"/.exec(tag)?.[1]);
    const max = Number(/\bmax="(\d+)"/.exec(tag)?.[1]);
    const width = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1]);
    const hidden = /\bhidden="(1|true)"/.test(tag);
    if (min && max && Number.isFinite(width)) cols.push({ min, max, px: hidden ? 0 : columnWidthPx(width) });
  }
  const rows = new Map<number, number>();
  for (const tag of sheetXml.match(/<row\b[^>]*>/g) ?? []) {
    const r = Number(/\br="(\d+)"/.exec(tag)?.[1]);
    const ht = /\bht="([\d.]+)"/.exec(tag)?.[1];
    const hidden = /\bhidden="(1|true)"/.test(tag);
    if (r) rows.set(r, hidden ? 0 : ht ? Number(ht) : defaultRowPt);
  }

  return {
    colEmu: (col) => Math.round((cols.find((entry) => col >= entry.min && col <= entry.max)?.px ?? defaultColPx) * EMU_PER_PX),
    rowEmu: (row) => Math.round((rows.get(row) ?? defaultRowPt) * EMU_PER_PT),
  };
}

/** PNG 머리에서 가로·세로 크기를 읽는다. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 합친 칸의 왼쪽 위에서 `offset`(EMU) 떨어진 곳 → (0부터 세는 칸 번호, 그 칸 안의 거리) */
function locate(start: number, span: number, offset: number, size: (index: number) => number) {
  let rest = Math.max(0, offset);
  for (let index = start; index < start + span; index += 1) {
    const length = size(index);
    // 엑셀은 거리를 **정수** EMU 로만 받는다 — 소수가 섞이면 파일을 아예 열지 못한다(실제로 겪음).
    if (rest <= length || index === start + span - 1) return { index: index - 1, off: Math.round(Math.min(rest, length)) };
    rest -= length;
  }
  return { index: start - 1, off: 0 };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 결재칸 안의 한 사각형(EMU, 칸 왼쪽 위 기준)을 twoCellAnchor 의 from/to 로 */
function anchor(stamp: ApprovalStamp, geometry: SheetGeometry, x: number, y: number, width: number, height: number) {
  const from = {
    col: locate(stamp.col, stamp.colSpan, x, geometry.colEmu),
    row: locate(stamp.row, stamp.rowSpan, y, geometry.rowEmu),
  };
  const to = {
    col: locate(stamp.col, stamp.colSpan, x + width, geometry.colEmu),
    row: locate(stamp.row, stamp.rowSpan, y + height, geometry.rowEmu),
  };
  const point = (tag: string, at: typeof from) =>
    `<xdr:${tag}><xdr:col>${at.col.index}</xdr:col><xdr:colOff>${at.col.off}</xdr:colOff><xdr:row>${at.row.index}</xdr:row><xdr:rowOff>${at.row.off}</xdr:rowOff></xdr:${tag}>`;
  const xfrm = `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width)}" cy="${Math.round(height)}"/></a:xfrm>`;
  return { open: `<xdr:twoCellAnchor editAs="oneCell">${point("from", from)}${point("to", to)}`, xfrm };
}

/**
 * 도장 하나의 그림·선·이름 XML(drawing 안에 넣을 조각).
 * `nextId` 는 도형 번호(시트 안에서 겹치면 안 된다), `imageRelId` 는 서명 그림의 관계 id.
 */
export function stampAnchorsXml(
  stamp: ApprovalStamp,
  geometry: SheetGeometry,
  imageRelId: string,
  nextId: number,
): string {
  let width = 0;
  for (let col = stamp.col; col < stamp.col + stamp.colSpan; col += 1) width += geometry.colEmu(col);
  let height = 0;
  for (let row = stamp.row; row < stamp.row + stamp.rowSpan; row += 1) height += geometry.rowEmu(row);

  // 이름 줄: 칸 높이의 30% 이하, 최대 16px. 화면(17px 줄)과 비슷한 비율.
  const captionHeight = Math.min(height * 0.3, 16 * EMU_PER_PX);
  const pad = 3 * EMU_PER_PX;
  const lineY = height - captionHeight;

  // 서명: 이름 줄 위 남은 자리에 비율을 지켜 가운데.
  const size = pngSize(stamp.png);
  const boxWidth = Math.max(0, width - pad * 2);
  const boxHeight = Math.max(0, lineY - pad * 2);
  const ratio = Math.min(boxWidth / size.width, boxHeight / size.height);
  const picWidth = size.width * ratio;
  const picHeight = size.height * ratio;
  const pic = anchor(stamp, geometry, (width - picWidth) / 2, pad + (boxHeight - picHeight) / 2, picWidth, picHeight);
  const line = anchor(stamp, geometry, pad, lineY, width - pad * 2, 0);
  const text = anchor(stamp, geometry, pad, lineY, width - pad * 2, captionHeight);

  return [
    `${pic.open}<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${nextId}" name="결재 서명 ${nextId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr>${pic.xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`,
    `${line.open}<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${nextId + 1}" name="결재 구분선 ${nextId + 1}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
      `<xdr:spPr>${line.xfrm}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:twoCellAnchor>`,
    `${text.open}<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${nextId + 2}" name="결재자 ${nextId + 2}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
      `<xdr:spPr>${text.xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr>` +
      `<xdr:txBody><a:bodyPr vertOverflow="overflow" horzOverflow="overflow" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/>` +
      `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="700"><a:solidFill><a:srgbClr val="1E40AF"/></a:solidFill><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/></a:rPr><a:t>${escapeXml(stamp.caption)}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`,
  ].join("");
}

/** 시트 XML 에 `<drawing r:id>` 를 제자리(엑셀이 정한 순서)에 끼운다. */
export function insertDrawingTag(sheetXml: string, relId: string): string {
  const tag = `<drawing r:id="${relId}"/>`;
  const later = ["<legacyDrawing", "<legacyDrawingHF", "<drawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];
  const positions = later.map((marker) => sheetXml.indexOf(marker)).filter((at) => at >= 0);
  const at = Math.min(...positions);
  return sheetXml.slice(0, at) + tag + sheetXml.slice(at);
}

export const EMPTY_DRAWING =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>';
export const EMPTY_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

/** 관계 파일에 하나 더하고 그 id 를 돌려준다(겹치지 않는 id 를 고른다). */
export function addRelationship(relsXml: string, type: string, target: string): { xml: string; id: string } {
  const used = new Set([...relsXml.matchAll(/\bId="([^"]+)"/g)].map((match) => match[1]));
  let number = used.size + 1;
  while (used.has(`rId${number}`)) number += 1;
  const id = `rId${number}`;
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  return { xml: relsXml.replace("</Relationships>", `${rel}</Relationships>`), id };
}

/** 도형 번호(cNvPr id) 중 가장 큰 것 */
export function maxShapeId(drawingXml: string): number {
  return Math.max(1, ...[...drawingXml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1])));
}

export const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
export const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
export const DRAWING_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml";

/** `data:image/png;base64,...` → 바이트 */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
