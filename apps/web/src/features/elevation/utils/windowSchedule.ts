/**
 * 창호일람표(DXF) 읽기 — 표 한 칸(창호 1종)을 "기호·규격·명칭·위치·SILL" 로 뽑아낸다.
 *
 * 전제(국내 설계사 표준 일람표 형식, 부산장안 A-411~ 로 검증):
 *   - 표의 세로 격자선은 길다(수천 mm). 기호 글자(PW/WD/FSD…) 좌우의 가장 가까운 긴 세로선이 칸 경계.
 *   - 기호 칸 위로 [마감] [규격 "2.7X2.3"(m)] [명칭 "합성수지 미서기창"] [위치 "거실"] 글자가 차례로 올라간다.
 *   - 그 위 [형태] 칸에 입면 블록(INSERT)이 그려지고, 칸 오른쪽에 "F.L"/"S.L" 글자 + 기준선(긴 수평선)이 있다.
 *   - SILL = 블록 지오메트리(비편집=블록 전개 엔티티)의 최저점 − 기준선. 바닥에 닿는 창(−40 등)은 0.
 *
 * DIMENSION 엔티티는 렌더 라이브러리가 내보내지 않으므로 치수선에 의존하지 않는다.
 * 모든 길이는 DXF 모델 좌표(mm) 기준. 순수 함수 — 브라우저 API 를 쓰지 않는다(decodeDxfBytes 제외).
 */
import type { NormalizedEntity } from "./dxfEngine";

export type ScheduleKind = "window" | "door";

export interface ScheduleRow {
  /** 안정적인 id — `${sheet}|${symbol}|${w}x${h}|${location}` */
  id: string;
  /** 기호 (PW, WD, FSD, AG …) */
  symbol: string;
  kind: ScheduleKind;
  width: number;
  height: number;
  /** 설치 높이(mm). 기준선에서 개구부 하단까지. 못 찾으면 null */
  sill: number | null;
  /** 기준선 라벨 — F.L(마감 바닥) / S.L(슬래브). 칸에 라벨이 없으면 null(F.L 로 간주) */
  sillRef: "F.L" | "S.L" | null;
  /** 위치 (거실, 침실-1,2 …) */
  location: string;
  /** 명칭 (합성수지 미서기창 …) */
  name: string;
  /** 마감/유리 */
  finish: string;
  /** 시트 라벨 — "59㎡ A형 · 기본형" 처럼. 못 찾으면 "" */
  sheet: string;
}

export interface ScheduleExtract {
  rows: ScheduleRow[];
  sheets: string[];
  warnings: string[];
}

/** 입력은 ParsedDxf 의 entities 만 쓴다(테스트에서 가볍게 만들 수 있게) */
export interface ScheduleSource {
  entities: NormalizedEntity[];
}

// ── 상수 ──
/** 칸 경계로 인정하는 세로선 최소 길이. 창 입면의 세로 프레임선(≤2,600)보다 길어야 한다 */
const GRID_MIN_LEN = 4000;
/** 기준선(F.L 선)으로 인정하는 수평선 최소 길이 — 칸 두 개 이상을 가로지른다 */
const BASELINE_MIN_LEN_COLS = 1.8;
/** 형태 칸에서 창 지오메트리를 찾는 높이 범위(기준선 기준) */
const BAND_BELOW = 150;
const BAND_ABOVE = 4200;
/** 바닥에 닿는 창(프레임이 F.L 아래로 내려감) → SILL 0 */
const SILL_FLOOR_EPS = 80;
/** SILL 판정에 쓰는 최소 선 길이 — F.L 표식 삼각형(≈120)·개폐 화살표는 제외 */
const MIN_SEG_LEN = 300;

const SYMBOL_RE = /^[A-Z]{1,4}(?:-?\d{1,2}[A-Z]?)?$/;
const LEVEL_RE = /^(F\.?L|S\.?L)$/i;
const SIZE_RE = /^(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)$/;

type TextEnt = Extract<NormalizedEntity, { kind: "text" }>;
type Seg = { a: { x: number; y: number }; b: { x: number; y: number }; editable: boolean };

/**
 * 규격 글자 → mm. 일람표는 m("2.7X2.3")·cm 십단위("18×11.8")·mm("2700X2300") 가 섞인다.
 * 둘 다 10 미만이고 소수점이 있으면 m, 100 미만이면 cm 십단위, 그 외 mm.
 */
export function parseScheduleSize(
  text: string
): { width: number; height: number } | null {
  const m = SIZE_RE.exec(text.trim().replace(/,/g, ""));
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const hasDecimal = m[1].includes(".") || m[2].includes(".");
  let f = 1;
  if (w < 10 && h < 10 && hasDecimal) f = 1000;
  else if (w < 100 && h < 100) f = 100;
  return { width: Math.round(w * f), height: Math.round(h * f) };
}

