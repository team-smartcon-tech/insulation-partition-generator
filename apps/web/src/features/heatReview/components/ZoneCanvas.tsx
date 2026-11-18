/**
 * 보양 구역 도면 — DXF 위에 구역을 그려 면적·둘레를 딴다.
 *
 * 도면 렌더는 LiteDxfCanvas(선분 배열을 드로우콜 한 번으로)가 맡고, 그 위에 2D 캔버스를 겹쳐
 * 구역·그리는 중인 선·열원 배치·도면 글자를 그린다. 두 캔버스는 같은 scale/offset 을 써서 픽셀이 맞는다
 * (px = x·scale + offset.x, py = −y·scale + offset.y).
 *
 * 그리는 방법 세 가지
 *  - 다각형: 꼭짓점을 차례로 찍는다. 도면의 끝점·중점에 달라붙고, Shift 는 수평·수직 고정.
 *  - 사각형: 대각 두 점.
 *  - 닫힌 선 따기: 도면에 이미 그려진 닫힌 폴리라인 안쪽을 누르면 그 선이 구역이 된다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Flame,
  FolderOpen,
  Maximize,
  MousePointer2,
  Pentagon,
  ScanLine,
  Scan,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { zoneColor } from "../defaults";
import type { LiteDxf } from "../engine/dxfLite";
import { detectOutline } from "../engine/outline";
import {
  labelPoint,
  measurePolygon,
  offsetPolygon,
  placeHeaters,
  placeHeatersEdge,
  EDGE_BAND_M,
  mapBetween,
  EDGE_INSET_M,
  EDGE_SPACING_M,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  rectPolygon,
  unitFactor,
  wallClearance,
} from "../engine/geometry";
import type { DrawingMeta, Pt, Zone } from "../types";
import LiteDxfCanvas from "./LiteDxfCanvas";
import { dec } from "./ui";

type Tool = "select" | "polygon" | "rect" | "pick" | "outline";

const TOOLS: { id: Tool; label: string; hint: string; icon: typeof Square }[] = [
  { id: "select", label: "선택", hint: "구역을 눌러 선택 · 꼭짓점을 끌어 수정 · 끌면 화면 이동", icon: MousePointer2 },
  { id: "polygon", label: "다각형", hint: "꼭짓점을 차례로 클릭 · 첫 점 클릭/Enter/더블클릭으로 닫기 · Shift 수평·수직 · Backspace 한 점 취소", icon: Pentagon },
  { id: "rect", label: "사각형", hint: "대각선 두 점을 클릭", icon: Square },
  { id: "pick", label: "닫힌 선 따기", hint: "도면의 닫힌 폴리라인 안쪽을 클릭하면 그 선이 구역이 됩니다", icon: ScanLine },
  { id: "outline", label: "동 외곽 자동", hint: "건물 안쪽 아무 데나 한 번 누르면 그 건물의 바깥 테두리를 자동으로 땁니다", icon: Scan },
];

const SNAP_PX = 11;
const HANDLE_PX = 8;

/** zoneId → 그 구역에 적용한 열원의 대수(구역 1개당)와 색 */
export type HeaterOverlay = Map<string, { count: number; color: string; edgeShare?: number }>;

/** 동 외곽 안에서 찾은 세대·코어 하나 — 그릴 때 필요한 것만 */
export interface PartView {
  templateId: string;
  polygon: Pt[];
  name: string;
  /** 타입 구역의 팔레트 인덱스 */
  color: number;
  /** 이 세대에 놓을 열원 대수 */
  count: number;
  heaterColor: string;
  /** 이 세대 하나의 손실열량 kcal/h (타입 구역 1개 기준) — 동 합계를 낼 때 쓴다 */
  loss: number;
  /** 손실 중 외벽 쪽 몫 0~1 — 열원을 외벽 쪽으로 당기는 정도 */
  edgeShare: number;
  /** 타입을 그려 둔 원본 모양 — 기준 배치를 여기서 정해 이 세대 자리로 옮긴다 */
  templatePolygon: Pt[] | null;
}

/** 열원을 벽선에서 띄우는 거리 m */
const WALL_CLEAR_M = 0.45;

