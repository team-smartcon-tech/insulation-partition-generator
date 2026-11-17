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
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { zoneColor } from "../defaults";
import type { LiteDxf } from "../engine/dxfLite";
import {
  labelPoint,
  measurePolygon,
  placeHeaters,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  rectPolygon,
} from "../engine/geometry";
import type { DrawingMeta, Pt, Zone } from "../types";
import LiteDxfCanvas from "./LiteDxfCanvas";
import { dec } from "./ui";

type Tool = "select" | "polygon" | "rect" | "pick";

const TOOLS: { id: Tool; label: string; hint: string; icon: typeof Square }[] = [
  { id: "select", label: "선택", hint: "구역을 눌러 선택 · 꼭짓점을 끌어 수정 · 끌면 화면 이동", icon: MousePointer2 },
  { id: "polygon", label: "다각형", hint: "꼭짓점을 차례로 클릭 · 첫 점 클릭/Enter/더블클릭으로 닫기 · Shift 수평·수직 · Backspace 한 점 취소", icon: Pentagon },
  { id: "rect", label: "사각형", hint: "대각선 두 점을 클릭", icon: Square },
  { id: "pick", label: "닫힌 선 따기", hint: "도면의 닫힌 폴리라인 안쪽을 클릭하면 그 선이 구역이 됩니다", icon: ScanLine },
];

const SNAP_PX = 11;
const HANDLE_PX = 8;

/** zoneId → 그 구역에 적용한 열원의 대수(구역 1개당)와 색 */
export type HeaterOverlay = Map<string, { count: number; color: string }>;

export default function ZoneCanvas({
  sheetLabel,
  parsed,
  drawing,
  loading,
  zones,
  selectedId,
  heaterOverlay,
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
  onSelect: (id: string | null) => void;
  onCreate: (polygon: Pt[]) => void;
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
  const heaterMarks = useMemo(() => {
    const out = new Map<string, Pt[]>();
    if (!heaterOverlay || !showHeaters) return out;
    for (const z of cadZones) {
      const n = Math.min(heaterOverlay.get(z.id)?.count ?? 0, 80);
      if (n > 0) out.set(z.id, placeHeaters(z.geometry.polygon!, n));
    }
    return out;
  }, [cadZones, heaterOverlay, showHeaters]);

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
      path(poly);
      ctx.fillStyle = hexA(color, selected ? 0.3 : 0.16);
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();

      // 라벨: 이름 + 면적
      const m = editing?.zoneId === z.id ? measurePolygon(poly, unit) : z.geometry;
      const lp = toPx(labelPoint(poly), view);
      const count = heaterOverlay?.get(z.id)?.count;
      const line1 = z.qty > 1 ? `${z.name} ×${z.qty}` : z.name;
      const line2 = `${dec(m.area, 1)}㎡${count && showHeaters ? ` · ${count}대` : ""}`;
      const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 18;
      const b = polygonBounds(poly);
      // 구역이 화면에서 라벨보다 작으면 라벨이 도면을 가린다 → 이름만 작게
      const roomy = (b.maxX - b.minX) * view.scale > w + 6 && (b.maxY - b.minY) * view.scale > 46;
      if (roomy) {
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
  }, [size, view, parsed, cadZones, selectedId, draft, cursor, tool, editing, heaterOverlay, showHeaters, unit]);

  // ── 열원 배치점 (반짝임) ──
  // 구역·글자 캔버스와 따로(그 위에) 둔다: 매 프레임 다시 그리는 건 점 몇십 개뿐이라 도면이 커도 가볍다.
  // React 상태를 거치지 않고 ref 만 읽어 그리므로 화면 전체가 다시 렌더되지 않는다.
  const marksCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marksDataRef = useRef<{ pts: Pt[]; color: string; label: Pt }[]>([]);
  useEffect(() => {
    const list: { pts: Pt[]; color: string; label: Pt }[] = [];
    for (const z of cadZones) {
      if (editing?.zoneId === z.id) continue; // 꼭짓점을 끄는 동안은 자리가 바뀌는 중이라 숨긴다
      const pts = heaterMarks.get(z.id);
      if (pts && pts.length > 0) {
        list.push({
          pts,
          color: heaterOverlay?.get(z.id)?.color ?? "#e2622b",
          label: labelPoint(z.geometry.polygon!),
        });
      }
    }
    marksDataRef.current = list;
  }, [cadZones, heaterMarks, heaterOverlay, editing]);

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
            {pickMiss
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
