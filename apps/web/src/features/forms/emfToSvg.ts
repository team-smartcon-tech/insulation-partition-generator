/**
 * EMF(윈도우 확장 메타파일) → SVG.
 *
 * 왜 있나: 엑셀 "카메라"로 찍은 그림·붙여 넣은 표 그림은 EMF 로 저장된다. 브라우저는 EMF 를 못 열어
 * 그 자리가 빈 틀로 남았다(7.2 카메라 시트의 장비관리표찰). EMF 는 선·면·글자를 그리는 명령의 나열이라
 * 양식에 실제로 쓰이는 명령만 SVG 로 옮기면 엑셀과 같은 그림이 된다.
 *
 * 다루는 것: 좌표계(창·뷰포트), 펜·붓·글꼴 만들기·고르기, 선(이동·잇기·꺾은선·다각형), 사각형·타원,
 * 면 채우기(BitBlt 패턴), 글자(ExtTextOutW, 글자 간격 배열), 클립 사각형. 비트맵 그림은 다루지 않는다.
 * 모르는 명령은 건너뛴다 — 하나 못 그린다고 그림 전체를 버리지 않는다.
 */

interface Pen {
  color: string;
  width: number;
  none: boolean;
}
interface Brush {
  color: string;
  none: boolean;
}
interface Font {
  height: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  face: string;
}
interface State {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  textAlign: number;
  windowOrg: [number, number];
  windowExt: [number, number];
  viewportOrg: [number, number];
  viewportExt: [number, number];
  mapMode: number;
  clip: [number, number, number, number] | null;
}

const BLACK = "#000000";
const DEFAULT_FONT: Font = { height: -12, weight: 400, italic: false, underline: false, face: "맑은 고딕" };

