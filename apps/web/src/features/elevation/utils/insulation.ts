/**
 * 입면도 생성기 — 단열재 나누기도(전개) 기하 유틸
 *
 * 문제: 외단열 2P(2겹) 시공에서, 트레이싱한 외벽선(구조면)을 그대로 펼치면
 *       겹마다 구조체에서 떨어진 거리(오프셋)가 달라 전개 둘레가 다르고,
 *       외부 모서리에서 랩(엇갈림)이 생겨 한 장에 합치면 모호해진다.
 *
 * 해결: 겹(ply)별로 "자기 면 오프셋" 기준으로 따로 전개하고,
 *       전개된 사각면(가로=전개길이, 세로=벽 높이)을 보드 규격으로 2D 타일링한다.
 *   - 1겹: 구조면 위(refOffset = 0)
 *   - 2겹: 1겹 시공했다 치고 그 위(refOffset = thickness)
 *   외부(볼록) 모서리에서 전개 길이에 오프셋을 가산(오목은 감산)하고,
 *   모서리마다 ply가 번갈아 코너를 감싸도록 랩을 배정(해치 표시).
 *
 * 좌표: 평면은 DXF 모델좌표(Y↑, mm), 전개면은 (x=전개길이→, y=높이↑) mm.
 * 입력 points 는 외벽선(구조면) 폴리라인.
 */

import { type Point2D, dist, offsetPolylineInward } from "./geometry";

// ────────────────────── 타입 ──────────────────────

/** 단열재 보드 규격(mm) */
export interface BoardSpec {
  /** 길이(가로) — 전개면 수평 방향 */
  length: number;
  /** 높이(세로) — 전개면 수직 방향 */
  height: number;
  /** 두께 — 한 겹(ply) 두께 */
  thickness: number;
}

export interface CornerInfo {
  /** points[] 상의 꼭짓점 인덱스 */
  vertexIndex: number;
  /** 외각(turn angle) 절댓값, 라디안. 직선이면 0 */
  turn: number;
  /** 외부(단열재 시공면)에서 볼 때 볼록(convex)이면 true, 오목이면 false */
  convex: boolean;
}

/** 전개면에 깔린 보드 1장(끝단은 remainder 로 잘림) */
export interface BoardCell {
  /** 행(아래→위, 0부터) */
  row: number;
  /** 전개면 좌하단 기준 좌표(mm) */
  x: number;
  y: number;
  /** 실제 크기(mm). 끝단/상단은 규격보다 작을 수 있음 */
  w: number;
  h: number;
  /** 수평 끝단(잘린 보드)이면 true */
  xRemainder: boolean;
  /** 최상단 잘린 행이면 true */
  yRemainder: boolean;
  /** 시공성 우선 모드에서 '버림(폐기)'로 표기된 자투리면 true — 시공/발주 집계 제외 */
  discarded?: boolean;
  /** 이 셀이 속한 세그먼트의 겹 두께(mm). 물량을 두께별로 분리 집계할 때 사용 */
  thickness: number;
}

export interface CornerLap {
  /** points[] 상의 꼭짓점 인덱스 */
  vertexIndex: number;
  /** 겹침(먹힘) 구간 시작 x(mm) — 옆 면 보드가 차지하는 70 구간 */
  x0: number;
  /** 겹침(먹힘) 구간 끝 x(mm) */
  x1: number;
}

export interface PlyDevelopment {
  /** 겹 번호 (1 = 구조면 위, 2 = 1겹 위 …) */
  ply: number;
  /** 이 겹이 올라타는 면의 오프셋(mm) = (ply-1)*thickness */
  refOffset: number;
  /** 전개 총길이(mm) = 전개면 가로 */
  baselineLength: number;
  /** 전개면 세로(mm) = 벽 높이 */
  wallHeight: number;
  /** 각 벽 세그먼트의 전개 길이(mm) — points.length-1 개 */
  segLengths: number[];
  /** 2D 보드 배치 (코너마다 끊김 — 보드는 코너를 못 넘음) */
  cells: BoardCell[];
  /** 수평 줄눈(행 경계) y 위치들 */
  rowJoints: number[];
  /** 모든 꺾임(코너) 전개 x 위치 — V(▽) 마크 + 세로 끊김선용 */
  cornerXs: number[];
  /** 모서리 랩(엇갈림) — 해치 대상 */
  cornerLaps: CornerLap[];
  /**
   * 이 겹의 전개좌표로 옮긴 오프닝 사각형들(입력 openings 와 같은 순서).
   * 1P = 입력 그대로, 2P = 코너 인셋만큼 왼쪽 이동된 좌표.
   * 창 윤곽을 그릴 때 이 좌표를 쓰면 2P 짧아진 시트에서도 창이 제 위치에 온다.
   */
  openingRects: { x0: number; x1: number; y0: number; y1: number }[];
}

