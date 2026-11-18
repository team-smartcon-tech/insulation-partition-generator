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

/**
 * 다각형을 바깥으로 d 만큼 띄운다(d < 0 이면 안으로). 변을 평행 이동하고 모서리는 뾰족하게 잇는다.
 * 아주 뾰족한 모서리는 끝이 멀리 튀므로 d 의 4배에서 자른다.
 */
export function offsetPolygon(poly: Pt[], d: number): Pt[] {
  const n = poly.length;
  if (n < 3 || !d) return poly;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  // 반시계면 진행 방향의 오른쪽이 바깥
  const sign = s >= 0 ? 1 : -1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const n1 = { x: ((p1.y - p0.y) / l1) * sign, y: (-(p1.x - p0.x) / l1) * sign };
    const n2 = { x: ((p2.y - p1.y) / l2) * sign, y: (-(p2.x - p1.x) / l2) * sign };
    let mx = n1.x + n2.x;
    let my = n1.y + n2.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = n1.x;
      my = n1.y;
    } else {
      // 두 변에서 모두 d 만큼 떨어지려면 이등분선을 따라 d / cos(반각) 만큼
      const k = Math.min(4, 2 / (ml * ml)) ;
      mx *= k;
      my *= k;
    }
    out.push({ x: p1.x + mx * d, y: p1.y + my * d });
  }
  return out;
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
 * 같은 모양 두 다각형(꼭짓점 순서가 같은 것) 사이의 옮김 — from 위의 점을 to 위의 같은 자리로 보낸다.
 * 회전·뒤집기·이동을 꼭짓점 전체로 맞춘다. 모양이 다르면(꼭짓점 수가 다르거나 안 맞으면) null.
 * 같은 타입 세대에 열원을 **같은 자리**에 놓는 데 쓴다.
 */
export function mapBetween(from: Pt[], to: Pt[]): ((p: Pt) => Pt) | null {
  const n = from.length;
  if (n < 3 || to.length !== n) return null;
  const cf = { x: 0, y: 0 };
  const ct = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    cf.x += from[i].x / n;
    cf.y += from[i].y / n;
    ct.x += to[i].x / n;
    ct.y += to[i].y / n;
  }
  // 최소제곱 선형변환 M = (Σ t·fᵀ)(Σ f·fᵀ)⁻¹
  let sxx = 0, sxy = 0, syy = 0, txx = 0, txy = 0, tyx = 0, tyy = 0;
  for (let i = 0; i < n; i++) {
    const fx = from[i].x - cf.x, fy = from[i].y - cf.y;
    const tx = to[i].x - ct.x, ty = to[i].y - ct.y;
    sxx += fx * fx; sxy += fx * fy; syy += fy * fy;
    txx += tx * fx; txy += tx * fy; tyx += ty * fx; tyy += ty * fy;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return null;
  const a = (txx * syy - txy * sxy) / det;
  const b = (txy * sxx - txx * sxy) / det;
  const c = (tyx * syy - tyy * sxy) / det;
  const d = (tyy * sxx - tyx * sxy) / det;
  const map = (p: Pt): Pt => ({
    x: ct.x + a * (p.x - cf.x) + b * (p.y - cf.y),
    y: ct.y + c * (p.x - cf.x) + d * (p.y - cf.y),
  });
  // 꼭짓점이 제자리에 가는지 확인 — 크기의 1% 넘게 어긋나면 같은 모양이 아니다
  const size = Math.sqrt((sxx + syy) / n) || 1;
  for (let i = 0; i < n; i++) {
    const q = map(from[i]);
    if (Math.hypot(q.x - to[i].x, q.y - to[i].y) > size * 0.01) return null;
  }
  return map;
}

/** 외벽 쪽 손실 — 열원을 손실이 큰 쪽으로 당기는 데 쓴다 */
export interface EdgeLoss {
  /** 외기에 닿는 경계(도면 좌표). 동 안의 세대면 세대 선이 아니라 **동 외곽** — 세대 사이 벽은 외기가 아니다 */
  poly: Pt[];
  /** 전체 손실 중 외벽 쪽 몫 0~1 (calc.edgeLossShare) */
  share: number;
  /** 경계에서 이 거리(도면 단위) 안을 외벽 쪽으로 본다 */
  band: number;
}

