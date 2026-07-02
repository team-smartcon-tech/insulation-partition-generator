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
} from "./api";

const keys = {
  all: ["elev-projects"] as const,
  list: () => [...keys.all, "list"] as const,
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
    mutationFn: (args: { name: string; description?: string }) =>
      createElevProject(args.name, args.description),
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
    }) => renameElevProject(args.projectId, { name: args.name, description: args.description }),
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