export interface DevelopPlyParams {
  /** 외벽선(구조면) 폴리라인 */
  points: Point2D[];
  /** 닫힌 폴리곤이면 true (마지막→첫 꼭짓점도 모서리) */
  closed: boolean;
  /** 벽 높이(mm) = 전개면 세로 */
  wallHeight: number;
  /** 보드 규격 */
  board: BoardSpec;
  /** 겹 번호 (1부터) */
  ply: number;
  /**
   * 단열재가 시공되는 쪽(외부). 폴리라인 진행방향 기준 "left" | "right".
   * 첫 결과에서 모서리 볼록/오목이 반대로 나오면 이 값을 뒤집으면 됨. 기본 "left".
   */
  exteriorSide?: "left" | "right";
  /** 단별 엇갈림 방식. 기본 "running"(행마다 length/2 어긋남) */
  rowBond?: "running" | "stack";
  /** 겹 간 수평 엇갈림(mm). 겹끼리 수직줄눈이 겹치지 않게. 기본 length/2 */
  plyStagger?: number;
  /**
   * 시작점(SP) 위상(mm) — 모든 행의 타일링 시작을 이만큼 민다.
   * 끝단/절단 위치가 바뀌어 물량(판 수)이 달라진다. 기본 0.
   */
  startOffset?: number;
  /**
   * 최소 조각 폭(mm) — 이보다 좁은 절단 슬리버는 옆 보드와 합쳐 균등 분할한다
   * (둘 다 시공 가능한 크기로). 코너/오프닝 경계는 넘지 않음. 기본 0(off).
   * (placement="min-waste" 에서만 적용)
   */
  minPieceWidth?: number;
  /**
   * 배치 정책.
   *  - "min-waste"(기본): 자투리를 옆 보드와 합쳐 균등 분할 → 절단↑·폐기↓ (물량 최소).
   *  - "constructability": 온장(정척) 유지, 기준치보다 좁은 자투리는 '버림(폐기)'로 표기
   *    → 절단↓·폐기↑ (시공 단순). 이 경우 minPieceWidth 분할은 적용하지 않는다.
   */
  placement?: "min-waste" | "constructability";
  /**
   * 시공성 우선(constructability) 모드에서 이 폭(mm)보다 좁은 절단 자투리를 버림 처리한다.
   * 0 이면 버림 없음(모든 자투리 시공). 기본 0.
   */
  discardWidth?: number;
  /**
   * 시공성 우선(constructability) 모드용 최소 조각 폭(mm) — 이보다 좁은 자투리가 생기면
   * 옆 판과 합쳐 균등 재분할한다(조각 자체가 안 생김). 버림(discardWidth) 판정보다 먼저 적용.
   * 코너/오프닝 경계는 넘지 않음. 기본 0(off — 기존 동작 유지).
   */
  constructMinPieceWidth?: number;
  /**
   * 오프닝(창/문) 구간 — 단열재가 안 들어가는 영역. 전개면 좌표 {x0,x1,y0,y1}(mm).
   * 보드 셀에서 이 사각형들을 빼낸다(뽕뚫기). 보드는 오프닝 경계에 맞춰 잘림.
   */
  openings?: { x0: number; x1: number; y0: number; y1: number }[];
  /**
   * 세그먼트별 두께(mm). 길이 = points.length-1.
   * 있으면 겹별 refOffset·코너 랩·물량을 세그먼트마다 다르게 계산한다
   * (직접외기 1P90/2P50, 간접외기 1P50/2P50 등 혼합 벽 지원).
   * 없으면 board.thickness 스칼라로 폴백(기존 균일 두께 동작).
   */
  segThickness?: { ply1: number; ply2: number }[];
  /**
   * 세그먼트별 '배치 안함'(선만 이음). 길이 = points.length-1(닫힘 N).
   * true 인 변은 전개 기하(길이·코너)는 유지하되 보드를 타일링/집계하지 않는다.
   * (벽 끊긴 구간·후퇴부: 이어지게 그리되 물량 미포함)
   */
  segSkip?: boolean[];
  /**
   * 겹 쌓는 방향. false(기본): 바깥(구조선 밖으로 → 볼록코너에서 2P가 길어짐, 외단열).
   * true: 안쪽(마감선 안으로 → 볼록코너에서 2P가 짧아짐).
   */
  plyInward?: boolean;
}

// ────────────────────── 모서리 분류 ──────────────────────

/** 폴리곤 부호있는 면적 (양수 = 반시계/CCW) */
function signedArea(pts: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * 각 내부 꼭짓점의 외각과 볼록/오목 분류.
 * open 폴리라인은 양 끝점을 제외, closed 는 전 꼭짓점.
 */
export function classifyCorners(
  pts: Point2D[],
  closed: boolean,
  exteriorSide: "left" | "right" = "left"
): CornerInfo[] {
  const n = pts.length;
  if (n < 3) return [];
  const out: CornerInfo[] = [];
  const ccw = closed ? signedArea(pts) > 0 : true;

  const lo = closed ? 0 : 1;
  const hi = closed ? n : n - 1;
  for (let i = lo; i < hi; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const turn = Math.atan2(Math.abs(cross), dot); // 0(직선)~π
    if (turn < 1e-6) continue;
    let leftTurn = cross > 0;
    if (!ccw) leftTurn = !leftTurn; // 폴리곤 방향 보정
    const convex = exteriorSide === "left" ? leftTurn : !leftTurn;
    out.push({ vertexIndex: i, turn, convex });
  }
  return out;
}

// ────────────────────── 한 행 타일링 ──────────────────────

/** 길이 total 을 보드 길이 L 로, 시작 위상 shift 만큼 어긋나게 타일링 */
function tileRow(
  total: number,
  L: number,
  shift: number
): { x: number; w: number; remainder: boolean }[] {
  const cells: { x: number; w: number; remainder: boolean }[] = [];
  if (total <= 1e-6 || L <= 1e-6) return cells;
  // 0 이하의 가장 가까운 줄눈에서 시작 → 첫 칸이 부분칸이 될 수 있음
  let cur = shift - Math.ceil(shift / L) * L;
  while (cur < total - 1e-6) {
    const a = Math.max(0, cur);
    const b = Math.min(total, cur + L);
    if (b - a > 1e-6) {
      cells.push({ x: a, w: b - a, remainder: b - a < L - 1e-6 });
    }
    cur += L;
  }
  return cells;
}

/** 한 행(run) 양 끝의 슬리버를 옆 셀과 합쳐 시공 가능 크기로 조정 */
function fixRunEnds(run: BoardCell[], L: number, minW: number) {
  // 마지막이 슬리버면 직전과 합쳐 균등(또는 한 장)으로
  while (run.length >= 2 && run[run.length - 1].w < minW - 1e-6) {
    const b = run[run.length - 1];
    const a = run[run.length - 2];
    const T = a.w + b.w;
    if (T < 2 * minW) {
      a.w = T; // 둘 다 minW 못 만들면 한 장으로 합침
      run.pop();
    } else {
      const half = T / 2;
      a.w = half;
      b.x = a.x + half;
      b.w = T - half;
      break;
    }
  }
  // 처음이 슬리버면 다음과 합쳐
  while (run.length >= 2 && run[0].w < minW - 1e-6) {
    const a = run[0];
    const b = run[1];
    const T = a.w + b.w;
    if (T < 2 * minW) {
      b.x = a.x;
      b.w = T;
      run.shift();
    } else {
      const half = T / 2;
      a.w = half;
      b.x = a.x + half;
      b.w = T - half;
      break;
    }
  }
  for (const c of run) c.xRemainder = c.w < L - 1e-6;
}

/**
 * 시공 불가 슬리버 제거: y-밴드별로 인접(연속) 셀 묶음에서 minW 미만 끝조각을
 * 옆 셀과 합쳐 균등 분할. 코너/오프닝 경계(불연속)는 넘지 않는다.
 */
function mergeSlivers(
  cells: BoardCell[],
  L: number,
  minW: number,
  cornerXs: number[]
): BoardCell[] {
  if (minW <= 0) return cells;
  const corners = cornerXs.map(x => Math.round(x));
  const isCorner = (x: number) => corners.some(cx => Math.abs(cx - x) < 1);
  const bands = new Map<string, BoardCell[]>();
  for (const c of cells) {
    const k = `${Math.round(c.y)}_${Math.round(c.y + c.h)}`;
    const arr = bands.get(k) ?? [];
    arr.push(c);
    bands.set(k, arr);
  }
  const out: BoardCell[] = [];
  for (const band of bands.values()) {
    band.sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < band.length) {
      const run = [band[i]];
      let j = i + 1;
      while (j < band.length) {
        const prevRight = run[run.length - 1].x + run[run.length - 1].w;
        if (Math.abs(band[j].x - prevRight) < 1 && !isCorner(prevRight)) {
          run.push(band[j]);
          j++;
        } else break;
      }
      fixRunEnds(run, L, minW);
      out.push(...run);
      i = j;
    }
  }
  return out;
}