/** 기호·명칭으로 창/문 판정. 명칭의 "문/창" 이 기호보다 우선(PD 가 문도 창도 됨) */
export function classifyKind(symbol: string, name: string): ScheduleKind {
  if (/창|그릴|루버/.test(name)) return "window";
  if (/문|도어/.test(name)) return "door";
  const head = symbol.replace(/[^A-Z]/g, "");
  if (/D$/.test(head) || head === "AG") return head === "AG" ? "window" : "door";
  return "window";
}

function collectSegments(entities: NormalizedEntity[]): Seg[] {
  const segs: Seg[] = [];
  for (const e of entities) {
    if (e.kind === "line") segs.push({ a: e.a, b: e.b, editable: e.editable });
    else if (e.kind === "polyline") {
      const n = e.points.length;
      for (let i = 1; i < n; i++)
        segs.push({ a: e.points[i - 1], b: e.points[i], editable: e.editable });
      if (e.closed && n >= 3) segs.push({ a: e.points[n - 1], b: e.points[0], editable: e.editable });
    }
  }
  return segs;
}

/** 시트 제목 — 같은 표 묶음(타일) 안의 "59㎡ A형 단위세대" + "창호 일람표-1 (확장형)" 을 "59㎡ A형 · 확장형-1" 로 */
function sheetLabelInTile(
  texts: TextEnt[],
  tile: { x0: number; x1: number; y0: number; y1: number }
): string {
  const cx = (tile.x0 + tile.x1) / 2;
  const cy = (tile.y0 + tile.y1) / 2;
  const inTile = (t: TextEnt) =>
    t.pos.x >= tile.x0 && t.pos.x <= tile.x1 && t.pos.y >= tile.y0 && t.pos.y <= tile.y1;
  // 타일을 한 칸 폭만큼 넓혔으므로 옆 장 제목이 걸릴 수 있다 → 타일 중심에 가장 가까운 것
  const nearestIn = (pred: (t: TextEnt) => boolean) => {
    let best: { t: TextEnt; d: number } | null = null;
    for (const t of texts) {
      if (!inTile(t) || !pred(t)) continue;
      const d = Math.hypot(t.pos.x - cx, t.pos.y - cy);
      if (!best || d < best.d) best = { t, d };
    }
    return best?.t ?? null;
  };
  const ty =
    nearestIn(t => /(㎡|m²|m2)/.test(t.text) && /형|타입|TYPE/i.test(t.text)) ??
    nearestIn(t => /(㎡|m²|m2)/.test(t.text));
  const va = nearestIn(t => /일람표/.test(t.text));
  const typeLabel = ty
    ? ty.text.replace(/단위세대/g, "").replace(/m²|m2/g, "㎡").trim()
    : "";
  let variant = "";
  if (va) {
    const paren = /\(([^)]+)\)/.exec(va.text)?.[1]?.trim() ?? "";
    const num = /일람표\s*-\s*(\d+)/.exec(va.text)?.[1];
    variant = paren ? (num ? `${paren}-${num}` : paren) : "";
  }
  return [typeLabel, variant].filter(Boolean).join(" · ");
}

/**
 * 칸 경계선(left)과 같은 세로 구간을 가진 격자선들을 가로로 이어 붙여 "표 한 장(타일)" 범위를 구한다.
 * 시트 제목은 표 바깥(아래/옆)에 있으므로 한 칸 폭만큼 넉넉히 넓힌다.
 */
function tileAround(
  vGrid: { x: number; y0: number; y1: number }[],
  left: number,
  y0: number,
  y1: number,
  colW: number
) {
  const same = vGrid
    .filter(g => Math.abs(g.y0 - y0) < 50 && Math.abs(g.y1 - y1) < 50)
    .map(g => g.x)
    .sort((a, b) => a - b);
  let x0 = left;
  let x1 = left;
  // 왼쪽으로 이어진 선
  for (let i = same.length - 1; i >= 0; i--) {
    if (same[i] > x0) continue;
    if (x0 - same[i] <= colW * 1.5) x0 = same[i];
    else break;
  }
  for (let i = 0; i < same.length; i++) {
    if (same[i] < x1) continue;
    if (same[i] - x1 <= colW * 1.5) x1 = same[i];
    else break;
  }
  return { x0: x0 - colW, x1: x1 + colW, y0: y0 - colW, y1: y1 + colW };
}

