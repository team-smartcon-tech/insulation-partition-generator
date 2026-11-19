/**
 * 슬래브 구분도 계산 — 구조평면도의 슬래브 기호(점)에서 영역(면)을 되살린다.
 *
 * 평면도에는 슬래브 판을 둘러싼 닫힌 선이 없다. 기호는 판 안에 찍힌 글자일 뿐이다.
 * 그래서 도면을 격자(기본 100mm)로 깔고,
 *   1) 구조 선(보·거더·외곽·개구부)을 벽으로 칠한 뒤
 *   2) 기호 자리에서 동시에 번져 나가게 한다(벽은 못 넘는다) — 먼저 닿은 기호의 종류가 그 칸의 종류다.
 *   3) 슬래브 기호가 없는 닫힌 칸은 PC 거더·보 기호가 있으면 PC 로 추정한다.
 *   4) 어디서도 닿지 않은 곳(동 코어·외부)은 미분류로 남긴다.
 * 선이 끊겨 새는 곳은 사람이 「칠하기」로 고친다 — 클릭한 자리와 이어진 같은 종류의 칸을 통째로 바꾼다.
 */
import type { LiteDxf } from "../../heatReview/engine/dxfLite.ts";
import { buildMatcher, isBeamMark, type MarkRule, type SlabKind } from "./marks.ts";

export type KindOrSkip = SlabKind | "skip";
/** 칠하기 종류 — none 은 「제외(미분류로 되돌림)」 */
export type PaintKind = SlabKind | "none";

export interface Mark {
  x: number;
  y: number;
  text: string;
  kind: SlabKind;
  aux: boolean;
  layer: number;
  /** 글자 방향(rad) — 기호는 그 자리의 열 방향에 맞춰 쓰여 있어, 판이 놓인 방향으로 쓴다 */
  rot: number;
}

/** 보·거더 기호 — 자리와 방향으로 그려지지 않은 보 선을 되살린다 */
export interface BeamMark {
  x: number;
  y: number;
  /** 글자 방향(rad) = 부재 방향 */
  rot: number;
  /** 글자 길이(도면 단위) */
  len: number;
}

export interface SheetInfo {
  id: number;
  /** 도면 좌표 범위 (기호 범위 + 여유) */
  box: [number, number, number, number];
  title: string;
  counts: Record<SlabKind, number>;
}

export interface LayerInfo {
  index: number;
  name: string;
  segments: number;
  /** 벽으로 쓸지에 대한 기본값 */
  barrier: boolean;
  /** 중심선(열) 도면층 — 판 경계로 쓸지에 대한 기본값 */
  grid: boolean;
  /** 슬래브 기호가 놓인 도면층 — 기호 테두리(글자 상자·타원)라 벽으로 쓰면 안 된다 */
  markLayer: boolean;
}

export interface MarkSummary {
  text: string;
  count: number;
  kind: SlabKind;
  aux: boolean;
}

export interface Seed {
  x: number;
  y: number;
  kind: PaintKind;
}

/** 사람이 그은 판 경계선 (도면 좌표) */
export interface ManualWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AnalyzeOptions {
  /** 사람이 그은 판 경계선 — 도면에 보 선이 없어 한 칸에 두 종류가 섞인 곳을 가른다 */
  walls: ManualWall[];
  /** 벽으로 쓸 도면층 번호 */
  barrierLayers: number[];
  /** 판 경계로 쓸 중심선(열) 도면층 번호 — 벽과 달리, 기호가 없는 칸은 이 선을 넘어 채운다 */
  gridLayers: number[];
  /** 보·거더 기호 자리에 판 경계를 만든다 (선이 그려지지 않은 보) */
  beamWalls: boolean;
  /** 기호별 종류 덮어쓰기 (기호 글자 → 종류/무시) */
  overrides: Record<string, KindOrSkip>;
  /** 사람이 칠한 자리 (순서대로 적용) */
  seeds: Seed[];
  /** 기호 하나가 번질 수 있는 최대 거리(m) — 선이 끊긴 곳으로 끝없이 새는 것을 막는다 */
  maxReachM: number;
  /** PC 거더·보 기호로 PC 구간 추정 */
  inferPc: boolean;
}

export interface AnalyzeResult {
  width: number;
  height: number;
  /** 격자 한 칸 크기 (도면 단위) */
  res: number;
  /** 격자 (0,0) 의 도면 좌표 — 왼쪽 위 */
  originX: number;
  originY: number;
  /** RGBA 그림 (width×height×4) */
  rgba: Uint8ClampedArray;
  /** 종류별 면적 ㎡ */
  area: Record<SlabKind, number>;
  /** PC 중 거더·보 기호로 추정한 면적 ㎡ */
  pcInferredArea: number;
  /** 외곽선을 찾았으면 그 안쪽 면적 ㎡ */
  outlineArea: number | null;
  marks: { x: number; y: number; text: string; kind: SlabKind; aux: boolean }[];
  warnings: string[];
}

const L_NONE = 0;
const L_DECK = 1;
const L_PC = 2;
const L_RC = 3;
/** 사람이 「제외」로 칠한 칸 — 번지지 않는다 */
const L_EXCLUDED = 4;
const LABEL: Record<SlabKind, number> = { deck: L_DECK, pc: L_PC, rc: L_RC };

