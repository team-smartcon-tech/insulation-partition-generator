/**
 * 현장산출서 — 구조화 보고서 → CSV(기존 「현장식 산출서 CSV」 배치 그대로) · 「현장산출검토」 시트.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  addSiteReportSheet,
  makeCmp,
  siteReportToCsv,
} from "../apps/web/src/features/elevation/orderForm/siteReport.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ExcelJS = createRequire(path.join(ROOT, "apps/web/package.json"))("exceljs");

const thks = [55, 95];
const m = (a, b) => new Map([[55, a], [95, b]]);

/** 부산장안 현장산출서 모양을 줄인 보고서 */
const REPORT = {
  thks,
  typeRows: [
    { type: "59A(기본)", group: "1~3F", floorHeight: 2840, ea: [49, 30], area: [116.42, 71.28], cmp: makeCmp(thks, m(107, 67.83), m(116.42, 71.28)) },
    { type: "59A(기본)", group: "기준층", floorHeight: 2640, ea: [45, 27], area: [106.92, 64.15], cmp: makeCmp(thks, m(97.85, 61.75), m(106.92, 64.15)) },
    { type: "84B", group: null, floorHeight: null, ea: null, area: null, cmp: null },
  ],
  buildingRows: [
    { building: "101동", type: "59A(기본)", low: 0, roof: 1, base: 22, total: 23, floorHeights: [2840, 2840, 2640], area: [3010.4, 1922.2], cmp: makeCmp(thks, m(2696.85, 1884.06), m(3010.4, 1922.2)) },
    { building: "102동", type: "84B", low: 1, roof: 1, base: 10, total: 12, floorHeights: null, area: null, cmp: null },
  ],
  total: { units: 35, area: [3010.4, 1922.2], cmp: makeCmp(thks, m(2696.85, 1884.06), m(3010.4, 1922.2)) },
  missing: ["84B"],
};

test("makeCmp — 두께별 실면적·로스율·합계", () => {
  const c = makeCmp(thks, m(100, 50), m(110, 50));
  assert.deepEqual(c.net, [100, 50]);
  assert.deepEqual(c.loss, [10, 0]);
  assert.deepEqual([c.netSum, c.grossSum, c.diff, c.lossAll], [150, 160, 10, (10 / 150) * 100]);
  const z = makeCmp(thks, null, m(3, 4));
  assert.deepEqual(z.loss, [null, null]);
  assert.equal(z.lossAll, null);
});

test("CSV — 기존 현장식 산출서와 같은 줄 배치", () => {
  const csv = siteReportToCsv(REPORT);
  assert.ok(csv.startsWith("﻿[단위세대 타입별 단열재 수량]\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[3], "단위세대 타입,층 그룹,층고(mm),55T 개수(EA),95T 개수(EA),55T 면적(M2),95T 면적(M2),55T 실면적(M2),95T 실면적(M2),55T 로스율(%),95T 로스율(%),실면적 계(M2),산출면적 계(M2),차이(M2),로스율(%)");
  assert.equal(lines[4], "59A(기본),1~3F,2840,49,30,116.42,71.28,107.00,67.83,8.8,5.1,174.83,187.70,12.87,7.4");
  assert.equal(lines[6], "84B,-,-,-,-,-,-,-,-,-,-,-,-,-,-");
  assert.equal(lines[7], "");
  assert.equal(lines[8], "[동별 단열재 집계표]");
  assert.equal(lines[9], "동,단위세대 타입,1~3F,지붕층,기준층,세대수,층고(1~3F/지붕/기준),55T 면적(M2),95T 면적(M2),55T 실면적(M2),95T 실면적(M2),55T 로스율(%),95T 로스율(%),실면적 계(M2),산출면적 계(M2),차이(M2),로스율(%)");
  assert.equal(lines[10], "101동,59A(기본),0,1,22,23,2840/2840/2640,3010.4,1922.2,2696.85,1884.06,11.6,2.0,4580.91,4932.60,351.69,7.7");
  assert.equal(lines[11], "102동,84B,1,1,10,12,-/-/-,-,-,-,-,-,-,-,-,-,-");
  assert.equal(lines[12], "합계,,,,,35,,3010.4,1922.2,2696.85,1884.06,11.6,2.0,4580.91,4932.60,351.69,7.7");
  assert.equal(lines.length, 13);
});

test("현장산출검토 시트 — 결론·①·② 표와 합계", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = addSiteReportSheet(wb, REPORT, { siteName: "부산장안", boardLength: 1200, boardHeight: 600, now: new Date(2026, 9, 27) });
  assert.equal(ws.name, "현장산출검토");
  assert.equal(ws.getCell("A1").value, "[부산장안] 세대 단열재 현장산출 검토");
  assert.match(String(ws.getCell("A2").value), /정척 1200×600mm · 세대수 35 · 작성 2026-10-27/);
  // 결론 표: 두께별 산출/실면적
  const rows = [];
  ws.eachRow((row, n) => rows.push([n, row.getCell(1).value, row.getCell(2).value, row.getCell(3).value]));
  const t55 = rows.find((r) => r[1] === "55T");
  assert.deepEqual(t55.slice(2), [3010.4, 2696.85]);
  const sum = rows.find((r) => r[1] === "합계" && typeof r[2] === "number");
  assert.equal(sum[2], 4932.6);
  // ① 대표 입면 없는 타입은 대시, ② 합계 줄 세대수
  assert.ok(rows.some((r) => r[1] === "84B" && r[2] === "-"));
  const bSum = rows.filter((r) => r[1] === "합계").at(-1);
  assert.equal(ws.getRow(bSum[0]).getCell(6).value, 35);
  // 저장이 깨지지 않는다
  const buf = await wb.xlsx.writeBuffer();
  const re = new ExcelJS.Workbook();
  await re.xlsx.load(buf);
  assert.equal(re.getWorksheet("현장산출검토").pageSetup.orientation, "landscape");
});
