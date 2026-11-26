/**
 * App Market React Query 훅
 * 화면에서는 api.ts 를 직접 부르지 않고 이 훅만 사용한다.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMarketAppVersion,
  deleteMarketApp,
  getHomeOrder,
  getMarketApp,
  getToolStats,
  getUsageSummary,
  listMarketApps,
  logToolUsage,
  saveHomeOrder,
  publishMarketApp,
  toggleMarketAppLike,
  toggleToolLike,
  updateMarketApp,
} from "./api";
import type { MarketAppInput } from "./types";
import type { CardBadgeMap } from "@/features/home/cardBadge";

const keys = {
  all: ["market-apps"] as const,
  list: () => [...keys.all, "list"] as const,
  detail: (id: string) => [...keys.all, "detail", id] as const,
};

/** 홈 카드용 목록 */
export function useMarketApps() {
  return useQuery({
    queryKey: keys.list(),
    queryFn: listMarketApps,
    staleTime: 30_000,
    // 목록이 실패해도 홈은 내장 도구로 정상 동작해야 한다(재시도로 로딩을 끌지 않음).
    retry: false,
  });
}

/** 상세 — 스크린샷 signed URL 이 1시간짜리라 staleTime 을 짧게 둔다 */
export function useMarketApp(appId: string | null) {
  return useQuery({
    queryKey: keys.detail(appId ?? ""),
    queryFn: () => getMarketApp(appId!),
    enabled: !!appId,
    staleTime: 60_000,
  });
}

/**
 * 다운로드 직후 다운로드 수를 다시 받는다 — 다운로드는 <a href> 로 열려 react-query 를 거치지 않으므로,
 * Worker 가 수를 올릴 시간을 조금 두고 목록·상세를 새로 받는다.
 */
export function useRefreshAfterDownload() {
  const qc = useQueryClient();
  return () => {
    window.setTimeout(() => qc.invalidateQueries({ queryKey: keys.all }), 1500);
  };
}

export function usePublishMarketApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: MarketAppInput; shots: File[] }) =>
      publishMarketApp(args.input, args.shots),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

/** 게시물 수정 — 성공 시 목록과 해당 상세를 모두 새로 받는다(썸네일 서명 URL 이 바뀌므로) */
export function useUpdateMarketApp(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: MarketAppInput; newShots: File[]; shotOrder: string[] }) =>
      updateMarketApp(appId, args.input, args.newShots, args.shotOrder),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useToggleMarketAppLike(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => toggleMarketAppLike(appId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.detail(appId) });
      qc.invalidateQueries({ queryKey: keys.list() });
    },
  });
}

export function useAddMarketAppVersion(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { version: string; note?: string }) =>
      addMarketAppVersion(appId, args.version, args.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

// ─── 내장 도구 카드 조회·좋아요 + 이용 현황 ─────────────────

const toolStatsKey = [...keys.all, "tool-stats"] as const;

/** 내장 도구 카드의 조회·좋아요 수 — 실패해도 홈은 떠야 하므로 재시도하지 않는다 */
export function useToolStats() {
  return useQuery({
    queryKey: toolStatsKey,
    queryFn: getToolStats,
    // 도구를 쓰고 홈으로 돌아오면 방금 올라간 조회수가 보이도록 매번 새로 받는다
    staleTime: 0,
    retry: false,
  });
}

/**
 * 홈 카드의 하트 — 카드 키로 내장 도구("tool:…")와 게시 도구("market:…")를 가려 좋아요를 토글한다.
 */
export function useToggleCardLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardKey: string) =>
      cardKey.startsWith("market:") ? toggleMarketAppLike(cardKey.slice(7)) : toggleToolLike(cardKey),
    onSuccess: (_data, cardKey) => {
      if (cardKey.startsWith("market:")) {
        qc.invalidateQueries({ queryKey: keys.detail(cardKey.slice(7)) });
        qc.invalidateQueries({ queryKey: keys.list() });
      } else {
        qc.invalidateQueries({ queryKey: toolStatsKey });
      }
    },
  });
}

/** 같은 키를 잇달아 두 번 보내지 않게 한다(개발 모드 StrictMode 의 이중 실행 · 빠른 재진입) */
const lastUsageSent = new Map<string, number>();
const USAGE_DEDUPE_MS = 3000;

/** 이용 기록 1건 보내기 — 부가 기록이라 실패는 삼킨다 */
export function sendToolUsage(key: string, event: "open" | "launch") {
  const id = `${event}:${key}`;
  const now = Date.now();
  if (now - (lastUsageSent.get(id) ?? 0) < USAGE_DEDUPE_MS) return;
  lastUsageSent.set(id, now);
  logToolUsage(key, event).catch(() => undefined);
}

/** 내장 도구 화면에 들어올 때 이용 기록 1건 (카드 조회수 +1) */
export function useLogToolOpen(toolId: string) {
  useEffect(() => {
    sendToolUsage(`tool:${toolId}`, "open");
  }, [toolId]);
}

/** 연간 도구 이용 집계 (관리자) */
export function useUsageSummary(year: number) {
  return useQuery({
    queryKey: [...keys.all, "usage-summary", year] as const,
    queryFn: () => getUsageSummary(year),
    staleTime: 60_000,
    retry: false,
  });
}

const homeOrderKey = [...keys.all, "home-order"] as const;

/** 홈 카드 순서 — 실패해도 홈은 기본 정렬로 떠야 하므로 재시도하지 않는다 */
export function useHomeOrder() {
  return useQuery({
    queryKey: homeOrderKey,
    queryFn: getHomeOrder,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveHomeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { keys: string[]; badges?: CardBadgeMap }) => saveHomeOrder(args.keys, args.badges),
    onSuccess: (data) => qc.setQueryData(homeOrderKey, data),
  });
}

export function useDeleteMarketApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => deleteMarketApp(appId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
