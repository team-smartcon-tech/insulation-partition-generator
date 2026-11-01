// 골조 층별 S타설일 → 마감 예정의 골조 선행(FrameReady). 2026-10-30 사용자: 창틀은 골조 5개 층 선행.
// - 지난 날: 작업일보 실적의 S타설(POUR). 앞으로: 골조 공정표 예정의 S타설 (옥탑 제외)
// - 일보 기록 전에 이미 타설한 층(가장 낮은 실적 층 아래, 실적 없는 동은 설정의 현재 층 아래)은 첫 일보 전날 타설로 본다
// - 최상층보다 높은 층을 물으면 최상층 날짜 (꼭대기 근처 창틀은 골조가 다 올라가면 시작)
// - 마감 공정표 동마다 「골조 S타설」 줄도 같은 자료(buildFramePours)로 그린다 (2026-10-31)
// - 같은 층 타설이 여러 번(2026-10-31 남원주 401동: 실적 10/27 38F 뒤 일보가 다음 사이클도 38F 로 적어 예정 11/4 38F):
//   골조 줄에는 전부 그리고(골조 공정표와 같게), 선행 계산은 그 층의 가장 늦은 타설일(층 전체가 끝난 날)을 쓴다.
import type { ActualWork, Assignment, FrameReady } from "@ipg/gantt-engine";
import type { Building } from "./api";
import { addDays } from "./dates";

export type FramePour = { floor: number; date: string; /** 골조 공정표 예정 (아니면 작업일보 실적) */ planned: boolean };
/** 동 → 그 동의 S타설 기록 (날짜순, 같은 층이 여러 번 있을 수 있다) */
export type FramePours = Map<number, FramePour[]>;

export function buildFramePours(actual: ActualWork[], planned: Assignment[]): FramePours {
  const pours: FramePours = new Map();
  const seen = new Set<string>();
  const put = (id: number, floor: number, date: string, isPlan: boolean) => {
    if (floor < 1) return;
    // 같은 날 같은 층(코어별로 두 줄 등)은 하나로
    const k = `${id}|${floor}|${date}`;
    if (seen.has(k)) return;
    seen.add(k);
    const list = pours.get(id) ?? [];
    pours.set(id, list);
    list.push({ floor, date, planned: isPlan });
  };
  for (const a of actual) if (a.stage === "POUR" && a.floorLabel == null) put(a.buildingId, a.floor, a.date, false);
  for (const a of planned) if (a.stage === "POUR" && a.roof == null) put(a.buildingId, a.floor, a.date, true);
  for (const list of pours.values()) list.sort((x, y) => x.date.localeCompare(y.date) || x.floor - y.floor);
  return pours;
}

export function buildFrameReady(
  pours: FramePours,
  buildings: Building[],
  firstReportDate: string | null,
  today: string,
): FrameReady {
  // 층 → 그 층의 가장 늦은 타설일
  const latest = new Map<number, Map<number, string>>();
  for (const [id, list] of pours) {
    const m = new Map<number, string>();
    for (const p of list) if (!m.has(p.floor) || p.date > m.get(p.floor)!) m.set(p.floor, p.date);
    latest.set(id, m);
  }
  const before = addDays(firstReportDate ?? today, -1);
  const def = new Map(buildings.map((b) => [b.buildingNo, b]));
  return (no, floor) => {
    const b = def.get(no);
    const f = b ? Math.min(floor, b.topFloor) : floor;
    const m = latest.get(no);
    const known = m?.get(f);
    if (known) return known;
    const lowest = m?.size ? Math.min(...m.keys()) : (b?.currentFloor ?? 0);
    return f < lowest ? before : null;
  };
}