export const KIND_COLOR: Record<SlabKind, [number, number, number]> = {
  deck: [86, 92, 226],
  pc: [246, 186, 180],
  rc: [255, 255, 255],
};
const NONE_COLOR: [number, number, number] = [222, 225, 230];
const OUTSIDE_COLOR: [number, number, number] = [245, 246, 248];

/** 도면 단위 → mm. 기호 간격이 너무 촘촘하면 m 단위 도면으로 본다 */
function unitToMm(box: [number, number, number, number]): number {
  const diag = Math.hypot(box[2] - box[0], box[3] - box[1]);
  return diag < 5000 ? 1000 : 1;
}

// ── 기호 ────────────────────────────────────────────────────────────────────

/** 글자 삽입점 → 글자 한가운데 (정렬 코드는 dxfLite 의 textPos 설명 참고) */
function textCenter(x: number, y: number, h: number, rot: number, align: number, len: number): [number, number] {
  const w = len * h * 0.85;
  const along = align === 0 || align === 4 ? w / 2 : align === 2 || align === 6 ? -w / 2 : 0;
  const up = align === 3 ? 0 : align >= 4 ? -h / 2 : h / 2;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x + along * c - up * s, y + along * s + up * c];
}

export function collectMarks(dxf: LiteDxf, rule: MarkRule): Mark[] {
  const m = buildMatcher(rule);
  const out: Mark[] = [];
  const tp = dxf.textPos;
  for (let i = 0; i < dxf.textStr.length; i++) {
    const text = dxf.textStr[i].trim();
    const p = m.parse(text);
    if (!p) continue;
    const j = i * 5;
    const [x, y] = textCenter(tp[j], tp[j + 1], tp[j + 2], tp[j + 3], tp[j + 4], text.length);
    out.push({ x, y, text, kind: p.kind, aux: p.aux, layer: dxf.textLayer?.[i] ?? 0, rot: tp[j + 3] });
  }
  return out;
}

export function collectBeamMarks(dxf: LiteDxf): BeamMark[] {
  const out: BeamMark[] = [];
  const tp = dxf.textPos;
  for (let i = 0; i < dxf.textStr.length; i++) {
    const text = dxf.textStr[i].trim();
    if (!isBeamMark(text)) continue;
    const j = i * 5;
    const [x, y] = textCenter(tp[j], tp[j + 1], tp[j + 2], tp[j + 3], tp[j + 4], text.length);
    out.push({ x, y, rot: tp[j + 3], len: text.length * tp[j + 2] * 0.85 });
  }
  return out;
}

// ── 도면(시트) 나누기 ───────────────────────────────────────────────────────

/**
 * 한 파일의 모형 공간에 여러 층 평면이 나란히 놓인다. 슬래브 기호를 20m 격자에 담고
 * 가까운 칸끼리 이어 덩어리로 묶으면 덩어리 하나가 평면 하나다.
 */
export function findSheets(dxf: LiteDxf, marks: Mark[]): { sheets: SheetInfo[]; sheetOf: Int32Array } {
  const slab = marks.map((m, i) => ({ m, i })).filter((e) => !e.m.aux);
  const sheetOf = new Int32Array(marks.length).fill(-1);
  if (slab.length === 0) return { sheets: [], sheetOf };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { m } of slab) {
    if (m.x < minX) minX = m.x;
    if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.y > maxY) maxY = m.y;
  }
  const mm = unitToMm([minX, minY, maxX, maxY]);
  const cell = 20_000 / mm;
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const cells = new Map<string, number[]>();
  for (const { m, i } of slab) {
    const k = key(Math.floor(m.x / cell), Math.floor(m.y / cell));
    const arr = cells.get(k);
    if (arr) arr.push(i);
    else cells.set(k, [i]);
  }
  const seen = new Set<string>();
  const groups: number[][] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const group: number[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      group.push(...cells.get(k)!);
      const [cx, cy] = k.split(",").map(Number);
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const nk = key(cx + dx, cy + dy);
          if (!seen.has(nk) && cells.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
    }
    if (group.length >= 5) groups.push(group);
  }

  const margin = 10_000 / mm;
  const sheets: SheetInfo[] = groups
    .map((g) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      const counts: Record<SlabKind, number> = { deck: 0, pc: 0, rc: 0 };
      for (const i of g) {
        const m = marks[i];
        counts[m.kind]++;
        if (m.x < x0) x0 = m.x;
        if (m.x > x1) x1 = m.x;
        if (m.y < y0) y0 = m.y;
        if (m.y > y1) y1 = m.y;
      }
      return { g, box: [x0 - margin, y0 - margin, x1 + margin, y1 + margin] as [number, number, number, number], counts };
    })
    // 왼쪽 → 오른쪽, 위 → 아래 순서
    .sort((a, b) => a.box[0] - b.box[0] || b.box[3] - a.box[3])
    .map((s, id) => {
      for (const i of s.g) sheetOf[i] = id;
      return { id, box: s.box, counts: s.counts, title: sheetTitle(dxf, s.box) };
    });

  // PC 거더·보 기호는 자리로 시트를 정한다
  for (let i = 0; i < marks.length; i++) {
    if (sheetOf[i] >= 0) continue;
    const m = marks[i];
    for (const s of sheets) {
      if (m.x >= s.box[0] && m.x <= s.box[2] && m.y >= s.box[1] && m.y <= s.box[3]) {
        sheetOf[i] = s.id;
        break;
      }
    }
  }
  return { sheets, sheetOf };
}

