/**
 * 동절기 열원검토 — 건물 바깥 테두리 자동으로 따기.
 *
 * 건물 안쪽 한 점을 누르면 그 건물의 외곽선을 돌려준다. 사람이 꼭짓점을 하나씩 찍어 한 층 전체를 따는 수고를 던다.
 *
 * 방법(격자로 푼다):
 *  1. 누른 점 둘레의 도면 선을 격자에 칠한다.
 *  2. 칠한 칸을 조금 불려서(창·문 자리의 틈이 메워지게) 누른 점에서 가장 가까운 선이 속한 **덩어리**만 남긴다.
 *     — 도곽·대지경계처럼 건물에서 떨어져 있는 선은 다른 덩어리라 빠진다.
 *  3. 바깥에서 물을 부어 닿지 않는 칸 = 건물(벽 + 실내). 불린 만큼 다시 깎아 원래 크기로 돌린다.
 *  4. 테두리를 한 바퀴 따고, 꼭짓점을 가까운 도면 끝점에 붙여 벽 모서리에 정확히 맞춘다.
 *
 * 건물을 가로질러 도곽까지 뻗는 선(통과하는 기준선 등)이 있으면 덩어리가 도곽과 붙어 실패한다 — 그때는 null.
 */
import type { Pt } from "../types.ts";
import { polygonArea, polygonBounds } from "./geometry.ts";

export interface OutlineOptions {
  /** 도면 단위로 1m */
  meter: number;
  /** 격자 한 칸 m (기본 0.15) */
  cell?: number;
  /** 이 폭까지의 틈(창·문)은 막힌 것으로 본다 m (기본 1.6) */
  gap?: number;
  /** 누른 점에서 이만큼 안쪽만 본다 m (기본 90) */
  reach?: number;
}

