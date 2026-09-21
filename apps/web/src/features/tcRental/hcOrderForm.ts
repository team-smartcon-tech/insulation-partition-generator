/**
 * 건설용 리프트(호이스트) 발주의뢰서 — 회사 표준 양식(엑셀)을 그대로 채워서 내보낸다.
 *
 * 타워 쪽(`tcOrderForm.ts`)과 같은 원칙이다: 양식을 코드로 다시 그리지 않고 원본 파일에
 * 값만 얹는다. 시트 사이 수식 연결도 살아 있어서 우리가 채우는 것은 사실상
 *   (건설용리프트)임대기간산출 ← 임대기간 ← 설치높이 산정
 * 세 장이고, 내역서·갑지는 그 결과를 물고 온다.
 *
 * ── 양식의 한 줄이 뜻하는 것 ──
 * 원본은 "동 × 라인(세대군)" 한 줄이 리프트 한 대다. 우리 모델은 호기에 동을 배정하는
 * 구조이므로 **(호기, 동) 짝 하나가 한 줄**이 된다. 한 동에 두 호기를 걸면 그 동이 두 줄로
 * 나오고, 한 호기가 두 동을 맡으면 동이 둘로 나뉜다 — 양쪽 다 양식의 모양과 맞는다.
 *
 * ── 설치높이 ──
 * 층고는 ② 호기 배정에서 **동별로** 받는다(지층·1층·기준층·최상층). 층수와 연장은
 * 입력이 아니라 그 동의 지상층수·표준값에서 자동으로 나온다. 지층만 비어 있을 수
 * 있는데(동마다 기초 레벨이 다른 실측값), 그때는 비고에 표시한다 — 채우면 설치높이와
 * 설치비 수량이 그 자리에서 따라 붙는다.
 *
 * ── 우리가 채우지 않는 칸 ──
 * 라인(세대) 표기는 공정표에서 나오지 않는다.
 */
// 타입만 정적으로 쓴다 — 라이브러리 본체(약 1MB)는 발주의뢰서를 실제로 만들 때만 받는다.
// 정적 import 로 두면 도구를 열지도 않은 사람의 첫 화면까지 무거워진다.
import type ExcelJS from "exceljs";
import type { BuildingFrameProfile, RentalSpan, TcRentalPlan } from "./types";
import { parseYmd } from "./engine/dates";
import { resolveHoistHeight } from "./engine/profile";

const TEMPLATE_URL = "/templates/hc-order-template.xlsx";

/** 양식의 9개 탭 — 순서까지 원본 그대로 */
const KEEP_SHEETS = [
  "갑지",
  "내역서",
  "임대기간",
  "(건설용리프트)임대기간산출",
  "설치높이 산정",
  "입면도",
  "건설용리프트설치위치도",
  "첨부1. HC 방호선반 사진",
  "첨부2. 호이스트 입찰 기준안",
];

/** 각 시트의 데이터 구간 — 양식이 8줄(동 4개 × 라인 2개)로 고정돼 있다 */
const MAX_ROWS = 8;
const CALC_FIRST_ROW = 11; // (건설용리프트)임대기간산출 — 1. 임대기간 산정
const ETC_FIRST_ROW = 25; // 같은 시트 — 2. 기타장비
const TERM_FIRST_ROW = 5; // 임대기간
const HEIGHT_FIRST_ROW = 4; // 설치높이 산정

/** 임대기간 시트의 월 칸 — D(4) ~ X(24) */
const TERM_MONTH_FIRST_COL = 4;
const TERM_MONTH_LAST_COL = 24;

/** 운용 형태 — 양식의 적용계수 표(V11:W14)에 있는 이름이라야 VLOOKUP 이 걸린다 */
const DEFAULT_OPERATION = "중속싱글";

export interface HcOrderInput {
  plan: TcRentalPlan;
  spans: RentalSpan[];
}

