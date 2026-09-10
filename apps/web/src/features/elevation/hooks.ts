/**
 * 프로젝트/리비전 React Query 훅 (원본 SSX useElevationProjects.ts 이식)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ElevState, ElevSummary } from "@ipg/shared";
import {
  listElevProjects,
  getElevProject,
  getElevRevision,
  createElevProject,
  renameElevProject,
  deleteElevProject,
  deleteElevRevision,
  saveElevRevision,
  listElevSites,
  createElevSite,
  updateElevSite,
  deleteElevSite,
} from "./api";

const keys = {
  all: ["elev-projects"] as const,
  list: () => [...keys.all, "list"] as const,
  sites: () => ["elev-sites"] as const,
  project: (id: string) => [...keys.all, "project", id] as const,
  revision: (pid: string, rid: string) =>
    [...keys.all, "revision", pid, rid] as const,
};

/** 프로젝트 목록 */
export function useElevProjects() {
  return useQuery({
    queryKey: keys.list(),
    queryFn: () => listElevProjects().then((r) => r.projects),
    staleTime: 30_000,
  });
}

/** 프로젝트 + 리비전 메타 목록 */
export function useElevProject(projectId: string | null) {
  return useQuery({
    queryKey: keys.project(projectId ?? ""),
    queryFn: () => getElevProject(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
  });
}

/** 단일 리비전(state + DXF signed URL) — 명시 로드용(enabled 제어) */
export function useElevRevision(projectId: string | null, revId: string | null) {
  return useQuery({
    queryKey: keys.revision(projectId ?? "", revId ?? ""),
    queryFn: () => getElevRevision(projectId!, revId!),
    enabled: !!projectId && !!revId,
    staleTime: 60_000,
  });
}

export function useCreateElevProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; description?: string; siteId?: string | null }) =>
      createElevProject(args.name, args.description, args.siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list() }),
  });
}

export function useRenameElevProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      name?: string;
      description?: string;
      /** 현장 이동 — null 이면 미분류로 뺀다 */
      siteId?: string | null;
    }) =>
      renameElevProject(args.projectId, {
        name: args.name,
        description: args.description,
        // 키가 있을 때만 이동 — undefined 면 서버가 현장을 건드리지 않는다
        ...("siteId" in args ? { siteId: args.siteId } : {}),
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.project(v.projectId) });
    },
  });
}

export function useDeleteElevProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteElevProject(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list() }),
  });
}

export function useDeleteElevRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; revId: string }) =>
      deleteElevRevision(args.projectId, args.revId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.project(v.projectId) });
    },
  });
}

/** 새 REV 저장 */
export function useSaveElevRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      state: ElevState;
      summary?: ElevSummary;
      memo?: string;
      dxfFile?: File | null;
      reuse?: { dxfPath: string; dxfName: string | null; dxfSize: number | null } | null;
    }) =>
      saveElevRevision(args.projectId, {
        state: args.state,
        summary: args.summary,
        memo: args.memo,
        dxfFile: args.dxfFile,
        reuse: args.reuse,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.project(v.projectId) });
    },
  });
}

// ─── 현장(프로젝트 카드) ───────────────────────────────────

/** 현장 목록 — 썸네일 signed URL 이 매번 새로 발급되므로 캐시를 길게 두지 않는다 */
export function useElevSites() {
  return useQuery({
    queryKey: keys.sites(),
    queryFn: () => listElevSites().then((r) => r.sites),
    staleTime: 30_000,
  });
}

export function useCreateElevSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; description?: string; thumb?: File | null }) =>
      createElevSite(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sites() }),
  });
}

export function useUpdateElevSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      siteId: string;
      name?: string;
      description?: string;
      thumb?: File | null;
    }) =>
      updateElevSite(args.siteId, {
        name: args.name,
        description: args.description,
        thumb: args.thumb,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sites() }),
  });
}

export function useDeleteElevSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteId: string) => deleteElevSite(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.sites() });
      qc.invalidateQueries({ queryKey: keys.list() });
    },
  });
}
