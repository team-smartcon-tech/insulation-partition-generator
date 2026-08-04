/**
 * 입면 익스포트 유틸 — DXF / SVG
 *
 * - DXF: AutoCAD R12 호환 ASCII (LINE/TEXT만 사용 → 어떤 CAD에서도 열림)
 * - SVG: 인쇄/프리뷰용 벡터
 *
 * 좌표계:
 *   - 입력은 모두 mm 단위.
 *   - DXF: Y↑ 그대로 출력 (CAD 표준)
 *   - SVG: Y↓ 변환 (브라우저 좌표)
 */

export interface ElevationOpening {
  id: string;
  kind: "window" | "door" | "opening";
  /** 둘레 위 중심 위치 (mm) */
  sAlong: number;
  width: number;
  height: number;
  sill: number;
  label?: string;
}

/** 단열재 나누기도 출력 데이터 (한 겹). insulation 유틸 결과를 직렬화한 형태 */
export interface InsulationExport {
  /** 겹 번호 */
  ply: number;
  /** 보드 길이/높이(mm) — 라벨용 */
  boardLength: number;
  boardHeight: number;
  /** 전개면 보드 셀 (좌하단 기준 x,y + 크기) — 코너마다 끊김 */
  cells: { x: number; y: number; w: number; h: number }[];
  /** 셀별 번호 라벨 (cells 와 같은 순서). 정척="온장", 절단="90-3-1" 등 */
  labels?: string[];
  /**
   * 셀별 두께(mm) — 번호 색을 두께별로 갈라 그린다.
   * 60T 와 90T 는 서로 잘라 쓸 수 없는 자재라 도면에서 한눈에 구분돼야 한다.
   */
  cellThk?: number[];
  /** 셀별 번호 색 — SVG(hex) / DXF(ACI). cellThk 와 같은 순서 */
  labelColors?: string[];
  labelAcis?: number[];
  /** 모든 꺾임(코너) 전개 x 위치 — V(▽) 마크/끊김선용 */
  cornerXs: number[];
  /** 모서리 겹침(먹힘) 구간 [x0,x1] — 해치 */
  cornerLaps: { x0: number; x1: number }[];
  /** 보드 분할선 색 — SVG(hex) / DXF(ACI). 체인(입면)별로 다르게 */
  cellColor?: string;
  cellAci?: number;
  /**
   * 노출 구간(직접/간접외기) 밴드 — 전개 상단에 색 띠 + 라벨로 표기.
   * x0~x1(mm)은 전개 좌표. color=SVG hex, aci=DXF 색, label=한글(SVG), labelAscii=영문(DXF).
   */
  exposureBands?: {
    x0: number;
    x1: number;
    color: string;
    aci: number;
    label: string;
    labelAscii: string;
  }[];
  /** 물량 집계 (선택) — 도면에 총괄 텍스트 출력용 */
  summary?: {
    totalCount: number;
    fullCount: number;
    cutCount: number;
    cutBoardCount: number;
    orderBoardCount: number;
    totalAreaM2: number;
  };
}

export interface ElevationExportInput {
  /** 외벽 둘레 (mm) */
  perimeter: number;
  /** 층고 (mm) */
  floorHeight: number;
  /** 벽 분할 누적 길이 (mm). 시작 0과 끝 perimeter 포함 */
  wallCum: number[];
  openings: ElevationOpening[];
  /** 단열재 나누기도 (선택) — 있으면 ELEV_INSUL 레이어로 출력 */
  insulation?: InsulationExport;
  /** 파일명 베이스 (확장자 제외) */
  baseName?: string;
}

// ─────────────── 단열재 나누기도 출력 헬퍼 ───────────────

type DxfLineFn = (x1: number, y1: number, x2: number, y2: number, layer: string) => void;
type DxfTextFn = (x: number, y: number, h: number, s: string, layer: string) => void;

