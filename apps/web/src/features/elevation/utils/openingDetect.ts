/**
 * 평면에서 클릭한 자리의 창호 범위를 도면 선으로 찾는다 — 「창호 자동」 모드용.
 *
 * 예전 방식(도면 전체에서 가장 가까운 W×H 글자)은 창 끝을 찍으면 옆 창의 라벨을 집고,
 * 클릭 지점을 창의 왼쪽 끝으로 가정해 창이 한쪽으로 밀렸다. 여기서는
 *   1. 클릭이 투영된 벽 구간과 **평행**하고 벽 두께 안(±PERP_TOL)에 있으며 클릭 위치를 **덮는** 선분을 모은다
 *      (창틀·유리선은 창 폭만큼, 벽선은 벽 전체 길이).
 *   2. 길이가 같은 선분끼리 묶고, 근처 라벨 폭과 맞는 묶음 → 선 수가 많은 묶음 → 짧은 묶음 순으로 고른다
 *      (창틀은 같은 폭의 평행선이 여러 가닥, 벽선은 한두 가닥이고 라벨과 맞지 않는다).
 *   3. 그 범위(s0~s1)의 가운데를 창 중심으로, 라벨은 범위 근처(LABEL_R)에서 폭이 맞는 것을 쓴다.
 * 좌표는 DXF 모델 좌표(mm). 순수 함수.
 */
import type { NormalizedEntity } from "./dxfEngine";
import { type Point2D, cumWallLengths, wallSegCount, extractSizeFromText } from "./geometry";

export interface DetectedOpening {
  /** 벽 따라간 거리 — 창 범위 시작/끝 */
  s0: number;
  s1: number;
  /** 도면 선으로 잰 폭 */
  span: number;
  /** 채택 폭·높이 (라벨이 맞으면 라벨값, 아니면 span·라벨 높이) */
  width: number;
  height: number;
  /** 쓴 라벨 글자. 라벨을 못 찾으면 null(높이도 없으므로 호출부가 기본값을 정한다) */
  text: string | null;
  /** 라벨 폭과 도면 폭이 60mm 안에서 같다 */
  exact: boolean;
}

/** 벽 추적선에서 창틀선까지 허용 거리 — 추적선이 벽 바깥면이어도 두께(≤500)+마감 안에 들어오게 */
const PERP_TOL = 600;
/** 평행 판정: sin 3° */
const PARALLEL_SIN = 0.052;
const MIN_LEN = 300;
const MAX_LEN = 8000;
/** 라벨 탐색 반경(창 중심 기준) */
const LABEL_R = 3000;
/** 라벨 폭과 도면 폭의 허용 차 */
const LABEL_W_TOL = 150;

type Seg = { a: Point2D; b: Point2D };

function segmentsOf(entities: NormalizedEntity[], hidden: Set<string>): Seg[] {
  const out: Seg[] = [];
  for (const e of entities) {
    if (hidden.has(e.layer)) continue;
    if (e.kind === "line") out.push({ a: e.a, b: e.b });
    else if (e.kind === "polyline") {
      const n = e.points.length;
      for (let i = 1; i < n; i++) out.push({ a: e.points[i - 1], b: e.points[i] });
      if (e.closed && n >= 3) out.push({ a: e.points[n - 1], b: e.points[0] });
    }
  }
  return out;
}

