/**
 * 단열재 발주의뢰서 — 실행예산 내역서 파서 · 발주 줄 제안 (순수 함수).
 * 부산장안 2-2/11-3 내역서의 실제 배치를 본떠 만든 표로 돌려 본다.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInsulBudget,
  classifyBudgetSheets,
  parseThicknessMm,
  scanInsulRows,
  specWithThickness,
} from "../apps/web/src/features/elevation/orderForm/budgetParser.ts";
import {
  effectiveRows,
  proposeOrderLines,
  sumLines,
} from "../apps/web/src/features/elevation/orderForm/orderLines.ts";

/** 부산장안 2-2 건축(기) 를 줄인 표 — 행 번호가 실제와 다르더라도 **구조**는 같다 */
const BASE = {
  name: "2-2.건축(기)(발주용)",
  rows: [
    ["[공 사 명] 부산 장안지구", null, null, null],
    ["품          명", "규       격", "단위", "수량"],
    ["03.철근콘크리트공사"],
    ["[단열재타설부착공사]"],
    ["결로방지단열재(슬래브)", "T10, 압출법보온판 1호 W=450", "M2", 6220], // 시공 줄 — 제외
    ["단열재타설부착", "T30,PF보드,최하층바닥", "M2", 909], // 시공 줄 — 제외
    ["04.조적공사"],
    ["[합                계]"],
    ["단열재넣기", "단열재지급", "M2", 106], // 제외
    ["[지급자재]"],
    ["단열재", "T150 비드법보온판 2종2호", "M2", 85],
    ["단열재", "T110 압출법 1호", "M2", 228],
    ["06.미장공사"],
    ["[지급자재]"],
    ["단열재", "T: 60, PF보드", "M2", 1278],
    ["09.내장목공사"],
    ["[세대]"],
    ["단열재붙이기", "단열재지급", "M2", 4016], // 제외
    ["[지급자재]"],
    ["단열재", "T:110 비드법보온판 2종2호", "M2", 5695],
    ["단열재", "T:150 비드법보온판 2종2호", "M2", 25617],
  ],
};

/** 11-3 건축(확+옵) — 06.미장의 단열재는 `[지급자재]` 가 아니라 다른 소제목 아래 있다(실제 그렇다) */
const EXT = {
  name: "11-3.건축(확+옵)(발주용)",
  rows: [
    ["[공 사 명]"],
    ["품          명", "규       격", "단위", "수량"],
    ["04.조적공사"],
    ["[지급자재]"],
    ["단열재", "T150 비드법보온판 2종2호", "M2", 0],
    ["06.미장공사"],
    ["[층간소음완충재설치공사]"],
    ["단열재", "T: 60, PF보드", "M2", 455],
    ["09.내장목공사"],
    ["[지급자재]"],
    ["단열재", "T:110 비드법보온판 2종2호", "M2", 7190],
  ],
};

test("시트 이름으로 기본/확장 내역서를 가린다", () => {
  assert.deepEqual(classifyBudgetSheets(["표지", BASE.name, EXT.name]), { base: BASE.name, ext: EXT.name });
  assert.deepEqual(classifyBudgetSheets(["내역서"]), { base: "내역서", ext: null });
  assert.deepEqual(classifyBudgetSheets(["표지", "산출서"]), { base: null, ext: null });
});

test("품명이 정확히 '단열재' 인 줄만, 공종·소제목·엑셀 행 번호와 함께 찾는다", () => {
  const rows = scanInsulRows(BASE);
  assert.deepEqual(
    rows.map((r) => [r.excelRow, r.section, r.subsection, r.spec, r.qty]),
    [
      [11, "04.조적공사", "[지급자재]", "T150 비드법보온판 2종2호", 85],
      [12, "04.조적공사", "[지급자재]", "T110 압출법 1호", 228],
      [15, "06.미장공사", "[지급자재]", "T: 60, PF보드", 1278],
      [20, "09.내장목공사", "[지급자재]", "T:110 비드법보온판 2종2호", 5695],
      [21, "09.내장목공사", "[지급자재]", "T:150 비드법보온판 2종2호", 25617],
    ],
  );
});

test("기본·확장을 같은 공종·규격끼리 맞춘다 (공백·콜론 차이 무시)", () => {
  const b = buildInsulBudget([BASE, EXT]);
  assert.equal(b.baseSheet, BASE.name);
  assert.equal(b.extSheet, EXT.name);
  const pick = (spec) => b.items.find((i) => i.spec === spec);
  assert.deepEqual([pick("T: 60, PF보드").baseQty, pick("T: 60, PF보드").extQty], [1278, 455]);
  assert.deepEqual(
    [pick("T:110 비드법보온판 2종2호").baseQty, pick("T:110 비드법보온판 2종2호").extQty],
    [5695, 7190],
  );
  assert.equal(pick("T:110 비드법보온판 2종2호").ext.excelRow, 11);
  // 확장 쪽이 0 이어도 줄은 남는다 (검토 시트가 양쪽 행을 가리킨다)
  assert.deepEqual([pick("T150 비드법보온판 2종2호").baseQty, pick("T150 비드법보온판 2종2호").extQty], [85, 0]);
  assert.equal(b.items.length, 5);
});