/** 단열재 나누기도를 DXF 엔티티로 출력 (dy = 입면 Y 오프셋) */
function emitInsulationDxf(
  insul: InsulationExport,
  dy: number,
  floorHeight: number,
  line: DxfLineFn,
  text: DxfTextFn,
  push: (code: number, value: string | number) => void
) {
  // 체인(입면)별 색 — 보드 분할선에 per-entity 색(group 62) 적용
  const aci = insul.cellAci ?? 4;
  const cline = (x1: number, y1: number, x2: number, y2: number) => {
    push(0, "LINE");
    push(8, "ELEV_INSUL");
    push(62, aci);
    push(10, x1);
    push(20, y1);
    push(30, 0);
    push(11, x2);
    push(21, y2);
    push(31, 0);
  };
  // 보드 셀(분할선)
  for (const c of insul.cells) {
    const x0 = c.x;
    const x1 = c.x + c.w;
    const y0 = dy + c.y;
    const y1 = dy + c.y + c.h;
    cline(x0, y0, x1, y0);
    cline(x1, y0, x1, y1);
    cline(x1, y1, x0, y1);
    cline(x0, y1, x0, y0);
  }
  // 모서리 겹침(먹힘) 구간 — 박스 + 45° 해치(박스 클립)
  const step = 150;
  for (const lap of insul.cornerLaps) {
    const lx0 = Math.min(lap.x0, lap.x1);
    const lx1 = Math.max(lap.x0, lap.x1);
    if (lx1 - lx0 < 0.5) continue;
    line(lx0, dy + 0, lx1, dy + 0, "ELEV_INSUL_LAP");
    line(lx1, dy + 0, lx1, dy + floorHeight, "ELEV_INSUL_LAP");
    line(lx1, dy + floorHeight, lx0, dy + floorHeight, "ELEV_INSUL_LAP");
    line(lx0, dy + floorHeight, lx0, dy + 0, "ELEV_INSUL_LAP");
    for (let k = -lx1; k <= floorHeight - lx0; k += step) {
      const xa = Math.max(lx0, -k);
      const xb = Math.min(lx1, floorHeight - k);
      if (xb > xa) line(xa, dy + (xa + k), xb, dy + (xb + k), "ELEV_INSUL_LAP");
    }
  }
  /** 두께 색을 실은 TEXT — 번호는 두께별로 색이 달라야 현장에서 헷갈리지 않는다 */
  const ctext = (
    x: number,
    y: number,
    h: number,
    s: string,
    tAci: number,
    rot?: number
  ) => {
    push(0, "TEXT");
    push(8, "ELEV_INSUL_TXT");
    push(62, tAci);
    push(10, x);
    push(20, y);
    push(30, 0);
    push(40, h);
    push(1, s);
    if (rot) push(50, rot);
  };

  // 보드 번호(원+숫자) + 치수 — 칸 가운데. (한글 '온장'은 R12 깨질 수 있어 'F'로)
  // 번호·원·치수 색은 **두께별**로 다르게 준다(60T ↔ 90T 오시공 방지).
  insul.cells.forEach((c, ci) => {
    const cx = c.x + c.w / 2;
    const cy = dy + c.y + c.h / 2;
    const raw = insul.labels?.[ci] ?? "";
    const thk = insul.cellThk?.[ci];
    const tAci = insul.labelAcis?.[ci] ?? 7;
    const label = raw === "온장" ? (thk ? `F${Math.round(thk)}` : "F") : raw;
    const rad = Math.min(c.w, c.h) * 0.28;
    if (label) {
      if (rad > 50) {
        // 원 + 번호
        push(0, "CIRCLE");
        push(8, "ELEV_INSUL_TXT");
        push(62, tAci);
        push(10, cx);
        push(20, cy);
        push(30, 0);
        push(40, rad);
        // 라벨이 길어졌으므로(예 90-3-1) 원 안에 들어가도록 글자 크기를 폭에 맞춘다
        const th = Math.min(rad * 1.1, 200, (rad * 1.9) / Math.max(1, label.length * 0.6));
        ctext(cx - label.length * th * 0.3, cy - th / 2, th, label, tAci);
      } else {
        // 좁은 조각: 원 없이 번호. 좁고 길면 90° 회전(빠지지 않게)
        const th = Math.max(60, Math.min(c.w, c.h) * 0.55);
        if (c.w < c.h && c.w < 350) {
          ctext(cx + th * 0.35, cy - label.length * th * 0.3, th, label, tAci, 90);
        } else {
          ctext(cx - label.length * th * 0.3, cy - th / 2, th, label, tAci);
        }
      }
    }
    // 치수 + 두께 (원 아래) — 번호를 못 읽어도 두께는 글자로 남는다
    const dh = Math.max(40, Math.min(90, Math.min(c.w, c.h) * 0.16));
    const dim = `${Math.round(c.w)}x${Math.round(c.h)}${thk ? ` ${Math.round(thk)}T` : ""}`;
    text(cx - dim.length * dh * 0.3, cy - rad - dh - 20, dh, dim, "ELEV_INSUL_TXT");
  });

  // 꺾임(코너) V 마크 — 전개 상단. 보드는 코너를 못 넘으므로 여기서 끊김.
  const vw = 120;
  const vh = 200;
  for (const cx of insul.cornerXs) {
    line(cx - vw, dy + floorHeight + vh, cx, dy + floorHeight, "ELEV_INSUL");
    line(cx + vw, dy + floorHeight + vh, cx, dy + floorHeight, "ELEV_INSUL");
  }

  // 노출 구간(직접/간접외기) 밴드 — 전개 최상단(V마크 위)에 색 박스 + 영문 라벨
  if (insul.exposureBands && insul.exposureBands.length > 0) {
    const by0 = dy + floorHeight + vh + 60;
    const by1 = by0 + 120;
    for (const b of insul.exposureBands) {
      const bx0 = Math.min(b.x0, b.x1);
      const bx1 = Math.max(b.x0, b.x1);
      if (bx1 - bx0 < 1) continue;
      const cbox = (x1: number, y1: number, x2: number, y2: number) => {
        push(0, "LINE");
        push(8, "ELEV_INSUL");
        push(62, b.aci);
        push(10, x1);
        push(20, y1);
        push(30, 0);
        push(11, x2);
        push(21, y2);
        push(31, 0);
      };
      cbox(bx0, by0, bx1, by0);
      cbox(bx1, by0, bx1, by1);
      cbox(bx1, by1, bx0, by1);
      cbox(bx0, by1, bx0, by0);
      const mid = (bx0 + bx1) / 2;
      text(mid - b.labelAscii.length * 30, by0 + 30, 70, b.labelAscii, "ELEV_INSUL_TXT");
    }
  }
  // 헤더 + 물량 총괄 (ASCII — R12 한글 깨짐 방지)
  let head = `INSUL ${insul.boardLength}x${insul.boardHeight}`;
  if (insul.summary) {
    head += `  ORDER ${insul.summary.orderBoardCount} BD (FULL ${insul.summary.fullCount} + CUTBD ${insul.summary.cutBoardCount}) PIECES ${insul.summary.totalCount} ${insul.summary.totalAreaM2.toFixed(2)}sqm`;
  }
  text(0, dy + floorHeight + 450, 150, head, "ELEV_INSUL");

  // 두께 색 범례 — 번호 색이 무슨 두께인지 도면 안에서 바로 읽히게 한다.
  // (두께가 한 종류뿐이면 범례가 의미 없으므로 생략)
  if (insul.cellThk && insul.labelAcis) {
    const seen = new Map<number, number>(); // 두께 → aci
    insul.cellThk.forEach((t, i) => {
      if (t && !seen.has(t)) seen.set(t, insul.labelAcis?.[i] ?? 7);
    });
    if (seen.size > 1) {
      let lx = head.length * 75 + 400;
      const ly = dy + floorHeight + 450;
      for (const [t, a] of [...seen].sort((x, y) => x[0] - y[0])) {
        ctext(lx, ly, 150, `[${t}T]`, a);
        lx += 700;
      }
    }
  }
}

