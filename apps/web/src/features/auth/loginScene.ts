/**
 * 로그인 배경 장면 — 등각(isometric) 와이어프레임 골조 + 타워크레인의 선 데이터.
 *
 * 화면 로직과 떼어 둔 순수 계산이라 React 없이도 돌아간다(미리보기 스크립트·시험에서 그대로 불러 쓴다).
 * 좌표는 "격자 단위"로 적고 `iso()` 가 viewBox 픽셀로 바꾼다. 결정적(난수 없음)이라 렌더마다 같은 그림이 나온다.
 *
 * 그리는 순서(= 애니메이션 지연 순서): 지면 기준선 → 동별 바닥선 → 층 슬래브선(아래부터) → 기둥선 → 지붕 → 크레인 → 치수선.
 * 각 선은 `delay`(초) 를 들고 있어 화면 쪽에서 그대로 animation-delay 로 쓴다.
 */

/** viewBox 크기 — 화면 컴포넌트와 미리보기가 같은 값을 쓴다 */
export const SCENE_W = 760;
export const SCENE_H = 664;

/** 격자 한 칸(px). 건물 가로 한 칸 = 한 베이(bay) */
const U = 28;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
/** 지면 원점(격자 0,0,0) 의 viewBox 위치 */
const ORIGIN_X = 330;
const ORIGIN_Y = 540;

/** 격자 좌표 → viewBox 픽셀. x 는 오른쪽 아래, y 는 왼쪽 아래, z 는 위 */
export function iso(x: number, y: number, z: number): [number, number] {
  return [ORIGIN_X + (x - y) * COS30 * U, ORIGIN_Y + (x + y) * SIN30 * U - z * U];
}

const pt = (x: number, y: number, z: number) => {
  const [px, py] = iso(x, y, z);
  return `${px.toFixed(1)} ${py.toFixed(1)}`;
};

/** 꺾은선 path(d). 점 배열을 M/L 로 잇는다 */
const polyline = (pts: [number, number, number][]) =>
  pts.map(([x, y, z], i) => `${i === 0 ? "M" : "L"}${pt(x, y, z)}`).join(" ");

export type SceneStroke = {
  d: string;
  /** 그리기 시작 지연(초) */
  delay: number;
  /** 선 굵기 등급 — main: 외곽·슬래브, sub: 기둥·보조, dim: 치수선 */
  kind: "main" | "sub" | "dim";
};

export type SceneLabel = {
  x: number;
  y: number;
  text: string;
  delay: number;
  /** 세로 치수선을 따라 눕힐 때 -90 */
  rotate?: number;
};

type Block = {
  ox: number;
  oy: number;
  /** x 방향 베이 수 */
  w: number;
  /** y 방향 깊이 */
  d: number;
  floors: number;
  /** 층고(격자 단위) */
  fh: number;
  /** 이 동이 그려지기 시작하는 시각(초) */
  start: number;
};

/** 동 세 채 — 가운데 고층 슬래브, 오른쪽 중층, 왼쪽 앞 저층 포디움 */
const BLOCKS: Block[] = [
  { ox: 0, oy: 0, w: 5, d: 2.4, floors: 14, fh: 0.86, start: 0.5 },
  { ox: 7.2, oy: 0.6, w: 3, d: 2.4, floors: 9, fh: 0.86, start: 1.1 },
  { ox: -4.8, oy: 2.6, w: 3, d: 2.6, floors: 3, fh: 1.0, start: 0.8 },
];

