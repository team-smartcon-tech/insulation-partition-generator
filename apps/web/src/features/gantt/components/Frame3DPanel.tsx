/**
 * 3D 골조 탭 — 작업일보 실적을 동·층 블록으로 쌓아 보여 준다 (FrameMass3DView).
 *
 * 데이터: 첫 작업일보부터 오늘까지의 실적(/plan 의 actual, 60일씩 나눠 읽음 — useActualHistory)과 설정 탭 동 목록.
 *  - 층 시작일 = 그 층 실적 중 가장 이른 날, 완료일 = 그 층 S타설(POUR) 날
 *  - 일보 기록이 시작되기 전에 이미 올라간 층(가장 낮은 실적 층 아래, 또는 설정의 현재 층 아래)은
 *    첫 일보 날에 완료된 것으로 본다 — 날짜가 없으면 3D 가 미시공층으로 그린다
 *  - 지상층(1층 이상) 숫자 층만 쓴다. RF·옥탑 같은 비숫자 층 표기는 뺀다
 */
import { lazy, Suspense, useMemo } from "react";
import { DEFAULT_SITE_SETTINGS } from "@ipg/gantt-engine";
import { monthRange, todayKst } from "../dates";
import { useActualHistory, usePlan, useSettings } from "../hooks";
import type { FrameMassBuilding, FrameMassRow } from "./FrameMass3DView";

// three.js 는 무거워 이 탭을 열 때만 받는다
const FrameMass3DView = lazy(() => import("./FrameMass3DView"));

export default function Frame3DPanel({
  siteId,
  siteName,
  onBack,
}: {
  siteId: string | null;
  siteName: string;
  /** 「골조표」 버튼 — 골조 공정표 탭으로 */
  onBack: () => void;
}) {
  const today = todayKst();
  const saved = useSettings(siteId);
  const settings = saved.data?.settings ?? DEFAULT_SITE_SETTINGS;
  // 1) 이번 달 계획에서 첫 작업일보 날짜를 얻고 2) 그날부터 오늘까지 실적을 읽는다
  const month = monthRange(today.slice(0, 7));
  const head = usePlan(siteId, month.from, month.to, settings, today);
  const firstDate = head.data?.firstReportDate ?? null;
  const full = useActualHistory(siteId, firstDate, today, settings);

  const model = useMemo(() => {
    const actual = full.actual;
    const listed = saved.data?.buildings ?? [];
    const labels = new Map(full.buildings.map((b) => [b.id, b.label]));

    // 동별·층별 시작일 / S타설일
    const byBuilding = new Map<number, Map<number, { start: string; pour?: string }>>();
    for (const a of actual) {
      if (a.floorLabel != null || a.floor < 1) continue;
      const floors = byBuilding.get(a.buildingId) ?? new Map();
      byBuilding.set(a.buildingId, floors);
      const f = floors.get(a.floor) ?? { start: a.date };
      if (a.date < f.start) f.start = a.date;
      if (a.stage === "POUR" && (!f.pour || a.date < f.pour)) f.pour = a.date;
      floors.set(a.floor, f);
    }

    // 동 목록: 설정 탭 목록이 있으면 그것, 없으면 일보에 나온 동
    const ids = listed.length ? listed.map((b) => b.buildingNo) : [...byBuilding.keys()].sort((x, y) => x - y);
    const buildings: FrameMassBuilding[] = [];
    const rows: FrameMassRow[] = [];
    for (const id of ids) {
      const def = listed.find((b) => b.buildingNo === id);
      const floors = byBuilding.get(id) ?? new Map<number, { start: string; pour?: string }>();
      const reportedTop = Math.max(0, ...floors.keys());
      const top = Math.max(def?.topFloor ?? 0, reportedTop);
      if (top < 1) continue;
      const name = def?.name ?? labels.get(id) ?? `${id}동`;
      buildings.push({ id: String(id), name, above_floors: top, below_floors: def?.basementFloors ?? 0 });

      // 기록 이전에 올라간 층: 가장 낮은 실적 층 아래, 실적이 없으면 설정의 현재 층 아래
      const lowest = floors.size ? Math.min(...floors.keys()) : (def?.currentFloor ?? 1);
      const seed = firstDate ?? today;
      for (let fl = 1; fl < Math.min(lowest, top + 1); fl++) {
        rows.push({ building_id: String(id), building_name: name, floor: fl, actual_start: seed, actual_finish: seed });
      }
      for (const [fl, f] of floors) {
        rows.push({ building_id: String(id), building_name: name, floor: fl, actual_start: f.start, actual_finish: f.pour });
      }
    }

    // 진행률 = 타설 완료층 / 전체 지상층
    const total = buildings.reduce((s, b) => s + b.above_floors, 0);
    const done = rows.filter((r) => r.actual_finish).length;
    return { buildings, rows, progressRate: total ? (done / total) * 100 : 0 };
  }, [full.actual, full.buildings, saved.data, firstDate, today]);

  if (!siteId) return <p className="py-10 text-center text-sm text-muted-foreground">현장을 고르세요.</p>;
  const loading = saved.isPending || head.isPending || (firstDate != null && full.isPending);
  const error = saved.error ?? head.error ?? full.error;
  if (error) {
    return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(error as Error).message}</div>;
  }
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">실적을 불러오는 중…</p>;
  if (model.buildings.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        그릴 동이 없습니다. 설정 탭에서 동 목록(최상층)을 입력하거나 작업일보가 쌓이면 보입니다.
      </p>
    );
  }

  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">3D 화면을 여는 중…</p>}>
      <FrameMass3DView
        siteName={siteName}
        siteId={siteId}
        buildings={model.buildings}
        rows={model.rows}
        progressRate={model.progressRate}
        onBack={onBack}
      />
    </Suspense>
  );
}