/** 단열재 나누기도를 SVG 조각으로 출력 (ex/ey = 좌표 변환) */
function emitInsulationSvg(
  insul: InsulationExport,
  ex: (x: number) => number,
  ey: (y: number) => number,
  floorHeight: number
): string[] {
  const parts: string[] = [];
  const cellColor = insul.cellColor ?? "#0284c7";
  parts.push(`<g stroke="${cellColor}" stroke-width="0.8" fill="none">`);
  for (const c of insul.cells) {
    parts.push(
      `<rect x="${ex(c.x)}" y="${ey(c.y + c.h)}" width="${c.w}" height="${c.h}"/>`
    );
  }
  parts.push(`</g>`);
  // 보드 번호(원+숫자) + 치수
  insul.cells.forEach((c, ci) => {
    const cx = ex(c.x + c.w / 2);
    const cy = ey(c.y + c.h / 2);
    const raw = insul.labels?.[ci] ?? "";
    const thk = insul.cellThk?.[ci];
    // 두께별 색 — 60T 와 90T 번호가 같은 색이면 현장에서 섞인다
    const tc = insul.labelColors?.[ci] ?? "#0f172a";
    const label = raw === "온장" && thk ? `온장 ${Math.round(thk)}T` : raw;
    const rad = Math.min(c.w, c.h) * 0.28;
    if (rad > 50 && label) {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="#ffffff" stroke="${tc}" stroke-width="8"/>`
      );
      parts.push(
        `<text x="${cx}" y="${cy}" font-size="${Math.min(rad * 1.1, 200, (rad * 1.9) / Math.max(1, label.length * 0.6))}" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${tc}">${label}</text>`
      );
    }
    parts.push(
      `<text x="${cx}" y="${cy - rad - 30}" font-size="70" text-anchor="middle" fill="#94a3b8">${Math.round(c.w)}×${Math.round(c.h)}${thk ? ` ${Math.round(thk)}T` : ""}</text>`
    );
  });
  for (const lap of insul.cornerLaps) {
    const lx0 = Math.min(lap.x0, lap.x1);
    const lx1 = Math.max(lap.x0, lap.x1);
    if (lx1 - lx0 < 0.5) continue;
    parts.push(
      `<rect x="${ex(lx0)}" y="${ey(floorHeight)}" width="${lx1 - lx0}" height="${floorHeight}" fill="rgba(234,88,12,0.18)" stroke="#ea580c" stroke-width="1"/>`
    );
  }
  // 꺾임(코너) V 마크 — 전개 상단
  parts.push(`<g stroke="${cellColor}" stroke-width="1.2" fill="none">`);
  const vw = 120;
  const vh = 200;
  for (const cx of insul.cornerXs) {
    parts.push(
      `<polyline points="${ex(cx - vw)},${ey(floorHeight) - vh} ${ex(cx)},${ey(floorHeight)} ${ex(cx + vw)},${ey(floorHeight) - vh}"/>`
    );
  }
  parts.push(`</g>`);

  // 노출 구간(직접/간접외기) 밴드 — 전개 상단(외곽선 위) 색 띠 + 한글 라벨
  if (insul.exposureBands && insul.exposureBands.length > 0) {
    for (const b of insul.exposureBands) {
      const bx0 = Math.min(b.x0, b.x1);
      const bx1 = Math.max(b.x0, b.x1);
      if (bx1 - bx0 < 1) continue;
      parts.push(
        `<rect x="${ex(bx0)}" y="${ey(floorHeight) - 60}" width="${bx1 - bx0}" height="16" fill="${b.color}"/>`
      );
      parts.push(
        `<text x="${ex((bx0 + bx1) / 2)}" y="${ey(floorHeight) - 66}" font-size="70" text-anchor="middle" fill="${b.color}">${b.label}</text>`
      );
    }
  }

  parts.push(
    `<text x="${ex(0)}" y="${ey(floorHeight) - 26}" font-size="12" font-weight="bold" fill="${cellColor}">단열재 ${insul.boardLength}×${insul.boardHeight}</text>`
  );
  return parts;
}