/** 한 줄 = 리프트 한 대 (호기 + 담당 동) */
interface HcLine {
  no: number;
  building: BuildingFrameProfile;
  months: string[];
  /** 동별 층고에서 나온 설치높이 — 화면(② 호기 배정)과 같은 계산을 쓴다 */
  height: ReturnType<typeof resolveHoistHeight>;
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

const overflow: string[] = [];

/** 2.88 × 9 처럼 떨어지지 않는 곱셈이 `25.919999999999998` 로 실리지 않게 */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 공유 수식을 낱개 수식으로 펼친다 — 셀을 덮어쓰기 전에 해야 파일이 깨지지 않는다 */
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

/** 삭제한 시트를 가리키는 명명된 범위를 걷어낸다 (엑셀 복구 경고의 원인) */
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

/** "B11:B12" → 범위 숫자 */
function parseRange(range: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.replace(/\$/g, ""));
  if (!m) return null;
  const col = (t: string) => [...t].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

function unmerge(ws: ExcelJS.Worksheet, range: string) {
  try {
    ws.unMergeCells(range);
  } catch {
    /* 이미 병합이 아니면 무시 */
  }
}

/**
 * 구간에 걸친 병합을 전부 푼다.
 *
 * 원본 현장은 동마다 라인이 둘이라 A열이 두 줄씩 묶여 있다. 우리 배정은 그와 달라서
 * 짐작으로 풀면 반드시 빠뜨리고, 빠뜨린 자리는 음영·테두리가 어긋난 채 남는다.
 */
function unmergeRegion(ws: ExcelJS.Worksheet, r1: number, r2: number, c1: number, c2: number) {
  const raw = (ws as unknown as { _merges?: Record<string, { range?: string }> })._merges ?? {};
  const ranges = Object.values(raw)
    .map((m) => (typeof m === "string" ? m : m?.range))
    .filter((x): x is string => typeof x === "string");
  for (const range of ranges) {
    const g = parseRange(range);
    if (!g) continue;
    if (g.r2 < r1 || g.r1 > r2 || g.c2 < c1 || g.c1 > c2) continue;
    unmerge(ws, range);
  }
}

/**
 * 구간의 서식을 본보기 한 줄로 다시 찍는다.
 * 병합을 풀면 아래 칸의 서식이 지워지므로 **첫 줄 모양**을 구간 전체에 입힌다.
 */
function stampRows(
  ws: ExcelJS.Worksheet,
  first: number,
  last: number,
  c1: number,
  c2: number,
  modelRow: number,
) {
  const model: Array<Record<string, unknown>> = [];
  for (let c = c1; c <= c2; c += 1) model.push({ ...ws.getRow(modelRow).getCell(c).style });
  for (let r = first; r <= last; r += 1) {
    for (let c = c1; c <= c2; c += 1) ws.getRow(r).getCell(c).style = { ...model[c - c1] };
  }
}

function clearRegion(ws: ExcelJS.Worksheet, r1: number, r2: number, c1: number, c2: number) {
  for (let r = r1; r <= r2; r += 1) {
    const row = ws.getRow(r);
    for (let c = c1; c <= c2; c += 1) row.getCell(c).value = null;
  }
}

/** 쓴 글자가 칸보다 길면 열을 넓힌다 (좁히지는 않는다) */
function fitColumn(ws: ExcelJS.Worksheet, col: string | number, text: unknown) {
  if (text == null) return;
  const str = String(text);
  if (!str) return;
  let w = 0;
  for (const ch of str) w += /[　-鿿가-힣]/.test(ch) ? 2 : 1;
  const need = w + 2;
  const c = ws.getColumn(col);
  if (!c.width || c.width < need) c.width = need;
}

/** 이어지는 같은 동끼리 A열을 묶는다 — 양식이 동 단위로 병합돼 있다 */
function mergeByBuilding(ws: ExcelJS.Worksheet, col: string, first: number, lines: HcLine[]) {
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].building.id === lines[i].building.id) j += 1;
    if (j > i) ws.mergeCells(`${col}${first + i}:${col}${first + j}`);
    i = j + 1;
  }
}

