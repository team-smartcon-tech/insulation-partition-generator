/**
 * 예시 데이터 — 평택고덕1차 예정공정표(11개 동).
 *
 * 스마트웍스 연동 전에도 도구를 열어 볼 수 있게 두는 견본이다.
 * 동명·층수·호기 배정은 실제 공정표에서 옮겼고, **층별 날짜는 기초·옥탑만 실제 값**이며
 * 그 사이 층은 공기산정 엔진 표준 사이클로 보간한 추정치다(화면에 빗금으로 표시된다).
 * 실제 층별 계획일은 스마트웍스 내보내기 JSON 으로 받는다.
 */

import type { Assignment, BuildingFrameProfile, EquipmentUnit, TcRentalPlan } from "./types";
import { CYCLE, DEFAULT_PARAMS } from "./engine/constants";
import { addDays } from "./engine/dates";
import { emptySegments, interpolateSegments } from "./engine/profile";

interface SampleRow {
  name: string;
  below: number;
  above: number;
  /** 골조 착수 ~ 완료 (공정표 "기간" 컬럼) */
  start: string;
  finish: string;
  /** 배정된 타워크레인 호기 번호 */
  tc: number[];
}

const ROWS: SampleRow[] = [
  { name: "3601동", below: 2, above: 12, start: "2026-11-10", finish: "2027-10-20", tc: [1] },
  { name: "3602동", below: 2, above: 20, start: "2026-10-20", finish: "2027-12-30", tc: [1] },
  { name: "3603동", below: 2, above: 20, start: "2026-10-20", finish: "2027-12-10", tc: [2] },
  { name: "3604동", below: 2, above: 19, start: "2026-10-01", finish: "2027-11-20", tc: [2] },
  { name: "3605동", below: 2, above: 20, start: "2026-09-20", finish: "2027-11-20", tc: [2, 3] },
  { name: "3606동", below: 2, above: 20, start: "2026-11-10", finish: "2028-01-10", tc: [3, 4] },
  { name: "3607동", below: 2, above: 12, start: "2026-11-01", finish: "2027-10-10", tc: [4, 5] },
  { name: "3608동", below: 1, above: 9, start: "2026-12-20", finish: "2027-09-10", tc: [5] },
  { name: "3609동", below: 1, above: 16, start: "2026-12-10", finish: "2027-11-10", tc: [5] },
  { name: "3610동", below: 1, above: 16, start: "2026-11-20", finish: "2027-10-10", tc: [6] },
  { name: "3611동", below: 1, above: 16, start: "2026-11-10", finish: "2027-10-10", tc: [6] },
];

function buildProfile(row: SampleRow): BuildingFrameProfile {
  const segments = emptySegments(row.below, row.above, 1);
  // 양 끝만 실측으로 고정하고 가운데를 비율 배분시킨다 — 공정표의 총 소요일수가 그대로 재현된다
  const first = segments[0];
  first.start = row.start;
  first.finish = addDays(row.start, CYCLE.basementPerFloor - 1);
  first.source = "manual";
  const last = segments[segments.length - 1];
  last.finish = row.finish;
  last.start = addDays(row.finish, -(CYCLE.rooftop - 1));
  last.source = "manual";

  return {
    id: `b-${row.name}`,
    name: row.name,
    belowFloors: row.below,
    aboveFloors: row.above,
    phFloors: 1,
    segments: interpolateSegments(segments, row.above, DEFAULT_PARAMS, row.start),
  };
}

export function buildSamplePlan(): TcRentalPlan {
  const buildings = ROWS.map(buildProfile);

  const tcNos = Array.from(new Set(ROWS.flatMap((r) => r.tc))).sort((a, b) => a - b);
  const units: EquipmentUnit[] = tcNos.map((no) => ({ id: `tc-${no}`, kind: "tc", no }));
  const assignments: Assignment[] = ROWS.flatMap((row) =>
    row.tc.map((no) => ({ unitId: `tc-${no}`, buildingId: `b-${row.name}` })),
  );

  return {
    siteName: "평택고덕1차",
    sourceLabel: "예시 데이터 (층별 일정은 추정)",
    buildings,
    units,
    assignments,
    params: DEFAULT_PARAMS,
    updatedAt: new Date().toISOString(),
  };
}