// ───────────────────────── DXF ─────────────────────────

/**
 * DXF TEXT 를 CAD 에서 읽을 수 있는 ASCII 로 정규화한다.
 *
 * R12 ASCII DXF + SHX 폰트에서는 한글·기호가 `?????` 로 깨져 나온다.
 * 앱이 쓰는 한국어 라벨은 영문으로 바꾸고, 남은 비ASCII(사용자가 지은 한글 이름 등)는
 * 제거한다. SVG 는 UTF-8 이라 한글 그대로 나가므로 이 함수는 DXF 에만 쓴다.
 */
const DXF_WORDS: [RegExp, string][] = [
  [/입면/g, "ELEV"],
  [/기준층/g, "BASE"],
  [/지붕층/g, "ROOF"],
  [/저층/g, "LOW"],
  [/내측/g, "IN"],
  [/외측/g, "OUT"],
  [/직접외기/g, "DIRECT"],
  [/간접외기/g, "INDIRECT"],
  [/커스텀/g, "CUSTOM"],
  [/배치안함|배치 안함/g, "SKIP"],
  [/층고/g, "FH"],
  [/전개/g, "DEV"],
  [/둘레/g, "PERIM"],
  [/보드/g, "BOARD"],
  [/온장/g, "FULL"],
  [/절단/g, "CUT"],
  [/버림/g, "WASTE"],
  [/주문/g, "ORDER"],
  [/조각/g, "PCS"],
  [/판/g, "BD"],
];
export function dxfAscii(str: string): string {
  let s = String(str ?? "");
  for (const [re, en] of DXF_WORDS) s = s.replace(re, en);
  s = s
    .replace(/[·・]/g, "-")
    .replace(/[×✕]/g, "x")
    .replace(/㎡/g, "m2")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[〜～]/g, "~")
    .replace(/[^\x20-\x7E]/g, "") // 남은 비ASCII 제거
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || "-"; // 전부 한글이던 이름이 비면 빈 TEXT 대신 하이픈
}

/**
 * AutoCAD R12 호환 최소 DXF 생성.
 * 한국어 TEXT 는 R12 SHX 폰트 호환성이 떨어져 영문/숫자 라벨만 출력한다.
 */