/** 외벽 쪽으로 보는 띠의 폭 m */
export const EDGE_BAND_M = 2;

/** 점에서 다각형 경계까지의 최단 거리 */
export function distToPolygon(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * 구역 안에 열원 n 대를 놓는다 (배치도용).
 * edge 를 주면 손실열량 분포로 가중한다 — 외벽 쪽 손실 몫이 클수록 열원이 외벽 쪽으로 모인다.
 *
 * 안쪽 격자점을 n 묶음으로 나누는 k-means 를 몇 번 돌린다 — 각 열원이 맡는 바닥이
 * 비슷한 넓이가 되어, 사람이 손으로 찍은 배치도와 닮은 모양이 나온다.
 * 난수를 쓰지 않아 같은 구역·같은 대수면 언제나 같은 자리가 나온다.
 */
export function placeHeaters(poly: Pt[], n: number, allowed?: (p: Pt) => boolean, edge?: EdgeLoss): Pt[] {
  if (n <= 0 || poly.length < 3) return [];
  let pts = interiorGrid(poly, Math.max(600, n * 60));
  if (pts.length === 0) return [];
  // 놓아도 되는 자리(벽에서 떨어진 곳)만 남긴다. 다 걸러지면 거르지 않은 것으로 돌아간다
  if (allowed) {
    const ok = pts.filter(allowed);
    if (ok.length >= n) pts = ok;
    else allowed = undefined;
  }
  if (n === 1) {
    const c = labelPoint(poly);
    if (!allowed || allowed(c)) return [c];
    return [nearest(pts, c)];
  }
  const count = Math.min(n, pts.length);

  // 격자점마다 "거기서 빠져나가는 열"의 몫. 바닥·천장·환기 손실은 바닥 전체에 고르게,
  // 벽체·개구부·천막 벽 손실은 외벽 가까운 띠에만 얹는다 → 손실이 큰 쪽에 열원이 더 촘촘히 간다.
  const w = new Float64Array(pts.length).fill(1 / pts.length);
  if (edge && edge.share > 0 && edge.band > 0) {
    const inBand = pts.map((p) => distToPolygon(p, edge.poly) <= edge.band);
    const nBand = inBand.filter(Boolean).length;
    // 띠에 든 점이 없으면(다른 세대에 둘러싸인 안쪽 세대) 고른 배치 그대로
    if (nBand > 0 && nBand < pts.length) {
      for (let i = 0; i < pts.length; i++) {
        w[i] = (1 - edge.share) / pts.length + (inBand[i] ? edge.share / nBand : 0);
      }
    }
  }

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
    const sn = new Float64Array(centers.length);
    // 손실 몫으로 가중한 무게중심 — 각 열원이 "자기 몫의 손실"의 한가운데로 간다
    for (let i = 0; i < pts.length; i++) {
      sx[assign[i]] += pts[i].x * w[i];
      sy[assign[i]] += pts[i].y * w[i];
      sn[assign[i]] += w[i];
    }
    for (let k = 0; k < centers.length; k++) {
      if (sn[k] > 0) centers[k] = { x: sx[k] / sn[k], y: sy[k] / sn[k] };
    }
  }
  // 오목한 구역에서는 묶음 평균이 밖으로 나갈 수 있다 → 묶음 안 가장 가까운 격자점으로
  return centers.map((c, k) => {
    if (pointInPolygon(c, poly) && (!allowed || allowed(c))) return c;
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

/** 지하주차장 외곽 배치 — 가장자리에서 들이는 거리 m */
export const EDGE_INSET_M = 1.5;
/** 지하주차장 외곽 배치 — 띠 위 열원 사이 최소 간격 m (더 촘촘해지면 남는 대수는 안쪽으로) */
export const EDGE_SPACING_M = 3;

/**
 * 구역 **외곽을 따라** 열원 n 대를 놓는다 (지하주차장 배치도용).
 *
 * 찬 공기는 외기에 닿는 가장자리(천막·개구부)에서 들어오므로, 가장자리에서 inset 만큼 들인 띠 위에
 * 같은 간격으로 놓는다. 띠에 minSpacing 간격으로 다 못 놓는 대수는 그 안쪽에 고르게 놓는다.
 * 띠를 만들 수 없는 좁은·복잡한 구역은 placeHeaters(고른 배치)로 돌아간다. 난수 없음 — 결과가 늘 같다.
 */
export function placeHeatersEdge(
  poly: Pt[],
  n: number,
  inset: number,
  minSpacing: number,
  allowed?: (p: Pt) => boolean,
): Pt[] {
  if (n <= 0 || poly.length < 3) return [];
  const area = polygonArea(poly);
  // 안으로 들인 선이 구역 안에 온전히 남는 가장 큰 들임을 고른다(오목·좁은 구역 대비)
  let ring: Pt[] | null = null;
  for (const d of [inset, inset / 2, inset / 4]) {
    const r = offsetPolygon(poly, -d);
    if (r.every((p) => pointInPolygon(p, poly)) && polygonArea(r) > area * 0.15) {
      ring = r;
      break;
    }
  }
  if (!ring || n === 1) return placeHeaters(poly, n, allowed);

  const total = polygonPerimeter(ring);
  const nEdge = Math.min(n, Math.max(2, Math.floor(total / minSpacing)));
  const grid = interiorGrid(poly, 1500);
  const okGrid = allowed ? grid.filter(allowed) : grid;
  const pool = okGrid.length > 0 ? okGrid : grid;

  const out: Pt[] = [];
  const step = total / nEdge;
  let target = step / 2;
  let walked = 0;
  for (let i = 0; i < ring.length && out.length < nEdge; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    while (out.length < nEdge && target <= walked + len + 1e-9) {
      const t = len > 0 ? (target - walked) / len : 0;
      let p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // 벽선·기둥 위거나 구역 밖이면 가장 가까운 놓을 수 있는 자리로
      if (!pointInPolygon(p, poly) || (allowed && !allowed(p))) {
        if (pool.length > 0) p = nearest(pool, p);
      }
      out.push(p);
      target += step;
    }
    walked += len;
  }
  const rest = n - out.length;
  if (rest > 0) {
    const inner = offsetPolygon(poly, -(inset + minSpacing));
    const innerOk = inner.every((p) => pointInPolygon(p, poly)) && polygonArea(inner) > area * 0.05;
    out.push(...placeHeaters(innerOk ? inner : poly, rest, allowed));
  }
  return out;
}

function nearest(pts: Pt[], c: Pt): Pt {
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

/**
 * 도면 선에서 clearance 넘게 떨어진 자리인지 알려 주는 함수를 만든다 — 열원이 벽선 위에 놓이지 않게.
 * 구역 테두리 상자에 걸친 선분만 추려 쓴다. 선이 너무 많으면(가구·해치가 빽빽한 도면) null.
 */
export function wallClearance(poly: Pt[], segs: Float64Array | null, clearance: number): ((p: Pt) => boolean) | undefined {
  if (!segs || !(clearance > 0)) return undefined;
  const b = polygonBounds(poly);
  const lx = b.minX - clearance,
    hx = b.maxX + clearance,
    ly = b.minY - clearance,
    hy = b.maxY + clearance;
  const local: number[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const x1 = segs[i],
      y1 = segs[i + 1],
      x2 = segs[i + 2],
      y2 = segs[i + 3];
    if ((x1 < lx && x2 < lx) || (x1 > hx && x2 > hx) || (y1 < ly && y2 < ly) || (y1 > hy && y2 > hy)) continue;
    local.push(x1, y1, x2, y2);
    if (local.length > 4 * 30000) return undefined;
  }
  if (local.length === 0) return undefined;
  const c2 = clearance * clearance;
  return (p: Pt) => {
    for (let i = 0; i < local.length; i += 4) {
      const x1 = local[i],
        y1 = local[i + 1],
        x2 = local[i + 2],
        y2 = local[i + 3];
      if (
        (p.x < x1 - clearance && p.x < x2 - clearance) ||
        (p.x > x1 + clearance && p.x > x2 + clearance) ||
        (p.y < y1 - clearance && p.y < y2 - clearance) ||
        (p.y > y1 + clearance && p.y > y2 + clearance)
      )
        continue;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((p.x - x1) * dx + (p.y - y1) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x1 + t * dx - p.x;
      const ey = y1 + t * dy - p.y;
      if (ex * ex + ey * ey < c2) return false;
    }
    return true;
  };
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