/**
 * 시트에 박힌 그림을 걷어낸다.
 *
 * 배치도·입면도는 **현장마다 다른 도면**이라 양식에 실려 온 그림을 그대로 내보내면
 * 남의 현장 도면을 첨부해 보내는 꼴이 된다. 표만 남기고 그림은 지운다.
 * (방호선반 사진·입찰 기준안은 현장과 무관한 표준 자료라 그대로 둔다.)
 */
function dropImages(ws: ExcelJS.Worksheet) {
  const media = (ws as unknown as { _media?: unknown[] })._media;
  if (Array.isArray(media)) media.splice(0);
}

/**
 * 시트에서 뗀 그림의 **파일 자체**를 통합 문서에서 없앤다. (탭은 건드리지 않는다.)
 *
 * 시트에서 그림을 떼도 그림 파일은 패키지 안에 그대로 남는다 — 화면에 안 보일 뿐,
 * 파일을 뜯어보면 남의 현장 도면이 들어 있고 용량도 그만큼 무겁다.
 * 실제로 쓰는 것만 남기고 번호를 다시 매긴다.
 */
function pruneMedia(wb: ExcelJS.Workbook) {
  const media = (wb as unknown as { media?: unknown[] }).media;
  if (!Array.isArray(media)) return;
  const remap = new Map<string, number>();
  const keep: unknown[] = [];
  for (const ws of wb.worksheets) {
    const list = (ws as unknown as { _media?: Array<{ imageId: string }> })._media ?? [];
    for (const item of list) {
      const prev = String(item.imageId);
      if (!remap.has(prev)) {
        remap.set(prev, keep.length);
        keep.push(media[Number(prev)]);
      }
      item.imageId = String(remap.get(prev));
    }
  }
  media.length = 0;
  for (const x of keep) media.push(x);
}

/**
 * 설치계획 및 주변현황도 — 도면은 지우고 옆의 대수 표만 우리 배정으로 채운다.
 * 아래쪽(29~34행)에는 또 다른 현장(501~505동)의 표가 남아 있어 함께 비운다.
 */
function fillPlacement(ws: ExcelJS.Worksheet, plan: TcRentalPlan, lines: HcLine[]) {
  dropImages(ws);
  ws.getCell("A2").value = `■ 현장명 : ${plan.siteName}`;

  const first = 5;
  const last = first + MAX_ROWS - 1;
  unmergeRegion(ws, first, last, 9, 13);
  stampRows(ws, first, last, 9, 13, first);
  clearRegion(ws, first, last, 9, 13);
  lines.forEach((ln, i) => {
    const r = first + i;
    ws.getCell(`I${r}`).value = ln.building.name;
    ws.getCell(`J${r}`).value = null; // 코어(라인)는 현장 기입
    ws.getCell(`K${r}`).value = ln.building.aboveFloors;
    ws.getCell(`L${r}`).value = `${DEFAULT_OPERATION}
인버터방식`;
    ws.getCell(`M${r}`).value = 1;
  });
  mergeByBuilding(ws, "I", first, lines);

  // 다른 현장의 잔재 표
  clearRegion(ws, 29, 34, 15, 26);
}

/**
 * 입면도 — 도면은 지우고 동별 높이 산식 표만 남긴다.
 *
 * 양식은 동 4개 × 코어 2개 = 8칸이고, 우리 줄 수와 같다. 왼쪽/오른쪽 칸에 우리 줄을
 * 차례로 넣는다. 지층은 동마다 실측값이라 비워 둔다 — 설치높이 산정과 같은 이유다.
 */
