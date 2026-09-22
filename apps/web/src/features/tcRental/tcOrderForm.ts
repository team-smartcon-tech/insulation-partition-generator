/**
 * 타워크레인 발주의뢰서 — 회사 표준 양식(엑셀)을 **그대로 채워서** 내보낸다.
 *
 * 처음부터 시트를 그려서 만들지 않는다. 테두리·글꼴·병합·열 너비·인쇄 설정까지 판박이여야
 * 결재가 도는데, 그것을 코드로 재현하면 틀림없이 어딘가 어긋난다. 그래서 원본 파일을
 * `public/templates/tc-order-template.xlsx` 로 싣고 **셀 값만 바꿔 쓴다.**
 *
 * 시트 사이 수식 연결도 그대로 살아 있다:
 *   임대기간 J열(임대개월) → 발주수량 검토 E열(가실행) → 내역서 D열(수량)
 * 오른쪽 I열(발주수량)에는 **공정표로 잰 현장산출 개월**을 넣는다 — 이 표는 두 값을
 * 나란히 놓고 증감을 보는 자리이므로, 양쪽을 같게 두면 표가 아무 말도 하지 않는다.
 * (`fullCalcOnLoad` 를 켜 두어 파일을 열 때 다시 계산되게 한다.)
 */
// 타입만 정적으로 쓴다 — 라이브러리 본체(약 1MB)는 발주의뢰서를 실제로 만들 때만 받는다.
// 정적 import 로 두면 도구를 열지도 않은 사람의 첫 화면까지 무거워진다.
import type ExcelJS from "exceljs";
import type { RentalSpan, TcRentalPlan } from "./types";
import { parseYmd } from "./engine/dates";
import { addReviewSheet } from "./tcReviewSheet";
import {
  insertRows,
  mergeRanges,
  parseRange,
  remapFormulas,
  shiftRow,
  unmerge,
  type RowInsert,
} from "./sheetRows";

const TEMPLATE_URL = "/templates/tc-order-template.xlsx";

/** 요청받은 6개 탭만 남긴다 */
const KEEP_SHEETS = ["표지", "내역서", "산출서", "발주수량 검토", "임대기간", "타워크레인 건널다리"];

/**
 * 양식 원본(이천중리2차 — 타워 **6호기**, 임대기간 **12줄**)의 행 배치.
 *
 * 우리 현장이 더 크면 `growSheets` 가 이 자리에 줄을 끼워 넣는다. 아래 숫자는 그때도
 * **양식 원본 기준점**으로 남고, 실제 행 번호는 `shiftRow` 로 옮겨 쓴다.
 */
const TPL = {
  /** 원본 현장의 타워 대수 — 공사비 수량에 이 숫자로 박혀 있어 우리 호기 수로 바꾼다 */
  units: 6,
  /** 임대기간: 11~22 데이터, 23 합계, 25 해체시기 안내 */
  rent: { first: 11, rows: 12, sum: 23, note: 25 },
  /** 산출서: 5~10 호기, 11 계, 12~38 추가마스터, 39 합계 */
  calc: { first: 5, rows: 6, sum: 11, extraFirst: 12, extraLast: 38, total: 39 },
  /** 발주수량 검토: 7~12 임대료, 13 추가마스터, 15~29 공사비, 31~36 초과근무, 38~40 보험 */
  qty: { first: 7, master: 13, workFirst: 15, workLast: 29, otFirst: 31, insFirst: 38, insLast: 40 },
  /** 내역서: 6~11 임대료, 12 추가마스터, 15~29 공사비, 32~37 초과근무, 41~45 보험 */
  boq: { first: 6, master: 12, workFirst: 15, workLast: 29, otFirst: 32, insFirst: 41, insLast: 45 },
} as const;

const TEMPLATE_UNITS = TPL.units;

/**
 * 양식에 박힌 원본 현장 수량을 우리 현장 값으로 옮긴다.
 *
 *   6  = 타워 대수 (기초앙카 6조, 설치·해체 6회, 항공장애등 6대 …) → 우리 호기 수
 *   12 = 대수 × 2 (설·해체 작업 보험 — 호기당 설치 1회 + 해체 1회) → 우리 호기 수 × 2
 *   1  = 현장당 하나 (풍속계 1조, 인지세 1식)                      → 그대로
 *
 * 그 밖의 숫자(16·18 = 인상·브레싱 횟수, 280 = 추가마스터 개당월)는 층수와 설계에 달린
 * 값이라 우리가 산출하지 않는다. 원본 현장 값을 남기면 다른 현장 숫자가 실려 나가므로 비운다.
 */
/** [from, to] 행 번호 목록 */
function rangeRows(from: number, to: number): number[] {
  const out: number[] = [];
  for (let r = from; r <= to; r += 1) out.push(r);
  return out;
}

function siteQty(v: unknown, units: number): number | null {
  if (v === TEMPLATE_UNITS) return units;
  if (v === TEMPLATE_UNITS * 2) return units * 2;
  if (v === 1) return 1;
  return null;
}

/** 초과근무수당 규격 — 양식이 호기마다 같은 글자를 적어 둔다 */
const OT_SPEC = "(평일:1시간,토요일:7시간)";

/**
 * 내역서의 금액 칸을 채운다 — 재료비·노무비·경비 금액과 합계.
 *
 * 양식은 줄마다 `F=D*E · H=D*G · J=D*I · K=E+G+I · L=F+H+J` 를 갖고 있는데,
 * **새로 끼워 넣은 줄에는 없다.** 단가를 적어도 금액이 0 으로 남아 합계에서 빠진다.
 */
