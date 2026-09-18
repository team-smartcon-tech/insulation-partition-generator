/**
 * 임대구간 산정 — 이 도구의 핵심.
 *
 * 규칙의 뿌리는 스마트웍스 네트워크 공정표의 공통가설 표준이다:
 *   T/C      설치 40일 → 유지관리(= 임대) → 해체 30일
 *   호이스트 설치 20일(앵커: 지상 4층 완료) → 유지관리 → 해체 20일
 * 이 도구는 그 규칙을 **현장 1세트 → 호기별 N세트**로 확장한다.
 *
 * **해체 시점은 회사 산정표를 따른다** — 마감 공정을 추정해 미는 대신 옥탑 골조완료를 물고
 * 개월로 센다. T/C 는 골조완료 + 1개월(전 동 동일), 호이스트는 동별 골조완료 + 4개월.
 */

import type {
  Assignment,
  BuildingFrameProfile,
  EquipmentUnit,
  IdleGap,
  RentalParams,
  RentalSpan,
} from "../types";
import { addDays, addMonths, diffDays, inclusiveDays, maxYmd, minYmd } from "./dates";
import { floorFinish, frameFinish, frameStart } from "./profile";

/** 호기에 배정된 동 목록 */
export function buildingsOfUnit(
  unit: EquipmentUnit,
  buildings: BuildingFrameProfile[],
  assignments: Assignment[],
): BuildingFrameProfile[] {
  const ids = new Set(assignments.filter((a) => a.unitId === unit.id).map((a) => a.buildingId));
  return buildings.filter((b) => ids.has(b.id));
}

/**
 * 담당 동들의 골조 구간 사이에서 비어 있는 기간을 찾는다.
 * 장비가 현장에 서 있기만 하는 구간이라 곧바로 낭비 비용이 된다 —
 * 이 경고가 이 도구를 쓰는 가장 큰 이유다.
 */
function findIdleGaps(targets: BuildingFrameProfile[], params: RentalParams): IdleGap[] {
  const spans = targets
    .map((b) => ({ name: b.name, start: frameStart(b), finish: frameFinish(b) }))
    .filter((s): s is { name: string; start: string; finish: string } => !!s.start && !!s.finish)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const gaps: IdleGap[] = [];
  if (spans.length < 2) return gaps;
  // 앞에서부터 훑으며 "지금까지 덮은 가장 늦은 종료일" 뒤로 떨어진 구간만 잡는다
  let covered = spans[0].finish;
  let coveredBy = spans[0].name;
  for (let i = 1; i < spans.length; i += 1) {
    const gapDays = diffDays(covered, spans[i].start) - 1;
    if (gapDays >= params.idleWarnDays) {
      gaps.push({
        from: addDays(covered, 1),
        to: addDays(spans[i].start, -1),
        days: gapDays,
        afterBuilding: coveredBy,
        beforeBuilding: spans[i].name,
      });
    }
    if (spans[i].finish > covered) {
      covered = spans[i].finish;
      coveredBy = spans[i].name;
    }
  }
  return gaps;
}

function emptySpan(unit: EquipmentUnit, problem: string): RentalSpan {
  return {
    unitId: unit.id,
    kind: unit.kind,
    no: unit.no,
    buildingIds: [],
    buildingNames: [],
    mobilizeStart: "",
    activeStart: "",
    activeEnd: "",
    demobEnd: "",
    rentalDays: 0,
    rentalMonths: 0,
    idleGaps: [],
    problem,
  };
}

/** 타워크레인 1대의 임대 구간 */
export function calcTowerCraneSpan(
  unit: EquipmentUnit,
  targets: BuildingFrameProfile[],
  params: RentalParams,
): RentalSpan {
  if (targets.length === 0) return emptySpan(unit, "담당 동이 없습니다");
  const starts = targets.map((b) => frameStart(b));
  const finishes = targets.map((b) => frameFinish(b));
  const first = minYmd(starts);
  const last = maxYmd(finishes);
  if (!first || !last) return emptySpan(unit, "담당 동에 골조 일정이 없습니다");

  // 골조 착수 전에 이미 서 있어야 한다 — 리드타임만큼 앞당기고, 그 앞이 설치 기간이다
  const activeStart = addDays(first, -params.tc.leadDays);
  const mobilizeStart = addDays(activeStart, -params.tc.installDays);
  // 골조가 끝나도 잔여 양중(갱폼 해체·자재 반출)이 남는다 — 회사 기준 1개월
  const activeEnd = addMonths(last, params.tc.postFrameMonths);
  const demobEnd = addDays(activeEnd, params.tc.dismantleDays);

  const rentalDays = inclusiveDays(mobilizeStart, demobEnd);
  return {
    unitId: unit.id,
    kind: "tc",
    no: unit.no,
    buildingIds: targets.map((b) => b.id),
    buildingNames: targets.map((b) => b.name),
    mobilizeStart,
    activeStart,
    activeEnd,
    demobEnd,
    rentalDays,
    rentalMonths: Math.ceil(rentalDays / 30),
    idleGaps: findIdleGaps(targets, params),
  };
}

