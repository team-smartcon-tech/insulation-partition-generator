/**
 * 동절기 열원검토 — 기본값.
 *
 * 숫자의 출처는 현장에서 쓰던 두 엑셀이다.
 *  - 「단위세대 동절기 열원검토」(오산세교1차, 2023.12): 정밀식 계수·열원 제원·단가·품
 *  - 「주차장 열풍기 대수 산정툴」(의정부법조): 간이식 열관류율·환기횟수·안전율
 * 현장마다 달라지는 값이라 전부 화면에서 고칠 수 있다.
 */
import type {
  Conditions,
  DrawingMeta,
  CostSettings,
  Heater,
  HeatProject,
  Zone,
  ZoneKind,
  CalcMethod,
} from "./types.ts";

export const DEFAULT_CONDITIONS: Conditions = {
  outdoorTemp: -5,
  cureTemp: 15,
  upperTemp: 10,
  upperHeight: 2,
  uConcrete: 2.5,
  uOpening: 6.02,
  uTent: 8,
  ventBaseInner: 5,
  ventBaseOuter: 10,
  fSize: 1,
  fJoint: 1.5,
  fOverlap: 1,
  fShapeApt: 1.8,
  fShapeOpen: 1.2,
  enclosureSafety: 0,
  enclosureCountRule: "roundPlus1",
  coreCountRule: "ceil",
  simpleU: 5,
  simpleAch: 0.7,
  simpleSafety: 25,
};

export const DEFAULT_HEATERS: Heater[] = [
  {
    id: "kerosene",
    name: "등유 열풍기",
    mode: "rated",
    ratedKcal: 50000,
    efficiency: 0.817,
    kcalPerUnit: 0,
    loadPerFill: 50,
    burnHours: 6,
    fuelUnit: "L",
    fuelPrice: 1537,
    rentalMonthly: 58000,
    laborMandays: 19,
    electric: false,
    minCount: 1,
    color: "#e2622b",
    note: "당사 기준 열원. 6시간마다 보충 — 야간 급열관리 인원 필요.",
  },
  {
    id: "pellet",
    name: "펠릿난로",
    mode: "fuel",
    ratedKcal: 0,
    efficiency: 1,
    kcalPerUnit: 4800,
    loadPerFill: 45,
    burnHours: 11,
    fuelUnit: "kg",
    fuelPrice: 533,
    rentalMonthly: 68000,
    laborMandays: 13,
    electric: false,
    minCount: 1,
    color: "#2f9e6e",
    note: "1회 11시간 연소 — 오후 보충 후 익일 아침 보충, 철야 인원 불필요.",
  },
  {
    id: "solid",
    name: "고체연료",
    mode: "fuel",
    ratedKcal: 0,
    efficiency: 1,
    kcalPerUnit: 6200,
    loadPerFill: 12,
    burnHours: 7,
    fuelUnit: "kg",
    fuelPrice: 1250,
    rentalMonthly: 0,
    laborMandays: 19,
    electric: false,
    minCount: 1,
    color: "#5a6b8c",
    note: "12kg/통(15,000원). 2021년 하반기부터 당사 기준에서 제외 — 비교용.",
  },
];

export const DEFAULT_COST: CostSettings = {
  cureHours: 48,
  wage: 170000,
  floorsPerMonth: 3,
  months: 3,
  buildings: 11,
};

export const ZONE_KIND_LABEL: Record<ZoneKind, string> = {
  unit: "단위세대",
  core: "코어",
  parking: "주차장·지하",
};

export const METHOD_LABEL: Record<CalcMethod, string> = {
  enclosure: "정밀식 (양생실+상옥)",
  simple: "간이식 (표면적)",
};

/** 구역 종류별 기본 산정 방식·층고 */
export const KIND_DEFAULTS: Record<ZoneKind, { method: CalcMethod; height: number }> = {
  unit: { method: "enclosure", height: 2.85 },
  core: { method: "enclosure", height: 2.85 },
  parking: { method: "simple", height: 3.6 },
};

/** 구역 색 — 도면·목록·표에서 같은 구역은 같은 색 */
export const ZONE_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#ec4899",
  "#f97316",
  "#6366f1",
];

export function zoneColor(index: number): string {
  return ZONE_COLORS[((index % ZONE_COLORS.length) + ZONE_COLORS.length) % ZONE_COLORS.length];
}

