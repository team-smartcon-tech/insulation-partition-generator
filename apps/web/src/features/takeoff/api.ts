/**
 * 마감 물량 산출 엔진 API 클라이언트.
 *
 * 엔진은 UI 비의존 Python 패키지(`engine/finish_takeoff`)이며, 이 파일이 유일한 접점이다.
 * 로컬 개발: `python -m finish_takeoff.server` (기본 127.0.0.1:8901)
 */

const DEFAULT_BASE = "http://127.0.0.1:8901";

/** 엔진 주소 — 배포 시 `VITE_TAKEOFF_API` 로 덮어쓴다. */
export const takeoffApiBase = (): string =>
  (import.meta.env.VITE_TAKEOFF_API as string | undefined) ?? DEFAULT_BASE;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${takeoffApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "응답을 해석할 수 없습니다" }));
  if (!res.ok) throw new Error(json.error ?? `요청 실패 (${res.status})`);
  return json as T;
}

export async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${takeoffApiBase()}/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

// ── 도면 분석 ──────────────────────────────────────────────

export interface WallCandidate {
  layer: string;
  lines: number;
  median_mm: number;
  score: number;
  why: string;
}

export interface AnalyzeResult {
  session: string;
  drawing: {
    insunits: number;
    unit_scale: number;
    unit_source: "header" | "bbox_guess" | "user";
    entities: number;
    layers: number;
    layers_with_entities: number;
    bbox_mm: [number, number, number, number];
    is_large: boolean;
    max_insert_depth: number;
    mirrored_inserts: number;
    unresolved_xref: boolean;
  };
  wall_candidates: WallCandidate[];
  preset: Record<string, string[]>;
  top_layers: { layer: string; total: number; lines: number; median_mm: number }[];
}

/** DXF 원문(ArrayBuffer) → 레이어 분석 + 세션 생성 */
export async function analyze(dxf: ArrayBuffer, unit?: string): Promise<AnalyzeResult> {
  let bin = "";
  const bytes = new Uint8Array(dxf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return post<AnalyzeResult>("/analyze", { dxf_base64: btoa(bin), unit });
}

// ── 실 추적 ────────────────────────────────────────────────

export interface TraceWarning {
  code: string;
  message: string;
}

export interface TraceResult {
  ok: boolean;
  method: "vector" | "raster";
  area_m2?: number;
  perimeter_m?: number;
  polygon?: [number, number][];
  holes?: [number, number][][];
  click?: [number, number];
  is_approximate?: boolean;
  touched_border?: boolean;
  warnings: TraceWarning[];
}

/** 클릭점(mm) → 실 추적. 벡터 실패 시 래스터 폴백(근사추적 배지 필요). */
export async function trace(
  session: string,
  x: number,
  y: number,
  opts?: { name?: string; allowRaster?: boolean }
): Promise<TraceResult> {
  return post<TraceResult>("/trace", {
    session,
    x,
    y,
    name: opts?.name,
    allow_raster: opts?.allowRaster ?? true,
  });
}

// ── 물량 산출 ──────────────────────────────────────────────

export interface QuantityLineDto {
  kind: string;
  raw: number;
  with_waste: number;
  unit: string;
  count: number | null;
  note: string;
}

export interface RoomTakeoffDto {
  name: string;
  area_m2: number;
  pyeong: number;
  perimeter_m: number;
  is_approximate: boolean;
  lines: QuantityLineDto[];
}

export interface TakeoffResult {
  rooms: RoomTakeoffDto[];
  summary: QuantityLineDto[];
  total_area_m2: number;
}

export interface RoomInput {
  name: string;
  polygon: [number, number][];
  holes?: [number, number][][];
  is_approximate?: boolean;
  ceiling_height_mm?: number;
  openings?: { width_mm: number; height_mm: number; kind?: "door" | "window" }[];
}

/** 할증률·천장고 등 적산 기준 — 회사 기준으로 덮어쓴다(하드코딩 금지). */
export interface TakeoffSettingsDto {
  ceiling_height_mm?: number;
  waste_sheet_floor?: number;
  waste_floor_tile?: number;
  waste_wallpaper?: number;
  waste_ceiling?: number;
  waste_baseboard?: number;
  tile_w_mm?: number;
  tile_h_mm?: number;
}

export async function takeoff(
  rooms: RoomInput[],
  settings?: TakeoffSettingsDto
): Promise<TakeoffResult> {
  return post<TakeoffResult>("/takeoff", { rooms, settings: settings ?? {} });
}

// ── 세대 대장 ──────────────────────────────────────────────

export interface UnitDto {
  key: string;
  building: string;
  floor: number;
  unit_no: string;
  line: string;
  unit_type: string;
}

export interface RegistryResult {
  count: number;
  type_counts: Record<string, number>;
  buildings: string[];
  units: UnitDto[];
  errors?: string[];
}

/** 규칙 생성 — 동 + 층범위 + 라인별 타입 (필로티·결번 제외 가능) */
export async function registryFromRule(input: {
  buildings: string[];
  floor_from: number;
  floor_to: number;
  line_types: Record<string, string>;
  exclude_floors?: number[];
  exclude_units?: string[];
}): Promise<RegistryResult> {
  return post<RegistryResult>("/registry/rule", input);
}

/** Excel 붙여넣기 (동/층/호/타입 4열) */
export async function registryFromPaste(text: string): Promise<RegistryResult> {
  return post<RegistryResult>("/registry/paste", { text });
}

// ── 기성 ───────────────────────────────────────────────────

export interface ParsePreview {
  ok: boolean;
  summary: string;
  count: number;
  errors: { line: number; token: string; message: string }[];
  missing: string[];
  matched: (UnitDto & { ratio: number })[];
}

/** 범위 문자열 → 매칭 세대 미리보기. **확인 전 적용 금지.** */
export async function parseRange(units: UnitDto[], text: string): Promise<ParsePreview> {
  return post<ParsePreview>("/billing/parse", { units, text });
}

export interface BillingLineDto {
  unit: string;
  building: string;
  floor: number;
  unit_no: string;
  type: string;
  work: string;
  work_name: string;
  unit_qty: number;
  prev_ratio: number;
  cum_ratio: number;
  current: number;
  cum: number;
  remain: number;
}

export interface BillingResultDto {
  by_work: Record<string, Record<string, number>>;
  by_building: Record<string, Record<string, number>>;
  lines: BillingLineDto[];
  validation: {
    can_lock: boolean;
    summary: string;
    issues: {
      severity: "error" | "warning" | "info";
      code: string;
      message: string;
      unit: string;
      work: string;
    }[];
  };
  works: { code: string; name: string }[];
}

export async function computeBilling(input: {
  units: UnitDto[];
  progress: { period: number; unit_key: string; work: string; ratio: number }[];
  quantities: Record<string, { by_work: Record<string, number>; contract?: Record<string, number> }>;
  period: { seq: number; title?: string; cutoff?: string; locked?: boolean };
  prev_period?: { seq: number; title?: string; cutoff?: string };
  prev_snapshot?: Record<string, number>;
}): Promise<BillingResultDto> {
  return post<BillingResultDto>("/billing/compute", input);
}