export function detectOutline(segs: Float64Array, click: Pt, opts: OutlineOptions): Pt[] | null {
  const m = opts.meter;
  const cell = (opts.cell ?? 0.15) * m;
  const r = Math.max(1, Math.round(((opts.gap ?? 1.6) * m) / 2 / cell));
  const reach = (opts.reach ?? 90) * m;
  const x0 = click.x - reach;
  const y0 = click.y - reach;
  const nx = Math.ceil((2 * reach) / cell);
  const ny = nx;
  if (nx * ny > 4_000_000) return null;

  // 1) 선 칠하기
  const wall = new Uint8Array(nx * ny);
  let painted = 0;
  for (let i = 0; i < segs.length; i += 4) {
    let ax = (segs[i] - x0) / cell;
    let ay = (segs[i + 1] - y0) / cell;
    let bx = (segs[i + 2] - x0) / cell;
    let by = (segs[i + 3] - y0) / cell;
    if ((ax < 0 && bx < 0) || (ax >= nx && bx >= nx) || (ay < 0 && by < 0) || (ay >= ny && by >= ny)) continue;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2));
    const dx = (bx - ax) / steps;
    const dy = (by - ay) / steps;
    for (let k = 0; k <= steps; k++) {
      const ix = Math.floor(ax);
      const iy = Math.floor(ay);
      if (ix >= 0 && iy >= 0 && ix < nx && iy < ny && !wall[iy * nx + ix]) {
        wall[iy * nx + ix] = 1;
        painted++;
      }
      ax += dx;
      ay += dy;
    }
  }
  if (painted === 0) return null;

  // 2) 불리기 (가로로 한 번, 세로로 한 번 — 네모난 붓)
  const fat = dilate(wall, nx, ny, r);

  // 누른 점에서 가장 가까운 불린 칸을 찾는다
  const cx = Math.floor((click.x - x0) / cell);
  const cy = Math.floor((click.y - y0) / cell);
  let seed = -1;
  const maxRing = Math.round((25 * m) / cell);
  for (let ring = 0; ring <= maxRing && seed < 0; ring++) {
    for (let d = -ring; d <= ring && seed < 0; d++) {
      for (const [ix, iy] of [
        [cx + d, cy - ring],
        [cx + d, cy + ring],
        [cx - ring, cy + d],
        [cx + ring, cy + d],
      ]) {
        if (ix >= 0 && iy >= 0 && ix < nx && iy < ny && fat[iy * nx + ix]) {
          seed = iy * nx + ix;
          break;
        }
      }
    }
  }
  if (seed < 0) return null;

  // 그 칸이 속한 덩어리
  const comp = new Uint8Array(nx * ny);
  const stack = [seed];
  comp[seed] = 1;
  let touchesEdge = false;
  while (stack.length) {
    const c = stack.pop()!;
    const ix = c % nx;
    const iy = (c / nx) | 0;
    if (ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1) touchesEdge = true;
    if (ix > 0 && fat[c - 1] && !comp[c - 1]) (comp[c - 1] = 1), stack.push(c - 1);
    if (ix < nx - 1 && fat[c + 1] && !comp[c + 1]) (comp[c + 1] = 1), stack.push(c + 1);
    if (iy > 0 && fat[c - nx] && !comp[c - nx]) (comp[c - nx] = 1), stack.push(c - nx);
    if (iy < ny - 1 && fat[c + nx] && !comp[c + nx]) (comp[c + nx] = 1), stack.push(c + nx);
  }
  // 덩어리가 보는 범위 끝까지 닿으면 건물 하나가 아니라 도면 전체에 걸친 선이다
  if (touchesEdge) return null;

  // 3) 바깥에서 물 붓기 — 덩어리에 막혀 닿지 않는 칸이 건물
  const outside = new Uint8Array(nx * ny);
  const q: number[] = [];
  const push = (c: number) => {
    if (!comp[c] && !outside[c]) {
      outside[c] = 1;
      q.push(c);
    }
  };
  for (let ix = 0; ix < nx; ix++) {
    push(ix);
    push((ny - 1) * nx + ix);
  }
  for (let iy = 0; iy < ny; iy++) {
    push(iy * nx);
    push(iy * nx + nx - 1);
  }
  while (q.length) {
    const c = q.pop()!;
    const ix = c % nx;
    const iy = (c / nx) | 0;
    if (ix > 0) push(c - 1);
    if (ix < nx - 1) push(c + 1);
    if (iy > 0) push(c - nx);
    if (iy < ny - 1) push(c + nx);
  }
  const solid = new Uint8Array(nx * ny);
  for (let i = 0; i < solid.length; i++) solid[i] = outside[i] ? 0 : 1;
  // 누른 점이 그 안에 있어야 한다(건물 밖을 누른 경우를 거른다)
  if (cx < 0 || cy < 0 || cx >= nx || cy >= ny || !solid[cy * nx + cx]) return null;

  // 불린 만큼 깎아 원래 크기로
  const shrunk = erode(solid, nx, ny, r);

  // 4) 테두리 따기 → 도면 좌표
  const loop = traceOuter(shrunk, nx, ny, cx, cy);
  if (loop.length < 4) return null;
  let poly = loop.map((p) => ({ x: x0 + p.x * cell, y: y0 + p.y * cell }));

  // 꼭짓점을 가까운 도면 끝점에 붙인다 — 격자 오차(한 칸)를 없애고 벽 모서리에 맞춘다
  const b = polygonBounds(poly);
  const pad = cell * 3;
  const ends: number[] = [];
  for (let i = 0; i < segs.length; i += 2) {
    const x = segs[i];
    const y = segs[i + 1];
    if (x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad) ends.push(x, y);
  }
  const snapR = cell * 1.6;
  poly = poly.map((p) => {
    let best = p;
    let bd = snapR * snapR;
    for (let i = 0; i < ends.length; i += 2) {
      const d = (ends[i] - p.x) ** 2 + (ends[i + 1] - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = { x: ends[i], y: ends[i + 1] };
      }
    }
    return best;
  });
  poly = tidy(poly, cell * 1.2);
  return poly.length >= 4 && polygonArea(poly) > (4 * m) ** 2 ? poly : null;
}

function dilate(src: Uint8Array, nx: number, ny: number, r: number): Uint8Array {
  const tmp = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    let last = -Infinity;
    const row = iy * nx;
    // 왼쪽에서 오른쪽, 오른쪽에서 왼쪽으로 한 번씩 훑어 r 칸 안에 칠한 칸이 있으면 칠한다
    for (let ix = 0; ix < nx; ix++) {
      if (src[row + ix]) last = ix;
      if (ix - last <= r) tmp[row + ix] = 1;
    }
    last = Infinity;
    for (let ix = nx - 1; ix >= 0; ix--) {
      if (src[row + ix]) last = ix;
      if (last - ix <= r) tmp[row + ix] = 1;
    }
  }
  const out = new Uint8Array(nx * ny);
  for (let ix = 0; ix < nx; ix++) {
    let last = -Infinity;
    for (let iy = 0; iy < ny; iy++) {
      if (tmp[iy * nx + ix]) last = iy;
      if (iy - last <= r) out[iy * nx + ix] = 1;
    }
    last = Infinity;
    for (let iy = ny - 1; iy >= 0; iy--) {
      if (tmp[iy * nx + ix]) last = iy;
      if (last - iy <= r) out[iy * nx + ix] = 1;
    }
  }
  return out;
}

