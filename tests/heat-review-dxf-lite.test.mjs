/**
 * 동절기 열원검토 — 대용량 DXF 경량 파서 시험.
 * 블록 펼치기(회전·배율·기준점), 닫힌 선, 도면층 동결, 종이공간 제외, 글자 정렬을 본다.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseDxfLite } from "../apps/web/src/features/heatReview/engine/dxfLite.ts";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

/** (코드, 값) 쌍 나열 → DXF 바이트 */
function dxf(...pairs) {
  const lines = [];
  for (let i = 0; i < pairs.length; i += 2) lines.push(String(pairs[i]), String(pairs[i + 1]));
  return new TextEncoder().encode(lines.join("\r\n") + "\r\n");
}

const HEAD = [0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 0, "ENDSEC"];
const layers = (...defs) => [
  0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER",
  ...defs.flatMap(([name, color, flags = 0]) => [0, "LAYER", 2, name, 70, flags, 62, color]),
  0, "ENDTAB", 0, "ENDSEC",
];
const rect = (layer, w, h) => [
  0, "LWPOLYLINE", 8, layer, 90, 4, 70, 1, 10, 0, 20, 0, 10, w, 20, 0, 10, w, 20, h, 10, 0, 20, h,
];

test("블록을 회전·배율·기준점대로 펼치고 닫힌 선을 낸다", () => {
  const r = parseDxfLite(
    dxf(
      ...HEAD,
      ...layers(["A", 1]),
      0, "SECTION", 2, "BLOCKS",
      // 기준점 (1,1) 인 2×1 사각형
      0, "BLOCK", 8, "0", 2, "BOX", 70, 0, 10, 1, 20, 1,
      0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 1, 20, 1, 10, 3, 20, 1, 10, 3, 20, 2, 10, 1, 20, 2,
      0, "ENDBLK", 8, "0",
      0, "ENDSEC",
      0, "SECTION", 2, "ENTITIES",
      // (100,200) 에 90° 돌리고 10배
      0, "INSERT", 8, "A", 2, "BOX", 10, 100, 20, 200, 41, 10, 42, 10, 50, 90,
      0, "ENDSEC", 0, "EOF",
    ),
  );
  assert.equal(r.stats.segments, 4);
  assert.equal(r.stats.loops, 1);
  // 블록 좌표 (3,2) → 기준점 빼면 (2,1) → ×10 → 90° 회전 (-10,20) → 이동 (90,220)
  const pts = Array.from(r.loopPts);
  near(pts[0], 100);
  near(pts[1], 200);
  near(pts[4], 90);
  near(pts[5], 220);
  near(r.loopBox[0], 90);
  near(r.loopBox[3], 220);
  // 블록 안 도면층 "0" 은 삽입 도면층(A, 빨강)을 따른다
  assert.deepEqual(Array.from(r.colors.slice(0, 3)), [255, 0, 0]);
});

test("동결 도면층·종이공간은 버리고, 블록 배열(행·열)은 펼친다", () => {
  const r = parseDxfLite(
    dxf(
      ...HEAD,
      ...layers(["ON", 3], ["FROZEN", 2, 1]),
      0, "SECTION", 2, "BLOCKS",
      0, "BLOCK", 8, "0", 2, "L", 70, 0, 10, 0, 20, 0,
      0, "LINE", 8, "0", 10, 0, 20, 0, 11, 1, 21, 0,
      0, "ENDBLK", 8, "0",
      0, "ENDSEC",
      0, "SECTION", 2, "ENTITIES",
      ...rect("FROZEN", 5, 5),
      0, "LINE", 8, "ON", 67, 1, 10, 0, 20, 0, 11, 9, 21, 9,
      0, "INSERT", 8, "ON", 2, "L", 10, 0, 20, 0, 70, 3, 71, 2, 44, 10, 45, 5,
      0, "ENDSEC", 0, "EOF",
    ),
  );
  assert.equal(r.stats.segments, 6);
  assert.equal(r.stats.loops, 0);
  near(r.bounds.maxX, 21);
  near(r.bounds.maxY, 5);
});

test("원호·볼록값(bulge)은 꺾은선으로, 구 버전 POLYLINE/VERTEX 도 읽는다", () => {
  const r = parseDxfLite(
    dxf(
      ...HEAD,
      0, "SECTION", 2, "ENTITIES",
      0, "CIRCLE", 8, "0", 10, 0, 20, 0, 40, 10,
      // 반원 두 개로 된 원(지름 20) — bulge 1
      0, "LWPOLYLINE", 8, "0", 90, 2, 70, 1, 10, 100, 20, 0, 42, 1, 10, 120, 20, 0, 42, 1,
      0, "POLYLINE", 8, "0", 66, 1, 70, 1,
      0, "VERTEX", 8, "0", 10, 200, 20, 0,
      0, "VERTEX", 8, "0", 10, 210, 20, 0,
      0, "VERTEX", 8, "0", 10, 210, 20, 10,
      0, "SEQEND", 8, "0",
      0, "ENDSEC", 0, "EOF",
    ),
  );
  assert.equal(r.stats.loops, 2);
  // bulge 원: 닫힌 선의 면적이 π·10² 에 가깝다(10° 간격 근사)
  const n = r.loopOff[1] - r.loopOff[0];
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r.loopPts[i * 2] * r.loopPts[j * 2 + 1] - r.loopPts[j * 2] * r.loopPts[i * 2 + 1];
  }
  near(Math.abs(a) / 2, Math.PI * 100, 2);
  near(r.bounds.minX, -10, 1e-6);
  near(r.bounds.maxX, 210, 1e-6);
});

test("글자: 정렬이 걸리면 둘째 점이 기준, CP949 한글·MTEXT 서식을 푼다", () => {
  const head = dxf(...HEAD, 0, "SECTION", 2, "ENTITIES", 0, "TEXT", 8, "0", 10, 0, 20, 0, 40, 100, 1, "");
  // "지하" 를 CP949 바이트로 (구 버전 DXF)
  const cp949 = Uint8Array.from([0xc1, 0xf6, 0xc7, 0xcf]);
  const tail = dxf(
    72, 1, 11, 50, 21, 60,
    0, "MTEXT", 8, "0", 10, 5, 20, 5, 40, 30, 71, 5, 1, "{\\fArial|b0;CJ-1}\\P2,160",
    0, "ENDSEC", 0, "EOF",
  );
  // head 의 마지막 빈 값 줄("\r\n") 앞에 한글 바이트를 끼운다
  const cut = head.length - 2;
  const buf = new Uint8Array(cut + cp949.length + 2 + tail.length);
  buf.set(head.subarray(0, cut), 0);
  buf.set(cp949, cut);
  buf.set([13, 10], cut + cp949.length);
  buf.set(tail, cut + cp949.length + 2);

  const r = parseDxfLite(buf);
  assert.deepEqual(r.textStr, ["지하", "CJ-1 2,160"]);
  assert.deepEqual(Array.from(r.textPos.slice(0, 5)), [50, 60, 100, 0, 1]);
  assert.equal(r.textPos[9], 3); // MTEXT 부착점 5 = 가운데·중간
});

test("선이 없는 도면은 경고를 낸다", () => {
  const r = parseDxfLite(dxf(...HEAD, 0, "SECTION", 2, "ENTITIES", 0, "ENDSEC", 0, "EOF"));
  assert.equal(r.stats.segments, 0);
  assert.ok(r.warnings.length > 0);
});
