/**
 * 단열재 발주의뢰서 — 양식 채우기(ExcelJS) 통합 시험.
 * 실제 양식 파일(`apps/web/public/templates/insul-order-template.xlsx`)에 가짜 실행예산 내역서를 붙여
 * 시트 사이 수식 연결이 원본과 같은 모양으로 나오는지 본다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildInsulBudget } from "../apps/web/src/features/elevation/orderForm/budgetParser.ts";
import { proposeOrderLines } from "../apps/web/src/features/elevation/orderForm/orderLines.ts";
import {
  buildInsulOrderWorkbook,
  loadBudgetWorkbook,
} from "../apps/web/src/features/elevation/orderForm/insulOrderForm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "apps/web/package.json"));
const ExcelJS = require("exceljs");
const TEMPLATE = readFileSync(path.join(ROOT, "apps/web/public/templates/insul-order-template.xlsx"));

const BASE_NAME = "2-2.건축(기)(발주용)";
const EXT_NAME = "11-3.건축(확+옵)(발주용)";

/** 부산장안 내역서 모양의 가짜 통합 문서 — 수식 셀(금액)도 섞어 둔다 */
async function fakeBudget(extraItems = 0) {
  const wb = new ExcelJS.Workbook();
  const mk = (name, rows) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(["[공 사 명] 시험 현장"]);
    ws.addRow(["품          명", "규       격", "단위", "수량", "재 료 비"]);
    ws.addRow([]);
    ws.addRow([null, null, null, null, "단가", "금액"]);
    for (const r of rows) ws.addRow(r);
    // 금액 수식 — 복사할 때 값으로 바뀌어야 한다
    ws.getCell("F5").value = { formula: "D5*E5", result: 1 };
    // 사용자가 접어 둔 그룹(6~8행 숨김, 수준 1)·숨긴 열·인쇄 영역 — 그대로 따라와야 한다
    for (const r of [6, 7, 8]) {
      ws.getRow(r).outlineLevel = 1;
      ws.getRow(r).hidden = true;
    }
    ws.getColumn(5).hidden = true;
    ws.pageSetup.printArea = "A1:M20";
    ws.pageSetup.orientation = "landscape";
    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  };
  const extra = Array.from({ length: extraItems }, (_, i) => ["단열재", `T:${30 + i} 시험규격 ${i}`, "M2", 10 + i]);
  mk(BASE_NAME, [
    ["04.조적공사"],
    ["[지급자재]"],
    ["단열재", "T150 비드법보온판 2종2호", "M2", 85, 8100],
    ["06.미장공사"],
    ["[지급자재]"],
    ["단열재", "T: 60, PF보드", "M2", 1278, 12000],
    ["09.내장목공사"],
    ["[세대]"],
    ["단열재붙이기", "단열재지급", "M2", 4016],
    ["[지급자재]"],
    ["단열재", "T:110 비드법보온판 2종2호", "M2", 5695, 6160],
    ["단열재", "T:150 비드법보온판 2종2호", "M2", 25617, 8400],
    ...extra,
  ]);
  mk(EXT_NAME, [
    ["06.미장공사"],
    ["[층간소음완충재설치공사]"],
    ["단열재", "T: 60, PF보드", "M2", 455, 12000],
    ["09.내장목공사"],
    ["[지급자재]"],
    ["단열재", "T:110 비드법보온판 2종2호", "M2", 7190, 6160],
  ]);
  wb.addWorksheet("첨부1. 실정보고");
  const buf = await wb.xlsx.writeBuffer();
  return buf;
}

const PRESETS = [
  { exposure: "direct", label: "직접외기", ply1: 95, ply2: 55 },
  { exposure: "indirect", label: "간접외기", ply1: 55, ply2: 55 },
];
const TOTALS = {
  units: 300,
  plies: [
    { exposure: "direct", ply: 1, thickness: 95, boards: 100, areaM2: 25617 },
    { exposure: "direct", ply: 2, thickness: 55, boards: 100, areaM2: 26002 },
    { exposure: "indirect", ply: 1, thickness: 55, boards: 50, areaM2: 6400 },
    { exposure: "indirect", ply: 2, thickness: 55, boards: 50, areaM2: 6601 },
  ],
};

const f = (cell) => (cell.value && typeof cell.value === "object" && "formula" in cell.value ? cell.value.formula : null);
const v = (cell) => cell.value;

