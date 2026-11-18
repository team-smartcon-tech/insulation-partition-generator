/**
 * 동절기 열원검토 — 동 외곽 안에서 세대 타입·코어 찾기.
 *
 * 사용자는 타입(84A, 59A…)과 코어를 **한 번씩만** 그린다. 한 층에는 같은 타입이 뒤집히거나 돌아간 채로
 * 여러 번 들어 있으므로, 그려 둔 모양을 동 외곽 안에서 찾아 세대수를 세고 열원을 세대마다 놓는다.
 *
 * 찾는 법: 타입 다각형을 8가지 자세(0·90·180·270° × 좌우 뒤집기)로 놓아 보면서, 꼭짓점들이 도면 선의
 * 끝점에 다 들어맞는 자리를 고른다. 구조 평면은 같은 타입이면 벽 끝점 배치가 똑같아서 이 방법이 통한다.
 */
import type { HeatProject, Pt, Zone, ZonePart } from "../types.ts";
import { offsetPolygon, pointInPolygon, polygonArea, polygonBounds, labelPoint } from "./geometry.ts";

export interface PartTemplate {
  id: string;
  polygon: Pt[];
}

/** 외곽 안에서 한 곳도 못 찾은 타입 — 가장 잘 맞은 자리에서 꼭짓점이 몇 개 맞았는지 */
export interface PartMiss {
  templateId: string;
  matched: number;
  total: number;
}

/** 8가지 자세 — [a, b, c, d] 는 (x, y) → (a·x + b·y, c·x + d·y) */
const POSES: [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
  [-1, 0, 0, 1],
  [0, 1, 1, 0],
  [1, 0, 0, -1],
  [0, -1, -1, 0],
];

class PointHash {
  private cell: number;
  private map = new Map<number, number[]>();
  private xs: number[] = [];
  private ys: number[] = [];
  constructor(cell: number) {
    this.cell = cell;
  }
  private key(ix: number, iy: number): number {
    // 충돌해도 괜찮다 — 찾을 때 거리를 다시 잰다
    return ((ix * 73856093) ^ (iy * 19349663)) | 0;
  }
  add(x: number, y: number) {
    const i = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.map.get(k);
    if (list) list.push(i);
    else this.map.set(k, [i]);
  }
  get size() {
    return this.xs.length;
  }
  x(i: number) {
    return this.xs[i];
  }
  y(i: number) {
    return this.ys[i];
  }
  /** (x, y) 에서 tol 안에 점이 있는가 */
  near(x: number, y: number, tol: number): boolean {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const t2 = tol * tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.map.get(this.key(ix + dx, iy + dy));
        if (!list) continue;
        for (const i of list) {
          const ex = this.xs[i] - x;
          const ey = this.ys[i] - y;
          if (ex * ex + ey * ey <= t2) return true;
        }
      }
    }
    return false;
  }
}

/**
 * 동 외곽(container) 안에서 타입·코어 모양을 찾는다.
 *
 * @param segs 도면 선분 [x1,y1,x2,y2,…]. 없으면 그려 둔 자리(뒤집히지 않은 원본)만 인정한다.
 * @param tol   끝점이 어긋나도 봐주는 거리(도면 단위)
 * @param slack 외곽선 밖으로 이만큼 나간 것까지는 "안"으로 본다(도면 단위). 외곽은 벽 바깥면을, 타입은
 *              벽 안쪽면을 따라 그리는 식으로 서로 벽 두께만큼 어긋나기 쉽다.
 */
