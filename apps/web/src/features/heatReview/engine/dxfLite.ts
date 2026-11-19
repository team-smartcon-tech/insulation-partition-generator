/**
 * 대용량 DXF 경량 파서 — 구역을 그리는 데 필요한 것(선·닫힌 선·글자)만 뽑는다.
 *
 * 왜 따로 만들었나: 실제 현장 도면(기초 평면, 98MB)은 외부참조가 블록 2,400개로 묶여 있고
 * 펼치면 선이 수백만 개다. 범용 파서는 줄마다 문자열을, 엔티티마다 객체와 Three.js 메시를 만들어
 * 브라우저가 "Out of Memory" 로 죽는다. 여기서는
 *   - 파일을 **바이트 그대로** 훑어 필요한 값만 숫자로 읽고 (문자열은 이름·글자에만),
 *   - BLOCKS·ENTITIES·LAYER 표만 보고 (OBJECTS 등은 건너뛴다),
 *   - 블록을 펼친 결과를 **선분 배열 하나**(Float64Array)로 낸다.
 * 렌더러(LiteDxfCanvas)는 그 배열을 한 번의 드로우콜로 그린다.
 *
 * 다루는 엔티티: LINE · LWPOLYLINE · POLYLINE · CIRCLE · ARC · ELLIPSE · SPLINE(꺾은선 근사)
 *               · INSERT(배열·대칭 포함) · DIMENSION(익명 블록) · TEXT · MTEXT · ATTRIB
 * 버리는 것: HATCH · SOLID · WIPEOUT · POINT · 종이공간 · 동결/꺼진 도면층
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LiteDxf {
  /** 선분 [x1,y1,x2,y2]… (도면 좌표) */
  segs: Float64Array;
  /** 선분별 색 [r,g,b]… */
  colors: Uint8Array;
  /** 닫힌 선 i 의 꼭짓점은 loopPts[loopOff[i]*2 … loopOff[i+1]*2) */
  loopOff: Uint32Array;
  loopPts: Float64Array;
  /** 닫힌 선별 경계 [minX,minY,maxX,maxY]… */
  loopBox: Float64Array;
  /**
   * 글자 [x,y,높이,각도(rad),정렬]… (5개씩)
   * 정렬: 0 왼쪽·기준선 / 1 가운데·기준선 / 2 오른쪽·기준선 / 3 가운데·중간 / 4 왼쪽·위 / 5 가운데·위 / 6 오른쪽·위
   */
  textPos: Float64Array;
  textStr: string[];
  bounds: Box;
  /** 화면 맞춤용 경계 — 멀리 떨어진 부스러기를 뺀 범위 */
  fit: Box;
  warnings: string[];
  /** 도면층 이름표 — `layerIndex` 옵션을 켰을 때만 채운다(슬래브 구분도가 쓴다) */
  layerNames?: string[];
  /** 선분별 도면층 번호(layerNames 의 인덱스) */
  segLayer?: Uint16Array;
  /** 글자별 도면층 번호 */
  textLayer?: Uint16Array;
  stats: { segments: number; loops: number; texts: number; blocks: number; truncated: boolean };
}

const MAX_SEGS = 6_000_000;
const MAX_LOOPS = 400_000;
const MAX_TEXTS = 80_000;
const MAX_DEPTH = 12;

const BYLAYER = -1;
const BYBLOCK = -2;

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

/** M∘L — L 을 먼저 적용 */
function mul(m: Mat, l: Mat): Mat {
  return [
    m[0] * l[0] + m[2] * l[1],
    m[1] * l[0] + m[3] * l[1],
    m[0] * l[2] + m[2] * l[3],
    m[1] * l[2] + m[3] * l[3],
    m[0] * l[4] + m[2] * l[5] + m[4],
    m[1] * l[4] + m[3] * l[5] + m[5],
  ];
}