async function build(extraItems = 0) {
  const { workbook, grids } = await loadBudgetWorkbook(await fakeBudget(extraItems));
  const budget = buildInsulBudget(grids);
  const lines = proposeOrderLines(budget, TOTALS, PRESETS);
  const { workbook: out, warnings } = await buildInsulOrderWorkbook(
    { siteName: "시험현장", budgetWorkbook: workbook, budget, lines },
    TEMPLATE,
    new Date(2026, 9, 27),
  );
  // 저장했다 다시 읽는다 — 공유 수식·병합이 저장 때 터지지 않는지까지 본다
  const buf = await out.xlsx.writeBuffer();
  const re = new ExcelJS.Workbook();
  await re.xlsx.load(buf);
  return { out: re, warnings, budget, lines };
}

test("표지·청구서·검토 3장 + 내역서 2장이 남고, 다른 시트와 명명 범위는 없다", async () => {
  const { out, warnings } = await build();
  assert.deepEqual(
    out.worksheets.map((w) => w.name),
    ["표지", "자재청구서", "발주수량 검토", BASE_NAME, EXT_NAME],
  );
  assert.deepEqual(warnings, []);
  const cover = out.getWorksheet("표지");
  assert.equal(v(cover.getCell("A1")), "[시험현장] 단열재 자재 청구서");
  assert.equal(v(cover.getCell("A20")), "시험현장");
  assert.equal(v(cover.getCell("A12")), "2026년   10월      일");
  assert.equal(v(out.getWorksheet("자재청구서").getCell("G1")), "[시험현장] 단열재 자재 청구서");
  assert.equal(v(out.getWorksheet("발주수량 검토").getCell("B2")), "[시험현장]");
});

test("내역서는 값만 옮겨진다 (수식은 계산값으로)", async () => {
  const { out } = await build();
  const b = out.getWorksheet(BASE_NAME);
  assert.equal(v(b.getCell("A7")), "단열재");
  assert.equal(v(b.getCell("D7")), 85);
  assert.equal(f(b.getCell("F5")), null);
  assert.equal(v(b.getCell("F5")), 1);
});

test("내역서의 접힌 그룹·숨긴 열·인쇄 설정이 그대로 따라온다", async () => {
  const { out } = await build();
  const b = out.getWorksheet(BASE_NAME);
  assert.deepEqual([6, 7, 8].map((r) => [b.getRow(r).outlineLevel, b.getRow(r).hidden]), [[1, true], [1, true], [1, true]]);
  assert.equal(b.getRow(9).hidden, false);
  assert.equal(b.getColumn(5).hidden, true);
  assert.equal(b.pageSetup.printArea, "A1:M20");
  assert.equal(b.pageSetup.orientation, "landscape");
  assert.equal(b.properties.outlineProperties?.summaryBelow, false);
});

test("발주수량 검토 — 공종/소제목/품목 줄과 내역서 행 참조, 겹별 세분화", async () => {
  const { out } = await build();
  const q = out.getWorksheet("발주수량 검토");
  const col = (c, r1, r2) => Array.from({ length: r2 - r1 + 1 }, (_, i) => q.getCell(`${c}${r1 + i}`)).map((c) => f(c) ?? v(c));

  // 04.조적공사 → [지급자재] → T150(예산 그대로, 수식 연결)
  assert.deepEqual(col("B", 6, 8), ["04.조적공사", "[지급자재]", `'${BASE_NAME}'!A7`]);
  assert.equal(f(q.getCell("C8")), `'${BASE_NAME}'!B7`);
  assert.equal(f(q.getCell("E8")), `'${BASE_NAME}'!D7`);
  assert.equal(v(q.getCell("F8")), 0); // 확장 내역서에 없는 줄
  assert.equal(f(q.getCell("G8")), "E8+F8");
  assert.equal(f(q.getCell("I8")), "C8");
  assert.equal(f(q.getCell("K8")), "E8"); // 예산 그대로 → 수식
  assert.equal(f(q.getCell("N8")), "M8-G8");

  // 06.미장공사 T:60 PF — 기본 1278(행 10) + 확장 455(11-3 행 7)
  assert.equal(v(q.getCell("B9")), "06.미장공사");
  assert.equal(f(q.getCell("E11")), `'${BASE_NAME}'!D10`);
  assert.equal(f(q.getCell("F11")), `'${EXT_NAME}'!D7`);

  // 09.내장목공사 — T:110 → 55+55 (간접), T:150 → 95+55 (직접). 겹별 줄은 왼쪽이 비고 숫자가 들어간다
  assert.equal(v(q.getCell("B12")), "09.내장목공사");
  assert.equal(f(q.getCell("B14")), `'${BASE_NAME}'!A15`);
  assert.equal(f(q.getCell("F14")), `'${EXT_NAME}'!D10`);
  assert.deepEqual(col("I", 14, 17), [
    "T:55 비드법보온판 2종2호",
    "T:55 비드법보온판 2종2호",
    "T:95 비드법보온판 2종2호",
    "T:55 비드법보온판 2종2호",
  ]);
  assert.deepEqual(col("K", 14, 17), [6400, 6601, 25617, 26002]);
  assert.deepEqual(col("E", 15, 15), [null]); // 겹별 추가 줄 — 가실행 없음
  assert.equal(v(q.getCell("H15")), "단열재");
  assert.equal(v(q.getCell("P14")), "겹침이음 시공 규격 세분화");
  assert.equal(f(q.getCell("O17")), "IFERROR(N17/M17,0)");
  // 남는 양식 줄은 비어 있다
  assert.equal(v(q.getCell("B18")), null);
  assert.equal(v(q.getCell("H24")), null);
});