export function recognizeParts(
  container: Pt[],
  templates: PartTemplate[],
  segs: Float64Array | null,
  tol: number,
  slack = tol * 3,
  /** 넘기면 못 찾은 타입의 사정을 여기에 담는다 */
  misses?: PartMiss[],
): ZonePart[] {
  if (container.length < 3 || templates.length === 0) return [];
  const cb = polygonBounds(container);
  // 외곽을 따라 그린 세대는 꼭짓점이 외곽선 위에 놓인다 → 살짝 부풀린 외곽 안에 들면 "안"으로 본다
  const reach = Math.max(slack, tol * 3);
  const loose = offsetPolygon(container, reach);
  // 꼭짓점 대부분이 (부풀린) 외곽 안이고 한가운데가 진짜 외곽 안이면 그 동의 세대다
  const inside = (poly: Pt[]) => {
    let out = 0;
    for (const p of poly) if (!pointInPolygon(p, loose)) out++;
    return out <= Math.floor(poly.length * 0.15) && pointInPolygon(labelPoint(poly), container);
  };

  const hash = new PointHash(tol * 2);
  let endpointCount = 0;
  if (segs) {
    const lx = cb.minX - reach,
      hx = cb.maxX + reach,
      ly = cb.minY - reach,
      hy = cb.maxY + reach;
    const within = (x: number, y: number) => x >= lx && x <= hx && y >= ly && y <= hy;
    for (let i = 0; i < segs.length; i += 2) {
      if (within(segs[i], segs[i + 1])) hash.add(segs[i], segs[i + 1]);
    }
    endpointCount = hash.size;
    // 그릴 때 선의 중점에도 달라붙으므로 중점도 맞출 점이다(자리를 잡는 기준점으로는 쓰지 않는다)
    for (let i = 0; i < segs.length; i += 4) {
      const mx = (segs[i] + segs[i + 2]) / 2;
      const my = (segs[i + 1] + segs[i + 3]) / 2;
      if (within(mx, my)) hash.add(mx, my);
    }
  }
  // 외곽·타입 꼭짓점도 맞출 점으로 넣는다(끝점이 아닌 곳을 찍어 그렸어도 원본 자리는 맞게)
  for (const p of container) hash.add(p.x, p.y);
  for (const t of templates) for (const p of t.polygon) hash.add(p.x, p.y);

  interface Cand {
    templateId: string;
    polygon: Pt[];
    center: Pt;
    score: number;
    area: number;
  }
  const cands: Cand[] = [];

  for (const t of templates) {
    const n = t.polygon.length;
    if (n < 3) continue;
    const area = polygonArea(t.polygon);
    // 그려 둔 자리 그대로 — 외곽 안에 있으면 무조건 한 세대
    if (pointInPolygon(labelPoint(t.polygon), container)) {
      cands.push({ templateId: t.id, polygon: t.polygon, center: labelPoint(t.polygon), score: 3, area });
    }
    if (endpointCount === 0) continue;
    // 꼭짓점이 적은 모양(사각형 등)은 우연히 맞는 자리가 많다 → 전부 맞아야 인정
    const allowMiss = n - Math.max(4, Math.ceil(n * 0.6));
    for (const [a, b, c, d] of POSES) {
      const q = t.polygon.map((p) => ({ x: a * p.x + b * p.y, y: c * p.x + d * p.y }));
      const qb = polygonBounds(q);
      // 기준 꼭짓점 둘로 시도한다 — 하나가 끝점이 아닌 곳(중점 등)에 찍혔을 수 있다
      for (const anchor of n >= 6 ? [0, Math.floor(n / 3), Math.floor((2 * n) / 3)] : [0, 1]) {
        const ax = q[anchor].x;
        const ay = q[anchor].y;
        for (let e = 0; e < endpointCount; e++) {
          const tx = hash.x(e) - ax;
          const ty = hash.y(e) - ay;
          if (
            qb.minX + tx < cb.minX - reach ||
            qb.maxX + tx > cb.maxX + reach ||
            qb.minY + ty < cb.minY - reach ||
            qb.maxY + ty > cb.maxY + reach
          )
            continue;
          let miss = 0;
          for (let i = 0; i < n && miss <= allowMiss; i++) {
            if (i === anchor) continue;
            if (!hash.near(q[i].x + tx, q[i].y + ty, tol)) miss++;
          }
          if (miss > allowMiss) continue;
          const polygon = q.map((p) => ({ x: p.x + tx, y: p.y + ty }));
          if (!inside(polygon)) continue;
          cands.push({ templateId: t.id, polygon, center: labelPoint(polygon), score: 2 - miss / n, area });
        }
      }
    }
  }

  // 한 곳도 못 찾은 타입: 가장 잘 맞은 자리에서 몇 개나 맞았는지 센다(안내용)
  if (misses && endpointCount > 0) {
    const found = new Set(cands.map((c) => c.templateId));
    for (const t of templates) {
      const n = t.polygon.length;
      if (n < 3 || found.has(t.id)) continue;
      let best = 0;
      for (const [a, b, c, d] of POSES) {
        const q = t.polygon.map((p) => ({ x: a * p.x + b * p.y, y: c * p.x + d * p.y }));
        const qb = polygonBounds(q);
        for (const anchor of [0, Math.floor(n / 3), Math.floor((2 * n) / 3)]) {
          for (let e = 0; e < endpointCount; e++) {
            const tx = hash.x(e) - q[anchor].x;
            const ty = hash.y(e) - q[anchor].y;
            if (
              qb.minX + tx < cb.minX - reach ||
              qb.maxX + tx > cb.maxX + reach ||
              qb.minY + ty < cb.minY - reach ||
              qb.maxY + ty > cb.maxY + reach
            )
              continue;
            let hit = 1;
            for (let i = 0; i < n; i++) {
              if (i !== anchor && hash.near(q[i].x + tx, q[i].y + ty, tol)) hit++;
              // 남은 꼭짓점이 다 맞아도 지금 최고를 못 넘으면 그만
              if (hit + (n - 1 - i) <= best) break;
            }
            if (hit > best) best = hit;
          }
        }
      }
      misses.push({ templateId: t.id, matched: best, total: n });
    }
  }

  // 잘 맞는 것부터, 같으면 큰 것부터 받아들인다. 이미 받은 것과 겹치면 버린다
  cands.sort((p, q) => q.score - p.score || q.area - p.area);
  const taken: Cand[] = [];
  for (const c of cands) {
    const clash = taken.some(
      (o) => pointInPolygon(c.center, o.polygon) || pointInPolygon(o.center, c.polygon),
    );
    if (!clash) taken.push(c);
  }
  // 저장했을 때 순서가 흔들리지 않게 — 위에서 아래, 왼쪽에서 오른쪽
  taken.sort((p, q) => q.center.y - p.center.y || p.center.x - q.center.x);
  return taken.map((c) => ({ templateId: c.templateId, polygon: c.polygon }));
}


