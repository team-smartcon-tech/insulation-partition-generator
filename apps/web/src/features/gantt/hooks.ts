/**
 * 스마트 공정표 React Query 훅. 화면은 api.ts 를 직접 부르지 않고 이 훅만 쓴다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KR_HOLIDAYS_2026_Q4, type SiteSettings } from "@ipg/gantt-engine";
import {
  getFinish,
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
};

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