/** 평면 둘레에서 가장 큰 「…층/지붕/평면도」 글자를 도면 이름으로 쓴다 */
function sheetTitle(dxf: LiteDxf, box: [number, number, number, number]): string {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  // 도면 이름은 보통 평면 아래 표제란에 있다 — 평면 크기만큼 넉넉히 둘러본다
  const r = Math.max(w, h);
  const x0 = box[0] - r;
  const x1 = box[2] + r * 3;
  const y0 = box[1] - r * 1.5;
  const y1 = box[3] + r * 0.5;
  const cand: { s: string; h: number; d: number; right: boolean }[] = [];
  const cx = (box[0] + box[2]) / 2;
  const tp = dxf.textPos;
  for (let i = 0; i < dxf.textStr.length; i++) {
    const s = dxf.textStr[i].trim();
    if (s.length < 3 || s.length > 24 || !/(층|지붕|옥상|옥탑|PIT|기초)/i.test(s)) continue;
    if (/참고|참조|것$|[.:]/.test(s)) continue;
    const j = i * 5;
    const x = tp[j];
    const y = tp[j + 1];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    cand.push({ s, h: tp[j + 2], d: Math.hypot(x - cx, y - box[1]), right: x >= cx });
  }
  if (cand.length === 0) return "";
  // 제목 글자는 본문보다 크다 — 가장 큰 축에 드는 것 중 이 평면에 가장 가까운 것
  const maxH = Math.max(...cand.map((c) => c.h));
  const big = cand.filter((c) => c.h >= maxH * 0.8);
  // 표제란은 도곽 오른쪽 아래에 있다 — 평면 오른쪽에 있는 제목을 먼저 본다(왼쪽 것은 옆 도면의 제목이기 쉽다)
  const right = big.filter((c) => c.right);
  const best = (right.length ? right : big).sort((a, b) => a.d - b.d)[0].s;
  return best;
}

// ── 도면층 ──────────────────────────────────────────────────────────────────

/**
 * 벽으로 쓰지 않을 도면층 — 건축 바탕(외부참조·A-…)·치수·중심선·글자·표제란.
 * 이들이 벽이 되면 주차 구획선 하나하나가 칸을 막아 기호가 번지지 못한다.
 */
const NON_BARRIER =
  /\$|^(A|AA|I|L|E|M|X)-|DIM|CEN|TXT|TEXT|FORM|TITLE|NOTE|MARK|SYM|HAT|DEF|DEPOINT|\bNO\b|NO-\d|계획선|치수|범위|검토|수정|적용|배근|레벨|출력|조경/i;

export function summarizeLayers(dxf: LiteDxf, box: [number, number, number, number], marks: Mark[]): LayerInfo[] {
  const names = dxf.layerNames ?? [];
  const segLayer = dxf.segLayer;
  const count = new Uint32Array(names.length);
  if (segLayer) {
    const s = dxf.segs;
    for (let i = 0; i < segLayer.length; i++) {
      const j = i * 4;
      const mx = (s[j] + s[j + 2]) / 2;
      const my = (s[j + 1] + s[j + 3]) / 2;
      if (mx >= box[0] && mx <= box[2] && my >= box[1] && my <= box[3]) count[segLayer[i]]++;
    }
  }
  const markLayers = new Set<number>();
  for (const m of marks) if (!m.aux) markLayers.add(m.layer);
  const out: LayerInfo[] = [];
  for (let i = 0; i < names.length; i++) {
    if (count[i] === 0) continue;
    const markLayer = markLayers.has(i);
    out.push({
      index: i,
      name: names[i],
      segments: count[i],
      markLayer,
      barrier: !markLayer && !NON_BARRIER.test(names[i]),
      // 기본으로는 어떤 층도 판 경계로 쓰지 않는다. 중심선 층(A-CEN1 등)을 자동으로 켰더니 그 층에
      // 판을 비스듬히 가로지르는 선이 섞여 있어, 칸이 세모로 쪼개지고 경계가 사선으로 나왔다(구리갈매 S-1BL).
      // 열 중심선만 담긴 층이면 화면에서 직접 「판 경계」로 고른다.
      grid: false,
    });
  }
  return out.sort((a, b) => Number(b.barrier) - Number(a.barrier) || b.segments - a.segments);
}

export function summarizeMarks(marks: Mark[]): MarkSummary[] {
  const map = new Map<string, MarkSummary>();
  for (const m of marks) {
    const e = map.get(m.text);
    if (e) e.count++;
    else map.set(m.text, { text: m.text, count: 1, kind: m.kind, aux: m.aux });
  }
  return [...map.values()].sort((a, b) => Number(a.aux) - Number(b.aux) || b.count - a.count);
}

// ── 격자 계산 ───────────────────────────────────────────────────────────────