/** 한 동의 보이는 세 면(왼쪽·오른쪽·지붕)의 선 */
function blockStrokes(b: Block): SceneStroke[] {
  const out: SceneStroke[] = [];
  const { ox, oy, w, d, floors, fh, start } = b;
  const top = floors * fh;
  // 보이는 세 모서리 — L(왼쪽), F(앞), R(오른쪽). B(뒤)는 지붕에서만 보인다.
  const L: [number, number] = [ox, oy + d];
  const F: [number, number] = [ox + w, oy + d];
  const R: [number, number] = [ox + w, oy];
  const B: [number, number] = [ox, oy];

  // 바닥 외곽(보이는 두 변)
  out.push({ d: polyline([[...L, 0], [...F, 0], [...R, 0]]), delay: start, kind: "main" });

  // 층 슬래브선 — 아래층부터 차례로 올라간다
  const perFloor = 0.11;
  for (let k = 1; k <= floors; k++) {
    const z = k * fh;
    out.push({
      d: polyline([[...L, z], [...F, z], [...R, z]]),
      delay: start + 0.25 + k * perFloor,
      kind: k === floors ? "main" : "sub",
    });
  }

  // 지붕 뒷변 두 개 — 마지막 슬래브와 함께 닫힌다
  const roofAt = start + 0.25 + floors * perFloor;
  out.push({ d: polyline([[...L, top], [...B, top], [...R, top]]), delay: roofAt + 0.1, kind: "main" });

  // 모서리 기둥 세 개 + 면 안쪽 기둥(베이마다) — 슬래브가 반쯤 올라갔을 때부터 세운다
  const colAt = start + 0.25 + (floors * perFloor) / 2;
  const corner = (x: number, y: number) => polyline([[x, y, 0], [x, y, top]]);
  out.push({ d: corner(...L), delay: colAt, kind: "main" });
  out.push({ d: corner(...F), delay: colAt + 0.05, kind: "main" });
  out.push({ d: corner(...R), delay: colAt + 0.1, kind: "main" });
  for (let i = 1; i < w; i++) {
    out.push({ d: corner(ox + i, oy + d), delay: colAt + 0.15 + i * 0.06, kind: "sub" });
  }
  for (let j = 1; j < d; j++) {
    out.push({ d: corner(ox + w, oy + d - j), delay: colAt + 0.2 + j * 0.06, kind: "sub" });
  }
  return out;
}

/** 지면 기준선 — 건물 아래 깔리는 등각 격자(성긴 것만) */
function groundStrokes(): SceneStroke[] {
  const out: SceneStroke[] = [];
  const min = -6;
  const max = 11;
  for (let i = min; i <= max; i += 2) {
    out.push({ d: polyline([[i, min, 0], [i, max, 0]]), delay: 0.05 + (i - min) * 0.02, kind: "dim" });
    out.push({ d: polyline([[min, i, 0], [max, i, 0]]), delay: 0.05 + (i - min) * 0.02, kind: "dim" });
  }
  return out;
}

/** 타워크레인 — 마스트·지브·카운터지브·타이. 트롤리는 화면 쪽에서 따로 움직인다 */
export const CRANE = (() => {
  const bx = -1.6;
  const by = -1.4;
  const mastTop = 15.4;
  const apex = mastTop + 1.6;
  const jibLen = 10;
  const counterLen = 3.2;
  const start = 2.6;

  const strokes: SceneStroke[] = [
    // 마스트(두 줄로 두께감)
    { d: polyline([[bx, by, 0], [bx, by, mastTop]]), delay: start, kind: "main" },
    { d: polyline([[bx, by + 0.5, 0], [bx, by + 0.5, mastTop]]), delay: start + 0.05, kind: "sub" },
    // 마스트 가새(지그재그) — 몇 개만
    {
      d: polyline(
        Array.from({ length: 9 }, (_, i) => {
          const z = (i / 8) * mastTop;
          return [bx, i % 2 === 0 ? by : by + 0.5, z] as [number, number, number];
        }),
      ),
      delay: start + 0.3,
      kind: "dim",
    },
    // 지브(앞으로) + 카운터지브(뒤로)
    { d: polyline([[bx - counterLen, by, mastTop], [bx + jibLen, by, mastTop]]), delay: start + 0.9, kind: "main" },
    // 탑(apex) 과 타이 두 줄
    { d: polyline([[bx, by, mastTop], [bx, by, apex]]), delay: start + 1.2, kind: "sub" },
    { d: polyline([[bx, by, apex], [bx + jibLen, by, mastTop]]), delay: start + 1.4, kind: "dim" },
    { d: polyline([[bx, by, apex], [bx - counterLen, by, mastTop]]), delay: start + 1.4, kind: "dim" },
    // 카운터웨이트
    {
      d: polyline([
        [bx - counterLen, by, mastTop],
        [bx - counterLen, by, mastTop - 0.5],
        [bx - counterLen + 0.9, by, mastTop - 0.5],
        [bx - counterLen + 0.9, by, mastTop],
      ]),
      delay: start + 1.7,
      kind: "sub",
    },
  ];

  // 트롤리가 오갈 구간 — 화면 쪽에서 translate 로 움직인다
  const [tx0, ty0] = iso(bx + 1.2, by, mastTop);
  const [tx1, ty1] = iso(bx + jibLen - 0.8, by, mastTop);
  // 후크: 트롤리에서 아래로 내려오는 케이블 + 작은 고리
  const hookDrop = 4.2 * U;

  return {
    strokes,
    trolley: { x: tx0, y: ty0, dx: tx1 - tx0, dy: ty1 - ty0, hookDrop, appear: start + 2.1 },
  };
})();