test("규격에서 두께를 읽고 바꿔 쓴다", () => {
  assert.equal(parseThicknessMm("T:150 비드법보온판 2종2호"), 150);
  assert.equal(parseThicknessMm("T: 60, PF보드"), 60);
  assert.equal(parseThicknessMm("THK150 비드법2종2호(준불연)"), 150);
  assert.equal(parseThicknessMm("단열재지급"), null);
  assert.equal(specWithThickness("T:150 비드법보온판 2종2호", 55), "T:55 비드법보온판 2종2호");
  assert.equal(specWithThickness("T: 60, PF보드", 30), "T: 30, PF보드");
  assert.equal(specWithThickness("T150 비드법보온판 2종2호", 95), "T95 비드법보온판 2종2호");
});

const PRESETS = [
  { exposure: "direct", label: "직접외기", ply1: 95, ply2: 55 },
  { exposure: "indirect", label: "간접외기", ply1: 55, ply2: 55 },
];
const TOTALS = {
  units: 300,
  plies: [
    { exposure: "direct", ply: 1, thickness: 95, boards: 100, areaM2: 25617.4 },
    { exposure: "direct", ply: 2, thickness: 55, boards: 100, areaM2: 26001.6 },
    { exposure: "indirect", ply: 1, thickness: 55, boards: 50, areaM2: 6400.2 },
    { exposure: "indirect", ply: 2, thickness: 55, boards: 50, areaM2: 6600.7 },
  ],
};

test("내장목공사 지급자재는 두께 합이 맞는 프리셋으로 겹별 세분화, 나머지는 예산 그대로", () => {
  const lines = proposeOrderLines(buildInsulBudget([BASE, EXT]), TOTALS, PRESETS);
  const by = (spec) => lines.find((l) => l.item.spec === spec);

  const t150 = by("T:150 비드법보온판 2종2호");
  assert.equal(t150.preset.exposure, "direct");
  assert.equal(t150.useLayout, true);
  assert.deepEqual(
    effectiveRows(t150).map((r) => [r.spec, r.orderBase, r.orderExt]),
    [
      ["T:95 비드법보온판 2종2호", 25617, 0],
      ["T:55 비드법보온판 2종2호", 26002, 0],
    ],
  );

  // 간접외기 55/55 — 두께가 같아도 겹 번호로 갈라 두 줄이 서로 다른 수량을 받는다
  const t110 = by("T:110 비드법보온판 2종2호");
  assert.equal(t110.preset.exposure, "indirect");
  assert.deepEqual(
    effectiveRows(t110).map((r) => [r.spec, r.orderBase]),
    [
      ["T:55 비드법보온판 2종2호", 6400],
      ["T:55 비드법보온판 2종2호", 6601],
    ],
  );

  // 04.조적 T150 은 두께 합은 맞지만 세대 외벽이 아니다 → 기본은 예산 그대로, 켜면 세분화 가능
  const brick = by("T150 비드법보온판 2종2호");
  assert.equal(brick.preset.exposure, "direct");
  assert.equal(brick.useLayout, false);
  assert.deepEqual(effectiveRows(brick).map((r) => [r.spec, r.orderBase, r.orderExt]), [
    ["T150 비드법보온판 2종2호", 85, 0],
  ]);
  assert.equal(brick.layoutRows.length, 2);

  // 60T PF보드 — 맞는 프리셋이 없다
  const pf = by("T: 60, PF보드");
  assert.equal(pf.preset, null);
  assert.deepEqual(effectiveRows(pf).map((r) => [r.orderBase, r.orderExt]), [[1278, 455]]);

  const sum = sumLines(lines);
  assert.equal(sum.budget, 85 + 228 + 1278 + 455 + 5695 + 7190 + 25617);
  assert.equal(sum.order, 85 + 228 + 1278 + 455 + 6400 + 6601 + 25617 + 26002);
});

test("2P=0(단일겹) 프리셋은 한 줄만 낸다", () => {
  const presets = [{ exposure: "indirect", label: "간접외기 단일", ply1: 110, ply2: 0 }];
  const totals = { units: 1, plies: [{ exposure: "indirect", ply: 1, thickness: 110, boards: 3, areaM2: 12 }] };
  const [line] = proposeOrderLines(
    buildInsulBudget([{ name: "x 건축(기)", rows: [["09.내장목공사"], ["[지급자재]"], ["단열재", "T:110 비드법", "M2", 10]] }]),
    totals,
    presets,
  );
  assert.equal(line.useLayout, true);
  assert.deepEqual(effectiveRows(line).map((r) => [r.spec, r.orderBase]), [["T:110 비드법", 12]]);
});