/** COLORREF(0x00BBGGRR) → #RRGGBB */
function colorRef(value: number): string {
  const r = value & 0xff;
  const g = (value >> 8) & 0xff;
  const b = (value >> 16) & 0xff;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 주식 개체(GetStockObject) — 핸들 0x80000000 + 번호 */
function stockObject(index: number): { pen?: Pen; brush?: Brush; font?: Font } | undefined {
  switch (index) {
    case 0: return { brush: { color: "#ffffff", none: false } }; // WHITE_BRUSH
    case 1: return { brush: { color: "#c0c0c0", none: false } };
    case 2: return { brush: { color: "#808080", none: false } };
    case 3: return { brush: { color: "#404040", none: false } };
    case 4: return { brush: { color: BLACK, none: false } }; // BLACK_BRUSH
    case 5: return { brush: { color: BLACK, none: true } }; // NULL_BRUSH
    case 6: return { pen: { color: "#ffffff", width: 0, none: false } }; // WHITE_PEN
    case 7: return { pen: { color: BLACK, width: 0, none: false } }; // BLACK_PEN
    case 8: return { pen: { color: BLACK, width: 0, none: true } }; // NULL_PEN
    default: return index >= 10 && index <= 17 ? { font: DEFAULT_FONT } : undefined;
  }
}

/**
 * EMF 바이트를 SVG 문자열로. EMF 가 아니거나 그릴 것이 없으면 null.
 */
export function emfToSvg(bytes: Uint8Array): string | null {
  if (bytes.length < 88) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 1 || view.getUint32(40, true) !== 0x464d4520) return null; // EMR_HEADER, " EMF"
  const bounds = [8, 12, 16, 20].map((at) => view.getInt32(at, true)) as [number, number, number, number];

  const objects = new Map<number, { pen?: Pen; brush?: Brush; font?: Font }>();
  let state: State = {
    pen: { color: BLACK, width: 0, none: false },
    brush: { color: "#ffffff", none: false },
    font: DEFAULT_FONT,
    textColor: BLACK,
    textAlign: 0,
    windowOrg: [0, 0],
    windowExt: [1, 1],
    viewportOrg: [0, 0],
    viewportExt: [1, 1],
    mapMode: 1,
    clip: null,
  };
  const saved: State[] = [];
  let cursor: [number, number] = [0, 0];
  const out: string[] = [];
  const clips = new Map<string, string>();

  // 논리 좌표 → 장치 좌표. MM_TEXT(1)는 그대로, 그 밖은 창·뷰포트 비율로.
  const scaleX = () => (state.mapMode === 1 ? 1 : state.viewportExt[0] / (state.windowExt[0] || 1));
  const scaleY = () => (state.mapMode === 1 ? 1 : state.viewportExt[1] / (state.windowExt[1] || 1));
  const tx = (x: number) => (x - state.windowOrg[0]) * scaleX() + state.viewportOrg[0];
  const ty = (y: number) => (y - state.windowOrg[1]) * scaleY() + state.viewportOrg[1];
  const r = (n: number) => Math.round(n * 100) / 100;

  const clipAttr = () => {
    if (!state.clip) return "";
    const [x1, y1, x2, y2] = state.clip;
    const key = `${x1},${y1},${x2},${y2}`;
    if (!clips.has(key)) {
      const id = `c${clips.size}`;
      clips.set(key, id);
    }
    return ` clip-path="url(#${clips.get(key)})"`;
  };
  const stroke = () =>
    state.pen.none ? 'stroke="none"' : `stroke="${state.pen.color}" stroke-width="${r(Math.max(1, state.pen.width * Math.abs(scaleX())))}"`;
  const fill = () => (state.brush.none ? 'fill="none"' : `fill="${state.brush.color}"`);

  const points16 = (at: number, count: number) => {
    const list: string[] = [];
    for (let i = 0; i < count; i++) list.push(`${r(tx(view.getInt16(at + i * 4, true)))},${r(ty(view.getInt16(at + i * 4 + 2, true)))}`);
    return list;
  };
  const points32 = (at: number, count: number) => {
    const list: string[] = [];
    for (let i = 0; i < count; i++) list.push(`${r(tx(view.getInt32(at + i * 8, true)))},${r(ty(view.getInt32(at + i * 8 + 4, true)))}`);
    return list;
  };

  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const type = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > bytes.length) break;
    const at = offset + 8;
    try {
      switch (type) {
        case 9: state.windowExt = [view.getInt32(at, true), view.getInt32(at + 4, true)]; break;
        case 10: state.windowOrg = [view.getInt32(at, true), view.getInt32(at + 4, true)]; break;
        case 11: state.viewportExt = [view.getInt32(at, true), view.getInt32(at + 4, true)]; break;
        case 12: state.viewportOrg = [view.getInt32(at, true), view.getInt32(at + 4, true)]; break;
        case 17: state.mapMode = view.getUint32(at, true); break;
        case 22: state.textAlign = view.getUint32(at, true); break;
        case 24: state.textColor = colorRef(view.getUint32(at, true)); break;
        case 33: saved.push({ ...state }); break;
        case 34: {
          const back = view.getInt32(at, true);
          const index = back < 0 ? saved.length + back : back;
          if (index >= 0 && index < saved.length) {
            state = saved[index];
            saved.length = index;
          }
          break;
        }
        case 30: { // INTERSECTCLIPRECT
          const box = [0, 4, 8, 12].map((k) => view.getInt32(at + k, true));
          const next: [number, number, number, number] = [tx(box[0]), ty(box[1]), tx(box[2]), ty(box[3])];
          state.clip = state.clip
            ? [Math.max(state.clip[0], next[0]), Math.max(state.clip[1], next[1]), Math.min(state.clip[2], next[2]), Math.min(state.clip[3], next[3])]
            : next;
          break;
        }
        case 75: { // EXTSELECTCLIPRGN — RGN_COPY(5) 에 영역이 없으면 클립을 푼다
          const mode = view.getUint32(at + 4, true);
          if (mode === 5 && view.getUint32(at, true) === 0) state.clip = null;
          break;
        }
        case 38: { // CREATEPEN
          const ih = view.getUint32(at, true);
          const style = view.getUint32(at + 4, true);
          objects.set(ih, { pen: { width: view.getInt32(at + 8, true), color: colorRef(view.getUint32(at + 16, true)), none: (style & 0xf) === 5 } });
          break;
        }
        case 95: { // EXTCREATEPEN
          const ih = view.getUint32(at, true);
          const style = view.getUint32(at + 20, true);
          objects.set(ih, { pen: { width: view.getUint32(at + 24, true), color: colorRef(view.getUint32(at + 32, true)), none: (style & 0xf) === 5 } });
          break;
        }
        case 39: { // CREATEBRUSHINDIRECT
          const ih = view.getUint32(at, true);
          objects.set(ih, { brush: { color: colorRef(view.getUint32(at + 8, true)), none: view.getUint32(at + 4, true) === 1 } });
          break;
        }
        case 82: { // EXTCREATEFONTINDIRECTW
          const ih = view.getUint32(at, true);
          const lf = at + 4;
          let face = "";
          for (let i = 0; i < 32; i++) {
            const code = view.getUint16(lf + 28 + i * 2, true);
            if (code === 0) break;
            face += String.fromCharCode(code);
          }
          objects.set(ih, {
            font: {
              height: view.getInt32(lf, true),
              weight: view.getInt32(lf + 16, true),
              italic: view.getUint8(lf + 20) !== 0,
              underline: view.getUint8(lf + 21) !== 0,
              face: face || DEFAULT_FONT.face,
            },
          });
          break;
        }
        case 37: { // SELECTOBJECT
          const ih = view.getUint32(at, true);
          const object = ih & 0x80000000 ? stockObject(ih & 0x7fffffff) : objects.get(ih);
          if (object?.pen) state.pen = object.pen;
          if (object?.brush) state.brush = object.brush;
          if (object?.font) state.font = object.font;
          break;
        }
        case 40: objects.delete(view.getUint32(at, true)); break;
        case 27: cursor = [view.getInt32(at, true), view.getInt32(at + 4, true)]; break;
        case 54: { // LINETO
          const next: [number, number] = [view.getInt32(at, true), view.getInt32(at + 4, true)];
          if (!state.pen.none) {
            out.push(`<line x1="${r(tx(cursor[0]))}" y1="${r(ty(cursor[1]))}" x2="${r(tx(next[0]))}" y2="${r(ty(next[1]))}" ${stroke()}${clipAttr()}/>`);
          }
          cursor = next;
          break;
        }
        case 43: case 42: { // RECTANGLE, ELLIPSE
          const [x1, y1, x2, y2] = [0, 4, 8, 12].map((k) => view.getInt32(at + k, true));
          const [a, b, c, d] = [tx(x1), ty(y1), tx(x2), ty(y2)];
          out.push(
            type === 43
              ? `<rect x="${r(Math.min(a, c))}" y="${r(Math.min(b, d))}" width="${r(Math.abs(c - a))}" height="${r(Math.abs(d - b))}" ${fill()} ${stroke()}${clipAttr()}/>`
              : `<ellipse cx="${r((a + c) / 2)}" cy="${r((b + d) / 2)}" rx="${r(Math.abs(c - a) / 2)}" ry="${r(Math.abs(d - b) / 2)}" ${fill()} ${stroke()}${clipAttr()}/>`,
          );
          break;
        }
        case 86: case 87: case 89: case 3: case 4: case 6: { // POLYGON16, POLYLINE16, POLYLINETO16, POLYGON, POLYLINE, POLYLINETO
          const count = view.getUint32(at + 16, true);
          const wide = type === 3 || type === 4 || type === 6;
          const list = wide ? points32(at + 20, count) : points16(at + 20, count);
          const closed = type === 86 || type === 3;
          const lineTo = type === 89 || type === 6;
          if (lineTo) list.unshift(`${r(tx(cursor[0]))},${r(ty(cursor[1]))}`);
          out.push(`<${closed ? "polygon" : "polyline"} points="${list.join(" ")}" ${closed ? fill() : 'fill="none"'} ${stroke()}${clipAttr()}/>`);
          if (lineTo && count > 0) {
            const last = wide ? at + 20 + (count - 1) * 8 : at + 20 + (count - 1) * 4;
            cursor = wide ? [view.getInt32(last, true), view.getInt32(last + 4, true)] : [view.getInt16(last, true), view.getInt16(last + 2, true)];
          }
          break;
        }
        case 90: case 91: { // POLYPOLYLINE16, POLYPOLYGON16
          const polys = view.getUint32(at + 16, true);
          let pointAt = at + 24 + polys * 4;
          for (let p = 0; p < polys; p++) {
            const count = view.getUint32(at + 24 + p * 4, true);
            const list = points16(pointAt, count);
            pointAt += count * 4;
            out.push(`<${type === 91 ? "polygon" : "polyline"} points="${list.join(" ")}" ${type === 91 ? fill() : 'fill="none"'} ${stroke()}${clipAttr()}/>`);
          }
          break;
        }
        case 76: { // BITBLT — 원본 비트맵이 없으면 붓으로 칠하는 패턴(칸 배경)
          const [x, y, w, h] = [16, 20, 24, 28].map((k) => view.getInt32(at + k, true));
          const rop = view.getUint32(at + 32, true);
          const cbBmi = view.getUint32(at + 80, true);
          if (cbBmi === 0) {
            // 붓으로 칠하기(PATCOPY)·흰색·검은색만 그린다. 그 밖(대상 그대로 0xAA0029 등)은 칠하지 않는다 —
            // 로고 자리를 검게 덮었다.
            const color =
              rop === 0x00ff0062 ? "#ffffff" : rop === 0x00000042 ? BLACK : rop === 0x00f00021 && !state.brush.none ? state.brush.color : null;
            if (color) {
              out.push(`<rect x="${r(tx(x))}" y="${r(ty(y))}" width="${r(w * scaleX())}" height="${r(h * scaleY())}" fill="${color}"${clipAttr()}/>`);
            }
          }
          break;
        }
        case 81: { // STRETCHDIBITS — 비트맵(로고 등)을 BMP 로 감싸 그림으로 넣는다
          const [xDest, yDest] = [view.getInt32(at + 16, true), view.getInt32(at + 20, true)];
          const offBmi = view.getUint32(at + 40, true);
          const cbBmi = view.getUint32(at + 44, true);
          const offBits = view.getUint32(at + 48, true);
          const cbBits = view.getUint32(at + 52, true);
          const [cxDest, cyDest] = [view.getInt32(at + 64, true), view.getInt32(at + 68, true)];
          if (cbBmi > 0 && cbBits > 0) {
            const file = new Uint8Array(14 + cbBmi + cbBits);
            const head = new DataView(file.buffer);
            head.setUint16(0, 0x4d42, true); // "BM"
            head.setUint32(2, file.length, true);
            head.setUint32(10, 14 + cbBmi, true);
            file.set(bytes.subarray(offset + offBmi, offset + offBmi + cbBmi), 14);
            file.set(bytes.subarray(offset + offBits, offset + offBits + cbBits), 14 + cbBmi);
            let binary = "";
            for (let i = 0; i < file.length; i += 0x8000) binary += String.fromCharCode(...file.subarray(i, i + 0x8000));
            out.push(
              `<image x="${r(tx(xDest))}" y="${r(ty(yDest))}" width="${r(cxDest * scaleX())}" height="${r(cyDest * scaleY())}"` +
                ` preserveAspectRatio="none" href="data:image/bmp;base64,${btoa(binary)}"${clipAttr()}/>`,
            );
          }
          break;
        }
        case 84: { // EXTTEXTOUTW
          const scaleText = Math.abs(scaleY());
          const emrText = at + 28;
          const refX = view.getInt32(emrText, true);
          const refY = view.getInt32(emrText + 4, true);
          const chars = view.getUint32(emrText + 8, true);
          const offString = view.getUint32(emrText + 12, true);
          const offDx = view.getUint32(emrText + 36, true);
          let text = "";
          for (let i = 0; i < chars; i++) text += String.fromCharCode(view.getUint16(offset + offString + i * 2, true));
          if (!text.trim()) break;
          let advance = 0;
          if (offDx) for (let i = 0; i < chars; i++) advance += view.getInt32(offset + offDx + i * 4, true);
          const font = state.font;
          const size = Math.max(1, Math.abs(font.height) * scaleText);
          const align = state.textAlign;
          const anchor = (align & 6) === 6 ? "middle" : (align & 6) === 2 ? "end" : "start";
          const baseline = (align & 24) === 24 ? "alphabetic" : (align & 8) === 8 ? "text-after-edge" : "text-before-edge";
          const length = advance > 0 ? ` textLength="${r(advance * Math.abs(scaleX()))}" lengthAdjust="spacingAndGlyphs"` : "";
          out.push(
            `<text x="${r(tx(refX))}" y="${r(ty(refY))}" font-family="${escapeXml(font.face)}, 맑은 고딕, sans-serif" font-size="${r(size)}"` +
              ` fill="${state.textColor}" text-anchor="${anchor}" dominant-baseline="${baseline}"` +
              `${font.weight >= 600 ? ' font-weight="bold"' : ""}${font.italic ? ' font-style="italic"' : ""}` +
              `${font.underline ? ' text-decoration="underline"' : ""}${length} xml:space="preserve"${clipAttr()}>${escapeXml(text)}</text>`,
          );
          break;
        }
        default:
          break;
      }
    } catch {
      // 명령 하나가 깨져 있어도 나머지는 그린다.
    }
    if (type === 14) break; // EOF
    offset += size;
  }
  if (out.length === 0) return null;

  const defs = [...clips].map(([key, id]) => {
    const [x1, y1, x2, y2] = key.split(",").map(Number);
    return `<clipPath id="${id}"><rect x="${x1}" y="${y1}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, y2 - y1)}"/></clipPath>`;
  });
  const [left, top, right, bottom] = bounds;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${Math.max(1, right - left + 1)} ${Math.max(1, bottom - top + 1)}" preserveAspectRatio="none">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    out.join("") +
    `</svg>`
  );
}