function erode(src: Uint8Array, nx: number, ny: number, r: number): Uint8Array {
  const inv = new Uint8Array(nx * ny);
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1;
  const grown = dilate(inv, nx, ny, r);
  const out = new Uint8Array(nx * ny);
  for (let i = 0; i < out.length; i++) out[i] = grown[i] ? 0 : 1;
  return out;
}

/** (sx, sy) 가 든 덩어리의 바깥 테두리를 한 바퀴 — 꼭짓점은 격자 좌표 */
function traceOuter(mask: Uint8Array, nx: number, ny: number, sx: number, sy: number): Pt[] {
  // 깎다가 갈라졌을 수 있으니 누른 점이 든 덩어리만 남긴다
  const comp = new Uint8Array(nx * ny);
  let start = sy * nx + sx;
  if (!mask[start]) {
    // 누른 점이 깎여 나간 자리(벽 가까이)면 가장 가까운 칸에서 시작
    let bd = Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const d = ((i % nx) - sx) ** 2 + (((i / nx) | 0) - sy) ** 2;
      if (d < bd) {
        bd = d;
        start = i;
      }
    }
    if (!Number.isFinite(bd)) return [];
  }
  const stack = [start];
  comp[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const ix = c % nx;
    if (ix > 0 && mask[c - 1] && !comp[c - 1]) (comp[c - 1] = 1), stack.push(c - 1);
    if (ix < nx - 1 && mask[c + 1] && !comp[c + 1]) (comp[c + 1] = 1), stack.push(c + 1);
    if (c >= nx && mask[c - nx] && !comp[c - nx]) (comp[c - nx] = 1), stack.push(c - nx);
    if (c + nx < mask.length && mask[c + nx] && !comp[c + nx]) (comp[c + nx] = 1), stack.push(c + nx);
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < ny ? comp[j * nx + i] : 0);
  const W = nx + 1;
  const from = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = ay * W + ax;
    const list = from.get(k);
    if (list) list.push(by * W + bx);
    else from.set(k, [by * W + bx]);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!comp[j * nx + i]) continue;
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
      for (let guard = 0; guard < 8 * (nx + ny) * 50; guard++) {
        const list = from.get(cur);
        if (!list || list.length === 0) break;
        const cx = cur % W;
        const cy = (cur / W) | 0;
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
      const area = polygonArea(loop);
      if (area > bestArea) {
        bestArea = area;
        best = loop;
      }
    }
  }
  // 일직선 위의 점은 걷어낸다
  const slim: Pt[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i - 1 + best.length) % best.length];
    const p = best[i];
    const c = best[(i + 1) % best.length];
    if ((p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x) !== 0) slim.push(p);
  }
  return slim;
}

/**
 * 테두리 다듬기: 붙은 점 합치기 → 한 칸짜리 계단(격자 자국) 없애기 → 거의 수평·수직인 변을 똑바로 →
 * 일직선 위의 점 걷어내기.
 */
function tidy(input: Pt[], eps: number): Pt[] {
  let poly = input.slice();
  for (let pass = 0; pass < 4; pass++) {
    // 붙은 점
    const merged: Pt[] = [];
    for (const p of poly) {
      const prev = merged[merged.length - 1];
      if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > eps * 0.5) merged.push(p);
    }
    if (merged.length > 1 && Math.hypot(merged[0].x - merged[merged.length - 1].x, merged[0].y - merged[merged.length - 1].y) <= eps * 0.5)
      merged.pop();
    poly = merged;
    // 선에서 eps 안쪽으로만 벗어난 점(계단·잔떨림)
    const kept: Pt[] = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = kept.length > 0 ? kept[kept.length - 1] : poly[(i - 1 + n) % n];
      const p = poly[i];
      const c = poly[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const dist = len > 0 ? Math.abs((c.x - a.x) * (a.y - p.y) - (a.x - p.x) * (c.y - a.y)) / len : Infinity;
      if (dist > eps) kept.push(p);
    }
    if (kept.length < 4) break;
    poly = kept;
  }
  // 거의 수평·수직인 변은 똑바로 맞춘다(뒤 점을 앞 점에 맞춤)
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % n];
    if (Math.abs(a.x - c.x) <= eps * 0.6 && Math.abs(a.y - c.y) > eps) poly[(i + 1) % n] = { x: a.x, y: c.y };
    else if (Math.abs(a.y - c.y) <= eps * 0.6 && Math.abs(a.x - c.x) > eps) poly[(i + 1) % n] = { x: c.x, y: a.y };
  }
  return poly;
}
