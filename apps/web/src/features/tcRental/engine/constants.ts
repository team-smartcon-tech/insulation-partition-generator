/**
 * 공기산정 표준값 — 스마트웍스 공기산정 엔진에서 가져온 값을 이 저장소로 옮긴 것.
 *
 * 출처: smart-schedule-X `client/src/lib/scheduleEstimateEngine.ts` (DEFAULT_CONFIG,
 *       ABOVE_FRAME_RATE_TABLE). 저장소가 달라 import 할 수 없어 값을 복제했다.
 *       원본이 바뀌면 여기도 함께 고쳐야 한다 — 숫자를 직접 고치기 전에 원본을 먼저 확인할 것.
 *
 * 이 값은 **공정표에 날짜가 없는 동을 보간할 때만** 쓴다. 스마트웍스에서 실제 계획일이
 * 넘어온 층은 그 날짜를 그대로 쓰고 여기 값으로 덮어쓰지 않는다.
 */

import type { RentalParams } from "../types";

export const CYCLE = {
  /** 지하 골조 (일/층) */
  basementPerFloor: 40,
  /** 지상 1층 */
  floor1: 34,
  /** 지상 2~3층 (층당) */
  floor2to3: 16,
  /** 옥탑 */
  rooftop: 30,
} as const;

/** 4층 이상 층당 공기 (일/층) — [토요휴무 형식][층수 범위] */
export const ABOVE_RATE: Record<RentalParams["saturdayOff"], { small: number; large: number }> = {
  weekly: { small: 11, large: 10 },
  biweekly: { small: 10, large: 9 },
  none: { small: 12, large: 11 },
};

/** 4층 이상 구간의 층당 일수 — 26층 이상이면 사이클이 한 칸 빨라진다 */
export function abovePerFloor(aboveFloors: number, saturdayOff: RentalParams["saturdayOff"]): number {
  const table = ABOVE_RATE[saturdayOff] ?? ABOVE_RATE.weekly;
  return aboveFloors >= 26 ? table.large : table.small;
}

/** 한 층(또는 기초·옥탑)의 표준 소요일수 */
export function standardFloorDays(
  floor: number,
  aboveFloors: number,
  saturdayOff: RentalParams["saturdayOff"],
): number {
  if (floor > aboveFloors) return CYCLE.rooftop; // 옥탑
  if (floor <= 0) return CYCLE.basementPerFloor; // 기초·지하
  if (floor === 1) return CYCLE.floor1;
  if (floor <= 3) return CYCLE.floor2to3;
  return abovePerFloor(aboveFloors, saturdayOff);
}

/**
 * 기본 파라미터.
 * 설치·해체 일수와 호이스트 앵커 층은 스마트웍스 네트워크 공정표의 공통가설 표준값
 * (`client/src/assets/network_common_setup.csv`)을 승계한다.
 *
 * **해체 시점은 회사 산정표(엑셀)를 따른다** — 타워크레인은 "골조완료 + 1개월(전 동 동일)",
 * 건설용리프트는 "동별 골조완료 + 4개월". 마감 공정을 추정해서 미는 것보다 이쪽이
 * 실제 견적과 맞고, 사람이 검증할 수 있다.
 */
export const DEFAULT_PARAMS: RentalParams = {
  saturdayOff: "weekly",
  tc: {
    leadDays: 5,
    installDays: 40,
    postFrameMonths: 1,
    dismantleDays: 30,
  },
  hc: {
    anchorFloor: 4,
    installDays: 20,
    postFrameMonths: 4,
    dismantleDays: 20,
    // 층고 기본값 — 공동주택 표준. 동별 구간을 안 정했을 때 `1층/기준층/최상층` 3구간을 만든다.
    // 지층은 동마다 기초 레벨이 달라 기본값이 있을 수 없어 여기 두지 않는다(동별 실측).
    floorHeight: { first: 3.08, typical: 2.88, top: 3.08 },
    extendHeight: 3.0,
    // 회사 입찰기준 개선(안, 23.8.7) — 20층 이하 저속싱글 / 21층 이상 중속싱글
    lowSpeedMaxFloors: 20,
  },
  winter: { from: "12-01", to: "02-28" },
  idleWarnDays: 30,
};

/**
 * 저장된 파라미터를 기본값 위에 얹는다.
 *
 * `{...DEFAULT_PARAMS, ...saved}` 로 얕게 합치면 saved.tc 가 **통째로** 기본 tc 를 밀어낸다.
 * 파라미터 항목이 늘어난 뒤 옛 초안을 열면 새 항목이 `undefined` 가 되고, 그 값으로 날짜를
 * 계산하면 NaN 이 되어 막대·마커가 축 맨 왼쪽에 붙는다(실제로 그렇게 깨졌다).
 */
export function mergeParams(saved?: Partial<RentalParams> | null): RentalParams {
  return {
    ...DEFAULT_PARAMS,
    ...(saved ?? {}),
    tc: { ...DEFAULT_PARAMS.tc, ...(saved?.tc ?? {}) },
    hc: {
      ...DEFAULT_PARAMS.hc,
      ...(saved?.hc ?? {}),
      floorHeight: { ...DEFAULT_PARAMS.hc.floorHeight, ...(saved?.hc?.floorHeight ?? {}) },
    },
    winter: { ...DEFAULT_PARAMS.winter, ...(saved?.winter ?? {}) },
  };
}
