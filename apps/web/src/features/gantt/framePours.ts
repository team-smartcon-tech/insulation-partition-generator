// 골조 층별 S타설일 → 마감 예정의 골조 선행(FrameReady). 2026-10-30 사용자: 창틀은 골조 5개 층 선행.
// - 지난 날: 작업일보 실적의 S타설(POUR). 앞으로: 골조 공정표 예정의 S타설 (옥탑 제외)
// - 일보 기록 전에 이미 타설한 층(가장 낮은 실적 층 아래, 실적 없는 동은 설정의 현재 층 아래)은 첫 일보 전날 타설로 본다
// - 최상층보다 높은 층을 물으면 최상층 날짜 (꼭대기 근처 창틀은 골조가 다 올라가면 시작)
import type { ActualWork, Assignment, FrameReady } from "@ipg/gantt-engine";
import type { Building } from "./api";
import { addDays } from "./dates";

export function buildFrameReady(
  actual: ActualWork[],
  planned: Assignment[],
  buildings: Building[],
  firstReportDate: string | null,
  today: string,
): FrameReady {
  const pours = new Map<number, Map<number, string>>();
  const put = (id: number, floor: number, date: string) => {
    if (floor < 1) return;
    const m = pours.get(id) ?? new Map<number, string>();
    pours.set(id, m);
    const cur = m.get(floor);
    if (!cur || date < cur) m.set(floor, date);
  };
  for (const a of actual) if (a.stage === "POUR" && a.floorLabel == null) put(a.buildingId, a.floor, a.date);
  for (const a of planned) if (a.stage === "POUR" && a.roof == null) put(a.buildingId, a.floor, a.date);

  const before = addDays(firstReportDate ?? today, -1);
  const def = new Map(buildings.map((b) => [b.buildingNo, b]));
  return (no, floor) => {
    const b = def.get(no);
    const f = b ? Math.min(floor, b.topFloor) : floor;
    const m = pours.get(no);
    const known = m?.get(f);
    if (known) return known;
    const lowest = m?.size ? Math.min(...m.keys()) : (b?.currentFloor ?? 0);
    return f < lowest ? before : null;
  };
}