function fillElevation(ws: ExcelJS.Worksheet, lines: HcLine[]) {
  dropImages(ws);

  /** [제목행, 소제목행] — 소제목 아래 6줄이 산식 표다 */
  const blocks: Array<[number, number]> = [
    [2, 29],
    [39, 66],
    [76, 103],
    [113, 140],
  ];

  blocks.forEach(([titleRow, headRow], k) => {
    const pair = [lines[k * 2], lines[k * 2 + 1]];
    const names = pair.filter(Boolean).map((l) => l.building.name);
    ws.getCell(`B${titleRow}`).value =
      names.length > 0 ? `□ ${[...new Set(names)].join(" · ")} 입면도 (정면도)` : null;

    // 왼쪽(B~D) / 오른쪽(G~I) 두 칸
    ([
      ["B", "C", "D"],
      ["G", "H", "I"],
    ] as const).forEach((cols, side) => {
      const ln = pair[side];
      const [label, expr, value] = cols;
      if (!ln) {
        for (let r = headRow; r <= headRow + 7; r += 1) {
          for (const c of cols) ws.getCell(`${c}${r}`).value = null;
        }
        return;
      }
      const above = ln.building.aboveFloors;
      const h = ln.height;
      ws.getCell(`${label}${headRow}`).value = `□ ${ln.building.name} (${above}층)`;

      // 양식은 `연장 / 최상층 / 기준층 / 저층부 / 지층` 다섯 줄로 고정이다.
      // 구간이 더 잘게 나뉘면(1~3F 가 한 구간인 현장 등) 중간 구간들을 한 줄로 접는다 —
      // 줄을 늘리면 아래 합계 수식 범위가 어긋난다.
      const bands = h.bands;
      const topBand = bands[bands.length - 1];
      const firstBand = bands[0];
      const middle = bands.slice(1, -1);
      const middleText = middle.map((x) => `${x.height}m*${x.count}층`).join(" + ");
      const middleFormula = middle.map((x) => `${x.count}*${x.height}`).join("+");
      const rows: Array<[string, string, ExcelJS.CellValue]> = [
        ["연장", `${h.extend.toFixed(1)}m`, h.extend],
        [
          `최상층(${topBand?.label ?? ""}) `,
          topBand ? `${topBand.height}m*${topBand.count}층` : "",
          topBand ? round2(topBand.height * topBand.count) : null,
        ],
        [
          middle.length > 0 ? `기준층(${middle[0].from}~${middle[middle.length - 1].to}층) ` : "기준층",
          middleText,
          middleFormula ? { formula: middleFormula } : null,
        ],
        [
          `저층부(${firstBand?.label ?? ""}) `,
          firstBand ? `${firstBand.height}m*${firstBand.count}층` : "",
          firstBand ? round2(firstBand.height * firstBand.count) : null,
        ],
        ["지층", h.baseMissing ? "" : `${h.base}m`, h.baseMissing ? null : h.base],
      ];
      // 구간이 둘뿐이면(저층부 = 최상층 바로 아래) 접을 중간이 없어 기준층 줄이 빈다
      rows.forEach(([name, formulaText, v], i) => {
        const r = headRow + 2 + i;
        ws.getCell(`${label}${r}`).value = name;
        ws.getCell(`${expr}${r}`).value = formulaText || null;
        ws.getCell(`${value}${r}`).value = v;
      });
      const sumRow = headRow + 7;
      ws.getCell(`${label}${sumRow}`).value = "합 계";
      ws.getCell(`${expr}${sumRow}`).value = "합 계";
      ws.getCell(`${value}${sumRow}`).value = {
        formula: `SUM(${value}${headRow + 2}:${value}${headRow + 6})`,
      };
    });
  });
}

function fillCover(wb: ExcelJS.Workbook, plan: TcRentalPlan, today: string) {
  const ws = wb.getWorksheet("갑지");
  if (!ws) return;
  const d = parseYmd(today);
  ws.getCell("A12").value = d
    ? `${d.getUTCFullYear()}년  ${String(d.getUTCMonth() + 1).padStart(2, "0")}월     일`
    : "";
  ws.getCell("A21").value = plan.siteName;
}

