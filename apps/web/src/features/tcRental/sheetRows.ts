/**
 * 발주의뢰서 양식의 데이터 구간을 **실제 대수만큼 늘리는** 도구.
 *
 * 두 양식(타워·호이스트) 모두 원본 현장 크기로 줄 수가 박혀 있다 — 타워는 6호기(임대기간 12줄),
 * 호이스트는 8줄이다. 그보다 많은 현장은 넘친 만큼 **조용히 잘려 나갔다**. 잘린 문서가
 * 그대로 발주로 나가면 호기가 통째로 빠진 채 계약이 된다.
 *
 * ── 왜 예전에는 줄을 안 늘렸나 ──
 * 처음 구현은 "행은 절대 넣거나 빼지 않는다" 였다. 이유가 있었다. `spliceRows` 로 줄을 밀면
 * 값과 서식은 따라 내려가지만 **아래 세 가지는 제자리에 남는다**(2026-09-22 실측):
 *   1. 병합 — `A23:G23` 이 그 자리에 남아 표가 반 칸씩 어긋난다
 *   2. 같은 시트의 합계 범위 — `SUM(F6:F12)` 가 늘어난 구간을 못 따라간다
 *   3. 다른 시트에서 이 시트를 가리키는 수식 — `='발주수량 검토'!I15` 가 옛 행을 계속 본다
 * 그래서 합계가 제 자신을 포함하거나(순환 참조) 엉뚱한 칸을 더하는 사고가 났다.
 *
 * ── 지금은 셋을 다 처리한다 ──
 * 1번은 이 파일의 `insertRows` 가 병합을 걷어 내렸다가 다시 묶어 처리하고,
 * 2·3번은 부르는 쪽이 **늘어난 구간 기준으로 수식을 다시 쓴다.** 두 양식 모두 합계·교차참조를
 * 코드에서 계산해 넣으므로 양식에 박힌 옛 범위는 남지 않는다.
 */
import type ExcelJS from "exceljs";

/**
 * 시트 **맨 뒤에** 행 묶음을 그대로 복제한다 — 도면처럼 "한 장이 한 덩어리"인 자리에 쓴다.
 *
 * 표는 줄을 끼워 넣으면 되지만, 입면도는 블록 하나가 도면 한 장(37행)이라 줄만 늘려서는
 * 모양이 나오지 않는다. 대신 **아래에 아무것도 없는** 자리로 붙이므로 끼워 넣기와 달리
 * 병합을 옮길 일도, 아래쪽 수식이 밀릴 일도 없다.
 *
 * @param delta 복제본을 원본에서 몇 행 아래에 놓을지
 * @param cols  복사할 열 번호 범위 [처음, 끝]
 */
export function cloneRows(
  ws: ExcelJS.Worksheet,
  first: number,
  last: number,
  delta: number,
  cols: [number, number],
): void {
  const [c1, c2] = cols;
  for (let r = first; r <= last; r += 1) {
    const src = ws.getRow(r);
    const dst = ws.getRow(r + delta);
    if (src.height) dst.height = src.height;
    for (let c = c1; c <= c2; c += 1) {
      const from = src.getCell(c);
      const to = dst.getCell(c);
      to.style = { ...from.style };
      const v = from.value as { formula?: string; result?: unknown } | null;
      if (v && typeof v === "object" && typeof v.formula === "string") {
        to.value = { formula: shiftFormulaRows(v.formula, delta), result: v.result as never };
      } else {
        to.value = from.value;
      }
    }
  }
  // 블록 안의 병합도 같이 옮겨 붙인다 (합계 줄의 `B:C` · `G:H` 같은 것)
  for (const range of mergeRanges(ws)) {
    const g = parseRange(range);
    if (!g || g.r1 < first || g.r2 > last) continue;
    try {
      ws.mergeCells(
        `${colName(g.c1)}${g.r1 + delta}:${colName(g.c2)}${g.r2 + delta}`,
      );
    } catch {
      /* 이미 묶여 있으면 넘어간다 */
    }
  }
}