export function buildElevationDxf(input: ElevationExportInput): string {
  const { perimeter, floorHeight, wallCum, openings } = input;
  const lines: string[] = [];

  const push = (code: number, value: string | number) => {
    lines.push(String(code));
    lines.push(typeof value === "number" ? value.toString() : value);
  };

  const line = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    push(0, "LINE");
    push(8, layer);
    push(10, x1);
    push(20, y1);
    push(30, 0);
    push(11, x2);
    push(21, y2);
    push(31, 0);
  };

  const text = (
    x: number,
    y: number,
    height: number,
    str: string,
    layer: string
  ) => {
    push(0, "TEXT");
    push(8, layer);
    push(10, x);
    push(20, y);
    push(30, 0);
    push(40, height);
    push(1, dxfAscii(str)); // 한글/기호는 CAD 에서 깨지므로 ASCII 로 정규화
  };

  // ── 헤더 ──
  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$ACADVER");
  push(1, "AC1009"); // R12
  push(9, "$INSUNITS");
  push(70, 4); // millimeters
  push(0, "ENDSEC");

  // ── TABLES (레이어) ──
  push(0, "SECTION");
  push(2, "TABLES");
  push(0, "TABLE");
  push(2, "LAYER");
  push(70, 4);

  const addLayer = (name: string, color: number) => {
    push(0, "LAYER");
    push(2, name);
    push(70, 0);
    push(62, color);
    push(6, "CONTINUOUS");
  };
  addLayer("ELEV_OUTLINE", 7); // 흰/검정
  addLayer("ELEV_WALL_DIV", 8); // 회색
  addLayer("ELEV_WINDOW", 5); // 파랑
  addLayer("ELEV_DOOR", 6); // 마젠타
  addLayer("ELEV_OPENING", 3); // 초록
  addLayer("ELEV_TEXT", 7);
  addLayer("ELEV_GRID", 9);
  addLayer("ELEV_INSUL", 4); // 단열재 보드 분할 — 시안
  addLayer("ELEV_INSUL_LAP", 30); // 모서리 랩(엇갈림) — 주황
  addLayer("ELEV_INSUL_TXT", 2); // 보드 치수 텍스트(물량) — 노랑

  push(0, "ENDTAB");
  push(0, "ENDSEC");

  // ── ENTITIES ──
  push(0, "SECTION");
  push(2, "ENTITIES");

  // 외곽
  line(0, 0, perimeter, 0, "ELEV_OUTLINE");
  line(perimeter, 0, perimeter, floorHeight, "ELEV_OUTLINE");
  line(perimeter, floorHeight, 0, floorHeight, "ELEV_OUTLINE");
  line(0, floorHeight, 0, 0, "ELEV_OUTLINE");

  // 벽 분할 가이드 (시작/끝 제외)
  for (let i = 1; i < wallCum.length - 1; i++) {
    const x = wallCum[i];
    line(x, 0, x, floorHeight, "ELEV_WALL_DIV");
  }

  // 그리드 — DXF 출력에서는 가로(높이) 그리드선 제거(요청). 1m 세로선도 미출력.

  // 벽면 라벨 W1, W2…
  for (let i = 0; i < wallCum.length - 1; i++) {
    const midX = (wallCum[i] + wallCum[i + 1]) / 2;
    text(midX, floorHeight + 100, 120, `W${i + 1}`, "ELEV_TEXT");
  }

  // 오프닝
  for (const op of openings) {
    const layer =
      op.kind === "window"
        ? "ELEV_WINDOW"
        : op.kind === "door"
          ? "ELEV_DOOR"
          : "ELEV_OPENING";
    const x0 = Math.max(0, op.sAlong - op.width / 2);
    const x1 = Math.min(perimeter, op.sAlong + op.width / 2);
    const y0 = op.sill;
    const y1 = op.sill + op.height;

    // 박스
    line(x0, y0, x1, y0, layer);
    line(x1, y0, x1, y1, layer);
    line(x1, y1, x0, y1, layer);
    line(x0, y1, x0, y0, layer);

    // 창문 십자
    if (op.kind === "window") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      line(cx, y0, cx, y1, layer);
      line(x0, cy, x1, cy, layer);
    }

    // 라벨: 폭x높이 + sill
    const sizeLabel =
      op.sill > 0
        ? `${op.width}x${op.height} sill${op.sill}`
        : `${op.width}x${op.height}`;
    text(x0 + 20, y1 + 20, 80, sizeLabel, "ELEV_TEXT");
  }

  // 단열재 나누기도 (있으면)
  if (input.insulation) {
    emitInsulationDxf(input.insulation, 0, floorHeight, line, text, push);
  }

  // 좌측 높이 눈금
  for (let y = 0; y <= floorHeight; y += 500) {
    text(-300, y, 80, String(y), "ELEV_TEXT");
  }
  // 하단 길이 눈금 (m)
  for (let x = 0; x <= perimeter; x += 1000) {
    text(x, -150, 80, `${(x / 1000).toFixed(0)}m`, "ELEV_TEXT");
  }

  push(0, "ENDSEC");
  push(0, "EOF");

  return lines.join("\r\n");
}

// ───────────────────────── SVG ─────────────────────────