/**
 * 현장식(시공성 우선) 타일링.
 *
 * 현장에서 뽑는 방식과 동일:
 *  - 개구부(창/문)의 **좌·우 x 라인에서 단열재를 바닥~천장 세로 일직선으로 절단**한다
 *    (그 x 가 강제 세로 조인트가 됨).
 *  - 개구부 폭 구간(좌라인~우라인)은 개구부 **위(헤더~천장)·아래(바닥~sill)** 공간만
 *    '쪽(조각)'으로 채운다. 개구부 자리는 비움.
 *  - 그 외 열(개구부에 안 걸리는 solid)은 벽 높이 온장으로, 보드 규격(L·H)을 넘치면 분할.
 *
 * 러닝본드 스태거는 쓰지 않는다(현장 '일직선' 취지). 각 열은 좌측(cx0)·상단 기준으로
 * 채우고, 자투리는 열 오른쪽·밴드 상단에 남긴다.
 * 코너 랩(70 먹힘)은 이미 반영된 tileLo/tileHi 범위를 그대로 사용한다.
 */
function tileSiteConstructability(
  tileLo: number[],
  tileHi: number[],
  segCount: number,
  wallHeight: number,
  L: number,
  H: number,
  openings: { x0: number; x1: number; y0: number; y1: number }[],
  thicknessOf: (si: number) => number
): BoardCell[] {
  const EPS = 1e-6;
  const cells: BoardCell[] = [];

  for (let si = 0; si < segCount; si++) {
    const lo = tileLo[si];
    const hi = tileHi[si];
    if (hi - lo <= EPS) continue;

    // 이 세그먼트에 걸치는 개구부만 추려 [lo,hi]·[0,wallHeight] 로 클립
    const segOps = openings
      .map(o => ({
        x0: Math.max(lo, o.x0),
        x1: Math.min(hi, o.x1),
        y0: Math.max(0, o.y0),
        y1: Math.min(wallHeight, o.y1),
      }))
      .filter(o => o.x1 - o.x0 > EPS && o.y1 - o.y0 > EPS);

    // 세로 절단선(=열 경계): 세그먼트 양끝 + 각 개구부 좌·우 라인
    const breakSet = new Set<number>([lo, hi]);
    for (const o of segOps) {
      breakSet.add(o.x0);
      breakSet.add(o.x1);
    }
    const xs = [...breakSet].sort((a, b) => a - b);

    // 열마다 채우기
    for (let ci = 0; ci < xs.length - 1; ci++) {
      const cx0 = xs[ci];
      const cx1 = xs[ci + 1];
      if (cx1 - cx0 <= EPS) continue;

      // 이 열을 x범위로 완전히 덮는 개구부 → 막힌 y구간
      const blocks = segOps
        .filter(o => o.x0 <= cx0 + EPS && o.x1 >= cx1 - EPS)
        .map(o => ({ y0: o.y0, y1: o.y1 }))
        .sort((a, b) => a.y0 - b.y0);

      // solid y밴드 = [0,wallHeight] − (막힌 구간 합집합)
      const bands: { y0: number; y1: number }[] = [];
      let cursor = 0;
      for (const b of blocks) {
        if (b.y0 > cursor + EPS) bands.push({ y0: cursor, y1: b.y0 });
        cursor = Math.max(cursor, b.y1);
      }
      if (wallHeight > cursor + EPS) bands.push({ y0: cursor, y1: wallHeight });

      // 각 밴드를 L×H 로 채움 (열 왼쪽·밴드 상단 기준 잔여)
      for (const band of bands) {
        for (let y = band.y0; y < band.y1 - EPS; y += H) {
          const h = Math.min(H, band.y1 - y);
          for (let x = cx0; x < cx1 - EPS; x += L) {
            const w = Math.min(L, cx1 - x);
            cells.push({
              row: Math.round(y / H),
              x,
              y,
              w,
              h,
              xRemainder: w < L - EPS,
              yRemainder: h < H - EPS,
              thickness: thicknessOf(si),
            });
          }
        }
      }
    }
  }
  return cells;
}

/**
 * 밴드(개구부로 끊긴 실충전 세로구간) 하나를 켜(행)로 나눈다.
 *
 * 켜는 **항상 그 밴드 바닥에서부터** 쌓는다. 전역 격자(y=0 부터 H 씩)로 나누면
 * 창 상단이 격자선과 안 맞을 때 한 장이면 끝날 구간이 두 켜로 갈라져
 * 현장에서 "벽돌처럼" 위아래 두 번 붙이게 된다 → 금지.
 * 그래서 밴드 높이가 H 이하면 **무조건 한 켜**, 넘으면 최소 켜 수(H + 나머지 1켜)다.
 */
function bandCourses(
  y0: number,
  y1: number,
  H: number
): { y: number; h: number }[] {
  const EPS = 1e-6;
  const out: { y: number; h: number }[] = [];
  if (y1 - y0 <= EPS || H <= EPS) return out;
  for (let y = y0; y < y1 - EPS; y += H)
    out.push({ y, h: Math.min(H, y1 - y) });
  return out;
}

/**
 * 물량 최소(러닝본드) 배치 — **밴드 기준** 켜 나누기.
 *
 * 구조:
 *  ① 세그먼트를 개구부 좌·우 x 라인으로 '열(column)'로 자른다.
 *  ② 열마다 개구부에 막히지 않는 세로 밴드를 구하고, 밴드마다 켜를 나눈다(bandCourses).
 *  ③ 켜 구성(높이·경계)이 **같은 인접 열**은 하나의 런(run)으로 이어 붙여
 *     보드가 열 경계를 넘어가게 타일링한다(불필요한 세로 조인트를 안 만든다).
 *     켜 구성이 다르면(예: 창 위 구간 vs 옆 구간) 보드가 물리적으로 못 넘으므로
 *     그 경계에서 세로 일직선 조인트가 생긴다.
 *  ④ 런마다 좌측부터 타일링 — 런이 바뀔 때 줄눈 위상을 새로 시작해
 *     창 옆·창 위에서 온장 폭(L)이 최대한 나오게 한다(인접 구간 같은 판 사용).
 *
 * 러닝본드 엇갈림은 켜의 절대높이 기준 행번호(round(y/H))로 판정해
 * 개구부가 없는 일반 벽에서는 기존(전역 격자) 결과와 동일하다.
 */