export function extractWindowSchedule(src: ScheduleSource): ScheduleExtract {
  const warnings: string[] = [];
  const texts = src.entities.filter((e): e is TextEnt => e.kind === "text");
  const segs = collectSegments(src.entities);

  // 긴 세로선(칸 경계 후보)과 긴 수평 편집선(기준선 후보)
  const vGrid = segs
    .filter(s => Math.abs(s.a.x - s.b.x) < 1 && Math.abs(s.a.y - s.b.y) >= GRID_MIN_LEN)
    .map(s => ({ x: s.a.x, y0: Math.min(s.a.y, s.b.y), y1: Math.max(s.a.y, s.b.y) }));
  const hLong = segs
    .filter(s => Math.abs(s.a.y - s.b.y) < 1 && Math.abs(s.a.x - s.b.x) >= 1500)
    .map(s => ({ y: s.a.y, x0: Math.min(s.a.x, s.b.x), x1: Math.max(s.a.x, s.b.x) }));
  const levelTexts = texts.filter(t => LEVEL_RE.test(t.text.trim()));

  const rows: ScheduleRow[] = [];
  const seen = new Set<string>();

  for (const sym of texts) {
    const symbol = sym.text.trim();
    if (!SYMBOL_RE.test(symbol) || LEVEL_RE.test(symbol)) continue;
    const sx = sym.pos.x;
    const sy = sym.pos.y;

    // 칸 경계 — 기호를 세로로 덮는 긴 세로선 중 좌우 최근접
    let left = -Infinity;
    let right = Infinity;
    let gridY0 = 0;
    let gridY1 = 0;
    for (const g of vGrid) {
      if (g.y0 > sy || g.y1 < sy) continue;
      if (g.x < sx - 20 && g.x > left) {
        left = g.x;
        gridY0 = g.y0;
        gridY1 = g.y1;
      }
      if (g.x > sx + 20 && g.x < right) right = g.x;
    }
    const colW = right - left;
    if (!Number.isFinite(colW) || colW < 2000 || colW > 12000) continue;
    const inCol = (x: number) => x > left + 5 && x < right - 5;

    // 칸 안 글자(기호 위쪽) — 상대 높이로 역할 구분
    const above = texts
      .filter(t => t !== sym && inCol(t.pos.x) && t.pos.y > sy && t.pos.y - sy < 1300)
      .map(t => ({ t, dy: t.pos.y - sy }));
    const sizeT = above
      .filter(o => o.dy < 600 && parseScheduleSize(o.t.text))
      .sort((p, q) => p.dy - q.dy)[0];
    if (!sizeT) continue; // 규격이 없으면 기호 칸이 아니다
    const size = parseScheduleSize(sizeT.t.text)!;
    const pick = (lo: number, hi: number, not?: TextEnt) =>
      above
        .filter(o => o.dy > lo && o.dy <= hi && o.t !== not && !LEVEL_RE.test(o.t.text.trim()))
        .sort((p, q) => p.dy - q.dy)
        .map(o => o.t.text.trim())
        .join(" ");
    const finish = pick(60, sizeT.dy - 20);
    const name = pick(sizeT.dy + 20, sizeT.dy + 220);
    const location = pick(sizeT.dy + 220, sizeT.dy + 560);

    // 기준선 — 칸 안 F.L/S.L 글자 → 그 바로 아래 긴 수평선. 없으면 같은 높이 띠의 다른 칸 라벨로
    const lvlIn = levelTexts.find(t => inCol(t.pos.x) && t.pos.y - sy > 600 && t.pos.y - sy < 1500);
    const lvlAny =
      lvlIn ?? levelTexts.find(t => t.pos.y - sy > 600 && t.pos.y - sy < 1500 && Math.abs(t.pos.x - sx) < colW * 6);
    let baseline: number | null = null;
    let tableX: { x0: number; x1: number } | null = null;
    if (lvlAny) {
      const ly = lvlAny.pos.y;
      const line = hLong
        .filter(h => h.y <= ly + 5 && h.y >= ly - 150 && h.x1 - h.x0 >= colW * BASELINE_MIN_LEN_COLS && h.x0 <= left + 50 && h.x1 >= right - 50)
        .sort((p, q) => Math.abs(ly - p.y) - Math.abs(ly - q.y))[0];
      baseline = line ? line.y : ly - 40;
    }
    {
      // 표 한 장의 가로 범위 — 이 칸을 가로지르는 행 테두리선 중 가장 짧은 것(합쳐 그린 기준선은 두 장을 잇기도 한다)
      const rowLine = hLong
        .filter(h => h.y >= sy - 400 && h.y <= sy + 1300 && h.x1 - h.x0 >= colW * BASELINE_MIN_LEN_COLS && h.x0 <= left + 50 && h.x1 >= right - 50)
        .sort((p, q) => p.x1 - p.x0 - (q.x1 - q.x0))[0];
      if (rowLine) tableX = { x0: rowLine.x0, x1: rowLine.x1 };
    }
    const sillRef: ScheduleRow["sillRef"] = lvlIn
      ? /^S/i.test(lvlIn.text.trim()) ? "S.L" : "F.L"
      : null;

    // SILL — 형태 칸 안 창 지오메트리(블록 전개·분해 모두)의 최저점.
    // 칸 위쪽 경계 = 기준선 위 첫 번째 긴 수평선(형태 칸 테두리). 없으면 고정 높이.
    let sill: number | null = null;
    if (baseline !== null) {
      const b = baseline;
      const spansCol = (h: { x0: number; x1: number }) => h.x0 <= left + 50 && h.x1 >= right - 50;
      const topLine = hLong
        .filter(h => spansCol(h) && h.y > b + 500 && h.y <= b + BAND_ABOVE)
        .sort((p, q) => p.y - q.y)[0];
      const bandTop = topLine ? topLine.y - 5 : b + BAND_ABOVE;
      let minY = Infinity;
      for (const s of segs) {
        if (Math.abs(s.a.x - s.b.x) >= colW * 0.9) continue; // 표 가로선
        if (!inCol(s.a.x) || !inCol(s.b.x)) continue;
        // 개구부 하단은 항상 수평선(프레임 바닥·개구부 사각형). 세로 보조선(치수 연장선 등)은 150 더 내려가므로 제외
        if (Math.abs(s.a.y - s.b.y) >= 1) continue;
        if (Math.abs(s.a.x - s.b.x) < MIN_SEG_LEN) continue; // 레벨 표식 삼각형·화살표
        const lo = s.a.y;
        if (lo < b - BAND_BELOW || lo >= bandTop) continue;
        if (lo < minY) minY = lo;
      }
      if (Number.isFinite(minY)) {
        const raw = minY - b;
        sill = raw < SILL_FLOOR_EPS ? 0 : Math.round(raw);
      }
    }

    const kind = classifyKind(symbol, name);
    if (kind === "door") sill = 0;

    const tile = tableX
      ? { x0: tableX.x0 - colW, x1: tableX.x1 + colW, y0: gridY0 - colW, y1: gridY1 + colW }
      : tileAround(vGrid, left, gridY0, gridY1, colW);
    const sheet = sheetLabelInTile(texts, tile);
    const id = `${sheet}|${symbol}|${size.width}x${size.height}|${location}|${sill ?? "?"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      symbol,
      kind,
      width: size.width,
      height: size.height,
      sill,
      sillRef,
      location,
      name,
      finish,
      sheet,
    });
  }

  if (rows.length === 0) warnings.push("일람표 형식(기호·규격·형태 칸)을 찾지 못했습니다.");
  const noSill = rows.filter(r => r.kind === "window" && r.sill === null).length;
  if (noSill > 0) warnings.push(`창 ${noSill}종은 입면에서 SILL 을 못 읽어 기본 SILL 을 씁니다.`);

  const sheets = Array.from(new Set(rows.map(r => r.sheet).filter(Boolean)));
  return { rows, sheets, warnings };
}

/**
 * 평면 라벨(W×H) ↔ 일람표 행 매칭. 정확히 같은 치수 우선, 없으면 ±tol 안의 가장 가까운 것.
 * `preferSheet` 가 있으면 그 시트의 행을 먼저 본다(같은 치수가 기본형/확장형에 다 있을 때).
 */
export function matchScheduleRow<T extends { width: number; height: number; sheet?: string }>(
  rows: T[],
  width: number,
  height: number,
  preferSheet?: string | null,
  tol = 100
): { row: T; exact: boolean } | null {
  let best: { row: T; score: number; exact: boolean } | null = null;
  for (const r of rows) {
    const dw = Math.abs(r.width - width);
    const dh = Math.abs(r.height - height);
    if (dw > tol || dh > tol) continue;
    const exact = dw === 0 && dh === 0;
    // 시트 우선: 선호 시트가 아니면 큰 페널티(그래도 다른 시트 후보보다는 가까운 치수가 이김)
    const sheetPenalty = preferSheet && r.sheet && r.sheet !== preferSheet ? 1000 : 0;
    const score = dw + dh + sheetPenalty;
    if (!best || score < best.score) best = { row: r, score, exact };
  }
  return best ? { row: best.row, exact: best.exact } : null;
}

/**
 * DXF 바이트 → 문자열. UTF-8 이 아니면(`$DWGCODEPAGE ANSI_949` 등 구 버전) EUC-KR 로 푼다.
 * 한글 위치·명칭이 깨지지 않게 하려는 것 — 평면 업로드(file.text()) 와 달리 여기선 글자가 결과다.
 */
export function decodeDxfBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(buf);
    } catch {
      return new TextDecoder().decode(buf);
    }
  }
}
