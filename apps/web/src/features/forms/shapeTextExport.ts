/**
 * 화면에서 고친 도형 글자를 엑셀 그림 판(drawing XML)에 되돌려 적는다.
 *
 * 순서도 상자 글자를 고칠 수 있게 하면서(2026-10-14) 내려받은 엑셀에도 그 글자가 보여야 한다. 그림 판을
 * 통째로 다시 쓰면 도형이 깨지므로, **그 번호의 도형 글자(`txBody` 의 문단)만** 바꾸고 나머지는 그대로 둔다.
 * 글자 서식은 원래 첫 문단·첫 조각의 것을 그대로 쓴다(굵기·크기·색이 원본과 같게).
 */

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `shape:13` → `13`. 도형 키가 아니면 null */
export function shapeIdOfKey(key: string): string | null {
  return /^shape:(\d+)$/.exec(key)?.[1] ?? null;
}

/** 도형 하나의 글자를 바꾼 txBody — 첫 문단의 pPr 과 첫 조각의 rPr 를 줄마다 다시 쓴다 */
function rewriteTxBody(txBody: string, text: string, prefix: string): string {
  const open = /^<[^>]+>/.exec(txBody)?.[0] ?? `<${prefix}txBody>`;
  const close = `</${prefix}txBody>`;
  const inner = txBody.slice(open.length, txBody.length - close.length);
  const firstParagraph = /<a:p>[\s\S]*?<\/a:p>|<a:p\/>/.exec(inner)?.[0] ?? "";
  const head = inner.slice(0, inner.search(/<a:p[ >/]/) >= 0 ? inner.search(/<a:p[ >/]/) : inner.length);
  const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/.exec(firstParagraph)?.[0] ?? "";
  const rPr =
    /<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(firstParagraph)?.[0] ??
    (/<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/.exec(firstParagraph)?.[0] ?? "")
      .replace(/^<a:endParaRPr/, "<a:rPr")
      .replace(/<\/a:endParaRPr>$/, "</a:rPr>");
  const paragraphs = text
    .split("\n")
    .map((line) => (line === "" ? `<a:p>${pPr}</a:p>` : `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`))
    .join("");
  return `${open}${head}${paragraphs}${close}`;
}

/**
 * 그림 판 XML 에서 번호(`cNvPr id`)가 맞는 도형의 글자를 바꾼다. 못 찾은 번호는 건너뛴다.
 */
export function applyShapeTextEdits(drawingXml: string, edits: Record<string, string>): string {
  let xml = drawingXml;
  for (const [id, text] of Object.entries(edits)) {
    const idMatch = new RegExp(`<([A-Za-z0-9]+:)?cNvPr\\b[^>]*\\bid="${id}"`).exec(xml);
    if (!idMatch) continue;
    const prefix = idMatch[1] ?? "";
    // 그 도형의 글자 상자 — 번호 뒤 첫 txBody 이되, 다음 도형이 시작되기 전이어야 한다.
    const from = idMatch.index;
    const nextShape = xml.slice(from + 1).search(new RegExp(`<${prefix}cNvPr\\b`));
    const end = nextShape >= 0 ? from + 1 + nextShape : xml.length;
    const region = xml.slice(from, end);
    const body = new RegExp(`<${prefix}txBody\\b[^>]*>[\\s\\S]*?</${prefix}txBody>`).exec(region);
    if (!body) continue;
    const start = from + body.index;
    xml = xml.slice(0, start) + rewriteTxBody(body[0], text, prefix) + xml.slice(start + body[0].length);
  }
  return xml;
}
