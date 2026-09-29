/**
 * 끼워 넣은 줄을 **엑셀 파일에 실제로 넣는다.**
 *
 * 화면에서 표 중간에 줄을 넣으면(`sheetRows.ts`), 내려받은 엑셀에도 그 줄이 있어야 한다.
 * 엑셀 라이브러리로 다시 저장하면 도형·차트가 날아가므로(실제로 겪었다), 여기서도 원본 XML 을
 * **직접 밀어서** 넣는다.
 *
 * 함께 밀어야 하는 것들 — 하나라도 빠지면 표가 어긋난다. 실제 양식으로 하나씩 확인했다:
 * - 줄 번호(`<row r>`)와 칸 번호(`<c r>`)
 * - 병합(`<mergeCell ref>`) — 끼운 자리를 **걸치는** 병합은 밀리는 게 아니라 **늘어난다**(엑셀과 같다)
 * - 시트 범위(`<dimension ref>`)
 * - 그림 위치(`<xdr:row>`, 0 부터 센다) — 안 밀면 로고·순서도가 표와 따로 논다
 * - 인쇄 영역(`_xlnm.Print_Area`) — `$A$1:$L$46` 처럼 **$ 가 붙어 있다**(안 챙기면 안 늘어난다)
 */

/** 끼운 자리 목록(원본 줄 번호). 같은 자리에 여러 줄이면 여러 번 들어 있다. */
export type RowInserts = number[];

/** 원본 줄 `row` 가 끼워 넣기 뒤에 몇 번 줄이 되나. */
export const shiftedRow = (row: number, inserts: RowInserts) =>
  row + inserts.filter((at) => at <= row).length;

/** `$A$12` · `B7` 같은 칸 표기의 줄 번호만 민다. */
const shiftRef = (ref: string, inserts: RowInserts) =>
  ref.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, dollar1, col, dollar2, row) => {
    const next = shiftedRow(Number(row), inserts);
    return next === Number(row) ? all : `${dollar1}${col}${dollar2}${next}`;
  });

/** 끼운 줄 하나하나가 몇 번 줄이 되나(빈 줄을 만들어 넣을 자리). */
function insertedRowNumbers(inserts: RowInserts): number[] {
  const sorted = [...inserts].sort((a, b) => a - b);
  return sorted.map((at, index) => at + index);
}

/**
 * 끼운 줄 위 줄을 본떠 빈 줄 XML 을 만든다.
 * 테두리·글꼴(`s` 번호)을 물려받아야 표가 이어져 보인다. 내용은 비운다.
 */
function blankRowXml(xml: string, templateRow: number, newRow: number): string {
  const template = new RegExp(`<row\\b[^>]*?\\br="${templateRow}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`).exec(xml);
  if (!template) return `<row r="${newRow}"/>`;

  const cells = [...template[0].matchAll(/<c\b[^>]*?\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map((match) => ({
    col: match[1],
    style: /\bs="(\d+)"/.exec(match[0])?.[1],
  }));
  const height = /\bht="([\d.]+)"/.exec(template[0])?.[1];

  const body = cells.map((cell) => `<c r="${cell.col}${newRow}"${cell.style ? ` s="${cell.style}"` : ""}/>`).join("");
  return `<row r="${newRow}"${height ? ` ht="${height}" customHeight="1"` : ""}>${body}</row>`;
}

/** 시트 XML 에 줄을 끼워 넣는다. */
export function insertRowsIntoSheetXml(xml: string, inserts: RowInserts): string {
  if (inserts.length === 0) return xml;

  let out = xml;
  // 1) 있는 것들을 민다.
  out = out.replace(/<row\b[^>]*>/g, (tag) =>
    tag.replace(/\br="(\d+)"/, (all, row) => `r="${shiftedRow(Number(row), inserts)}"`),
  );
  out = out.replace(/<c\b[^>]*>/g, (tag) =>
    tag.replace(/\br="([A-Z]+)(\d+)"/, (all, col, row) => `r="${col}${shiftedRow(Number(row), inserts)}"`),
  );
  out = out.replace(/<mergeCell ref="([^"]+)"/g, (all, ref) => `<mergeCell ref="${shiftRef(ref, inserts)}"`);
  out = out.replace(/<dimension ref="([^"]+)"/, (all, ref) => `<dimension ref="${shiftRef(ref, inserts)}"`);

  // 2) 빈 줄을 제자리에 끼운다. 줄은 **번호 순서대로** 있어야 엑셀이 받아들인다.
  const sorted = [...inserts].sort((a, b) => a - b);
  const newRows = insertedRowNumbers(inserts);
  for (let i = 0; i < newRows.length; i++) {
    const newRow = newRows[i];
    // 본보기는 "끼운 자리 바로 앞 원본 줄"이다. 맨 위에 끼우면 첫 줄을 본뜬다.
    const templateBase = Math.max(1, sorted[i] - 1);
    const templateRow = shiftedRow(templateBase, inserts);
    const rowXml = blankRowXml(out, templateRow, newRow);

    // 끼울 자리: 자기보다 큰 번호의 줄 앞. 없으면 sheetData 끝.
    let insertAt = -1;
    for (const match of out.matchAll(/<row\b[^>]*?\br="(\d+)"/g)) {
      if (Number(match[1]) > newRow) {
        insertAt = match.index ?? -1;
        break;
      }
    }
    if (insertAt < 0) {
      const close = out.indexOf("</sheetData>");
      insertAt = close >= 0 ? close : out.length;
    }
    out = out.slice(0, insertAt) + rowXml + out.slice(insertAt);
  }
  return out;
}

/** 그림은 칸에 붙어 있다(0 부터 세는 줄 번호). 같이 밀지 않으면 표와 따로 논다. */
export function shiftDrawingRows(xml: string, inserts: RowInserts): string {
  if (inserts.length === 0) return xml;
  return xml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (all, row) => {
    // 그림은 0 부터, 시트는 1 부터 센다. 같은 줄을 가리키게 1 을 더해 셈한다.
    const next = shiftedRow(Number(row) + 1, inserts) - 1;
    return `<xdr:row>${next}</xdr:row>`;
  });
}

/**
 * 인쇄 영역을 늘린다. 안 늘리면 끼운 줄이 종이에 안 나온다.
 * 시트마다 따로 있으므로 **그 시트 것만** 고친다(`localSheetId`).
 */
export function shiftPrintArea(workbookXml: string, sheetIndex: number, inserts: RowInserts): string {
  if (inserts.length === 0 || sheetIndex < 0) return workbookXml;
  return workbookXml.replace(
    /<definedName\b[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g,
    (all, ref: string) => {
      const target = /localSheetId="(\d+)"/.exec(all)?.[1];
      if (target === undefined || Number(target) !== sheetIndex) return all;
      return all.replace(ref, shiftRef(ref, inserts));
    },
  );
}
