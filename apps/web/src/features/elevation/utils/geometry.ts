/**
 * 입면도 생성기 — 기하/스냅/거리 유틸
 *
 * 모든 좌표는 DXF 모델좌표(Y↑, mm 단위 가정).
 */

export interface Point2D {
  x: number;
  y: number;
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 선분 ab 위에 점 p를 사영. clamp 된 t∈[0,1] 와 사영점, 거리 반환 */
export function projectOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { t: number; point: Point2D; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { t: 0, point: a, distance: dist(p, a) };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point, distance: dist(p, point) };
}

/**
 * 폴리라인을 각 변마다 dist[i] 만큼 **안쪽(외부 반대편)** 으로 평행이동한 새 폴리라인.
 * dist 양수 = 안쪽(2P가 1P 위/안쪽에 얹혀 짧아짐), 음수 = 바깥.
 * 볼록 코너는 안으로 모여 짧아지고, 열린 폴리라인의 자유단은 변 방향으로도 dist 만큼
 * 들여서(코너처럼) 짧게 만든다. → 실제 겹 오프셋 라인과 일치.
 */
export function offsetPolylineInward(
  pts: Point2D[],
  closed: boolean,
  dist: number[],
  exteriorSide: "left" | "right"
): Point2D[] {
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  if (n < 2 || segCount < 1) return pts.map(p => ({ ...p }));
  type Line = { px: number; py: number; ux: number; uy: number };
  const lines: Line[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // 안쪽 법선: 외부가 왼쪽이면 안쪽=오른쪽 법선 (uy,-ux), 외부가 오른쪽이면 (-uy,ux)
    const nx = exteriorSide === "left" ? uy : -uy;
    const ny = exteriorSide === "left" ? -ux : ux;
    const d = dist[i] ?? 0;
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, ux, uy });
  }
  const intersect = (l1: Line, l2: Line): Point2D => {
    const cross = l1.ux * l2.uy - l1.uy * l2.ux;
    if (Math.abs(cross) < 1e-9) return { x: l2.px, y: l2.py }; // 평행 → 이음점 근사
    const t = ((l2.px - l1.px) * l2.uy - (l2.py - l1.py) * l2.ux) / cross;
    return { x: l1.px + t * l1.ux, y: l1.py + t * l1.uy };
  };
  const out: Point2D[] = [];
  if (closed) {
    for (let i = 0; i < n; i++)
      out.push(intersect(lines[(i - 1 + segCount) % segCount], lines[i]));
  } else {
    const l0 = lines[0];
    const d0 = dist[0] ?? 0;
    out.push({ x: l0.px + l0.ux * d0, y: l0.py + l0.uy * d0 }); // 시작 자유단 인셋
    for (let i = 1; i < segCount; i++) out.push(intersect(lines[i - 1], lines[i]));
    const ll = lines[segCount - 1];
    const dEnd = dist[segCount - 1] ?? 0;
    const endOrig = pts[n - 1];
    const tEnd =
      (endOrig.x - ll.px) * ll.ux + (endOrig.y - ll.py) * ll.uy; // 원 끝점 사영
    out.push({ x: ll.px + (tEnd - dEnd) * ll.ux, y: ll.py + (tEnd - dEnd) * ll.uy });
  }
  return out;
}

/**
 * 열린 폴리라인의 외부 방향("left" | "right")을 선 모양으로 자동 판정한다.
 *
 * 열린 선은 트레이싱을 어느 끝에서 시작했느냐에 따라 진행방향 기준 좌/우가 바뀐다.
 * 예전엔 "left" 고정이라 반대 끝에서 그린 측벽은 2P 가 바깥으로 오프셋되고
 * 2P 가 1P 보다 길게 나왔다(남원주역세권1차 84B — 사용자가 '방향 반전'을 눌러야 했다).
 * 양 끝을 이어 닫힌 도형으로 보고, 선이 감싸는 방향(넓이 부호)으로 정한다.
 *  · 넓이 +(Y↑ 반시계) → "right" / 넓이 − → "left"
 *  · developPly 시뮬레이션으로 확인: 이 값일 때 2P 선이 세대 안쪽이고 2P 가 1P 보다 짧다.
 *
 * null 을 돌려주는 경우 — 호출부가 저장값(방향 반전 버튼)을 쓴다.
 *  · 닫힌 폴리곤: 전개 쪽이 이미 넓이로 보정한다.
 *  · 거의 일자인 선: 감싸는 넓이가 (길이²)의 1% 미만이면 모양으로 안/밖을 알 수 없다.
 */
