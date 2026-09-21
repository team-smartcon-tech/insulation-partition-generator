/**
 * 앱에서 더한 장(월별 시트)을 엑셀에 넣는다 — 원본 시트를 통째로 복사해 새 시트로 붙인다.
 *
 * 화면에서는 "어느 시트의 복사본인가"만 들고 있다가 그릴 때마다 만든다({@link ./formStore}).
 * 엑셀로 내보낼 때는 진짜 시트가 있어야 하므로, **원본 시트 XML 을 그대로 복사**하고 이름만 바꾼다.
 * 서식·병합·인쇄 설정이 한 줄도 바뀌지 않는다(다시 만들면 반드시 무언가 잃는다).
 *
 * 복사본에서 빼는 것: 견본 워터마크와 "제출 시 삭제" 안내 상자. 화면의 복사 규칙과 같다
 * (`isRemovedOnCopy`). 인쇄물에 찍히면 안 되는 것들이다.
 */

const WATERMARK_WORDS = ["sample", "견본", "샘플", "예시", "specimen", "draft"];

/** 도형 조각 안의 글자를 모은다(`<a:t>` 들). */
export function anchorText(anchorXml: string): string {
  return [...anchorXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => match[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * 복사본에서 뺄 도형인가 — 워터마크(`Sample`)나 "제출 시 삭제" 안내 상자.
 * 글자로만 판단한다. 글자 없는 반투명 워터마크는 XML 만 보고 가리기 어려워 남긴다.
 */
export function isSampleAnchor(anchorXml: string): boolean {
  const text = anchorText(anchorXml);
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  const lower = text.trim().toLowerCase();
  if (WATERMARK_WORDS.some((word) => lower === word || lower.includes(word))) return true;
  return /(삭제|지우|제거)(후|하고|한후|해서)/.test(compact) || /제출(시|전).*(삭제|지우|제거)/.test(compact);
}

/** 그림 판에서 견본 표시를 뺀다. 뺀 개수도 돌려준다. */
export function stripSampleAnchors(drawingXml: string): { xml: string; removed: number } {
  let removed = 0;
  const xml = drawingXml.replace(
    /<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g,
    (anchor) => {
      if (!isSampleAnchor(anchor)) return anchor;
      removed += 1;
      return "";
    },
  );
  return { xml, removed };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 복사한 시트 XML 을 손본다.
 *
 * - 그림 판은 **새로 만든 복사본**을 가리킨다(두 시트가 같은 그림 판을 가리키면 엑셀이 파일을 고친다).
 * - 프린터 설정(`pageSetup r:id`)은 뗀다 — 원본 시트의 관계 파일을 가리키던 것이라 복사본에는 없다.
 *   종이 크기·배율 같은 인쇄 설정은 pageSetup 속성에 그대로 남는다.
 */
export function copiedSheetXml(sourceXml: string, drawingRelId: string | undefined): string {
  let xml = sourceXml.replace(/(<pageSetup\b[^>]*?)\s+r:id="[^"]*"/, "$1");
  xml = xml.replace(/<drawing\b[^>]*\/>/, "");
  xml = xml.replace(/<legacyDrawing\b[^>]*\/>/, "");
  if (drawingRelId) {
    const later = ["<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];
    const at = Math.min(...later.map((marker) => xml.indexOf(marker)).filter((index) => index >= 0));
    xml = xml.slice(0, at) + `<drawing r:id="${drawingRelId}"/>` + xml.slice(at);
  }
  return xml;
}

/** 워크북에 시트 한 장을 맨 뒤에 더한다. */
export function addSheetToWorkbook(workbookXml: string, name: string, relId: string): string {
  const ids = [...workbookXml.matchAll(/<sheet\b[^>]*\bsheetId="(\d+)"/g)].map((match) => Number(match[1]));
  const sheetId = Math.max(0, ...ids) + 1;
  const entry = `<sheet name="${escapeXml(name)}" sheetId="${sheetId}" r:id="${relId}"/>`;
  return workbookXml.replace("</sheets>", `${entry}</sheets>`);
}

/** 시트 이름을 수식·이름 정의에 쓰는 모양으로 (`'월 보고'!`). */
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/**
 * 원본 시트의 인쇄 영역을 복사한 시트에도 달아 준다. 없으면 그대로 둔다.
 * 새 시트는 맨 뒤에 붙으므로 `localSheetId` 는 지금 시트 수와 같다(0부터 세니까).
 */
export function copyPrintArea(
  workbookXml: string,
  sourceIndex: number,
  newIndex: number,
  newName: string,
): string {
  const pattern = new RegExp(
    `<definedName[^>]*name="_xlnm\\.Print_Area"[^>]*localSheetId="${sourceIndex}"[^>]*>([\\s\\S]*?)</definedName>`,
  );
  const found = pattern.exec(workbookXml);
  if (!found) return workbookXml;
  const area = found[1].replace(/^[\s\S]*?!/, `${quoteSheet(newName)}!`);
  const entry = `<definedName name="_xlnm.Print_Area" localSheetId="${newIndex}">${area}</definedName>`;
  return workbookXml.includes("</definedNames>")
    ? workbookXml.replace("</definedNames>", `${entry}</definedNames>`)
    : workbookXml.replace("</sheets>", `</sheets><definedNames>${entry}</definedNames>`);
}
