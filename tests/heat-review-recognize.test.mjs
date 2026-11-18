// 동절기 열원검토 — 동 외곽 안 세대 인식 · 외곽 여유(옵셋) · 계산 구역 추리기
import test from "node:test";
import assert from "node:assert/strict";
import { offsetPolygon, placeHeaters, polygonArea, polygonPerimeter, wallClearance } from "../apps/web/src/features/heatReview/engine/geometry.ts";
import { calcZones, recognizeParts, recognizedCounts } from "../apps/web/src/features/heatReview/engine/recognize.ts";
import { createZone } from "../apps/web/src/features/heatReview/defaults.ts";

/** 다각형의 변을 도면 선분으로 */
const segsOf = (...polys) => {
  const out = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      out.push(a.x, a.y, b.x, b.y);
    }
  }
  return new Float64Array(out);
};
// ㄱ자 세대 (10m × 8m 에서 한 귀퉁이가 빠진 꼴), mm
const TYPE_A = [
  { x: 0, y: 0 },
  { x: 10000, y: 0 },
  { x: 10000, y: 5000 },
  { x: 6000, y: 5000 },
  { x: 6000, y: 8000 },
  { x: 0, y: 8000 },
];
const mirrorX = (poly, axis) => poly.map((p) => ({ x: 2 * axis - p.x, y: p.y }));
const shift = (poly, dx, dy) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));

test("옵셋: 사각형을 바깥으로 띄우면 가로·세로가 2배씩 늘어난다", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  const out = offsetPolygon(rect, 0.5);
  assert.ok(Math.abs(polygonArea(out) - 11 * 7) < 1e-9);
  assert.ok(Math.abs(polygonPerimeter(out) - 2 * (11 + 7)) < 1e-9);
  // 그린 방향(시계/반시계)과 상관없이 바깥으로
  const cw = offsetPolygon([...rect].reverse(), 0.5);
  assert.ok(Math.abs(polygonArea(cw) - 77) < 1e-9);
  // 0 이면 그대로
  assert.equal(offsetPolygon(rect, 0), rect);
});

test("옵셋: 오목한 모서리(ㄱ자)도 변마다 같은 거리만큼 띄운다", () => {
  const out = offsetPolygon(TYPE_A, 500);
  // 바깥으로 띄운 ㄱ자의 넓이 = 원래 + 둘레×d + 모서리 보정(볼록 5곳 +d², 오목 1곳 −d²)
  const expect = polygonArea(TYPE_A) + polygonPerimeter(TYPE_A) * 500 + 4 * 500 * 500;
  assert.ok(Math.abs(polygonArea(out) - expect) < 1);
});

test("세대 인식: 한 번 그린 타입을 뒤집힌 옆 세대까지 찾는다", () => {
  const second = mirrorX(TYPE_A, 10100); // 벽 두께 200 을 두고 좌우로 뒤집힌 세대
  const frame = [
    { x: -300, y: -300 },
    { x: 20500, y: -300 },
    { x: 20500, y: 8300 },
    { x: -300, y: 8300 },
  ];
  const parts = recognizeParts(frame, [{ id: "A", polygon: TYPE_A }], segsOf(TYPE_A, second), 30);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.templateId === "A"));
  // 넓이는 그대로, 자리는 서로 다르다
  for (const p of parts) assert.ok(Math.abs(polygonArea(p.polygon) - polygonArea(TYPE_A)) < 1);
  const xs = parts.map((p) => Math.min(...p.polygon.map((q) => q.x))).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 0) < 1 && Math.abs(xs[1] - 10200) < 1);
});

test("세대 인식: 돌아간 세대도 찾고, 외곽 밖의 같은 모양은 세지 않는다", () => {
  const rotated = shift(TYPE_A.map((p) => ({ x: -p.y, y: p.x })), 30000, 0); // 90° 돌린 것
  const outside = shift(TYPE_A, 0, 50000);
  const frame = [
    { x: -300, y: -300 },
    { x: 31000, y: -300 },
    { x: 31000, y: 11000 },
    { x: -300, y: 11000 },
  ];
  const parts = recognizeParts(frame, [{ id: "A", polygon: TYPE_A }], segsOf(TYPE_A, rotated, outside), 30);
  assert.equal(parts.length, 2);
});

test("세대 인식: 도면 선이 없어도 외곽 안에 그려 둔 타입은 한 세대로 센다", () => {
  const frame = [
    { x: -300, y: -300 },
    { x: 20500, y: -300 },
    { x: 20500, y: 8300 },
    { x: -300, y: 8300 },
  ];
  assert.equal(recognizeParts(frame, [{ id: "A", polygon: TYPE_A }], null, 30).length, 1);
  // 외곽 밖에 그린 타입은 세지 않는다
  assert.equal(recognizeParts(frame, [{ id: "A", polygon: shift(TYPE_A, 0, 40000) }], null, 30).length, 0);
});