/** 치수선 — 앞 동 왼쪽 밑변의 길이 치수 + 오른쪽 높이 치수 */
function dimensionStrokes(): { strokes: SceneStroke[]; labels: SceneLabel[] } {
  const a = BLOCKS[0];
  const strokes: SceneStroke[] = [];
  const labels: SceneLabel[] = [];
  const at = 4.6;
  const off = 0.9; // 밑변에서 바깥으로 띄우는 거리

  // 가로 치수: L→F 변(앞 왼쪽 면 밑변)과 나란히, y 를 바깥(+)으로 띄운다
  const y = a.oy + a.d + off;
  strokes.push({ d: polyline([[a.ox, y, 0], [a.ox + a.w, y, 0]]), delay: at, kind: "dim" });
  strokes.push({ d: polyline([[a.ox, a.oy + a.d + 0.15, 0], [a.ox, y + 0.25, 0]]), delay: at, kind: "dim" });
  strokes.push({ d: polyline([[a.ox + a.w, a.oy + a.d + 0.15, 0], [a.ox + a.w, y + 0.25, 0]]), delay: at, kind: "dim" });
  const [lx, ly] = iso(a.ox + a.w / 2, y + 0.55, 0);
  labels.push({ x: lx, y: ly, text: `${(a.w * 3000).toLocaleString("ko-KR")}`, delay: at + 0.5 });

  // 세로 치수: 왼쪽 모서리(L) 바깥(-x)에 높이 — 오른쪽은 뒷동과 겹친다. 숫자는 도면처럼 선을 따라 눕힌다
  const top = a.floors * a.fh;
  const x = a.ox - off;
  const ly2 = a.oy + a.d;
  strokes.push({ d: polyline([[x, ly2, 0], [x, ly2, top]]), delay: at + 0.3, kind: "dim" });
  strokes.push({ d: polyline([[a.ox - 0.15, ly2, 0], [x - 0.25, ly2, 0]]), delay: at + 0.3, kind: "dim" });
  strokes.push({ d: polyline([[a.ox - 0.15, ly2, top], [x - 0.25, ly2, top]]), delay: at + 0.3, kind: "dim" });
  const [hx, hy] = iso(x - 0.3, ly2, top / 2);
  labels.push({ x: hx, y: hy, text: `FL+${(a.floors * 2.9).toFixed(1)}`, delay: at + 0.8, rotate: -90 });

  return { strokes, labels };
}

/** 장면 전체 — 그리는 순서대로 정렬된 선 묶음 */
export const SCENE = (() => {
  const dims = dimensionStrokes();
  const strokes: SceneStroke[] = [
    ...groundStrokes(),
    ...BLOCKS.flatMap(blockStrokes),
    ...CRANE.strokes,
    ...dims.strokes,
  ];
  // 스캔선이 오갈 세로 범위 — 가장 높은 지점(크레인 탑)부터 지면 앞까지
  const [, topY] = iso(-1.6, -1.4, 17);
  const [, groundY] = iso(BLOCKS[2].ox, BLOCKS[2].oy + BLOCKS[2].d + 1.5, 0);
  return { strokes, labels: dims.labels, scanTop: topY, scanBottom: groundY };
})();
