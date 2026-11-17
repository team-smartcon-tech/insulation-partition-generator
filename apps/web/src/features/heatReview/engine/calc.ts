/**
 * 동절기 열원검토 — 계산 엔진 (순수 함수).
 *
 * 두 가지 산정식을 옮긴 것이다.
 *
 * ① 정밀식 (한중콘크리트 적용지침, 단위세대 검토서)
 *    양생실(타설층 아래 세대)과 그 위 상옥공간(천막으로 덮은 타설면 위 공간)을 따로 본다.
 *    전열손실 = 면적 × 열손실계수 × 온도차
 *    환기손실 = 0.86 × (0.35 × 환기횟수 × 체적) × 온도차
 *
 * ② 간이식 (주차장 열풍기 산정툴)
 *    전도 = 총 표면적 × 평균 열관류율 × 온도차
 *    환기 = 체적 × 환기횟수 × 0.24(공기 비열) × 1.2(공기 밀도) × 온도차
 *    합계에 안전율을 곱한다.
 *
 * 필요 대수 규칙은 두 엑셀과 현장 배치도를 따른다. 조건 탭에서 바꿀 수 있다.
 *   - 단위세대(정밀식): 반올림 + 1대 (ROUND(손실/급열,0)+1). 손실열량만 넘기는 최소 대수에 여유를 둔 것으로,
 *     세대는 벽으로 칸이 나뉘어 열이 고르게 퍼지지 않기 때문이다.
 *   - 코어(정밀식): 올림. 계단실·EV홀은 한 공간이라 여유 1대를 두지 않는다(배치도: 열풍기 1 · 펠릿 2).
 *   - 주차장·간이식: 올림 (ROUNDUP). 간이식은 안전율(기본 25%)이 이미 손실열량에 들어 있다.
 * 원본 검토서는 타입·열원마다 +1 유무가 섞여 있었다 — 여기서는 한 규칙을 모든 구역에 똑같이 쓴다.
 */
import type { Conditions, CostSettings, CountRule, Heater, HeatProject, Zone } from "../types.ts";

export interface LossItem {
  key: string;
  group: string;
  label: string;
  formula: string;
  value: number;
}

export interface ZoneLoss {
  method: Zone["method"];
  area: number;
  perimeter: number;
  height: number;
  volume: number;
  openingArea: number;
  /** 개구부를 뺀 벽면적 */
  wallArea: number;
  /** 온도차 — A 내부-외기 · B 내부-상옥 · C 상옥-외기 */
  dA: number;
  dB: number;
  dC: number;
  items: LossItem[];
  conduction: number;
  ventilation: number;
  /** 여유율(안전율) % */
  safetyPct: number;
  /** 필요 대수 규칙 */
  countRule: CountRule;
  /** 연소식 열원 기준 총 손실열량 kcal/h (여유율 포함) */
  total: number;
  /** 전기식 열원 기준 (환기손실 10%) */
  totalElectric: number;
  /** 입력이 모자라 계산할 수 없는 사유. 있으면 total 은 0 */
  issue: string | null;
}