/**
 * 동 외곽에서 이미 찾은 세대·코어를 빼고 남은 덩어리들 — 계단실·승강기·복도, 곧 코어다.
 *
 * 격자로 푼다: 외곽 안이면서 어느 세대에도 안 든 칸을 모으고, 벽 두께만 한 가느다란 띠(외곽선과 세대선
 * 사이, 세대와 세대 사이)는 깎아 낸 뒤 덩어리별로 테두리를 딴다.
 *
 * @param cell    격자 한 칸(도면 단위). 0.25m 쯤
 * @param thin    이 두께보다 가느다란 띠는 버린다(도면 단위). 0.6m 쯤
 * @param minArea 이보다 작은 덩어리는 버린다(도면 단위²)
 */
export function leftoverRegions(
  container: Pt[],
  parts: Pt[][],
  cell: number,
  thin: number,
  minArea: number,
): Pt[][] {
  if (container.length < 3 || !(cell > 0)) return [];
  const b = polygonBounds(container);
  const nx = Math.ceil((b.maxX - b.minX) / cell) + 2;
  const ny = Math.ceil((b.maxY - b.minY) / cell) + 2;
  if (nx * ny > 400000) return [];
  const x0 = b.minX - cell;
  const y0 = b.minY - cell;
  const boxes = parts.map((p) => polygonBounds(p));
  const free = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = { x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell };
      if (!pointInPolygon(p, container)) continue;
      let taken = false;
      for (let k = 0; k < parts.length && !taken; k++) {
        const bb = boxes[k];
        if (p.x < bb.minX || p.x > bb.maxX || p.y < bb.minY || p.y > bb.maxY) continue;
        taken = pointInPolygon(p, parts[k]);
      }
      if (!taken) free[j * nx + i] = 1;
    }
  }
  // 가느다란 띠 깎기: r 칸 안에 빈 칸이 아닌 게 있으면 지운다
  const r = Math.max(1, Math.round(thin / 2 / cell));
  const core = new Uint8Array(nx * ny);
  for (let j = r; j < ny - r; j++) {
    for (let i = r; i < nx - r; i++) {
      if (!free[j * nx + i]) continue;
      let ok = true;
      for (let dj = -r; dj <= r && ok; dj++) {
        for (let di = -r; di <= r; di++) {
          if (!free[(j + dj) * nx + i + di]) {
            ok = false;
            break;
          }
        }
      }
      if (ok) core[j * nx + i] = 1;
    }
  }
  // 덩어리 나누기
  const label = new Int32Array(nx * ny);
  const out: Pt[][] = [];
  let next = 0;
  for (let start = 0; start < core.length; start++) {
    if (!core[start] || label[start]) continue;
    next++;
    const stack = [start];
    label[start] = next;
    const cells: number[] = [];
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const ci = c % nx;
      for (const n of [c - 1, c + 1, c - nx, c + nx]) {
        if (n < 0 || n >= core.length || !core[n] || label[n]) continue;
        if (Math.abs((n % nx) - ci) > 1) continue;
        label[n] = next;
        stack.push(n);
      }
    }
    // 깎은 만큼 다시 불린다(원래 빈 칸이던 곳까지만)
    const mask = new Uint8Array(nx * ny);
    for (const c of cells) {
      const ci = c % nx;
      const cj = (c / nx) | 0;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const k = (cj + dj) * nx + ci + di;
          if (free[k]) mask[k] = 1;
        }
      }
    }
    const poly = traceMask(mask, nx, ny).map((p) => ({ x: x0 + p.x * cell, y: y0 + p.y * cell }));
    if (poly.length >= 4 && polygonArea(poly) >= minArea) out.push(poly);
  }
  // 위에서 아래, 왼쪽에서 오른쪽
  return out.sort((p, q) => {
    const a = labelPoint(p);
    const c = labelPoint(q);
    return c.y - a.y || a.x - c.x;
  });
}