/** 호이스트 1대의 임대 구간 */
export function calcHoistSpan(
  unit: EquipmentUnit,
  targets: BuildingFrameProfile[],
  params: RentalParams,
): RentalSpan {
  if (targets.length === 0) return emptySpan(unit, "담당 동이 없습니다");

  // 설치 앵커 — 담당 동 각각의 "지상 N층 완료" 중 가장 이른 날.
  // 기준층은 동별 값이 우선이고, 없으면 파라미터 기본값을 쓴다.
  const anchorDates = targets.map(
    (b) => floorFinish(b, b.hoistAnchorFloor ?? params.hc.anchorFloor) ?? frameStart(b),
  );
  const anchor = minYmd(anchorDates);
  if (!anchor) return emptySpan(unit, "담당 동에 골조 일정이 없습니다");

  // 종료 기준 — **동별 옥탑 골조완료 + N개월**. 개월 수는 동별 값이 우선한다.
  const endDates = targets.map((b) => {
    const f = frameFinish(b);
    if (!f) return null;
    return addMonths(f, b.hoistPostFrameMonths ?? params.hc.postFrameMonths);
  });
  const activeEnd = maxYmd(endDates);
  if (!activeEnd) return emptySpan(unit, "담당 동에 골조 일정이 없습니다");

  const mobilizeStart = anchor;
  const activeStart = addDays(anchor, params.hc.installDays);
  const demobEnd = addDays(activeEnd, params.hc.dismantleDays);

  const rentalDays = inclusiveDays(mobilizeStart, demobEnd);
  return {
    unitId: unit.id,
    kind: "hc",
    no: unit.no,
    buildingIds: targets.map((b) => b.id),
    buildingNames: targets.map((b) => b.name),
    mobilizeStart,
    activeStart,
    activeEnd,
    demobEnd,
    rentalDays,
    rentalMonths: Math.ceil(rentalDays / 30),
    // 호이스트는 설치 후 마감까지 계속 쓰므로 골조 공백이 곧 유휴는 아니다
    idleGaps: [],
  };
}

export function calcAllSpans(
  units: EquipmentUnit[],
  buildings: BuildingFrameProfile[],
  assignments: Assignment[],
  params: RentalParams,
): RentalSpan[] {
  return units
    .slice()
    .sort((a, b) => (a.kind === b.kind ? a.no - b.no : a.kind === "tc" ? -1 : 1))
    .map((unit) => {
      const targets = buildingsOfUnit(unit, buildings, assignments);
      return unit.kind === "tc"
        ? calcTowerCraneSpan(unit, targets, params)
        : calcHoistSpan(unit, targets, params);
    });
}

/** 월별 동시 투입 대수 — 피크가 현장 관리 부하이자 계약 협상의 근거가 된다 */
export interface MonthlyLoad {
  ym: string; // "2027-03"
  tc: number;
  hc: number;
}

export function monthlyLoad(spans: RentalSpan[]): MonthlyLoad[] {
  const valid = spans.filter((s) => s.mobilizeStart && s.demobEnd);
  if (valid.length === 0) return [];
  const from = minYmd(valid.map((s) => s.mobilizeStart))!;
  const to = maxYmd(valid.map((s) => s.demobEnd))!;
  const out: MonthlyLoad[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  for (let guard = 0; guard < 600; guard += 1) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const monthStart = `${ym}-01`;
    const monthEnd = `${ym}-28`; // 겹침 판정에는 말일 정확도가 필요 없다
    const active = valid.filter((s) => s.mobilizeStart <= monthEnd && s.demobEnd >= monthStart);
    out.push({
      ym,
      tc: active.filter((s) => s.kind === "tc").length,
      hc: active.filter((s) => s.kind === "hc").length,
    });
    if (y === endY && m === endM) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * 호기 자동 제안 — 골조 구간이 겹치지 않는 동끼리 한 대로 묶는 그리디.
 *
 * 최적해를 보장하지 않는다(구간 그래프 색칠 문제라 정확해는 비싸다). 대신
 * "이 정도면 몇 대로 되는가"의 출발점을 주고, 사용자가 매트릭스에서 손으로 고친다.
 * 착수일 순으로 정렬한 뒤 넣을 수 있는 첫 호기에 넣는 방식이라,
 * 결과 대수는 "동시에 골조가 진행되는 최대 동 수"와 같아진다.
 */
export function suggestTowerCraneAssignment(
  buildings: BuildingFrameProfile[],
  params: RentalParams,
): { units: EquipmentUnit[]; assignments: Assignment[] } {
  const spans = buildings
    .map((b) => ({ b, start: frameStart(b), finish: frameFinish(b) }))
    .filter((s): s is { b: BuildingFrameProfile; start: string; finish: string } =>
      Boolean(s.start && s.finish),
    )
    .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));

  // 호기별로 "마지막으로 담당한 동의 종료일"만 들고 다니면 충분하다
  const buckets: Array<{ lastFinish: string; ids: string[] }> = [];
  for (const s of spans) {
    // 전환 여유(해체 없이 다음 동으로 넘어가는 최소 간격)를 리드타임으로 본다
    const slot = buckets.find(
      (k) => diffDays(k.lastFinish, s.start) > params.tc.leadDays,
    );
    if (slot) {
      slot.ids.push(s.b.id);
      slot.lastFinish = s.finish > slot.lastFinish ? s.finish : slot.lastFinish;
    } else {
      buckets.push({ lastFinish: s.finish, ids: [s.b.id] });
    }
  }

  const units: EquipmentUnit[] = buckets.map((_, i) => ({
    id: `tc-${i + 1}`,
    kind: "tc" as const,
    no: i + 1,
  }));
  const assignments: Assignment[] = buckets.flatMap((k, i) =>
    k.ids.map((buildingId) => ({ unitId: units[i].id, buildingId })),
  );
  return { units, assignments };
}

/** 동 1개 = 호이스트 1대 기본안 */
export function suggestHoistAssignment(buildings: BuildingFrameProfile[]): {
  units: EquipmentUnit[];
  assignments: Assignment[];
} {
  const units: EquipmentUnit[] = buildings.map((b, i) => ({
    id: `hc-${i + 1}`,
    kind: "hc" as const,
    no: i + 1,
  }));
  const assignments: Assignment[] = buildings.map((b, i) => ({
    unitId: units[i].id,
    buildingId: b.id,
  }));
  return { units, assignments };
}