function tileBandRows(
  tileLo: number[],
  tileHi: number[],
  segCount: number,
  wallHeight: number,
  L: number,
  H: number,
  openings: { x0: number; x1: number; y0: number; y1: number }[],
  thicknessOf: (si: number) => number,
  rowShiftOf: (row: number) => number
): BoardCell[] {
  const EPS = 1e-6;
  const cells: BoardCell[] = [];

  for (let si = 0; si < segCount; si++) {
    const lo = tileLo[si];
    const hi = tileHi[si];
    if (hi - lo <= EPS) continue;

    // 이 세그먼트에 걸치는 개구부만 [lo,hi]·[0,wallHeight] 로 클립
    const segOps = openings
      .map(o => ({
        x0: Math.max(lo, o.x0),
        x1: Math.min(hi, o.x1),
        y0: Math.max(0, o.y0),
        y1: Math.min(wallHeight, o.y1),
      }))
      .filter(o => o.x1 - o.x0 > EPS && o.y1 - o.y0 > EPS);

    // ① 열 경계 = 세그먼트 양끝 + 개구부 좌·우 라인
    const breakSet = new Set<number>([lo, hi]);
    for (const o of segOps) {
      if (o.x0 > lo + EPS && o.x0 < hi - EPS) breakSet.add(o.x0);
      if (o.x1 > lo + EPS && o.x1 < hi - EPS) breakSet.add(o.x1);
    }
    const xs = [...breakSet].sort((a, b) => a - b);

    // ② 열마다 밴드 → 켜 구성
    type Col = {
      x0: number;
      x1: number;
      courses: { y: number; h: number }[];
      sig: string;
    };
    const cols: Col[] = [];
    for (let ci = 0; ci < xs.length - 1; ci++) {
      const cx0 = xs[ci];
      const cx1 = xs[ci + 1];
      if (cx1 - cx0 <= EPS) continue;

      // 이 열을 x 범위로 완전히 덮는 개구부 → 막힌 y 구간
      const blocks = segOps
        .filter(o => o.x0 <= cx0 + EPS && o.x1 >= cx1 - EPS)
        .map(o => ({ y0: o.y0, y1: o.y1 }))
        .sort((a, b) => a.y0 - b.y0);

      const bands: { y0: number; y1: number }[] = [];
      let cursor = 0;
      for (const b of blocks) {
        if (b.y0 > cursor + EPS) bands.push({ y0: cursor, y1: b.y0 });
        cursor = Math.max(cursor, b.y1);
      }
      if (wallHeight > cursor + EPS) bands.push({ y0: cursor, y1: wallHeight });

      const courses = bands.flatMap(b => bandCourses(b.y0, b.y1, H));
      cols.push({
        x0: cx0,
        x1: cx1,
        courses,
        sig: courses.map(c => `${Math.round(c.y)}:${Math.round(c.h)}`).join("|"),
      });
    }

    // ③④ 켜 구성이 같은 인접 열을 런으로 묶어 타일링
    let i = 0;
    while (i < cols.length) {
      let j = i;
      while (
        j + 1 < cols.length &&
        cols[j + 1].sig === cols[i].sig &&
        Math.abs(cols[j + 1].x0 - cols[j].x1) < EPS
      )
        j++;
      const rx0 = cols[i].x0;
      const rx1 = cols[j].x1;
      for (const cs of cols[i].courses) {
        const r = Math.round(cs.y / H);
        for (const seg of tileRow(rx1 - rx0, L, rowShiftOf(r))) {
          cells.push({
            row: r,
            x: rx0 + seg.x,
            y: cs.y,
            w: seg.w,
            h: cs.h,
            xRemainder: seg.remainder,
            yRemainder: cs.h < H - EPS,
            thickness: thicknessOf(si),
          });
        }
      }
      i = j + 1;
    }
  }
  return cells;
}

// ────────────────────── 겹(ply) 전개 ──────────────────────

/**
 * 한 겹(ply)의 전개 입면 데이터 생성.
 *
 * 전개 길이 보정 2단계:
 *  ① 겹 오프셋 — 2P 이상은 아래 겹 두께만큼 오프셋한 폴리라인에서 면 길이를 직접 측정.
 *  ② 코너 처리 — 코너마다 한 면이 상대 면 두께(t)만큼 길이가 바뀐다.
 *     볼록(바깥) 코너: 감아 도는 면이 **+t** (전개축이 길어짐)
 *     오목(안쪽) 코너: 물러나는 면이 **−t** (타일링 범위가 줄어듦 = 먹힘/해치)
 *     검산 — 한 변 L·두께 t 닫힌 사각: 볼록 4코너 = 둘레 +4t / 오목 4코너 = 둘레 −4t
 */