export function openingArea(zone: Zone): number {
  return zone.openings.reduce((s, o) => s + num(o.w) * num(o.h) * num(o.count), 0);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function zoneLoss(zone: Zone, c: Conditions): ZoneLoss {
  const area = num(zone.geometry.area);
  const perimeter = num(zone.geometry.perimeter);
  const height = num(zone.height);
  const volume = area * height;
  const opening = openingArea(zone);
  const grossWall = perimeter * height;
  const wallArea = Math.max(0, grossWall - opening);
  const dA = c.cureTemp - c.outdoorTemp;
  const dB = c.cureTemp - c.upperTemp;
  const dC = c.upperTemp - c.outdoorTemp;

  const base = {
    method: zone.method,
    area,
    perimeter,
    height,
    volume,
    openingArea: opening,
    wallArea,
    dA,
    dB,
    dC,
  };

  let issue: string | null = null;
  if (area <= 0) issue = "바닥면적이 없습니다";
  else if (perimeter <= 0) issue = "둘레가 없습니다";
  else if (height <= 0) issue = "층고가 없습니다";
  else if (dA <= 0) issue = "목표 양생온도가 외기온도보다 높아야 합니다";
  else if (opening > grossWall) issue = "개구부 면적이 벽면적보다 큽니다";
  if (issue) {
    return {
      ...base,
      items: [],
      conduction: 0,
      ventilation: 0,
      safetyPct: 0,
      countRule: "ceil",
      total: 0,
      totalElectric: 0,
      issue,
    };
  }

  if (zone.method === "simple") {
    const surface = area * 2 + perimeter * height;
    const cond = surface * c.simpleU * dA;
    const vent = volume * c.simpleAch * 0.24 * 1.2 * dA;
    const k = 1 + c.simpleSafety / 100;
    return {
      ...base,
      items: [
        {
          key: "cond",
          group: "전도",
          label: "전도 열손실",
          formula: `표면적 ${fmt(surface)}㎡ × ${c.simpleU} × ${dA}℃`,
          value: cond,
        },
        {
          key: "vent",
          group: "환기",
          label: "환기 열손실",
          formula: `체적 ${fmt(volume)}㎥ × ${c.simpleAch}회/h × 0.24 × 1.2 × ${dA}℃`,
          value: vent,
        },
      ],
      conduction: cond,
      ventilation: vent,
      safetyPct: c.simpleSafety,
      countRule: "ceil",
      total: (cond + vent) * k,
      totalElectric: (cond + vent) * k,
      issue: null,
    };
  }

  // ── 정밀식 ──
  const upperWall = perimeter * c.upperHeight;
  const upperVolume = area * c.upperHeight;
  const shape = zone.kind === "parking" ? c.fShapeOpen : c.fShapeApt;
  const factor = c.fSize * c.fJoint * shape * c.fOverlap;
  const nInner = c.ventBaseInner * factor;
  const nOuter = c.ventBaseOuter * factor;

  const wall = wallArea * c.uConcrete * dA;
  const floor = area * c.uConcrete * dA;
  const ceiling = area * c.uConcrete * dB;
  const open = opening * c.uOpening * dA;
  const tentWall = upperWall * c.uTent * dC;
  const tentRoof = area * c.uTent * dC;
  const ventInner = 0.86 * (0.35 * nInner * volume) * dB;
  const ventOuter = 0.86 * (0.35 * nOuter * upperVolume) * dC;

  const conduction = wall + floor + ceiling + open + tentWall + tentRoof;
  const ventilation = ventInner + ventOuter;
  const k = 1 + c.enclosureSafety / 100;

  return {
    ...base,
    items: [
      { key: "wall", group: "양생실", label: "벽체", formula: `${fmt(wallArea)}㎡ × ${c.uConcrete} × ${dA}℃`, value: wall },
      { key: "floor", group: "양생실", label: "바닥", formula: `${fmt(area)}㎡ × ${c.uConcrete} × ${dA}℃`, value: floor },
      { key: "ceiling", group: "양생실", label: "천장", formula: `${fmt(area)}㎡ × ${c.uConcrete} × ${dB}℃`, value: ceiling },
      { key: "open", group: "양생실", label: "벽 개구부", formula: `${fmt(opening)}㎡ × ${c.uOpening} × ${dA}℃`, value: open },
      { key: "tentWall", group: "상옥공간", label: "천막 벽체", formula: `${fmt(upperWall)}㎡ × ${c.uTent} × ${dC}℃`, value: tentWall },
      { key: "tentRoof", group: "상옥공간", label: "천막 천장", formula: `${fmt(area)}㎡ × ${c.uTent} × ${dC}℃`, value: tentRoof },
      { key: "ventInner", group: "환기", label: "내부공간 환기", formula: `0.86 × 0.35 × ${fmt(nInner)}회 × ${fmt(volume)}㎥ × ${dB}℃`, value: ventInner },
      { key: "ventOuter", group: "환기", label: "상옥공간 환기", formula: `0.86 × 0.35 × ${fmt(nOuter)}회 × ${fmt(upperVolume)}㎥ × ${dC}℃`, value: ventOuter },
    ],
    conduction,
    ventilation,
    safetyPct: c.enclosureSafety,
    countRule:
      zone.kind === "unit"
        ? c.enclosureCountRule === "ceil"
          ? "ceil"
          : "roundPlus1"
        : zone.kind === "core"
          ? c.coreCountRule === "roundPlus1"
            ? "roundPlus1"
            : "ceil"
          : "ceil",
    total: (conduction + ventilation) * k,
    totalElectric: (conduction + ventilation * 0.1) * k,
    issue: null,
  };
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("ko-KR");
}

/** 열원 1대의 시간당 급열량 kcal/h */
export function heaterOutput(h: Heater): number {
  if (h.mode === "rated") return num(h.ratedKcal) * num(h.efficiency);
  return h.burnHours > 0 ? (num(h.kcalPerUnit) * num(h.loadPerFill)) / h.burnHours : 0;
}

export interface HeaterNeed {
  heaterId: string;
  /** 이 열원이 감당해야 하는 손실열량 */
  required: number;
  output: number;
  /** 산정 대수 (규칙·최소 대수 반영) */
  count: number;
  /** 적용 대수 — 사용자가 지정했으면 그 값 */
  applied: number;
  overridden: boolean;
  supply: number;
  /** 여유율 % = (급열량 − 손실열량) ÷ 손실열량 */
  marginPct: number;
  ok: boolean;
}

export function heaterNeed(loss: ZoneLoss, heater: Heater, zone: Zone): HeaterNeed {
  const required = heater.electric ? loss.totalElectric : loss.total;
  const output = heaterOutput(heater);
  let count = 0;
  if (required > 0 && output > 0) {
    const ratio = required / output;
    const byRule = loss.countRule === "roundPlus1" ? Math.floor(ratio + 0.5) + 1 : Math.ceil(ratio - 1e-9);
    count = Math.max(byRule, Math.max(1, Math.round(num(heater.minCount))));
  }
  const custom = zone.applied?.[heater.id];
  const overridden = typeof custom === "number" && Number.isFinite(custom) && custom >= 0;
  const applied = overridden ? Math.round(custom) : count;
  const supply = applied * output;
  return {
    heaterId: heater.id,
    required,
    output,
    count,
    applied,
    overridden,
    supply,
    marginPct: required > 0 ? ((supply - required) / required) * 100 : 0,
    ok: required > 0 && supply >= required,
  };
}

// ── 비용 ─────────────────────────────────────────────────────────────────────

export interface ZoneCostRow {
  zoneId: string;
  /** 이 구역에 쓴 열원 */
  heaterId: string;
  /** 구역 1개당 적용 대수 */
  perZone: number;
  /** 1회 타설 대수 = 적용 대수 × 구역 수 */
  units: number;
  /** 1회 타설 연료량 */
  fuel: number;
  fuelCost: number;
  ok: boolean;
}

export interface CostBlock {
  /** 1회 타설 대수 */
  units: number;
  fuel: number;
  fuelCost: number;
  rental: number;
  labor: number;
  /** 투입 인원 품 */
  mandays: number;
  /** 1회 타설 합계 */
  perPour: number;
  /** 동절기 반복 횟수 */
  repeats: number;
  season: number;
}

export interface HeaterCost {
  /** 열원 id. 종류별로 다른 열원을 쓴 적용 계획이면 "plan" */
  heaterId: string;
  rows: ZoneCostRow[];
  /** 기준층(세대·코어) — 1개층이 1회 타설 */
  floor: CostBlock | null;
  /** 주차장·지하 — 구역별로 따로 타설 */
  parking: (CostBlock & { zoneId: string })[];
  seasonFuelCost: number;
  seasonRental: number;
  seasonLabor: number;
  seasonTotal: number;
  /** 동시에 깔리는 최대 대수 (기준층 1개층 + 주차장 합) */
  peakUnits: number;
  /** 열원별 동시 배치 대수·동절기 연료량 */
  byHeater: Record<string, { units: number; seasonFuel: number }>;
  /** 모든 구역이 급열량 ≥ 손실열량인가 */
  allOk: boolean;
}

/** 기준층 반복 횟수 = 월 타설 층수 × 개월 × 동 수 */
export function floorRepeats(cost: CostSettings): number {
  return Math.max(0, num(cost.floorsPerMonth)) * Math.max(0, num(cost.months)) * Math.max(0, num(cost.buildings));
}

/**
 * 구역마다 열원을 골라 비용을 낸다.
 *
 * 기준층 인건비는 그 층에 쓴 열원 중 **품이 가장 큰 것** 하나만 센다 — 급열관리 인원은 열원 종류마다
 * 따로 두는 게 아니라 한 조가 층 전체를 본다(야간 관리가 필요한 열원이 하나라도 있으면 야간조가 붙는다).
 */
export function costWith(project: HeatProject, assign: (zone: Zone) => Heater, id: string): HeaterCost {
  const { cost, conditions } = project;
  const wage = num(cost.wage);
  const fuelPerUnit = (h: Heater) => (h.burnHours > 0 ? (num(cost.cureHours) / h.burnHours) * num(h.loadPerFill) : 0);

  const rows: ZoneCostRow[] = [];
  const byId = new Map<string, ZoneCostRow>();
  const heaterOf = new Map<string, Heater>();
  let allOk = true;
  for (const z of project.zones) {
    const h = assign(z);
    heaterOf.set(z.id, h);
    const need = heaterNeed(zoneLoss(z, conditions), h, z);
    const units = need.applied * Math.max(0, num(z.qty));
    const fuel = units * fuelPerUnit(h);
    const row: ZoneCostRow = {
      zoneId: z.id,
      heaterId: h.id,
      perZone: need.applied,
      units,
      fuel,
      fuelCost: fuel * num(h.fuelPrice),
      ok: need.ok,
    };
    if (!need.ok) allOk = false;
    rows.push(row);
    byId.set(z.id, row);
  }

  const byHeater: HeaterCost["byHeater"] = {};
  const tally = (h: Heater, units: number, seasonFuel: number) => {
    const t = (byHeater[h.id] ??= { units: 0, seasonFuel: 0 });
    t.units += units;
    t.seasonFuel += seasonFuel;
  };

  // 기준층: 세대·코어 구역을 한 층으로 묶는다
  const floorZones = project.zones.filter((z) => z.kind !== "parking");
  let floor: CostBlock | null = null;
  if (floorZones.length > 0) {
    const repeats = floorRepeats(cost);
    const perMonth = Math.max(1, num(cost.floorsPerMonth));
    let units = 0;
    let fuel = 0;
    let fuelCost = 0;
    let rental = 0;
    let mandays = 0;
    for (const z of floorZones) {
      const row = byId.get(z.id)!;
      const h = heaterOf.get(z.id)!;
      units += row.units;
      fuel += row.fuel;
      fuelCost += row.fuelCost;
      // 한 동에 한 층 분량을 두고 한 달에 여러 층을 돌려 쓴다 → 층당 임대료 = 월 임대료 ÷ 월 타설 층수
      rental += (row.units * num(h.rentalMonthly)) / perMonth;
      mandays = Math.max(mandays, num(h.laborMandays));
      tally(h, row.units, row.fuel * repeats);
    }
    const labor = mandays * wage;
    const perPour = fuelCost + rental + labor;
    floor = { units, fuel, fuelCost, rental, labor, mandays, perPour, repeats, season: perPour * repeats };
  }

  const parking = project.zones
    .filter((z) => z.kind === "parking")
    .map((z) => {
      const row = byId.get(z.id)!;
      const h = heaterOf.get(z.id)!;
      const repeats = Math.max(0, num(z.repeats));
      const rentalSeason = row.units * num(h.rentalMonthly) * Math.max(0, num(z.rentalMonths));
      const rental = repeats > 0 ? rentalSeason / repeats : rentalSeason;
      const mandays = num(h.laborMandays);
      const labor = mandays * wage;
      tally(h, row.units, row.fuel * repeats);
      return {
        zoneId: z.id,
        units: row.units,
        fuel: row.fuel,
        fuelCost: row.fuelCost,
        rental,
        labor,
        mandays,
        perPour: row.fuelCost + rental + labor,
        repeats,
        season: row.fuelCost * repeats + rentalSeason + labor * repeats,
      };
    });

  const blocks: CostBlock[] = [...(floor ? [floor] : []), ...parking];
  const seasonFuelCost = blocks.reduce((s, b) => s + b.fuelCost * b.repeats, 0);
  const seasonLabor = blocks.reduce((s, b) => s + b.labor * b.repeats, 0);
  const seasonTotal = blocks.reduce((s, b) => s + b.season, 0);

  return {
    heaterId: id,
    rows,
    floor,
    parking,
    seasonFuelCost,
    seasonRental: seasonTotal - seasonFuelCost - seasonLabor,
    seasonLabor,
    seasonTotal,
    peakUnits: blocks.reduce((s, b) => s + b.units, 0),
    byHeater,
    allOk,
  };
}

/** 모든 구역에 이 열원 하나만 쓸 때 */
export function heaterCost(project: HeatProject, heater: Heater): HeaterCost {
  return costWith(project, () => heater, heater.id);
}

/** 적용 계획 — 구역 종류별로 지정한 열원을 쓸 때 */
export function planCost(project: HeatProject): HeaterCost {
  const byKind = (z: Zone) =>
    project.heaters.find((h) => h.id === project.appliedHeaters[z.kind]) ?? project.heaters[0];
  return costWith(project, byKind, "plan");
}

export interface ProjectSummary {
  zoneCount: number;
  totalArea: number;
  /** 구역 수(qty)를 곱한 손실열량 합 kcal/h */
  totalLoss: number;
  /** 열원 하나만 썼을 때의 금액 (비교용) */
  costs: HeaterCost[];
  /** 적용 계획(종류별 열원)의 금액 */
  plan: HeaterCost;
  /** 동절기 금액이 가장 낮은 열원 (금액이 0보다 큰 것 중) */
  cheapestId: string | null;
}

export function summarize(project: HeatProject): ProjectSummary {
  let totalArea = 0;
  let totalLoss = 0;
  for (const z of project.zones) {
    const loss = zoneLoss(z, project.conditions);
    totalArea += loss.area * Math.max(0, num(z.qty));
    totalLoss += loss.total * Math.max(0, num(z.qty));
  }
  const costs = project.heaters.map((h) => heaterCost(project, h));
  const priced = costs.filter((c) => c.seasonTotal > 0);
  const cheapest = priced.length
    ? priced.reduce((a, b) => (b.seasonTotal < a.seasonTotal ? b : a))
    : null;
  return {
    zoneCount: project.zones.length,
    totalArea,
    totalLoss,
    costs,
    plan: planCost(project),
    cheapestId: cheapest?.heaterId ?? null,
  };
}