function pointInLoop(pts: Float64Array, a: number, b: number, x: number, y: number): boolean {
  let inside = false;
  for (let i = a, j = b - 1; i < b; j = i++) {
    const xi = pts[i * 2];
    const yi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const yj = pts[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function loopArea(pts: Float64Array, a: number, b: number): number {
  let s = 0;
  for (let i = a, j = b - 1; i < b; j = i++) s += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  return Math.abs(s) / 2;
}

/** 슬래브 기호의 95% 이상을 품는 가장 작은 닫힌 선 = 평면의 외곽(없으면 null) */
function findOutline(dxf: LiteDxf, slabMarks: Mark[], box: [number, number, number, number]): [number, number] | null {
  const need = Math.ceil(slabMarks.length * 0.95);
  const boxArea = (box[2] - box[0]) * (box[3] - box[1]);
  let best: [number, number] | null = null;
  let bestArea = Infinity;
  const lb = dxf.loopBox;
  for (let i = 0; i + 1 < dxf.loopOff.length; i++) {
    const k = i * 4;
    // 평면보다 훨씬 큰 선(도곽 등)과 훨씬 작은 선은 볼 필요 없다
    const bw = lb[k + 2] - lb[k];
    const bh = lb[k + 3] - lb[k + 1];
    if (bw * bh < boxArea * 0.2 || bw * bh > boxArea * 6) continue;
    const a = dxf.loopOff[i];
    const b = dxf.loopOff[i + 1];
    if (b - a < 4) continue;
    const area = loopArea(dxf.loopPts, a, b);
    if (area >= bestArea) continue;
    let hit = 0;
    let miss = 0;
    for (const m of slabMarks) {
      if (pointInLoop(dxf.loopPts, a, b, m.x, m.y)) hit++;
      else if (++miss > slabMarks.length - need) break;
    }
    if (hit >= need) {
      best = [a, b];
      bestArea = area;
    }
  }
  return best;
}

export function analyzeSheet(
  dxf: LiteDxf,
  sheet: SheetInfo,
  sheetMarks: Mark[],
  beamMarks: BeamMark[],
  opt: AnalyzeOptions,
): AnalyzeResult {
  const warnings: string[] = [];
  const mm = unitToMm(sheet.box);
  const [bx0, by0, bx1, by1] = sheet.box;

  const marks = sheetMarks
    .map((m) => {
      const o = opt.overrides[m.text];
      if (o === "skip") return null;
      return o ? { ...m, kind: o } : m;
    })
    .filter((m): m is Mark => m !== null);
  const slabMarks = marks.filter((m) => !m.aux);

  // 격자 크기: 기본 100mm, 평면이 크면 500만 칸 안쪽이 되게 키운다
  const boxArea = (bx1 - bx0) * (by1 - by0);
  let res = 100 / mm;
  if (boxArea / (res * res) > 5_000_000) res = Math.ceil(Math.sqrt(boxArea / 5_000_000) / (50 / mm)) * (50 / mm);
  const W = Math.ceil((bx1 - bx0) / res) + 2;
  const H = Math.ceil((by1 - by0) / res) + 2;
  const N = W * H;
  const gx = (x: number) => Math.floor((x - bx0) / res) + 1;
  const gy = (y: number) => Math.floor((by1 - y) / res) + 1;

  // ── 외곽 안쪽 ──
  const inside = new Uint8Array(N);
  const outline = findOutline(dxf, slabMarks, sheet.box);
  let outlineArea: number | null = null;
  if (outline) {
    fillLoop(dxf.loopPts, outline[0], outline[1], inside, W, H, bx0, by1, res);
    outlineArea = (loopArea(dxf.loopPts, outline[0], outline[1]) * mm * mm) / 1e6;
  } else {
    inside.fill(1);
    warnings.push("평면 외곽선을 찾지 못해 기호 둘레 전체를 대상으로 계산했습니다. 바깥으로 번진 곳은 「제외」로 칠해 주세요.");
  }

  // ── 선 그리기: 벽 / 바탕 ──
  // wall = 넘지 못하는 벽(보·거더·외곽 선), soft = 판 경계(중심선·기호로 되살린 보) — 1차로는 막고, 빈 칸을 채울 때는 넘는다
  const wall = new Uint8Array(N);
  const soft = new Uint8Array(N);
  const ink = new Uint8Array(N);
  const manual = new Uint8Array(N);
  // 개구부 선이 지나는 칸 — 개구부로 둘러싸인 작은 칸은 비워 두고, 그 밖의 작은 닫힌 칸(글자 상자·거더 폭)은 메운다
  const openLine = new Uint8Array(N);
  const openLayer = new Uint8Array(dxf.layerNames?.length ?? 1);
  (dxf.layerNames ?? []).forEach((name, i) => {
    if (/OPEN|개구|PIT|집수|SHAFT/i.test(name)) openLayer[i] = 1;
  });
  const isBarrier = new Uint8Array(dxf.layerNames?.length ?? 1);
  for (const i of opt.barrierLayers) if (i < isBarrier.length) isBarrier[i] = 1;
  for (const i of opt.gridLayers) if (i < isBarrier.length && !isBarrier[i]) isBarrier[i] = 2;
  const segs = dxf.segs;
  const segLayer = dxf.segLayer;
  const nSeg = segs.length / 4;
  for (let i = 0; i < nSeg; i++) {
    const j = i * 4;
    const x1 = segs[j];
    const y1 = segs[j + 1];
    const x2 = segs[j + 2];
    const y2 = segs[j + 3];
    if ((x1 < bx0 && x2 < bx0) || (x1 > bx1 && x2 > bx1) || (y1 < by0 && y2 < by0) || (y1 > by1 && y2 > by1)) continue;
    const role = segLayer ? isBarrier[segLayer[i]] : 0;
    const buf = role === 1 ? wall : role === 2 ? soft : ink;
    drawLine(buf, W, H, (x1 - bx0) / res + 1, (by1 - y1) / res + 1, (x2 - bx0) / res + 1, (by1 - y2) / res + 1, role === 1);
    if (role === 1 && segLayer && openLayer[segLayer[i]])
      drawLine(openLine, W, H, (x1 - bx0) / res + 1, (by1 - y1) / res + 1, (x2 - bx0) / res + 1, (by1 - y2) / res + 1, true);
  }

  // 사람이 그은 경계선 — 끝이 살짝 못 미쳐도 막히도록 양 끝을 300mm 씩 늘려 그린다
  for (const w of opt.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (len <= 0) continue;
    const ex = ((w.x2 - w.x1) / len) * (300 / mm);
    const ey = ((w.y2 - w.y1) / len) * (300 / mm);
    drawLine(manual, W, H, (w.x1 - ex - bx0) / res + 1, (by1 - w.y1 + ey) / res + 1, (w.x2 + ex - bx0) / res + 1, (by1 - w.y2 - ey) / res + 1, true);
  }
  for (let p = 0; p < N; p++) if (manual[p] && !wall[p]) soft[p] = manual[p] === 2 ? 3 : soft[p] || 1;

  // ── 보·거더 기호로 판 경계 되살리기 ──
  // 기호는 부재 한가운데에 부재 방향으로 놓인다. 그 자리에서 양쪽으로 뻗어 처음 만나는 선(벽·중심선)까지를 보로 본다.
  if (opt.beamWalls) {
    const virt = new Uint8Array(N);
    const maxLen = Math.round(16_000 / mm / res);
    const trail: number[] = [];
    for (const b of beamMarks) {
      const sx = (b.x - bx0) / res + 1;
      const sy = (by1 - b.y) / res + 1;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H || !inside[Math.floor(sy) * W + Math.floor(sx)]) continue;
      // 기호 옆에 나란히 그려진 제 보 선에 걸리지 않게, 글자 길이의 절반만큼은 부딪혀도 지나간다
      const free = Math.ceil(b.len / 2 / res) + 2;
      for (const dir of [1, -1]) {
        const ux = Math.cos(b.rot) * dir;
        const uy = -Math.sin(b.rot) * dir;
        trail.length = 0;
        let hit = false;
        for (let t = 0; t <= maxLen; t++) {
          const x = Math.floor(sx + ux * t);
          const y = Math.floor(sy + uy * t);
          if (x < 0 || y < 0 || x >= W || y >= H) break;
          const p = y * W + x;
          if (t > free && (wall[p] || soft[p])) {
            hit = true;
            break;
          }
          trail.push(p);
        }
        // 끝이 어디에도 닿지 않은 선은 보가 아닐 가능성이 크다 — 버린다
        if (hit) for (const p of trail) virt[p] = 1;
      }
    }
    // 끊긴 선 잇기: 보 선이 중간에서 끝난 곳은 그 방향으로 더 뻗어 처음 만나는 선까지를 판 경계로 본다.
    // (도면에서는 보 선을 일부만 그리고 마는 일이 흔하다 — 이어 주지 않으면 그 너머에서 두 종류가 한 칸에 섞인다)
    const maxExt = Math.round(10_000 / mm / res);
    const minLen = 1_000 / mm;
    for (let i = 0; i < nSeg; i++) {
      if (!segLayer || isBarrier[segLayer[i]] !== 1) continue;
      const j = i * 4;
      const ax = segs[j];
      const ay = segs[j + 1];
      const cx = segs[j + 2];
      const cy = segs[j + 3];
      const len = Math.hypot(cx - ax, cy - ay);
      if (len < minLen) continue;
      for (const end of [0, 1]) {
        const ex = end ? cx : ax;
        const ey = end ? cy : ay;
        if (ex < bx0 || ex > bx1 || ey < by0 || ey > by1) continue;
        const ux = ((end ? cx - ax : ax - cx) / len);
        const uy = -((end ? cy - ay : ay - cy) / len);
        const sx = (ex - bx0) / res + 1;
        const sy = (by1 - ey) / res + 1;
        trail.length = 0;
        let hit = false;
        for (let t = 1; t <= maxExt; t++) {
          const x = Math.floor(sx + ux * t);
          const y = Math.floor(sy + uy * t);
          if (x < 0 || y < 0 || x >= W || y >= H) break;
          const p = y * W + x;
          if (!inside[p]) break;
          // 제 선의 두께(끝점 둘레 1칸)는 건너뛴다
          if (t >= 3 && (wall[p] || soft[p])) {
            hit = true;
            break;
          }
          if (!wall[p]) trail.push(p);
        }
        if (hit) for (const p of trail) virt[p] = 1;
      }
    }
    for (let p = 0; p < N; p++) if (virt[p] && !wall[p]) soft[p] = 2;
  }

  // ── 번지기 ──
  const label = new Uint8Array(N);
  const dist = new Uint16Array(N);
  const queue = new Int32Array(N);
  const maxSteps = Math.min(65000, Math.round((opt.maxReachM * 1000) / mm / res));

  const flood = (seeds: { p: number; l: number }[], crossSoft = false) => {
    let head = 0;
    let tail = 0;
    for (const s of seeds) {
      if (label[s.p] !== L_NONE) continue;
      label[s.p] = s.l;
      dist[s.p] = 0;
      queue[tail++] = s.p;
    }
    while (head < tail) {
      const p = queue[head++];
      const d = dist[p] + 1;
      if (d > maxSteps) continue;
      const l = label[p];
      const x = p % W;
      // 좌·우·위·아래 4방향만 — 벽은 대각선으로 이어진 선이라 4방향으로는 못 넘는다
      if (x > 0) visit(p - 1, l, d);
      if (x < W - 1) visit(p + 1, l, d);
      if (p >= W) visit(p - W, l, d);
      if (p < N - W) visit(p + W, l, d);
    }
    function visit(q: number, l: number, d: number) {
      if (label[q] !== L_NONE || wall[q] || !inside[q] || (!crossSoft && soft[q])) return;
      label[q] = l;
      dist[q] = d;
      queue[tail++] = q;
    }
  };

  const toSeeds = (ms: Mark[]) => {
    const out: { p: number; l: number }[] = [];
    for (const m of ms) {
      const x = gx(m.x);
      const y = gy(m.y);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (inside[p]) out.push({ p, l: LABEL[m.kind] });
    }
    return out;
  };

  flood(toSeeds(slabMarks));

  // 슬래브 기호가 없는 칸: PC 거더·보 기호로 PC 추정
  let pcInferred = 0;
  if (opt.inferPc) {
    const before = countLabel(label, L_PC);
    flood(toSeeds(marks.filter((m) => m.aux)));
    pcInferred = countLabel(label, L_PC) - before;
  }

  // ── 칸(판) 단위로 다듬기 ──
  // 칸 = 벽·판 경계로 둘러싸인 한 덩어리. 번지기만 쓰면 경계가 계단처럼 울퉁불퉁하므로
  //  · 한 칸에 종류가 섞였으면 가장 가까운 기호(직선 거리)로 다시 나눠 경계를 곧게 하고,
  //  · 기호가 없는 칸은 아래에서 이웃 종류 중 넓게 닿은 쪽 하나로 통째로 칠한다.
  const comp = new Int32Array(N);
  let nComp = 0;
  for (let start = 0; start < N; start++) {
    if (comp[start] || wall[start] || soft[start] || !inside[start]) continue;
    nComp++;
    let head = 0;
    let tail = 0;
    comp[start] = nComp;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % W;
      if (cx > 0) join(c - 1);
      if (cx < W - 1) join(c + 1);
      if (c >= W) join(c - W);
      if (c < N - W) join(c + W);
    }
    function join(q: number) {
      if (comp[q] || wall[q] || soft[q] || !inside[q]) return;
      comp[q] = nComp;
      queue[tail++] = q;
    }
  }
  const hist = (): Uint32Array => {
    const h = new Uint32Array((nComp + 1) * 4);
    for (let p = 0; p < N; p++) {
      const l = label[p];
      if (comp[p] && l >= L_DECK && l <= L_RC) h[comp[p] * 4 + l]++;
    }
    return h;
  };
  const pre = hist();
  {
    // 종류가 섞인 칸: 그 칸 안의 기호들만 놓고 가장 가까운 기호의 종류로 다시 나눈다.
    // 거리는 그 자리의 구조 방향(가장 가까운 긴 구조 선의 방향)에 맞춘 축에서 「가로·세로 중 큰 쪽」으로 잰다.
    // 판은 구조 방향으로 놓인 사각형이라, 이렇게 재면 경계가 구조 선과 나란한 직선으로 나온다
    // (번지기 그대로 두면 45° 계단, 직선 거리로 재면 비스듬한 선이 된다).
    const longSegs: number[] = [];
    const minLong = 3_000 / mm;
    for (let i = 0; i < nSeg; i++) {
      if (!segLayer || !isBarrier[segLayer[i]]) continue;
      const k = i * 4;
      if (Math.hypot(segs[k + 2] - segs[k], segs[k + 3] - segs[k + 1]) < minLong) continue;
      if (Math.max(segs[k], segs[k + 2]) < bx0 || Math.min(segs[k], segs[k + 2]) > bx1) continue;
      if (Math.max(segs[k + 1], segs[k + 3]) < by0 || Math.min(segs[k + 1], segs[k + 3]) > by1) continue;
      longSegs.push(segs[k], segs[k + 1], segs[k + 2], segs[k + 3]);
    }
    /** 도면 좌표 한 점에서 가장 가까운 긴 구조 선의 방향 (cos, sin) */
    const axisAt = (x: number, y: number): [number, number] => {
      let best = Infinity;
      let ax = 1;
      let ay = 0;
      for (let k = 0; k < longSegs.length; k += 4) {
        const x1 = longSegs[k];
        const y1 = longSegs[k + 1];
        const dx = longSegs[k + 2] - x1;
        const dy = longSegs[k + 3] - y1;
        const l2 = dx * dx + dy * dy;
        let t = ((x - x1) * dx + (y - y1) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = (x - x1 - dx * t) ** 2 + (y - y1 - dy * t) ** 2;
        if (d < best) {
          best = d;
          const l = Math.sqrt(l2);
          ax = dx / l;
          ay = dy / l;
        }
      }
      return [ax, ay];
    };

    // 섞인 칸의 기호를 20m 격자 바구니에 담는다 — 넓은 칸(기호 수백 개)도 가까운 것만 보면 된다
    const B = Math.max(8, Math.round(20_000 / mm / res));
    const BW = Math.ceil(W / B);
    const buckets = new Map<number, number[]>();
    let mixedSeeds = 0;
    for (const m of slabMarks) {
      const x = gx(m.x);
      const y = gy(m.y);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = comp[y * W + x];
      if (!c) continue;
      const k = c * 4;
      if (Number(pre[k + 1] > 0) + Number(pre[k + 2] > 0) + Number(pre[k + 3] > 0) < 2) continue;
      const [ac, as] = axisAt(m.x, m.y);
      const key = Math.floor(y / B) * BW + Math.floor(x / B);
      const arr = buckets.get(key);
      const rec = [x, y, LABEL[m.kind], c, ac, as];
      if (arr) arr.push(...rec);
      else buckets.set(key, rec);
      mixedSeeds++;
    }
    if (mixedSeeds > 0) {
      for (let p = 0; p < N; p++) {
        const l = label[p];
        const c = comp[p];
        if (!c || l < L_DECK || l > L_RC) continue;
        const k = c * 4;
        if (Number(pre[k + 1] > 0) + Number(pre[k + 2] > 0) + Number(pre[k + 3] > 0) < 2) continue;
        const x = p % W;
        const y = (p - x) / W;
        const bxi = Math.floor(x / B);
        const byi = Math.floor(y / B);
        let best = Infinity;
        let bl = l;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const sd = buckets.get((byi + oy) * BW + bxi + ox);
            if (!sd || bxi + ox < 0 || bxi + ox >= BW) continue;
            for (let i = 0; i < sd.length; i += 6) {
              if (sd[i + 3] !== c) continue;
              const dx = x - sd[i];
              const dy = sd[i + 1] - y; // 화면 y 는 아래로 자란다 → 도면 방향으로 뒤집는다
              const u = Math.abs(dx * sd[i + 4] + dy * sd[i + 5]);
              const v = Math.abs(-dx * sd[i + 5] + dy * sd[i + 4]);
              // 큰 쪽이 같을 때를 가르려고 작은 쪽을 아주 조금 섞는다
              const d = Math.max(u, v) + Math.min(u, v) * 1e-3;
              if (d < best) {
                best = d;
                bl = sd[i + 2];
              }
            }
          }
        }
        label[p] = bl;
      }
    }
  }

  // 판 경계(중심선·되살린 보)로만 막혀 기호가 없는 칸은 이웃 칸의 종류로 채운다 — 벽은 여전히 못 넘는다
  {
    const edge: { p: number; l: number }[] = [];
    for (let p = 0; p < N; p++) {
      const l = label[p];
      if (l === L_NONE) continue;
      const x = p % W;
      if (
        (x > 0 && label[p - 1] === L_NONE) ||
        (x < W - 1 && label[p + 1] === L_NONE) ||
        (p >= W && label[p - W] === L_NONE) ||
        (p < N - W && label[p + W] === L_NONE)
      ) {
        edge.push({ p, l });
        label[p] = L_NONE; // flood 가 다시 심는다
      }
    }
    flood(edge, true);

    // 기호가 없던 칸은 한 가지 종류로 통일한다
    const post = hist();
    const pick = new Uint8Array(nComp + 1);
    for (let c = 1; c <= nComp; c++) {
      const k = c * 4;
      if (pre[k + 1] + pre[k + 2] + pre[k + 3] > 0) continue;
      let bl = 0;
      let bn = 0;
      for (let l = L_DECK; l <= L_RC; l++) {
        if (post[k + l] > bn) {
          bn = post[k + l];
          bl = l;
        }
      }
      pick[c] = bl;
    }
    for (let p = 0; p < N; p++) {
      const l = label[p];
      if (l >= L_DECK && l <= L_RC && pick[comp[p]]) label[p] = pick[comp[p]];
    }
  }

  // ── 사람이 칠한 자리: 클릭한 곳과 이어진 같은 종류의 칸을 통째로 바꾼다 ──
  for (const s of opt.seeds) {
    const x = gx(s.x);
    const y = gy(s.y);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    let p = y * W + x;
    if (wall[p] || soft[p]) {
      // 선 위를 찍었으면 바로 옆 빈 칸에서 시작한다
      const near = [p - 1, p + 1, p - W, p + W, p - W - 1, p - W + 1, p + W - 1, p + W + 1].find(
        (q) => q >= 0 && q < N && !wall[q] && !soft[q],
      );
      if (near === undefined) continue;
      p = near;
    }
    const from = label[p];
    const to = s.kind === "none" ? L_EXCLUDED : LABEL[s.kind];
    if (from === to) continue;
    let head = 0;
    let tail = 0;
    label[p] = to;
    queue[tail++] = p;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % W;
      const nb = [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W];
      for (const q of nb) {
        if (q < 0 || q >= N || wall[q] || soft[q] || label[q] !== from) continue;
        label[q] = to;
        queue[tail++] = q;
      }
    }
  }

  // ── 벽 두께·보 폭만큼 남은 틈 메우기 (약 500mm) ──
  // 작은 닫힌 칸 메우기: 기호도 없고 이웃에서 번져 오지도 못한 60㎡ 이하의 칸은 도면 주석 상자나
  // 거더·보의 폭(두 줄 사이)인 경우가 대부분이다 — 둘레 종류로 메운다. 둘레가 개구부 선이면 비워 둔다.
  // 칸은 「벽」으로만 가른다 — 판 경계(중심선)까지 치면 평면 바깥 띠가 잘게 쪼개져 전부 메워진다.
  const fillable = new Uint8Array(N);
  {
    const seen = new Uint8Array(N);
    const limit = 60 / ((res * mm * res * mm) / 1e6);
    for (let start = 0; start < N; start++) {
      if (seen[start] || label[start] !== L_NONE || wall[start] || !inside[start]) continue;
      let head = 0;
      let tail = 0;
      let touch = 0;
      let touchOpen = 0;
      seen[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const c = queue[head++];
        const cx = c % W;
        const nb = [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W];
        for (const q of nb) {
          if (q < 0 || q >= N) continue;
          if (wall[q]) {
            touch++;
            if (openLine[q]) touchOpen++;
          } else if (!seen[q] && label[q] === L_NONE && inside[q]) {
            seen[q] = 1;
            queue[tail++] = q;
          }
        }
      }
      if (tail <= limit && touchOpen < touch * 0.3) for (let i = 0; i < tail; i++) fillable[queue[i]] = 1;
    }
  }

  const grow = Math.max(3, Math.round(500 / mm / res));
  for (let it = 0; it < grow + 400; it++) {
    let n = 0;
    for (let p = 0; p < N; p++) {
      if (label[p] !== L_NONE || !inside[p]) continue;
      if (it >= grow && !fillable[p]) continue;
      const x = p % W;
      const cand =
        (x > 0 && spreads(label[p - 1])) ||
        (x < W - 1 && spreads(label[p + 1])) ||
        (p >= W && spreads(label[p - W])) ||
        (p < N - W && spreads(label[p + W])) ||
        0;
      if (cand) {
        queue[n++] = p;
        dist[p] = cand;
      }
    }
    if (n === 0) break;
    for (let i = 0; i < n; i++) label[queue[i]] = dist[queue[i]];
  }

  // ── 면적 ──
  const px = (res * mm * res * mm) / 1e6;
  const area: Record<SlabKind, number> = {
    deck: countLabel(label, L_DECK) * px,
    pc: countLabel(label, L_PC) * px,
    rc: countLabel(label, L_RC) * px,
  };
  if (slabMarks.length === 0) warnings.push("이 평면에서 슬래브 기호를 찾지 못했습니다.");

  // ── 그림 ──
  const rgba = new Uint8ClampedArray(N * 4);
  const palette: [number, number, number][] = [NONE_COLOR, KIND_COLOR.deck, KIND_COLOR.pc, KIND_COLOR.rc, NONE_COLOR];
  for (let p = 0; p < N; p++) {
    let c = inside[p] ? palette[label[p]] : OUTSIDE_COLOR;
    let r = c[0];
    let g = c[1];
    let b = c[2];
    if (wall[p] === 2) {
      r = 40;
      g = 44;
      b = 56;
    } else if (soft[p] === 3) {
      // 사람이 그은 경계선
      r = 220;
      g = 38;
      b = 38;
    } else if (soft[p] === 2) {
      // 기호로 되살린 보 — 실제 선보다 옅게
      r = r * 0.45 + 70 * 0.55;
      g = g * 0.45 + 76 * 0.55;
      b = b * 0.45 + 92 * 0.55;
    } else if (ink[p] || soft[p]) {
      // 바탕(건축) 선은 옅게
      r = r * 0.72 + 90 * 0.28;
      g = g * 0.72 + 95 * 0.28;
      b = b * 0.72 + 105 * 0.28;
    }
    c = [r, g, b];
    const o = p * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }

  return {
    width: W,
    height: H,
    res,
    originX: bx0 - res,
    originY: by1 + res,
    rgba,
    area,
    pcInferredArea: pcInferred * px,
    outlineArea,
    marks: marks.map((m) => ({ x: m.x, y: m.y, text: m.text, kind: m.kind, aux: m.aux })),
    warnings,
  };
}

