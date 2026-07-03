/**
 * ElevationGeneratorPage — 입면도 생성기 (PoC 3단계 · 다중 체인)
 *
 * 변경점 (vs PoC 2단계):
 *   - 외벽 트레이싱을 "한 줄"이 아니라 여러 개의 독립 체인으로 보유
 *   - 각 체인이 별도의 전개 입면이 됨 (입면 1, 입면 2, …)
 *   - 각 오프닝은 자신이 속한 체인(wallId)에 묶임
 *   - DXF/SVG 익스포트도 여러 입면을 위아래로 배치
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileWarning,
  Layers,
  LayoutGrid,
  Ruler,
  Info,
  MousePointer2,
  Pencil,
  Square,
  Eye,
  EyeOff,
  Trash2,
  X,
  HelpCircle,
  CornerDownLeft,
  Wand2,
  Download,
  Plus,
  Check,
  FileSpreadsheet,
  ChevronDown,
  FilePlus2,
  Save,
  History,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  developPly,
  developPlyMinBoards,
  summarizeBoards,
  numberBoards,
  packCutBoards,
  type DevelopPlyParams,
  type PlyDevelopment,
} from "./utils/insulation";
import { cn } from "@/lib/utils";
import DxfParser from "dxf-parser";
import {
  buildElevationDxfMulti,
  buildElevationSvgMulti,
  downloadText,
  type InsulationExport,
  type ElevationExportInput,
} from "./utils/exporter";
import type {
  ElevTypeMatrix,
  ElevBuildingDef,
  ElevTypeDef,
  ElevUnitCounts,
  ElevState,
} from "./types";
import {
  useElevProjects,
  useElevProject,
  useCreateElevProject,
  useSaveElevRevision,
  useDeleteElevRevision,
  useDeleteElevProject,
} from "./hooks";
import { getElevRevision } from "./api";
import OutputPanel from "./components/OutputPanel";
import type { WallSummaryInput } from "./utils/elevationAggregate";
import { toast } from "sonner";
import {
  Point2D,
  dist,
  worldToSAlong,
  sAlongToWorld,
  cumWallLengths,
  offsetPolylineInward,
  extractSizeFromText,
} from "./utils/geometry";

// ─────────────────────────── 타입 ───────────────────────────

type NormalizedEntity =
  | { kind: "line"; layer: string; color: string; a: Point2D; b: Point2D }
  | {
      kind: "polyline";
      layer: string;
      color: string;
      points: Point2D[];
      closed: boolean;
    }
  | {
      kind: "circle";
      layer: string;
      color: string;
      center: Point2D;
      radius: number;
    }
  | {
      kind: "arc";
      layer: string;
      color: string;
      center: Point2D;
      radius: number;
      start: number;
      end: number;
    }
  | { kind: "text"; layer: string; color: string; pos: Point2D; text: string };

interface ParsedDxf {
  entities: NormalizedEntity[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  layers: string[];
  warnings: string[];
  snapPoints: Point2D[];
}

type OpeningKind = "window" | "door" | "opening";

interface Opening {
  id: string;
  /** 소속 입면(체인) id */
  wallId: string;
  kind: OpeningKind;
  /** 해당 체인의 둘레 위 중심 위치 (mm) */
  sAlong: number;
  width: number;
  height: number;
  sill: number;
  label?: string;
}

interface OpeningPreset {
  id: string;
  label: string;
  kind: OpeningKind;
  width: number;
  height: number;
  sill: number;
}

/** 외기 노출 타입 → 단열 두께가 달라진다 */
type ExposureType = "direct" | "indirect" | "custom";

/** 세그먼트(변)별 단열 스펙 — 구조선 1개에서 1P/2P 를 자동 생성한다 */
interface SegInsul {
  /** 1겹 두께(mm) — 구조면 위 */
  ply1: number;
  /** 2겹 두께(mm) — 1겹 위 */
  ply2: number;
  /** 노출 타입 (프리셋 매칭용) */
  exposure: ExposureType;
  /**
   * 배치 안함 — 이 변(세그먼트)은 선(전개 기하)은 이어지되 단열재를 배치/집계하지 않는다.
   * (벽이 끊긴 구간·개구부 후퇴부 등: 이어지게 그리되 물량엔 미포함)
   */
  skip?: boolean;
}

/** 노출 프리셋 (편집 가능) */
interface ExposurePreset {
  exposure: ExposureType;
  label: string;
  ply1: number;
  ply2: number;
}

/** 기본 노출 프리셋 (라벨·두께 모두 편집 가능). 총두께 = ply1+ply2 로 자동 표시. */
const DEFAULT_EXPOSURE_PRESETS: ExposurePreset[] = [
  { exposure: "direct", label: "직접외기", ply1: 90, ply2: 50 },
  { exposure: "indirect", label: "간접외기", ply1: 50, ply2: 50 },
];

/** 프리셋/노출 표시 라벨 — "직접외기 (140T)" 처럼 총두께 자동 계산 */
const presetLabel = (p: ExposurePreset) => `${p.label} (${p.ply1 + p.ply2}T)`;

/** 노출타입별 색 — 평면/목록에서 직접·간접외기 구분 */
const EXPOSURE_COLOR: Record<ExposureType, string> = {
  direct: "#f97316", // 주황 — 직접외기
  indirect: "#3b82f6", // 파랑 — 간접외기
  custom: "#94a3b8", // 회색 — 커스텀
};

interface WallChain {
  id: string;
  name: string;
  points: Point2D[];
  closed: boolean;
  /** 입면별 층고 (mm). 기본값은 글로벌 floorHeight 가 들어감 */
  floorHeight: number;
  /**
   * 세그먼트(변)별 단열 스펙. 길이 = points.length-1.
   * 구조선 1개에서 세그먼트별 (1P,2P) 두께로 1P·2P 전개를 자동 생성한다.
   * 미지정/길이 불일치면 defaultSegInsul(=프리셋 direct)로 폴백한다.
   */
  segInsul?: SegInsul[];
  /**
   * 이 입면이 나타내는 '타입' id (동·타입 매트릭스의 types[].id).
   * 산출서 물량은 이 타입의 대표 입면 1세대 물량 × 매트릭스 세대수.
   */
  typeId?: string;
  /**
   * (선택) 특정 '동' id. 지정하면 그 동+타입 셀은 이 입면 물량으로 덮어쓴다.
   * 미지정이면 그 타입의 '대표(동 공용)' 입면으로 쓰인다.
   */
  buildingId?: string;
  /** @deprecated 레거시 — 작업 동 이름. 로드 시 매트릭스 마이그레이션에만 사용. */
  building?: string;
  /** @deprecated 레거시 — 단위세대 타입 이름. 로드 시 매트릭스 마이그레이션에만 사용. */
  core?: string;
  /** @deprecated 레거시 — 입면별 세대수. 로드 시 매트릭스 마이그레이션에만 사용. */
  units?: { low?: number; roof?: number; base?: number };
  /**
   * 2P(바깥 겹) 선 — 1P(points)와 같은 입면 안에서 별도로 그린(또는 자동 오프셋한) 선.
   * 있으면 이 입면은 1P·2P 두 장을 만들고 물량을 합산한다. 창은 1P·2P 공유(자동 대응).
   */
  points2P?: Point2D[];
  /**
   * 단열재 시공면(외부)이 폴리라인 진행방향 기준 어느 쪽인가. "left"(기본) | "right".
   * 닫힌 폴리곤은 면적(winding)으로 자동 판정되지만, 열린 폴리라인(측벽 등)은
   * 트레이싱 방향에 따라 2P 오프셋/코너 인셋 방향이 뒤집히므로 이 값으로 반전한다.
   */
  exteriorSide?: "left" | "right";
  /** @deprecated 레거시(구모델) 입면별 단일 두께. 로드 시 마이그레이션에만 사용. */
  thickness?: number;
  /** @deprecated 레거시 수동 2P 결로 기준 id. */
  refChainId?: string;
}

type Mode = "view" | "trace" | "place" | "two-point" | "auto" | "seg";

/** 수직 조인트 1개 — x 위치 + 높이 구간(관통 판정용) */
type JointSeg = { x: number; y0: number; y1: number };