interface EntBase {
  layer: string;
  /** rgb(0xRRGGBB) 또는 BYLAYER/BYBLOCK */
  color: number;
  /** 돌출 방향 Z 가 음수 — OCS 의 x 가 뒤집혀 있다 */
  mirror: boolean;
}
type Ent = EntBase &
  (
    | { k: "line"; x1: number; y1: number; x2: number; y2: number }
    /** pts: [x,y,bulge]… */
    | { k: "poly"; pts: number[]; closed: boolean }
    | { k: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; full: boolean }
    | { k: "ellipse"; cx: number; cy: number; mx: number; my: number; ratio: number; p0: number; p1: number }
    | {
        k: "insert";
        name: string;
        x: number;
        y: number;
        sx: number;
        sy: number;
        rot: number;
        cols: number;
        rows: number;
        dx: number;
        dy: number;
      }
    | { k: "text"; x: number; y: number; h: number; rot: number; s: string; align: number }
  );

interface Block {
  bx: number;
  by: number;
  ents: Ent[];
}

// ── ACI(AutoCAD 색 번호) → rgb ────────────────────────────────────────────────
const ACI_BASE = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
const ACI_GREY = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];

function aciToRgb(i: number): number {
  if (i < 0) i = -i;
  if (i < 10) return ACI_BASE[i] ?? 0xffffff;
  if (i >= 250) return ACI_GREY[Math.min(i, 255) - 250];
  // 10~249: 색상 24단계(15°) × 명도 5단계 × 채도 2단계
  const hue = Math.floor((i - 10) / 10) * 15;
  const j = i % 10;
  const val = [1, 0.8, 0.6, 0.5, 0.3][j >> 1];
  const sat = j % 2 === 0 ? 1 : 0.5;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r = 0,
    g = 0,
    b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

/** 어두운 바탕에서 안 보이는 색(검정·짙은 색)을 밝힌다. 흰색(7)은 눈부시지 않게 옅은 회색으로 */
function displayRgb(rgb: number): number {
  let r = (rgb >> 16) & 255,
    g = (rgb >> 8) & 255,
    b = rgb & 255;
  if (r > 240 && g > 240 && b > 240) return 0xd5dbe6;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 70) {
    const k = lum < 1 ? 0 : 70 / lum;
    if (k === 0) return 0xd5dbe6;
    r = Math.min(255, Math.round(r * k + 30));
    g = Math.min(255, Math.round(g * k + 30));
    b = Math.min(255, Math.round(b * k + 30));
  }
  return (r << 16) | (g << 8) | b;
}

export interface ParseOptions {
  /** 선분·글자마다 도면층 번호를 함께 낸다. 기본은 끔 — 선 하나에 2바이트가 더 든다 */
  layerIndex?: boolean;
}