function fillBoq(wb: ExcelJS.Workbook, plan: TcRentalPlan) {
  const ws = wb.getWorksheet("내역서");
  if (!ws) return;
  // 수량(D열)은 산출 시트를 물고 있는 수식이라 건드리지 않는다 — 숫자로 덮으면 두 문서가 어긋난다
  ws.getCell("A1").value = `[${plan.siteName}] 건설용 리프트 임대, 설치, 해체 내역서`;
  ws.getCell("A5").value = `■ ${plan.siteName}`;
}

/**
 * (건설용리프트)임대기간산출 — 이 문서의 원천.
 *
 * 1. 임대기간 산정(11~18행): 층수로 공기를 역산해 **견적(실행기준)** 을 내고,
 *    옆 칸에 임대기간 시트의 월 합계(**현장**)를 나란히 놓아 차이를 보여준다.
 * 2. 기타장비(25~32행): 대수·EA 는 운용 형태 계수(V11:W14)와 층수에서 따라 나온다.
 */
function fillCalc(ws: ExcelJS.Worksheet, plan: TcRentalPlan, lines: HcLine[], today: string) {
  const d = parseYmd(today);
  if (d) {
    ws.getCell("A2").value = `(${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")})`;
  }
  ws.getCell("A3").value = `■ 현장명 : ${plan.siteName}`;
  // 상단 "층고" 기준 블록 — 원본 현장 값이 박혀 있어 우리 기본값으로 바꾼다.
  // (동별로 다르면 아래 설치높이 산정의 동별 값이 우선이고, 여기는 기준 표기다)
  ws.getCell("C7").value = Math.round(plan.params.hc.floorHeight.typical * 1000);
  ws.getCell("E7").value = Math.round(plan.params.hc.floorHeight.first * 1000);
  ws.getCell("G7").value = Math.round(plan.params.hc.floorHeight.top * 1000);

  for (const first of [CALC_FIRST_ROW, ETC_FIRST_ROW]) {
    const last = first + MAX_ROWS - 1;
    unmergeRegion(ws, first, last, 1, 16);
    stampRows(ws, first, last, 1, 16, first);
    clearRegion(ws, first, last, 1, 18);
  }

  lines.forEach((ln, i) => {
    const b = ln.building;
    const r = CALC_FIRST_ROW + i;
    ws.getCell(`A${r}`).value = b.name;
    fitColumn(ws, "A", b.name);
    ws.getCell(`B${r}`).value = null; // 라인(세대)은 현장 기입
    ws.getCell(`C${r}`).value = b.aboveFloors;
    ws.getCell(`D${r}`).value = { formula: `+C${r}-5` };
    ws.getCell(`E${r}`).value = 1;
    ws.getCell(`F${r}`).value = Math.max(0, b.phFloors);
    ws.getCell(`G${r}`).value = { formula: `+D${r}*$E$6+E${r}*$G$6+$I$6*F${r}` };
    ws.getCell(`H${r}`).value = { formula: `G${r}/365*12` };
    ws.getCell(`I${r}`).value = { formula: `+MAX($H${r}:$H${r})+4` };
    ws.getCell(`J${r}`).value = DEFAULT_OPERATION;
    ws.getCell(`K${r}`).value = 1;
    ws.getCell(`L${r}`).value = { formula: `+ROUNDUP(I${r}*K${r},0)` };
    ws.getCell(`M${r}`).value = { formula: `임대기간!Y${TERM_FIRST_ROW + i}` };
    ws.getCell(`N${r}`).value = { formula: `M${r}-L${r}` };
    ws.getCell(`O${r}`).value = `${ln.no}호기`;

    const e = ETC_FIRST_ROW + i;
    ws.getCell(`A${e}`).value = b.name;
    ws.getCell(`C${e}`).value = b.aboveFloors;
    ws.getCell(`D${e}`).value = { formula: `+C${e}-5` };
    ws.getCell(`E${e}`).value = 1;
    ws.getCell(`F${e}`).value = Math.max(0, b.phFloors);
    ws.getCell(`G${e}`).value = DEFAULT_OPERATION;
    ws.getCell(`H${e}`).value = { formula: `M${r}` };
    ws.getCell(`I${e}`).value = { formula: `VLOOKUP($G${e},$V$11:$W$14,2,0)*H${e}` };
    ws.getCell(`J${e}`).value = { formula: `VLOOKUP($G${e},$V$11:$W$14,2,0)*(C${e})` };
    ws.getCell(`K${e}`).value = { formula: `J${e}` };
    ws.getCell(`L${e}`).value = { formula: `J${e}` };
    ws.getCell(`M${e}`).value = { formula: `'설치높이 산정'!G${HEIGHT_FIRST_ROW + i}` };
    ws.getCell(`N${e}`).value = { formula: `K${r}` };
    ws.getCell(`O${e}`).value = { formula: `I${e}/H${e}` };
    ws.getCell(`P${e}`).value = { formula: `K${r}` };
  });

  // 비고(O:P)는 양식이 줄마다 두 칸을 묶는다 — 병합을 풀었으니 다시 묶어 준다
  for (let r = CALC_FIRST_ROW; r < CALC_FIRST_ROW + MAX_ROWS; r += 1) {
    ws.mergeCells(`O${r}:P${r}`);
  }
  mergeByBuilding(ws, "A", CALC_FIRST_ROW, lines);
  mergeByBuilding(ws, "A", ETC_FIRST_ROW, lines);
}

