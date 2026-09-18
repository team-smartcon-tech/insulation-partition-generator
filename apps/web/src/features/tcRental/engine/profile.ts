/**
 * 동별 골조 정형 — 층 목록 생성, 결측 날짜 보간, 동절기 보양 횟수 산출.
 *
 * 전부 순수 함수다. 화면 상태를 읽지 않고 입력만으로 결과가 정해지므로
 * 나중에 단위 테스트를 붙일 때 그대로 쓸 수 있다.
 */

import type {
  BuildingFrameProfile,
  FloorSegment,
  RentalParams,
  WinterCuring,
} from "../types";
import { standardFloorDays } from "./constants";
import { addDays, diffDays, isWinterDate, maxYmd, minYmd, parseYmd } from "./dates";

/** 층 번호 → 행 키. 기초 0, 지하 음수, 지상 양수, 옥탑은 aboveFloors 초과 */
export function floorKey(floor: number, aboveFloors: number): string {
  if (floor === 0) return "F";
  if (floor < 0) return `B${Math.abs(floor)}`;
  if (floor > aboveFloors) return `PH${floor - aboveFloors}`;
  return `${floor}F`;
}

export function floorLabel(floor: number, aboveFloors: number, phFloors: number): string {
  if (floor === 0) return "기초";
  if (floor < 0) return `B${Math.abs(floor)}`;
  if (floor > aboveFloors) return phFloors > 1 ? `옥탑${floor - aboveFloors}` : "옥탑";
  return `${floor}F`;
}

/**
 * 시공 순서대로의 층 목록 — 기초 → 지하 최하층 → ... → B1 → 1F → ... → 최상층 → 옥탑.
 * (첨부 공정표의 셀 배열 순서와 같다)
 */
export function orderedFloors(below: number, above: number, ph: number): number[] {
  const list: number[] = [];
  if (below > 0) list.push(0); // 기초
  for (let n = below; n >= 1; n -= 1) list.push(-n);
  if (below === 0) list.unshift(0); // 지하가 없어도 기초는 있다
  for (let n = 1; n <= above; n += 1) list.push(n);
  for (let n = 1; n <= Math.max(0, ph); n += 1) list.push(above + n);
  return list;
}

/** 층 구성만 주어졌을 때 빈 세그먼트 배열을 만든다 */
export function emptySegments(below: number, above: number, ph: number): FloorSegment[] {
  return orderedFloors(below, above, ph).map((floor) => ({
    key: floorKey(floor, above),
    floor,
    label: floorLabel(floor, above, ph),
    start: null,
    finish: null,
    source: "missing" as const,
  }));
}

/**
 * 결측 세그먼트를 공기산정 엔진 표준값으로 메운다.
 *
 * 규칙:
 *  - 앵커(날짜가 있는 층)가 **양쪽에** 있으면 그 사이를 표준 비율대로 배분한다.
 *    → 실제 공정표가 준 구간 밖으로 삐져나가지 않는다.
 *  - 한쪽만 있으면 그 방향으로 표준 일수를 누적한다.
 *  - 하나도 없으면 `fallbackStart` 부터 전개한다.
 *
 * 보간한 층은 source 가 "estimated" 가 되어 화면에서 빗금으로 구분된다.
 */