/** "B11:C12" → 범위 숫자. 시트 이름이 붙은 범위는 다루지 않는다 */
export function parseRange(range: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.replace(/\$/g, ""));
  if (!m) return null;
  const col = (t: string) => [...t].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

/** 시트가 실제로 가진 병합 목록 */
export function mergeRanges(ws: ExcelJS.Worksheet): string[] {
  const raw = (ws as unknown as { _merges?: Record<string, { range?: string }> })._merges ?? {};
  return Object.values(raw)
    .map((m) => (typeof m === "string" ? m : m?.range))
    .filter((x): x is string => typeof x === "string");
}

/** 병합을 지운다 — 범위가 비어 있어도 조용히 넘어간다 */
export function unmerge(ws: ExcelJS.Worksheet, range: string) {
  try {
    ws.unMergeCells(range);
  } catch {
    /* 이미 병합이 아니면 무시 */
  }
}

function colName(c: number): string {
  let s = "";
  let n = c;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * `atRow` **앞에** 빈 줄 `count` 개를 끼워 넣는다.
 *
 * 병합은 `spliceRows` 가 옮겨 주지 않으므로 여기서 직접 옮긴다 —
 *   · 삽입 지점 아래에 통째로 있는 병합은 그만큼 **내리고**
 *   · 삽입 지점을 걸치고 있는 병합은 아래쪽 끝을 그만큼 **늘린다**
 * 새로 생긴 줄은 `modelRow` 의 서식과 행 높이를 입는다(비워 두면 테두리도 높이도 없는
 * 맨 줄이 생겨 표 한가운데가 뚫린 것처럼 보인다).
 *
 * @param cols 서식을 입힐 열 번호 범위 [처음, 끝]
 */
export function insertRows(
  ws: ExcelJS.Worksheet,
  atRow: number,
  count: number,
  modelRow: number,
  cols: [number, number],
): void {
  if (count <= 0) return;

  // 본보기는 밀기 전에 떠 둔다 — 본보기 자신이 밀려 내려갈 수 있다
  const [c1, c2] = cols;
  const style: Array<Record<string, unknown>> = [];
  for (let c = c1; c <= c2; c += 1) style.push({ ...ws.getRow(modelRow).getCell(c).style });
  const height = ws.getRow(modelRow).height;

  // 옮겨야 할 병합을 미리 계산해 두고 전부 풀어 둔다
  const moves: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
  for (const range of mergeRanges(ws)) {
    const g = parseRange(range);
    if (!g || g.r2 < atRow) continue; // 삽입 지점 위쪽은 그대로
    moves.push(
      g.r1 >= atRow
        ? { ...g, r1: g.r1 + count, r2: g.r2 + count } // 통째로 아래 → 내린다
        : { ...g, r2: g.r2 + count }, // 걸쳐 있음 → 늘린다
    );
    unmerge(ws, range);
  }

  ws.spliceRows(atRow, 0, ...Array.from({ length: count }, () => [] as never[]));

  for (let r = atRow; r < atRow + count; r += 1) {
    if (height) ws.getRow(r).height = height;
    for (let c = c1; c <= c2; c += 1) ws.getRow(r).getCell(c).style = { ...style[c - c1] };
  }

  for (const g of moves) {
    try {
      ws.mergeCells(`${colName(g.c1)}${g.r1}:${colName(g.c2)}${g.r2}`);
    } catch {
      /* 이미 다른 병합에 먹힌 범위는 건너뛴다 */
    }
  }
}

/**
 * 수식 안의 행 번호를 `delta` 만큼 옮긴다 — **같은 시트 안에서 블록을 통째로 복사**할 때 쓴다.
 * (다른 시트를 가리키는 참조는 그대로 둔다. 복사한 블록은 제 안에서만 계산한다.)
 */
export function shiftFormulaRows(formula: string, delta: number): string {
  if (delta === 0) return formula;
  const parts = formula.split(/("(?:[^"]|"")*")/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // 따옴표 안은 셀 참조가 아니다
      return part.replace(
        /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.가-힣]+))?(!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
        (whole, quoted: string, bare: string, bang: string, absCol, col, absRow, rowText) => {
          if (bang || quoted || bare) return whole; // 시트 이름이 붙었거나 함수 이름이다
          return `${absCol}${col}${absRow}${Number(rowText) + delta}`;
        },
      );
    })
    .join("");
}