export function parseDxfLite(buf: Uint8Array, opts: ParseOptions = {}): LiteDxf {
  const len = buf.length;
  let pos = 0;
  let code = 0;
  let vs = 0;
  let ve = 0;

  /** 다음 (그룹 코드, 값) 쌍으로 이동 */
  const next = (): boolean => {
    if (pos >= len) return false;
    let c = 0;
    let neg = false;
    let any = false;
    while (pos < len) {
      const b = buf[pos++];
      if (b === 10) break;
      if (b >= 48 && b <= 57) {
        c = c * 10 + (b - 48);
        any = true;
      } else if (b === 45) neg = true;
    }
    if (!any) {
      if (pos >= len) return false;
      c = -9999; // 빈 줄 — 아무 코드에도 안 걸리게
    }
    code = neg ? -c : c;
    vs = pos;
    while (pos < len && buf[pos] !== 10) pos++;
    ve = pos;
    if (pos < len) pos++;
    if (ve > vs && buf[ve - 1] === 13) ve--;
    return true;
  };

  const num = (): number => {
    let i = vs;
    const e = ve;
    while (i < e && buf[i] === 32) i++;
    let sign = 1;
    if (buf[i] === 45) {
      sign = -1;
      i++;
    } else if (buf[i] === 43) i++;
    let int = 0;
    while (i < e) {
      const b = buf[i];
      if (b < 48 || b > 57) break;
      int = int * 10 + (b - 48);
      i++;
    }
    let v = int;
    if (i < e && buf[i] === 46) {
      i++;
      let frac = 0;
      let scale = 1;
      while (i < e) {
        const b = buf[i];
        if (b < 48 || b > 57) break;
        // 소수 15자리 넘는 꼬리는 double 정밀도 밖 — 읽기만 하고 버린다
        if (scale < 1e15) {
          frac = frac * 10 + (b - 48);
          scale *= 10;
        }
        i++;
      }
      v += frac / scale;
    }
    if (i < e && (buf[i] === 69 || buf[i] === 101)) {
      i++;
      let es = 1;
      if (buf[i] === 45) {
        es = -1;
        i++;
      } else if (buf[i] === 43) i++;
      let ex = 0;
      while (i < e) {
        const b = buf[i];
        if (b < 48 || b > 57) break;
        ex = ex * 10 + (b - 48);
        i++;
      }
      v *= 10 ** (es * ex);
    }
    return sign * v;
  };

  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let legacy: TextDecoder | null = null;
  const str = (): string => {
    let i = vs;
    let e = ve;
    while (i < e && buf[i] === 32) i++;
    while (e > i && buf[e - 1] === 32) e--;
    let ascii = true;
    for (let k = i; k < e; k++) {
      if (buf[k] > 127) {
        ascii = false;
        break;
      }
    }
    let s: string;
    if (ascii && e - i < 4096) {
      s = String.fromCharCode.apply(null, buf.subarray(i, e) as unknown as number[]);
    } else {
      const sub = buf.subarray(i, e);
      try {
        s = utf8.decode(sub);
      } catch {
        // AC1018 이하(구 버전)는 코드페이지(한글 = CP949)로 저장된다
        legacy ??= new TextDecoder("euc-kr");
        s = legacy.decode(sub);
      }
    }
    // 구 버전의 유니코드 이스케이프 \U+XXXX
    return s.indexOf("\\U+") >= 0
      ? s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      : s;
  };

  // ── 읽기 ──
  const layers = new Map<string, { rgb: number; off: boolean; frozen: boolean }>();
  const blocks = new Map<string, Block>();
  const top: Ent[] = [];

  /**
   * 지금 값이 엔티티 종류(코드 0)인 상태에서 엔티티 하나를 읽는다.
   * 돌아올 때는 다음 엔티티의 코드 0 에 서 있다(more=false 면 파일 끝).
   */
  let more = true;
  /** 방금 읽은 VERTEX — POLYLINE 이 꼭짓점을 모을 때 쓴다 */
  const vtx = { x: 0, y: 0, bulge: 0 };
  const readEntity = (type: string, into: Ent[]): void => {
    let layer = "0";
    let color = BYLAYER;
    let ext = 1;
    let paper = false;
    let invisible = false;
    // 종류별로 쓰는 값들
    let x1 = 0,
      y1 = 0,
      x2 = 0,
      y2 = 0;
    let r = 0,
      a0 = 0,
      a1 = 360,
      bulge = 0;
    let f70 = 0,
      f71 = 0,
      f72 = 0,
      f73 = 0;
    let sx = 1,
      sy = 1,
      rot = 0,
      dx = 0,
      dy = 0;
    let ratio = 1,
      p0 = 0,
      p1 = Math.PI * 2;
    let name = "";
    let text = "";
    let pts: number[] | null = null;
    let fit: number[] | null = null;
    let hasAttribs = false;

    const isPoly = type === "LWPOLYLINE";
    const isSpline = type === "SPLINE";
    const wantsText = type === "TEXT" || type === "MTEXT" || type === "ATTRIB";

    while ((more = next())) {
      if (code === 0) break;
      switch (code) {
        case 8:
          layer = str();
          break;
        case 62: {
          const c = num();
          color = c === 0 ? BYBLOCK : c === 256 ? BYLAYER : aciToRgb(c);
          break;
        }
        case 420:
          color = num() & 0xffffff;
          break;
        case 67:
          paper = num() === 1;
          break;
        case 60:
          invisible = num() === 1;
          break;
        case 230:
          ext = num();
          break;
        case 66:
          hasAttribs = num() === 1;
          break;
        case 2:
          if (type === "INSERT" || type === "DIMENSION") name = str();
          break;
        case 1:
          if (wantsText) text += str();
          break;
        case 3:
          if (type === "MTEXT") text += str();
          break;
        case 10:
          if (isPoly || isSpline) (pts ??= []).push(num(), 0, 0);
          else x1 = num();
          break;
        case 20:
          if (isPoly || isSpline) {
            if (pts && pts.length >= 3) pts[pts.length - 2] = num();
          } else y1 = num();
          break;
        case 11:
          if (isSpline) (fit ??= []).push(num(), 0, 0);
          else x2 = num();
          break;
        case 21:
          if (isSpline) {
            if (fit && fit.length >= 3) fit[fit.length - 2] = num();
          } else y2 = num();
          break;
        case 42:
          if (isPoly) {
            if (pts && pts.length >= 3) pts[pts.length - 1] = num();
          } else if (type === "ELLIPSE") p1 = num();
          else if (type === "INSERT") sy = num();
          else if (type === "VERTEX") bulge = num();
          break;
        case 40:
          if (type === "ELLIPSE") ratio = num();
          else if (!isPoly && !isSpline) r = num();
          break;
        case 41:
          if (type === "INSERT") sx = num();
          else if (type === "ELLIPSE") p0 = num();
          break;
        case 50:
          if (type === "ARC") a0 = num();
          else rot = num();
          break;
        case 51:
          if (type === "ARC") a1 = num();
          break;
        case 70:
          f70 = num();
          break;
        case 71:
          f71 = num();
          break;
        case 72:
          f72 = num();
          break;
        case 73:
        case 74:
          f73 = num();
          break;
        case 44:
          dx = num();
          break;
        case 45:
          dy = num();
          break;
      }
    }

    if (paper || invisible) {
      // 버리더라도 딸린 VERTEX/ATTRIB 는 소비해야 줄이 안 밀린다
      if (type === "POLYLINE" || hasAttribs) skipToSeqend();
      return;
    }
    const base: EntBase = { layer, color, mirror: ext < 0 };

    switch (type) {
      case "LINE":
        into.push({ ...base, mirror: false, k: "line", x1, y1, x2, y2 });
        break;
      case "LWPOLYLINE":
        if (pts && pts.length >= 6) into.push({ ...base, k: "poly", pts, closed: (f70 & 1) === 1 });
        break;
      case "SPLINE": {
        // 맞춤점이 있으면 그 점을, 없으면 조정점을 잇는다 (곡선의 근사)
        const p = fit && fit.length >= 6 ? fit : pts;
        if (p && p.length >= 6) into.push({ ...base, mirror: false, k: "poly", pts: p, closed: (f70 & 1) === 1 });
        break;
      }
      case "POLYLINE": {
        // 꼭짓점은 뒤따르는 VERTEX 엔티티들 (SEQEND 까지)
        const mesh = (f70 & (16 | 64)) !== 0;
        const vpts: number[] = [];
        while (more && code === 0) {
          const t = str();
          if (t === "VERTEX") {
            readEntity("VERTEX", into);
            if (!mesh) vpts.push(vtx.x, vtx.y, vtx.bulge);
          } else if (t === "SEQEND") {
            skipEntity();
            break;
          } else break;
        }
        if (vpts.length >= 6) into.push({ ...base, k: "poly", pts: vpts, closed: (f70 & 1) === 1 });
        break;
      }
      case "VERTEX":
        vtx.x = x1;
        vtx.y = y1;
        vtx.bulge = bulge;
        break;
      case "CIRCLE":
        if (r > 0) into.push({ ...base, k: "arc", cx: x1, cy: y1, r, a0: 0, a1: 360, full: true });
        break;
      case "ARC":
        if (r > 0) into.push({ ...base, k: "arc", cx: x1, cy: y1, r, a0, a1, full: false });
        break;
      case "ELLIPSE":
        into.push({ ...base, mirror: false, k: "ellipse", cx: x1, cy: y1, mx: x2, my: y2, ratio, p0, p1 });
        break;
      case "INSERT":
        if (name) {
          into.push({
            ...base,
            k: "insert",
            name,
            x: x1,
            y: y1,
            sx,
            sy,
            rot,
            cols: Math.max(1, f70 | 0),
            rows: Math.max(1, f71 | 0),
            dx,
            dy,
          });
        }
        // 속성(ATTRIB)은 같은 공간에 놓인 글자다
        if (hasAttribs) {
          while (more && code === 0) {
            const t = str();
            if (t === "ATTRIB") readEntity("ATTRIB", into);
            else if (t === "SEQEND") {
              skipEntity();
              break;
            } else break;
          }
        }
        break;
      case "DIMENSION":
        // 치수선의 실제 모양은 익명 블록(*D…)에 도면 좌표로 들어 있다
        if (name) {
          into.push({ ...base, mirror: false, k: "insert", name, x: 0, y: 0, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, dx: 0, dy: 0 });
        }
        break;
      case "TEXT":
      case "ATTRIB":
      case "MTEXT": {
        const s = type === "MTEXT" ? cleanMText(text) : text;
        if (s && r > 0) {
          if (type === "MTEXT") {
            // 방향은 각도(50) 대신 방향 벡터(11,21)로 올 수 있다. 부착점(71): 1~9 = 위/중간/아래 × 왼/가운데/오른
            const ang = x2 !== 0 || y2 !== 0 ? (Math.atan2(y2, x2) * 180) / Math.PI : rot;
            const col = f71 >= 1 && f71 <= 9 ? (f71 - 1) % 3 : 0;
            const row = f71 >= 1 && f71 <= 9 ? Math.floor((f71 - 1) / 3) : 0;
            const align = row === 0 ? 4 + col : row === 1 && col === 1 ? 3 : col;
            into.push({ ...base, k: "text", x: x1, y: y1, h: r, rot: ang, s, align });
          } else if ((f72 !== 0 || f73 !== 0) && (x2 !== 0 || y2 !== 0)) {
            // 정렬이 걸린 글자는 둘째 점(11,21)이 기준점이다 (그리드 버블 등)
            const align = f72 === 4 || (f72 === 1 && f73 === 2) ? 3 : f72 === 2 ? 2 : f72 === 1 ? 1 : 0;
            into.push({ ...base, k: "text", x: x2, y: y2, h: r, rot, s, align });
          } else {
            into.push({ ...base, k: "text", x: x1, y: y1, h: r, rot, s, align: 0 });
          }
        }
        break;
      }
      default:
        break;
    }
  };

  const skipEntity = (): void => {
    while ((more = next())) if (code === 0) break;
  };
  const skipToSeqend = (): void => {
    while (more && code === 0) {
      const t = str();
      skipEntity();
      if (t === "SEQEND") break;
      if (t !== "VERTEX" && t !== "ATTRIB") break;
    }
  };

  // 최상위 루프: 섹션을 따라간다
  more = next();
  let section = "";
  while (more) {
    if (code !== 0) {
      more = next();
      continue;
    }
    const type = str();
    if (type === "SECTION") {
      more = next();
      if (more && (code as number) === 2) section = str();
      more = next();
      continue;
    }
    if (type === "ENDSEC") {
      const done = section === "ENTITIES";
      section = "";
      if (done) break; // 뒤의 OBJECTS 는 읽지 않는다
      more = next();
      continue;
    }
    if (type === "EOF") break;

    if (section === "TABLES") {
      if (type === "LAYER") {
        let name = "";
        let aci = 7;
        let tc = -1;
        let flags = 0;
        while ((more = next())) {
          if (code === 0) break;
          if (code === 2) name = str();
          else if (code === 62) aci = num();
          else if (code === 420) tc = num() & 0xffffff;
          else if (code === 70) flags = num();
        }
        if (name) layers.set(name, { rgb: tc >= 0 ? tc : aciToRgb(aci), off: aci < 0, frozen: (flags & 1) === 1 });
      } else skipEntity();
      continue;
    }

    if (section === "BLOCKS") {
      if (type === "BLOCK") {
        let name = "";
        let bx = 0;
        let by = 0;
        while ((more = next())) {
          if (code === 0) break;
          if (code === 2) name = str();
          else if (code === 10) bx = num();
          else if (code === 20) by = num();
        }
        const block: Block = { bx, by, ents: [] };
        while (more && code === 0) {
          const t = str();
          if (t === "ENDBLK") {
            skipEntity();
            break;
          }
          if (t === "ENDSEC" || t === "EOF") break;
          readEntity(t, block.ents);
        }
        if (name) blocks.set(name, block);
      } else skipEntity();
      continue;
    }

    if (section === "ENTITIES") {
      readEntity(type, top);
      continue;
    }

    // HEADER · CLASSES 등
    skipEntity();
  }

  // ── 펼치기 ──
  let cap = 1 << 18;
  let segs = new Float64Array(cap * 4);
  let colors = new Uint8Array(cap * 3);
  let n = 0;
  let truncated = false;

  // 도면층 번호(옵션) — 블록 안 "0" 층은 삽입한 쪽 층으로 풀린 뒤의 이름을 쓴다
  let segLayer: Uint16Array | null = opts.layerIndex ? new Uint16Array(cap) : null;
  const layerNames: string[] = [];
  const layerIdx = new Map<string, number>();
  const textLayer: number[] = [];
  let curLayer = 0;
  const layerIndexOf = (name: string): number => {
    let i = layerIdx.get(name);
    if (i === undefined) {
      i = Math.min(layerNames.length, 65535);
      if (i === layerNames.length) layerNames.push(name);
      layerIdx.set(name, i);
    }
    return i;
  };

  const seg = (ax: number, ay: number, bx: number, by: number, rgb: number) => {
    if (n >= MAX_SEGS) {
      truncated = true;
      return;
    }
    if (ax !== ax || ay !== ay || bx !== bx || by !== by) return; // NaN
    if (n === cap) {
      cap *= 2;
      const s2 = new Float64Array(cap * 4);
      s2.set(segs);
      segs = s2;
      const c2 = new Uint8Array(cap * 3);
      c2.set(colors);
      colors = c2;
      if (segLayer) {
        const g2 = new Uint16Array(cap);
        g2.set(segLayer);
        segLayer = g2;
      }
    }
    if (segLayer) segLayer[n] = curLayer;
    const i = n * 4;
    segs[i] = ax;
    segs[i + 1] = ay;
    segs[i + 2] = bx;
    segs[i + 3] = by;
    const j = n * 3;
    colors[j] = (rgb >> 16) & 255;
    colors[j + 1] = (rgb >> 8) & 255;
    colors[j + 2] = rgb & 255;
    n++;
  };

  const loopOff: number[] = [0];
  let loopPtsCap = 1 << 16;
  let loopPts = new Float64Array(loopPtsCap);
  let loopLen = 0;
  const loopBox: number[] = [];
  const textPos: number[] = [];
  const textStr: string[] = [];

  /** 한 도형의 꼭짓점들(도면 좌표) — 매번 새로 만들지 않고 돌려쓴다 */
  let path: number[] = [];

  const flushPath = (closed: boolean, rgb: number, asLoop: boolean) => {
    const count = path.length / 2;
    if (count < 2) return;
    for (let i = 0; i + 1 < count; i++) seg(path[i * 2], path[i * 2 + 1], path[i * 2 + 2], path[i * 2 + 3], rgb);
    if (closed && count >= 3) {
      seg(path[(count - 1) * 2], path[(count - 1) * 2 + 1], path[0], path[1], rgb);
      if (asLoop && loopOff.length <= MAX_LOOPS) {
        if (loopLen + path.length > loopPtsCap) {
          while (loopLen + path.length > loopPtsCap) loopPtsCap *= 2;
          const l2 = new Float64Array(loopPtsCap);
          l2.set(loopPts.subarray(0, loopLen));
          loopPts = l2;
        }
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (let i = 0; i < path.length; i += 2) {
          const x = path[i];
          const y = path[i + 1];
          loopPts[loopLen++] = x;
          loopPts[loopLen++] = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        loopOff.push(loopLen / 2);
        loopBox.push(minX, minY, maxX, maxY);
      }
    }
  };

  const push = (m: Mat, x: number, y: number) => {
    path.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  };

  /** 원호를 꺾은선으로 — 10° 간격 (끝점 제외, 시작점 포함 여부는 호출부가 정한다) */
  const arcPoints = (m: Mat, cx: number, cy: number, r: number, start: number, sweep: number, includeStart: boolean) => {
    const steps = Math.max(2, Math.min(72, Math.ceil(Math.abs(sweep) / (Math.PI / 18))));
    for (let i = includeStart ? 0 : 1; i <= steps; i++) {
      const a = start + (sweep * i) / steps;
      push(m, cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  };

  const MIRROR: Mat = [-1, 0, 0, 1, 0, 0];
  const stack = new Set<string>();

  const emit = (ents: Ent[], m: Mat, ctxLayer: string | null, ctxColor: number, depth: number) => {
    for (let ei = 0; ei < ents.length; ei++) {
      if (truncated) return;
      const e = ents[ei];
      // 블록 안에서 도면층 "0" 은 삽입한 쪽의 도면층을 따른다
      const layerName = e.layer === "0" && ctxLayer !== null ? ctxLayer : e.layer;
      const li = layers.get(layerName);
      if (li?.frozen) continue;
      const raw = e.color === BYLAYER ? (li?.rgb ?? 0xffffff) : e.color === BYBLOCK ? ctxColor : e.color;

      if (e.k === "insert") {
        const b = blocks.get(e.name);
        if (!b || b.ents.length === 0 || depth >= MAX_DEPTH || stack.has(e.name)) continue;
        const rad = (e.rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const base = e.mirror ? mul(m, MIRROR) : m;
        stack.add(e.name);
        for (let row = 0; row < e.rows; row++) {
          for (let col = 0; col < e.cols; col++) {
            const ox = col * e.dx;
            const oy = row * e.dy;
            // T(삽입점) · R · T(배열 간격) · S · T(−기준점)
            const local: Mat = [
              cos * e.sx,
              sin * e.sx,
              -sin * e.sy,
              cos * e.sy,
              e.x + cos * ox - sin * oy - (cos * e.sx * b.bx - sin * e.sy * b.by),
              e.y + sin * ox + cos * oy - (sin * e.sx * b.bx + cos * e.sy * b.by),
            ];
            emit(b.ents, mul(base, local), layerName, raw, depth + 1);
          }
        }
        stack.delete(e.name);
        continue;
      }

      if (li?.off) continue;
      if (segLayer) curLayer = layerIndexOf(layerName);
      const rgb = displayRgb(raw);
      const mm = e.mirror ? mul(m, MIRROR) : m;

      switch (e.k) {
        case "line":
          seg(
            m[0] * e.x1 + m[2] * e.y1 + m[4],
            m[1] * e.x1 + m[3] * e.y1 + m[5],
            m[0] * e.x2 + m[2] * e.y2 + m[4],
            m[1] * e.x2 + m[3] * e.y2 + m[5],
            rgb,
          );
          break;
        case "poly": {
          path = [];
          const p = e.pts;
          const count = p.length / 3;
          for (let i = 0; i < count; i++) {
            const x = p[i * 3];
            const y = p[i * 3 + 1];
            const bulge = p[i * 3 + 2];
            push(mm, x, y);
            const last = i === count - 1;
            if (bulge === 0 || (last && !e.closed)) continue;
            // 볼록값(bulge) 구간 = 원호. 다음 점까지를 꺾은선으로 채운다
            const j = last ? 0 : i + 1;
            const qx = p[j * 3];
            const qy = p[j * 3 + 1];
            const chord = Math.hypot(qx - x, qy - y);
            if (chord < 1e-12) continue;
            const half = chord / 2;
            const off = (half * (1 - bulge * bulge)) / (2 * bulge);
            const cx = (x + qx) / 2 - ((qy - y) / chord) * off;
            const cy = (y + qy) / 2 + ((qx - x) / chord) * off;
            const rr = Math.hypot(x - cx, y - cy);
            const sweep = 4 * Math.atan(bulge);
            const steps = Math.max(2, Math.min(36, Math.ceil(Math.abs(sweep) / (Math.PI / 18))));
            const start = Math.atan2(y - cy, x - cx);
            for (let s = 1; s < steps; s++) {
              const a = start + (sweep * s) / steps;
              push(mm, cx + rr * Math.cos(a), cy + rr * Math.sin(a));
            }
          }
          flushPath(e.closed, rgb, true);
          break;
        }
        case "arc": {
          path = [];
          if (e.full) {
            arcPoints(mm, e.cx, e.cy, e.r, 0, Math.PI * 2, false);
            flushPath(true, rgb, false);
          } else {
            let sweep = ((e.a1 - e.a0) * Math.PI) / 180;
            while (sweep <= 0) sweep += Math.PI * 2;
            arcPoints(mm, e.cx, e.cy, e.r, (e.a0 * Math.PI) / 180, sweep, true);
            flushPath(false, rgb, false);
          }
          break;
        }
        case "ellipse": {
          path = [];
          const major = Math.hypot(e.mx, e.my);
          if (major <= 0) break;
          const ux = e.mx / major;
          const uy = e.my / major;
          const minor = major * e.ratio;
          let sweep = e.p1 - e.p0;
          while (sweep <= 0) sweep += Math.PI * 2;
          const full = Math.abs(sweep - Math.PI * 2) < 1e-6;
          const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 18)));
          for (let i = 0; i <= (full ? steps - 1 : steps); i++) {
            const t = e.p0 + (sweep * i) / steps;
            const lx = major * Math.cos(t);
            const ly = minor * Math.sin(t);
            push(m, e.cx + ux * lx - uy * ly, e.cy + uy * lx + ux * ly);
          }
          flushPath(full, rgb, false);
          break;
        }
        case "text": {
          if (textStr.length >= MAX_TEXTS) break;
          const x = mm[0] * e.x + mm[2] * e.y + mm[4];
          const y = mm[1] * e.x + mm[3] * e.y + mm[5];
          const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
          const rad = (e.rot * Math.PI) / 180;
          // 글자 방향 벡터를 변환해 화면상의 각도를 구한다(대칭이면 뒤집힘을 풀어 읽히게 둔다)
          const dxv = mm[0] * Math.cos(rad) + mm[2] * Math.sin(rad);
          const dyv = mm[1] * Math.cos(rad) + mm[3] * Math.sin(rad);
          textPos.push(x, y, e.h * scale, Math.atan2(dyv, dxv), e.align);
          textStr.push(e.s);
          if (segLayer) textLayer.push(curLayer);
          break;
        }
      }
    }
  };

  emit(top, IDENT, null, 0xffffff, 0);

  // ── 경계 ──
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < n * 4; i += 2) {
    const x = segs[i];
    const y = segs[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const warnings: string[] = [];
  if (n === 0) {
    warnings.push("도면에 표시할 선이 없습니다.");
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  if (truncated) {
    warnings.push(`도면이 너무 커서 선 ${MAX_SEGS.toLocaleString("ko-KR")}개까지만 표시합니다.`);
  }
  const bounds: Box = { minX, minY, maxX, maxY };

  return {
    segs: segs.slice(0, n * 4),
    colors: colors.slice(0, n * 3),
    loopOff: Uint32Array.from(loopOff),
    loopPts: loopPts.slice(0, loopLen),
    loopBox: Float64Array.from(loopBox),
    textPos: Float64Array.from(textPos),
    textStr,
    bounds,
    fit: n > 0 ? robustBounds(segs, n, bounds) : bounds,
    warnings,
    ...(segLayer
      ? { layerNames, segLayer: segLayer.slice(0, n), textLayer: Uint16Array.from(textLayer) }
      : {}),
    stats: { segments: n, loops: loopOff.length - 1, texts: textStr.length, blocks: blocks.size, truncated },
  };
}

/**
 * 화면 맞춤용 경계. 원점 근처에 떨어진 점 하나 때문에 도면이 콩알만 해지는 일이 흔하다 —
 * 끝점의 0.5%~99.5% 범위가 전체보다 훨씬 작으면 그 범위를 쓴다.
 */
function robustBounds(segs: Float64Array, n: number, full: Box): Box {
  const total = n * 2;
  const stride = Math.max(1, Math.floor(total / 200_000));
  const count = Math.floor(total / stride);
  if (count < 200) return full;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = segs[i * stride * 2];
    ys[i] = segs[i * stride * 2 + 1];
  }
  xs.sort();
  ys.sort();
  const lo = Math.floor(count * 0.005);
  const hi = Math.min(count - 1, Math.ceil(count * 0.995));
  const w = xs[hi] - xs[lo];
  const h = ys[hi] - ys[lo];
  const fw = full.maxX - full.minX;
  const fh = full.maxY - full.minY;
  if (!(w > 0) || !(h > 0)) return full;
  if (w > fw * 0.6 && h > fh * 0.6) return full;
  const px = w * 0.04;
  const py = h * 0.04;
  return { minX: xs[lo] - px, minY: ys[lo] - py, maxX: xs[hi] + px, maxY: ys[hi] + py };
}

/** MTEXT 서식 코드 제거 — 글꼴·색 지정은 버리고 줄바꿈은 빈칸으로 */
function cleanMText(s: string): string {
  if (s.indexOf("\\") < 0 && s.indexOf("{") < 0) return s;
  return s
    .replace(/\\[PpNn]/g, " ")
    .replace(/\\[fFHhWwQqTtCcAaLlOoKk][^;\\]*;/g, "")
    .replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, "$1/$2")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