test("세대 인식: 서로 다른 타입이 겹쳐 잡히지 않는다", () => {
  const typeB = [
    { x: 10200, y: 0 },
    { x: 17200, y: 0 },
    { x: 17200, y: 8000 },
    { x: 13200, y: 8000 },
    { x: 13200, y: 6000 },
    { x: 10200, y: 6000 },
  ];
  const frame = [
    { x: -300, y: -300 },
    { x: 17500, y: -300 },
    { x: 17500, y: 8300 },
    { x: -300, y: 8300 },
  ];
  const parts = recognizeParts(
    frame,
    [
      { id: "A", polygon: TYPE_A },
      { id: "B", polygon: typeB },
    ],
    segsOf(TYPE_A, typeB),
    30,
  );
  assert.deepEqual(parts.map((p) => p.templateId).sort(), ["A", "B"]);
});

test("계산 구역: 세대를 인식한 동 외곽은 빠지고 타입 개수는 인식된 수가 된다", () => {
  const geom = (polygon) => ({ source: "cad", polygon, sheet: "unit", dims: null, area: 68, perimeter: 36 });
  const a = createZone("unit", "84A", 0, geom(TYPE_A));
  const lone = createZone("unit", "59A", 1, geom(null));
  lone.qty = 3;
  const frame = {
    ...createZone("unit", "101동", 2, geom([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])),
    container: true,
    parts: [
      { templateId: a.id, polygon: TYPE_A },
      { templateId: a.id, polygon: TYPE_A },
      { templateId: "지워진-구역", polygon: TYPE_A },
    ],
  };
  const zones = [a, lone, frame];
  assert.equal(recognizedCounts(zones).get(a.id), 2);
  const calc = calcZones(zones);
  assert.deepEqual(calc.map((z) => z.name), ["84A", "59A"]);
  assert.equal(calc[0].qty, 2); // 인식된 수
  assert.equal(calc[1].qty, 3); // 인식되지 않은 타입은 직접 넣은 수 그대로

  // 아무것도 못 찾은 동 외곽은 한 구역으로 그대로 계산한다
  const empty = { ...frame, parts: [] };
  assert.deepEqual(calcZones([a, empty]).map((z) => z.name), ["84A", "101동"]);
});

test("열원 배치: 벽선에서 띄운 자리에만 놓는다", () => {
  const room = [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 6000 },
    { x: 0, y: 6000 },
  ];
  // 방 한가운데를 가로지르는 벽
  const wall = new Float64Array([4000, 0, 4000, 6000]);
  const ok = wallClearance(room, wall, 450);
  const pts = placeHeaters(room, 3, ok);
  assert.equal(pts.length, 3);
  for (const p of pts) assert.ok(Math.abs(p.x - 4000) >= 450, `벽에서 ${Math.abs(p.x - 4000)}mm`);
  // 열원 1대도 벽 위(방 중심)에 놓이지 않는다
  const one = placeHeaters(room, 1, ok);
  assert.ok(Math.abs(one[0].x - 4000) >= 450);
});

test("남은 자리: 외곽에서 세대를 빼면 코어 덩어리가 남고, 벽 두께만 한 띠는 버린다", async () => {
  const { leftoverRegions } = await import("../apps/web/src/features/heatReview/engine/recognize.ts");
  // 30m × 10m 외곽. 왼쪽 세대 12m, 가운데 코어 6m, 오른쪽 세대 12m — 세대는 외곽선에서 0.2m 안쪽
  const frame = [
    { x: 0, y: 0 },
    { x: 30000, y: 0 },
    { x: 30000, y: 10000 },
    { x: 0, y: 10000 },
  ];
  const box = (x1, x2) => [
    { x: x1, y: 200 },
    { x: x2, y: 200 },
    { x: x2, y: 9800 },
    { x: x1, y: 9800 },
  ];
  const rest = leftoverRegions(frame, [box(200, 12000), box(18000, 29800)], 250, 700, 10e6);
  assert.equal(rest.length, 1);
  const area = polygonArea(rest[0]) / 1e6;
  assert.ok(area > 52 && area < 68, `코어 넓이 ${area}㎡ (기대 약 60㎡)`);
  const xs = rest[0].map((p) => p.x);
  assert.ok(Math.min(...xs) >= 11500 && Math.max(...xs) <= 18500, "코어는 두 세대 사이에만 있다");
  // 세대가 외곽을 꽉 채우면 남는 게 없다
  assert.equal(leftoverRegions(frame, [box(200, 15000), box(15200, 29800)], 250, 700, 10e6).length, 0);
});