/** 한 시트에 끼워 넣은 줄들 — 옛 행 번호를 새 행 번호로 옮기는 근거가 된다 */
export interface RowInsert {
  /** **양식 원본 기준** 행 번호. 이 행 앞에 끼워 넣었다 */
  at: number;
  count: number;
}

/** 양식 원본의 행 번호 → 줄을 끼워 넣은 뒤의 행 번호 */
export function shiftRow(inserts: RowInsert[], row: number): number {
  return inserts.reduce((acc, ins) => (ins.at <= row ? acc + ins.count : acc), row);
}

/**
 * 통합 문서 안의 **모든 수식**에서 행 번호를 새 자리로 옮긴다.
 *
 * `spliceRows` 는 수식을 손대지 않는다. 같은 시트의 `SUM(F6:F12)` 도, 다른 시트를 가리키는
 * `='발주수량 검토'!I15` 도 옛 행을 그대로 본다. 여기서 한 번에 고친다.
 *
 * **줄을 블록의 마지막 줄 *앞*에 끼워 넣는 것이 규칙**이다. 그래야 그 블록을 더하는 범위의
 * 끝 행이 함께 밀려 내려가 `SUM` 이 새 줄까지 저절로 품는다. 마지막 줄 *뒤*에 끼우면
 * 범위 끝이 제자리에 남아 **새로 넣은 호기가 합계에서 빠진다** — 눈에 보이지 않는 종류의 사고다.
 *
 * 반드시 **줄을 다 끼워 넣은 직후, 값을 채우기 전에** 부른다. 채우는 코드는 이미 새 행 번호로
 * 수식을 쓰므로, 나중에 부르면 그 수식까지 한 번 더 밀린다.
 */
export function remapFormulas(wb: ExcelJS.Workbook, shifts: Map<string, RowInsert[]>): void {
  if ([...shifts.values()].every((v) => v.length === 0)) return;

  for (const ws of wb.worksheets) {
    const own = shifts.get(ws.name) ?? [];
    const rewrite = (formula: string) => remapRefs(formula, ws.name, shifts, own);
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as { formula?: string; result?: unknown } | null;
        if (!v || typeof v !== "object" || typeof v.formula !== "string") return;
        const next = rewrite(v.formula);
        if (next !== v.formula) cell.value = { formula: next, result: v.result as never };
      });
    });
    // 인쇄 영역도 행 번호다 — 늘어난 표가 인쇄에서 잘리지 않게 함께 옮긴다
    const area = ws.pageSetup?.printArea;
    if (typeof area === "string" && area) ws.pageSetup.printArea = rewrite(area);
  }
}

/** `'시트 이름'!$A$12` / `A12` 를 찾아 행 번호만 옮긴다. 따옴표 안의 글자는 건드리지 않는다 */
function remapRefs(
  formula: string,
  selfName: string,
  shifts: Map<string, RowInsert[]>,
  own: RowInsert[],
): string {
  // 문자열 리터럴("...")은 통째로 넘긴다 — 그 안의 "A12" 는 셀 참조가 아니다
  const parts = formula.split(/("(?:[^"]|"")*")/);
  const REF = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.가-힣]+))?(!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // 따옴표 안
      return part.replace(
        REF,
        (whole, quoted: string, bare: string, bang: string, absCol, col, absRow, rowText) => {
          // 시트 이름 없이 글자가 앞에 붙어 있으면 함수 이름 같은 것이다 — 건드리지 않는다
          if (!bang && (quoted || bare)) return whole;
          const sheet = bang ? (quoted ?? bare ?? "").replace(/''/g, "'") : selfName;
          const inserts = bang ? shifts.get(sheet) : own;
          if (!inserts || inserts.length === 0) return whole;
          const next = shiftRow(inserts, Number(rowText));
          const prefix = bang ? `${quoted ? `'${quoted}'` : bare}!` : "";
          return `${prefix}${absCol}${col}${absRow}${next}`;
        },
      );
    })
    .join("");
}