function money(ws: ExcelJS.Worksheet, r: number) {
  ws.getCell(`F${r}`).value = { formula: `D${r}*E${r}` };
  ws.getCell(`H${r}`).value = { formula: `D${r}*G${r}` };
  ws.getCell(`J${r}`).value = { formula: `D${r}*I${r}` };
  ws.getCell(`K${r}`).value = { formula: `E${r}+G${r}+I${r}` };
  ws.getCell(`L${r}`).value = { formula: `F${r}+H${r}+J${r}` };
}

/** 호기 블록 단위로 병합되는 칸 (타워·임대개월·비고) */
const RENT_BLOCK_COLS = ["B", "I", "J", "K", "L", "M", "N", "O", "P"];

/** 산출서 월 칸 — H(8) ~ AF(32) */
const CALC_MONTH_FIRST_COL = 8;
const CALC_MONTH_LAST_COL = 32;
/**
 * 산출서 아래쪽 "추가마스터 임대료" 구간 (템플릿 기준 12~38행, 합계 39행).
 * 호기마다 `기본 / 1차 / 2차 / 소계` 네 줄로 묶는다 — 원본 양식의 가장 작은 블록 모양이고,
 * 이래야 6호기까지 행을 늘리지 않고 들어간다. 브레싱 차수·EA·층은 현장이 채우는 칸이라
 * 라벨과 소계 수식만 깔아 둔다.
 */
const EXTRA_BLOCK_ROWS = 4;

/** 줄을 끼워 넣은 뒤의 **실제** 행 번호 — 채우는 코드는 전부 이 값만 본다 */
interface TcLayout {
  /** 타워 대수 (양식 원본보다 적으면 양식 줄 수를 그대로 쓰고 남는 줄을 비운다) */
  units: number;
  rent: { first: number; rows: number; last: number; sum: number; note: number };
  calc: {
    first: number;
    rows: number;
    last: number;
    sum: number;
    extraFirst: number;
    extraLast: number;
    total: number;
  };
  qty: {
    first: number;
    rows: number;
    master: number;
    workFirst: number;
    workLast: number;
    otFirst: number;
    insFirst: number;
    insLast: number;
  };
  boq: {
    first: number;
    rows: number;
    master: number;
    workFirst: number;
    workLast: number;
    otFirst: number;
    insFirst: number;
    insLast: number;
  };
}

/**
 * 양식의 데이터 구간을 우리 현장 크기로 **늘린다.**
 *
 * 줄은 언제나 **블록의 마지막 줄 앞**에 끼워 넣는다 — 그래야 그 블록을 더하는 범위
 * (`SUM(F6:F12)` 등)의 끝이 함께 밀려 새 호기를 품는다. 자세한 근거는 `sheetRows.ts`.
 * 끼워 넣기가 끝나면 `remapFormulas` 가 양식에 박힌 옛 행 번호를 한 번에 옮긴다.
 */
function growSheets(wb: ExcelJS.Workbook, units: number, rentRows: number): TcLayout {
  const addUnits = Math.max(0, units - TPL.units);
  const addRent = Math.max(0, rentRows - TPL.rent.rows);
  /** 추가마스터 구간이 호기당 4줄을 담으려면 몇 줄이 더 필요한가 */
  const extraCapacity = TPL.calc.extraLast - TPL.calc.extraFirst + 1;
  const addExtra = Math.max(0, units * EXTRA_BLOCK_ROWS - extraCapacity);

  const ins = {
    임대기간: [{ at: TPL.rent.first + TPL.rent.rows - 1, count: addRent }],
    산출서: [
      { at: TPL.calc.first + TPL.calc.rows - 1, count: addUnits },
      { at: TPL.calc.extraLast, count: addExtra },
    ],
    "발주수량 검토": [
      { at: TPL.qty.first + TPL.units - 1, count: addUnits },
      { at: TPL.qty.otFirst + TPL.units - 1, count: addUnits },
    ],
    내역서: [
      { at: TPL.boq.first + TPL.units - 1, count: addUnits },
      { at: TPL.boq.otFirst + TPL.units - 1, count: addUnits },
    ],
  } satisfies Record<string, RowInsert[]>;

  const shifts = new Map<string, RowInsert[]>(Object.entries(ins));
  for (const [name, list] of shifts) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    // 아래쪽부터 끼워야 위쪽 삽입이 아래 지점의 행 번호를 밀지 않는다
    for (const { at, count } of [...list].sort((a, b) => b.at - a.at)) {
      insertRows(ws, at, count, at, [1, 34]);
    }
  }
  remapFormulas(wb, shifts);

  const rentAt = (row: number) => shiftRow(ins.임대기간, row);
  const calcAt = (row: number) => shiftRow(ins.산출서, row);
  const qtyAt = (row: number) => shiftRow(ins["발주수량 검토"], row);
  const boqAt = (row: number) => shiftRow(ins.내역서, row);
  const rows = Math.max(units, TPL.units);

  return {
    units,
    rent: {
      first: TPL.rent.first,
      rows: Math.max(rentRows, TPL.rent.rows),
      last: rentAt(TPL.rent.first + TPL.rent.rows - 1),
      sum: rentAt(TPL.rent.sum),
      note: rentAt(TPL.rent.note),
    },
    calc: {
      first: TPL.calc.first,
      rows,
      last: calcAt(TPL.calc.first + TPL.calc.rows - 1),
      sum: calcAt(TPL.calc.sum),
      extraFirst: calcAt(TPL.calc.extraFirst),
      extraLast: calcAt(TPL.calc.extraLast),
      total: calcAt(TPL.calc.total),
    },
    qty: {
      first: TPL.qty.first,
      rows,
      master: qtyAt(TPL.qty.master),
      workFirst: qtyAt(TPL.qty.workFirst),
      workLast: qtyAt(TPL.qty.workLast),
      otFirst: qtyAt(TPL.qty.otFirst),
      insFirst: qtyAt(TPL.qty.insFirst),
      insLast: qtyAt(TPL.qty.insLast),
    },
    boq: {
      first: TPL.boq.first,
      rows,
      master: boqAt(TPL.boq.master),
      workFirst: boqAt(TPL.boq.workFirst),
      workLast: boqAt(TPL.boq.workLast),
      otFirst: boqAt(TPL.boq.otFirst),
      insFirst: boqAt(TPL.boq.insFirst),
      insLast: boqAt(TPL.boq.insLast),
    },
  };
}

