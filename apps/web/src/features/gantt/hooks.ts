/**
 * 스마트 공정표 React Query 훅. 화면은 api.ts 를 직접 부르지 않고 이 훅만 쓴다.
 */
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { DEFAULT_SITE_SETTINGS, KR_HOLIDAYS_2026_Q4, type ActualWork, type FrameReady, type PlanResponse, type SiteSettings } from "@ipg/gantt-engine";
import { addDays, monthRange } from "./dates";
import { buildFrameReady } from "./framePours";
import {
  getFinish,
  getFinishReports,
  getSettings,
  listDailyReports,
  listSites,
  planSchedule,
  saveBuildings,
  saveSettings,
  simulateSchedule,
  type Building,
} from "./api";

export const ganttKeys = {
  all: ["gantt"] as const,
  sites: () => [...ganttKeys.all, "sites"] as const,
  reports: (siteId: string, from: string, to: string) => [...ganttKeys.all, "reports", siteId, from, to] as const,
  settings: (siteId: string) => [...ganttKeys.all, "settings", siteId] as const,
  plan: (siteId: string, from: string, to: string, settings: SiteSettings) =>
    [...ganttKeys.all, "plan", siteId, from, to, settings] as const,
  simulate: (from: string, to: string, settings: SiteSettings) =>
    [...ganttKeys.all, "simulate", from, to, settings] as const,
  finish: (siteId: string) => [...ganttKeys.all, "finish", siteId] as const,
  finishReports: (siteId: string, from: string, to: string) => [...ganttKeys.all, "finishReports", siteId, from, to] as const,
};

/** 마감 간트 「일보 작업」 막대 (그 달 작업일보 마감 줄) */
export function useFinishReports(siteId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ganttKeys.finishReports(siteId ?? "", from, to),
    queryFn: () => getFinishReports(siteId as string, from, to),
    enabled: Boolean(siteId),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/** 마감 공정표 (스마트웍스 세대별 마감 완료 집계) */
export function useFinish(siteId: string | null) {
  return useQuery({
    queryKey: ganttKeys.finish(siteId ?? ""),
    queryFn: () => getFinish(siteId as string),
    enabled: Boolean(siteId),
    staleTime: 5 * 60_000,
  });
}

/** 달력. 공휴일은 아직 2026-10 만 상수 — 현장 달력(DB)으로 옮길 예정 */
export const CALENDAR = { holidays: [...KR_HOLIDAYS_2026_Q4] };

export function useSites() {
  return useQuery({ queryKey: ganttKeys.sites(), queryFn: listSites, staleTime: 5 * 60_000 });
}

export function useDailyReports(siteId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ganttKeys.reports(siteId ?? "", from, to),
    queryFn: () => listDailyReports(siteId as string, from, to),
    enabled: Boolean(siteId),
  });
}

export function useSettings(siteId: string | null) {
  return useQuery({
    queryKey: ganttKeys.settings(siteId ?? ""),
    queryFn: () => getSettings(siteId as string),
    enabled: Boolean(siteId),
  });
}

export function usePlan(siteId: string | null, from: string, to: string, settings: SiteSettings, upTo: string) {
  return useQuery({
    queryKey: ganttKeys.plan(siteId ?? "", from, to, settings),
    queryFn: () => planSchedule({ siteId: siteId as string, settings, calendar: CALENDAR, from, to, upTo }),
    enabled: Boolean(siteId),
    placeholderData: (prev) => prev,
  });
}

/** 서버가 일보를 한 번에 62일까지만 읽는다(worker MAX_RANGE_DAYS) — 그보다 짧게 나눈다 */
const HISTORY_CHUNK_DAYS = 60;

/**
 * from~upTo 의 실적 전부 (3D 골조). /plan 을 60일 구간으로 나눠 부르고 actual 을 이어 붙인다.
 * buildings 는 마지막 구간의 동 라벨.
 */
/** 골조 예정을 내다보는 기간 — 마감 골조 선행(창틀)이 볼 S타설 예정 */
const FRAME_LOOKAHEAD_DAYS = 365;

/**
 * 마감 예정의 골조 선행용 층별 S타설일 (framePours). 골조 공정표와 같은 저장 설정으로
 * 첫 일보~오늘 실적(useActualHistory) + 내일부터 1년 예정(/plan)을 합친다. 다 받기 전엔 undefined.
 */
export function useFrameReady(siteId: string | null, today: string): FrameReady | undefined {
  const saved = useSettings(siteId);
  const settings = saved.data?.settings ?? DEFAULT_SITE_SETTINGS;
  const month = monthRange(today.slice(0, 7));
  const head = usePlan(saved.data ? siteId : null, month.from, month.to, settings, today);
  const firstDate = head.data?.firstReportDate ?? null;
  const hist = useActualHistory(head.data ? siteId : null, firstDate, today, settings);
  const ahead = usePlan(saved.data ? siteId : null, addDays(today, 1), addDays(today, FRAME_LOOKAHEAD_DAYS), settings, today);
  const ready = saved.data && head.data && ahead.data && !hist.isPending;
  return useMemo(
    () => (ready ? buildFrameReady(hist.actual, ahead.data!.assignments, saved.data!.buildings, firstDate, today) : undefined),
    [ready, hist.actual, ahead.data, saved.data, firstDate, today],
  );
}

export function useActualHistory(siteId: string | null, from: string | null, upTo: string, settings: SiteSettings) {
  const chunks: { from: string; to: string }[] = [];
  for (let f = from; f && f <= upTo; f = addDays(f, HISTORY_CHUNK_DAYS)) {
    const t = addDays(f, HISTORY_CHUNK_DAYS - 1);
    chunks.push({ from: f, to: t < upTo ? t : upTo });
  }
  return useQueries({
    queries: chunks.map((c) => ({
      queryKey: ganttKeys.plan(siteId ?? "", c.from, c.to, settings),
      queryFn: () => planSchedule({ siteId: siteId as string, settings, calendar: CALENDAR, from: c.from, to: c.to, upTo }),
      enabled: Boolean(siteId),
      staleTime: 5 * 60_000,
    })),
    combine: combineHistory,
  });
}

// 바깥에 둬야 결과가 같을 때 같은 배열이 돌아온다 (인라인이면 렌더마다 새 배열 → 3D 장면을 매번 다시 짓는다)
function combineHistory(results: UseQueryResult<PlanResponse>[]) {
  return {
    actual: results.flatMap((r) => r.data?.actual ?? []) as ActualWork[],
    buildings: results.at(-1)?.data?.buildings ?? [],
    isPending: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

export function useSimulate(from: string, to: string, settings: SiteSettings, enabled: boolean) {
  return useQuery({
    queryKey: ganttKeys.simulate(from, to, settings),
    queryFn: () => simulateSchedule({ settings, calendar: CALENDAR, from, to, warmupFrom: "2026-09-01" }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useSaveSettings(siteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: SiteSettings) => saveSettings(siteId as string, settings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ganttKeys.settings(siteId ?? "") });
      void qc.invalidateQueries({ queryKey: [...ganttKeys.all, "plan"] });
    },
  });
}

export function useSaveBuildings(siteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buildings: Building[]) => saveBuildings(siteId as string, buildings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ganttKeys.settings(siteId ?? "") });
      void qc.invalidateQueries({ queryKey: [...ganttKeys.all, "plan"] });
    },
  });
}