export function developPly(params: DevelopPlyParams): PlyDevelopment {
  const {
    points: pts,
    closed,
    wallHeight,
    board,
    ply,
    exteriorSide = "left",
    rowBond = "running",
    plyStagger = board.length / 2,
    startOffset = 0,
    minPieceWidth = 0,
    placement = "min-waste",
    discardWidth = 0,
    constructMinPieceWidth = 0,
    openings = [],
  } = params;

  // 닫힌 폴리곤이면 닫는 변까지 포함(N개), 열린 폴리라인이면 N-1개.
  const segCount = closed ? pts.length : pts.length - 1;
  // 세그먼트별 두께 — segThickness 있으면 세그먼트별, 없으면 board.thickness 폴백.
  const segThk = params.segThickness;
  const refOffset = (ply - 1) * board.thickness; // 반환 대표값
  //  · lapW(코너 먹힘 폭): 그 겹 자신의 두께
  const segLapW = (i: number) =>
    segThk && segThk[i]
      ? ply === 1
        ? segThk[i].ply1
        : segThk[i].ply2
      : board.thickness;

  // 구조선(1P) 기준 원본 세그먼트 길이
  const rawSegLengths: number[] = [];
  for (let i = 0; i < segCount; i++)
    rawSegLengths.push(dist(pts[i], pts[(i + 1) % pts.length]));

  const corners = classifyCorners(pts, closed, exteriorSide);

  // ── 2P 이상: 세그먼트 길이를 '실제 안쪽 오프셋 폴리라인'에서 직접 측정 ──
  // 2P 는 1P 위에 얹혀 안쪽(외부 반대편)으로 아래겹(1P) 두께만큼 들어간다.
  // tan(turn/2) 추정 대신, 구조선을 그 두께만큼 오프셋한 폴리라인의 각 변 길이를
  // 그대로 쓴다 → 볼록 코너에선 자연히 짧아지고(오목은 길어짐), 방향(볼록/오목 부호)이
  // 오프셋 방향과 항상 일치해 뒤집히지 않는다. exteriorSide 로 안/밖 방향을 맞춘다.
  // offsetPolylineInward 는 꼭짓점 수를 유지하므로 가짜 코너가 생기지 않는다.
  let segLengths = rawSegLengths.slice();
  if (ply >= 2) {
    const dists = Array.from({ length: segCount }, (_, i) =>
      segThk && segThk[i] ? segThk[i].ply1 : board.thickness
    );
    let offPts = offsetPolylineInward(pts, closed, dists, exteriorSide);
    // 닫힘: 면적이 커졌으면(=바깥으로 나감) 방향 뒤집어 안쪽으로. (createPly2From 과 동일)
    if (closed && pts.length >= 3) {
      if (Math.abs(signedArea(offPts)) > Math.abs(signedArea(pts)))
        offPts = offsetPolylineInward(
          pts,
          closed,
          dists.map(d => -d),
          exteriorSide
        );
    }
    segLengths = rawSegLengths.map((_, i) => {
      const a = offPts[i];
      const b = offPts[(i + 1) % offPts.length];
      return a && b ? Math.max(0, dist(a, b)) : 0;
    });
  }

  // ── 코너 처리 배정 (볼록 = 감아 돌아 길어짐 / 오목 = 물러나 짧아짐) ──
  // 코너에서 두 면의 단열재가 만나는 방식은 볼록·오목이 **정반대**다.
  //  · 오목(안쪽): 코너의 (tA×tB) 정사각형을 두 면이 동시에 차지 → 겹친다.
  //    한 면이 상대 면 두께만큼 물러난다 (길이 −).
  //  · 볼록(바깥): 그 정사각형이 비어 있어 한 면이 감아 돌아 덮는다.
  //    감는 면이 상대 면 두께만큼 길어진다 (길이 +). 상대 면은 그대로.
  //
  // 검산 — 한 변 L, 두께 t, 볼록 4코너 닫힌 사각의 실제 보드 총길이:
  //   ((L+2t)² − L²) / t = 4L + 4t = 둘레 + 4t   → 코너당 +t 가 맞다.
  //   오목 4코너면 (L² − (L−2t)²) / t = 4L − 4t  → 코너당 −t.
  // 예전 코드는 볼록·오목 구분 없이 모든 꺾임에서 −t 라, 이어져야 할 240 면이 150 이 되고
  // 볼록 코너마다 두께만큼 물량이 **과소 집계**됐다.
  //
  // 길이 변화 폭은 항상 **상대(옆) 면의 이 겹 두께**다 (90T 면이 50T 면과 만나면 50).
  // 좌/우 교대는 corners 배열 인덱스가 아니라 실제 처리한 코너 순번으로 센다
  // (classifyCorners 가 일직선 꼭짓점을 버리므로 배열 인덱스로 세면 위상이 뒤집힌다).
  type CornerAct = {
    vertexIndex: number;
    convex: boolean;
    /** 길이가 바뀌는(감거나 물러나는) 세그먼트 */
    seg: number;
    /** 그 세그먼트의 시작쪽 끝이면 true */
    atStart: boolean;
    /** 변화 폭(mm) = 상대 면의 이 겹 두께 */
    w: number;
  };
  const acts: CornerAct[] = [];
  let actTurn = 0;
  for (const c of corners) {
    const j = c.vertexIndex;
    // 열린 폴리라인의 자유단(양 끝)은 코너가 아니다. 닫힘은 닫는 코너(j=0)도 정상 코너.
    if (!closed && (j < 1 || j > segCount - 1)) continue;
    const right = j % segCount; // 코너 오른쪽 면
    const left = (j - 1 + segCount) % segCount; // 코너 왼쪽 면
    const useRight = actTurn++ % 2 === 0; // 교대 배정
    // 길이 변화 폭 = 상대 면 두께 × tan(꺾임각/2) — 마이터(빗겨 자름) 기하.
    // 직각(90°)이면 tan(45°)=1 이라 두께 그대로지만, 45°·135° 사선 벽에서는 달라진다.
    // (검산: 오프셋 폴리곤 면적 = A + t·P + t²·Σtan(θ/2) → 길이 보정 = t·tan(θ/2))
    // 180°에 가까운 되꺾임은 tan 이 발산하므로 170°에서 자른다.
    const half = Math.min(c.turn, (170 * Math.PI) / 180) / 2;
    const w = segLapW(useRight ? left : right) * Math.tan(half);
    if (w <= 1e-6) continue; // 이 겹 두께 0(예: 간접외기 2P=0) → 코너 처리 없음
    acts.push({
      vertexIndex: j,
      convex: c.convex,
      seg: useRight ? right : left,
      atStart: useRight,
      w,
    });
  }

  // 볼록 코너의 '감아 도는' 길이는 전개축 자체를 늘린다 → segLengths 에 먼저 반영.
  // (오목의 '먹힘'은 길이가 아니라 타일링 범위를 줄이는 것이라 아래에서 따로 처리)
  const wrapStart = new Array<number>(segCount).fill(0);
  const wrapEnd = new Array<number>(segCount).fill(0);
  for (const a of acts) {
    if (!a.convex) continue;
    if (a.atStart) wrapStart[a.seg] += a.w;
    else wrapEnd[a.seg] += a.w;
  }
  const hasWrap = wrapStart.some(v => v > 0) || wrapEnd.some(v => v > 0);
  /** 코너 감김분을 뺀 순수 면 길이 — 오프닝 위치 매핑의 기준 */
  const baseSegLengths = segLengths.map(v => Math.max(0, v));
  segLengths = baseSegLengths.map((v, i) => v + wrapStart[i] + wrapEnd[i]);

  const baselineLength = segLengths.reduce((s, v) => s + Math.max(0, v), 0);

  // 세그먼트(벽 면) 경계의 전개 누적 위치 (2P 오프셋 길이 + 볼록 코너 감김 반영)
  const cumAtVertex: number[] = [0];
  for (let i = 0; i < segCount; i++) {
    cumAtVertex.push(cumAtVertex[i] + Math.max(0, segLengths[i]));
  }

  // ── 오프닝(창)을 이 겹의 전개좌표로 재매핑 ──
  // openings 는 1P(구조선) 전개좌표. 면 길이가 달라지면(2P 오프셋 / 볼록 코너 감김)
  // 각 오프닝을 자기 면 안에서 같은 비율 위치로 옮긴다 → 코너에 안 걸린다.
  // 코너 감김분(wrapStart)은 면 '앞'에 덧붙은 구간이라 비율 배분 대상이 아니고 통째로 민다.
  let ops = openings;
  if ((ply >= 2 || hasWrap) && openings.length > 0) {
    const structCum: number[] = [0];
    for (let i = 0; i < segCount; i++)
      structCum.push(structCum[i] + Math.max(0, rawSegLengths[i]));
    const mapX = (x: number): number => {
      for (let i = 0; i < segCount; i++) {
        if (x <= structCum[i + 1] + 1e-6) {
          const sf = Math.max(1e-6, rawSegLengths[i]);
          const frac = Math.min(1, Math.max(0, (x - structCum[i]) / sf));
          return cumAtVertex[i] + wrapStart[i] + frac * baseSegLengths[i];
        }
      }
      return cumAtVertex[segCount];
    };
    ops = openings.map(o => ({
      x0: mapX(o.x0),
      x1: mapX(o.x1),
      y0: o.y0,
      y1: o.y1,
    }));
  }

  // ── 오목 코너 겹침(먹힘) 반영 ──
  // 물러나는 면의 보드 나누기를 상대 두께만큼 뒤에서 시작/앞에서 종료시킨다.
  const tileLo = cumAtVertex.slice(0, segCount); // 세그먼트별 타일링 시작
  const tileHi = cumAtVertex.slice(1, segCount + 1); // 세그먼트별 타일링 끝
  const cornerLaps: CornerLap[] = [];
  for (const a of acts) {
    if (a.convex) continue; // 볼록은 위에서 길이(+)로 이미 반영 — 먹힘 아님
    if (a.atStart) {
      const pos = tileLo[a.seg];
      const newLo = Math.min(pos + a.w, tileHi[a.seg]);
      cornerLaps.push({ vertexIndex: a.vertexIndex, x0: pos, x1: newLo });
      tileLo[a.seg] = newLo;
    } else {
      const pos = tileHi[a.seg];
      const newHi = Math.max(pos - a.w, tileLo[a.seg]);
      cornerLaps.push({ vertexIndex: a.vertexIndex, x0: newHi, x1: pos });
      tileHi[a.seg] = newHi;
    }
  }

  // ── 배치 안함(선만 이음) 변: 타일링 범위 0으로 → 보드 없음(길이·코너는 유지) ──
  const segSkip = params.segSkip;
  if (segSkip) {
    for (let i = 0; i < segCount; i++) if (segSkip[i]) tileLo[i] = tileHi[i];
  }

  // ── 2D 보드 배치 ──
  let cells: BoardCell[] = [];
  const rowJoints: number[] = [];
  const H = board.height;
  const L = board.length;

  // 시공성 우선이라도 2P(바깥 겹)는 1P와 조인트를 엇갈려야 결로가 안 생긴다.
  //  · 1P: 개구부 좌·우 라인에서 세로 절단(tileSiteConstructability)
  //  · 2P: 창 경계에서 안 끊고 연속 타일링 + 창 사각형만 파내기(subtractRect) →
  //        보드가 창 가장자리를 물고 넘어가고, 조인트는 1P(창 경계)와 엇갈림.
  const useSiteCut = placement === "constructability" && ply === 1;

  if (useSiteCut) {
    // ── 현장식 배치: 개구부 좌·우 라인에서 세로 일직선 절단, 위/아래만 '쪽'으로 ──
    cells = tileSiteConstructability(
      tileLo,
      tileHi,
      segCount,
      wallHeight,
      L,
      H,
      ops,
      segLapW
    );
    for (let y = 0; y < wallHeight - 1e-6; y += H) rowJoints.push(y);
    rowJoints.push(wallHeight);
  } else {
    // ── 물량 최소(러닝본드) 배치 — 개구부로 끊긴 '밴드' 기준 ──
    // 보드는 코너를 못 넘음 + 겹침 70 은 옆 면 차지 → 세그먼트별 [tileLo,tileHi] 만 타일링.
    //
    // 예전에는 전역 격자(y=0 부터 H 씩)로 켜를 깔고 창을 사각형으로 빼냈다(뽕뚫기).
    // 그러면 창 상단이 격자선과 안 맞을 때 창 위 구간이 240+200 처럼 두 켜로 갈라져
    // 현장에서 벽돌 쌓듯 위아래 두 번 붙이게 된다 → 밴드 기준 배치로 교체했다.
    // 대신 창 좌·우 라인에서는 켜 높이가 달라져 세로 조인트가 강제로 생긴다(불가피).
    const plyShift = (ply - 1) * plyStagger; // 겹 간 엇갈림
    const rowShiftOf = (r: number) =>
      (rowBond === "running" ? (r % 2) * (L / 2) : 0) + plyShift + startOffset;
    cells = tileBandRows(
      tileLo,
      tileHi,
      segCount,
      wallHeight,
      L,
      H,
      ops,
      segLapW,
      rowShiftOf
    );
    for (let y = 0; y < wallHeight - 1e-6; y += H) rowJoints.push(y);
    rowJoints.push(wallHeight);
  }

  // ── 모든 꺾임(코너) x 위치 — V 마크/끊김선용 (볼록·오목 모두) ──
  const cornerXs = corners
    .map(c => cumAtVertex[c.vertexIndex])
    .filter(x => x > 1e-6 && x < baselineLength - 1e-6);

  // ── 배치 정책별 자투리 처리 ──
  if (placement === "constructability") {
    // (옵션) 최소 조각 폭 재분할 — 기준 미만 자투리를 옆 판과 합쳐 균등 분할(조각 자체가 안 생김).
    if (constructMinPieceWidth > 0) {
      cells = mergeSlivers(cells, L, constructMinPieceWidth, cornerXs);
    }
    // 시공성 우선: 온장 유지, 기준치보다 좁은 절단 자투리는 '버림(폐기)' 표기.
    if (discardWidth > 0) {
      for (const c of cells) {
        if (c.xRemainder && c.w < discardWidth - 1e-6) c.discarded = true;
      }
    }
  } else if (minPieceWidth > 0) {
    // 물량 최소: 시공 불가 슬리버를 옆 보드와 합쳐 균등 분할.
    cells = mergeSlivers(cells, L, minPieceWidth, cornerXs);
  }

  return {
    ply,
    refOffset,
    baselineLength,
    wallHeight,
    segLengths,
    cells,
    rowJoints,
    cornerXs,
    cornerLaps,
    openingRects: ops,
  };
}

