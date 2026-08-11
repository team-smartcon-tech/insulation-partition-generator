/**
 * App Market React Query 훅
 * 화면에서는 api.ts 를 직접 부르지 않고 이 훅만 사용한다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMarketAppVersion,
  deleteMarketApp,
  getMarketApp,
  listMarketApps,
  publishMarketApp,
  toggleMarketAppLike,
} from "./api";
import type { MarketAppInput } from "./types";

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

export function usePublishMarketApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: MarketAppInput; shots: File[] }) =>
      publishMarketApp(args.input, args.shots),
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

export function useDeleteMarketApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => deleteMarketApp(appId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