export interface TcOrderInput {
  plan: TcRentalPlan;
  spans: RentalSpan[];
}

/** "2026-09-05" → "'26. 09" */
function shortMonth(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return "";
  return `'${String(d.getUTCFullYear()).slice(2)}. ${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 시작 달부터 count 개월 (YYYY-MM) */
function monthsFrom(ymd: string, count: number): string[] {
  const d = parseYmd(ymd);
  if (!d || count <= 0) return [];
  const out: string[] = [];
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "2027-01" → "'27. 01" */
function fmtMonth(ym: string): string {
  return `'${ym.slice(2, 4)}. ${ym.slice(5, 7)}`;
}

/**
 * 행은 **절대 넣거나 빼지 않는다.**
 *
 * 처음에는 데이터 수에 맞춰 행을 늘리고 줄였는데, 그러면 아래쪽 합계 수식
 * (`SUM(AG5:AG10)` 같은)의 범위가 따라오지 않아 **합계 칸이 제 자신을 포함**하게 된다.
 * 엑셀이 "순환 참조" 경고를 띄우고 통합 문서 복구까지 물어보는 원인이 이것이었다.
 * 그래서 양식의 행 수는 그대로 두고, 남는 행은 값을 비우는 쪽으로 간다.
 * 데이터가 양식의 칸 수를 넘으면 넘친 만큼을 알려 준다.
 */
const overflow: string[] = [];

/**
 * 공유 수식(shared formula)을 낱개 수식으로 펼친다.
 *
 * 한 칸이 원본이고 나머지가 그 복제인데, 우리가 셀을 덮어쓰면 원본이 사라지고 복제만 남아
 * 저장할 때 "Shared Formula master must exist" 로 터진다. 셀을 건드리기 전에 미리 푼다.
 */
function unshareFormulas(ws: ExcelJS.Worksheet) {
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value as { formula?: string; sharedFormula?: string; result?: unknown } | null;
      if (!v || typeof v !== "object") return;
      if (!("sharedFormula" in v) && !("formula" in v)) return;
      const own = cell.formula;
      if (!own) return;
      cell.value = { formula: own, result: v.result as never };
    });
  });
}

/**
 * 삭제한 시트를 가리키는 **명명된 범위**를 걷어낸다.
 * 남겨 두면 엑셀이 "명명된 범위 레코드 제거" 라며 통합 문서 복구를 물어본다.
 */
function pruneDefinedNames(wb: ExcelJS.Workbook, keep: string[]) {
  const dn = (wb as unknown as { _definedNames?: { model?: Array<{ ranges?: string[] }> } })
    ._definedNames;
  const model = dn?.model;
  if (!Array.isArray(model)) return;
  const ok = new Set(keep);
  for (const entry of model) {
    if (!Array.isArray(entry.ranges)) continue;
    entry.ranges = entry.ranges.filter((r) => {
      const sheet = /^'?([^'!]+)'?!/.exec(r)?.[1];
      return sheet ? ok.has(sheet) : false;
    });
  }
  dn!.model = model.filter((e) => (e.ranges?.length ?? 0) > 0);
}

/**
 * 데이터 구간을 값·수식까지 완전히 비운다.
 *
 * 양식의 셀 중 일부는 **공유 수식(shared formula)** 이다 — 한 칸이 원본이고 나머지는 그 복제다.
 * 원본만 덮어쓰고 복제를 남기면 저장할 때 "Shared Formula master must exist" 로 터진다.
 * 그래서 행을 늘리거나 줄이기 전에 구간을 통째로 지워 복제를 남기지 않는다.
 * (서식은 셀 값과 별개라 그대로 남는다 — 양식은 깨지지 않는다.)
 */
function clearRegion(ws: ExcelJS.Worksheet, r1: number, r2: number, c1: number, c2: number) {
  for (let r = r1; r <= r2; r += 1) {
    const row = ws.getRow(r);
    for (let c = c1; c <= c2; c += 1) row.getCell(c).value = null;
  }
}

/**
 * 구간에 걸친 병합을 **전부** 푼다.
 *
 * 양식에는 원본 현장의 블록이 남아 있고 그 크기가 제각각이라, 병합 범위를 코드에서
 * 짐작해 하나씩 풀면 반드시 빠뜨린다(실제로 3호기 블록과 연도 머리글이 그렇게 남았다).
 * 그래서 시트가 실제로 가진 병합 목록을 훑어 겹치는 것을 지운다.
 */
function unmergeRegion(ws: ExcelJS.Worksheet, r1: number, r2: number, c1: number, c2: number) {
  for (const range of mergeRanges(ws)) {
    const g = parseRange(range);
    if (!g) continue;
    if (g.r2 < r1 || g.r1 > r2 || g.c2 < c1 || g.c1 > c2) continue;
    unmerge(ws, range);
  }
}

/**
 * 구간의 서식을 본보기 행 두 개(블록 첫 행 / 이어지는 행)로 다시 찍는다.
 *
 * 병합만 풀고 값만 바꾸면 **어떤 행은 음영이 있고 어떤 행은 없는 누더기**가 된다 —
 * 원본 현장의 블록 경계가 우리 호기 배치와 다르기 때문이다. 양식의 첫 블록을 본보기로
 * 삼아 구간 전체에 같은 모양을 입힌다.
 */