/** 임대기간 — 월별 투입 그리드. 칠한 칸 수가 곧 "현장" 임대개월이 된다 */
function fillTerm(ws: ExcelJS.Worksheet, plan: TcRentalPlan, lines: HcLine[]) {
  ws.getCell("A2").value = `■ 현장명 : ${plan.siteName}`;

  const all = lines.flatMap((l) => l.months).sort();
  const months: string[] = [];
  if (all.length > 0) {
    let cur = all[0];
    const to = all[all.length - 1];
    while (cur <= to && months.length < 600) {
      months.push(cur);
      const y = Number(cur.slice(0, 4));
      const m = Number(cur.slice(5, 7));
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  const capacity = TERM_MONTH_LAST_COL - TERM_MONTH_FIRST_COL + 1;
  if (months.length > capacity) {
    overflow.push(`임대기간: ${months.length - capacity}개월이 양식 칸을 넘었습니다`);
  }
  const shown = months.slice(0, capacity);

  // 연도 머리글은 원본 구간으로 묶여 있다 — 우리 구간에 맞춰 다시 묶는다
  const headStyle = { ...ws.getRow(3).getCell(TERM_MONTH_FIRST_COL).style };
  unmergeRegion(ws, 3, 3, TERM_MONTH_FIRST_COL, TERM_MONTH_LAST_COL);
  for (let i = 0; i < capacity; i += 1) {
    const col = TERM_MONTH_FIRST_COL + i;
    ws.getRow(3).getCell(col).style = { ...headStyle };
    ws.getRow(3).getCell(col).value = null;
    ws.getRow(4).getCell(col).value = shown[i] ? Number(shown[i].slice(5, 7)) : null;
  }
  let i = 0;
  while (i < shown.length) {
    const year = shown[i].slice(0, 4);
    let j = i;
    while (j + 1 < shown.length && shown[j + 1].slice(0, 4) === year) j += 1;
    ws.getRow(3).getCell(TERM_MONTH_FIRST_COL + i).value = `${year}년`;
    if (j > i) ws.mergeCells(3, TERM_MONTH_FIRST_COL + i, 3, TERM_MONTH_FIRST_COL + j);
    i = j + 1;
  }

  const last = TERM_FIRST_ROW + MAX_ROWS - 1;
  unmergeRegion(ws, TERM_FIRST_ROW, last, 1, 26);
  stampRows(ws, TERM_FIRST_ROW, last, 1, 26, TERM_FIRST_ROW);
  clearRegion(ws, TERM_FIRST_ROW, last, 1, 26);

  lines.forEach((ln, idx) => {
    const r = TERM_FIRST_ROW + idx;
    ws.getCell(`A${r}`).value = ln.building.name;
    fitColumn(ws, "A", ln.building.name);
    ws.getCell(`B${r}`).value = {
      formula: `'(건설용리프트)임대기간산출'!B${CALC_FIRST_ROW + idx}`,
    };
    ws.getCell(`C${r}`).value = {
      formula: `'(건설용리프트)임대기간산출'!C${CALC_FIRST_ROW + idx}`,
    };
    const on = new Set(ln.months);
    for (let k = 0; k < capacity; k += 1) {
      ws.getRow(r).getCell(TERM_MONTH_FIRST_COL + k).value =
        shown[k] && on.has(shown[k]) ? 1 : null;
    }
    ws.getCell(`Y${r}`).value = { formula: `SUM(D${r}:X${r})` };
    ws.getCell(`Z${r}`).value = `${ln.no}호기`;
  });

  mergeByBuilding(ws, "A", TERM_FIRST_ROW, lines);
}

/**
 * 설치높이 산정 — 층고로 리프트 높이를 잡는다.
 *
 * **지층 높이(I열)는 비워 둔다.** 동마다 기초 레벨이 달라 공정표에서 나오지 않는 값이고,
 * 추정해 넣으면 그대로 설치비·해체비 수량(M)이 된다. 비고에 표시해 두면 한 칸만 채워도
 * 값과 설치높이가 그 자리에서 맞춰진다.
 */
function fillHeight(ws: ExcelJS.Worksheet, plan: TcRentalPlan, lines: HcLine[]) {
  ws.getCell("A2").value = `■ 현장명 : ${plan.siteName}`;

  const last = HEIGHT_FIRST_ROW + MAX_ROWS - 1;
  unmergeRegion(ws, HEIGHT_FIRST_ROW, last, 1, 16);
  stampRows(ws, HEIGHT_FIRST_ROW, last, 1, 16, HEIGHT_FIRST_ROW);
  clearRegion(ws, HEIGHT_FIRST_ROW, last, 1, 16);

  lines.forEach((ln, idx) => {
    const r = HEIGHT_FIRST_ROW + idx;
    const h = ln.height;
    ws.getCell(`A${r}`).value = ln.building.name;
    ws.getCell(`B${r}`).value = { formula: `임대기간!B${TERM_FIRST_ROW + idx}` };
    ws.getCell(`C${r}`).value = { formula: `임대기간!C${TERM_FIRST_ROW + idx}` };
    ws.getCell(`D${r}`).value = "안방발코니";
    ws.getCell(`E${r}`).value = h.describe;
    fitColumn(ws, "E", h.describe);
    // 값(F)은 **구간을 그대로 펼친 수식**이다. 양식 원본도 이 칸에
    // `=8.75+3.08*1+2.88*22+3.08+3` 처럼 식을 적어 두므로 모양이 같다.
    ws.getCell(`F${r}`).value = { formula: h.expression };
    ws.getCell(`G${r}`).value = { formula: `ROUNDUP(F${r},0)` };
    ws.getCell(`H${r}`).value = h.baseMissing ? "지층 높이 입력 필요" : null;

    // I~P 는 양식의 보조 표인데 칸이 `1층 | 기준층 | 층수 | 최상층` 세 종류로 **고정**이다.
    // 층고 구간이 그 모양일 때만 채우고, 1~3F 가 한 구간인 현장처럼 다른 모양이면
    // 억지로 끼워 넣지 않고 비운다 — 옆 칸(F)과 어긋난 숫자가 남는 것이 더 나쁘다.
    const helper = ["I", "J", "K", "L", "M", "N", "O", "P"];
    if (h.simple) {
      ws.getCell(`I${r}`).value = h.baseMissing ? null : h.base;
      ws.getCell(`J${r}`).value = h.simple.first;
      ws.getCell(`K${r}`).value = h.simple.typical;
      ws.getCell(`L${r}`).value = { formula: `C${r}-2` };
      ws.getCell(`M${r}`).value = h.simple.top;
      ws.getCell(`N${r}`).value = h.extend;
      ws.getCell(`O${r}`).value = { formula: `I${r}+J${r}*1+K${r}*L${r}+M${r}+N${r}` };
      ws.getCell(`P${r}`).value = { formula: `ROUNDUP(O${r},0)` };
    } else {
      for (const col of helper) ws.getCell(`${col}${r}`).value = null;
    }
  });

  mergeByBuilding(ws, "A", HEIGHT_FIRST_ROW, lines);
  ws.getCell(`F${last + 1}`).value = { formula: `ROUNDUP(SUM(F${HEIGHT_FIRST_ROW}:F${last}),0)` };
  ws.getCell(`G${last + 1}`).value = { formula: `SUM(G${HEIGHT_FIRST_ROW}:G${last})` };
  // 보조 표(P)는 구간 모양이 양식과 다르면 비어 있으므로 합계도 비운다
  ws.getCell(`P${last + 1}`).value = lines.every((l) => l.height.simple)
    ? { formula: `SUM(P${HEIGHT_FIRST_ROW}:P${last})` }
    : null;
}

export async function generateHcOrderForm({ plan, spans }: HcOrderInput): Promise<string[]> {
  overflow.length = 0;

  const byId = new Map(plan.buildings.map((b) => [b.id, b]));
  const lines: HcLine[] = [];
  for (const s of spans.filter((x) => x.kind === "hc" && !x.problem).sort((a, b) => a.no - b.no)) {
    for (const id of s.buildingIds) {
      const b = byId.get(id);
      if (!b) continue;
      lines.push({
        no: s.no,
        building: b,
        months: monthsFrom(s.mobilizeStart, Math.max(1, s.rentalMonths)),
        height: resolveHoistHeight(b, plan.params),
      });
    }
  }
  if (lines.length === 0) {
    throw new Error("건설용리프트 배정이 없습니다. ② 호기 배정에서 먼저 지정하세요.");
  }
  if (lines.length > MAX_ROWS) {
    overflow.push(`${lines.length - MAX_ROWS}개 라인이 양식 줄 수(${MAX_ROWS})를 넘어 빠졌습니다`);
  }
  const used = lines.slice(0, MAX_ROWS);

  const XL = (await import("exceljs")).default;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("발주의뢰서 양식을 불러오지 못했습니다.");
  const wb = new XL.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());

  for (const ws of [...wb.worksheets]) {
    if (!KEEP_SHEETS.includes(ws.name)) wb.removeWorksheet(ws.id);
  }
  for (const ws of wb.worksheets) unshareFormulas(ws);
  pruneDefinedNames(wb, KEEP_SHEETS);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  fillCover(wb, plan, today);
  const place = wb.getWorksheet("건설용리프트설치위치도");
  if (place) fillPlacement(place, plan, used);
  const elev = wb.getWorksheet("입면도");
  if (elev) fillElevation(elev, used);
  const calc = wb.getWorksheet("(건설용리프트)임대기간산출");
  if (calc) fillCalc(calc, plan, used, today);
  const term = wb.getWorksheet("임대기간");
  if (term) fillTerm(term, plan, used);
  const height = wb.getWorksheet("설치높이 산정");
  if (height) fillHeight(height, plan, used);
  fillBoq(wb, plan);

  pruneMedia(wb);

  // 수식만 써 두고 값은 비워 두므로, 파일을 열 때 엑셀이 다시 계산하게 한다
  wb.calcProperties.fullCalcOnLoad = true;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plan.siteName}_건설용리프트 발주의뢰서.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return [...overflow];
}
