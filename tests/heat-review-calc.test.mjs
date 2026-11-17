/**
 * 동절기 열원검토 — 계산 엔진 시험.
 * 현장에서 쓰던 두 엑셀(단위세대 열원검토 59형·84형, 주차장 열풍기 산정툴)의 값과 맞는지 본다.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  zoneLoss,
  heaterOutput,
  heaterNeed,
  heaterCost,
  planCost,
  floorRepeats,
} from "../apps/web/src/features/heatReview/engine/calc.ts";
import {
  measurePolygon,
  placeHeaters,
  pointInPolygon,
} from "../apps/web/src/features/heatReview/engine/geometry.ts";
import {
  DEFAULT_CONDITIONS,
  DEFAULT_HEATERS,
  createProject,
  createZone,
} from "../apps/web/src/features/heatReview/defaults.ts";

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

function unitZone(name, area, perimeter, openingAreaM2) {
  const z = createZone("unit", name, 0, {
    source: "manual",
    polygon: null,
    dims: null,
    area,
    perimeter,
  });
  z.openings = [{ id: "o", label: "합계", w: openingAreaM2, h: 1, count: 1 }];
  return z;
}

test("정밀식 — 59형 검토서와 같은 값", () => {
  const loss = zoneLoss(unitZone("59형", 97, 43.38, 19.741), DEFAULT_CONDITIONS);
  near(loss.wallArea, 103.892, 0.001);
  near(loss.conduction, 35685.1164);
  near(loss.ventilation, 5616.772875 + 23649.57);
  near(loss.total, 64951.459275);
  near(loss.totalElectric, 38611.7506875);
});

test("정밀식 — 84형 검토서와 같은 값", () => {
  const loss = zoneLoss(unitZone("84형", 124.94, 85.5, 23.207), DEFAULT_CONDITIONS);
  near(loss.conduction, 57139.0728);
  near(loss.total, 94835.3292825);
});

test("간이식 — 주차장 산정툴과 같은 값(45×25×3.6m → 9대)", () => {
  const z = createZone("parking", "CJ-1", 0, {
    source: "manual",
    polygon: null,
    dims: { l: 45, w: 25 },
    area: 45 * 25,
    perimeter: 2 * (45 + 25),
  });
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  near(loss.conduction, 275400);
  near(loss.ventilation, 16329.6);
  near(loss.total, 364662);
  const need = heaterNeed(loss, DEFAULT_HEATERS[0], z);
  assert.equal(need.count, 9);
  assert.ok(need.ok);
});

test("열원 급열량 — 엑셀과 같은 값", () => {
  const [kerosene, pellet, solid] = DEFAULT_HEATERS;
  near(heaterOutput(kerosene), 40850);
  near(heaterOutput(pellet), 19636.3636, 0.001);
  near(heaterOutput(solid), 10628.5714, 0.001);
});

test("정밀식 필요 대수 = 반올림 + 1 — 59형 검토서와 같은 대수", () => {
  const z = unitZone("59형", 97, 43.38, 19.741);
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  const [kerosene, pellet, solid] = DEFAULT_HEATERS;
  assert.equal(heaterNeed(loss, kerosene, z).count, 3); // 1.59 → 2 + 1
  assert.equal(heaterNeed(loss, pellet, z).count, 4); // 3.31 → 3 + 1
  assert.equal(heaterNeed(loss, solid, z).count, 7); // 6.11 → 6 + 1
});

test("84형을 도면 외곽으로 재면(둘레 47.69m·개구부 없음) 열풍기 3대 — 배치도와 같다", () => {
  const z = unitZone("84형", 124.394, 47.69, 0);
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  near(loss.total, 78475, 5);
  assert.equal(heaterNeed(loss, DEFAULT_HEATERS[0], z).count, 3); // 1.92 → 2 + 1
  // 규칙을 "올림" 으로 바꾸면 최소 대수 2대
  const ceil = zoneLoss(z, { ...DEFAULT_CONDITIONS, enclosureCountRule: "ceil" });
  assert.equal(heaterNeed(ceil, DEFAULT_HEATERS[0], z).count, 2);
});

test("코어는 올림 — 현장 배치도(코어별 열풍기 1 · 펠릿 2)와 같다", () => {
  const z = createZone("core", "코어 1", 0, { source: "manual", polygon: null, dims: null, area: 53.032, perimeter: 32.034 });
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  near(loss.total, 37932, 5);
  const [kerosene, pellet] = DEFAULT_HEATERS;
  assert.equal(heaterNeed(loss, kerosene, z).count, 1); // 0.93 → 1
  assert.equal(heaterNeed(loss, pellet, z).count, 2); // 1.93 → 2
  // 코어 규칙을 반올림+1 로 바꾸면 3대
  const plus = zoneLoss(z, { ...DEFAULT_CONDITIONS, coreCountRule: "roundPlus1" });
  assert.equal(heaterNeed(plus, pellet, z).count, 3);
});

test("어느 규칙이든 급열량이 손실열량보다 작아지지 않는다", () => {
  const z = unitZone("84형", 124.94, 85.5, 23.207);
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  for (const h of DEFAULT_HEATERS) {
    const need = heaterNeed(loss, h, z);
    assert.ok(need.supply >= need.required, `${h.name} 부족`);
    assert.ok(need.ok);
  }
  // 적용 대수를 줄이면 NG
  z.applied = { kerosene: 2 };
  const short = heaterNeed(loss, DEFAULT_HEATERS[0], z);
  assert.equal(short.applied, 2);
  assert.equal(short.ok, false);
});

test("입력이 모자라면 사유를 돌려주고 0 을 낸다", () => {
  const z = unitZone("빈 구역", 0, 0, 0);
  const loss = zoneLoss(z, DEFAULT_CONDITIONS);
  assert.ok(loss.issue);
  assert.equal(loss.total, 0);
  assert.equal(heaterNeed(loss, DEFAULT_HEATERS[0], z).count, 0);
});

test("비용 — 기준층 1개층·동절기 합계", () => {
  const p = createProject("시험");
  const a = unitZone("59형", 97, 43.38, 19.741);
  a.qty = 4;
  const b = unitZone("84형", 124.94, 85.5, 23.207);
  b.qty = 2;
  p.zones = [a, b];
  assert.equal(floorRepeats(p.cost), 99);

  const pellet = p.heaters.find((h) => h.id === "pellet");
  const c = heaterCost(p, pellet);
  // 59형 4대(3.31→3+1) × 4세대 + 84형 6대(4.83→5+1) × 2세대 = 28대
  assert.equal(c.floor.units, 28);
  near(c.floor.fuel, (28 * 48 * 45) / 11, 0.001);
  near(c.floor.rental, (28 * 68000) / 3, 0.001);
  near(c.floor.labor, 13 * 170000);
  near(c.seasonTotal, c.floor.perPour * 99, 0.01);
  assert.ok(c.allOk);
});

test("비용 — 주차장 구역은 구역별 반복·임대 개월로 따로 센다", () => {
  const p = createProject("시험");
  const z = createZone("parking", "CJ-1", 0, {
    source: "manual",
    polygon: null,
    dims: { l: 45, w: 25 },
    area: 1125,
    perimeter: 140,
  });
  z.repeats = 2;
  z.rentalMonths = 1;
  p.zones = [z];
  const kerosene = p.heaters[0];
  const c = heaterCost(p, kerosene);
  assert.equal(c.floor, null);
  assert.equal(c.parking[0].units, 9);
  const fuelCost = 9 * (48 / 6) * 50 * 1537;
  near(c.seasonTotal, fuelCost * 2 + 9 * 58000 + 19 * 170000 * 2, 0.01);
});

test("적용 계획 — 주차장은 열풍기, 세대는 펠릿처럼 종류별로 섞을 수 있다", () => {
  const p = createProject("시험");
  const unit = unitZone("59형", 97, 43.38, 19.741);
  unit.qty = 4;
  const core = createZone("core", "코어", 1, { source: "manual", polygon: null, dims: null, area: 48, perimeter: 28 });
  const cj = createZone("parking", "CJ-1", 2, {
    source: "manual",
    polygon: null,
    dims: { l: 45, w: 25 },
    area: 1125,
    perimeter: 140,
  });
  p.zones = [unit, core, cj];
  const [kerosene, pellet] = p.heaters;

  // 전부 같은 열원이면 그 열원 하나만 쓴 금액과 같다
  p.appliedHeaters = { unit: "pellet", core: "pellet", parking: "pellet" };
  near(planCost(p).seasonTotal, heaterCost(p, pellet).seasonTotal, 0.01);

  // 세대=펠릿, 코어·주차장=열풍기
  p.appliedHeaters = { unit: "pellet", core: "kerosene", parking: "kerosene" };
  const plan = planCost(p);
  const onlyK = heaterCost(p, kerosene);
  const onlyP = heaterCost(p, pellet);
  assert.equal(plan.rows.find((r) => r.zoneId === unit.id).heaterId, "pellet");
  assert.equal(plan.rows.find((r) => r.zoneId === cj.id).heaterId, "kerosene");
  // 주차장 구역은 열풍기만 쓴 경우와 금액이 같다
  near(plan.parking[0].season, onlyK.parking[0].season, 0.01);
  // 기준층: 세대 연료는 펠릿, 코어 연료는 열풍기. 인건비는 품이 큰 쪽(열풍기 19품) 한 번만
  const uP = onlyP.rows.find((r) => r.zoneId === unit.id);
  const cK = onlyK.rows.find((r) => r.zoneId === core.id);
  near(plan.floor.fuelCost, uP.fuelCost + cK.fuelCost, 0.01);
  near(plan.floor.rental, (uP.units * 68000 + cK.units * 58000) / 3, 0.01);
  near(plan.floor.labor, 19 * 170000);
  assert.equal(plan.byHeater.pellet.units, uP.units);
  assert.equal(plan.byHeater.kerosene.units, cK.units + onlyK.parking[0].units);
});

test("도면 다각형 → ㎡·m (mm 도면)", () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 45000, y: 0 },
    { x: 45000, y: 25000 },
    { x: 0, y: 25000 },
  ];
  assert.deepEqual(measurePolygon(poly, "mm"), { area: 1125, perimeter: 140 });
});

test("열원 배치 — ㄱ자 구역에서도 전부 구역 안에 놓인다", () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 30 },
    { x: 0, y: 30 },
  ];
  const pts = placeHeaters(poly, 7);
  assert.equal(pts.length, 7);
  for (const p of pts) assert.ok(pointInPolygon(p, poly));
});
