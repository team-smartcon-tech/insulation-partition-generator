/**
 * 한 셀 안의 "적는 자리"를 찾아낸다.
 *
 * 한국 공문서 엑셀은 칸을 더 쪼개지 않고 한 셀 안에서 공백으로 자리를 벌려 둔다.
 *
 *     소속:                  직급:                  성명:                (서명 또는 날인)
 *          └── 여기가 적는 자리 ──┘
 *
 * 셀 전체를 입력 상자 하나로 만들면 이 구조가 뭉개진다. 공백 덩어리를 각각 입력칸으로
 * 잘라야 원본처럼 항목별로 적을 수 있다.
 */

export type CellSegment =
  | { type: "text"; text: string }
  | { type: "slot"; index: number; spaces: number };

/** 빈칸으로 볼 최소 연속 공백 수. 낱개 공백은 단어 사이 띄어쓰기라 자르면 안 된다. */
const MIN_SLOT_SPACES = 2;

/**
 * 한 줄을 글자와 빈칸으로 나눈다.
 *
 * 줄 맨 앞과 맨 뒤의 공백 덩어리는 빈칸이 아니다 — 앞은 들여쓰기(`"     및 목적"`),
 * 뒤는 엑셀이 남긴 정렬용 여백이다. 양쪽에 글자가 있는 공백만 적는 자리로 본다.
 *
 * @param startIndex 셀 안에서 이어지는 빈칸 번호. 여러 줄을 훑을 때 번호가 겹치지 않게 한다.
 */
export function splitCellLine(line: string, startIndex = 0): CellSegment[] {
  const segments: CellSegment[] = [];
  let slotIndex = startIndex;
  let cursor = 0;

  const pattern = new RegExp(` {${MIN_SLOT_SPACES},}`, "g");
  let match = pattern.exec(line);
  while (match) {
    const isLeading = match.index === 0;
    const isTrailing = match.index + match[0].length === line.length;

    if (isLeading || isTrailing) {
      // 들여쓰기·꼬리 여백은 글자로 그대로 둔다.
      match = pattern.exec(line);
      continue;
    }

    segments.push({ type: "text", text: line.slice(cursor, match.index) });
    segments.push({ type: "slot", index: slotIndex, spaces: match[0].length });
    slotIndex += 1;
    cursor = match.index + match[0].length;
    match = pattern.exec(line);
  }

  if (cursor < line.length) segments.push({ type: "text", text: line.slice(cursor) });
  return segments;
}

/** 셀 값을 줄 단위로 나눈 뒤 각 줄을 글자/빈칸으로 쪼갠다. 빈칸 번호는 셀 전체에서 이어진다. */
export function splitCellText(text: string): CellSegment[][] {
  const lines = text.split("\n");
  const result: CellSegment[][] = [];
  let nextSlotIndex = 0;

  for (const line of lines) {
    const segments = splitCellLine(line, nextSlotIndex);
    for (const segment of segments) {
      if (segment.type === "slot") nextSlotIndex = segment.index + 1;
    }
    result.push(segments);
  }
  return result;
}

/** 셀 안에 적는 자리가 몇 개인지. 0이면 셀 전체를 입력 상자 하나로 쓴다. */
export function countSlots(text: string): number {
  return splitCellText(text)
    .flat()
    .filter((segment) => segment.type === "slot").length;
}

/** 값 저장 키. 셀 키와 빈칸 번호를 합쳐 문서 전체에서 유일하게 만든다. */
export function slotKey(cellKey: string, slotIndex: number): string {
  return `${cellKey}#${slotIndex}`;
}