/**
 * 2P(또는 N겹) 전체 전개도 일괄 생성 → 겹마다 전개도 1장.
 * 반환 배열을 그대로 입면 N장으로 렌더하면 됨.
 */
export function developAllPlies(
  base: Omit<DevelopPlyParams, "ply">,
  plyCount = 2
): PlyDevelopment[] {
  const out: PlyDevelopment[] = [];
  for (let k = 1; k <= plyCount; k++) out.push(developPly({ ...base, ply: k }));
  return out;
}

/**
 * SP(시작점) 최적 배치 — startOffset 을 0..L 로 훑어 **주문 판 수 최소**인 배치를 고른다.
 * (동률이면 절단 조각 수가 적은 쪽). allowedOffsets 주면 그 후보만 탐색(B 기능 연계용).
 *
 * 반환: { dev, startOffset, orderBoardCount }.
 */
export function developPlyMinBoards(
  params: DevelopPlyParams,
  opts: { step?: number; allowedOffsets?: number[] } = {}
): { dev: PlyDevelopment; startOffset: number; orderBoardCount: number } {
  const L = params.board.length;
  const H = params.board.height;
  const step = opts.step ?? 50;
  const candidates =
    opts.allowedOffsets && opts.allowedOffsets.length > 0
      ? opts.allowedOffsets
      : Array.from({ length: Math.max(1, Math.round(L / step)) }, (_, k) => k * step);

  let best: PlyDevelopment | null = null;
  let bestOff = 0;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (const off of candidates) {
    const dev = developPly({ ...params, startOffset: off });
    const s = summarizeBoards(dev.cells, L, H);
    const score: [number, number] = [s.orderBoardCount, s.cutCount];
    if (
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1])
    ) {
      best = dev;
      bestOff = off;
      bestScore = score;
    }
  }
  // best 는 후보가 1개 이상이면 항상 채워짐
  return {
    dev: best ?? developPly(params),
    startOffset: bestOff,
    orderBoardCount: bestScore[0],
  };
}

