/**
 * 입면도 생성기 — Output(통합 산출) 집계 유틸
 *
 * 입면(트레이싱한 외벽선)마다 동·코어 태그를 달고, 선택 범위(현장/동/코어/입면)의
 * 보드 물량을 합산한다. 입면별 BoardSummary 는 페이지에서 buildPlyDev→summarizeBoards 로
 * 계산해 넘기고, 여기서는 그룹핑/병합만 수행(순수 함수).
 */

import type { BoardSummary, BoardTally } from "./insulation";

export const UNASSIGNED_BUILDING = "미지정 동";
export const UNASSIGNED_CORE = "미지정 코어";

/** 입면 1개의 집계 입력 */
export interface WallSummaryInput {
  wallId: string;
  wallName: string;
  building: string;
  core: string;
  summary: BoardSummary;
}

/** 병합 결과 */
export interface MergedSummary {
  /** 규격(가로×세로·정척/절단)별 합산 */
  tallies: BoardTally[];
  /** 조각 수(시공, 버림 제외) */
  totalCount: number;
  /** 주문 판 수(정척+절단판) */
  orderBoardCount: number;
  /** 총 면적(㎡, 시공) */
  totalAreaM2: number;
  /** 버림(폐기) 조각 수 */
  discardedCount: number;
  /** 버림 면적(㎡) */
  discardedAreaM2: number;
}

export function emptyMerged(): MergedSummary {
  return {
    tallies: [],
    totalCount: 0,
    orderBoardCount: 0,
    totalAreaM2: 0,
    discardedCount: 0,
    discardedAreaM2: 0,
  };
}

/** 여러 입면의 BoardSummary 를 규격별로 병합 */
export function mergeSummaries(summaries: BoardSummary[]): MergedSummary {
  const map = new Map<string, BoardTally>();
  const out = emptyMerged();
  for (const s of summaries) {
    for (const t of s.tallies) {
      const key = `${t.w}x${t.h}x${t.thickness ?? 0}x${t.remainder ? 1 : 0}`;
      const cur = map.get(key);
      if (cur) cur.count += t.count;
      else map.set(key, { ...t });
    }
    out.totalCount += s.totalCount;
    out.orderBoardCount += s.orderBoardCount;
    out.totalAreaM2 += s.totalAreaM2;
    out.discardedCount += s.discardedCount ?? 0;
    out.discardedAreaM2 += s.discardedAreaM2 ?? 0;
  }
  out.tallies = [...map.values()].sort((a, b) => {
    if ((a.thickness ?? 0) !== (b.thickness ?? 0))
      return (b.thickness ?? 0) - (a.thickness ?? 0);
    if (a.remainder !== b.remainder) return a.remainder ? 1 : -1;
    return b.w * b.h - a.w * a.h;
  });
  return out;
}

// ── SCOPE 트리 (현장 ▸ 동 ▸ 코어 ▸ 입면) ──

export interface CoreNode {
  core: string;
  walls: WallSummaryInput[];
  merged: MergedSummary;
}
export interface BuildingNode {
  building: string;
  cores: CoreNode[];
  merged: MergedSummary;
}
export interface ScopeTree {
  buildings: BuildingNode[];
  merged: MergedSummary;
}

/** 입면 목록 → 동·코어 트리 (각 노드 merged 포함) */
export function buildScopeTree(items: WallSummaryInput[]): ScopeTree {
  const byBuilding = new Map<string, Map<string, WallSummaryInput[]>>();
  for (const it of items) {
    const b = it.building?.trim() || UNASSIGNED_BUILDING;
    const c = it.core?.trim() || UNASSIGNED_CORE;
    let cores = byBuilding.get(b);
    if (!cores) {
      cores = new Map();
      byBuilding.set(b, cores);
    }
    const arr = cores.get(c) ?? [];
    arr.push(it);
    cores.set(c, arr);
  }
  const buildings: BuildingNode[] = [];
  for (const [building, cores] of byBuilding) {
    const coreNodes: CoreNode[] = [];
    for (const [core, walls] of cores) {
      coreNodes.push({
        core,
        walls,
        merged: mergeSummaries(walls.map(w => w.summary)),
      });
    }
    coreNodes.sort((a, b) => a.core.localeCompare(b.core, "ko", { numeric: true }));
    buildings.push({
      building,
      cores: coreNodes,
      merged: mergeSummaries(coreNodes.flatMap(c => c.walls).map(w => w.summary)),
    });
  }
  buildings.sort((a, b) =>
    a.building.localeCompare(b.building, "ko", { numeric: true })
  );
  return {
    buildings,
    merged: mergeSummaries(items.map(w => w.summary)),
  };
}

/** 선택된 입면 id 집합에 대한 병합 결과 */
export function mergeForSelected(
  items: WallSummaryInput[],
  selected: Set<string>
): MergedSummary {
  return mergeSummaries(
    items.filter(w => selected.has(w.wallId)).map(w => w.summary)
  );
}
