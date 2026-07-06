/**
 * DXF 파싱 어댑터 — @jakkelab-aec/rw-dxf-engine-ts 기반.
 *
 * DXF 텍스트를 렌더러 씬 엔티티(DXFSceneEntity[])로 변환한 뒤,
 * 앱 내부에서 쓰는 정규화 형태(ParsedDxf)로 매핑한다.
 * - sceneEntities: Three.js 캔버스(PlanDxfCanvas)가 그대로 사용
 * - entities/snapPoints/bounds/layers: 스냅·창호 크기 자동추출·상태바 등 기존 파이프라인 사용
 * - 블록(INSERT) 내부 지오메트리는 라이브러리가 전개해 주므로 스냅/표시 대상에 포함됨
 *   (구 dxf-parser 경로에서는 블록 내부가 무시되었음)
 */
import { DXFReader } from "@jakkelab-aec/rw-dxf-engine-ts";
import {
  buildDXFSceneEntities,
  type DXFSceneEntity,
} from "@jakkelab-aec/rw-dxf-engine-ts/renderer";
import type { Point2D } from "./geometry";

// ── 앱 내부 정규화 타입 (ElevationGeneratorPage 에서 이전) ──

interface NormalizedBase {
  id: string;
  layer: string;
  color: string;
  /** 원본 DXF 텍스트에서 이 엔티티가 차지하는 라인 범위 (1-based, 양끝 포함) */
  startLine: number;
  endLine: number;
  /**
   * ENTITIES 섹션의 최상위 엔티티만 true.
   * 블록(INSERT) 전개로 나온 엔티티는 소스가 BLOCKS 섹션(블록 정의)이라
   * 개별 수정 시 모든 인스턴스가 함께 바뀌므로 편집 대상에서 제외한다.
   */
  editable: boolean;
}

export type NormalizedEntity = NormalizedBase &
  (
    | { kind: "line"; a: Point2D; b: Point2D }
    | { kind: "polyline"; points: Point2D[]; closed: boolean }
    | { kind: "circle"; center: Point2D; radius: number }
    | { kind: "arc"; center: Point2D; radius: number; start: number; end: number }
    | { kind: "text"; pos: Point2D; text: string }
  );

export interface ParsedDxf {
  entities: NormalizedEntity[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  layers: string[];
  warnings: string[];
  snapPoints: Point2D[];
  /** Three.js 캔버스 렌더 입력 — DXFImportedObject3D 생성자에 그대로 전달 */
  sceneEntities: DXFSceneEntity[];
}

// ── DXF 색상 (ACI → 화면용 hex, 다크 배경 기준 팔레트) ──
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

function entityColorHex(e: DXFSceneEntity, fallback = "#cbd5e1"): string {
  if (typeof e.trueColor === "number") {
    return `#${e.trueColor.toString(16).padStart(6, "0")}`;
  }
  const aci = e.colorIndex;
  if (!aci || aci === 256) return fallback;
  return ACI_COLORS[aci] ?? fallback;
}

const SCENE_LIMITS = {
  maxEntities: 50000,
  maxPoints: 500000,
  maxBlockDepth: 4,
} as const;

/**
 * DXF 텍스트 → ParsedDxf. 구조적으로 파싱 불가능한 입력이면 throw
 * (기존 DxfParser.parseSync 와 동일하게 호출부 catch 에서 parseError 처리).
 */
export function parseDxfText(text: string): ParsedDxf {
  const validation = DXFReader.validate(text);
  if (!validation.document) {
    const first = validation.issues.find(i => i.severity === "error");
    throw new Error(first ? `${first.reason} (line ${first.line})` : "DXF 파싱 실패");
  }

  const sceneEntities = buildDXFSceneEntities(validation, SCENE_LIMITS);

  // ENTITIES 섹션 라인 범위 — 이 안의 최상위 엔티티만 편집 가능
  const entSection = validation.document.sections.find(
    s => s.name === "ENTITIES"
  );

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

  for (const e of sceneEntities) {
    const layer = e.layer || "0";
    layerSet.add(layer);
    const color = entityColorHex(e);
    const base: Omit<NormalizedBase, "layer" | "color"> = {
      id: e.id,
      startLine: e.startLine,
      endLine: e.endLine,
      editable:
        !!entSection &&
        e.startLine >= entSection.startLine &&
        e.endLine <= entSection.endLine,
    };
    switch (e.type) {
      case "LINE": {
        const [p0, p1] = e.points;
        if (!p0 || !p1) break;
        const a = { x: p0.x, y: p0.y };
        const b = { x: p1.x, y: p1.y };
        if ([a.x, a.y, b.x, b.y].every(Number.isFinite)) {
          addBound(a);
          addBound(b);
          // 끝점 + 중점(개구부 중앙 등 정밀 배치 보조)
          snapPoints.push(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          entities.push({ ...base, kind: "line", layer, color, a, b });
        }
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const pts: Point2D[] = e.points
          .map(v => ({ x: v.x, y: v.y }))
          .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
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
            ...base,
            kind: "polyline",
            layer,
            color,
            points: pts,
            closed: !!e.closed,
          });
        }
        break;
      }
      case "CIRCLE": {
        const c0 = e.points[0];
        const r = e.radius;
        if (
          c0 &&
          Number.isFinite(c0.x) &&
          Number.isFinite(c0.y) &&
          Number.isFinite(r)
        ) {
          const c = { x: c0.x, y: c0.y };
          addBound({ x: c.x - r!, y: c.y - r! });
          addBound({ x: c.x + r!, y: c.y + r! });
          entities.push({
            ...base,
            kind: "circle",
            layer,
            color,
            center: c,
            radius: r!,
          });
        }
        break;
      }
      case "ARC": {
        const c0 = e.points[0];
        const r = e.radius;
        // 씬 엔티티의 각도는 도(degree) 단위 → 라디안 변환
        const start = ((e.startAngle ?? 0) * Math.PI) / 180;
        const end = ((e.endAngle ?? 0) * Math.PI) / 180;
        if (
          c0 &&
          Number.isFinite(c0.x) &&
          Number.isFinite(c0.y) &&
          Number.isFinite(r)
        ) {
          const c = { x: c0.x, y: c0.y };
          addBound({ x: c.x - r!, y: c.y - r! });
          addBound({ x: c.x + r!, y: c.y + r! });
          entities.push({
            ...base,
            kind: "arc",
            layer,
            color,
            center: c,
            radius: r!,
            start,
            end,
          });
        }
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const p0 = e.points[0];
        if (p0 && Number.isFinite(p0.x) && Number.isFinite(p0.y)) {
          const pos = { x: p0.x, y: p0.y };
          addBound(pos);
          entities.push({
            ...base,
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
    sceneEntities,
  };
}