// ────────────────────── 물량 집계 ──────────────────────

/** 규격별 보드 집계 1건 */
export interface BoardTally {
  /** 가로(mm) */
  w: number;
  /** 세로(mm) */
  h: number;
  /** 두께(mm) — 겹/노출타입별 자재 구분 (50T/90T 등) */
  thickness: number;
  /** 장수 */
  count: number;
  /** 절단(끝단) 보드 여부 — 정척이 아니면 true */
  remainder: boolean;
}

export interface BoardSummary {
  /** 규격별 집계 (정척 먼저, 그다음 절단 — 큰 면적 순) */
  tallies: BoardTally[];
  /** 총 조각 수 (정척+절단 조각) */
  totalCount: number;
  /** 정척(온장) 장수 */
  fullCount: number;
  /** 절단 조각 수 */
  cutCount: number;
  /** 절단 조각을 재단하는 데 필요한 온장 판 수 (2D 빈패킹) */
  cutBoardCount: number;
  /** 실제 주문 판 수 = 정척 + 절단판 */
  orderBoardCount: number;
  /** 총 면적(㎡) — 시공 조각 기준(버림 제외) */
  totalAreaM2: number;
  /** 버림(폐기) 조각 수 (시공성 우선 모드) */
  discardedCount: number;
  /** 버림(폐기) 면적(㎡) */
  discardedAreaM2: number;
}

/**
 * 보드 번호 매기기 (정척=공통 "온장", 절단=전용 그룹 N-1/N-2).
 *
 * 절단 조각은 같은 높이끼리 폭을 보드 길이 L 에 빈패킹(FFD)해서,
 * 한 온장에서 잘라 쓸 수 있는 것끼리 한 그룹으로 묶는다.
 *  - 그룹에 조각이 2개+ → `${번호}-${순번}` (전용/재사용)
 *  - 그룹에 조각이 1개  → `${번호}` (그 온장에서 1개만, 나머지 버림)
 * 반환: cells 와 같은 순서의 라벨 배열.
 */
/**
 * 절단 조각을 온장(L×H)에 2D 길로틴 빈패킹.
 * 반환: bins (각 bin = 한 온장에서 함께 재단되는 절단 cell 인덱스 배열).
 * bins.length = 절단에 필요한 실제 온장 판 수.
 */
export function packCutBoards(
  cells: BoardCell[],
  L: number,
  H: number
): number[][] {
  const EPS = 1e-6;
  const isFull = (c: BoardCell) => c.w >= L - EPS && c.h >= H - EPS;
  type FreeRect = { x: number; y: number; w: number; h: number };
  // 두께가 다른 조각은 같은 온장에서 못 자름 → bin 을 두께별로 구분
  type Bin = { free: FreeRect[]; items: number[]; thk: number };
  const bins: Bin[] = [];

  // 큰 조각(면적)부터 — 빈패킹 안정성
  const pieces = cells
    .map((c, i) => ({ w: c.w, h: c.h, i, thk: Math.round(c.thickness) }))
    .filter(p => !isFull(cells[p.i]) && !cells[p.i].discarded)
    .sort((a, b) => b.w * b.h - a.w * a.h);

  const splitFree = (bin: Bin, f: FreeRect, pw: number, ph: number) => {
    // 길로틴: 오른쪽(남는 폭×조각높이) + 위(전체폭×남는높이)
    const right = { x: f.x + pw, y: f.y, w: f.w - pw, h: ph };
    const top = { x: f.x, y: f.y + ph, w: f.w, h: f.h - ph };
    if (right.w > EPS && right.h > EPS) bin.free.push(right);
    if (top.w > EPS && top.h > EPS) bin.free.push(top);
  };

  for (const p of pieces) {
    let done = false;
    for (const bin of bins) {
      if (bin.thk !== p.thk) continue; // 두께 다르면 같은 온장 재단 불가
      let best = -1;
      let bestArea = Infinity;
      for (let k = 0; k < bin.free.length; k++) {
        const f = bin.free[k];
        if (f.w >= p.w - EPS && f.h >= p.h - EPS && f.w * f.h < bestArea) {
          bestArea = f.w * f.h;
          best = k;
        }
      }
      if (best >= 0) {
        const f = bin.free[best];
        bin.items.push(p.i);
        bin.free.splice(best, 1);
        splitFree(bin, f, p.w, p.h);
        done = true;
        break;
      }
    }
    if (!done) {
      const bin: Bin = { free: [], items: [p.i], thk: p.thk };
      splitFree(bin, { x: 0, y: 0, w: L, h: H }, p.w, p.h);
      bins.push(bin);
    }
  }
  return bins.map(b => b.items);
}

/**
 * 두께별 표시 색. 60T 와 90T 는 서로 잘라 쓸 수 없는 **다른 자재**이므로
 * 도면에서 번호만으로 헷갈리지 않게 색으로도 갈라 준다.
 * hex = 화면/SVG, aci = DXF 색 번호.
 */