/** 목록에 있는 열원 id 면 그대로, 아니면 첫 열원 */
export function pickHeater(heaters: Heater[], id: string | undefined): string {
  return heaters.some((h) => h.id === id) ? (id as string) : heaters[0].id;
}

/** 이 구역에 적용하는 열원 */
export function appliedHeater(project: HeatProject, zone: Pick<Zone, "kind">): Heater {
  const id = project.appliedHeaters[zone.kind];
  return project.heaters.find((h) => h.id === id) ?? project.heaters[0];
}

/** 세 종류가 모두 같은 열원이면 그 id, 섞여 있으면 null */
export function uniformHeaterId(project: HeatProject): string | null {
  const { unit, core, parking } = project.appliedHeaters;
  return unit === core && core === parking ? unit : null;
}

/** 구역을 그린 도면. 표시가 없는 초기 구역은 주차장 도면에 그린 것이다 */
export function zoneSheet(z: Zone): ZoneKind {
  return z.geometry.sheet ?? "parking";
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createZone(
  kind: ZoneKind,
  name: string,
  color: number,
  geometry: Zone["geometry"],
): Zone {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    kind,
    method: KIND_DEFAULTS[kind].method,
    color,
    geometry,
    height: KIND_DEFAULTS[kind].height,
    openings: [],
    qty: 1,
    repeats: 1,
    rentalMonths: 1,
    applied: {},
    memo: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createProject(name: string): HeatProject {
  const now = new Date().toISOString();
  return {
    schemaVer: 1,
    id: newId(),
    name,
    conditions: { ...DEFAULT_CONDITIONS },
    heaters: DEFAULT_HEATERS.map((h) => ({ ...h })),
    cost: { ...DEFAULT_COST },
    zones: [],
    appliedHeaters: { unit: "kerosene", core: "kerosene", parking: "kerosene" },
    drawings: { unit: null, core: null, parking: null },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 저장된 문서를 현재 스키마로 맞춘다 — 필드가 늘어도 예전 문서가 NaN 을 내지 않게
 * 빠진 값은 기본값으로 채운다.
 */
export function normalizeProject(raw: unknown): HeatProject | null {
  if (!raw || typeof raw !== "object") return null;
  // 초기 문서는 도면이 한 장(drawing)이었다 → 주차장 도면으로 옮긴다
  // 적용 열원도 처음엔 검토서 전체에 하나(selectedHeaterId)였다 → 세 종류에 같은 값으로 옮긴다
  const {
    drawing: legacyDrawing,
    selectedHeaterId: legacyHeater,
    ...p
  } = raw as Partial<HeatProject> & { drawing?: DrawingMeta | null; selectedHeaterId?: string };
  if (typeof p.id !== "string" || typeof p.name !== "string") return null;
  const base = createProject(p.name);
  const heaters =
    Array.isArray(p.heaters) && p.heaters.length > 0
      ? p.heaters.map((h) => ({ ...DEFAULT_HEATERS[0], ...h }))
      : base.heaters;
  const zones = Array.isArray(p.zones)
    ? p.zones.map((z, i) => ({
        ...createZone(z.kind ?? "unit", z.name ?? `구역 ${i + 1}`, i, {
          source: "manual",
          polygon: null,
          dims: null,
          area: 0,
          perimeter: 0,
        }),
        ...z,
        openings: Array.isArray(z.openings) ? z.openings : [],
        applied: z.applied && typeof z.applied === "object" ? z.applied : {},
      }))
    : [];
  return {
    ...base,
    ...p,
    schemaVer: 1,
    conditions: { ...DEFAULT_CONDITIONS, ...(p.conditions ?? {}) },
    cost: { ...DEFAULT_COST, ...(p.cost ?? {}) },
    heaters,
    zones,
    appliedHeaters: {
      unit: pickHeater(heaters, p.appliedHeaters?.unit ?? legacyHeater),
      core: pickHeater(heaters, p.appliedHeaters?.core ?? legacyHeater),
      parking: pickHeater(heaters, p.appliedHeaters?.parking ?? legacyHeater),
    },
    drawings: {
      unit: p.drawings?.unit ?? null,
      core: p.drawings?.core ?? null,
      parking: p.drawings?.parking ?? legacyDrawing ?? null,
    },
  };
}