function stampBlockStyles(
  ws: ExcelJS.Worksheet,
  first: number,
  last: number,
  perRowCols: string[],
  blockCols: string[],
  headModelRow: number,
  bodyModelRow: number,
  heads: Set<number>,
) {
  // 본보기는 덮어쓰기 전에 먼저 떠 둔다 — 본보기 자신도 구간 안에 있다
  const rowHead = perRowCols.map((c) => ({ ...ws.getCell(`${c}${headModelRow}`).style }));
  const rowBody = perRowCols.map((c) => ({ ...ws.getCell(`${c}${bodyModelRow}`).style }));
  // 블록 칸은 **첫 행 모양만** 쓴다. 병합을 풀면 아래 칸의 서식이 지워지기 때문에
  // 이어지는 행을 본보기로 삼으면 빈 칸(테두리도 음영도 없는)을 퍼뜨리게 된다.
  const blockHead = blockCols.map((c) => ({ ...ws.getCell(`${c}${headModelRow}`).style }));
  for (let r = first; r <= last; r += 1) {
    const model = heads.has(r) ? rowHead : rowBody;
    perRowCols.forEach((c, i) => {
      ws.getCell(`${c}${r}`).style = { ...model[i] };
    });
    blockCols.forEach((c, i) => {
      ws.getCell(`${c}${r}`).style = { ...blockHead[i] };
    });
  }
}


/**
 * 쓴 글자가 칸보다 길면 열을 넓힌다.
 *
 * 양식의 열 너비는 원본 현장 기준이라, 동명이나 "'26. 09 ~ '28. 02" 같은 값이 길어지면
 * `####` 나 잘린 글자가 된다. 좁히지는 않는다 — 양식의 균형을 깨지 않기 위해서다.
 * 한글은 폭이 영문의 약 두 배라 글자마다 가중치를 달리 센다.
 */
function fitColumn(ws: ExcelJS.Worksheet, col: string | number, text: unknown) {
  if (text == null) return;
  const str = String(text);
  if (!str) return;
  let w = 0;
  for (const ch of str) w += /[　-鿿가-힣]/.test(ch) ? 2 : 1;
  const need = w + 2; // 여백
  const c = ws.getColumn(col);
  if (!c.width || c.width < need) c.width = need;
}

function fillCover(wb: ExcelJS.Workbook, plan: TcRentalPlan, today: string) {
  const ws = wb.getWorksheet("표지");
  if (!ws) return;
  const d = parseYmd(today);
  const label = d
    ? `${d.getUTCFullYear()}년   ${String(d.getUTCMonth() + 1).padStart(2, "0")}월      일`
    : "";
  ws.getCell("A12").value = label;
  ws.getCell("A20").value = plan.siteName;
  for (const addr of ["J15", "J16", "J17"]) {
    ws.getCell(addr).value = d
      ? ` ${d.getUTCFullYear()}년  ${String(d.getUTCMonth() + 1).padStart(2, "0")}월     일`
      : "";
  }
}

/**
 * 임대기간 — 이 문서의 원천. 호기별 담당 동을 한 블록으로 쌓고,
 * 블록 첫 행에만 임대개월 수식을 넣는다(템플릿과 같은 모양).
 */