/** 칸 마스크의 바깥 테두리를 한 바퀴 따서 꼭짓점(격자 좌표)으로 돌려준다. 구멍은 무시한다 */
function traceMask(mask: Uint8Array, nx: number, ny: number): Pt[] {
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < ny ? mask[j * nx + i] : 0);
  // 칸 테두리 중 바깥과 맞닿은 변을, 안쪽을 왼편에 두고 도는 방향으로 모은다
  const from = new Map<number, number[]>();
  const W = nx + 1;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = ay * W + ax;
    const list = from.get(k);
    if (list) list.push(by * W + bx);
    else from.set(k, [by * W + bx]);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!mask[j * nx + i]) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j);
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!at(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  let best: Pt[] = [];
  let bestArea = 0;
  for (const startKey of [...from.keys()]) {
    while ((from.get(startKey)?.length ?? 0) > 0) {
      const loop: Pt[] = [];
      let cur = startKey;
      let px = NaN;
      let py = NaN;
      for (let guard = 0; guard < 4 * nx * ny; guard++) {
        const list = from.get(cur);
        if (!list || list.length === 0) break;
        const cx = cur % W;
        const cy = (cur / W) | 0;
        // 갈림길(칸이 모서리로만 닿은 곳)에서는 가장 왼쪽으로 꺾는 변을 고른다 — 덩어리가 갈라지지 않게
        let pick = 0;
        if (list.length > 1 && !Number.isNaN(px)) {
          let bestTurn = -Infinity;
          for (let k = 0; k < list.length; k++) {
            const tx = (list[k] % W) - cx;
            const ty = ((list[k] / W) | 0) - cy;
            const turn = (cx - px) * ty - (cy - py) * tx;
            if (turn > bestTurn) {
              bestTurn = turn;
              pick = k;
            }
          }
        }
        const nxt = list.splice(pick, 1)[0];
        loop.push({ x: cx, y: cy });
        px = cx;
        py = cy;
        cur = nxt;
        if (cur === startKey) break;
      }
      // 일직선 위의 점은 걷어낸다
      const slim: Pt[] = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[(i - 1 + loop.length) % loop.length];
        const p = loop[i];
        const c = loop[(i + 1) % loop.length];
        if ((p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x) !== 0) slim.push(p);
      }
      const area = polygonArea(slim);
      if (area > bestArea) {
        bestArea = area;
        best = slim;
      }
    }
  }
  return best;
}

/** 인식된 세대·코어가 있는 동 외곽인가 — 이런 구역은 계산하지 않고 세대수를 세는 틀로만 쓴다 */
export function isCountingFrame(z: Zone): boolean {
  return !!z.container && (z.parts?.length ?? 0) > 0;
}