test("자재청구서 — 검토 줄을 순서대로 가리키고, 세분화 품목은 예산 규격 줄을 하나 더 낸다", async () => {
  const { out } = await build();
  const r = out.getWorksheet("자재청구서");
  const Q = "'발주수량 검토'";
  // 공종 줄
  assert.equal(f(r.getCell("C10")), `${Q}!H6`);
  // 04.조적 T150 — 한 줄: 실행 = G8, 누계 = M8
  assert.equal(f(r.getCell("C11")), `${Q}!H8`);
  assert.equal(f(r.getCell("I11")), `${Q}!G8`);
  assert.equal(f(r.getCell("N11")), `${Q}!M8`);
  assert.equal(f(r.getCell("K11")), "I11*J11");
  assert.equal(f(r.getCell("P11")), "N11-I11");
  // 06.미장
  assert.equal(f(r.getCell("C12")), `${Q}!H9`);
  assert.equal(f(r.getCell("I13")), `${Q}!G11`);
  // 09.내장목 — 공종(14), T:110 예산줄(15: 실행만), 55(16), 55(17), T:150 예산줄(18), 95(19), 55(20)
  assert.equal(f(r.getCell("C14")), `${Q}!H12`);
  assert.equal(f(r.getCell("F15")), `${Q}!C14`);
  assert.equal(f(r.getCell("I15")), `${Q}!G14`);
  assert.equal(v(r.getCell("N15")), 0);
  assert.equal(f(r.getCell("F16")), `${Q}!I14`);
  assert.equal(v(r.getCell("I16")), 0);
  assert.equal(f(r.getCell("N16")), `${Q}!M14`);
  assert.equal(f(r.getCell("N17")), `${Q}!M15`);
  assert.equal(f(r.getCell("F18")), `${Q}!C16`);
  assert.equal(f(r.getCell("N20")), `${Q}!M17`);
  // 남는 줄 비고, 바닥글은 제자리
  assert.equal(v(r.getCell("C21")), null);
  assert.equal(v(r.getCell("A31")), "WF-0603-1C-1/2");
});

test("품목이 양식 칸수보다 많으면 줄을 끼워 넣고 바닥글·인쇄 영역이 밀린다", async () => {
  const { out, lines } = await build(20);
  const q = out.getWorksheet("발주수량 검토");
  const r = out.getWorksheet("자재청구서");
  // 검토: 공종 3개 × (머리줄+소제목) + 품목 줄(22 + 겹별 2×2) = 32 줄 → 6..37, 인쇄 영역은 한 줄 더
  const itemRows = lines.reduce((a, l) => a + (l.useLayout ? l.layoutRows.length : 1), 0);
  const last = 5 + 3 * 2 + itemRows;
  assert.equal(last, 37);
  assert.ok(f(q.getCell(`N${last}`)), "마지막 줄에 증감 수식");
  assert.equal(v(q.getCell(`B${last + 1}`)), null);
  assert.equal(q.pageSetup.printArea, `A1:Q${last + 1}`);
  // 청구서: 바닥글이 끝으로
  let footer = null;
  r.eachRow((row, n) => {
    if (row.getCell(1).value === "WF-0603-1C-1/2") footer = n;
  });
  assert.ok(footer > 31, `바닥글 행 ${footer}`);
  assert.ok(f(r.getCell(`N${footer - 1}`)), "마지막 품목 줄에 누계 수식");
  // 끼워 넣은 줄도 병합(C:E) 이 있다
  const merges = Object.values(r._merges ?? {}).map((m) => (typeof m === "string" ? m : m.range));
  assert.ok(merges.includes(`C${footer - 1}:E${footer - 1}`), "끼워 넣은 줄 병합");
});