function fillRental(
  ws: ExcelJS.Worksheet,
  plan: TcRentalPlan,
  tc: RentalSpan[],
  today: string,
  L: TcLayout,
): Map<number, number> {
  const byId = new Map(plan.buildings.map((b) => [b.id, b]));
  const blocks = tc.map((s) => ({
    no: s.no,
    buildings: s.buildingIds
      .map((id) => byId.get(id))
      .filter((b): b is NonNullable<typeof b> => !!b),
  }));

  const d = parseYmd(today);
  ws.getCell("A2").value = d
    ? `(${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()})`
    : "";
  ws.getCell("A3").value = `■ 현장명 : ${plan.siteName}`;

  // 기존 병합을 모두 풀고(행 수가 달라지므로) 데이터 구간을 다시 만든다
  const first = L.rent.first;
  const last = L.rent.last;
  unmergeRegion(ws, first, last, 1, 16);

  // 우리 호기 배치대로 블록 첫 행을 미리 정한다 — 서식을 찍으려면 먼저 알아야 한다
  const headRows = new Set<number>();
  {
    let r = first;
    for (const blk of blocks) {
      const n = Math.max(1, blk.buildings.length);
      if (r + n - 1 > last) break;
      headRows.add(r);
      r += n;
    }
  }
  // 양식의 첫 블록(11·12행)을 본보기 삼아 구간 전체를 같은 모양으로 되돌린다.
  // 원본 현장은 6호기라 15·17행 같은 자리에 옛 블록 경계가 남아 있었고, 그 탓에
  // 3호기 줄만 음영·테두리가 빠져 보였다.
  stampBlockStyles(
    ws,
    first,
    last,
    ["C", "D", "E", "F", "G", "H"], // 동마다 한 줄인 칸
    RENT_BLOCK_COLS, // 호기 블록으로 묶이는 칸
    first,
    first + 1,
    headRows,
  );
  // 현장명 열은 표 전체를 하나로 묶는 칸이라 첫 행 서식을 그대로 깐다
  for (let r = first; r <= last; r += 1) {
    ws.getCell(`A${r}`).style = { ...ws.getCell(`A${first}`).style };
  }

  // 병합을 푼 뒤 값을 지워야 한다 — 병합된 칸은 값을 못 쓴다
  clearRegion(ws, first, last, 1, 19);

  /** 호기 → 블록 시작행. 발주수량 검토가 이 행을 참조한다 */
  const startRows = new Map<number, number>();
  let row = first;
  for (const blk of blocks) {
    // 양식의 칸을 넘으면 더 쓰지 않는다 — 넘겨 쓰면 합계 행을 덮어써 문서가 깨진다
    if (row + Math.max(1, blk.buildings.length) - 1 > last) {
      overflow.push(`임대기간: ${blk.no}호기 이후 ${blocks.length - blocks.indexOf(blk)}개 호기`);
      break;
    }
    const start = row;
    const list = blk.buildings.length > 0 ? blk.buildings : [null];
    for (const b of list) {
      ws.getCell(`C${row}`).value = b ? b.name : "";
      fitColumn(ws, "C", b?.name);
      ws.getCell(`D${row}`).value = b ? b.belowFloors : null;
      ws.getCell(`E${row}`).value = b ? b.aboveFloors : null;
      ws.getCell(`F${row}`).value = b ? Math.max(0, b.aboveFloors - 1) : null;
      ws.getCell(`G${row}`).value = b ? b.phFloors : null;
      // 골조공기 — 템플릿과 같은 수식(상단 기준값 참조)
      ws.getCell(`H${row}`).value = {
        formula: `$C$6+$E$6*D${row}+$C$7+$E$7*(F${row}-1)+$G$7+$I$7*G${row}`,
      };
      // 협의 전/후 비교 칸은 사람이 채우는 자리라 비워 둔다
      for (const col of ["K", "L", "N", "O"]) ws.getCell(`${col}${row}`).value = null;
      row += 1;
    }
    const end = row - 1;
    startRows.set(blk.no, start);
    ws.getCell(`B${start}`).value = `${blk.no}호기`;
    fitColumn(ws, "B", `${blk.no}호기`);
    ws.getCell(`I${start}`).value = {
      formula: `ROUNDUP(MAX(H${start}:H${end})/365*12,0)`,
    };
    ws.getCell(`J${start}`).value = { formula: `I${start}+1` };
    ws.getCell(`M${start}`).value = { formula: `J${start}` };
    if (end > start) {
      for (const col of RENT_BLOCK_COLS) ws.mergeCells(`${col}${start}:${col}${end}`);
    }
  }

  ws.getCell(`A${first}`).value = plan.siteName;
  fitColumn(ws, "A", plan.siteName);
  ws.mergeCells(`A${first}:A${last}`);

  // 합계 행은 **양식에 고정된 자리**(데이터 구간 바로 아래)다. 채운 행 수에 따라 옮기면
  // 데이터 한가운데 합계가 끼어들고, 양식 원래 합계 행의 옛 수식(범위가 어긋난 것)이 그대로 남는다.
  const sumRow = L.rent.sum;
  for (const col of ["I", "J", "K", "L", "M", "N", "O"]) {
    ws.getCell(`${col}${sumRow}`).value = {
      formula: `SUM(${col}${first}:${col}${last})`,
    };
  }
  ws.getCell(`A${L.rent.note}`).value =
    `★T/C 해체시기: 골조완료+${plan.params.tc.postFrameMonths}개월(全동 동일적용)+α`;
  return startRows;
}

