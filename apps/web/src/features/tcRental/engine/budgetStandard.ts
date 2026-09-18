/**
 * 실행기준 기준 산출 — 회사 표준 엑셀(`docs/123445.xlsx`)의 수식을 그대로 옮긴 것.
 *
 * 우리 엔진은 **실제 공정표 날짜**로 반입~반출 구간을 잰다. 실행기준 표는 그와 달리
 * **층수만 가지고 표준 사이클로 공기를 역산**한다. 둘은 목적이 다르다 —
 * 실행기준 값은 공정표가 없어도 나오고 견적의 기준선이 되며, 우리 값은 실제 일정에 붙는다.
 * 그래서 어느 한쪽으로 통일하지 않고 **나란히 놓고 차이를 보여준다.**
 *
 * 코드 식별자(`budget*`)는 처음 붙인 이름 그대로 둔다 — 화면 문구만 "실행기준"으로 통일했다.
 * 파일·함수명까지 바꾸면 호출부가 여러 곳으로 번지는데 얻는 것이 없다.
 *
 * ── 타워크레인 (TC 시트) ──
 *   골조공기(일) = 기초30 + 지하35×지하층수 + 1층25 + 기준10×(1F제외−1) + 최상15 + 옥탑15×옥탑수
 *                 (1F제외 = 지상층수 − 1 이므로 기준층 항은 10×(지상−2))
 *   임대개월     = ROUNDUP( MAX(호기 담당 동들의 골조공기) / 365 × 12 ) + 1
 *                 → 호기가 여러 동을 맡아도 **가장 긴 동 하나**로 본다
 *
 * ── 건설용리프트 (HOIST 시트) ──
 *   공기(일)     = 기준10 × (지상−5) + 최상15 + 옥탑15 × 옥탑수
 *                 → 1~4F 와 최상층을 뺀다. 호이스트는 5층부터 올라타므로 그 아래는 안 센다
 *   임대개월     = ROUNDUP( 공기/365×12 + 4 )
 */

import type { BuildingFrameProfile, RentalParams } from "../types";

/** 실행기준 표준 사이클 (단위: 일). 엑셀 상단 "총 공기 기준" 블록 */
export interface BudgetCycle {
  foundation: number; // 기초 30
  basement: number; // 지하 35/층
  floor1: number; // 1층 25
  typical: number; // 기준 10/층
  top: number; // 최상 15
  roof: number; // 옥탑 15/층
  /** T/C 임대개월에 더하는 개월 (해체시기 = 골조완료 + 1개월) */
  tcAddMonths: number;
  /** 호이스트 임대기간에 더하는 개월 (해체시기 = 동별 골조완료 + 4개월) */
  hoistAddMonths: number;
  /** 호이스트 공기에서 빼는 하부 층수 (1~4F + 최상층 = 5) */
  hoistSkipFloors: number;
}

export const DEFAULT_BUDGET_CYCLE: BudgetCycle = {
  foundation: 30,
  basement: 35,
  floor1: 25,
  typical: 10,
  top: 15,
  roof: 15,
  tcAddMonths: 1,
  hoistAddMonths: 4,
  hoistSkipFloors: 5,
};

const roundUp = (n: number) => Math.ceil(n - 1e-9);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 일 → 월 (엑셀과 같은 365일/12개월 환산) */
export function daysToMonths(days: number): number {
  return (days / 365) * 12;
}

/** 타워크레인 기준 — 동 하나의 골조공기(일) */
export function budgetFrameDays(b: BuildingFrameProfile, c: BudgetCycle): number {
  const above = Math.max(0, b.aboveFloors);
  // 엑셀의 "1F 제외" 열 = 지상층수 − 1. 기준층 항은 그 값에서 다시 1을 뺀다
  const typicalCount = Math.max(0, above - 1 - 1);
  return (
    c.foundation +
    c.basement * Math.max(0, b.belowFloors) +
    c.floor1 +
    c.typical * typicalCount +
    c.top +
    c.roof * Math.max(0, b.phFloors)
  );
}

/** 건설용리프트 기준 — 동 하나의 공기(일). 1~4F·최상층은 세지 않는다 */
export function budgetHoistDays(b: BuildingFrameProfile, c: BudgetCycle): number {
  const counted = Math.max(0, b.aboveFloors - c.hoistSkipFloors);
  return c.typical * counted + c.top + c.roof * Math.max(0, b.phFloors);
}

export interface BudgetTcRow {
  unitNo: number;
  buildings: Array<{ name: string; days: number }>;
  /** 담당 동 중 가장 긴 골조공기 */
  maxDays: number;
  months: number;
  /** 실행기준 임대개월 */
  rentalMonths: number;
}

/** 호기별 실행기준 임대개월 (타워크레인) */
export function budgetTcRow(
  unitNo: number,
  targets: BuildingFrameProfile[],
  c: BudgetCycle,
): BudgetTcRow {
  const buildings = targets.map((b) => ({ name: b.name, days: budgetFrameDays(b, c) }));
  const maxDays = buildings.reduce((a, x) => Math.max(a, x.days), 0);
  const months = roundUp(daysToMonths(maxDays));
  return {
    unitNo,
    buildings,
    maxDays,
    months,
    rentalMonths: maxDays > 0 ? months + c.tcAddMonths : 0,
  };
}

export interface BudgetHoistRow {
  unitNo: number;
  buildingName: string;
  days: number;
  /** 골조완료(월) */
  frameMonths: number;
  /** 임대기간(월) = 골조완료 + 4 */
  spanMonths: number;
  /** 실행기준 임대개월 (올림) */
  rentalMonths: number;
}

/** 동별 실행기준 임대개월 (건설용리프트) */
export function budgetHoistRow(
  unitNo: number,
  b: BuildingFrameProfile,
  c: BudgetCycle,
): BudgetHoistRow {
  const days = budgetHoistDays(b, c);
  const frameMonths = daysToMonths(days);
  const spanMonths = frameMonths + c.hoistAddMonths;
  return {
    unitNo,
    buildingName: b.name,
    days,
    frameMonths: round1(frameMonths),
    spanMonths: round1(spanMonths),
    rentalMonths: roundUp(spanMonths),
  };
}

/** 화면·엑셀이 함께 쓰는 비교 한 줄 */
export interface BudgetCompareRow {
  kind: "tc" | "hc";
  unitNo: number;
  label: string;
  /** 실행기준 기준 개월 */
  budget: number;
  /** 현장(공정표 기준) 개월 */
  site: number;
  /** 현장 − 실행기준 */
  diff: number;
  detail: string;
}

/** 파라미터에서 실행기준 사이클을 꺼낸다 (없으면 표준값) */
export function budgetCycleOf(params: RentalParams): BudgetCycle {
  return { ...DEFAULT_BUDGET_CYCLE, ...(params.budget ?? {}) };
}
