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

/**
 * DXF 원문 → 레이어 분석 + 세션 생성.
 *
 * **base64 로 감싸지 않고 원문 그대로 보낸다.** 92MB 도면을 base64 로 바꾸면
 * 123MB 가 되고, 브라우저에서 문자열로 만드는 동안 탭이 멈춘다.
 * 서버는 내용 해시로 파싱 결과를 캐시하므로 같은 도면은 두 번째부터 즉시 응답한다.
 */
export async function analyze(dxf: ArrayBuffer, unit?: string): Promise<AnalyzeResult> {
  const res = await fetch(`${takeoffApiBase()}/analyze-raw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(unit ? { "X-Unit": unit } : {}),
    },
    body: dxf,
  });
  const json = await res.json().catch(() => ({ error: "응답을 해석할 수 없습니다" }));
  if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
  return json as AnalyzeResult;
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
  /** 스냅된 실명 (도면의 실명 텍스트) */
  name?: string | null;
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

// ── 실 자동 인식 ───────────────────────────────────────────

export interface AutoRoom {
  name: string;
  area_m2: number;
  width_mm: number;
  depth_mm: number;
  polygon: [number, number][];
  is_approximate: boolean;
  merged: boolean;
}

export interface AutoRoomsResult {
  rooms: AutoRoom[];
  failed: string[];
  total_area_m2: number;
}

/**
 * 도면의 실명 텍스트를 읽어 실 전체를 한 번에 잡는다.
 *
 * 클릭 방식은 대형 도면에서 확대·조준 자체가 고통스럽고, 라벨이 문 개구부와
 * 같은 선상이면 옆 실까지 먹는다. 이쪽은 라벨 주변 여러 점에서 광선을 쏴
 * 다수결로 정하므로 훨씬 안정적이다.
 */
export async function autoRooms(session: string): Promise<AutoRoomsResult> {
  return post<AutoRoomsResult>("/auto-rooms", { session });
}

// ── 수기 보정 ──────────────────────────────────────────────

export interface TraceVectorResult {
  ok: boolean;
  error?: string;
  name?: string;
  unit_index?: number;
  unit_type?: string | null;
  area_m2?: number;
  width_mm?: number;
  depth_mm?: number;
  polygon?: [number, number][];
  holes?: [number, number][][];
  badge?: string;
}

/**
 * 클릭 지점 → 폐합면 1개. 자동 인식이 놓친 실을 사람이 찍어 추가할 때 쓴다.
 *
 * 자동 인식과 **같은 벡터 경로**라 클릭으로 넣은 실도 같은 정확도가 나온다.
 * 폐합면이 없으면 ok:false — 임의 면적을 만들지 않는다.
 */
export async function traceVector(
  session: string,
  x: number,
  y: number,
  name?: string
): Promise<TraceVectorResult> {
  return post<TraceVectorResult>("/trace-vector", { session, x, y, name });
}

export interface AreaResult {
  ok: boolean;
  error?: string;
  area_m2?: number;
  perimeter_m?: number;
  self_intersect?: boolean;
}

/** 수기 편집된 폴리곤의 면적·둘레 재계산 (정점 드래그 후 확정 시). */
export async function areaOf(
  polygon: [number, number][],
  holes?: [number, number][][]
): Promise<AreaResult> {
  return post<AreaResult>("/area", { polygon, holes });
}

// ── AI 실 검수 (오토콘 Worker → dcr-app LLM) ───────────────

export interface RoomVerdict {
  index: number;
  verdict: "ok" | "too_big" | "too_small" | "not_a_room";
  reason: string;
  room_type?: string;
}

export interface VerifyResult {
  verdicts: RoomVerdict[];
  summary: string;
  checked: number;
  skipped: number;
}

/** 자동 인식 결과를 LLM 이 실무 통상값 기준으로 검수한다. */
export async function verifyRooms(
  rooms: { name: string; area_m2: number; width_mm: number; depth_mm: number }[],
  unitType?: string
): Promise<VerifyResult> {
  const res = await fetch("/api/takeoff/verify-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rooms, unit_type: unitType }),
  });
  const json = await res.json().catch(() => ({ error: "응답을 해석할 수 없습니다" }));
  if (!res.ok) throw new Error(json.error ?? `검수 실패 (${res.status})`);
  return json as VerifyResult;
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