export function buildElevationSvg(input: ElevationExportInput): string {
  const { perimeter, floorHeight, wallCum, openings } = input;
  const padX = 80;
  const padY = 80;
  const w = perimeter + padX * 2;
  const h = floorHeight + padY * 2;
  const ey = (y: number) => padY + (floorHeight - y); // Y 반전
  const ex = (x: number) => padX + x;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Noto Sans KR, sans-serif">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // 그리드 — 가로 500mm 선만
  parts.push(`<g stroke="#e2e8f0" stroke-width="1">`);
  for (let y = 0; y <= floorHeight; y += 500) {
    parts.push(
      `<line x1="${ex(0)}" y1="${ey(y)}" x2="${ex(perimeter)}" y2="${ey(y)}"/>`
    );
  }
  parts.push(`</g>`);

  // 벽 분할
  parts.push(`<g stroke="#cbd5e1" stroke-dasharray="3 3">`);
  for (let i = 1; i < wallCum.length - 1; i++) {
    const x = ex(wallCum[i]);
    parts.push(
      `<line x1="${x}" y1="${ey(0)}" x2="${x}" y2="${ey(floorHeight)}"/>`
    );
  }
  parts.push(`</g>`);

  // 벽면 라벨
  parts.push(`<g fill="#64748b" font-size="14" text-anchor="middle">`);
  for (let i = 0; i < wallCum.length - 1; i++) {
    const midX = (wallCum[i] + wallCum[i + 1]) / 2;
    parts.push(
      `<text x="${ex(midX)}" y="${ey(floorHeight) - 12}">W${i + 1}</text>`
    );
  }
  parts.push(`</g>`);

  // 외곽
  parts.push(
    `<rect x="${ex(0)}" y="${ey(floorHeight)}" width="${perimeter}" height="${floorHeight}" fill="none" stroke="#334155" stroke-width="2"/>`
  );

  // 오프닝
  const kindFill: Record<string, string> = {
    window: "rgba(56,189,248,0.25)",
    door: "rgba(244,114,182,0.25)",
    opening: "rgba(163,230,53,0.25)",
  };
  const kindStroke: Record<string, string> = {
    window: "#38bdf8",
    door: "#f472b6",
    opening: "#a3e635",
  };

  for (const op of openings) {
    const x0 = Math.max(0, op.sAlong - op.width / 2);
    const x1 = Math.min(perimeter, op.sAlong + op.width / 2);
    const y0 = op.sill;
    const y1 = op.sill + op.height;
    const px = ex(x0);
    const py = ey(y1);
    const pw = x1 - x0;
    const ph = y1 - y0;
    parts.push(
      `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${kindFill[op.kind]}" stroke="${kindStroke[op.kind]}" stroke-width="1.5"/>`
    );
    if (op.kind === "window") {
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      parts.push(
        `<line x1="${cx}" y1="${py}" x2="${cx}" y2="${py + ph}" stroke="${kindStroke[op.kind]}"/>`
      );
      parts.push(
        `<line x1="${px}" y1="${cy}" x2="${px + pw}" y2="${cy}" stroke="${kindStroke[op.kind]}"/>`
      );
    }
    const labelStr =
      op.sill > 0
        ? `${op.width}×${op.height} (sill ${op.sill})`
        : `${op.width}×${op.height}`;
    parts.push(
      `<text x="${px + pw / 2}" y="${py - 4}" font-size="12" text-anchor="middle" fill="#0f172a">${labelStr}</text>`
    );
  }

  // 단열재 나누기도 (있으면)
  if (input.insulation) {
    parts.push(...emitInsulationSvg(input.insulation, ex, ey, floorHeight));
  }

  // 눈금
  parts.push(
    `<g fill="#94a3b8" font-size="11" text-anchor="end" dominant-baseline="middle">`
  );
  for (let y = 0; y <= floorHeight; y += 500) {
    parts.push(`<text x="${ex(0) - 6}" y="${ey(y)}">${y}</text>`);
  }
  parts.push(`</g>`);
  parts.push(
    `<g fill="#94a3b8" font-size="11" text-anchor="middle" dominant-baseline="hanging">`
  );
  for (let x = 0; x <= perimeter; x += 1000) {
    parts.push(
      `<text x="${ex(x)}" y="${ey(0) + 6}">${(x / 1000).toFixed(0)}m</text>`
    );
  }
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ───────────────────────── 다운로드 ─────────────────────────

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────── 다중 입면 (통합) ───────────────────────

export interface ElevationStackInput {
  /** 각 입면 데이터 */
  chains: (ElevationExportInput & { title?: string })[];
  /** 입면 간 세로 간격 (mm). 기본 1500 */
  gapY?: number;
}

/**
 * 여러 입면을 위/아래로 쌓아 한 DXF 에 출력.
 * 좌측(x=0) 정렬, 첫 입면이 y=0 하단, 다음 입면은 위로 stack.
 */
export function buildElevationDxfMulti(input: ElevationStackInput): string {
  const gapY = input.gapY ?? 1500;
  const lines: string[] = [];
  const push = (code: number, value: string | number) => {
    lines.push(String(code));
    lines.push(typeof value === "number" ? value.toString() : value);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    push(0, "LINE");
    push(8, layer);
    push(10, x1);
    push(20, y1);
    push(30, 0);
    push(11, x2);
    push(21, y2);
    push(31, 0);
  };
  const text = (x: number, y: number, height: number, str: string, layer: string) => {
    push(0, "TEXT");
    push(8, layer);
    push(10, x);
    push(20, y);
    push(30, 0);
    push(40, height);
    push(1, dxfAscii(str)); // 한글/기호는 CAD 에서 깨지므로 ASCII 로 정규화
  };

  // 헤더
  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$ACADVER");
  push(1, "AC1009");
  push(9, "$INSUNITS");
  push(70, 4);
  push(0, "ENDSEC");

  // 레이어
  push(0, "SECTION");
  push(2, "TABLES");
  push(0, "TABLE");
  push(2, "LAYER");
  push(70, 4);
  const addLayer = (name: string, color: number) => {
    push(0, "LAYER");
    push(2, name);
    push(70, 0);
    push(62, color);
    push(6, "CONTINUOUS");
  };
  addLayer("ELEV_OUTLINE", 7);
  addLayer("ELEV_WALL_DIV", 8);
  addLayer("ELEV_WINDOW", 5);
  addLayer("ELEV_DOOR", 6);
  addLayer("ELEV_OPENING", 3);
  addLayer("ELEV_TEXT", 7);
  addLayer("ELEV_GRID", 9);
  addLayer("ELEV_INSUL", 4); // 단열재 보드 분할 — 시안
  addLayer("ELEV_INSUL_LAP", 30); // 모서리 랩(엇갈림) — 주황
  addLayer("ELEV_INSUL_TXT", 2); // 보드 치수 텍스트(물량) — 노랑
  push(0, "ENDTAB");
  push(0, "ENDSEC");

  // ENTITIES
  push(0, "SECTION");
  push(2, "ENTITIES");

  let yCursor = 0;
  input.chains.forEach((c, idx) => {
    const { perimeter, floorHeight, wallCum, openings } = c;
    if (perimeter <= 0 || floorHeight <= 0) return;
    const dy = yCursor;
    // 제목은 text() 가 ASCII 로 정규화한다. 이름이 전부 한글이라 남는 글자가 없으면
    // 빈 제목 대신 순번을 쓴다(어느 입면인지 도면에서 구분되게).
    const rawTitle = c.title ?? `Elevation ${idx + 1}`;
    const titleStr = dxfAscii(rawTitle) === "-" ? `ELEV ${idx + 1}` : rawTitle;

    // 제목 (영문/숫자만 안전 — 한글은 R12 SHX 에서 ?로 나올 수 있음)
    text(0, dy + floorHeight + 250, 150, titleStr, "ELEV_TEXT");

    // 외곽
    line(0, dy + 0, perimeter, dy + 0, "ELEV_OUTLINE");
    line(perimeter, dy + 0, perimeter, dy + floorHeight, "ELEV_OUTLINE");
    line(perimeter, dy + floorHeight, 0, dy + floorHeight, "ELEV_OUTLINE");
    line(0, dy + floorHeight, 0, dy + 0, "ELEV_OUTLINE");

    // 벽 분할
    for (let i = 1; i < wallCum.length - 1; i++) {
      const x = wallCum[i];
      line(x, dy + 0, x, dy + floorHeight, "ELEV_WALL_DIV");
    }

    // 가로 그리드 — DXF 출력에서는 제거(요청). 세로선도 없음.

    // 벽 라벨
    for (let i = 0; i < wallCum.length - 1; i++) {
      const midX = (wallCum[i] + wallCum[i + 1]) / 2;
      text(midX, dy + floorHeight + 100, 120, `W${i + 1}`, "ELEV_TEXT");
    }

    // 오프닝
    for (const op of openings) {
      const layer =
        op.kind === "window"
          ? "ELEV_WINDOW"
          : op.kind === "door"
            ? "ELEV_DOOR"
            : "ELEV_OPENING";
      const x0 = Math.max(0, op.sAlong - op.width / 2);
      const x1 = Math.min(perimeter, op.sAlong + op.width / 2);
      const y0 = op.sill;
      const y1 = op.sill + op.height;
      line(x0, dy + y0, x1, dy + y0, layer);
      line(x1, dy + y0, x1, dy + y1, layer);
      line(x1, dy + y1, x0, dy + y1, layer);
      line(x0, dy + y1, x0, dy + y0, layer);
      if (op.kind === "window") {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        line(cx, dy + y0, cx, dy + y1, layer);
        line(x0, dy + cy, x1, dy + cy, layer);
      }
      const sizeLabel =
        op.sill > 0
          ? `${op.width}x${op.height} sill${op.sill}`
          : `${op.width}x${op.height}`;
      text(x0 + 20, dy + y1 + 20, 80, sizeLabel, "ELEV_TEXT");
    }

    // 단열재 나누기도 (있으면)
    if (c.insulation) {
      emitInsulationDxf(c.insulation, dy, floorHeight, line, text, push);
    }

    // 좌측 높이 눈금
    for (let y = 0; y <= floorHeight; y += 500) {
      text(-300, dy + y, 80, String(y), "ELEV_TEXT");
    }
    // 하단 길이 눈금 m
    for (let x = 0; x <= perimeter; x += 1000) {
      text(x, dy - 150, 80, `${(x / 1000).toFixed(0)}m`, "ELEV_TEXT");
    }

    yCursor += floorHeight + gapY;
  });

  push(0, "ENDSEC");
  push(0, "EOF");
  return lines.join("\r\n");
}

/** 여러 입면을 위/아래로 쌓아 한 SVG 에 출력 */
export function buildElevationSvgMulti(input: ElevationStackInput): string {
  const gapY = input.gapY ?? 1500;
  const padX = 80;
  const padY = 80;
  const maxPerimeter = Math.max(
    1,
    ...input.chains.map(c => c.perimeter)
  );
  const totalH =
    input.chains.reduce((s, c) => s + c.floorHeight, 0) +
    gapY * Math.max(0, input.chains.length - 1) +
    padY * 2;
  const totalW = maxPerimeter + padX * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" font-family="Noto Sans KR, sans-serif">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  const kindFill: Record<string, string> = {
    window: "rgba(56,189,248,0.25)",
    door: "rgba(244,114,182,0.25)",
    opening: "rgba(163,230,53,0.25)",
  };
  const kindStroke: Record<string, string> = {
    window: "#38bdf8",
    door: "#f472b6",
    opening: "#a3e635",
  };

  // 위에서부터 그림 (SVG 좌표는 Y↓)
  let cursorY = padY;
  input.chains.forEach((c, idx) => {
    const { perimeter, floorHeight, wallCum, openings } = c;
    const title = c.title ?? `입면 ${idx + 1}`;
    const offX = padX;
    const offY = cursorY;
    const ex = (x: number) => offX + x;
    const ey = (y: number) => offY + (floorHeight - y);

    parts.push(
      `<text x="${ex(0)}" y="${offY - 6}" font-size="13" font-weight="bold" fill="#0f172a">${title} · 둘레 ${(perimeter / 1000).toFixed(2)}m · 층고 ${floorHeight}mm</text>`
    );

    // 가로 그리드만
    parts.push(`<g stroke="#e2e8f0" stroke-width="1">`);
    for (let y = 0; y <= floorHeight; y += 500) {
      parts.push(
        `<line x1="${ex(0)}" y1="${ey(y)}" x2="${ex(perimeter)}" y2="${ey(y)}"/>`
      );
    }
    parts.push(`</g>`);

    // 벽 분할
    parts.push(`<g stroke="#cbd5e1" stroke-dasharray="3 3">`);
    for (let i = 1; i < wallCum.length - 1; i++) {
      const x = ex(wallCum[i]);
      parts.push(`<line x1="${x}" y1="${ey(0)}" x2="${x}" y2="${ey(floorHeight)}"/>`);
    }
    parts.push(`</g>`);

    // W 라벨
    parts.push(`<g fill="#64748b" font-size="14" text-anchor="middle">`);
    for (let i = 0; i < wallCum.length - 1; i++) {
      const midX = (wallCum[i] + wallCum[i + 1]) / 2;
      parts.push(`<text x="${ex(midX)}" y="${ey(floorHeight) - 12}">W${i + 1}</text>`);
    }
    parts.push(`</g>`);

    // 외곽
    parts.push(
      `<rect x="${ex(0)}" y="${ey(floorHeight)}" width="${perimeter}" height="${floorHeight}" fill="none" stroke="#334155" stroke-width="2"/>`
    );

    // 오프닝
    for (const op of openings) {
      const x0 = Math.max(0, op.sAlong - op.width / 2);
      const x1 = Math.min(perimeter, op.sAlong + op.width / 2);
      const y0 = op.sill;
      const y1 = op.sill + op.height;
      const px = ex(x0);
      const py = ey(y1);
      const pw = x1 - x0;
      const ph = y1 - y0;
      parts.push(
        `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${kindFill[op.kind]}" stroke="${kindStroke[op.kind]}" stroke-width="1.5"/>`
      );
      if (op.kind === "window") {
        const cx = px + pw / 2;
        const cy = py + ph / 2;
        parts.push(`<line x1="${cx}" y1="${py}" x2="${cx}" y2="${py + ph}" stroke="${kindStroke[op.kind]}"/>`);
        parts.push(`<line x1="${px}" y1="${cy}" x2="${px + pw}" y2="${cy}" stroke="${kindStroke[op.kind]}"/>`);
      }
      const labelStr =
        op.sill > 0
          ? `${op.width}×${op.height} (sill ${op.sill})`
          : `${op.width}×${op.height}`;
      parts.push(
        `<text x="${px + pw / 2}" y="${py - 4}" font-size="12" text-anchor="middle" fill="#0f172a">${labelStr}</text>`
      );
    }

    // 단열재 나누기도 (있으면)
    if (c.insulation) {
      parts.push(...emitInsulationSvg(c.insulation, ex, ey, floorHeight));
    }

    // 높이 눈금
    parts.push(`<g fill="#94a3b8" font-size="11" text-anchor="end" dominant-baseline="middle">`);
    for (let y = 0; y <= floorHeight; y += 500) {
      parts.push(`<text x="${ex(0) - 6}" y="${ey(y)}">${y}</text>`);
    }
    parts.push(`</g>`);
    // 하단 m 눈금
    parts.push(`<g fill="#94a3b8" font-size="11" text-anchor="middle" dominant-baseline="hanging">`);
    for (let x = 0; x <= perimeter; x += 1000) {
      parts.push(`<text x="${ex(x)}" y="${ey(0) + 6}">${(x / 1000).toFixed(0)}m</text>`);
    }
    parts.push(`</g>`);

    cursorY += floorHeight + gapY;
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