export function interpolateSegments(
  segments: FloorSegment[],
  aboveFloors: number,
  params: RentalParams,
  fallbackStart: string | null,
): FloorSegment[] {
  if (segments.length === 0) return segments;
  const out = segments.map((s) => ({ ...s }));
  const days = out.map((s) => standardFloorDays(s.floor, aboveFloors, params.saturdayOff));

  const hasDate = (s: FloorSegment) => !!parseYmd(s.start) && !!parseYmd(s.finish);
  const anchors = out.map(hasDate);

  if (!anchors.some(Boolean)) {
    // 앵커가 전혀 없다 — 착공일부터 표준 사이클로 통째로 전개
    let cursor = fallbackStart;
    if (!cursor) return out;
    for (let i = 0; i < out.length; i += 1) {
      out[i].start = cursor;
      out[i].finish = addDays(cursor, Math.max(1, days[i]) - 1);
      out[i].source = "estimated";
      cursor = addDays(out[i].finish!, 1);
    }
    return out;
  }

  // 구간별로 앞뒤 앵커를 찾아 채운다
  let i = 0;
  while (i < out.length) {
    if (anchors[i]) {
      i += 1;
      continue;
    }
    const gapStart = i;
    let gapEnd = i;
    while (gapEnd < out.length && !anchors[gapEnd]) gapEnd += 1;
    // [gapStart, gapEnd) 가 결측 구간
    const prev = gapStart > 0 ? out[gapStart - 1] : null;
    const next = gapEnd < out.length ? out[gapEnd] : null;
    const weights = days.slice(gapStart, gapEnd).map((d) => Math.max(1, d));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (prev?.finish && next?.start) {
      // 양쪽 앵커 사이를 비율대로 나눈다
      const room = Math.max(weights.length, diffDays(prev.finish, next.start) - 1);
      let cursor = addDays(prev.finish, 1);
      let used = 0;
      for (let k = 0; k < weights.length; k += 1) {
        const isLast = k === weights.length - 1;
        const share = isLast
          ? Math.max(1, room - used)
          : Math.max(1, Math.round((room * weights[k]) / totalWeight));
        out[gapStart + k].start = cursor;
        out[gapStart + k].finish = addDays(cursor, share - 1);
        out[gapStart + k].source = "estimated";
        cursor = addDays(out[gapStart + k].finish!, 1);
        used += share;
      }
    } else if (prev?.finish) {
      // 앞 앵커만 — 뒤로 누적
      let cursor = addDays(prev.finish, 1);
      for (let k = 0; k < weights.length; k += 1) {
        out[gapStart + k].start = cursor;
        out[gapStart + k].finish = addDays(cursor, weights[k] - 1);
        out[gapStart + k].source = "estimated";
        cursor = addDays(out[gapStart + k].finish!, 1);
      }
    } else if (next?.start) {
      // 뒤 앵커만 — 앞으로 역산
      let cursor = addDays(next.start, -1);
      for (let k = weights.length - 1; k >= 0; k -= 1) {
        out[gapStart + k].finish = cursor;
        out[gapStart + k].start = addDays(cursor, -(weights[k] - 1));
        out[gapStart + k].source = "estimated";
        cursor = addDays(out[gapStart + k].start!, -1);
      }
    }
    i = gapEnd;
  }
  return out;
}

/** 동의 골조 착수일 (가장 이른 세그먼트 시작) */
export function frameStart(b: BuildingFrameProfile): string | null {
  return minYmd(b.segments.map((s) => s.start));
}

/** 동의 골조 완료일 (가장 늦은 세그먼트 종료) */
export function frameFinish(b: BuildingFrameProfile): string | null {
  return maxYmd(b.segments.map((s) => s.finish));
}

/**
 * 골조 총 소요일수.
 *
 * 첨부 공정표의 "소요일수" 는 양 끝을 포함한 일수가 아니라 **경과일**이다
 * (3601동 2026-11-10 ~ 2027-10-20 = 344일). 임대일수(`inclusiveDays`)와 세는 방식이
 * 다르니 섞지 않는다 — 임대는 반입일과 반출일을 모두 청구하기 때문이다.
 */
export function frameTotalDays(b: BuildingFrameProfile): number {
  const s = frameStart(b);
  const f = frameFinish(b);
  if (!s || !f) return 0;
  return diffDays(s, f);
}

/** 특정 층의 완료일 — 호이스트 앵커(지상 N층) 를 찾을 때 쓴다 */
export function floorFinish(b: BuildingFrameProfile, floor: number): string | null {
  const seg = b.segments.find((s) => s.floor === floor);
  return seg?.finish ?? null;
}

/**
 * 동절기 보양 횟수 — 동절기 구간에 **타설이 걸리는 층의 수**를 지하/기준층/옥탑으로 나눠 센다.
 *
 * 회사 표준 정의가 확정되기 전까지의 기본 산식이다. 화면에서 사람이 덮어쓸 수 있고,
 * 덮어쓴 값이 있으면 이 함수 결과보다 우선한다.
 */
export function countWinterCuring(b: BuildingFrameProfile, params: RentalParams): WinterCuring {
  const out: WinterCuring = { basement: 0, typical: 0, rooftop: 0 };
  for (const seg of b.segments) {
    if (!seg.start || !seg.finish) continue;
    if (!overlapsWinter(seg.start, seg.finish, params)) continue;
    if (seg.floor > b.aboveFloors) out.rooftop += 1;
    else if (seg.floor <= 0) out.basement += 1;
    else out.typical += 1;
  }
  return out;
}

/** 구간이 동절기와 하루라도 겹치는가 (최대 400일까지만 훑어 무한 루프를 막는다) */
function overlapsWinter(start: string, finish: string, params: RentalParams): boolean {
  const span = diffDays(start, finish);
  if (span < 0) return false;
  for (let d = 0; d <= Math.min(span, 400); d += 1) {
    if (isWinterDate(addDays(start, d), params.winter.from, params.winter.to)) return true;
  }
  return false;
}

/** 화면에 쓸 보양 횟수 — 사용자가 덮어쓴 값이 있으면 그것을 쓴다 */
export function resolveWinterCuring(
  b: BuildingFrameProfile,
  params: RentalParams,
): WinterCuring {
  return b.winterCuring ?? countWinterCuring(b, params);
}