export function thicknessStyle(thk: number): { hex: string; aci: number } {
  // hex 는 흰 배경(화면·SVG)용이라 진한 값, aci 는 검은 배경(CAD)용이라 밝은 값을 쓴다.
  const t = Math.round(thk);
  switch (t) {
    case 50:
      return { hex: "#16A34A", aci: 3 }; // 초록
    case 60:
      return { hex: "#CA8A04", aci: 2 }; // 노랑
    case 70:
      return { hex: "#EA580C", aci: 30 }; // 주황
    case 90:
      return { hex: "#C026D3", aci: 6 }; // 자홍
    case 100:
      return { hex: "#0891B2", aci: 4 }; // 청록
    default: {
      // 등록되지 않은 두께 — 두께값으로 색을 고정 배정(같은 두께는 늘 같은 색)
      const palette = [
        { hex: "#DC2626", aci: 1 },
        { hex: "#7C3AED", aci: 5 },
        { hex: "#B45309", aci: 51 },
        { hex: "#0F766E", aci: 91 },
      ];
      return palette[t % palette.length];
    }
  }
}

/** 절단 조각 규격 키 — 같은 두께·같은 크기면 같은 판(번호) */
export function cutTypeKeyOf(c: {
  w: number;
  h: number;
  thickness: number;
}): string {
  return `${Math.round(c.thickness)}x${Math.round(c.w)}x${Math.round(c.h)}`;
}

/** 온장(L×H) 1판에서 w×h 조각을 몇 개 잘라낼 수 있는지 (회전 없음, 격자 재단) */
export function piecesPerBoard(
  w: number,
  h: number,
  L: number,
  H: number
): number {
  const n = Math.floor((L + 1e-6) / w) * Math.floor((H + 1e-6) / h);
  return Math.max(1, n);
}

/**
 * 보드 번호 매기기 (정척=공통 "온장", 절단=**규격별** 번호 "{두께}-{번호}").
 *
 * 번호는 "이 조각이 어느 온장에서 잘려 나오는가"가 아니라 **조각 규격(두께·가로·세로)**
 * 을 가리킨다. 같은 크기 조각은 도면 어디에 있든 늘 같은 번호라, 인접 구간에 같은 판이
 * 붙으면 번호도 같게 읽힌다. (예전 재단판 단위 번호는 900×200 이 나란히 붙어 있어도
 * 60-10 / 60-11 / 60-12 로 흩어져 현장에서 번호가 중구난방으로 보였다.)
 *
 * **번호는 두께별로 따로 매긴다** — 60T 와 90T 는 서로 잘라 쓸 수 없는 다른 자재라
 * 번호가 한 줄로 흐르면 현장에서 60T "3" 과 90T "3" 이 같은 판으로 읽힌다.
 * 그래서 라벨 앞에 두께를 박아 `60-3` 처럼 두께가 곧 번호의 일부가 되게 한다.
 * 번호 순서는 두께 큰 순 → 면적 큰 순(현장에서 큰 판부터 읽는다).
 */
export function numberBoards(
  cells: BoardCell[],
  L: number,
  H: number
): string[] {
  const labels: string[] = new Array(cells.length).fill("");
  const isFull = (c: BoardCell) => c.w >= L - 1e-6 && c.h >= H - 1e-6;

  // 절단 조각 규격 수집 (온장·버림 제외)
  const types = new Map<string, { thk: number; w: number; h: number }>();
  for (const c of cells) {
    if (c.discarded || isFull(c)) continue;
    types.set(cutTypeKeyOf(c), {
      thk: Math.round(c.thickness),
      w: Math.round(c.w),
      h: Math.round(c.h),
    });
  }
  const noOf = new Map<string, string>();
  const seq = new Map<number, number>();
  [...types.entries()]
    .sort(
      (a, b) =>
        b[1].thk - a[1].thk ||
        b[1].w * b[1].h - a[1].w * a[1].h ||
        b[1].w - a[1].w ||
        b[1].h - a[1].h
    )
    .forEach(([key, t]) => {
      const no = (seq.get(t.thk) ?? 0) + 1;
      seq.set(t.thk, no);
      noOf.set(key, `${t.thk}-${no}`);
    });

  cells.forEach((c, i) => {
    if (c.discarded) labels[i] = "버림";
    else if (isFull(c)) labels[i] = "온장";
    else labels[i] = noOf.get(cutTypeKeyOf(c)) ?? "";
  });
  return labels;
}

/**
 * 라벨 → 판 그룹 키. 같은 규격(같은 번호) 조각끼리 같은 키를 갖는다.
 * `90-3` → `90-3` / 온장·버림은 그룹이 없어 null.
 */
export function groupKeyOf(label: string): string | null {
  if (!label || label === "온장" || label === "버림") return null;
  const p = label.split("-");
  return p.length >= 2 ? `${p[0]}-${p[1]}` : p[0];
}

/** 보드 셀 목록 → 규격별 물량 집계 + 실제 주문 판 수(L,H 필요 — 절단 빈패킹) */
export function summarizeBoards(
  cells: BoardCell[],
  L: number,
  H: number
): BoardSummary {
  const map = new Map<string, BoardTally>();
  let totalAreaMm2 = 0;
  let discardedCount = 0;
  let discardedAreaMm2 = 0;
  for (const c of cells) {
    const w = Math.round(c.w);
    const h = Math.round(c.h);
    // 버림(폐기) 조각은 시공/발주 집계에서 제외하고 별도 합산
    if (c.discarded) {
      discardedCount += 1;
      discardedAreaMm2 += w * h;
      continue;
    }
    const thk = Math.round(c.thickness);
    const remainder = c.xRemainder || c.yRemainder;
    const key = `${w}x${h}x${thk}x${remainder ? 1 : 0}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { w, h, thickness: thk, count: 1, remainder });
    totalAreaMm2 += w * h;
  }
  const tallies = [...map.values()].sort((a, b) => {
    // 두께 큰 순(90T→50T) → 정척 먼저 → 면적 큰 순
    if (a.thickness !== b.thickness) return b.thickness - a.thickness;
    if (a.remainder !== b.remainder) return a.remainder ? 1 : -1;
    return b.w * b.h - a.w * a.h;
  });
  // 시공 조각 수(버림 제외)
  const totalCount = cells.length - discardedCount;
  const cutCount = tallies
    .filter(t => t.remainder)
    .reduce((s, t) => s + t.count, 0);
  const fullCount = totalCount - cutCount;
  // 절단 조각을 실제 온장 몇 판에서 재단하는지 (2D 빈패킹 결과, 버림 제외)
  const cutBoardCount = packCutBoards(cells, L, H).length;
  return {
    tallies,
    totalCount,
    fullCount,
    cutCount,
    cutBoardCount,
    orderBoardCount: fullCount + cutBoardCount,
    totalAreaM2: totalAreaMm2 / 1_000_000,
    discardedCount,
    discardedAreaM2: discardedAreaMm2 / 1_000_000,
  };
}