export function detectOpeningAtClick(
  entities: NormalizedEntity[],
  hidden: Set<string>,
  wallPts: Point2D[],
  closed: boolean,
  clickS: number
): DetectedOpening | null {
  if (wallPts.length < 2) return null;
  const { cum } = cumWallLengths(wallPts, closed);
  const segCount = wallSegCount(wallPts, closed);
  let i = 0;
  while (i < segCount - 1 && clickS > cum[i + 1]) i++;
  const A = wallPts[i];
  const B = wallPts[(i + 1) % wallPts.length];
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 1e-6) return null;
  const ux = (B.x - A.x) / len;
  const uy = (B.y - A.y) / len;
  const nx = -uy;
  const ny = ux;
  const along = (p: Point2D) => cum[i] + (p.x - A.x) * ux + (p.y - A.y) * uy;
  const across = (p: Point2D) => (p.x - A.x) * nx + (p.y - A.y) * ny;

  // 1. 클릭을 덮는 평행 선분
  type Cand = { t0: number; t1: number; len: number };
  const cands: Cand[] = [];
  for (const s of segmentsOf(entities, hidden)) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    if (L < MIN_LEN || L > MAX_LEN) continue;
    const cross = Math.abs((dx * uy - dy * ux) / L);
    if (cross > PARALLEL_SIN) continue;
    if (Math.abs(across(s.a)) > PERP_TOL || Math.abs(across(s.b)) > PERP_TOL) continue;
    const ta = along(s.a);
    const tb = along(s.b);
    const t0 = Math.min(ta, tb);
    const t1 = Math.max(ta, tb);
    if (clickS < t0 - 50 || clickS > t1 + 50) continue;
    cands.push({ t0, t1, len: t1 - t0 });
  }
  if (cands.length === 0) return null;

  // 근처 라벨 (벽 구간에서 PERP_TOL*3 안, 클릭에서 LABEL_R 안)
  const labels: { width: number; height: number; text: string; pos: Point2D; t: number }[] = [];
  for (const e of entities) {
    if (e.kind !== "text" || hidden.has(e.layer)) continue;
    const size = extractSizeFromText(e.text);
    if (!size) continue;
    if (Math.abs(across(e.pos)) > PERP_TOL * 3) continue;
    const t = along(e.pos);
    if (Math.abs(t - clickS) > LABEL_R + size.width) continue;
    labels.push({ ...size, text: e.text, pos: e.pos, t });
  }

  // 2. 길이별 묶음 → 라벨 일치 > 선 수 > 짧은 길이
  const groups = new Map<number, Cand[]>();
  for (const c of cands) {
    const k = Math.round(c.len / 20) * 20;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const scored = Array.from(groups.entries()).map(([k, g]) => {
    const t0 = Math.min(...g.map(c => c.t0));
    const t1 = Math.max(...g.map(c => c.t1));
    const mid = (t0 + t1) / 2;
    const labelHit = labels.some(
      l => Math.abs(l.width - k) <= LABEL_W_TOL && Math.abs(l.t - mid) <= LABEL_R
    );
    return { k, g, t0, t1, labelHit };
  });
  scored.sort((p, q) => {
    if (p.labelHit !== q.labelHit) return p.labelHit ? -1 : 1;
    if (p.g.length !== q.g.length) return q.g.length - p.g.length;
    return p.k - q.k;
  });
  const best = scored[0];
  const span = best.t1 - best.t0;
  // 라벨과 안 맞는데 4.5m 를 넘으면 창이 아니라 벽선을 집은 것 — 못 찾은 것으로 돌려 폴백시킨다
  if (!best.labelHit && span > 4500) return null;
  const mid = (best.t0 + best.t1) / 2;

  // 3. 라벨 — 폭이 맞는 것 중 가장 가까운 것, 없으면 가장 가까운 것(높이만 쓴다)
  let label: (typeof labels)[number] | null = null;
  let bestScore = Infinity;
  for (const l of labels) {
    const dw = Math.abs(l.width - span);
    const d = Math.abs(l.t - mid);
    if (d > LABEL_R) continue;
    const score = (dw <= LABEL_W_TOL ? 0 : 100000) + dw + d / 10;
    if (score < bestScore) {
      bestScore = score;
      label = l;
    }
  }
  const widthMatch = !!label && Math.abs(label.width - span) <= LABEL_W_TOL;
  return {
    s0: best.t0,
    s1: best.t1,
    span: Math.round(span),
    width: widthMatch ? label!.width : Math.round(span / 10) * 10,
    height: label ? label.height : 0,
    text: label ? label.text : null,
    exact: !!label && Math.abs(label.width - span) <= 60,
  };
}