export default function ZoneCanvas({
  sheetLabel,
  parsed,
  drawing,
  loading,
  zones,
  selectedId,
  heaterOverlay,
  frameParts,
  onSelect,
  onCreate,
  onUpdatePolygon,
  onLoadFile,
  onUnitChange,
  onClearDrawing,
}: {
  /** 이 캔버스가 맡은 도면 종류 이름 (단위세대 / 코어 / 주차장·지하) */
  sheetLabel: string;
  parsed: LiteDxf | null;
  drawing: DrawingMeta | null;
  loading: boolean;
  zones: Zone[];
  selectedId: string | null;
  heaterOverlay: HeaterOverlay | null;
  /** 동 외곽 id → 그 안에서 찾은 세대·코어 */
  frameParts: Map<string, PartView[]> | null;
  onSelect: (id: string | null) => void;
  /** frame: 동 외곽으로 넣는다(「동 외곽 자동」으로 딴 것) */
  onCreate: (polygon: Pt[], opts?: { frame?: boolean }) => void;
  onUpdatePolygon: (zoneId: string, polygon: Pt[]) => void;
  onLoadFile: (file: File) => void;
  onUnitChange: (unit: "mm" | "m") => void;
  onClearDrawing: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ scale: 1, offset: { x: 0, y: 0 } });
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<{ world: Pt; snapped: boolean } | null>(null);
  const [showHeaters, setShowHeaters] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  /** 닫힌 선 따기에서 빈 곳을 눌렀을 때 잠깐 띄우는 안내 */
  const [pickMiss, setPickMiss] = useState(false);
  /** 동 외곽 자동이 테두리를 못 땄을 때 잠깐 띄우는 안내 */
  const [outlineMiss, setOutlineMiss] = useState(false);
  /** 꼭짓점을 끄는 동안의 임시 다각형 — 놓을 때 한 번만 문서에 쓴다 */
  const [editing, setEditing] = useState<{ zoneId: string; polygon: Pt[] } | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const unit = drawing?.unit ?? "mm";

  const cadZones = useMemo(
    () => zones.filter((z) => z.geometry.polygon && z.geometry.polygon.length >= 3),
    [zones],
  );
  const hasCanvasContent = !!parsed || cadZones.length > 0;
  /** 동 외곽 안에 원본 자리 그대로 세대로 잡힌 타입·코어 구역 */
  const coveredByFrame = useMemo(() => {
    const out = new Set<string>();
    if (!frameParts) return out;
    const firstOf = new Map(cadZones.map((z) => [z.id, z.geometry.polygon![0]]));
    for (const parts of frameParts.values()) {
      for (const part of parts) {
        const p0 = firstOf.get(part.templateId);
        if (p0 && part.polygon[0] && p0.x === part.polygon[0].x && p0.y === part.polygon[0].y) out.add(part.templateId);
      }
    }
    return out;
  }, [frameParts, cadZones]);

  // ── 크기 감시 ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    let b: { minX: number; minY: number; maxX: number; maxY: number } | null = parsed?.fit ?? null;
    if (!b && cadZones.length > 0) {
      b = polygonBounds(cadZones.flatMap((z) => z.geometry.polygon!));
    }
    if (!b) return;
    const bw = Math.max(1e-6, b.maxX - b.minX);
    const bh = Math.max(1e-6, b.maxY - b.minY);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const scale = Math.min(w / bw, h / bh) * 0.88;
    setView({
      scale,
      offset: {
        x: w / 2 - ((b.minX + b.maxX) / 2) * scale,
        y: h / 2 + ((b.minY + b.maxY) / 2) * scale,
      },
    });
  }, [parsed, cadZones]);

  // 도면이 바뀌면 화면에 맞춘다 (구역만 바뀔 때는 사용자가 보던 자리를 지킨다)
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    fitRef.current();
  }, [parsed, hasCanvasContent]);

  const toPx = (p: Pt, v = viewRef.current) => ({
    x: p.x * v.scale + v.offset.x,
    y: -p.y * v.scale + v.offset.y,
  });
  const toWorld = (px: number, py: number, v = viewRef.current): Pt => ({
    x: (px - v.offset.x) / v.scale,
    y: (v.offset.y - py) / v.scale,
  });

  /** 화면 좌표 → 도면 좌표. 도면 끝점·중점, 그리는 중인 첫 점에 달라붙는다 */
  const resolvePoint = useCallback(
    (px: number, py: number, shift: boolean, anchor: Pt | null): { world: Pt; snapped: boolean } => {
      const v = viewRef.current;
      const raw = toWorld(px, py, v);
      const tol = SNAP_PX / v.scale;
      let best: Pt | null = null;
      let bd = tol * tol;
      // 도면 선분의 끝점과 중점. 선이 수백만 개여도 x 범위로 먼저 걸러 한 번 훑는 데 몇 ms 다
      const segs = parsed?.segs;
      if (segs) {
        const lo = raw.x - tol;
        const hi = raw.x + tol;
        for (let i = 0; i < segs.length; i += 4) {
          const ax = segs[i];
          const bx = segs[i + 2];
          if ((ax < lo && bx < lo) || (ax > hi && bx > hi)) continue;
          const ay = segs[i + 1];
          const by = segs[i + 3];
          let d = (ax - raw.x) ** 2 + (ay - raw.y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: ax, y: ay };
          }
          d = (bx - raw.x) ** 2 + (by - raw.y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: bx, y: by };
          }
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          d = (mx - raw.x) ** 2 + (my - raw.y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: mx, y: my };
          }
        }
      }
      // 이미 그린 구역의 꼭짓점에도 붙는다 — CJ 끼리 변을 공유하므로
      for (const z of cadZones) {
        for (const p of z.geometry.polygon!) {
          const d = (p.x - raw.x) ** 2 + (p.y - raw.y) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
      }
      if (best) return { world: best, snapped: true };
      if (shift && anchor) {
        return Math.abs(raw.x - anchor.x) >= Math.abs(raw.y - anchor.y)
          ? { world: { x: raw.x, y: anchor.y }, snapped: false }
          : { world: { x: anchor.x, y: raw.y }, snapped: false };
      }
      return { world: raw, snapped: false };
    },
    [parsed, cadZones],
  );

  const finishDraft = useCallback(
    (pts: Pt[]) => {
      // 더블클릭은 같은 자리에 점이 두 번 찍힌다 → 붙은 점을 걷어낸다
      const clean: Pt[] = [];
      const eps = 2 / viewRef.current.scale;
      for (const p of pts) {
        const prev = clean[clean.length - 1];
        if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > eps) clean.push(p);
      }
      if (clean.length >= 3 && polygonArea(clean) > 0) onCreate(clean);
      setDraft([]);
      setTool("select");
    },
    [onCreate],
  );

  // ── 키보드 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        if (draft.length > 0) setDraft([]);
        else setTool("select");
      } else if (e.key === "Enter" && tool === "polygon" && draft.length >= 3) {
        finishDraft(draft);
      } else if ((e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) && draft.length > 0) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, tool, finishDraft]);

  // ── 휠 줌 (커서 기준). passive:false 여야 페이지 스크롤을 막을 수 있다 ──
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.exp(-e.deltaY * 0.0016);
        const scale = Math.min(1e6, Math.max(1e-9, v.scale * k));
        const f = scale / v.scale;
        return { scale, offset: { x: px - (px - v.offset.x) * f, y: py - (py - v.offset.y) * f } };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── 포인터 ──
  const gesture = useRef<
    | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; button: number }
    | { kind: "vertex"; zoneId: string; index: number }
    | null
  >(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const zoneAt = (w: Pt): Zone | null => {
    // 겹치면 작은 구역이 위 — 큰 구역 안의 작은 구역을 고를 수 있어야 한다
    let hit: Zone | null = null;
    let hitArea = Infinity;
    for (const z of cadZones) {
      const poly = z.geometry.polygon!;
      if (!pointInPolygon(w, poly)) continue;
      const a = polygonArea(poly);
      if (a < hitArea) {
        hitArea = a;
        hit = z;
      }
    }
    return hit;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 0 && tool === "select" && selectedId) {
      const z = cadZones.find((c) => c.id === selectedId);
      const poly = z?.geometry.polygon;
      if (z && poly) {
        const idx = poly.findIndex((p) => {
          const q = toPx(p);
          return Math.hypot(q.x - px, q.y - py) <= HANDLE_PX + 2;
        });
        if (idx >= 0) {
          gesture.current = { kind: "vertex", zoneId: z.id, index: idx };
          setEditing({ zoneId: z.id, polygon: poly.map((p) => ({ ...p })) });
          return;
        }
      }
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && tool === "select")) {
      const v = viewRef.current;
      gesture.current = { kind: "pan", sx: px, sy: py, ox: v.offset.x, oy: v.offset.y, moved: false, button: e.button };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = local(e);
    const g = gesture.current;
    if (g?.kind === "pan") {
      const dx = px - g.sx;
      const dy = py - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      setView((v) => ({ scale: v.scale, offset: { x: g.ox + dx, y: g.oy + dy } }));
      return;
    }
    if (g?.kind === "vertex") {
      const r = resolvePoint(px, py, false, null);
      setCursor(r);
      setEditing((cur) => {
        if (!cur) return cur;
        const polygon = cur.polygon.slice();
        polygon[g.index] = r.world;
        return { ...cur, polygon };
      });
      return;
    }
    const anchor = tool === "polygon" || tool === "rect" ? (draft[draft.length - 1] ?? null) : null;
    setCursor(
      tool === "polygon" || tool === "rect"
        ? resolvePoint(px, py, e.shiftKey, anchor)
        : { world: toWorld(px, py), snapped: false },
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = local(e);
    const g = gesture.current;
    gesture.current = null;

    if (g?.kind === "vertex") {
      if (editing && polygonArea(editing.polygon) > 0) onUpdatePolygon(editing.zoneId, editing.polygon);
      setEditing(null);
      return;
    }
    if (g?.kind === "pan" && g.moved) return;

    // 오른쪽 버튼: 그리는 중이면 닫는다
    if (e.button === 2) {
      if (tool === "polygon" && draft.length >= 3) finishDraft(draft);
      return;
    }
    if (e.button !== 0) return;

    if (tool === "select") {
      onSelect(zoneAt(toWorld(px, py))?.id ?? null);
      return;
    }
    if (tool === "outline") {
      const w = toWorld(px, py);
      const poly = parsed ? detectOutline(parsed.segs, w, { meter: 1 / unitFactor(unit) }) : null;
      if (poly) {
        onCreate(poly, { frame: true });
        setTool("select");
      } else {
        setOutlineMiss(true);
        window.setTimeout(() => setOutlineMiss(false), 3200);
      }
      return;
    }
    if (tool === "pick") {
      const w = toWorld(px, py);
      // 누른 점을 품은 닫힌 선 중 가장 작은 것 — 큰 외곽선 안의 구획을 고를 수 있게
      let best: Pt[] | null = null;
      let bestArea = Infinity;
      if (parsed) {
        const { loopBox, loopOff, loopPts } = parsed;
        for (let i = 0; i + 1 < loopOff.length; i++) {
          const k = i * 4;
          if (w.x < loopBox[k] || w.x > loopBox[k + 2] || w.y < loopBox[k + 1] || w.y > loopBox[k + 3]) continue;
          const pts: Pt[] = [];
          for (let j = loopOff[i]; j < loopOff[i + 1]; j++) pts.push({ x: loopPts[j * 2], y: loopPts[j * 2 + 1] });
          if (pts.length < 3 || !pointInPolygon(w, pts)) continue;
          const area = polygonArea(pts);
          if (area > 0 && area < bestArea) {
            bestArea = area;
            best = pts;
          }
        }
      }
      if (best) {
        onCreate(best);
        setTool("select");
      } else {
        setPickMiss(true);
        window.setTimeout(() => setPickMiss(false), 2200);
      }
      return;
    }
    const anchor = draft[draft.length - 1] ?? null;
    const { world } = resolvePoint(px, py, e.shiftKey, anchor);
    if (tool === "rect") {
      if (draft.length === 0) setDraft([world]);
      else finishDraft(rectPolygon(draft[0], world));
      return;
    }
    // polygon
    if (draft.length >= 3) {
      const first = toPx(draft[0]);
      if (Math.hypot(first.x - px, first.y - py) <= SNAP_PX + 2) {
        finishDraft(draft);
        return;
      }
    }
    setDraft((d) => [...d, world]);
  };

  // ── 열원 배치점 (구역·대수가 바뀔 때만 다시 계산) ──
  // 벽선 위에 놓이지 않게 도면 선에서 띄운다. 동 외곽은 통째로 놓지 않고 안의 세대·코어마다 따로 놓는다.
  const heaterMarks = useMemo(() => {
    const out = new Map<string, { pts: Pt[]; color: string; label: Pt }[]>();
    if (!heaterOverlay || !showHeaters) return out;
    const clear = WALL_CLEAR_M / unitFactor(unit);
    // 손실열량 분포로 가중 — outer 는 외기에 닿는 경계(동 안의 세대면 동 외곽)
    const place = (poly: Pt[], n: number, share: number, outer: Pt[]) =>
      placeHeaters(poly, Math.min(n, 80), wallClearance(poly, parsed?.segs ?? null, clear), {
        poly: outer,
        share,
        band: EDGE_BAND_M / unitFactor(unit),
      });
    // 지하주차장은 외기에 닿는 가장자리부터 — 외곽 띠를 따라 놓는다
    // 외곽 여유(옵셋)를 줬으면 딴 선과 띄운 선 사이, 곧 옵셋 구간 한가운데에 놓는다
    const placeEdge = (drawn: Pt[], n: number, offsetM: number) => {
      const off = offsetM > 0 ? offsetM / unitFactor(unit) : 0;
      const poly = off ? offsetPolygon(drawn, off) : drawn;
      return placeHeatersEdge(
        poly,
        Math.min(n, 80),
        off ? off / 2 : EDGE_INSET_M / unitFactor(unit),
        EDGE_SPACING_M / unitFactor(unit),
        wallClearance(poly, parsed?.segs ?? null, clear),
      );
    };
    // ── 타입별 기준 배치 ──
    // 같은 타입이면 어느 동·어느 자리에 있든 **같은 배치**여야 한다. 그래서 배치는 타입을 그려 둔 원본 자리에서
    // 한 번만 정하고(기준 배치), 다른 세대에는 그 세대가 놓인 자세(회전·뒤집기)대로 옮겨 찍는다.
    const frames = cadZones.filter((z) => frameParts?.has(z.id)).map((z) => z.geometry.polygon!);
    const canonCache = new Map<string, Pt[]>();
    const canon = (templateId: string, tpoly: Pt[], n: number, share: number) => {
      const key = `${templateId}:${n}`;
      let pts = canonCache.get(key);
      if (!pts) {
        // 원본이 동 안에 있으면 그 동 외곽이 외기 경계다(세대 사이 벽은 외기가 아니다)
        const c = labelPoint(tpoly);
        pts = place(tpoly, n, share, frames.find((f) => pointInPolygon(c, f)) ?? tpoly);
        canonCache.set(key, pts);
      }
      return pts;
    };
    for (const z of cadZones) {
      const groups: { pts: Pt[]; color: string; label: Pt }[] = [];
      const o = heaterOverlay.get(z.id);
      if (o && o.count > 0) {
        const poly = z.geometry.polygon!;
        groups.push({
          pts:
            z.kind === "parking"
              ? placeEdge(poly, o.count, z.geometry.offset ?? 0)
              : canon(z.id, poly, o.count, o.edgeShare ?? 0),
          color: o.color,
          label: labelPoint(poly),
        });
      }
      for (const part of frameParts?.get(z.id) ?? []) {
        if (part.count > 0) {
          const move = part.templatePolygon ? mapBetween(part.templatePolygon, part.polygon) : null;
          groups.push({
            pts: move
              ? canon(part.templateId, part.templatePolygon!, part.count, part.edgeShare).map(move)
              : // 모양을 맞춰 찾은 게 아닌 자리(남은 자리를 코어로 본 것)는 그 자리에서 따로 놓는다
                place(part.polygon, part.count, part.edgeShare, z.geometry.polygon!),
            color: part.heaterColor,
            label: labelPoint(part.polygon),
          });
        }
      }
      if (groups.length > 0) out.set(z.id, groups);
    }
    return out;
  }, [cadZones, heaterOverlay, frameParts, showHeaters, parsed, unit]);

  // ── 오버레이 그리기 ──
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = "600 12px 'SUIT Variable', Pretendard, system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const path = (poly: Pt[]) => {
      ctx.beginPath();
      poly.forEach((p, i) => {
        const q = toPx(p, view);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
    };

    // 도면 글자 — 읽을 만한 크기(7px 이상)이고 화면 안에 있는 것만. 한 화면에 1,500개까지
    if (parsed && parsed.textStr.length > 0) {
      const { textPos, textStr } = parsed;
      ctx.fillStyle = "rgba(190,205,228,0.85)";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      let drawn = 0;
      let lastPx = -1;
      for (let i = 0; i < textStr.length && drawn < 1500; i++) {
        const h = textPos[i * 5 + 2] * view.scale;
        if (h < 7) continue;
        const x = textPos[i * 5] * view.scale + view.offset.x;
        const y = -textPos[i * 5 + 1] * view.scale + view.offset.y;
        const reach = h * textStr[i].length;
        if (x < -reach || x > size.w + reach || y < -reach || y > size.h + reach) continue;
        const px = Math.min(Math.round(h), 200);
        if (px !== lastPx) {
          ctx.font = `500 ${px}px 'SUIT Variable', Pretendard, 'Malgun Gothic', system-ui, sans-serif`;
          lastPx = px;
        }
        const ang = textPos[i * 5 + 3];
        const align = textPos[i * 5 + 4];
        ctx.textAlign = align === 1 || align === 3 || align === 5 ? "center" : align === 2 || align === 6 ? "right" : "left";
        ctx.textBaseline = align === 3 ? "middle" : align >= 4 ? "top" : "alphabetic";
        if (Math.abs(ang) < 1e-3) ctx.fillText(textStr[i], x, y);
        else {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-ang);
          ctx.fillText(textStr[i], 0, 0);
          ctx.restore();
        }
        drawn++;
      }
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
    }

    for (const z of cadZones) {
      const poly = editing?.zoneId === z.id ? editing.polygon : z.geometry.polygon!;
      const color = zoneColor(z.color);
      const selected = z.id === selectedId;
      const parts = editing?.zoneId === z.id ? [] : (frameParts?.get(z.id) ?? []);
      const isFrame = !!z.container;
      // 외곽 여유가 있으면 바깥으로 띄운 선이 실제 보양 범위 — 그 선까지 칠하고, 딴 선은 가늘게 남긴다
      const off = z.geometry.offset ? z.geometry.offset / unitFactor(unit) : 0;
      const outer = off > 0 ? offsetPolygon(poly, off) : poly;
      path(outer);
      // 동 외곽은 틀이라 옅게 — 안의 세대가 색으로 보여야 한다
      ctx.fillStyle = hexA(color, isFrame ? (selected ? 0.12 : 0.05) : selected ? 0.3 : 0.16);
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeStyle = color;
      if (isFrame) ctx.setLineDash([10, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (off > 0) {
        path(poly);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = hexA(color, 0.75);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 동 외곽 안에서 찾은 세대·코어
      for (const part of parts) {
        const pc = zoneColor(part.color);
        path(part.polygon);
        ctx.fillStyle = hexA(pc, 0.2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = pc;
        ctx.stroke();
        const pb = polygonBounds(part.polygon);
        const tag = part.count > 0 && showHeaters ? `${part.name} · ${part.count}대` : part.name;
        ctx.font = "700 11.5px 'SUIT Variable', Pretendard, system-ui, sans-serif";
        const tw = ctx.measureText(tag).width + 14;
        if ((pb.maxX - pb.minX) * view.scale > tw + 6 && (pb.maxY - pb.minY) * view.scale > 30) {
          const c = toPx(labelPoint(part.polygon), view);
          ctx.fillStyle = "rgba(8,15,30,0.82)";
          roundRect(ctx, c.x - tw / 2, c.y - 11, tw, 22, 6);
          ctx.fill();
          ctx.strokeStyle = hexA(pc, 0.9);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(tag, c.x, c.y + 0.5);
        }
      }

      // 라벨: 이름 + 면적
      const m = editing?.zoneId === z.id ? measurePolygon(poly, unit) : z.geometry;
      const partTotal = parts.reduce((n, p) => n + p.count, 0);
      const lp =
        parts.length > 0
          ? // 안의 세대 이름표와 겹치지 않게 외곽 맨 위 가운데 바깥에 단다
            (() => {
              const bb = polygonBounds(outer);
              const q = toPx({ x: (bb.minX + bb.maxX) / 2, y: bb.maxY }, view);
              return { x: q.x, y: q.y - 28 };
            })()
          : toPx(labelPoint(poly), view);
      const count = parts.length > 0 ? partTotal : heaterOverlay?.get(z.id)?.count;
      const line1 = z.qty > 1 ? `${z.name} ×${z.qty}` : z.name;
      const line2 =
        parts.length > 0
          ? `세대·코어 ${parts.length}곳${showHeaters ? ` · ${count}대` : ""}`
          : `${dec(m.area, 1)}㎡${count && showHeaters ? ` · ${count}대` : ""}`;
      const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 18;
      const b = polygonBounds(poly);
      // 구역이 화면에서 라벨보다 작으면 라벨이 도면을 가린다 → 이름만 작게
      const roomy =
        parts.length > 0 || ((b.maxX - b.minX) * view.scale > w + 6 && (b.maxY - b.minY) * view.scale > 46);
      // 동 외곽이 이 자리(원본)를 세대로 그려 이름표를 달았으면, 타입 구역 이름표는 겹치므로 생략한다
      if (roomy && !coveredByFrame.has(z.id)) {
        ctx.fillStyle = "rgba(8,15,30,0.82)";
        roundRect(ctx, lp.x - w / 2, lp.y - 21, w, 42, 8);
        ctx.fill();
        ctx.strokeStyle = hexA(color, 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 12.5px 'SUIT Variable', Pretendard, system-ui, sans-serif";
        ctx.fillText(line1, lp.x, lp.y - 8);
        ctx.fillStyle = "#b9c7dc";
        ctx.font = "600 11.5px 'SUIT Variable', Pretendard, system-ui, sans-serif";
        ctx.fillText(line2, lp.x, lp.y + 9);
      }

      if (selected && tool === "select") {
        for (const p of poly) {
          const q = toPx(p, view);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(q.x - HANDLE_PX / 2, q.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // 그리는 중
    if ((tool === "polygon" || tool === "rect") && cursor) {
      const cw = cursor.world;
      const pts = tool === "rect" && draft.length === 1 ? rectPolygon(draft[0], cw) : [...draft, cw];
      if (draft.length > 0) {
        ctx.beginPath();
        pts.forEach((p, i) => {
          const q = toPx(p, view);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        if (pts.length >= 3) ctx.closePath();
        ctx.fillStyle = "rgba(56,189,248,0.14)";
        if (pts.length >= 3) ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.75;
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of draft) {
          const q = toPx(p, view);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#38bdf8";
          ctx.fill();
        }
        // 마지막 변 길이 + 지금까지의 면적
        const last = draft[draft.length - 1];
        const k = unit === "mm" ? 0.001 : 1;
        const len = Math.hypot(cw.x - last.x, cw.y - last.y) * k;
        const tip =
          pts.length >= 3
            ? `${dec(len, 2)}m · ${dec(measurePolygon(pts, unit).area, 1)}㎡`
            : `${dec(len, 2)}m`;
        const q = toPx(cw, view);
        ctx.font = "700 12px 'SUIT Variable', Pretendard, system-ui, sans-serif";
        const tw = ctx.measureText(tip).width + 14;
        ctx.fillStyle = "rgba(8,15,30,0.9)";
        roundRect(ctx, q.x + 14, q.y + 12, tw, 24, 6);
        ctx.fill();
        ctx.fillStyle = "#e0f2fe";
        ctx.textAlign = "left";
        ctx.fillText(tip, q.x + 21, q.y + 24);
      }
      // 스냅 표시 / 십자선
      const q = toPx(cw, view);
      if (cursor.snapped) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.strokeRect(q.x - 6, q.y - 6, 12, 12);
      } else {
        ctx.strokeStyle = "rgba(226,232,240,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(q.x - 9, q.y);
        ctx.lineTo(q.x + 9, q.y);
        ctx.moveTo(q.x, q.y - 9);
        ctx.lineTo(q.x, q.y + 9);
        ctx.stroke();
      }
    }
  }, [size, view, parsed, cadZones, selectedId, draft, cursor, tool, editing, heaterOverlay, frameParts, showHeaters, unit]);

  // ── 열원 배치점 (반짝임) ──
  // 구역·글자 캔버스와 따로(그 위에) 둔다: 매 프레임 다시 그리는 건 점 몇십 개뿐이라 도면이 커도 가볍다.
  // React 상태를 거치지 않고 ref 만 읽어 그리므로 화면 전체가 다시 렌더되지 않는다.
  const marksCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marksDataRef = useRef<{ pts: Pt[]; color: string; label: Pt }[]>([]);
  useEffect(() => {
    const list: { pts: Pt[]; color: string; label: Pt }[] = [];
    for (const z of cadZones) {
      if (editing?.zoneId === z.id) continue; // 꼭짓점을 끄는 동안은 자리가 바뀌는 중이라 숨긴다
      for (const g of heaterMarks.get(z.id) ?? []) if (g.pts.length > 0) list.push(g);
    }
    marksDataRef.current = list;
  }, [cadZones, heaterMarks, editing]);

  const hasMarks = heaterMarks.size > 0;
  useEffect(() => {
    const canvas = marksCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    if (!hasMarks) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    // 움직임을 줄이도록 설정한 사용자에게는 반짝임 없이 빛나는 점만 보여준다
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    const draw = (now: number) => {
      const v = viewRef.current;
      const t = still ? 0 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      let i = 0;
      for (const { pts, color, label } of marksDataRef.current) {
        const lx = label.x * v.scale + v.offset.x;
        const ly = -label.y * v.scale + v.offset.y;
        for (const p of pts) {
          i++;
          const x = p.x * v.scale + v.offset.x;
          const y = -p.y * v.scale + v.offset.y;
          if (x < -40 || y < -40 || x > size.w + 40 || y > size.h + 40) continue;
          // 구역 이름표 자리에 겹치는 점은 그리지 않는다(이 캔버스가 이름표보다 위라서 글자를 가린다)
          if (Math.abs(x - lx) < 66 && Math.abs(y - ly) < 27) continue;
          // 꺼졌다 켜졌다 — 약 1.8초 주기. 모든 점이 같은 박자로 한꺼번에 켜지고 꺼진다.
          // 켜진 쪽에 조금 더 오래 머물게(sin 을 한 번 더 다듬어) 불이 들어왔다 스르르 꺼지는 느낌을 낸다
          const wave = 0.5 + 0.5 * Math.sin(t * 3.5);
          const on = still ? 1 : wave * wave * (3 - 2 * wave);

          // 켜질 때만 번지는 빛
          if (on > 0.02) {
            const glowR = 9 + on * 7;
            const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
            g.addColorStop(0, hexA(color, 0.6 * on));
            g.addColorStop(0.5, hexA(color, 0.22 * on));
            g.addColorStop(1, hexA(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, glowR, 0, Math.PI * 2);
            ctx.fill();
          }

          // 심지: 꺼졌을 때도 자리는 보이게 어두운 점을 남긴다
          ctx.globalAlpha = 0.28 + 0.72 * on;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
          ctx.globalAlpha = on;
          ctx.beginPath();
          ctx.arc(x - 1.2, y - 1.3, 1.7, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, hasMarks]);

  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const drawDisabled = !parsed;
  const noLoops = !parsed || parsed.stats.loops === 0;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-slate-900/10"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onLoadFile(f);
      }}
    >
      <LiteDxfCanvas dxf={parsed} scale={view.scale} offset={view.offset} />
      <canvas
        ref={overlayRef}
        className={cn(
          "absolute inset-0 block h-full w-full touch-none",
          tool === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => {
          if (tool === "polygon" && draft.length >= 3) finishDraft(draft);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={marksCanvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />

      <input
        ref={fileRef}
        type="file"
        accept=".dxf,.dwg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadFile(f);
          e.target.value = "";
        }}
      />

      {/* 도구 막대 */}
      {hasCanvasContent && (
        <div className="absolute left-3 top-3 flex items-center gap-1 rounded-xl border border-white/10 bg-[#111b30]/90 p-1 shadow-xl backdrop-blur">
          {TOOLS.map((t) => {
            const disabled = t.id !== "select" && drawDisabled;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled || (t.id === "pick" && noLoops)}
                title={
                  t.id === "pick" && parsed && noLoops
                    ? "이 도면에는 닫힌 폴리라인이 없습니다"
                    : t.hint
                }
                onClick={() => {
                  setDraft([]);
                  setTool(t.id);
                }}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                  tool === t.id
                    ? "bg-[#1f7ae0] text-white shadow"
                    : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            type="button"
            title="화면에 맞춤"
            onClick={fit}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <Maximize className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="적용 열원 배치 표시"
            onClick={() => setShowHeaters((v) => !v)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              showHeaters ? "bg-white/15 text-orange-300" : "text-slate-400 hover:bg-white/10",
            )}
          >
            <Flame className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 도면 정보 */}
      {hasCanvasContent && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-white/10 bg-[#111b30]/90 p-1 shadow-xl backdrop-blur">
          {drawing && parsed && (
            <>
              <span
                className="max-w-[220px] truncate px-2 text-[11.5px] font-medium text-slate-300"
                title={`${drawing.fileName} · 선 ${parsed.stats.segments.toLocaleString("ko-KR")}개`}
              >
                {drawing.fileName}
              </span>
              <div className="flex rounded-lg bg-black/30 p-0.5" title="도면 1단위의 길이. 면적이 이상하면 바꿔 보세요">
                {(["mm", "m"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => onUnitChange(u)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-bold",
                      unit === u ? "bg-white text-slate-900" : "text-slate-400 hover:text-white",
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {parsed ? "도면 교체" : "도면 불러오기"}
          </button>
          {parsed && (
            <button
              type="button"
              title="도면 닫기 (구역은 남습니다)"
              onClick={onClearDrawing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 상태줄 */}
      {hasCanvasContent && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
          <div className="max-w-[70%] rounded-lg border border-white/10 bg-[#111b30]/85 px-3 py-1.5 text-[11.5px] leading-relaxed text-slate-300 backdrop-blur">
            <b className="mr-1.5 text-white">{activeTool.label}</b>
            {outlineMiss
              ? "건물 테두리를 따지 못했습니다. 건물 안쪽(방 안)을 눌렀는지 확인하고, 안 되면 「다각형」으로 그려 주세요."
              : pickMiss
              ? "여기에는 닫힌 선이 없습니다. 「다각형」으로 꼭짓점을 찍어 그려 주세요."
              : !parsed && tool === "select"
                ? "저장된 구역만 표시 중입니다. 새 구역을 그리려면 도면을 불러오세요."
                : activeTool.hint}
          </div>
          {cursor && (
            <div className="rounded-lg border border-white/10 bg-[#111b30]/85 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-400 backdrop-blur">
              {dec(cursor.world.x, 0)}, {dec(cursor.world.y, 0)}
            </div>
          )}
        </div>
      )}

      {/* 빈 화면 */}
      {!hasCanvasContent && !loading && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(120,150,200,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,200,0.12) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "relative flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors",
              dragOver
                ? "border-sky-400 bg-sky-400/10"
                : "border-slate-600/70 bg-[#111b30]/70 hover:border-sky-500/70 hover:bg-[#13203a]",
            )}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2a8fe6] to-[#004791] text-white shadow-lg shadow-blue-900/40">
              <Upload className="h-6 w-6" />
            </span>
            <span className="mt-5 text-[16px] font-bold text-white">{sheetLabel} 평면 DXF 불러오기</span>
            <span className="mt-2 text-[13px] leading-relaxed text-slate-400">
              파일을 끌어다 놓거나 눌러서 선택하세요.
              <br />
              도면 위에 {sheetLabel} 구역을 그리면 면적·둘레가 자동으로 들어갑니다.
            </span>
            <span className="mt-4 text-[11.5px] text-slate-500">
              단위세대·코어·주차장은 도면을 따로 올립니다 · 도면이 없으면 왼쪽 「치수로 추가」
            </span>
          </button>
        </div>
      )}

      {dragOver && hasCanvasContent && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-sky-500/15 ring-2 ring-inset ring-sky-400">
          <span className="rounded-xl bg-[#111b30] px-5 py-3 text-[14px] font-bold text-white">여기에 놓아 도면 교체</span>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b1220]/80 backdrop-blur-sm">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-600 border-t-sky-400" />
          <span className="text-[13px] font-semibold text-slate-200">도면을 읽는 중…</span>
        </div>
      )}
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