/** 타입·코어 구역 id → 동 외곽들이 세어 준 개수 */
export function recognizedCounts(zones: Zone[]): Map<string, number> {
  const out = new Map<string, number>();
  const alive = new Set(zones.map((z) => z.id));
  for (const z of zones) {
    // 계산에서 뺀(체크를 끈) 동 외곽은 세지 않는다
    if (!isCountingFrame(z) || z.excluded) continue;
    for (const p of z.parts!) {
      if (alive.has(p.templateId)) out.set(p.templateId, (out.get(p.templateId) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * 계산에 쓰는 구역 목록.
 *  - 세대·코어를 인식한 동 외곽은 뺀다(안에 든 타입·코어 구역이 대신 계산된다 — 둘 다 넣으면 두 번 센다).
 *  - 인식된 타입·코어 구역의 개수는 인식된 수로 바꾼다.
 *  - 아무것도 인식하지 못한 동 외곽은 한 구역으로 그대로 계산한다(타입을 안 그리고 동 전체만 그린 경우).
 */
export function calcZones(allZones: Zone[], unitOf?: (z: Zone) => "mm" | "m"): Zone[] {
  // 사용자가 체크를 끈 구역은 처음부터 없는 것으로 친다 — 열원 비교·엑셀 보고서·합계 모두에서 빠진다.
  // 동 외곽을 끄면 그 동이 세어 준 세대수도 함께 빠지고, 타입을 끄면 그 타입 세대가 빠진다.
  // 단, 계산에 넣은 동 외곽이 세어 준 타입·코어는 그 동 외곽을 따른다 — 타입 쪽 체크가 꺼져 있어도 들어간다
  // (동은 넣었는데 그 안의 세대가 빠지면 동 합계와 총계가 어긋난다).
  const countedIn = new Set<string>();
  for (const f of allZones) {
    if (f.excluded || !isCountingFrame(f)) continue;
    for (const p of f.parts!) countedIn.add(p.templateId);
  }
  const zones = allZones.filter((z) => !z.excluded || countedIn.has(z.id));
  const byId = new Map(zones.map((z) => [z.id, z]));
  // 타입·코어 id → 외곽 여유가 없는 동 외곽들이 세어 준 개수
  const plain = new Map<string, number>();
  const counted = new Set<string>();
  // 외곽 여유를 준 동 외곽 안의 세대 — 여유로 늘어난 면적을 나눠 받은 별도 구역
  const widened: Zone[] = [];
  for (const f of zones) {
    if (!isCountingFrame(f)) continue;
    const parts = f.parts!.filter((p) => byId.has(p.templateId));
    const extraOf = frameExtraAreas(f, parts, unitOf);
    const groups = new Map<string, { n: number; extra: number }>();
    parts.forEach((p, i) => {
      counted.add(p.templateId);
      const g = groups.get(p.templateId) ?? { n: 0, extra: 0 };
      g.n += 1;
      g.extra += extraOf[i];
      groups.set(p.templateId, g);
    });
    for (const [tid, g] of groups) {
      const t = byId.get(tid)!;
      const extra = g.extra / g.n; // 세대 하나가 더 받는 면적 ㎡
      if (!(extra > 0) || !(t.geometry.area > 0)) {
        plain.set(tid, (plain.get(tid) ?? 0) + g.n);
        continue;
      }
      const area = t.geometry.area + extra;
      widened.push({
        ...t,
        id: widenedId(tid, f.id),
        name: `${t.name} · ${f.name}`,
        qty: g.n,
        // 그림(배치도)은 원래 타입 구역이 맡는다 — 여기는 수치만
        geometry: {
          ...t.geometry,
          polygon: null,
          area: Math.round(area * 1000) / 1000,
          perimeter: Math.round(t.geometry.perimeter * Math.sqrt(area / t.geometry.area) * 1000) / 1000,
        },
      });
    }
  }
  const out: Zone[] = [];
  for (const z of zones) {
    if (isCountingFrame(z)) continue;
    if (!counted.has(z.id)) out.push(z);
    else if ((plain.get(z.id) ?? 0) > 0) out.push({ ...z, qty: plain.get(z.id)! });
    // 센 곳이 모두 외곽 여유를 준 동이면 원래 구역은 빠지고 아래 구역들이 대신한다
    out.push(...widened.filter((w) => w.id.startsWith(`${z.id}@`)));
  }
  return out;
}

/** 외곽 여유를 준 동 외곽 안의 타입·코어를 계산하는 구역 id */
export function widenedId(templateId: string, frameId: string): string {
  return `${templateId}@${frameId}`;
}

/**
 * 동 외곽에 준 외곽 여유로 늘어난 면적(㎡)을 안의 세대·코어에 넓이 비율로 나눈다.
 * 천막을 외벽 밖에 치면 그만큼 데울 공간이 늘고, 그 공간은 결국 안의 세대들이 나눠 맡는다.
 */
function frameExtraAreas(f: Zone, parts: ZonePart[], unitOf?: (z: Zone) => "mm" | "m"): number[] {
  const none = parts.map(() => 0);
  const poly = f.geometry.polygon;
  if (!((f.geometry.offset ?? 0) > 0) || !poly || !unitOf) return none;
  const k = unitOf(f) === "mm" ? 0.001 : 1;
  const extra = f.geometry.area - polygonArea(poly) * k * k;
  const areas = parts.map((p) => polygonArea(p.polygon));
  const sum = areas.reduce((s, a) => s + a, 0);
  if (!(extra > 0) || !(sum > 0)) return none;
  return areas.map((a) => (extra * a) / sum);
}

export function calcProject(project: HeatProject): HeatProject {
  return {
    ...project,
    zones: calcZones(project.zones, (z) => project.drawings[z.geometry.sheet ?? "parking"]?.unit ?? "mm"),
  };
}