/** 산출서 — 호기별 월 투입 그리드 */
function fillCalc(ws: ExcelJS.Worksheet, plan: TcRentalPlan, tc: RentalSpan[], L: TcLayout) {
  ws.getCell("B2").value = `현장명 : ${plan.siteName}`;

  // 칠하는 칸 수가 곧 합계이고, 그 합계가 내역서 수량이 된다. 달력상 걸치는 달 수
  // (예: '27.01~'28.05 = 17)와 산출 개월수(16)는 다를 수 있으므로 **산출 개월수**를 따른다.
  const spanMonths = new Map<number, string[]>();
  for (const s of tc) spanMonths.set(s.no, monthsFrom(s.mobilizeStart, Math.max(1, s.rentalMonths)));
  const all = [...spanMonths.values()].flat().sort();
  const from = all[0] ?? null;
  const to = all[all.length - 1] ?? null;
  const months: string[] = [];
  if (from && to) {
    let cur = from;
    while (cur <= to && months.length < 600) {
      months.push(cur);
      const y = Number(cur.slice(0, 4));
      const m = Number(cur.slice(5, 7));
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  const capacity = CALC_MONTH_LAST_COL - CALC_MONTH_FIRST_COL + 1;
  const shown = months.slice(0, capacity);

  // 연도 머리글은 원본 현장 기준으로 병합돼 있다. 우리 구간에 맞춰 다시 묶어야 하는데,
  // 병합 범위를 코드에서 짐작하면 반드시 빠뜨린다(M3·Y3 가 그렇게 남아 음영이 끊겼다).
  const headStyle = { ...ws.getRow(3).getCell(CALC_MONTH_FIRST_COL).style };
  unmergeRegion(ws, 3, 3, CALC_MONTH_FIRST_COL, CALC_MONTH_LAST_COL);
  for (let i = 0; i < capacity; i += 1) {
    const col = CALC_MONTH_FIRST_COL + i;
    const ym = shown[i];
    ws.getRow(3).getCell(col).style = { ...headStyle };
    ws.getRow(4).getCell(col).value = ym ? `${Number(ym.slice(5, 7))}월` : null;
    ws.getRow(3).getCell(col).value = null;
  }
  let i = 0;
  while (i < shown.length) {
    const year = shown[i].slice(0, 4);
    let j = i;
    while (j + 1 < shown.length && shown[j + 1].slice(0, 4) === year) j += 1;
    const c1 = CALC_MONTH_FIRST_COL + i;
    const c2 = CALC_MONTH_FIRST_COL + j;
    ws.getRow(3).getCell(c1).value = `${year}년`;
    if (c2 > c1) ws.mergeCells(3, c1, 3, c2);
    i = j + 1;
  }

  clearRegion(ws, L.calc.first, L.calc.last, 2, 34);
  if (tc.length > L.calc.rows) {
    overflow.push(`산출서: ${tc.length - L.calc.rows}개 호기`);
  }

  tc.slice(0, L.calc.rows).forEach((s, idx) => {
    const r = L.calc.first + idx;
    ws.getCell(`B${r}`).value = `타워크레인 (${s.no}호기)`;
    ws.getCell(`C${r}`).value = null; // 규격은 업체 선정 후 채운다
    ws.getCell(`D${r}`).value = "월";
    ws.getCell(`E${r}`).value = `${s.no}호기`;
    const mine = spanMonths.get(s.no) ?? [];
    // 당초계획 표기도 칠한 구간과 같아야 한다 — 다르면 표가 스스로를 반박한다
    const planLabel =
      mine.length > 0
        ? `${fmtMonth(mine[0])} ~ ${fmtMonth(mine[mine.length - 1])}`
        : `${shortMonth(s.mobilizeStart)} ~ ${shortMonth(s.demobEnd)}`;
    ws.getCell(`F${r}`).value = planLabel;
    fitColumn(ws, "B", `타워크레인 (${s.no}호기)`);
    fitColumn(ws, "E", `${s.no}호기`);
    fitColumn(ws, "F", planLabel);
    const on = new Set(mine);
    for (let k = 0; k < capacity; k += 1) {
      const col = CALC_MONTH_FIRST_COL + k;
      ws.getRow(r).getCell(col).value = shown[k] && on.has(shown[k]) ? 1 : null;
    }
    ws.getCell(`AG${r}`).value = { formula: `SUM(H${r}:AF${r})` };
  });

  // 계 행 — 늘어난 구간을 그대로 더한다(양식에 박힌 옛 범위를 믿지 않는다)
  for (let c = CALC_MONTH_FIRST_COL; c <= CALC_MONTH_LAST_COL; c += 1) {
    const col = ws.getColumn(c).letter;
    ws.getRow(L.calc.sum).getCell(c).value = {
      formula: `SUM(${col}${L.calc.first}:${col}${L.calc.last})`,
    };
  }
  ws.getCell(`AG${L.calc.sum}`).value = {
    formula: `SUM(AG${L.calc.first}:AG${L.calc.last})`,
  };

  fillExtraMaster(ws, tc, L);
}

/**
 * 산출서 아래쪽 추가마스터 임대료 구간 — **호기별 틀만** 깔아 둔다.
 *
 * 원본 현장(6호기)의 브레싱 층·EA 가 그대로 남아 있어 다른 현장 정보가 실려 나가던 자리다.
 * 그렇다고 통째로 비우면 양식이 반쪽이 되므로, 우리 호기 수만큼 블록을 다시 세우고
 * 숫자 칸은 비워 둔다. 블록 경계가 원본과 달라지니 서식도 함께 다시 찍는다.
 */
function fillExtraMaster(ws: ExcelJS.Worksheet, tc: RentalSpan[], L: TcLayout) {
  const C1 = 2;
  const C2 = 34;
  const capture = (r: number) => {
    const out: Array<Record<string, unknown>> = [];
    for (let c = C1; c <= C2; c += 1) out.push({ ...ws.getRow(r).getCell(c).style });
    return out;
  };
  // 본보기는 병합을 풀기 **전에** 떠 둔다 — 풀면 아래 칸 서식이 지워진다
  const model = {
    base: capture(L.calc.extraFirst),
    step: capture(L.calc.extraFirst + 1),
    sub: capture(L.calc.extraFirst + EXTRA_BLOCK_ROWS - 1),
  };
  const stamp = (r: number, m: Array<Record<string, unknown>>) => {
    for (let c = C1; c <= C2; c += 1) ws.getRow(r).getCell(c).style = { ...m[c - C1] };
  };

  unmergeRegion(ws, L.calc.extraFirst, L.calc.total, C1, C2);
  for (let r = L.calc.extraFirst; r <= L.calc.extraLast; r += 1) {
    for (let c = C1; c <= C2; c += 1) ws.getRow(r).getCell(c).value = null;
  }

  const capacity = Math.floor((L.calc.extraLast - L.calc.extraFirst + 1) / EXTRA_BLOCK_ROWS);
  const units = tc.slice(0, capacity);
  if (tc.length > capacity) overflow.push(`산출서 추가마스터: ${tc.length - capacity}개 호기`);

  const subRows: number[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const start = L.calc.extraFirst + i * EXTRA_BLOCK_ROWS;
    const sub = start + EXTRA_BLOCK_ROWS - 1;
    const no = units[i].no;
    subRows.push(sub);

    stamp(start, model.base);
    for (let r = start + 1; r < sub; r += 1) stamp(r, model.step);
    stamp(sub, model.sub);

    // 품명·단위는 양식대로 첫 블록에만 적는다
    if (i === 0) {
      ws.getCell(`B${start}`).value = "추가마스터 임대료";
      ws.getCell(`D${start}`).value = "개당월";
    }
    ws.getCell(`F${start}`).value = "기본";
    for (let k = 1; k < EXTRA_BLOCK_ROWS - 1; k += 1) {
      ws.getCell(`F${start + k}`).value = `${k}차`;
    }
    ws.getCell(`G${sub}`).value = "소계";
    for (let r = start; r <= sub; r += 1) ws.getCell(`E${r}`).value = `${no}호기`;
    ws.mergeCells(`E${start}:E${sub}`);

    // 소계 — 월 칸마다 블록을 더한다. 숫자는 현장이 채우면 따라 붙는다
    for (let c = CALC_MONTH_FIRST_COL; c <= CALC_MONTH_LAST_COL; c += 1) {
      const col = ws.getColumn(c).letter;
      ws.getRow(sub).getCell(c).value = { formula: `SUM(${col}${start}:${col}${sub - 1})` };
    }
    for (let r = start + 1; r <= sub; r += 1) {
      ws.getCell(`AG${r}`).value = { formula: `SUM(H${r}:AF${r})` };
    }
  }

  // 남는 줄은 빈 표 줄로 둔다 — 원본 블록의 음영·굵은 선이 남지 않게
  for (let r = L.calc.extraFirst + units.length * EXTRA_BLOCK_ROWS; r <= L.calc.extraLast; r += 1) {
    stamp(r, model.step);
  }

  // 합계 행은 양식 고정 자리다. 소계 행이 바뀌었으니 참조를 다시 쓴다
  for (let c = CALC_MONTH_FIRST_COL; c <= CALC_MONTH_LAST_COL; c += 1) {
    const col = ws.getColumn(c).letter;
    ws.getRow(L.calc.total).getCell(c).value =
      subRows.length > 0 ? { formula: subRows.map((r) => `${col}${r}`).join("+") } : null;
  }
  ws.getCell(`AG${L.calc.total}`).value =
    subRows.length > 0 ? { formula: subRows.map((r) => `AG${r}`).join("+") } : null;
}

/** 발주수량 검토 — 임대료 행의 호기명만 맞추고, 공사비 수량은 비운다 */
function fillQty(
  ws: ExcelJS.Worksheet,
  plan: TcRentalPlan,
  tc: RentalSpan[],
  startRows: Map<number, number>,
  L: TcLayout,
) {
  ws.getCell("B2").value = `[${plan.siteName}]`;

  const firstRow = L.qty.first;
  for (let i = 0; i < L.qty.rows; i += 1) {
    const r = firstRow + i;
    const s = tc[i];
    // 이 표는 **두 값을 나란히 놓고 차이를 보는 자리**다. 왼쪽 E 는 "가실행 수량(건축예산팀)",
    // 오른쪽 I 는 실제 "발주수량". 그래서
    //   E = 실행기준(임대기간 탭의 산식 결과) — 양식이 J11/J13/… 을 박아 두는데 호기 배치가
    //       달라지면 엉뚱한 칸을 가리키므로(3호기가 0으로 나오던 원인) 실제 블록 행으로 다시 쓴다
    //   I = 현장산출(공정표 실측 반입~반출 개월) — 우리가 발주할 수량이다
    // 둘을 같게(`I=E`) 두면 증감 열이 항상 0 이 되어 표가 아무 말도 하지 않는다.
    const src = s ? startRows.get(s.no) : undefined;
    ws.getCell(`E${r}`).value = src ? { formula: `임대기간!J${src}` } : null;
    ws.getCell(`I${r}`).value = s ? s.rentalMonths : null;
    ws.getCell(`B${r}`).value = s ? `타워크레인 (${s.no}호기)` : null;
    if (s) {
      fitColumn(ws, "B", `타워크레인 (${s.no}호기)`);
      fitColumn(ws, "F", `타워크레인 (${s.no}호기)`);
    }
    ws.getCell(`F${r}`).value = s ? `타워크레인 (${s.no}호기)` : null;
    ws.getCell(`C${r}`).value = null; // 규격 — 업체 선정 후
    ws.getCell(`G${r}`).value = null;
    // 단위는 양식이 채워 두지만 **새로 끼워 넣은 줄은 비어 있다**
    ws.getCell(`D${r}`).value = s ? "월" : null;
    if (!s) {
      for (const col of ["H"]) ws.getCell(`${col}${r}`).value = null;
    }
  }
  // 추가마스터 임대료 — 우리가 산출하지 않는 항목이라 원본 값(280)을 그대로 두면 안 된다
  ws.getCell(`E${L.qty.master}`).value = null;
  ws.getCell(`I${L.qty.master}`).value = null;
  // 2. 공사비 — 양식에 박힌 "6" 은 원본 현장의 **타워 대수**다(기초앙카 6조, 설치·해체 6회…).
  // 그래서 그 자리만 우리 호기 수로 바꾼다. 16(인상·브레싱 횟수)이나 280(추가마스터 개월)은
  // 층수·설계에 달린 값이라 우리가 산출하지 않으므로 비운다. 1(풍속계 1조)은 대수와 무관해 둔다.
  const units = tc.length;
  for (const r of [
    ...rangeRows(L.qty.workFirst, L.qty.workLast),
    ...rangeRows(L.qty.insFirst, L.qty.insLast),
  ]) {
    const qty = siteQty(ws.getCell(`E${r}`).value, units);
    ws.getCell(`E${r}`).value = qty;
    ws.getCell(`I${r}`).value = qty;
  }
  // 3. 초과근무수당 — 임대 개월과 같은 값이라 임대료 행을 그대로 따라간다(좌·우 각각)
  for (let i = 0; i < L.qty.rows; i += 1) {
    const r = L.qty.otFirst + i;
    const s = tc[i];
    if (!s) {
      for (const col of ["B", "C", "D", "E", "F", "G", "H", "I"]) {
        ws.getCell(`${col}${r}`).value = null;
      }
      continue;
    }
    // 품명·규격·단위는 양식이 6호기까지만 채워 두었다 — 끼워 넣은 줄에 직접 쓴다
    ws.getCell(`B${r}`).value = `${s.no}호기`;
    ws.getCell(`C${r}`).value = OT_SPEC;
    ws.getCell(`D${r}`).value = "개월";
    ws.getCell(`F${r}`).value = `${s.no}호기`;
    ws.getCell(`G${r}`).value = OT_SPEC;
    ws.getCell(`E${r}`).value = { formula: `E${firstRow + i}` };
    ws.getCell(`I${r}`).value = { formula: `I${firstRow + i}` };
  }
}

/** 내역서 — 규격 비우고, 공사비 수량 비운다. 임대료 수량은 수식이 끌어온다 */
function fillBoq(ws: ExcelJS.Worksheet, plan: TcRentalPlan, tc: RentalSpan[], L: TcLayout) {
  ws.getCell("A1").value = `[${plan.siteName}] 타워크레인 내역서`;

  // 1. 임대료 — 양식은 품명을 `=산출서!B5` 로 끌어온다. 없는 호기 행까지 참조가 살아 있으면
  // 산출서를 비운 뒤 "0" 이 남아 4·5·6호기가 있는 것처럼 보인다. 있는 호기만 글자로 적고 나머지는 비운다.
  for (let i = 0; i < L.boq.rows; i += 1) {
    const r = L.boq.first + i;
    const s = tc[i];
    if (!s) {
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
        ws.getCell(`${col}${r}`).value = null;
      }
      continue;
    }
    const name = `타워크레인 (${s.no}호기)`;
    ws.getCell(`A${r}`).value = name;
    fitColumn(ws, "A", name);
    ws.getCell(`B${r}`).value = null; // 규격은 업체 선정 후 채운다
    ws.getCell(`C${r}`).value = "월";
    // 수량은 발주수량 검토 → 임대기간 으로 이어지는 양식의 연결을 그대로 쓴다
    ws.getCell(`D${r}`).value = { formula: `'발주수량 검토'!I${L.qty.first + i}` };
    money(ws, r);
  }
  // 추가마스터 임대료 — 품명은 양식대로 두되 수량은 우리가 산출하지 않으므로 비운다
  ws.getCell(`A${L.boq.master}`).value = "추가마스터 임대료";
  ws.getCell(`B${L.boq.master}`).value = null;
  ws.getCell(`C${L.boq.master}`).value = "개당월";
  ws.getCell(`D${L.boq.master}`).value = null;

  // 2. 공사비 수량은 건드리지 않는다 — `='발주수량 검토'!I15` 처럼 수식으로 물려 있어
  // 그쪽만 고치면 따라온다. 여기서 숫자로 덮으면 두 문서가 어긋난다.
  // 4. 보험료 기타는 양식에 숫자가 박혀 있다(12·18·6·1·1) — 타워 대수를 우리 것으로 바꾼다
  const units = tc.length;
  for (const r of rangeRows(L.boq.insFirst, L.boq.insLast)) {
    ws.getCell(`D${r}`).value = siteQty(ws.getCell(`D${r}`).value, units);
  }

  // 3. 초과근무수당 — 없는 호기 행은 통째로 비우고, 끼워 넣은 줄은 품명부터 새로 쓴다
  for (let i = 0; i < L.boq.rows; i += 1) {
    const r = L.boq.otFirst + i;
    const s = tc[i];
    if (!s) {
      for (const col of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
        ws.getCell(`${col}${r}`).value = null;
      }
      continue;
    }
    ws.getCell(`A${r}`).value = `${s.no}호기`;
    ws.getCell(`B${r}`).value = OT_SPEC;
    ws.getCell(`C${r}`).value = "개월";
    ws.getCell(`D${r}`).value = { formula: `'발주수량 검토'!I${L.qty.otFirst + i}` };
    money(ws, r);
  }
}

export async function generateTcOrderForm({ plan, spans }: TcOrderInput): Promise<string[]> {
  const tc = spans
    .filter((s) => s.kind === "tc" && !s.problem)
    .sort((a, b) => a.no - b.no);
  if (tc.length === 0) throw new Error("타워크레인 배정이 없습니다. ② 호기 배정에서 먼저 지정하세요.");

  overflow.length = 0;

  const XL = (await import("exceljs")).default;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("발주의뢰서 양식을 불러오지 못했습니다.");
  const wb = new XL.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());

  for (const ws of [...wb.worksheets]) {
    if (!KEEP_SHEETS.includes(ws.name)) wb.removeWorksheet(ws.id);
  }
  // 남긴 시트의 공유 수식을 먼저 펼친다 — 셀을 건드리기 전에 해야 한다
  for (const ws of wb.worksheets) unshareFormulas(ws);
  pruneDefinedNames(wb, KEEP_SHEETS);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  // 우리 현장이 양식보다 크면 **먼저 줄을 늘린다.** 값을 채운 뒤에 늘리면
  // 방금 쓴 수식까지 한 번 더 밀려 내려간다.
  const byId = new Map(plan.buildings.map((b) => [b.id, b]));
  const rentRows = tc.reduce(
    (acc, s) => acc + Math.max(1, s.buildingIds.filter((id) => byId.has(id)).length),
    0,
  );
  const L = growSheets(wb, tc.length, rentRows);

  fillCover(wb, plan, today);
  const rent = wb.getWorksheet("임대기간");
  const startRows = rent ? fillRental(rent, plan, tc, today, L) : new Map<number, number>();
  const calc = wb.getWorksheet("산출서");
  if (calc) fillCalc(calc, plan, tc, L);
  const qty = wb.getWorksheet("발주수량 검토");
  if (qty) fillQty(qty, plan, tc, startRows, L);
  const boq = wb.getWorksheet("내역서");
  if (boq) fillBoq(boq, plan, tc, L);

  // 맨 뒤에 현장산출검토 한 장 — 양식이 아니라 우리가 그리는 설득 자료다
  addReviewSheet(wb, { plan, spans, params: plan.params });

  // 수식만 써 두고 값은 비워 두므로, 파일을 열 때 엑셀이 다시 계산하게 한다
  wb.calcProperties.fullCalcOnLoad = true;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plan.siteName}_타워크레인 발주의뢰서.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return [...overflow];
}