export function autoExteriorSide(
  pts: Point2D[],
  closed: boolean
): "left" | "right" | null {
  if (closed || pts.length < 3) return null;
  let a2 = 0;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a2 += p.x * q.y - q.x * p.y;
    if (i < pts.length - 1) len += Math.hypot(q.x - p.x, q.y - p.y);
  }
  const area = a2 / 2;
  if (len <= 0 || Math.abs(area) < 0.01 * len * len) return null;
  return area > 0 ? "right" : "left";
}

/**
 * 폴리라인의 세그먼트 개수.
 * 닫힌 체인은 마지막 점 → 첫 점(닫는 변)까지 포함해 N개, 열린 체인은 N-1개다.
 * 전개(developPly)·세그먼트 스펙(resolveSegInsul)이 이미 이 기준을 쓰므로
 * 창호 배치 좌표계(s)도 같은 기준을 써야 닫는 변에 창을 놓을 수 있다.
 */
export function wallSegCount(pts: Point2D[], closed = false): number {
  const n = pts.length;
  if (n < 2) return 0;
  return closed && n >= 3 ? n : n - 1;
}

/**
 * 벽 폴리라인 누적 길이 (cum[i] = pts[0]→pts[i] 길이)
 * closed=true 면 닫는 변 길이까지 더해 cum 에 항목이 하나 더 붙는다(cum.length = N+1).
 */
export function cumWallLengths(
  pts: Point2D[],
  closed = false
): {
  cum: number[];
  total: number;
} {
  const cum = [0];
  let total = 0;
  const segCount = wallSegCount(pts, closed);
  for (let i = 0; i < segCount; i++) {
    total += dist(pts[i], pts[(i + 1) % pts.length]);
    cum.push(total);
  }
  return { cum, total };
}

/** 평면 점 → 벽 따라간 거리 s (가장 가까운 segment 기준) */
export function worldToSAlong(
  p: Point2D,
  pts: Point2D[],
  closed = false
):
  | { s: number; distance: number; point: Point2D; segIndex: number }
  | null {
  if (pts.length < 2) return null;
  const { cum } = cumWallLengths(pts, closed);
  const segCount = wallSegCount(pts, closed);
  let best = {
    s: 0,
    distance: Infinity,
    point: pts[0],
    segIndex: 0,
  };
  for (let i = 0; i < segCount; i++) {
    const r = projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (r.distance < best.distance) {
      const segLen = cum[i + 1] - cum[i];
      best = {
        s: cum[i] + r.t * segLen,
        distance: r.distance,
        point: r.point,
        segIndex: i,
      };
    }
  }
  return best;
}

/** 벽 따라간 거리 s → 평면 좌표 */
export function sAlongToWorld(
  s: number,
  pts: Point2D[],
  closed = false
): Point2D | null {
  if (pts.length < 2) return null;
  const { cum, total } = cumWallLengths(pts, closed);
  const segCount = wallSegCount(pts, closed);
  // 닫힌 체인은 s 가 한 바퀴를 넘거나 음수여도 둘레로 감아 해석한다(이음매 걸침 허용).
  let sv = s;
  if (closed && total > 0) {
    sv = s % total;
    if (sv < 0) sv += total;
  } else {
    if (sv <= 0) return pts[0];
    if (sv >= total) return pts[pts.length - 1];
  }
  for (let i = 0; i < segCount; i++) {
    if (sv <= cum[i + 1]) {
      const segLen = cum[i + 1] - cum[i];
      const t = segLen < 1e-9 ? 0 : (sv - cum[i]) / segLen;
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      return {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      };
    }
  }
  return closed ? pts[0] : pts[pts.length - 1];
}

/**
 * 텍스트에서 "폭x높이" 패턴 추출.
 *
 * 지원 형식:
 *   - 1800x850 / 1800X850 / 1800×850 / 1,800x850 (mm 직기재)
 *   - 18×11.8  / 18x15  (cm 십단위 호칭 — 한국 도면 표준)
 *   - 1800*850 / 18*15  (별표 구분자)
 *
 * 규칙: 정수 부분이 100 미만이면 cm 십단위로 간주하고 ×100 으로 mm 변환.
 *       100 이상이면 이미 mm 단위로 본다.
 */
export function extractSizeFromText(
  text: string
): { width: number; height: number } | null {
  if (!text) return null;
  const clean = text.replace(/,/g, "");
  const m = clean.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const wRaw = parseFloat(m[1]);
  const hRaw = parseFloat(m[2]);
  if (!Number.isFinite(wRaw) || !Number.isFinite(hRaw)) return null;
  const toMm = (n: number) => (n < 100 ? Math.round(n * 100) : Math.round(n));
  const w = toMm(wRaw);
  const h = toMm(hRaw);
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}
