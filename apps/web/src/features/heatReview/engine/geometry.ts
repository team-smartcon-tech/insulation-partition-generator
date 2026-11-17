/**
 * 동절기 열원검토 — 다각형 기하.
 * 좌표는 도면 단위 그대로(Y↑)다. 면적·둘레를 m 로 바꿀 때만 단위 계수를 곱한다.
 */
import type { Pt } from "../types.ts";

export function unitFactor(unit: "mm" | "m"): number {
  return unit === "mm" ? 0.001 : 1;
}

/** 부호 없는 면적 (도면 단위²) */
export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

/** 도면 좌표 다각형 → 바닥면적(㎡)·둘레(m) */
export function measurePolygon(poly: Pt[], unit: "mm" | "m"): { area: number; perimeter: number } {
  const k = unitFactor(unit);
  return {
    area: round(polygonArea(poly) * k * k, 3),
    perimeter: round(polygonPerimeter(poly) * k, 3),
  };
}

export function round(n: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

export function polygonBounds(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 면적 가중 무게중심. 퇴화 다각형이면 꼭짓점 평균 */
export function polygonCentroid(poly: Pt[]): Pt {
  let a2 = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** 라벨을 놓을 자리 — 무게중심이 다각형 밖이면(ㄱ자 등) 안쪽 격자점 중 가장 가까운 곳 */
export function labelPoint(poly: Pt[]): Pt {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const pts = interiorGrid(poly, 400);
  if (pts.length === 0) return c;
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function interiorGrid(poly: Pt[], target: number): Pt[] {
  const b = polygonBounds(poly);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (!(w > 0) || !(h > 0)) return [];
  const step = Math.sqrt((w * h) / target);
  const out: Pt[] = [];
  for (let y = b.minY + step / 2; y < b.maxY; y += step) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      const p = { x, y };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

/**
 * 구역 안에 열원 n 대를 고르게 놓는다 (배치도용).
 *
 * 안쪽 격자점을 n 묶음으로 나누는 k-means 를 몇 번 돌린다 — 각 열원이 맡는 바닥이
 * 비슷한 넓이가 되어, 사람이 손으로 찍은 배치도와 닮은 모양이 나온다.
 * 난수를 쓰지 않아 같은 구역·같은 대수면 언제나 같은 자리가 나온다.
 */
export function placeHeaters(poly: Pt[], n: number): Pt[] {
  if (n <= 0 || poly.length < 3) return [];
  const pts = interiorGrid(poly, Math.max(600, n * 60));
  if (pts.length === 0) return [];
  if (n === 1) return [labelPoint(poly)];
  const count = Math.min(n, pts.length);

  // 초기 중심: 가장 먼 점을 차례로 고른다(farthest-point) — 결정적이고 고르게 퍼진다
  const centers: Pt[] = [pts[0]];
  const dmin = pts.map((p) => (p.x - pts[0].x) ** 2 + (p.y - pts[0].y) ** 2);
  while (centers.length < count) {
    let bi = 0;
    for (let i = 1; i < pts.length; i++) if (dmin[i] > dmin[bi]) bi = i;
    const c = pts[bi];
    centers.push(c);
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].x - c.x) ** 2 + (pts[i].y - c.y) ** 2;
      if (d < dmin[i]) dmin[i] = d;
    }
  }

  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const d = (pts[i].x - centers[k].x) ** 2 + (pts[i].y - centers[k].y) ** 2;
        if (d < bd) {
          bd = d;
          bi = k;
        }
      }
      assign[i] = bi;
    }
    const sx = new Float64Array(centers.length);
    const sy = new Float64Array(centers.length);
    const sn = new Int32Array(centers.length);
    for (let i = 0; i < pts.length; i++) {
      sx[assign[i]] += pts[i].x;
      sy[assign[i]] += pts[i].y;
      sn[assign[i]]++;
    }
    for (let k = 0; k < centers.length; k++) {
      if (sn[k] > 0) centers[k] = { x: sx[k] / sn[k], y: sy[k] / sn[k] };
    }
  }
  // 오목한 구역에서는 묶음 평균이 밖으로 나갈 수 있다 → 묶음 안 가장 가까운 격자점으로
  return centers.map((c, k) => {
    if (pointInPolygon(c, poly)) return c;
    let best = c;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (assign[i] !== k) continue;
      const d = (pts[i].x - c.x) ** 2 + (pts[i].y - c.y) ** 2;
      if (d < bd) {
        bd = d;
        best = pts[i];
      }
    }
    return best;
  });
}

/** 두 꼭짓점으로 만든 사각형 */
export function rectPolygon(a: Pt, b: Pt): Pt[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}