// ────────────────────── 동·타입 매트릭스 헬퍼 ──────────────────────
const EMPTY_MATRIX: ElevTypeMatrix = { buildings: [], types: [], cells: {} };
/** (동,타입) 셀 키 */
const cellKey = (buildingId: string, typeId: string) => `${buildingId}::${typeId}`;
let _idSeq = 0;
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${_idSeq++}`;

/**
 * 구 REV(typeMatrix 없는 state) 로드 시 레거시 필드(building/core/units)에서
 * 동·타입 매트릭스를 복원하고, 각 입면에 붙일 typeId/buildingId 태그를 만든다.
 */
function migrateLegacyMatrix(walls: WallChain[]): {
  matrix: ElevTypeMatrix;
  tagById: Record<string, { typeId?: string; buildingId?: string }>;
} {
  const buildings: ElevBuildingDef[] = [];
  const types: ElevTypeDef[] = [];
  const bIdByName = new Map<string, string>();
  const tIdByName = new Map<string, string>();
  const cells: Record<string, ElevUnitCounts> = {};
  const tagById: Record<string, { typeId?: string; buildingId?: string }> = {};
  for (const w of walls) {
    const bName = (w.building ?? "").trim();
    const tName = (w.core ?? "").trim() || (w.name ?? "").trim();
    let bId: string | undefined;
    let tId: string | undefined;
    if (tName) {
      tId = tIdByName.get(tName);
      if (!tId) {
        tId = genId("t");
        tIdByName.set(tName, tId);
        types.push({ id: tId, name: tName });
      }
    }
    if (bName) {
      bId = bIdByName.get(bName);
      if (!bId) {
        bId = genId("b");
        bIdByName.set(bName, bId);
        buildings.push({ id: bId, name: bName });
      }
    }
    if (bId && tId) cells[cellKey(bId, tId)] = { ...(w.units ?? {}) };
    tagById[w.id] = { typeId: tId, buildingId: bId };
  }
  return { matrix: { buildings, types, cells }, tagById };
}

/** "401~405" / "401동~405동" → ["401동","402동",...] 동 이름 배열 */
function expandBuildingRange(input: string): string[] {
  const m = input.match(/(\d+)\s*(?:동)?\s*~\s*(\d+)\s*(?:동)?/);
  if (!m) return [];
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  if (end - start > 200) return []; // 폭주 방지
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push(`${n}동`);
  return out;
}

// ────────────────────── DXF 색상 ──────────────────────
const ACI_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#facc15",
  3: "#22c55e",
  4: "#06b6d4",
  5: "#3b82f6",
  6: "#a855f7",
  7: "#e5e7eb",
  8: "#94a3b8",
  9: "#cbd5e1",
};
function aciToHex(aci: number | undefined, fallback = "#cbd5e1"): string {
  if (!aci || aci === 256) return fallback;
  return ACI_COLORS[aci] ?? fallback;
}

// 체인 색상 팔레트 (입면 1, 2, 3…)
const CHAIN_COLORS = [
  "#fbbf24", // amber
  "#34d399", // emerald
  "#60a5fa", // blue
  "#f472b6", // pink
  "#a78bfa", // violet
  "#fb923c", // orange
];

// ────────────────────── DXF 정규화 ──────────────────────
function normalizeDxf(raw: any): ParsedDxf {
  const entities: NormalizedEntity[] = [];
  const warnings: string[] = [];
  const layerSet = new Set<string>();
  const snapPoints: Point2D[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const addBound = (p: Point2D) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  const list = Array.isArray(raw?.entities) ? raw.entities : [];
  for (const e of list) {
    const layer = e.layer || "0";
    layerSet.add(layer);
    const color = aciToHex(e.color);
    switch (e.type) {
      case "LINE": {
        const a = { x: e.vertices?.[0]?.x, y: e.vertices?.[0]?.y };
        const b = { x: e.vertices?.[1]?.x, y: e.vertices?.[1]?.y };
        if ([a.x, a.y, b.x, b.y].every(Number.isFinite)) {
          addBound(a);
          addBound(b);
          // 끝점 + 중점(개구부 중앙 등 정밀 배치 보조)
          snapPoints.push(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          entities.push({ kind: "line", layer, color, a, b });
        }
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const pts: Point2D[] = (e.vertices ?? [])
          .map((v: any) => ({ x: v.x, y: v.y }))
          .filter((p: Point2D) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length >= 2) {
          pts.forEach((p, i) => {
            addBound(p);
            snapPoints.push(p);
            // 직전 정점과의 세그먼트 중점도 스냅 후보로 추가
            if (i > 0) {
              const prev = pts[i - 1];
              snapPoints.push({
                x: (prev.x + p.x) / 2,
                y: (prev.y + p.y) / 2,
              });
            }
          });
          entities.push({
            kind: "polyline",
            layer,
            color,
            points: pts,
            closed: !!e.shape,
          });
        }
        break;
      }
      case "CIRCLE": {
        const c = { x: e.center?.x, y: e.center?.y };
        const r = e.radius;
        if (Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(r)) {
          addBound({ x: c.x - r, y: c.y - r });
          addBound({ x: c.x + r, y: c.y + r });
          entities.push({ kind: "circle", layer, color, center: c, radius: r });
        }
        break;
      }
      case "ARC": {
        const c = { x: e.center?.x, y: e.center?.y };
        const r = e.radius;
        const start = ((e.startAngle ?? 0) * Math.PI) / 180;
        const end = ((e.endAngle ?? 0) * Math.PI) / 180;
        if (Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(r)) {
          addBound({ x: c.x - r, y: c.y - r });
          addBound({ x: c.x + r, y: c.y + r });
          entities.push({
            kind: "arc",
            layer,
            color,
            center: c,
            radius: r,
            start,
            end,
          });
        }
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const pos = {
          x: e.startPoint?.x ?? e.position?.x,
          y: e.startPoint?.y ?? e.position?.y,
        };
        if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          addBound(pos);
          entities.push({
            kind: "text",
            layer,
            color,
            pos,
            text: String(e.text ?? ""),
          });
        }
        break;
      }
      default:
        break;
    }
  }
  if (!Number.isFinite(minX)) {
    warnings.push("도면에 표시 가능한 엔티티가 없습니다.");
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  return {
    entities,
    bounds: { minX, minY, maxX, maxY },
    layers: Array.from(layerSet).sort(),
    warnings,
    snapPoints,
  };
}

// ────────────────────── 프리셋 ──────────────────────
const DEFAULT_PRESETS: OpeningPreset[] = [
  { id: "p-living", label: "거실창", kind: "window", width: 1800, height: 1500, sill: 900 },
  { id: "p-room", label: "방창", kind: "window", width: 1200, height: 1500, sill: 900 },
  { id: "p-balcony", label: "베란다 전창", kind: "window", width: 2400, height: 2100, sill: 200 },
  { id: "p-bath", label: "욕실창", kind: "window", width: 600, height: 900, sill: 1500 },
  { id: "p-door", label: "현관문", kind: "door", width: 900, height: 2100, sill: 0 },
];

// ────────────────────── 헬퍼 ──────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * 절단판 상세 보기용 — 한 온장(L×H)에 조각들을 길로틴 재단 배치.
 * packCutBoards 와 동일 규칙(면적 내림차순 + best-fit + 오른쪽/위 분할)이라
 * 같은 그룹 조각들은 항상 한 판 안에 들어간다.
 */
function layoutCutPieces(
  pieces: { w: number; h: number; key: string }[],
  L: number,
  H: number
): { x: number; y: number; w: number; h: number; key: string }[] {
  const EPS = 1e-6;
  type FreeRect = { x: number; y: number; w: number; h: number };
  const free: FreeRect[] = [{ x: 0, y: 0, w: L, h: H }];
  const out: { x: number; y: number; w: number; h: number; key: string }[] = [];
  const sorted = [...pieces].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const p of sorted) {
    let best = -1;
    let bestArea = Infinity;
    for (let k = 0; k < free.length; k++) {
      const f = free[k];
      if (f.w >= p.w - EPS && f.h >= p.h - EPS && f.w * f.h < bestArea) {
        bestArea = f.w * f.h;
        best = k;
      }
    }
    if (best < 0) {
      out.push({ x: 0, y: 0, w: p.w, h: p.h, key: p.key }); // 이론상 도달 안 함
      continue;
    }
    const f = free[best];
    free.splice(best, 1);
    out.push({ x: f.x, y: f.y, w: p.w, h: p.h, key: p.key });
    const right = { x: f.x + p.w, y: f.y, w: f.w - p.w, h: p.h };
    const top = { x: f.x, y: f.y + p.h, w: f.w, h: f.h - p.h };
    if (right.w > EPS && right.h > EPS) free.push(right);
    if (top.w > EPS && top.h > EPS) free.push(top);
  }
  return out;
}

const KIND_COLOR: Record<OpeningKind, string> = {
  window: "#38bdf8",
  door: "#f472b6",
  opening: "#a3e635",
};
const KIND_LABEL: Record<OpeningKind, string> = {
  window: "창문",
  door: "문",
  opening: "개구부",
};

function chainColor(index: number): string {
  return CHAIN_COLORS[index % CHAIN_COLORS.length];
}

/** 오프닝 중심 sAlong 을 [width/2, perimeter - width/2] 안으로 clamp */
function clampS(s: number, width: number, perimeter: number): number {
  if (perimeter <= 0) return s;
  const half = width / 2;
  if (perimeter <= width) return perimeter / 2;
  return Math.max(half, Math.min(perimeter - half, s));
}

// ─────────────────────────── 페이지 ───────────────────────────

export default function ElevationGeneratorPage() {
  // ── 파일/파싱 ──
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedDxf | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [isParsing, setIsParsing] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showText, setShowText] = useState(true);

  // ── 평면 viewport ──
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point2D>({ x: 0, y: 0 });

  // ── 다중 체인 ──
  const [walls, setWalls] = useState<WallChain[]>([]);
  /** 현재 트레이싱 중인 임시 폴리라인 (확정 전) */
  const [draft, setDraft] = useState<Point2D[]>([]);
  /** 활성 체인 id (오프닝 배치 / 선택 표시) */
  const [activeWallId, setActiveWallId] = useState<string | null>(null);

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    DEFAULT_PRESETS[0].id
  );
  // 오프닝 프리셋(폭·높이·SILL) — 사용자가 직접 수정 가능.
  const [presets, setPresets] = useState<OpeningPreset[]>(DEFAULT_PRESETS);
  const updatePreset = useCallback(
    (id: string, patch: Partial<OpeningPreset>) => {
      setPresets(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
    },
    []
  );
  const [twoPointAnchor, setTwoPointAnchor] = useState<{
    wallId: string;
    s: number;
  } | null>(null);
  const [defaultFloorHeight, setDefaultFloorHeight] = useState<number>(2900);
  const [snapTolerancePx] = useState(18);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [autoExtract, setAutoExtract] = useState(true);
  /** 자동 인식 배치 시 적용할 기본 sill (mm) */
  const [defaultSill, setDefaultSill] = useState<number>(900);

  const [mode, setMode] = useState<Mode>("view");

  // ── 캔버스 탭 (평면도 / 전개 입면) — 한 번에 하나만 전폭으로 표시 ──
  const [canvasTab, setCanvasTab] = useState<"plan" | "elev">("plan");
  const [elevListOpen, setElevListOpen] = useState(false); // 입면 목록 팝업(모달)
  const [helpOpen, setHelpOpen] = useState(false); // 사용법 팝업(모달)
  // 첫 방문 시 사용법 자동 표시 (닫으면 다시 자동으로 뜨지 않음 — ? 버튼으로 재열람)
  useEffect(() => {
    if (!localStorage.getItem("ipg-help-seen")) setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => {
    localStorage.setItem("ipg-help-seen", "1");
    setHelpOpen(false);
  }, []);

  // ── 단열재 나누기도 (추가 기능 — OFF 면 기존 동작과 동일) ──
  // 수동 방식: 트레이싱한 각 선(체인)을 자기 길이 그대로 보드로 분할.
  // 2P는 70 옵셋한 선을 별도 체인으로 직접 그린다(자동 옵셋 없음).
  const [insulOn, setInsulOn] = useState(false);
  const [boardLength, setBoardLength] = useState(1000); // 보드 길이(가로)
  const [boardHeight, setBoardHeight] = useState(600); // 보드 높이(세로)
  const [boardThickness, setBoardThickness] = useState(70); // 한 겹 두께(참고용)
  const [optimizeSP, setOptimizeSP] = useState(false); // SP 최적배치(최소물량)
  // 배치 정책 — 물량 최소(자투리 균등분할) vs 시공성 우선(온장 유지·자투리 버림)
  const [placement, setPlacement] = useState<"min-waste" | "constructability">(
    "min-waste"
  );
  const [discardWidth, setDiscardWidth] = useState(200); // 시공성 우선: 버림 기준 폭(mm)
  const [constructMinW, setConstructMinW] = useState(0); // 시공성 우선: 최소 조각 폭(재분할, 0=off)
  const [minJointGap, setMinJointGap] = useState(250); // 1P/2P 조인트 최소이격(결로방지)
  const [minPieceWidth, setMinPieceWidth] = useState(100); // 최소 조각 폭(시공성)
  // 노출 프리셋(직접/간접외기 → 두께) — 편집 가능
  const [exposurePresets, setExposurePresets] = useState<ExposurePreset[]>(
    DEFAULT_EXPOSURE_PRESETS
  );
  // 동·타입·세대수 매트릭스 (프로젝트 단위, 현장식 산출서 구동)
  const [typeMatrix, setTypeMatrix] = useState<ElevTypeMatrix>(EMPTY_MATRIX);
  // ── 매트릭스 편집 헬퍼 ──
  const addBuildingsFromRange = (input: string) => {
    const names = expandBuildingRange(input);
    if (names.length === 0) {
      toast.error("범위 형식이 올바르지 않습니다. 예: 401~405");
      return;
    }
    setTypeMatrix(m => {
      const existing = new Set(m.buildings.map(b => b.name));
      const add = names
        .filter(n => !existing.has(n))
        .map(n => ({ id: genId("b"), name: n }));
      return { ...m, buildings: [...m.buildings, ...add] };
    });
  };
  const addBuilding = () =>
    setTypeMatrix(m => ({
      ...m,
      buildings: [...m.buildings, { id: genId("b"), name: `${m.buildings.length + 1}동` }],
    }));
  const renameBuilding = (id: string, name: string) =>
    setTypeMatrix(m => ({
      ...m,
      buildings: m.buildings.map(b => (b.id === id ? { ...b, name } : b)),
    }));
  const removeBuilding = (id: string) => {
    setTypeMatrix(m => {
      const cells = { ...m.cells };
      for (const k of Object.keys(cells))
        if (k.startsWith(`${id}::`)) delete cells[k];
      return { ...m, buildings: m.buildings.filter(b => b.id !== id), cells };
    });
    setWalls(ws =>
      ws.map(w => (w.buildingId === id ? { ...w, buildingId: undefined } : w))
    );
  };
  const addType = () =>
    setTypeMatrix(m => ({
      ...m,
      types: [...m.types, { id: genId("t"), name: `타입${m.types.length + 1}` }],
    }));
  const renameType = (id: string, name: string) =>
    setTypeMatrix(m => ({
      ...m,
      types: m.types.map(t => (t.id === id ? { ...t, name } : t)),
    }));
  const removeType = (id: string) => {
    setTypeMatrix(m => {
      const cells = { ...m.cells };
      for (const k of Object.keys(cells))
        if (k.endsWith(`::${id}`)) delete cells[k];
      return { ...m, types: m.types.filter(t => t.id !== id), cells };
    });
    setWalls(ws => ws.map(w => (w.typeId === id ? { ...w, typeId: undefined } : w)));
  };
  const toggleCell = (bId: string, tId: string) =>
    setTypeMatrix(m => {
      const key = cellKey(bId, tId);
      const cells = { ...m.cells };
      if (cells[key]) delete cells[key];
      else cells[key] = {};
      return { ...m, cells };
    });
  const setCellCount = (
    bId: string,
    tId: string,
    field: keyof ElevUnitCounts,
    val: number
  ) =>
    setTypeMatrix(m => {
      const key = cellKey(bId, tId);
      const cells = { ...m.cells };
      cells[key] = { ...(cells[key] ?? {}), [field]: val };
      return { ...m, cells };
    });
  // 세그먼트 두께 지정 모드에서 선택된 변
  const [selectedSeg, setSelectedSeg] = useState<{
    wallId: string;
    edge: number;
  } | null>(null);
  // 겹 쌓는 방향 — true=안쪽(2P 짧게), false=바깥(2P 길게, 외단열)
  const [plyInward, setPlyInward] = useState(true);

  // ── refs ──
  const planCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const planContainerRef = useRef<HTMLDivElement | null>(null);
  const elevCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const elevContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // 전개 입면 휠 줌/드래그 팬 (기본 1 = 화면 맞춤 배율). 더블클릭으로 리셋.
  const [elevView, setElevView] = useState({ zoom: 1, x: 0, y: 0 });
  const elevDragRef = useRef<{ x: number; y: number } | null>(null);
  const elevMovedRef = useRef(0); // 드래그 이동량 — 클릭(<5px)과 팬 구분
  // 보드 번호 클릭 → 절단판 상세 팝업. 그리기 시점에 히트 영역/시트 데이터를 기록한다.
  const elevHitRef = useRef<
    { x: number; y: number; w: number; h: number; ci: number; sheet: number }[]
  >([]);
  const elevSheetsRef = useRef<
    {
      chainName: string;
      ply: number;
      cells: { x: number; y: number; w: number; h: number; discarded?: boolean }[];
      labels: string[];
    }[]
  >([]);
  const [boardDetail, setBoardDetail] = useState<{ sheet: number; ci: number } | null>(null);
  const [hoverWorld, setHoverWorld] = useState<Point2D | null>(null);
  const [snapHit, setSnapHit] = useState<Point2D | null>(null);

  const preset = useMemo(
    () => presets.find(p => p.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );

  const [outputOpen, setOutputOpen] = useState(false);

  // ── 프로젝트 저장 / REV(리비전) ──
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // 마지막으로 업로드한 DXF 원본(저장 시 첨부). 복원으로 열면 null + loadedDxfMeta 사용.
  const [lastDxfFile, setLastDxfFile] = useState<File | null>(null);
  const [loadedDxfMeta, setLoadedDxfMeta] = useState<{
    path: string;
    name: string | null;
    size: number | null;
  } | null>(null);
  // 내보내기(.swelev.json)용 원본 DXF 텍스트 — 업로드/REV 로드/불러오기 시 보관.
  const [rawDxfText, setRawDxfText] = useState<string | null>(null);
  const [revPanelOpen, setRevPanelOpen] = useState(false);

  const { data: elevProjects = [] } = useElevProjects();
  const { data: activeProjectData } = useElevProject(activeProjectId);
  const createProjectMut = useCreateElevProject();
  const saveRevMut = useSaveElevRevision();
  const deleteRevMut = useDeleteElevRevision();
  const deleteProjectMut = useDeleteElevProject();

  /** 현재 화면 상태 → 직렬화(복원용) */
  const buildElevState = useCallback(
    (): ElevState => ({
      schemaVer: 1,
      fileName: fileName || null,
      boardSpec: { boardLength, boardHeight, boardThickness },
      policy: {
        insulOn,
        placement,
        optimizeSP,
        discardWidth,
        constructMinPieceWidth: constructMinW,
        minJointGap,
        minPieceWidth,
        plyInward,
      },
      ui: {
        defaultFloorHeight,
        defaultSill,
        autoExtract,
        hiddenLayers: Array.from(hiddenLayers),
      },
      presets: [],
      walls,
      openings,
      buildings: [],
      typeMatrix,
    }),
    [
      fileName, boardLength, boardHeight, boardThickness, insulOn, placement,
      optimizeSP, discardWidth, constructMinW, minJointGap, minPieceWidth, plyInward, defaultFloorHeight,
      defaultSill, autoExtract, hiddenLayers, walls, openings, typeMatrix,
    ]
  );

  /** 직렬화 상태 → 화면 setter 일괄 적용 (DXF 재파싱은 별도) */
  const applyElevState = useCallback((st: ElevState) => {
    setBoardLength(st.boardSpec.boardLength);
    setBoardHeight(st.boardSpec.boardHeight);
    setBoardThickness(st.boardSpec.boardThickness);
    setInsulOn(st.policy.insulOn);
    setPlacement(st.policy.placement);
    setOptimizeSP(st.policy.optimizeSP);
    setDiscardWidth(st.policy.discardWidth);
    setConstructMinW(st.policy.constructMinPieceWidth ?? 0); // 구 REV 폴백
    setMinJointGap(st.policy.minJointGap);
    setMinPieceWidth(st.policy.minPieceWidth);
    setPlyInward(st.policy.plyInward ?? true);
    setDefaultFloorHeight(st.ui.defaultFloorHeight);
    setDefaultSill(st.ui.defaultSill);
    setAutoExtract(st.ui.autoExtract);
    setHiddenLayers(new Set(st.ui.hiddenLayers ?? []));
    {
      // 옛 REV 마이그레이션: 수동 2P 입면(refChainId 보유)은 이제 1P 체인이
      // 1P·2P를 자동 생성하므로 중복(물량 2배) → 로드 시 제거하고 안내.
      const loaded = (st.walls as WallChain[]) ?? [];
      const cleaned = loaded.filter(w => !w.refChainId);
      if (cleaned.length !== loaded.length) {
        toast.info(
          `옛 수동 2P 입면 ${loaded.length - cleaned.length}개는 자동 1P/2P로 대체되어 제외했습니다. 세그먼트 두께를 확인하세요.`
        );
      }
      // 동·타입 매트릭스: 있으면 그대로, 없으면(구 REV) 레거시 building/core/units 에서 복원
      if (st.typeMatrix && st.typeMatrix.types) {
        setTypeMatrix(st.typeMatrix);
        setWalls(cleaned);
      } else {
        const { matrix, tagById } = migrateLegacyMatrix(cleaned);
        setTypeMatrix(matrix);
        setWalls(
          cleaned.map(w => {
            const tag = tagById[w.id];
            return tag ? { ...w, typeId: tag.typeId, buildingId: tag.buildingId } : w;
          })
        );
      }
    }
    setOpenings((st.openings as Opening[]) ?? []);
    setActiveWallId(null);
    setDraft([]);
    setSelectedOpeningId(null);
    setMode("view");
  }, []);

  const handleNewProject = useCallback(async () => {
    const name = window.prompt("새 프로젝트 이름")?.trim();
    if (!name) return;
    try {
      const { project } = await createProjectMut.mutateAsync({ name });
      setActiveProjectId(project.id);
      toast.success(`프로젝트 '${project.name}' 생성됨`);
    } catch (e) {
      toast.error(`생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [createProjectMut]);

  const handleSaveRev = useCallback(async () => {
    if (!activeProjectId) {
      toast.error("먼저 프로젝트를 선택하거나 새로 만드세요.");
      return;
    }
    try {
      await saveRevMut.mutateAsync({
        projectId: activeProjectId,
        state: buildElevState(),
        summary: { wallCount: walls.length },
        dxfFile: lastDxfFile ?? undefined,
        reuse:
          !lastDxfFile && loadedDxfMeta
            ? {
                dxfPath: loadedDxfMeta.path,
                dxfName: loadedDxfMeta.name,
                dxfSize: loadedDxfMeta.size,
              }
            : null,
      });
      toast.success("저장됨 (새 REV)");
    } catch (e) {
      toast.error(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeProjectId, saveRevMut, buildElevState, walls.length, lastDxfFile, loadedDxfMeta]);

  const handleLoadRev = useCallback(
    async (revId: string) => {
      if (!activeProjectId) return;
      try {
        const { revision, dxfSignedUrl } = await getElevRevision(activeProjectId, revId);
        applyElevState(revision.state);
        setFileName(revision.dxf_name || revision.state.fileName || "");
        setLoadedDxfMeta(
          revision.dxf_path
            ? { path: revision.dxf_path, name: revision.dxf_name, size: revision.dxf_size }
            : null
        );
        setLastDxfFile(null);
        setRawDxfText(null);
        if (dxfSignedUrl) {
          const text = await fetch(dxfSignedUrl).then(r => r.text());
          setRawDxfText(text); // 내보내기용 원본 DXF 보관
          const raw = new DxfParser().parseSync(text);
          setParsed(normalizeDxf(raw));
        }
        setRevPanelOpen(false);
        toast.success(`REV ${revision.rev_no} 불러옴`);
      } catch (e) {
        toast.error(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [activeProjectId, applyElevState]
  );

  // ── 체인별 측정값 ──
  const wallMetricsById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof cumWallLengths>>();
    for (const w of walls) m.set(w.id, cumWallLengths(w.points));
    return m;
  }, [walls]);

  const activeWall = walls.find(w => w.id === activeWallId) ?? null;

  // ── 세그먼트별 단열 스펙 정규화 (길이 = points.length-1, 폴백 포함) ──
  const resolveSegInsul = useCallback(
    (w: WallChain): SegInsul[] => {
      // 닫힌 폴리곤은 닫는 변까지 N개, 열린 폴리라인은 N-1개
      const n = w.closed
        ? w.points.length
        : Math.max(0, w.points.length - 1);
      const def = exposurePresets[0] ?? DEFAULT_EXPOSURE_PRESETS[0];
      const src = w.segInsul ?? [];
      return Array.from({ length: n }, (_, i) => {
        const s = src[i];
        if (s && (s.skip || (s.ply1 > 0 && s.ply2 > 0))) return s;
        // 레거시 폴백: 옛 단일 thickness → 1P=thickness, 2P=기본 프리셋 2P
        if (w.thickness && w.thickness > 0)
          return { ply1: w.thickness, ply2: def.ply2, exposure: "custom" };
        return { ply1: def.ply1, ply2: def.ply2, exposure: def.exposure };
      });
    },
    [exposurePresets]
  );

  // ── 같은 입면 안에 2P 선(안쪽 오프셋) 자동 생성 → w.points2P 에 저장 ──
  const createPly2From = (w: WallChain, sideOverride?: "left" | "right") => {
    if (w.points.length < 2) return;
    const side = sideOverride ?? w.exteriorSide ?? "left";
    const segInsul = resolveSegInsul(w);
    const dists = segInsul.map(s => s.ply1); // 1P 두께만큼 안으로
    const sArea = (pts: Point2D[]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    };
    let pts = offsetPolylineInward(w.points, w.closed, dists, side);
    // 닫힘: 면적 작아지는 쪽(=안쪽)인지 확인, 아니면 반대로
    if (w.closed && w.points.length >= 3) {
      const inward = Math.abs(sArea(pts)) < Math.abs(sArea(w.points));
      if (!inward)
        pts = offsetPolylineInward(w.points, w.closed, dists.map(d => -d), side);
    }
    updateChain(w.id, { points2P: pts, exteriorSide: side });
    toast.success("2P 선 자동 생성됨 (안쪽 오프셋). 물량은 1P+2P 합산.");
  };

  // 2P 오프셋이 바깥으로 나갔을 때(열린 폴리라인 트레이싱 방향 문제) 방향을 반전한다.
  const flipPly2Side = (w: WallChain) => {
    const next: "left" | "right" =
      (w.exteriorSide ?? "left") === "left" ? "right" : "left";
    createPly2From(w, next);
  };

  // ── 한 입면 안의 겹(pts) → 전개 파라미터 ──
  // 1P = w.points, 2P = w.points2P(같은 입면). isP2 면 창 물림 배치 + 두께 ply2.
  const makeParams = (
    w: WallChain,
    pts: Point2D[],
    isP2: boolean,
    opsDevX: { x0: number; x1: number; y0: number; y1: number }[]
  ): DevelopPlyParams => {
    const segInsul = resolveSegInsul(w);
    // 실제 1P/2P 두께를 그대로 전달 — developPly 가 겹별로 골라 쓰고(segLapW),
    // 2P 인셋 계산 때 아래 겹(1P) 두께 s.ply1 이 필요하다.
    const thk = segInsul.map(s => ({ ply1: s.ply1, ply2: s.ply2 }));
    const segSkip = segInsul.map(s => !!s.skip); // 배치 안함(선만 이음) 변
    return {
      points: pts,
      closed: w.closed,
      wallHeight: w.floorHeight,
      board: { length: boardLength, height: boardHeight, thickness: boardThickness },
      ply: isP2 ? 2 : 1, // 2P=창 물림, 1P=창 경계 절단
      segThickness: thk,
      segSkip,
      exteriorSide: w.exteriorSide ?? "left", // 체인별 외부 방향(코너 인셋 방향)
      plyInward,
      minPieceWidth,
      placement,
      discardWidth,
      constructMinPieceWidth: constructMinW,
      openings: opsDevX,
    };
  };
  // 보드 수직 조인트 — 셀 좌우 모서리 x + 높이 구간(관통 판정용)
  const jointSegsOf = (dev: PlyDevelopment): JointSeg[] => {
    const segs: JointSeg[] = [];
    for (const c of dev.cells) {
      segs.push({ x: c.x, y0: c.y, y1: c.y + c.h });
      segs.push({ x: c.x + c.w, y0: c.y, y1: c.y + c.h });
    }
    return segs;
  };
  // 결로(관통) 충돌: 2P 조인트가 1P 조인트와 x<minGap AND 높이 겹침 일 때만.
  // 반환: 충돌하는 2P 조인트 구간(2P 좌표) — 빨강 표시용.
  const conflictSegsOf = (
    j1: JointSeg[],
    d1: number,
    j2: JointSeg[],
    d2: number,
    gap: number
  ): JointSeg[] => {
    const out: JointSeg[] = [];
    for (const s2 of j2) {
      const rel2 = s2.x - d2;
      for (const s1 of j1) {
        if (Math.abs(s1.x - d1 - rel2) >= gap - 1e-6) continue; // x 멀면 skip
        // 높이 겹침이 있어야 관통(결로) 충돌
        if (Math.min(s1.y1, s2.y1) - Math.max(s1.y0, s2.y0) > 1e-6) {
          out.push(s2);
          break;
        }
      }
    }
    return out;
  };

  // 한 입면 → 1P(points) + 2P(points2P, 있으면) 전개. 물량은 두 겹 합산.
  //  · 2P 는 창을 물고 넘어가고, SP 를 훑어 1P 조인트와 결로 최소가 되게 엇갈림.
  const buildPlyDev = (
    w: WallChain
  ): {
    dev1: PlyDevelopment;
    dev2: PlyDevelopment | null;
    conflictSegs: JointSeg[];
  } => {
    const ops = openings.filter(o => o.wallId === w.id);
    const opsStruct = ops.map(o => ({
      x0: o.sAlong - o.width / 2,
      x1: o.sAlong + o.width / 2,
      y0: o.sill,
      y1: o.sill + o.height,
    }));
    const p1 = makeParams(w, w.points, false, opsStruct);
    const dev1 = optimizeSP ? developPlyMinBoards(p1).dev : developPly(p1);

    if (!w.points2P || w.points2P.length < 2)
      return { dev1, dev2: null, conflictSegs: [] };

    // 2P는 1P와 '같은 벽 선·같은 개구부'로 전개한다.
    // 오프셋 선(w.points2P)을 별도 전개하면 오목부(노치)에서 선이 자기교차해
    // 곧은 면에도 '가짜 코너'가 박히고, 개구부가 그 코너 위로 밀려 창이 코너에 걸린다.
    // → 구조선(w.points) 기준으로 통일하면 코너는 실제 벽 꺾임에만 생기고,
    //   창은 1P와 같은 위치(코너 사이)에 남는다.
    // 2P 구분은 straddle(창 물림) + 조인트 엇갈림(아래 startOffset 스윕) + 2P 두께로 표현.
    // (파란 점선 w.points2P 는 평면에서 2P 시각 가이드로만 사용)
    const p2 = makeParams(w, w.points, true, opsStruct);

    const j1 = jointSegsOf(dev1);
    const L = boardLength;
    let best = developPly(p2);
    let bestConf = Infinity;
    let bestBoards = Infinity;
    let bestSegs: JointSeg[] = [];
    for (let off = 0; off < L; off += 50) {
      const d2 = developPly({ ...p2, startOffset: off });
      const segs = conflictSegsOf(j1, 0, jointSegsOf(d2), 0, minJointGap);
      const boards = summarizeBoards(d2.cells, L, boardHeight).orderBoardCount;
      if (
        segs.length < bestConf ||
        (segs.length === bestConf && boards < bestBoards)
      ) {
        best = d2;
        bestConf = segs.length;
        bestBoards = boards;
        bestSegs = segs;
      }
    }
    return { dev1, dev2: best, conflictSegs: bestSegs };
  };

  // ─── 업로드 ───
  const handleFile = useCallback(async (file: File) => {
    setIsParsing(true);
    setParseError("");
    setFileName(file.name);
    setLastDxfFile(file); // 저장(REV) 시 첨부할 원본 보관
    setLoadedDxfMeta(null);
    try {
      const text = await file.text();
      setRawDxfText(text); // 내보내기용 원본 DXF 보관
      const parser = new DxfParser();
      const raw = parser.parseSync(text);
      const norm = normalizeDxf(raw);
      setParsed(norm);
      setHiddenLayers(new Set());
      setWalls([]);
      setDraft([]);
      setActiveWallId(null);
      setOpenings([]);
      setMode("view");
    } catch (err: any) {
      console.error("[DXF Parse Error]", err);
      setParseError(err?.message || "DXF 파싱 실패");
      setParsed(null);
    } finally {
      setIsParsing(false);
    }
  }, []);

  /**
   * 프로젝트 파일(.swelev.json) 불러오기 — Smart Works 등에서 내보낸 파일.
   * state(설정·입면) 적용 + 내장 DXF 재파싱. (같은 ElevState 형식이라 호환)
   */
  const handleImportProjectFile = useCallback(
    async (file: File) => {
      try {
        const data = JSON.parse(await file.text());
        if (data?.format !== "smartworks-elev-project" || !data?.state) {
          toast.error("올바른 프로젝트 파일(.swelev.json)이 아닙니다.");
          return;
        }
        applyElevState(data.state as ElevState);
        const dxf = data.dxf as { name?: string; text?: string } | null;
        if (dxf?.text) {
          const dxfName = dxf.name || data.state.fileName || "imported.dxf";
          setFileName(dxfName);
          setParsed(normalizeDxf(new DxfParser().parseSync(dxf.text)));
          setRawDxfText(dxf.text); // 다시 내보내기 가능하도록 보관
          // 이후 저장(REV) 시 첨부되도록 원본 File 재구성
          setLastDxfFile(new File([dxf.text], dxfName, { type: "application/dxf" }));
          setLoadedDxfMeta(null);
        } else {
          setParsed(null);
          setRawDxfText(null);
          setFileName(data.state.fileName || "");
          toast.info("DXF가 포함되지 않은 파일입니다. 설정·입면만 불러왔습니다.");
        }
        toast.success(
          `프로젝트를 불러왔습니다${data.projectName ? ` — ${data.projectName}` : ""}.`
        );
      } catch (e) {
        toast.error(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [applyElevState]
  );

  /**
   * 프로젝트 내보내기 — 현재 상태(state) + 원본 DXF 를 한 파일(.swelev.json)로.
   * Smart Works 단열재에서 그대로 불러올 수 있다(같은 ElevState 형식).
   */
  const handleExportProject = useCallback(() => {
    if (!walls.length) {
      toast.error("내보낼 입면이 없습니다. 먼저 트레이싱하거나 프로젝트를 불러오세요.");
      return;
    }
    const state = buildElevState();
    const projName = elevProjects.find(p => p.id === activeProjectId)?.name ?? null;
    const dxfName = fileName || lastDxfFile?.name || loadedDxfMeta?.name || "drawing.dxf";
    const bundle = {
      format: "smartworks-elev-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "insulation-partition-generator",
      projectName: projName ?? (fileName || null),
      state,
      dxf: rawDxfText ? { name: dxfName, text: rawDxfText } : null,
    };
    const base =
      (projName || fileName || "elev-project").replace(/\.dxf$/i, "") || "elev-project";
    downloadText(`${base}.swelev.json`, JSON.stringify(bundle), "application/json");
    if (rawDxfText) {
      toast.success("프로젝트 파일을 내보냈습니다. (.swelev.json)");
    } else {
      toast.warning("원본 DXF를 찾지 못해 설정·입면만 내보냈습니다. (배경 도면 없이 열립니다)");
    }
  }, [
    walls.length,
    buildElevState,
    elevProjects,
    activeProjectId,
    fileName,
    lastDxfFile,
    loadedDxfMeta,
    rawDxfText,
  ]);

  // ─── Fit ───
  const fitToScreen = useCallback(() => {
    if (!parsed || !planContainerRef.current) return;
    const { minX, minY, maxX, maxY } = parsed.bounds;
    const dw = maxX - minX || 1;
    const dh = maxY - minY || 1;
    const cw = planContainerRef.current.clientWidth;
    const ch = planContainerRef.current.clientHeight;
    const pad = 40;
    const s = Math.min((cw - pad * 2) / dw, (ch - pad * 2) / dh);
    setScale(s);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setOffset({ x: cw / 2 - cx * s, y: ch / 2 + cy * s });
  }, [parsed]);

  useEffect(() => {
    if (parsed) fitToScreen();
  }, [parsed, fitToScreen]);

  // ─── 좌표 변환 ───
  const toPx = useCallback(
    (p: Point2D): Point2D => ({
      x: p.x * scale + offset.x,
      y: -p.y * scale + offset.y,
    }),
    [scale, offset]
  );
  const pxToWorld = useCallback(
    (px: number, py: number): Point2D => ({
      x: (px - offset.x) / scale,
      y: -(py - offset.y) / scale,
    }),
    [scale, offset]
  );

  // ─── 가시 엔티티 ───
  const visibleEntities = useMemo(() => {
    if (!parsed) return [];
    return parsed.entities.filter(e => !hiddenLayers.has(e.layer));
  }, [parsed, hiddenLayers]);

  // ─── 평면 렌더 ───
  useEffect(() => {
    const canvas = planCanvasRef.current;
    const container = planContainerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, cw, ch);
    if (!parsed) return;

    // DXF
    ctx.lineWidth = 1;
    for (const e of visibleEntities) {
      ctx.strokeStyle = e.color;
      ctx.fillStyle = e.color;
      switch (e.kind) {
        case "line": {
          const a = toPx(e.a);
          const b = toPx(e.b);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          break;
        }
        case "polyline": {
          ctx.beginPath();
          e.points.forEach((p, i) => {
            const q = toPx(p);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          if (e.closed) ctx.closePath();
          ctx.stroke();
          break;
        }
        case "circle": {
          const c = toPx(e.center);
          ctx.beginPath();
          ctx.arc(c.x, c.y, e.radius * scale, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "arc": {
          const c = toPx(e.center);
          ctx.beginPath();
          ctx.arc(c.x, c.y, e.radius * scale, -e.end, -e.start, false);
          ctx.stroke();
          break;
        }
        case "text": {
          if (!showText) break;
          const p = toPx(e.pos);
          ctx.font = "10px 'Noto Sans KR', sans-serif";
          ctx.fillText(e.text, p.x, p.y);
          break;
        }
      }
    }

    // 확정된 체인들
    walls.forEach((w, idx) => {
      const col = chainColor(idx);
      const isActive = w.id === activeWallId;
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.strokeStyle = col;
      ctx.globalAlpha = isActive ? 1 : 0.75;
      ctx.beginPath();
      w.points.forEach((p, i) => {
        const q = toPx(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      if (w.closed) ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 2P 선(안쪽 오프셋) — 있으면 시안 점선으로 안쪽에 표시
      if (w.points2P && w.points2P.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        w.points2P.forEach((p, i) => {
          const q = toPx(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        if (w.closed) ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // 정점
      ctx.fillStyle = col;
      for (const p of w.points) {
        const q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, isActive ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 활성 입면: 세그먼트 번호(S#) 배지 + 선택된 변 강조 (목록의 S# 와 매칭)
      if (isActive) {
        const segN = w.closed ? w.points.length : w.points.length - 1;
        for (let si = 0; si < segN; si++) {
          const a = toPx(w.points[si]);
          const b = toPx(w.points[(si + 1) % w.points.length]);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          // 노출타입 색으로 세그먼트 강조(직접=주황, 간접=파랑, 커스텀=회색)
          const segEx = w.segInsul?.[si]?.exposure ?? "direct";
          ctx.save();
          ctx.strokeStyle = EXPOSURE_COLOR[segEx];
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
          const sel =
            selectedSeg?.wallId === w.id && selectedSeg?.edge === si;
          if (sel) {
            ctx.save();
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 6;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.restore();
          }
          const label = `S${si + 1}`;
          ctx.font = "bold 10px 'Noto Sans KR', sans-serif";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = sel ? "#38bdf8" : "rgba(15,23,42,0.8)";
          ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 14);
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, mx, my);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      }

      // 시작점에 라벨 (입면 N)
      if (w.points.length > 0) {
        const q = toPx(w.points[0]);
        ctx.font = "11px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = col;
        ctx.fillText(w.name, q.x + 6, q.y - 6);
      }
    });

    // 트레이싱 중인 draft
    if (draft.length > 0) {
      const col = chainColor(walls.length);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      draft.forEach((p, i) => {
        const q = toPx(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = col;
      for (const p of draft) {
        const q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 마우스 hover 미리보기
      if (mode === "trace" && hoverWorld) {
        const last = toPx(draft[draft.length - 1]);
        const cur = toPx(hoverWorld);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `${col}99`;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 스냅
    if (snapHit) {
      const q = toPx(snapHit);
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x - 5, q.y);
      ctx.lineTo(q.x + 5, q.y);
      ctx.moveTo(q.x, q.y - 5);
      ctx.lineTo(q.x, q.y + 5);
      ctx.stroke();
    }

    // 오프닝 (체인별)
    for (const op of openings) {
      const w = walls.find(x => x.id === op.wallId);
      if (!w || w.points.length < 2) continue;
      const a = sAlongToWorld(op.sAlong - op.width / 2, w.points);
      const b = sAlongToWorld(op.sAlong + op.width / 2, w.points);
      if (!a || !b) continue;
      const pa = toPx(a);
      const pb = toPx(b);
      ctx.lineWidth = 6;
      ctx.strokeStyle = KIND_COLOR[op.kind];
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      const cc = toPx(sAlongToWorld(op.sAlong, w.points)!);
      ctx.fillStyle =
        op.id === selectedOpeningId ? "#ffffff" : KIND_COLOR[op.kind];
      ctx.beginPath();
      ctx.arc(cc.x, cc.y, op.id === selectedOpeningId ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // two-point anchor
    if (mode === "two-point" && twoPointAnchor) {
      const w = walls.find(x => x.id === twoPointAnchor.wallId);
      if (w) {
        const wp = sAlongToWorld(twoPointAnchor.s, w.points);
        if (wp) {
          const q = toPx(wp);
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }, [
    parsed,
    visibleEntities,
    scale,
    offset,
    showText,
    walls,
    draft,
    activeWallId,
    openings,
    snapHit,
    hoverWorld,
    mode,
    twoPointAnchor,
    selectedOpeningId,
    selectedSeg,
    toPx,
  ]);

  // ─── 입면 렌더 (여러 체인 세로로 쌓기) ───
  useEffect(() => {
    const canvas = elevCanvasRef.current;
    const container = elevContainerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, cw, ch);

    if (walls.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px 'Noto Sans KR', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "위 평면에서 외벽선을 트레이싱하면 여기 전개 입면이 표시됩니다. (체인을 여러 개 추가하면 입면이 위/아래로 쌓입니다)",
        cw / 2,
        ch / 2
      );
      return;
    }

    // 각 체인의 (perimeter, floorHeight)를 측정하여 모든 입면이 들어갈 공통 스케일 계산
    const chains = walls
      .map(w => ({
        chain: w,
        perimeter: wallMetricsById.get(w.id)?.total ?? 0,
        cum: wallMetricsById.get(w.id)?.cum ?? [0],
      }))
      .filter(c => c.perimeter > 0 && c.chain.floorHeight > 0);

    if (chains.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px 'Noto Sans KR', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("트레이싱 점을 2개 이상 추가하세요.", cw / 2, ch / 2);
      return;
    }

    // 휠 줌/팬 변환 — 이후 모든 시트 그리기에 적용 (배경·빈 상태 문구는 변환 제외)
    ctx.translate(elevView.x, elevView.y);
    ctx.scale(elevView.zoom, elevView.zoom);

    // 보드 번호 클릭 판정용 기록 초기화 (fit 좌표계 기준으로 다시 채움)
    elevHitRef.current = [];
    elevSheetsRef.current = [];

    // ── 그릴 "시트" 목록 구성 ──
    // 단열재 OFF: 체인당 구조 입면 1장 (기존 동작)
    // 단열재 ON : 체인당 ply별 별도 입면(1P, 2P …) — 한 장에 겹치지 않게 따로 쌓는다
    type Sheet =
      | {
          kind: "struct";
          chain: WallChain;
          baseLen: number;
          fh: number;
          cum: number[];
          idx: number;
        }
      | {
          kind: "ply";
          chain: WallChain;
          baseLen: number;
          fh: number;
          dev: ReturnType<typeof developPly>;
          ply: number;
          idx: number;
          conflictSegs: JointSeg[];
        };

    const sheets: Sheet[] = [];
    chains.forEach((c, idx) => {
      const fh = c.chain.floorHeight;
      if (insulOn && c.chain.points.length >= 2) {
        // 한 입면 → 1P(그린 선) + 2P(있으면) 두 장. 물량은 합산.
        const { dev1, dev2, conflictSegs } = buildPlyDev(c.chain);
        sheets.push({
          kind: "ply",
          chain: c.chain,
          baseLen: dev1.baselineLength,
          fh,
          dev: dev1,
          ply: 1,
          idx,
          conflictSegs: [],
        });
        if (dev2) {
          sheets.push({
            kind: "ply",
            chain: c.chain,
            baseLen: dev2.baselineLength,
            fh,
            dev: dev2,
            ply: 2,
            idx,
            conflictSegs, // 결로 빨강은 2P
          });
        }
      } else {
        sheets.push({
          kind: "struct",
          chain: c.chain,
          baseLen: c.perimeter,
          fh,
          cum: c.cum,
          idx,
        });
      }
    });

    const padX = 60;
    const padTopHeader = 22;
    const padBetween = 36;
    const padBottom = 24;
    const maxBaseLen = Math.max(1, ...sheets.map(sh => sh.baseLen));
    const sumHeights = sheets.reduce((a, sh) => a + sh.fh, 0);

    // 공통 스케일 — 가로는 maxBaseLen, 세로는 합산 floorHeight + 간격
    const availW = cw - padX * 2;
    const availH =
      ch -
      padTopHeader * sheets.length -
      padBetween * Math.max(0, sheets.length - 1) -
      padBottom;
    const sx = availW / maxBaseLen;
    const sy = availH / Math.max(1, sumHeights);
    const s = Math.max(0.0001, Math.min(sx, sy));

    let cursorY = padTopHeader; // 위에서부터 그림
    for (const sheet of sheets) {
      const fh = sheet.fh;
      const baseLen = sheet.baseLen;
      const widthPx = baseLen * s;
      const heightPx = fh * s;
      const offX = (cw - widthPx) / 2;
      const offY = cursorY;

      const ex = (x: number) => offX + x * s;
      const ey = (y: number) => offY + (fh - y) * s;

      const isActive = sheet.chain.id === activeWallId;
      const col = chainColor(sheet.idx);

      // 헤더
      ctx.fillStyle = sheet.kind === "ply" ? "#0284c7" : col;
      ctx.font = `bold 11px 'Noto Sans KR', sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const header =
        sheet.kind === "ply"
          ? `${sheet.chain.name} · ${sheet.ply === 2 ? "2P(외측)" : "1P(내측)"} · 전개 ${(baseLen / 1000).toFixed(2)}m · 보드 ${boardLength}×${boardHeight} · 층고 ${fh}mm`
          : `${sheet.chain.name}  ·  둘레 ${(baseLen / 1000).toFixed(2)}m  ·  층고 ${fh}mm`;
      ctx.fillText(header, offX, offY - 4);

      // 가로 그리드 500mm
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y <= fh; y += 500) {
        ctx.moveTo(ex(0), ey(y));
        ctx.lineTo(ex(baseLen), ey(y));
      }
      ctx.stroke();

      // 외곽
      ctx.lineWidth = isActive ? 2.5 : 2;
      ctx.strokeStyle = isActive ? col : "#334155";
      ctx.strokeRect(ex(0), ey(fh), widthPx, heightPx);

      // 바닥
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex(0), ey(0));
      ctx.lineTo(ex(baseLen), ey(0));
      ctx.stroke();

      if (sheet.kind === "struct") {
        // 벽 분할 (구조체 코너)
        ctx.strokeStyle = "#cbd5e1";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 1; i < sheet.cum.length - 1; i++) {
          ctx.moveTo(ex(sheet.cum[i]), ey(0));
          ctx.lineTo(ex(sheet.cum[i]), ey(fh));
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 벽면 라벨
        ctx.fillStyle = "#64748b";
        ctx.font = "9px 'Noto Sans KR', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let i = 0; i < sheet.cum.length - 1; i++) {
          const mid = (sheet.cum[i] + sheet.cum[i + 1]) / 2;
          ctx.fillText(`W${i + 1}`, ex(mid), ey(fh) - 14);
        }

        // 오프닝
        const myOps = openings.filter(o => o.wallId === sheet.chain.id);
        for (const op of myOps) {
          const x0 = Math.max(0, op.sAlong - op.width / 2);
          const x1 = Math.min(baseLen, op.sAlong + op.width / 2);
          const y0 = op.sill;
          const y1 = op.sill + op.height;
          const left = ex(x0);
          const right = ex(x1);
          const top = ey(y1);
          const bot = ey(y0);
          const w = right - left;
          const h = bot - top;
          ctx.fillStyle =
            op.kind === "window"
              ? "rgba(56,189,248,0.25)"
              : op.kind === "door"
                ? "rgba(244,114,182,0.25)"
                : "rgba(163,230,53,0.25)";
          ctx.fillRect(left, top, w, h);
          ctx.strokeStyle =
            op.id === selectedOpeningId ? "#0ea5e9" : KIND_COLOR[op.kind];
          ctx.lineWidth = op.id === selectedOpeningId ? 2.5 : 1.5;
          ctx.strokeRect(left, top, w, h);
          if (op.kind === "window" && w > 12 && h > 12) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = KIND_COLOR[op.kind];
            ctx.beginPath();
            ctx.moveTo(left + w / 2, top);
            ctx.lineTo(left + w / 2, top + h);
            ctx.moveTo(left, top + h / 2);
            ctx.lineTo(left + w, top + h / 2);
            ctx.stroke();
          }
          if (w > 30) {
            ctx.fillStyle = "#0f172a";
            ctx.font = "10px 'Noto Sans KR', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(
              `${op.width}×${op.height}${op.sill > 0 ? ` (sill ${op.sill})` : ""}`,
              left + w / 2,
              top - 2
            );
          }
        }
      } else {
        // ── ply 단열재 나누기도 ──
        const dev = sheet.dev;

        // ── 노출 구간(직접/간접) 색 밴드 — 전개 상단(외곽선 위) ──
        {
          const segIns = sheet.chain.segInsul ?? [];
          let cxmm = 0;
          dev.segLengths.forEach((len, si) => {
            const segLen = Math.max(0, len);
            if (segLen > 1e-6) {
              const seg = segIns[si];
              const skip = !!seg?.skip;
              const exposure = seg?.exposure ?? "direct";
              // 노출 밴드(상단 색 띠) — 배치 안함은 회색
              ctx.fillStyle = skip ? "#64748b" : EXPOSURE_COLOR[exposure];
              ctx.fillRect(ex(cxmm), ey(fh) - 9, ex(cxmm + segLen) - ex(cxmm), 4);
              // 배치 안함 구간: 연회색 채움 + '배치안함' 라벨(보드 없음을 명시)
              if (skip) {
                const gx0 = ex(cxmm);
                const gw = ex(cxmm + segLen) - gx0;
                ctx.fillStyle = "rgba(100,116,139,0.14)";
                ctx.fillRect(gx0, ey(fh), gw, heightPx);
                if (gw > 24) {
                  ctx.save();
                  ctx.fillStyle = "#94a3b8";
                  ctx.font = "600 11px 'Noto Sans KR', sans-serif";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText("배치안함", gx0 + gw / 2, ey(fh) + heightPx / 2);
                  ctx.restore();
                }
              }
            }
            cxmm += segLen;
          });
        }

        // 보드 셀(분할선) — 코너마다 끊김. 절단(끝단) 보드는 옅은 주황 채움으로 강조
        for (const cell of dev.cells) {
          const remainder = cell.xRemainder || cell.yRemainder;
          if (cell.discarded) {
            // 버림(폐기) 자투리 — 회색 채움으로 구분
            ctx.fillStyle = "rgba(100,116,139,0.28)";
            ctx.fillRect(ex(cell.x), ey(cell.y + cell.h), cell.w * s, cell.h * s);
          } else if (remainder) {
            ctx.fillStyle = "rgba(234,88,12,0.10)";
            ctx.fillRect(ex(cell.x), ey(cell.y + cell.h), cell.w * s, cell.h * s);
          }
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = col; // 체인(입면)별 색 — 1P/2P 구분
        ctx.beginPath();
        for (const cell of dev.cells) {
          ctx.rect(ex(cell.x), ey(cell.y + cell.h), cell.w * s, cell.h * s);
        }
        ctx.stroke();

        // 모서리 겹침(먹힘) 구간 — 주황 해치 (옆 면 보드가 차지, 이 면은 그 뒤부터 분할)
        for (const lap of dev.cornerLaps) {
          const lx0 = ex(Math.min(lap.x0, lap.x1));
          const lx1 = ex(Math.max(lap.x0, lap.x1));
          const w = lx1 - lx0;
          if (w <= 0.5) continue;
          ctx.save();
          ctx.beginPath();
          ctx.rect(lx0, ey(fh), w, heightPx);
          ctx.clip();
          ctx.strokeStyle = "rgba(234,88,12,0.7)"; // orange-600
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let d = -heightPx; d < w + heightPx; d += 5) {
            ctx.moveTo(lx0 + d, ey(fh));
            ctx.lineTo(lx0 + d - heightPx, ey(fh) + heightPx);
          }
          ctx.stroke();
          ctx.restore();
        }

        // 창(개구부) 윤곽 — 보드는 이미 창을 빼고 조각화되어 비어 있다(침범 아님).
        // 창 위치만 가벼운 윤곽선 + 십자로 표시(채움 없음).
        {
          const plyOps = openings.filter(o => o.wallId === sheet.chain.id);
          // dev.openingRects 는 plyOps 와 같은 순서 — 2P 는 코너 인셋만큼 이동된 좌표.
          plyOps.forEach((op, k) => {
            const rect = dev.openingRects[k];
            if (!rect) return;
            const ox0 = Math.max(0, Math.min(rect.x0, rect.x1));
            const ox1 = Math.min(dev.baselineLength, Math.max(rect.x0, rect.x1));
            const left = ex(ox0);
            const wpx = ex(ox1) - left;
            const top = ey(op.sill + op.height);
            const hpx = ey(op.sill) - top;
            if (wpx < 1 || hpx < 1) return;
            ctx.strokeStyle = KIND_COLOR[op.kind] ?? "#0ea5e9";
            ctx.lineWidth = 1.2;
            ctx.strokeRect(left, top, wpx, hpx);
            if (wpx > 12 && hpx > 12) {
              ctx.beginPath();
              ctx.moveTo(left + wpx / 2, top);
              ctx.lineTo(left + wpx / 2, top + hpx);
              ctx.moveTo(left, top + hpx / 2);
              ctx.lineTo(left + wpx, top + hpx / 2);
              ctx.stroke();
            }
          });
        }

        // 보드 번호(원형) + 치수 — 정척="온장", 절단=전용그룹 N-1/N-2
        const labels = numberBoards(dev.cells, boardLength, boardHeight);
        // 클릭 상세용 시트 등록 (fit 좌표계 히트 영역은 아래 forEach 에서 기록)
        const sheetIdx =
          elevSheetsRef.current.push({
            chainName: sheet.chain.name,
            ply: sheet.ply,
            cells: dev.cells,
            labels,
          }) - 1;

        // 선택한 절단판 그룹 음영 — 같은 그룹(N-1·N-2…)을 입면 위에서 전부 강조
        if (boardDetail && boardDetail.sheet === sheetIdx) {
          const selLabel = labels[boardDetail.ci] ?? "";
          const g =
            selLabel === "온장" || selLabel === "버림" ? null : selLabel.split("-")[0];
          dev.cells.forEach((cell, ci) => {
            const inGroup = g
              ? labels[ci] === g || labels[ci].startsWith(`${g}-`)
              : ci === boardDetail.ci;
            if (!inGroup) return;
            const hx = ex(cell.x);
            const hy = ey(cell.y + cell.h);
            const hwpx = cell.w * s;
            const hhpx = cell.h * s;
            ctx.fillStyle =
              ci === boardDetail.ci ? "rgba(20,120,214,0.38)" : "rgba(20,120,214,0.20)";
            ctx.fillRect(hx, hy, hwpx, hhpx);
            ctx.strokeStyle = "#1478d6";
            ctx.lineWidth = ci === boardDetail.ci ? 2.5 : 1.5;
            ctx.strokeRect(hx, hy, hwpx, hhpx);
          });
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        dev.cells.forEach((cell, ci) => {
          const wpx = cell.w * s;
          const hpx = cell.h * s;
          if (wpx < 5 || hpx < 5) return; // 거의 안 보이는 것만 생략
          const label = labels[ci];
          if (!label) return;
          elevHitRef.current.push({
            x: ex(cell.x),
            y: ey(cell.y + cell.h),
            w: wpx,
            h: hpx,
            ci,
            sheet: sheetIdx,
          });
          const cx = ex(cell.x) + wpx / 2;
          const cy = ey(cell.y + cell.h) + hpx / 2;
          const remainder = cell.xRemainder || cell.yRemainder;
          const color = cell.discarded
            ? "#64748b"
            : remainder
              ? "#c2410c"
              : "#0f172a";
          const r = Math.min(wpx, hpx) * 0.3;
          if (r > 7) {
            // 원 + 번호
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = `bold ${Math.max(7, Math.min(13, r * 1.05))}px 'Noto Sans KR', sans-serif`;
            ctx.fillText(label, cx, cy);
            if (wpx > 30 && hpx > r * 2 + 14) {
              ctx.fillStyle = "#94a3b8";
              ctx.font = "7px 'Noto Sans KR', sans-serif";
              ctx.fillText(
                `${Math.round(cell.w)}×${Math.round(cell.h)}`,
                cx,
                cy + r + 6
              );
            }
          } else {
            // 좁은 조각: 원 없이 번호만. 세로로 길면 회전해서 표시(빠지지 않게)
            ctx.fillStyle = color;
            if (wpx < hpx && wpx < 22 && hpx > 24) {
              ctx.save();
              ctx.translate(cx, cy);
              ctx.rotate(-Math.PI / 2);
              ctx.font = `bold ${Math.max(7, Math.min(11, hpx * 0.05 + 6))}px 'Noto Sans KR', sans-serif`;
              ctx.fillText(label, 0, 0);
              ctx.restore();
            } else {
              ctx.font = `bold ${Math.max(6, Math.min(10, Math.min(wpx, hpx) * 0.5))}px 'Noto Sans KR', sans-serif`;
              ctx.fillText(label, cx, cy);
            }
          }
        });

        // 꺾임(코너) V 마크 — 전개 상단 + 끊김 강조선
        for (const cxMm of dev.cornerXs) {
          const xc = ex(cxMm);
          const topY = ey(fh);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(xc - 6, topY - 10);
          ctx.lineTo(xc, topY);
          ctx.lineTo(xc + 6, topY - 10);
          ctx.stroke();
          ctx.save();
          ctx.strokeStyle = "rgba(148,163,184,0.5)";
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(xc, ey(fh));
          ctx.lineTo(xc, ey(0));
          ctx.stroke();
          ctx.restore();
        }

        // ── 결로 위험(관통 조인트: 1P와 같은 높이에서 minGap 미달) — 빨강 ──
        if (sheet.conflictSegs.length > 0) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 2;
          for (const seg of sheet.conflictSegs) {
            const xp = ex(seg.x);
            ctx.beginPath();
            ctx.moveTo(xp, ey(seg.y1));
            ctx.lineTo(xp, ey(seg.y0));
            ctx.stroke();
          }
          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 9px 'Noto Sans KR', sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(
            `⚠ 결로위험(관통) 조인트 ${sheet.conflictSegs.length}개 (1P와 ${minJointGap}mm 미달)`,
            ex(0),
            ey(fh) + 2
          );
        }

        // ── 물량 집계 ──
        const sum = summarizeBoards(dev.cells, boardLength, boardHeight);
        // 헤더 우측: 총 장수/면적
        ctx.fillStyle = "#0284c7";
        ctx.font = "bold 9px 'Noto Sans KR', sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          `주문 ${sum.orderBoardCount}판 (온장 ${sum.fullCount} + 절단판 ${sum.cutBoardCount}) · 조각 ${sum.totalCount} · ${sum.totalAreaM2.toFixed(2)}㎡` +
            (sum.discardedCount > 0
              ? ` · 버림 ${sum.discardedCount}개(${sum.discardedAreaM2.toFixed(2)}㎡)`
              : ""),
          ex(baseLen),
          offY - 4
        );
        // 하단: 규격별 수량 (정척·절단). 너무 많으면 상위 8종만
        const MAX_TALLY = 8;
        const shown = sum.tallies.slice(0, MAX_TALLY);
        const more = sum.tallies.length - shown.length;
        const tallyStr =
          shown
            .map(
              t => `${t.w}×${t.h}${t.remainder ? "(절단)" : ""}:${t.count}`
            )
            .join("   ") + (more > 0 ? `   …+${more}종` : "");
        ctx.fillStyle = "#475569";
        ctx.font = "8px 'Noto Sans KR', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(`[물량] ${tallyStr}`, ex(0), ey(0) + 15);
      }

      // 좌측 높이 눈금
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px 'Noto Sans KR', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let y = 0; y <= fh; y += 500) {
        ctx.fillText(`${y}`, ex(0) - 4, ey(y));
      }
      // 하단 m 눈금
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let x = 0; x <= baseLen; x += 1000) {
        ctx.fillText(`${(x / 1000).toFixed(0)}m`, ex(x), ey(0) + 4);
      }

      cursorY += heightPx + padBetween;
    }
  }, [
    walls,
    openings,
    wallMetricsById,
    selectedOpeningId,
    activeWallId,
    insulOn,
    boardLength,
    boardHeight,
    boardThickness,
    optimizeSP,
    minJointGap,
    minPieceWidth,
    plyInward,
    exposurePresets,
    placement,
    discardWidth,
    constructMinW,
    selectedSeg,
    elevView,
    boardDetail,
  ]);

  // ─── 휠 줌 ───
  useEffect(() => {
    const canvas = planCanvasRef.current;
    if (!canvas) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      setScale(prev => {
        const ns = Math.max(0.0001, Math.min(1e6, prev * factor));
        setOffset(prevOff => ({
          x: mx - (mx - prevOff.x) * (ns / prev),
          y: my - (my - prevOff.y) * (ns / prev),
        }));
        return ns;
      });
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  // ─── 전개 입면 휠 줌 (마우스 위치 기준 확대·축소) ───
  useEffect(() => {
    const canvas = elevCanvasRef.current;
    if (!canvas) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      setElevView(prev => {
        const nz = Math.max(0.2, Math.min(50, prev.zoom * factor));
        const k = nz / prev.zoom;
        return { zoom: nz, x: mx - (mx - prev.x) * k, y: my - (my - prev.y) * k };
      });
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  // ─── ResizeObserver ───
  useEffect(() => {
    const obs: ResizeObserver[] = [];
    if (planContainerRef.current) {
      const ro = new ResizeObserver(() => setOffset(o => ({ ...o })));
      ro.observe(planContainerRef.current);
      obs.push(ro);
    }
    if (elevContainerRef.current) {
      const ro2 = new ResizeObserver(() =>
        setDefaultFloorHeight(h => h)
      );
      ro2.observe(elevContainerRef.current);
      obs.push(ro2);
    }
    return () => obs.forEach(o => o.disconnect());
  }, []);

  // ─── 스냅 찾기 ───
  const findSnap = useCallback(
    (world: Point2D, screenTolPx: number): Point2D | null => {
      const worldTol = screenTolPx / scale;
      let best: { p: Point2D; d: number } | null = null;
      const tryPt = (p: Point2D) => {
        const d = dist(world, p);
        if (d <= worldTol && (!best || d < best.d)) best = { p, d };
      };
      if (parsed) parsed.snapPoints.forEach(tryPt);
      walls.forEach(w => w.points.forEach(tryPt));
      draft.forEach(tryPt);
      // draft 닫기 스냅
      if (mode === "trace" && draft.length >= 3) tryPt(draft[0]);
      return best ? (best as { p: Point2D; d: number }).p : null;
    },
    [parsed, walls, draft, scale, mode]
  );

  /** 모든 체인 중 마우스에 가장 가까운 (벽선 위 투영) 결과 */
  const projectOnAnyWall = useCallback(
    (world: Point2D) => {
      let best: {
        wallId: string;
        s: number;
        point: Point2D;
        distance: number;
      } | null = null;
      for (const w of walls) {
        if (w.points.length < 2) continue;
        const p = worldToSAlong(world, w.points);
        if (!p) continue;
        if (!best || p.distance < best.distance) {
          best = { wallId: w.id, s: p.s, point: p.point, distance: p.distance };
        }
      }
      return best;
    },
    [walls]
  );

  // ─── 평면 마우스 ───
  const onPlanMouseDown = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === "view") {
      dragRef.current = { x: ev.clientX - offset.x, y: ev.clientY - offset.y };
    }
  };

  const onPlanMouseMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = planCanvasRef.current!.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const w = pxToWorld(mx, my);

    if (mode === "view") {
      if (dragRef.current) {
        setOffset({
          x: ev.clientX - dragRef.current.x,
          y: ev.clientY - dragRef.current.y,
        });
      }
      setHoverWorld(null);
      setSnapHit(null);
      return;
    }

    if (mode === "trace") {
      const snap = findSnap(w, snapTolerancePx);
      setSnapHit(snap);
      setHoverWorld(snap ?? w);
      return;
    }

    if (mode === "place" || mode === "two-point" || mode === "auto") {
      // 1) DXF 정점/벽 정점 스냅 우선 시도
      const snap = findSnap(w, snapTolerancePx);
      if (snap) {
        const projSnap = projectOnAnyWall(snap);
        if (projSnap) {
          setSnapHit(projSnap.point);
          setHoverWorld(projSnap.point);
          return;
        }
      }
      // 2) 스냅 없으면 가까운 벽에 투영
      const proj = projectOnAnyWall(w);
      if (proj) {
        setSnapHit(proj.point);
        setHoverWorld(proj.point);
        return;
      }
    }
    setHoverWorld(w);
    setSnapHit(null);
  };

  const onPlanMouseUp = () => {
    dragRef.current = null;
  };

  /** 클릭 위치 근처 TEXT 에서 폭×높이 추출 */
  const autoSizeFromNearbyText = useCallback(
    (world: Point2D): { width: number; height: number; text: string } | null => {
      if (!parsed || !autoExtract) return null;
      // 평면 스케일을 고려한 검색 반경 — 클릭 지점에서 앞·뒤 200px 화면 반경 내 TEXT 탐색
      const r = 200 / scale;
      let best: {
        d: number;
        size: { width: number; height: number };
        text: string;
      } | null = null;
      for (const e of parsed.entities) {
        if (e.kind !== "text") continue;
        const d = dist(world, e.pos);
        if (d > r) continue;
        const size = extractSizeFromText(e.text);
        if (!size) continue;
        if (!best || d < best.d) best = { d, size, text: e.text };
      }
      return best ? { ...best.size, text: best.text } : null;
    },
    [parsed, scale, autoExtract]
  );

  /**
   * 거리 제한 없이 전체 TEXT 엔티티 중 W×H 패턴에 매칭되는 가장 가까운 주석 검색.
   * 창호 블록을 클릭했을 때 라벨이 도면의 다른 위치에 있어도 찾아쓰기 위한 함수.
   */
  const findNearestSizeText = useCallback(
    (world: Point2D): { width: number; height: number; text: string } | null => {
      if (!parsed) return null;
      let best: {
        d: number;
        size: { width: number; height: number };
        text: string;
      } | null = null;
      for (const e of parsed.entities) {
        if (e.kind !== "text") continue;
        const size = extractSizeFromText(e.text);
        if (!size) continue;
        const d = dist(world, e.pos);
        if (!best || d < best.d) best = { d, size, text: e.text };
      }
      return best ? { ...best.size, text: best.text } : null;
    },
    [parsed]
  );

  /** draft 확정 → walls 에 추가 */
  const commitDraft = useCallback(
    (closed = false) => {
      if (draft.length < 2) return;
      const id = uid();
      const def = exposurePresets[0] ?? DEFAULT_EXPOSURE_PRESETS[0];
      const segCount = Math.max(0, draft.length - (closed ? 0 : 1));
      const newChain: WallChain = {
        id,
        name: `입면 ${walls.length + 1}`,
        points: [...draft],
        closed,
        floorHeight: defaultFloorHeight,
        // 세그먼트별 단열 스펙 초기화 — 기본 프리셋(직접외기)
        segInsul: Array.from({ length: segCount }, () => ({
          ply1: def.ply1,
          ply2: def.ply2,
          exposure: def.exposure,
        })),
      };
      setWalls(prev => [...prev, newChain]);
      setDraft([]);
      setActiveWallId(id);
    },
    [draft, walls.length, defaultFloorHeight]
  );

  const onPlanClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === "view") return;
    const rect = planCanvasRef.current!.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const worldRaw = pxToWorld(mx, my);
    const world = snapHit ?? worldRaw;

    if (mode === "trace") {
      // 첫 점 근처 스냅이면 닫기
      if (draft.length >= 3 && snapHit) {
        const first = draft[0];
        if (dist(snapHit, first) < 1e-6) {
          commitDraft(true);
          setMode("view");
          return;
        }
      }
      setDraft(d => [...d, world]);
      return;
    }

    // ── 창호 자동 인식 모드 ── 프리셋 무관, 클릭 위치를 벽에 투영 + 가장 가까운 W×H 라벨 사용
    if (mode === "auto") {
      const projA = projectOnAnyWall(snapHit ?? worldRaw);
      if (!projA) return;
      const auto = findNearestSizeText(snapHit ?? worldRaw);
      if (!auto) {
        // eslint-disable-next-line no-alert
        alert(
          "도면에서 폭×높이 형식의 텍스트(예: 18×11.8 또는 1800×1500)를 찾지 못했습니다."
        );
        return;
      }
      const peri = wallMetricsById.get(projA.wallId)?.total ?? 0;
      // 클릭 지점을 창호의 "왼쪽 끝"으로 간주 — sAlong 은 중심이므로 width/2 만큼 우측으로 이동
      const op: Opening = {
        id: uid(),
        wallId: projA.wallId,
        kind: "window",
        sAlong: clampS(projA.s + auto.width / 2, auto.width, peri),
        width: auto.width,
        height: auto.height,
        sill: defaultSill,
        label: `자동(${auto.text})`,
      };
      setOpenings(prev => [...prev, op]);
      setSelectedOpeningId(op.id);
      setActiveWallId(projA.wallId);
      return;
    }

    if (!preset) return;
    // snap 잡힌 점이 있으면 그 좌표를 벽에 투영 — 정밀(두점) 스냅 적용
    const proj = projectOnAnyWall(snapHit ?? worldRaw);
    if (!proj) return;
    const targetWall = walls.find(w => w.id === proj.wallId);
    if (!targetWall) return;
    const perimeter = wallMetricsById.get(proj.wallId)?.total ?? 0;

    if (mode === "place") {
      const auto = autoSizeFromNearbyText(worldRaw);
      const width = auto?.width ?? preset.width;
      const height = auto?.height ?? preset.height;
      // 자동 인식 성공 시 sill 은 "기본 sill" 입력값을 쓴다. 수동이면 프리셋 sill.
      const sill = auto ? defaultSill : preset.sill;
      const op: Opening = {
        id: uid(),
        wallId: proj.wallId,
        kind: preset.kind,
        sAlong: clampS(proj.s, width, perimeter),
        width,
        height,
        sill,
        label: auto ? `자동(${auto.text}) · ${preset.label}` : preset.label,
      };
      setOpenings(prev => [...prev, op]);
      setSelectedOpeningId(op.id);
      setActiveWallId(proj.wallId);
      return;
    }

    if (mode === "two-point") {
      if (!twoPointAnchor || twoPointAnchor.wallId !== proj.wallId) {
        setTwoPointAnchor({ wallId: proj.wallId, s: proj.s });
        setActiveWallId(proj.wallId);
      } else {
        const sA = twoPointAnchor.s;
        const sB = proj.s;
        const sMin = Math.min(sA, sB);
        const sMax = Math.max(sA, sB);
        const width = sMax - sMin;
        if (width < 1) {
          setTwoPointAnchor(null);
          return;
        }
        const op: Opening = {
          id: uid(),
          wallId: proj.wallId,
          kind: preset.kind,
          sAlong: (sMin + sMax) / 2,
          width: Math.round(width),
          height: preset.height,
          sill: preset.sill,
          label: `정밀 · ${preset.label}`,
        };
        setOpenings(prev => [...prev, op]);
        setSelectedOpeningId(op.id);
        setTwoPointAnchor(null);
      }
    }
  };

  const onPlanDoubleClick = () => {
    if (mode === "trace" && draft.length >= 2) {
      commitDraft(false);
      setMode("view");
    }
  };

  // ─── 키보드 ───
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (mode === "trace" && draft.length >= 2) {
          commitDraft(false);
          setMode("view");
        } else if (mode !== "view") {
          setMode("view");
          setTwoPointAnchor(null);
          setDraft([]);
        }
      } else if (ev.key === "Enter") {
        if (mode === "trace" && draft.length >= 2) {
          commitDraft(false);
          setMode("view");
        }
      } else if (
        (ev.key === "Backspace" ||
          ev.key === "z" ||
          ev.key === "Z" ||
          ev.code === "KeyZ") &&
        ev.ctrlKey
      ) {
        if (mode === "trace") setDraft(d => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draft.length, commitDraft]);

  // ─── 레이어 ───
  const toggleLayer = (layer: string) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  // ─── 체인 액션 ───
  const startNewChain = () => {
    setDraft([]);
    setMode("trace");
  };
  const deleteChain = (id: string) => {
    setWalls(prev => prev.filter(w => w.id !== id));
    setOpenings(prev => prev.filter(o => o.wallId !== id));
    if (activeWallId === id) setActiveWallId(null);
  };
  const updateChain = (id: string, patch: Partial<WallChain>) => {
    setWalls(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  };

  // ─── 오프닝 ───
  const updateOpening = (id: string, patch: Partial<Opening>) => {
    setOpenings(prev =>
      prev.map(op => (op.id === id ? { ...op, ...patch } : op))
    );
  };
  const deleteOpening = (id: string) => {
    setOpenings(prev => prev.filter(op => op.id !== id));
    if (selectedOpeningId === id) setSelectedOpeningId(null);
  };
  const selectedOpening = openings.find(op => op.id === selectedOpeningId);

  const resetAll = () => {
    setWalls([]);
    setDraft([]);
    setOpenings([]);
    setTypeMatrix(EMPTY_MATRIX);
    setActiveWallId(null);
    setSelectedOpeningId(null);
    setTwoPointAnchor(null);
    setMode("view");
  };

  // ─── 익스포트 (모든 체인을 위/아래로 배치한 단일 DXF/SVG) ───
  const canExport = walls.length > 0;
  // 현장산출서 두께 라벨 — 하드코딩(50/90) 금지, 프리셋의 실제 1P/2P 두께에서 자동 구성
  const thkLabel = useMemo(
    () =>
      [...new Set(exposurePresets.flatMap(p => [p.ply1, p.ply2]))]
        .filter(t => t > 0)
        .sort((a, b) => a - b)
        .map(t => `${t}T`)
        .join("/"),
    [exposurePresets]
  );
  const exportBase = useMemo(() => {
    const stem = fileName.replace(/\.dxf$/i, "") || "elevation";
    return `${stem}_elev`;
  }, [fileName]);

  /**
   * 여러 입면을 세로로 stack 하기 위해, 각 체인의 오프닝/벽분할/외곽을
   * Y 오프셋을 더해 하나의 ElevationExportInput으로 합친다.
   * Y 간격은 1000mm.
   */
  const buildCombined = useCallback(() => {
    const GAP = 1000;
    let yCursor = 0;
    type Op = {
      id: string;
      kind: OpeningKind;
      sAlong: number;
      width: number;
      height: number;
      sill: number;
      label?: string;
    };
    const combinedOps: Op[] = [];
    /** wallCum 을 시뮬레이션 — 각 체인을 (시작 X, 종료 X) 로 옆이 아니라 위/아래로 배치하므로,
     *  Export 함수가 가정하는 "한 줄 perimeter" 구조와 맞지 않는다.
     *  그래서 단일 합성 대신 체인마다 별도 DXF 섹션을 잇는 게 정확하다.
     *  여기서는 단순화를 위해 가장 긴 체인 1개만 export 하는 대신,
     *  체인별 DXF 를 줄바꿈으로 이어 붙이지 않고, 각 체인을 별도 파일로 저장하는 방식이 가장 안전.
     *  → 사용자가 직접 체인을 선택해서 export 하도록 한다.
     */
    return { combinedOps, yCursor, GAP };
  }, []);

  /** 체인 → 단열재 나누기도 export 데이터 (토글 ON 일 때만) */
  const insulExportFromDev = (
    dev: PlyDevelopment,
    ply: number,
    segInsul: SegInsul[]
  ): InsulationExport => {
    const s = summarizeBoards(dev.cells, boardLength, boardHeight);
    const isP2 = ply === 2;
    // 노출 구간(직접/간접외기) 밴드 — 연속 같은 노출은 병합. 전개좌표(dev.segLengths) 기준.
    const exposureBands: NonNullable<InsulationExport["exposureBands"]> = [];
    let bx = 0;
    let prevMode: string | null = null;
    let prevTotal = -1;
    dev.segLengths.forEach((len, si) => {
      const segLen = Math.max(0, len);
      if (segLen > 1e-6) {
        const seg = segInsul[si];
        const skip = !!seg?.skip;
        const exposure = seg?.exposure ?? "direct";
        const total = seg ? seg.ply1 + seg.ply2 : 0;
        const mode = skip ? "skip" : exposure; // 병합 키
        const last = exposureBands[exposureBands.length - 1];
        if (last && prevMode === mode && prevTotal === (skip ? 0 : total)) {
          last.x1 = bx + segLen;
        } else if (skip) {
          exposureBands.push({
            x0: bx,
            x1: bx + segLen,
            color: "#64748b", // 회색 — 배치 안함(미시공)
            aci: 8,
            label: "배치안함",
            labelAscii: "SKIP",
          });
        } else {
          const label =
            exposure === "direct"
              ? "직접외기"
              : exposure === "indirect"
                ? "간접외기"
                : "혼합";
          const ascii =
            exposure === "direct"
              ? "DIRECT"
              : exposure === "indirect"
                ? "INDIRECT"
                : "MIX";
          exposureBands.push({
            x0: bx,
            x1: bx + segLen,
            color: EXPOSURE_COLOR[exposure],
            aci: exposure === "direct" ? 30 : exposure === "indirect" ? 5 : 8,
            label: `${label} ${total}T`,
            labelAscii: `${ascii} ${total}T`,
          });
        }
        prevMode = mode;
        prevTotal = skip ? 0 : total;
      }
      bx += segLen;
    });
    return {
      ply,
      boardLength,
      boardHeight,
      cells: dev.cells.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h })),
      labels: numberBoards(dev.cells, boardLength, boardHeight),
      cornerXs: dev.cornerXs,
      cornerLaps: dev.cornerLaps.map(l => ({ x0: l.x0, x1: l.x1 })),
      exposureBands,
      // 1P·2P 색 구분: 1P=시안(ACI4), 2P=보라(ACI6)
      cellColor: isP2 ? "#a855f7" : "#06b6d4",
      cellAci: isP2 ? 6 : 4,
      summary: {
        totalCount: s.totalCount,
        fullCount: s.fullCount,
        cutCount: s.cutCount,
        cutBoardCount: s.cutBoardCount,
        orderBoardCount: s.orderBoardCount,
        totalAreaM2: s.totalAreaM2,
      },
    };
  };

  /**
   * 한 입면(구조선) → export 엔트리. insulOn 이면 1P·2P 두 장(위/아래 stack)으로
   * 반환해 Multi export 가 각각 전개도로 쌓아 그린다(2P 도 DXF/SVG 에 포함).
   */
  const buildElevEntriesFor = (
    w: WallChain
  ): (ElevationExportInput & { title?: string })[] => {
    const cum = wallMetricsById.get(w.id);
    if (!cum || cum.total <= 0) return [];
    const floorHeight = w.floorHeight ?? defaultFloorHeight;
    const openingsArr = openings
      .filter(o => o.wallId === w.id)
      .map(o => ({
        id: o.id,
        kind: o.kind,
        sAlong: o.sAlong,
        width: o.width,
        height: o.height,
        sill: o.sill,
        label: o.label,
      }));
    if (!insulOn || w.points.length < 2)
      return [
        {
          perimeter: cum.total,
          floorHeight,
          wallCum: cum.cum,
          openings: openingsArr,
          title: w.name,
        },
      ];
    const { dev1, dev2 } = buildPlyDev(w);
    const segInsul = resolveSegInsul(w);
    const mk = (dev: PlyDevelopment, ply: number) => {
      // 창 위치를 이 겹의 전개좌표로 옮긴다(2P 는 코너 인셋만큼 이동).
      // dev.openingRects 는 openingsArr 와 같은 순서 — 중심·폭을 그 좌표로 재계산해
      // DXF/SVG 에서도 창이 짧아진 2P 시트의 코너 사이 제 위치에 오게 한다.
      const devOpenings = openingsArr.map((o, k) => {
        const r = dev.openingRects[k];
        if (!r) return o;
        return { ...o, sAlong: (r.x0 + r.x1) / 2, width: Math.abs(r.x1 - r.x0) };
      });
      return {
        perimeter: dev.baselineLength,
        floorHeight,
        wallCum: [0, ...dev.cornerXs, dev.baselineLength],
        openings: devOpenings,
        title: `${w.name} · ${ply}P`,
        insulation: insulExportFromDev(dev, ply, segInsul),
      };
    };
    return dev2 ? [mk(dev1, 1), mk(dev2, 2)] : [mk(dev1, 1)];
  };

  /** 물량 표 CSV — 소스 보드(판) 단위로 묶음. 절단판 1판 = 그 판에서 재단되는 조각들 */
  const handleExportInsulationCsv = () => {
    if (!insulOn) return;
    const L = boardLength;
    const H = boardHeight;
    const eps = 1e-6;
    const isFull = (c: { w: number; h: number }) =>
      c.w >= L - eps && c.h >= H - eps;
    const rows: string[] = [
      "입면,보드,구분,재단 조각(가로x세로),조각수,판수,면적(㎡)",
    ];
    let any = false;
    let grandBoards = 0;
    for (const w of walls) {
      if (w.points.length < 2) continue;
      const { dev1, dev2 } = buildPlyDev(w);
      const cells = [...dev1.cells, ...(dev2?.cells ?? [])]; // 1P+2P 합산
      if (cells.length === 0) continue;
      any = true;
      const name = w.name.replace(/,/g, " ");

      // 정척(온장) — 버림 제외
      const fulls = cells.filter(c => isFull(c) && !c.discarded);
      if (fulls.length > 0) {
        const area = (fulls.length * L * H) / 1_000_000;
        rows.push(
          `${name},온장,정척,${L}x${H},${fulls.length},${fulls.length},${area.toFixed(2)}`
        );
      }
      // 절단판 — 한 온장에서 재단되는 조각 묶음 = 1판
      const bins = packCutBoards(cells, L, H);
      bins.forEach((items, bi) => {
        const pieces = items.map(
          i => `${Math.round(cells[i].w)}x${Math.round(cells[i].h)}`
        );
        const area =
          items.reduce((s, i) => s + cells[i].w * cells[i].h, 0) / 1_000_000;
        rows.push(
          `${name},절단판${bi + 1},절단,${pieces.join(" / ")},${items.length},1,${area.toFixed(2)}`
        );
      });

      // 버림(폐기) 자투리 — 시공/발주 제외, 별도 표기
      const discards = cells.filter(c => c.discarded);
      if (discards.length > 0) {
        const dArea =
          discards.reduce((s, c) => s + c.w * c.h, 0) / 1_000_000;
        rows.push(
          `${name},버림,폐기,자투리 ${discards.length}개,${discards.length},0,${dArea.toFixed(2)}`
        );
      }

      const orderBoards = fulls.length + bins.length;
      grandBoards += orderBoards;
      const installed = cells.filter(c => !c.discarded);
      const totalPieces = installed.length;
      const totalArea =
        installed.reduce((s, c) => s + c.w * c.h, 0) / 1_000_000;
      rows.push(
        `${name},합계,,조각 ${totalPieces}개,${totalPieces},${orderBoards},${totalArea.toFixed(2)}`
      );
      rows.push(""); // 입면 구분 빈 줄
    }
    if (!any) return;
    rows.push(`전체,주문 판수 합계,,,,${grandBoards},`);
    // Excel 한글 깨짐 방지 BOM
    const csv = "﻿" + rows.join("\r\n");
    downloadText(`${exportBase}_단열재물량.csv`, csv, "text/csv");
  };

  /** 입면(단위세대) 1개의 두께별 물량 — EA(시공 조각 수)·면적(㎡). 1P+2P 합산 */
  const wallThicknessTally = (
    w: WallChain
  ): Map<number, { ea: number; areaM2: number }> => {
    const { dev1, dev2 } = buildPlyDev(w);
    const cells = [...dev1.cells, ...(dev2?.cells ?? [])].filter(
      c => !c.discarded
    );
    const fullArea = (boardLength * boardHeight) / 1_000_000; // 정척 1판 면적(㎡)
    const m = new Map<number, { ea: number; areaM2: number }>();
    // 두께별로 주문 판수(정척+절단판) 산출 → 면적 = 판수 × 정척면적 (현장식)
    for (const t of new Set(cells.map(c => Math.round(c.thickness)))) {
      const sub = cells.filter(c => Math.round(c.thickness) === t);
      const boards = summarizeBoards(sub, boardLength, boardHeight).orderBoardCount;
      m.set(t, { ea: boards, areaM2: boards * fullArea });
    }
    return m;
  };

  // ── 물량 소스 입면 해석 ──
  //  · repElevByType: 그 타입의 대표 입면(동 미지정 우선, 없으면 아무거나 태깅된 것)
  //  · elevForCell: (동,타입) 셀 → 동 전용 입면 우선, 없으면 대표 입면
  const repElevByType = (typeId: string): WallChain | null => {
    if (!typeId) return null;
    const tagged = walls.filter(
      w => w.typeId === typeId && w.points.length >= 2
    );
    return tagged.find(w => !w.buildingId) ?? tagged[0] ?? null;
  };
  const elevForCell = (buildingId: string, typeId: string): WallChain | null => {
    if (!typeId) return null;
    const exact = walls.find(
      w =>
        w.typeId === typeId &&
        w.buildingId === buildingId &&
        w.points.length >= 2
    );
    return exact ?? repElevByType(typeId);
  };

  /**
   * 현장식 산출서 CSV — 두께(50T/90T/…)별로 나눠 산출.
   *  ① 단위세대 타입별 단열재 수량 (개수 EA · 면적 M2)
   *  ② 동별 집계표 (단위세대 물량 × 세대수[1~3F+지붕층+기준층])
   * 두께 열은 실제 등장하는 두께로 자동 구성.
   */
  const handleExportSiteReportCsv = () => {
    if (!insulOn) return;
    if (typeMatrix.types.length === 0) {
      toast.error("먼저 '동·타입 설정'에서 타입을 만들고 세대수를 입력하세요.");
      return;
    }
    const esc = (s: string) => (s ?? "").replace(/,/g, " ");
    // 입면 tally 캐시(입면당 buildPlyDev 1회)
    const tallyCache = new Map<string, Map<number, { ea: number; areaM2: number }>>();
    const tallyOf = (w: WallChain | null) => {
      if (!w) return null;
      const c = tallyCache.get(w.id);
      if (c) return c;
      const m = wallThicknessTally(w);
      tallyCache.set(w.id, m);
      return m;
    };

    // 두께 열: 모든 타입 대표 + (동,타입) 셀 소스 입면의 두께 union
    const thkSet = new Set<number>();
    for (const t of typeMatrix.types)
      tallyOf(repElevByType(t.id))?.forEach((_, k) => thkSet.add(k));
    for (const b of typeMatrix.buildings)
      for (const t of typeMatrix.types) {
        if (!typeMatrix.cells[cellKey(b.id, t.id)]) continue;
        tallyOf(elevForCell(b.id, t.id))?.forEach((_, k) => thkSet.add(k));
      }
    const thks = [...thkSet].sort((a, b) => a - b);
    const eaCols = thks.map(t => `${t}T 개수(EA)`).join(",");
    const arCols = thks.map(t => `${t}T 면적(M2)`).join(",");

    const rows: string[] = [];
    const missing: string[] = [];

    // ── ① 단위세대 타입별 단열재 수량 (대표 입면 1세대 기준) ──
    rows.push("[단위세대 타입별 단열재 수량]");
    rows.push(`단위세대 타입,${eaCols},${arCols}`);
    for (const t of typeMatrix.types) {
      const tally = tallyOf(repElevByType(t.id));
      if (!tally) {
        missing.push(t.name);
        const dash = thks.map(() => "-").join(",");
        rows.push(`${esc(t.name)},${dash},${dash}`);
        continue;
      }
      const ea = thks.map(x => tally.get(x)?.ea ?? 0);
      const ar = thks.map(x => (tally.get(x)?.areaM2 ?? 0).toFixed(2));
      rows.push(`${esc(t.name)},${ea.join(",")},${ar.join(",")}`);
    }
    rows.push("");

    // ── ② 동별 단열재 집계표 (매트릭스 세대수 곱) ──
    rows.push("[동별 단열재 집계표]");
    rows.push(`동,단위세대 타입,1~3F,지붕층,기준층,세대수,${arCols}`);
    const grand = new Map<number, number>();
    let grandUnits = 0;
    for (const b of typeMatrix.buildings) {
      for (const t of typeMatrix.types) {
        const counts = typeMatrix.cells[cellKey(b.id, t.id)];
        if (!counts) continue; // 이 동에 배분 안된 타입
        const low = counts.low ?? 0;
        const roof = counts.roof ?? 0;
        const base = counts.base ?? 0;
        const total = low + roof + base;
        if (total === 0) continue;
        grandUnits += total;
        const tally = tallyOf(elevForCell(b.id, t.id));
        const ar = thks.map(x => {
          const a = (tally?.get(x)?.areaM2 ?? 0) * total;
          grand.set(x, (grand.get(x) ?? 0) + a);
          return tally ? a.toFixed(1) : "-";
        });
        rows.push(
          `${esc(b.name)},${esc(t.name)},${low},${roof},${base},${total},${ar.join(",")}`
        );
      }
    }
    rows.push(
      `합계,,,,,${grandUnits},${thks.map(t => (grand.get(t) ?? 0).toFixed(1)).join(",")}`
    );

    if (missing.length > 0)
      toast.info(
        `대표 입면이 없는 타입: ${missing.join(", ")} — 물량 0/대시. 입면에서 해당 타입을 지정하세요.`
      );

    const csv = "﻿" + rows.join("\r\n");
    downloadText(`${exportBase}_현장산출서.csv`, csv, "text/csv");
  };

  /** 단일 체인 DXF 추출 — insulOn 이면 1P·2P 두 장 stack */
  const handleExportDxfFor = (wallId: string) => {
    const w = walls.find(x => x.id === wallId);
    if (!w) return;
    const chains = buildElevEntriesFor(w);
    if (chains.length === 0) return;
    const dxf = buildElevationDxfMulti({ chains });
    downloadText(
      `${exportBase}_${w.name.replace(/\s+/g, "")}.dxf`,
      dxf,
      "application/dxf"
    );
  };

  /** 단일 체인 SVG 추출 — insulOn 이면 1P·2P 두 장 stack */
  const handleExportSvgFor = (wallId: string) => {
    const w = walls.find(x => x.id === wallId);
    if (!w) return;
    const chains = buildElevEntriesFor(w);
    if (chains.length === 0) return;
    const svg = buildElevationSvgMulti({ chains });
    downloadText(
      `${exportBase}_${w.name.replace(/\s+/g, "")}.svg`,
      svg,
      "image/svg+xml"
    );
  };

  /** 모든 입면을 한 파일에 통합 출력 (입면마다 1P·2P 위/아래로 stack) */
  const handleExportCombined = (kind: "dxf" | "svg") => {
    const chains = walls.flatMap(buildElevEntriesFor);
    if (chains.length === 0) return;
    if (kind === "dxf") {
      const dxf = buildElevationDxfMulti({ chains });
      downloadText(`${exportBase}_통합.dxf`, dxf, "application/dxf");
    } else {
      const svg = buildElevationSvgMulti({ chains });
      downloadText(`${exportBase}_통합.svg`, svg, "image/svg+xml");
    }
  };

  /** 전체 입면을 각각 별개 파일로 — (기존 분할 다운로드) */
  const handleExportAll = (kind: "dxf" | "svg") => {
    walls.forEach(w => {
      if (kind === "dxf") handleExportDxfFor(w.id);
      else handleExportSvgFor(w.id);
    });
  };

  // ── Output 집계: 입면별 동·코어 + 보드 물량 요약 ──
  const wallSummaries = useMemo<WallSummaryInput[]>(
    () =>
      walls
        .filter(w => w.points.length >= 2)
        .map(w => {
          const { dev1, dev2 } = buildPlyDev(w);
          const bName =
            typeMatrix.buildings.find(b => b.id === w.buildingId)?.name ?? "";
          const tName =
            typeMatrix.types.find(t => t.id === w.typeId)?.name ?? "";
          return {
            wallId: w.id,
            wallName: w.name,
            building: bName,
            core: tName,
            summary: summarizeBoards(
              [...dev1.cells, ...(dev2?.cells ?? [])],
              boardLength,
              boardHeight
            ),
          };
        }),
    // buildPlyDev 는 매 렌더 재생성되므로 deps 에서 제외(아래 스칼라/배열이 입력 전체를 포괄).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      walls, openings, boardLength, boardHeight, boardThickness, placement,
      discardWidth, constructMinW, minPieceWidth, optimizeSP, minJointGap, defaultFloorHeight, insulOn, plyInward, exposurePresets, typeMatrix,
    ]
  );

  /** 선택 입면 id → 통합 DXF (Output ZIP 용). 입면마다 1P·2P 두 장 stack. */
  const buildDxfForSelected = (ids: string[]): string | null => {
    const idSet = new Set(ids);
    const chains = walls
      .filter(w => idSet.has(w.id))
      .flatMap(buildElevEntriesFor);
    if (chains.length === 0) return null;
    return buildElevationDxfMulti({ chains });
  };

  const cursorClass =
    mode === "trace" || mode === "place" || mode === "two-point" || mode === "auto"
      ? "cursor-crosshair"
      : dragRef.current
        ? "cursor-grabbing"
        : "cursor-grab";

  return (
    <>
      {/* 전체화면 스튜디오 오버레이 — 사이드바/상단 네비를 덮고 몰입형으로 (AutoCAD 스타일) */}
      <div className="fixed inset-0 z-[60] overflow-hidden bg-slate-100 flex flex-col">
        {/* 헤더 — 커맨드 바 */}
        <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 bg-white px-4 py-1.5 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else window.location.assign("/");
              }}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors shrink-0"
              title="나가기 (본사 통합 관리로)"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-[#1478d6] via-[#0a63b8] to-[#003a78] text-white shadow-lg shadow-blue-900/20 ring-1 ring-white/15 shrink-0">
              <Square className="w-[17px] h-[17px]" strokeWidth={2.2} />
            </span>
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-extrabold tracking-tight text-slate-800">
                세대 단열재 나누기도
              </h1>
              <span className="rounded-md bg-[#004791]/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#004791]/75">
                Platform
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:bg-[#004791]/8 hover:text-[#004791] transition-colors"
                title="사용법 보기"
              >
                <HelpCircle className="w-[17px] h-[17px]" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#004791] text-white text-[12.5px] font-semibold shadow-sm hover:bg-[#003a78] cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              DXF 업로드
              <input
                type="file"
                accept=".dxf"
                className="hidden"
                onChange={ev => {
                  const f = ev.target.files?.[0];
                  if (f) handleFile(f);
                  ev.target.value = "";
                }}
              />
            </label>
            <label
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#004791]/30 bg-white text-[#004791] text-[12.5px] font-semibold shadow-sm hover:bg-[#004791]/5 cursor-pointer transition-colors"
              title="Smart Works 등에서 내보낸 프로젝트 파일(.swelev.json)을 불러옵니다"
            >
              <FolderOpen className="w-4 h-4" />
              프로젝트 불러오기
              <input
                type="file"
                accept=".json,.swelev.json,application/json"
                className="hidden"
                onChange={ev => {
                  const f = ev.target.files?.[0];
                  if (f) handleImportProjectFile(f);
                  ev.target.value = "";
                }}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={fitToScreen}
              disabled={!parsed}
              className="gap-1"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              화면 맞춤
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScale(s => s * 1.25)}
              disabled={!parsed}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScale(s => s / 1.25)}
              disabled={!parsed}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-5 bg-slate-300 mx-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportCombined("dxf")}
              disabled={!canExport}
              className="gap-1"
              title="모든 입면을 하나의 DXF 파일에 위/아래로 통합 출력"
            >
              <Download className="w-3.5 h-3.5" />
              DXF 통합
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportAll("dxf")}
              disabled={!canExport}
              className="gap-1"
              title="입면별 분할 DXF 파일 저장"
            >
              <Download className="w-3.5 h-3.5" />
              DXF 분할
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportCombined("svg")}
              disabled={!canExport}
              className="gap-1"
              title="모든 입면을 하나의 SVG 파일에 통합 출력"
            >
              <Download className="w-3.5 h-3.5" />
              SVG 통합
            </Button>
            <div className="w-px h-5 bg-slate-300 mx-1" />
            <Button
              size="sm"
              onClick={() => setOutputOpen(true)}
              disabled={!canExport}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700"
              title="동·코어별 통합 물량 산출 (Output)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Output
            </Button>
          </div>
        </div>

        {/* 프로젝트 / REV(리비전) 바 — 저장·복원 + 작업 모드 · 층고 */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap border-b border-slate-200 bg-white px-3.5 py-1">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-slate-600 pr-1">
            <span className="w-1.5 h-4 rounded-sm bg-[#3b82f6] inline-block" />
            프로젝트
          </span>
          <select
            value={activeProjectId ?? ""}
            onChange={e => setActiveProjectId(e.target.value || null)}
            className="h-8 text-[12.5px] rounded-md border border-slate-300 bg-white text-slate-800 px-2 min-w-[200px] focus:outline-none focus:ring-1 focus:ring-[#004791]/30 [&>option]:text-slate-900"
          >
            <option value="">— 선택 —</option>
            {elevProjects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} (REV {p.latest_rev_no})
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewProject}
            className="gap-1"
          >
            <FilePlus2 className="w-3.5 h-3.5" /> 새 프로젝트
          </Button>
          <Button
            size="sm"
            onClick={handleSaveRev}
            disabled={!activeProjectId || saveRevMut.isPending}
            className="gap-1 bg-[#004791] hover:bg-[#003a78]"
          >
            {saveRevMut.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            저장(새 REV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevPanelOpen(o => !o)}
            disabled={!activeProjectId}
            className="gap-1"
          >
            <History className="w-3.5 h-3.5" /> REV 목록
            {activeProjectData ? ` (${activeProjectData.revisions.length})` : ""}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportProject}
            disabled={!walls.length}
            className="gap-1"
            title="현재 프로젝트(설정·입면·DXF)를 파일로 내보내기 — Smart Works에서 불러올 수 있음"
          >
            <Download className="w-3.5 h-3.5" /> 내보내기
          </Button>
          {activeProjectId && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!window.confirm("이 프로젝트(모든 REV)를 삭제할까요?")) return;
                try {
                  await deleteProjectMut.mutateAsync(activeProjectId);
                  setActiveProjectId(null);
                  toast.success("프로젝트 삭제됨");
                } catch (e) {
                  toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
              title="프로젝트 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          {loadedDxfMeta && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <FolderOpen className="w-3 h-3" /> 불러온 REV · DXF 재사용
            </span>
          )}

          {/* REV 목록 패널 */}
          {revPanelOpen && activeProjectData && (
            <div className="w-full mt-1 rounded-md border border-slate-200 bg-white divide-y divide-slate-100 max-h-56 overflow-auto">
              {activeProjectData.revisions.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-slate-400">
                  저장된 REV가 없습니다.
                </div>
              )}
              {activeProjectData.revisions.map(r => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                >
                  <span className="font-semibold text-slate-700 w-14 shrink-0">
                    REV {r.rev_no}
                  </span>
                  <span className="text-slate-400 shrink-0 tabular-nums">
                    {new Date(r.created_at).toLocaleString("ko-KR")}
                  </span>
                  <span className="flex-1 truncate text-slate-500">
                    {r.dxf_name ?? "-"}
                    {r.memo ? ` · ${r.memo}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleLoadRev(r.id)}
                    className="px-2 py-0.5 rounded border border-[#004791] text-[#004791] hover:bg-blue-50 font-semibold shrink-0"
                  >
                    불러오기
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`REV ${r.rev_no} 삭제?`)) return;
                      try {
                        await deleteRevMut.mutateAsync({
                          projectId: activeProjectId!,
                          revId: r.id,
                        });
                        toast.success("삭제됨");
                      } catch (e) {
                        toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="px-1.5 py-0.5 rounded text-rose-500 hover:bg-rose-50 shrink-0"
                    title="REV 삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="w-px h-6 bg-slate-200 mx-2" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mr-0.5">
              작업
            </span>
            <ModeButton active={mode === "view"} onClick={() => setMode("view")} icon={MousePointer2} label="보기" />
            <ModeButton active={mode === "trace"} onClick={startNewChain} icon={Pencil} label={walls.length === 0 ? "트레이싱" : "새 입면"} disabled={!parsed} />
            <ModeButton active={mode === "place"} onClick={() => setMode("place")} icon={Square} label="프리셋 배치" disabled={walls.length === 0} />
            <ModeButton active={mode === "two-point"} onClick={() => { setMode("two-point"); setTwoPointAnchor(null); }} icon={CornerDownLeft} label="정밀" disabled={walls.length === 0} />
            <ModeButton active={mode === "auto"} onClick={() => setMode("auto")} icon={Wand2} label="창호 자동" disabled={walls.length === 0 || !parsed} />
          </div>
          <div className="w-px h-7 bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">층고</span>
            <div className="w-[128px]">
              <NumberInput value={defaultFloorHeight} onChange={setDefaultFloorHeight} suffix="mm" step={50} min={1000} max={6000} />
            </div>
          </div>
          {mode === "trace" && draft.length > 0 && (
            <>
              <div className="w-px h-7 bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="text-[11px] h-7 gap-1" onClick={() => { commitDraft(false); setMode("view"); setCanvasTab("elev"); }} disabled={draft.length < 2}>
                  <Check className="w-3 h-3" /> 입면 확정
                </Button>
                <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={() => setDraft(d => d.slice(0, -1))}>
                  되돌리기
                </Button>
              </div>
            </>
          )}
          {(walls.length > 0 || draft.length > 0) && (
            <>
              <div className="w-px h-7 bg-slate-200" />
              <Button size="sm" variant="outline" className="text-[11px] h-7 gap-1 !text-rose-600 !bg-rose-50 hover:!bg-rose-100 !border-rose-200" onClick={resetAll}>
                <Trash2 className="w-3 h-3" /> 전체 초기화
              </Button>
            </>
          )}
        </div>

        {/* 본문 — 전폭 캔버스(탭) + 얇은 인스펙터 패널 */}
        <div className="flex-1 min-h-0 grid grid-cols-[1fr_460px] grid-rows-[minmax(0,1fr)] gap-3 p-2">
          {/* 좌측: 캔버스 탭 (평면 / 전개 입면) — 한 번에 하나만 전폭 표시 */}
          <div className="flex flex-col gap-1.5 min-h-0">
            {/* 탭 스위처 — 클릭으로 전환 */}
            <div className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-slate-100 border border-slate-200 p-1 w-fit">
              <button
                type="button"
                onClick={() => setCanvasTab("plan")}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition-all",
                  canvasTab === "plan"
                    ? "bg-gradient-to-b from-[#1478d6] to-[#0a5cad] text-white shadow-sm shadow-blue-900/20"
                    : "text-slate-500 hover:bg-white hover:text-slate-700"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                평면도 · PLAN
              </button>
              <button
                type="button"
                onClick={() => setCanvasTab("elev")}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition-all",
                  canvasTab === "elev"
                    ? "bg-gradient-to-b from-[#1478d6] to-[#0a5cad] text-white shadow-sm shadow-blue-900/20"
                    : "text-slate-500 hover:bg-white hover:text-slate-700"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                전개 입면 · ELEVATION
                {walls.length > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums leading-none",
                      canvasTab === "elev"
                        ? "bg-white/20 text-white"
                        : "bg-[#004791]/10 text-[#004791]"
                    )}
                  >
                    {walls.length}
                  </span>
                )}
              </button>
            </div>
            {/* 캔버스 영역 — 두 캔버스 모두 마운트, 활성 탭만 노출(리사이즈 정확도 유지) */}
            <div className="relative flex-1 min-h-0">
            {/* 평면 */}
            <div
              ref={planContainerRef}
              className={cn(
                "absolute inset-0 rounded-xl overflow-hidden border border-white/10 bg-[#0b1220] shadow-xl ring-1 ring-black/20 transition-opacity duration-200",
                canvasTab === "plan"
                  ? "opacity-100 z-10"
                  : "opacity-0 pointer-events-none z-0"
              )}
            >
              <canvas
                ref={planCanvasRef}
                onMouseDown={onPlanMouseDown}
                onMouseMove={onPlanMouseMove}
                onMouseUp={onPlanMouseUp}
                onMouseLeave={() => {
                  onPlanMouseUp();
                  setHoverWorld(null);
                  setSnapHit(null);
                }}
                onClick={onPlanClick}
                onDoubleClick={onPlanDoubleClick}
                className={cn("block w-full h-full", cursorClass)}
              />
              {!parsed && !isParsing && !parseError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                  <div className="flex flex-col items-center gap-3.5 px-9 py-8 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-sm">
                    <span className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[#004791]/25 border border-[#3b82f6]/30 text-blue-200 shadow-lg">
                      <Upload className="w-7 h-7" />
                    </span>
                    <div className="text-center">
                      <p className="text-[15px] font-bold text-slate-100">
                        DXF 파일을 업로드하세요
                      </p>
                      <p className="mt-1 text-[12px] text-slate-400">
                        상단{" "}
                        <span className="text-blue-300 font-semibold">
                          DXF 업로드
                        </span>{" "}
                        버튼으로 평면 도면을 불러옵니다
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {isParsing && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-200 bg-black/30">
                  <div className="text-[13px] font-semibold animate-pulse">
                    DXF 파싱 중…
                  </div>
                </div>
              )}
              {parseError && (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <div className="max-w-md rounded-xl bg-white border border-rose-200 shadow-lg p-4">
                    <div className="flex items-center gap-2 text-rose-700 font-bold text-[13px] mb-1">
                      <FileWarning className="w-4 h-4" />
                      파싱 실패
                    </div>
                    <p className="text-[12px] text-slate-700 break-words">
                      {parseError}
                    </p>
                  </div>
                </div>
              )}
              {parsed && (
                <div className="absolute left-3 bottom-3 px-2.5 py-1.5 rounded-md bg-black/55 text-slate-100 text-[10.5px] font-mono tabular-nums backdrop-blur-sm">
                  {fileName} · ENT {parsed.entities.length} · ZOOM{" "}
                  {scale.toFixed(3)}x · 입면 {walls.length}
                </div>
              )}
              {mode !== "view" && (
                <div className="absolute right-3 top-3 px-2.5 py-1.5 rounded-md bg-amber-500/90 text-white text-[11px] font-bold shadow">
                  {mode === "trace" &&
                    `트레이싱 — Enter/더블클릭 확정 (입면 ${walls.length + 1})`}
                  {mode === "place" &&
                    `오프닝 배치: ${preset?.label ?? ""} (Esc 종료)`}
                  {mode === "two-point" &&
                    `정밀 배치: ${
                      twoPointAnchor === null ? "시작점 클릭" : "끝점 클릭"
                    }`}
                </div>
              )}
            </div>

            {/* 입면 */}
            <div
              ref={elevContainerRef}
              className={cn(
                "absolute inset-0 rounded-xl overflow-hidden border border-white/10 bg-white shadow-xl ring-1 ring-black/20 transition-opacity duration-200",
                canvasTab === "elev"
                  ? "opacity-100 z-10"
                  : "opacity-0 pointer-events-none z-0"
              )}
            >
              <canvas
                ref={elevCanvasRef}
                className="block w-full h-full cursor-grab active:cursor-grabbing"
                onMouseDown={e => {
                  elevDragRef.current = { x: e.clientX, y: e.clientY };
                  elevMovedRef.current = 0;
                }}
                onMouseMove={e => {
                  if (!elevDragRef.current) return;
                  const dx = e.clientX - elevDragRef.current.x;
                  const dy = e.clientY - elevDragRef.current.y;
                  elevDragRef.current = { x: e.clientX, y: e.clientY };
                  elevMovedRef.current += Math.abs(dx) + Math.abs(dy);
                  setElevView(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
                }}
                onMouseUp={e => {
                  const moved = elevMovedRef.current;
                  elevDragRef.current = null;
                  if (moved >= 5) return; // 팬이었으면 클릭 아님
                  // 보드 클릭 → 절단판 상세 (fit 좌표계로 역변환 후 히트 판정)
                  const rect = e.currentTarget.getBoundingClientRect();
                  const fx = (e.clientX - rect.left - elevView.x) / elevView.zoom;
                  const fy = (e.clientY - rect.top - elevView.y) / elevView.zoom;
                  const hits = elevHitRef.current;
                  for (let i = hits.length - 1; i >= 0; i--) {
                    const h = hits[i];
                    if (fx >= h.x && fx <= h.x + h.w && fy >= h.y && fy <= h.y + h.h) {
                      setBoardDetail({ sheet: h.sheet, ci: h.ci });
                      return;
                    }
                  }
                }}
                onMouseLeave={() => (elevDragRef.current = null)}
                onDoubleClick={() => setElevView({ zoom: 1, x: 0, y: 0 })}
                title="휠: 확대·축소 · 드래그: 이동 · 더블클릭: 초기화 · 보드 클릭: 절단판 상세"
              />
            </div>
            </div>
          </div>

          {/* 우측 인스펙터 패널 */}
          <aside className="rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/60 flex flex-col overflow-y-auto self-stretch min-h-0 accent-[#004791] [&_option]:text-slate-900">
            {/* 단열재 나누기도 (추가 기능) */}
            <Section icon={Square} title="단열재 나누기도" defaultOpen={false} accent="#0a63b8">
            <div className="px-3 py-2 text-[11.5px] space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={insulOn}
                  onChange={e => setInsulOn(e.target.checked)}
                  className="accent-[#004791]"
                />
                <span className="font-semibold text-slate-700">
                  전개 입면에 표시
                </span>
              </label>
              {insulOn && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
                  <div className="col-span-2 grid grid-cols-2 gap-1.5">
                    <LabelInput
                      label="길이"
                      control={
                        <NumberInput
                          value={boardLength}
                          onChange={setBoardLength}
                          suffix="mm"
                          step={50}
                          min={100}
                          max={5000}
                          compact
                        />
                      }
                    />
                    <LabelInput
                      label="높이"
                      control={
                        <NumberInput
                          value={boardHeight}
                          onChange={setBoardHeight}
                          suffix="mm"
                          step={50}
                          min={100}
                          max={5000}
                          compact
                        />
                      }
                    />
                  </div>
                  {/* 배치 방식 — 물량 최소 / 시공성 우선 */}
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-slate-700">배치 방식</span>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="placement"
                          checked={placement === "min-waste"}
                          onChange={() => setPlacement("min-waste")}
                          className="accent-[#004791]"
                        />
                        <span className="text-slate-700">물량 최소</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="placement"
                          checked={placement === "constructability"}
                          onChange={() => setPlacement("constructability")}
                          className="accent-[#004791]"
                        />
                        <span className="text-slate-700">시공성 우선</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                  {placement === "min-waste" ? (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={optimizeSP}
                          onChange={e => setOptimizeSP(e.target.checked)}
                          className="accent-[#004791]"
                        />
                        <span className="font-semibold text-slate-700">
                          최적배치 (SP 자동 — 최소 물량)
                        </span>
                      </label>
                      <LabelInput
                        label="최소 조각 폭 (시공성 — 슬리버 제거)"
                        control={
                          <NumberInput
                            value={minPieceWidth}
                            onChange={setMinPieceWidth}
                            suffix="mm"
                            step={10}
                            min={0}
                            max={1000}
                            compact
                          />
                        }
                      />
                    </>
                  ) : (
                    <>
                      <LabelInput
                        label="최소 조각 폭 (미만이면 옆 판과 재분할 · 0=끔)"
                        control={
                          <NumberInput
                            value={constructMinW}
                            onChange={setConstructMinW}
                            suffix="mm"
                            step={10}
                            min={0}
                            max={1000}
                            compact
                          />
                        }
                      />
                      <LabelInput
                        label="버림 기준 폭 (이보다 좁은 자투리 폐기)"
                        control={
                          <NumberInput
                            value={discardWidth}
                            onChange={setDiscardWidth}
                            suffix="mm"
                            step={10}
                            min={0}
                            max={1000}
                            compact
                          />
                        }
                      />
                    </>
                  )}
                  </div>
                  <LabelInput
                    label="결로방지 최소 조인트 이격 (2P↔1P)"
                    control={
                      <NumberInput
                        value={minJointGap}
                        onChange={setMinJointGap}
                        suffix="mm"
                        step={10}
                        min={0}
                        max={1000}
                        compact
                      />
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <span className="text-[9.5px] text-slate-400 font-semibold uppercase shrink-0">
                      겹 방향
                    </span>
                    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden w-fit">
                      <button
                        type="button"
                        onClick={() => setPlyInward(true)}
                        className={cn(
                          "px-2 py-1 text-[10.5px]",
                          plyInward
                            ? "bg-[#004791] text-white"
                            : "bg-white text-slate-600"
                        )}
                      >
                        안쪽 (2P 짧게)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlyInward(false)}
                        className={cn(
                          "px-2 py-1 text-[10.5px]",
                          !plyInward
                            ? "bg-[#004791] text-white"
                            : "bg-white text-slate-600"
                        )}
                      >
                        바깥 (2P 길게)
                      </button>
                    </div>
                  </div>
                  <div className="col-span-2 flex flex-col gap-1 rounded-md border border-slate-200 p-1.5">
                    <span className="text-[9.5px] text-slate-400 font-semibold uppercase">
                      노출 프리셋 (1P / 2P 두께 mm)
                    </span>
                    {exposurePresets.map((p, pi) => (
                      <div
                        key={p.exposure}
                        className="flex items-center gap-1 text-[10.5px]"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: EXPOSURE_COLOR[p.exposure] }}
                        />
                        <input
                          value={p.label}
                          onChange={e =>
                            setExposurePresets(ps =>
                              ps.map((x, i) =>
                                i === pi ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                          className="flex-1 min-w-0 border border-slate-300 rounded px-1 h-6 bg-white text-slate-700"
                        />
                        <span className="w-8 text-right text-[9px] text-slate-400 tabular-nums">
                          {p.ply1 + p.ply2}T
                        </span>
                        <input
                          type="number"
                          value={p.ply1}
                          title="1P 두께"
                          onChange={e =>
                            setExposurePresets(ps =>
                              ps.map((x, i) =>
                                i === pi
                                  ? { ...x, ply1: Number(e.target.value) || 0 }
                                  : x
                              )
                            )
                          }
                          className="w-11 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums"
                        />
                        <input
                          type="number"
                          value={p.ply2}
                          title="2P 두께"
                          onChange={e =>
                            setExposurePresets(ps =>
                              ps.map((x, i) =>
                                i === pi
                                  ? { ...x, ply2: Number(e.target.value) || 0 }
                                  : x
                              )
                            )
                          }
                          className="w-11 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="col-span-2 text-[10px] text-slate-400 leading-relaxed">
                    <b>구조선 1개</b>만 트레이싱하면 <b>1P·2P가 자동 생성</b>됩니다.
                    입면 목록에서 <b>변(S#)별 노출타입</b>(직접/간접외기)을 지정하면
                    두께(예 140T=1P90/2P50, 100T=1P50/2P50)가 반영됩니다. V(▽)=꺾임.
                    <b>최적배치</b>=SP 자동 최소물량. 2P 조인트가 1P와 {minJointGap}mm
                    미달로 엇갈리면 <b className="text-red-600">빨강</b>(결로위험).
                  </p>
                  <button
                    type="button"
                    onClick={handleExportInsulationCsv}
                    disabled={!canExport}
                    className="col-span-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-emerald-600 text-white text-[11.5px] font-semibold whitespace-nowrap hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" />
                    물량 표 CSV 내보내기 (전 입면)
                  </button>
                  <button
                    type="button"
                    onClick={handleExportSiteReportCsv}
                    disabled={!canExport}
                    className="col-span-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-[#004791] text-white text-[11.5px] font-semibold whitespace-nowrap hover:bg-[#003a78] disabled:opacity-40 disabled:cursor-not-allowed"
                    title={`두께(${thkLabel || "두께별"})별 · 동별/타입별 현장식 산출서. 세대수는 입면별 '세대수'로 곱함`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    현장식 산출서 CSV ({thkLabel || "두께별"} · 동별)
                  </button>
                </div>
              )}
            </div>

            </Section>

            {/* 동·타입 설정 (동·타입·세대수 매트릭스 → 현장식 산출서 구동) */}
            <Section
              icon={LayoutGrid}
              title={`동·타입 설정 (${typeMatrix.buildings.length}동 · ${typeMatrix.types.length}타입)`}
              defaultOpen={false}
              accent="#7c3aed"
            >
              <div className="px-2 py-2 space-y-2.5 text-[11px]">
                {/* 동 목록 */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] text-slate-400 font-semibold uppercase">
                      동 목록
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        placeholder="예: 401~405"
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            addBuildingsFromRange(
                              (e.target as HTMLInputElement).value
                            );
                            (e.target as HTMLInputElement).value = "";
                          }
                        }}
                        className="w-24 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 text-[10.5px]"
                      />
                      <button
                        type="button"
                        onClick={addBuilding}
                        className="px-1.5 h-6 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" /> 동
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {typeMatrix.buildings.map(b => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 pl-1 pr-0.5 h-6"
                      >
                        <input
                          value={b.name}
                          onChange={e => renameBuilding(b.id, e.target.value)}
                          className="w-14 bg-transparent text-slate-800 text-[10.5px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeBuilding(b.id)}
                          className="text-rose-400 hover:text-rose-600 px-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {typeMatrix.buildings.length === 0 && (
                      <span className="text-slate-500 text-[10px]">
                        범위(401~405) 입력 후 Enter 또는 '+동'
                      </span>
                    )}
                  </div>
                </div>

                {/* 타입 목록 */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] text-slate-400 font-semibold uppercase">
                      타입 목록
                    </span>
                    <button
                      type="button"
                      onClick={addType}
                      className="px-1.5 h-6 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> 타입
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {typeMatrix.types.map(t => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 pl-1 pr-0.5 h-6"
                      >
                        <input
                          value={t.name}
                          onChange={e => renameType(t.id, e.target.value)}
                          className="w-24 bg-transparent text-slate-800 text-[10.5px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeType(t.id)}
                          className="text-rose-400 hover:text-rose-600 px-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {typeMatrix.types.length === 0 && (
                      <span className="text-slate-500 text-[10px]">
                        '+타입'으로 단위세대 타입 추가
                      </span>
                    )}
                  </div>
                </div>

                {/* 동별 타입 배분 + 세대수 매트릭스 */}
                {typeMatrix.buildings.length > 0 &&
                  typeMatrix.types.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[9.5px] text-slate-400 font-semibold uppercase">
                        동별 타입 배분 · 세대수 (1~3F / 지붕 / 기준)
                      </span>
                      <div className="max-h-64 overflow-auto rounded border border-slate-200 divide-y divide-slate-200">
                        {typeMatrix.buildings.map(b => (
                          <div key={b.id} className="p-1">
                            <div className="text-[10.5px] font-bold text-[#004791] px-1 pb-0.5">
                              {b.name}
                            </div>
                            {typeMatrix.types.map(t => {
                              const key = cellKey(b.id, t.id);
                              const cell = typeMatrix.cells[key];
                              const on = !!cell;
                              const src = elevForCell(b.id, t.id);
                              const srcTag = !src
                                ? "미작성(0)"
                                : walls.some(
                                      w =>
                                        w.typeId === t.id &&
                                        w.buildingId === b.id
                                    )
                                  ? "동전용"
                                  : "대표";
                              return (
                                <div
                                  key={t.id}
                                  className="flex items-center gap-1 px-1 py-0.5"
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleCell(b.id, t.id)}
                                    className="accent-[#004791] shrink-0"
                                  />
                                  <span
                                    className={cn(
                                      "flex-1 min-w-0 truncate text-[10.5px]",
                                      on ? "text-slate-700" : "text-slate-400"
                                    )}
                                  >
                                    {t.name}
                                  </span>
                                  {on ? (
                                    <>
                                      <input
                                        type="number"
                                        min={0}
                                        value={cell?.low ?? 0}
                                        onChange={e =>
                                          setCellCount(
                                            b.id,
                                            t.id,
                                            "low",
                                            Number(e.target.value) || 0
                                          )
                                        }
                                        className="w-9 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums text-[10.5px]"
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        value={cell?.roof ?? 0}
                                        onChange={e =>
                                          setCellCount(
                                            b.id,
                                            t.id,
                                            "roof",
                                            Number(e.target.value) || 0
                                          )
                                        }
                                        className="w-9 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums text-[10.5px]"
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        value={cell?.base ?? 0}
                                        onChange={e =>
                                          setCellCount(
                                            b.id,
                                            t.id,
                                            "base",
                                            Number(e.target.value) || 0
                                          )
                                        }
                                        className="w-9 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums text-[10.5px]"
                                      />
                                      <span
                                        className={cn(
                                          "w-12 shrink-0 text-right text-[9px]",
                                          srcTag === "미작성(0)"
                                            ? "text-amber-600"
                                            : "text-slate-400"
                                        )}
                                        title="물량 소스 입면"
                                      >
                                        {srcTag}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[9px] text-slate-600">
                                      미배분
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <p className="text-[9px] text-slate-500">
                        체크=그 동에 타입 배분 · 물량은 타입 대표 입면 1세대 ×
                        세대수. '동전용'은 그 동+타입으로 그린 입면이 덮어씀.
                      </p>
                    </div>
                  )}
              </div>
            </Section>

            {/* 입면 목록 */}
            <Section icon={Layers} title={`입면 목록 (${walls.length})`} accent="#0891b2">
            <div className="px-2 py-2 space-y-2">
              <button
                type="button"
                onClick={() => setElevListOpen(true)}
                className="w-full px-2 py-2 rounded-md border border-[#2a86e0] bg-gradient-to-b from-[#1478d6] to-[#0a5cad] text-white text-[11.5px] font-semibold shadow-sm shadow-blue-900/20 hover:from-[#1a80e0] hover:to-[#0a63b8] flex items-center justify-center gap-1.5 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                입면 목록 크게 보기{walls.length > 0 ? ` (${walls.length})` : ""}
              </button>
              {walls.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-slate-400 text-center">
                  "트레이싱" 모드로 외벽을 그리세요.
                </p>
              )}
            </div>
            </Section>

            {/* 입면 목록 팝업(모달) — 사이드바가 좁아 넓은 화면에서 편집 */}
            {elevListOpen && (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
                onClick={() => setElevListOpen(false)}
              >
                <div
                  className="flex w-[min(1200px,96vw)] h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#004791]" />
                      <h2 className="text-[15px] font-bold text-slate-800">
                        입면 목록 ({walls.length})
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setElevListOpen(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="닫기"
                    >
                      <X className="w-[18px] h-[18px]" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
              {walls.length === 0 && (
                <p className="px-2 py-3 text-[11px] text-slate-400 text-center">
                  "트레이싱" 모드로 외벽을 그리세요.
                </p>
              )}
              {walls.map((w, idx) => {
                const active = w.id === activeWallId;
                const cum = wallMetricsById.get(w.id);
                const col = chainColor(idx);
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "rounded-md border text-[11px]",
                      active
                        ? "border-[#004791] bg-[#004791]/8"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveWallId(active ? null : w.id)}
                      className="w-full text-left px-2 py-1.5 flex items-center gap-1.5"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: col }}
                      />
                      <b className="flex-1 truncate">{w.name}</b>
                      <span className="font-mono text-[10px] text-slate-500">
                        {((cum?.total ?? 0) / 1000).toFixed(2)}m
                      </span>
                    </button>
                    {active && (
                      <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
                        <LabelInput
                          label="이름"
                          control={
                            <input
                              value={w.name}
                              onChange={ev =>
                                updateChain(w.id, { name: ev.target.value })
                              }
                              className="text-[11px] border border-slate-300 rounded px-1.5 py-0.5 w-full h-6 bg-white text-slate-800"
                            />
                          }
                        />
                        <LabelInput
                          label="타입 (산출서)"
                          control={
                            <select
                              value={w.typeId ?? ""}
                              onChange={ev =>
                                updateChain(w.id, {
                                  typeId: ev.target.value || undefined,
                                })
                              }
                              className="text-[11px] border border-slate-300 rounded px-1 w-full h-6 bg-white text-slate-800"
                            >
                              <option value="">— 타입 선택 —</option>
                              {typeMatrix.types.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          }
                        />
                        <LabelInput
                          label="동 (선택 · 덮어쓰기)"
                          control={
                            <select
                              value={w.buildingId ?? ""}
                              onChange={ev =>
                                updateChain(w.id, {
                                  buildingId: ev.target.value || undefined,
                                })
                              }
                              className="text-[11px] border border-slate-300 rounded px-1 w-full h-6 bg-white text-slate-800"
                            >
                              <option value="">대표 (동 공용)</option>
                              {typeMatrix.buildings.map(b => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          }
                        />
                        {typeMatrix.types.length === 0 && (
                          <p className="col-span-2 text-[9.5px] text-amber-600">
                            먼저 <b>동·타입 설정</b>에서 타입을 만들면 여기서 선택할 수 있습니다.
                          </p>
                        )}
                        <LabelInput
                          label="층고"
                          control={
                            <NumberInput
                              value={w.floorHeight}
                              onChange={v =>
                                updateChain(w.id, { floorHeight: v })
                              }
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        {insulOn && (
                          <div className="col-span-2 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => createPly2From(w)}
                              className="flex-1 px-2 py-1 rounded-md bg-[#004791] text-white text-[10.5px] font-semibold hover:bg-[#003a78]"
                            >
                              {w.points2P
                                ? "2P 선 재생성 (안쪽 오프셋)"
                                : "2P 선 자동 생성 (안쪽 오프셋)"}
                            </button>
                            {w.points2P && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => flipPly2Side(w)}
                                  title="2P 오프셋이 바깥으로 나갔으면 눌러 안쪽으로 반전"
                                  className="px-2 py-1 rounded-md border border-amber-300 text-amber-700 text-[10.5px] hover:bg-amber-50 whitespace-nowrap"
                                >
                                  방향 반전
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateChain(w.id, { points2P: undefined })
                                  }
                                  className="px-2 py-1 rounded-md border border-rose-200 text-rose-600 text-[10.5px] hover:bg-rose-50"
                                >
                                  2P 삭제
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {insulOn &&
                          (() => {
                            const segs = resolveSegInsul(w);
                            // select 변경 — "skip"(배치 안함) 또는 노출 프리셋/커스텀
                            const setSegMode = (edge: number, value: string) => {
                              const next = segs.map((s, i) => {
                                if (i !== edge) return s;
                                if (value === "skip")
                                  return { ...s, skip: true };
                                if (value === "custom")
                                  return { ...s, exposure: "custom" as const, skip: false };
                                const p = exposurePresets.find(
                                  pp => pp.exposure === value
                                );
                                return {
                                  ply1: p?.ply1 ?? s.ply1,
                                  ply2: p?.ply2 ?? s.ply2,
                                  exposure: value as ExposureType,
                                  skip: false,
                                };
                              });
                              updateChain(w.id, { segInsul: next });
                            };
                            const setPly = (
                              edge: number,
                              key: "ply1" | "ply2",
                              v: number
                            ) => {
                              const next = segs.map((s, i) =>
                                i === edge
                                  ? { ...s, [key]: v, exposure: "custom" as const }
                                  : s
                              );
                              updateChain(w.id, { segInsul: next });
                            };
                            return (
                              <div className="col-span-2 flex flex-col gap-1">
                                <span className="text-[9.5px] text-slate-400 font-semibold tracking-wide uppercase">
                                  세그먼트별 단열 (변마다 노출/두께 · 1P·2P 자동)
                                </span>
                                <div className="max-h-40 overflow-auto rounded border border-slate-200 divide-y divide-slate-200">
                                  {segs.map((s, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-1 px-1.5 py-1 text-[10.5px]"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const same =
                                            selectedSeg?.wallId === w.id &&
                                            selectedSeg?.edge === i;
                                          setSelectedSeg(
                                            same ? null : { wallId: w.id, edge: i }
                                          );
                                          if (!same) setCanvasTab("plan");
                                        }}
                                        className={cn(
                                          "w-7 shrink-0 text-left font-mono",
                                          selectedSeg?.wallId === w.id &&
                                            selectedSeg?.edge === i
                                            ? "text-[#004791] font-bold"
                                            : "text-slate-400"
                                        )}
                                        title="평면에서 이 변 강조"
                                      >
                                        S{i + 1}
                                      </button>
                                      <span
                                        className="w-2 h-2 rounded-sm shrink-0"
                                        style={{
                                          backgroundColor: s.skip
                                            ? "#64748b"
                                            : EXPOSURE_COLOR[s.exposure],
                                        }}
                                      />
                                      <select
                                        value={s.skip ? "skip" : s.exposure}
                                        onChange={e => setSegMode(i, e.target.value)}
                                        className="flex-1 min-w-0 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800"
                                      >
                                        {exposurePresets.map(p => (
                                          <option key={p.exposure} value={p.exposure}>
                                            {presetLabel(p)}
                                          </option>
                                        ))}
                                        <option value="custom">커스텀</option>
                                        <option value="skip">배치 안함 (선만 이음)</option>
                                      </select>
                                      <input
                                        type="number"
                                        value={s.ply1}
                                        disabled={s.skip}
                                        onChange={e =>
                                          setPly(i, "ply1", Number(e.target.value) || 0)
                                        }
                                        className="w-10 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums disabled:opacity-40"
                                        title="1P 두께(mm)"
                                      />
                                      <input
                                        type="number"
                                        value={s.ply2}
                                        disabled={s.skip}
                                        onChange={e =>
                                          setPly(i, "ply2", Number(e.target.value) || 0)
                                        }
                                        className="w-10 border border-slate-300 rounded px-1 h-6 bg-white text-slate-800 tabular-nums disabled:opacity-40"
                                        title="2P 두께(mm)"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <span className="text-[9px] text-slate-500">
                                  S# = 변 · 우측 두 칸 = 1P/2P 두께(mm). 커스텀은 직접 입력.
                                </span>
                              </div>
                            );
                          })()}
                        <button
                          type="button"
                          onClick={() => handleExportDxfFor(w.id)}
                          className="col-span-1 px-1.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-[10.5px] flex items-center justify-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          DXF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportSvgFor(w.id)}
                          className="col-span-1 px-1.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-[10.5px] flex items-center justify-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          SVG
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteChain(w.id)}
                          className="col-span-2 px-1.5 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 text-[10.5px] flex items-center justify-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          이 입면 삭제
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {parsed && (
                <button
                  type="button"
                  onClick={startNewChain}
                  className="w-full mt-1 px-2 py-1.5 rounded-md border border-dashed border-slate-300 text-slate-500 hover:bg-slate-100 text-[11px] flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  새 입면 트레이싱
                </button>
              )}
                  </div>
                </div>
              </div>
            )}

            {/* 사용법 팝업(모달) — 첫 방문 시 자동 표시, 헤더 ? 버튼으로 재열람 */}
            {helpOpen && (
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4"
                onClick={closeHelp}
              >
                <div
                  className="flex w-[min(640px,94vw)] max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  {/* 헤더 */}
                  <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#1478d6] via-[#0a63b8] to-[#003a78] px-6 py-5">
                    <div
                      className="pointer-events-none absolute inset-0 opacity-[0.14]"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
                        backgroundSize: "28px 28px",
                      }}
                    />
                    <div className="relative flex items-start justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/60">
                          How to use
                        </div>
                        <h2 className="mt-1 text-[19px] font-extrabold text-white">
                          세대 단열재 나누기도 — 사용법
                        </h2>
                        <p className="mt-1 text-[12.5px] text-white/70">
                          아래 순서대로 진행하면 도면 업로드부터 산출·저장까지 완료됩니다.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeHelp}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/15 hover:text-white"
                        title="닫기"
                      >
                        <X className="w-[18px] h-[18px]" />
                      </button>
                    </div>
                  </div>

                  {/* 단계 목록 */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                    <ol className="space-y-4">
                      {[
                        {
                          t: "DXF 업로드",
                          d: "상단 'DXF 업로드'로 평면 도면(.dxf)을 불러옵니다. 휠로 확대·축소, '화면 맞춤'으로 전체 보기.",
                        },
                        {
                          t: "외벽 트레이싱",
                          d: "'트레이싱' 모드에서 외벽선을 따라 클릭하고 Enter 또는 더블클릭으로 확정 → 전개 입면이 생성됩니다. 구조선 1개만 그리면 1P·2P가 자동 생성됩니다.",
                        },
                        {
                          t: "동·타입 설정",
                          d: "우측 '동·타입 설정'에서 동(401~405)과 타입을 등록하고, '입면 목록'에서 각 입면에 동·타입을 지정합니다.",
                        },
                        {
                          t: "오프닝(창·문) 배치",
                          d: "'오프닝 프리셋'에서 창·문을 고르고(치수 직접 수정 가능) '프리셋 배치' 모드로 벽 위를 클릭합니다. 평면의 창호 라벨(예: 18×11.8)을 클릭하면 폭·높이 자동 인식, '창호 자동'으로 일괄 배치도 가능합니다.",
                        },
                        {
                          t: "단열 설정",
                          d: "'입면 목록 크게 보기'에서 변(S#)별 노출타입(직접/간접외기)과 두께를 지정합니다. 배치 방식(물량 최소/시공성 우선)·최소 조각 폭·버림 기준은 '단열재 나누기도' 섹션에서 조정합니다.",
                        },
                        {
                          t: "산출·내보내기",
                          d: "물량 표 CSV·현장식 산출서 CSV로 수량을 뽑고, DXF 통합/분할·SVG 통합으로 도면을 내보냅니다. 'Output'에서 결과를 한눈에 확인합니다.",
                        },
                        {
                          t: "저장·이동",
                          d: "'새 프로젝트' 생성 후 '저장(새 REV)'으로 서버에 보관하고, 'REV 목록'으로 복원합니다. '내보내기'는 프로젝트를 파일(.swelev.json)로 저장하며 Smart Works 단열재와 서로 불러올 수 있습니다.",
                        },
                      ].map((s, i) => (
                        <li key={i} className="flex gap-3.5">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#004791]/8 text-[13px] font-extrabold text-[#0a63b8]">
                            {i + 1}
                          </span>
                          <div>
                            <div className="text-[14px] font-bold text-slate-800">{s.t}</div>
                            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
                              {s.d}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* 푸터 */}
                  <div className="shrink-0 flex items-center justify-between border-t border-slate-200 px-6 py-3.5">
                    <span className="text-[11.5px] text-slate-400">
                      언제든 상단 <HelpCircle className="inline w-3.5 h-3.5 -mt-0.5" /> 버튼으로 다시 볼 수 있습니다.
                    </span>
                    <button
                      type="button"
                      onClick={closeHelp}
                      className="rounded-lg bg-gradient-to-b from-[#1478d6] to-[#0a5cad] px-5 py-2 text-[13px] font-semibold text-white shadow-sm shadow-blue-900/20 hover:from-[#1a80e0] hover:to-[#0a63b8] transition-colors"
                    >
                      시작하기
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 절단판 상세 팝업 — 입면의 보드 번호 클릭 시 */}
            {boardDetail &&
              (() => {
                const sh = elevSheetsRef.current[boardDetail.sheet];
                if (!sh) return null;
                const label = sh.labels[boardDetail.ci] ?? "";
                const cell = sh.cells[boardDetail.ci];
                const L = boardLength;
                const H = boardHeight;
                const close = () => setBoardDetail(null);

                // 온장/버림/절단 그룹 분기
                const groupNo = label === "온장" || label === "버림" ? null : label.split("-")[0];
                const groupIdx: number[] = [];
                if (groupNo) {
                  sh.labels.forEach((lb, i) => {
                    if (lb === groupNo || lb.startsWith(`${groupNo}-`)) groupIdx.push(i);
                  });
                }
                const pieces = groupIdx.map(i => ({
                  w: sh.cells[i].w,
                  h: sh.cells[i].h,
                  key: `${i}`,
                }));
                const placed = groupNo ? layoutCutPieces(pieces, L, H) : [];
                const usedArea = pieces.reduce((a, p) => a + p.w * p.h, 0);
                const wasteArea = Math.max(0, L * H - usedArea);
                // SVG 배치도 스케일 (y 뒤집기: 패킹 y=아래 기준 → SVG 위 기준)
                const svgW = 420;
                const svgH = (svgW * H) / L;

                return (
                  <div className="fixed bottom-6 left-6 z-[85]">
                    <div
                      className="flex w-[min(480px,92vw)] max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_56px_-16px_rgba(15,23,42,0.4)] ring-1 ring-[#1478d6]/20"
                    >
                      <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-5 py-3">
                        <div>
                          <h2 className="text-[15px] font-bold text-slate-800">
                            {label === "온장"
                              ? "온장 (정척)"
                              : label === "버림"
                                ? "버림 조각 (폐기)"
                                : `절단판 ${groupNo} — 재단 상세`}
                          </h2>
                          <p className="mt-0.5 text-[11.5px] text-slate-400">
                            {sh.chainName} · {sh.ply}P · 온장 {L}×{H}mm
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={close}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="닫기"
                        >
                          <X className="w-[18px] h-[18px]" />
                        </button>
                      </div>

                      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                        {label === "온장" && (
                          <p className="text-[13px] leading-relaxed text-slate-600">
                            정척 온장 그대로 시공하는 판입니다 — 규격{" "}
                            <b className="tabular-nums">{L}×{H}mm</b>, 절단 없음.
                          </p>
                        )}
                        {label === "버림" && (
                          <p className="text-[13px] leading-relaxed text-slate-600">
                            버림 기준 폭보다 좁아 <b>폐기 처리</b>된 자투리(
                            <b className="tabular-nums">
                              {Math.round(cell.w)}×{Math.round(cell.h)}mm
                            </b>
                            )입니다. 물량·발주 집계에서 제외됩니다.
                          </p>
                        )}
                        {groupNo && (
                          <>
                            {/* 재단 배치도 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <svg
                                viewBox={`0 0 ${L} ${H}`}
                                style={{ width: svgW, maxWidth: "100%", height: "auto" }}
                                className="block"
                              >
                                <rect x={0} y={0} width={L} height={H} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={L / 200} />
                                {placed.map(p => {
                                  const i = Number(p.key);
                                  const isSel = i === boardDetail.ci;
                                  return (
                                    <g key={p.key}>
                                      <rect
                                        x={p.x}
                                        y={H - p.y - p.h}
                                        width={p.w}
                                        height={p.h}
                                        fill={isSel ? "#1478d6" : "#bfdbfe"}
                                        stroke="#1e5fa8"
                                        strokeWidth={L / 300}
                                      />
                                      <text
                                        x={p.x + p.w / 2}
                                        y={H - p.y - p.h / 2}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        fontSize={Math.min(p.w, p.h) * 0.32 + 20}
                                        fontWeight={700}
                                        fill={isSel ? "#ffffff" : "#1e3a5f"}
                                      >
                                        {sh.labels[i]}
                                      </text>
                                    </g>
                                  );
                                })}
                              </svg>
                              <p className="mt-1.5 text-[10.5px] text-slate-400">
                                회색 = 잔재(자투리) · 파랑 = 재단 조각 · 진한 파랑 = 선택한 조각
                              </p>
                            </div>

                            {/* 조각 목록 */}
                            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr className="bg-slate-50 text-slate-500">
                                    <th className="px-3 py-1.5 text-left font-semibold">조각</th>
                                    <th className="px-3 py-1.5 text-right font-semibold">규격(mm)</th>
                                    <th className="px-3 py-1.5 text-right font-semibold">면적(㎡)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupIdx.map(i => (
                                    <tr
                                      key={i}
                                      className={cn(
                                        "border-t border-slate-100",
                                        i === boardDetail.ci && "bg-[#e8f1fd] font-bold text-[#0a63b8]"
                                      )}
                                    >
                                      <td className="px-3 py-1.5">{sh.labels[i]}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums">
                                        {Math.round(sh.cells[i].w)}×{Math.round(sh.cells[i].h)}
                                      </td>
                                      <td className="px-3 py-1.5 text-right tabular-nums">
                                        {((sh.cells[i].w * sh.cells[i].h) / 1_000_000).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-slate-200 bg-slate-50 text-slate-500">
                                    <td className="px-3 py-1.5">잔재(자투리)</td>
                                    <td className="px-3 py-1.5 text-right">—</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">
                                      {(wasteArea / 1_000_000).toFixed(2)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                              온장 1판에서 위 조각들을 함께 재단합니다. (두께가 같은 조각끼리만 한 판에서 재단)
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* 프리셋 */}
            <Section icon={Square} title="오프닝 프리셋" accent="#d97706">
            <div className="px-2 py-1.5 space-y-1">
              {presets.map(p => {
                const active = p.id === selectedPresetId;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-md border transition-colors overflow-hidden",
                      active
                        ? "border-[#2a86e0] shadow-sm shadow-blue-900/20"
                        : "border-slate-200"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPresetId(p.id)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-[11px] flex items-center justify-between gap-2 transition-colors",
                        active
                          ? "bg-gradient-to-b from-[#1478d6] to-[#0a5cad] text-white"
                          : "hover:bg-slate-100"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-sm border"
                          style={{
                            backgroundColor: KIND_COLOR[p.kind] + "44",
                            borderColor: KIND_COLOR[p.kind],
                          }}
                        />
                        <b>{p.label}</b>
                        <span className={active ? "text-blue-100" : "text-slate-400"}>
                          ({KIND_LABEL[p.kind]})
                        </span>
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          active ? "text-blue-100" : "text-slate-500"
                        )}
                      >
                        {p.width}×{p.height}
                        {p.sill ? ` ↑${p.sill}` : ""}
                      </span>
                    </button>
                    {active && (
                      <div className="grid grid-cols-3 gap-1.5 px-2 py-2 bg-white border-t border-slate-200">
                        <LabelInput
                          label="폭"
                          control={
                            <NumberInput
                              value={p.width}
                              onChange={v => updatePreset(p.id, { width: v })}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <LabelInput
                          label="높이"
                          control={
                            <NumberInput
                              value={p.height}
                              onChange={v => updatePreset(p.id, { height: v })}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <LabelInput
                          label="SILL"
                          control={
                            <NumberInput
                              value={p.sill}
                              onChange={v => updatePreset(p.id, { sill: v })}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-3 py-1.5 border-t border-slate-200 space-y-1.5">
              <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExtract}
                  onChange={ev => setAutoExtract(ev.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <Wand2 className="w-3 h-3 text-slate-500" />
                <span className="text-slate-700">
                  근처 TEXT에서 폭×높이 자동 추출
                </span>
              </label>
              {autoExtract && (
                <div className="pl-5">
                  <LabelInput
                    label="기본 SILL (자동 인식 시 적용)"
                    control={
                      <NumberInput
                        value={defaultSill}
                        onChange={setDefaultSill}
                        suffix="mm"
                        step={50}
                        compact
                      />
                    }
                  />
                  <p className="mt-1 text-[10px] text-slate-400 leading-tight">
                    평면도의 창호 라벨(예: 18×11.8)을 클릭하면 폭/높이는 자동
                    인식되고, sill 만 위 값으로 적용됩니다.
                  </p>
                </div>
              )}
            </div>

            </Section>

            {/* 오프닝 목록 */}
            <Section icon={Layers} title={`오프닝 (${openings.length})`} accent="#059669">
            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1 min-h-0">
              {openings.length === 0 && (
                <p className="px-2 py-3 text-[11px] text-slate-400 text-center">
                  입면을 트레이싱한 뒤 벽 위를 클릭하세요.
                </p>
              )}
              {openings.map(op => {
                const active = op.id === selectedOpeningId;
                const ownerIdx = walls.findIndex(w => w.id === op.wallId);
                const owner = walls[ownerIdx];
                return (
                  <div
                    key={op.id}
                    className={cn(
                      "rounded-md border text-[11px]",
                      active
                        ? "border-[#004791] bg-[#004791]/8"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOpeningId(active ? null : op.id);
                        if (!active) setActiveWallId(op.wallId);
                      }}
                      className="w-full text-left px-2 py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: KIND_COLOR[op.kind] }}
                        />
                        <b className="truncate">
                          {op.label ?? KIND_LABEL[op.kind]}
                        </b>
                        {owner && (
                          <span
                            className="text-[9.5px] px-1 rounded"
                            style={{
                              color: chainColor(ownerIdx),
                              backgroundColor: chainColor(ownerIdx) + "22",
                            }}
                          >
                            {owner.name}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {op.width}×{op.height}
                      </span>
                    </button>
                    {active && (
                      <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
                        <LabelInput
                          label="타입"
                          control={
                            <select
                              value={op.kind}
                              onChange={ev =>
                                updateOpening(op.id, {
                                  kind: ev.target.value as OpeningKind,
                                })
                              }
                              className="text-[11px] border border-slate-300 rounded px-1.5 py-1 w-full bg-white text-slate-800"
                            >
                              <option value="window">창문</option>
                              <option value="door">문</option>
                              <option value="opening">개구부</option>
                            </select>
                          }
                        />
                        <LabelInput
                          label="위치 s"
                          control={
                            <NumberInput
                              value={Math.round(op.sAlong)}
                              onChange={v => {
                                const peri =
                                  wallMetricsById.get(op.wallId)?.total ?? 0;
                                updateOpening(op.id, {
                                  sAlong: clampS(v, op.width, peri),
                                });
                              }}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <LabelInput
                          label="폭"
                          control={
                            <NumberInput
                              value={op.width}
                              onChange={v => {
                                const peri =
                                  wallMetricsById.get(op.wallId)?.total ?? 0;
                                updateOpening(op.id, {
                                  width: v,
                                  sAlong: clampS(op.sAlong, v, peri),
                                });
                              }}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <LabelInput
                          label="높이"
                          control={
                            <NumberInput
                              value={op.height}
                              onChange={v => updateOpening(op.id, { height: v })}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <LabelInput
                          label="sill"
                          control={
                            <NumberInput
                              value={op.sill}
                              onChange={v => updateOpening(op.id, { sill: v })}
                              suffix="mm"
                              step={50}
                              compact
                            />
                          }
                        />
                        <button
                          type="button"
                          onClick={() => deleteOpening(op.id)}
                          className="self-end px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] flex items-center justify-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 레이어 */}
            <details className="border-t border-slate-200">
              <summary className="px-3 py-2 cursor-pointer flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                레이어 ({parsed?.layers.length ?? 0})
                <span className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1 font-normal text-[10.5px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={showText}
                      onChange={ev => setShowText(ev.target.checked)}
                      className="w-3 h-3"
                      onClick={e => e.stopPropagation()}
                    />
                    텍스트
                  </label>
                </span>
              </summary>
              <div className="px-2 pb-2 max-h-40 overflow-y-auto">
                {parsed?.layers.map(layer => {
                  const hidden = hiddenLayers.has(layer);
                  return (
                    <label
                      key={layer}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10.5px] cursor-pointer hover:bg-slate-100",
                        hidden && "text-slate-400"
                      )}
                    >
                      {hidden ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => toggleLayer(layer)}
                        className="w-3 h-3"
                      />
                      <span className="truncate">{layer}</span>
                    </label>
                  );
                })}
              </div>
            </details>
            </Section>
          </aside>
        </div>

        {selectedOpening && (
          <div className="text-[11px] text-slate-500 flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            선택됨: <b className="text-slate-700">{selectedOpening.label}</b> ·
            폭 {selectedOpening.width}mm · 높이 {selectedOpening.height}mm ·
            sill {selectedOpening.sill}mm
            <button
              type="button"
              onClick={() => setSelectedOpeningId(null)}
              className="ml-2 inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3 h-3" /> 해제
            </button>
          </div>
        )}

        {/* Output 통합 산출 오버레이 */}
        {outputOpen && (
          <OutputPanel
            items={wallSummaries}
            base={exportBase}
            buildDxf={buildDxfForSelected}
            onClose={() => setOutputOpen(false)}
          />
        )}
      </div>
    </>
  );
}

// ─── 보조 컴포넌트 ───
function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof MousePointer2;
  title: string;
}) {
  return (
    <div className="px-3.5 py-2.5 border-t border-slate-200 first:border-t-0 flex items-center gap-2 bg-gradient-to-r from-slate-50 to-white">
      <span className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[#004791]/10 text-[#004791] shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <h2 className="text-[12.5px] font-bold text-slate-700 tracking-tight">{title}</h2>
    </div>
  );
}

/**
 * 접이식 섹션 — 우측 컨트롤 패널의 각 영역을 카드/아코디언으로 묶는다.
 * 헤더 클릭으로 접기/펼치기(효율적 공간 활용). 기능은 children 그대로 유지.
 */
function Section({
  icon: Icon,
  title,
  right,
  defaultOpen = true,
  accent = "#004791",
  children,
}: {
  icon: typeof MousePointer2;
  title: React.ReactNode;
  /** 헤더 우측에 배치할 보조 요소(카운트 배지 등) */
  right?: React.ReactNode;
  defaultOpen?: boolean;
  /** 섹션 구분용 강조 색(왼쪽 컬러 바 · 아이콘 · 옅은 행 배경). 기본 브랜드 네이비. */
  accent?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-200 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative w-full px-3.5 py-2.5 pl-4 flex items-center gap-2 bg-gradient-to-r from-slate-50 to-white hover:from-slate-100 transition-colors text-left group overflow-hidden"
      >
        {/* 섹션 색 구분: 옅은 행 배경 틴트 + 왼쪽 컬러 바 */}
        <span
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: accent, opacity: 0.06 }}
        />
        <span
          className="pointer-events-none absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: accent }}
        />
        <span
          className="relative flex items-center justify-center w-[22px] h-[22px] rounded-md shrink-0"
          style={{ backgroundColor: accent + "22", color: accent }}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <h2 className="relative text-[12.5px] font-bold text-slate-700 tracking-tight flex-1 min-w-0">
          {title}
        </h2>
        {right}
        <ChevronDown
          className={cn(
            "relative w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof MousePointer2;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-2 py-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all",
        active
          ? "bg-gradient-to-b from-[#1478d6] to-[#0a5cad] text-white border-[#2a86e0] shadow-md shadow-blue-900/20 ring-1 ring-blue-400/30"
          : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100 hover:border-slate-400",
        disabled && "opacity-30 cursor-not-allowed hover:bg-white"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  suffix,
  step = 1,
  min = 0,
  max = 999999,
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  compact?: boolean;
}) {
  // 로컬 문자열 상태로 분리해 백스페이스/중간 입력이 끊기지 않게 한다.
  const [text, setText] = useState<string>(() =>
    Number.isFinite(value) ? String(value) : ""
  );
  const focusedRef = useRef(false);

  // 외부에서 value 가 바뀌고, 사용자가 입력 중이 아닐 때만 sync
  useEffect(() => {
    if (focusedRef.current) return;
    setText(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-") {
      setText(Number.isFinite(value) ? String(value) : "");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setText(Number.isFinite(value) ? String(value) : "");
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 border border-slate-300 rounded px-1.5 py-0.5 bg-white w-full focus-within:border-[#004791]/50 focus-within:ring-1 focus-within:ring-[#004791]/20",
        compact ? "h-6" : "h-7"
      )}
    >
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={ev => {
          focusedRef.current = true;
          ev.currentTarget.select();
        }}
        onChange={ev => {
          const raw = ev.target.value;
          // 숫자/소수점/부호만 허용
          if (!/^-?\d*\.?\d*$/.test(raw)) return;
          setText(raw);
          if (raw === "" || raw === "-" || raw === ".") return;
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const clamped = Math.max(min, Math.min(max, n));
            if (clamped !== value) onChange(clamped);
          }
        }}
        onBlur={ev => {
          focusedRef.current = false;
          commit(ev.target.value);
        }}
        onKeyDown={ev => {
          if (ev.key === "Enter") {
            (ev.target as HTMLInputElement).blur();
          } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            const next = Math.max(min, Math.min(max, (value ?? 0) + step));
            setText(String(next));
            if (next !== value) onChange(next);
          } else if (ev.key === "ArrowDown") {
            ev.preventDefault();
            const next = Math.max(min, Math.min(max, (value ?? 0) - step));
            setText(String(next));
            if (next !== value) onChange(next);
          }
        }}
        className="w-full bg-transparent outline-none text-[11px] tabular-nums text-slate-800 placeholder:text-slate-400"
      />
      {suffix && (
        <span className="text-[10px] text-slate-400 flex-shrink-0">{suffix}</span>
      )}
    </div>
  );
}

function LabelInput({
  label,
  control,
}: {
  label: string;
  control: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9.5px] text-slate-400 font-semibold tracking-wide uppercase">
        {label}
      </span>
      {control}
    </label>
  );
}