const spreads = (l: number): number => (l === L_DECK || l === L_PC || l === L_RC ? l : 0);

function countLabel(label: Uint8Array, l: number): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) if (label[i] === l) n++;
  return n;
}

/**
 * 선분을 격자에 그린다. 벽이면 중심 칸(값 2)과 그 4방향 이웃(값 1)까지 칠해
 * 선 끝이 100mm 남짓 떨어진 틈을 막는다. 그림에는 중심 칸만 진하게 나온다.
 */
function drawLine(buf: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, thick: boolean) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  if (steps > 200_000) return;
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor(x0 + (dx * i) / steps);
    const y = Math.floor(y0 + (dy * i) / steps);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (!thick) {
      buf[p] = 1;
      continue;
    }
    buf[p] = 2;
    if (x > 0 && !buf[p - 1]) buf[p - 1] = 1;
    if (x < W - 1 && !buf[p + 1]) buf[p + 1] = 1;
    if (y > 0 && !buf[p - W]) buf[p - W] = 1;
    if (y < H - 1 && !buf[p + W]) buf[p + W] = 1;
  }
}

/** 닫힌 선 안쪽을 격자에 채운다 (가로줄마다 교차점을 구해 짝수-홀수로) */
function fillLoop(
  pts: Float64Array,
  a: number,
  b: number,
  out: Uint8Array,
  W: number,
  H: number,
  bx0: number,
  by1: number,
  res: number,
) {
  const xs: number[] = [];
  for (let row = 0; row < H; row++) {
    const y = by1 - (row - 1 + 0.5) * res;
    xs.length = 0;
    for (let i = a, j = b - 1; i < b; j = i++) {
      const yi = pts[i * 2 + 1];
      const yj = pts[j * 2 + 1];
      if (yi > y !== yj > y) {
        const xi = pts[i * 2];
        const xj = pts[j * 2];
        xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - bx0) / res + 0.5));
      const c1 = Math.min(W - 1, Math.floor((xs[k + 1] - bx0) / res + 0.5));
      for (let c = c0; c <= c1; c++) out[row * W + c] = 1;
    }
  }
}
