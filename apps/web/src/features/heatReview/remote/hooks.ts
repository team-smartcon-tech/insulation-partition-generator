/**
 * 동절기 열원검토 서버 저장 React Query 훅.
 *
 * 화면은 api.ts 를 직접 부르지 않고 이 훅만 쓴다 — 무효화 범위를 한 곳에서 관리하기 위함이다.
 * 현장 훅(useSites 등)은 TC 임대계획 것을 그대로 쓴다: 같은 테이블·같은 캐시 키라 한 도구에서 만든
 * 현장이 다른 도구에 바로 보인다.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  deleteProject,
  deleteRevision,
  getProject,
  getRevision,
  listProjects,
  saveRevision,
  updateProject,
  type HeatRevSummary,
} from "./api";
import type { HeatProject } from "../types";

export { useSites, useCreateSite, useUpdateSite, useDeleteSite } from "@/features/tcRental/hooks";

export const heatKeys = {
  all: ["heat-review"] as const,
  projects: () => [...heatKeys.all, "projects"] as const,
  project: (id: string) => [...heatKeys.all, "project", id] as const,
  revision: (pid: string, rid: string) => [...heatKeys.all, "revision", pid, rid] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: heatKeys.projects(),
    queryFn: () => listProjects().then((r) => r.projects),
    staleTime: 30_000,
  });
}

/** 세부 프로젝트 + REV 메타 목록 */
export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: heatKeys.project(projectId ?? ""),
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
  });
}

/** 단일 REV — 명시적으로 불러올 때만 쓴다(plan 이 커서 목록과 함께 받지 않는다) */
export function useRevision(projectId: string | null, revId: string | null) {
  return useQuery({
    queryKey: heatKeys.revision(projectId ?? "", revId ?? ""),
    queryFn: () => getRevision(projectId!, revId!).then((r) => r.revision),
    enabled: !!projectId && !!revId,
    staleTime: 60_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { name: string; siteId: string | null; description?: string }) =>
      createProject(a.name, a.siteId, a.description).then((r) => r.project),
    onSuccess: () => qc.invalidateQueries({ queryKey: heatKeys.projects() }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: {
      projectId: string;
      name?: string;
      description?: string;
      siteId?: string | null;
    }) =>
      updateProject(a.projectId, {
        name: a.name,
        description: a.description,
        ...(a.siteId !== undefined ? { siteId: a.siteId } : {}),
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: heatKeys.projects() });
      qc.invalidateQueries({ queryKey: heatKeys.project(v.projectId) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: heatKeys.projects() }),
  });
}

export function useSaveRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: {
      projectId: string;
      plan: HeatProject;
      summary: HeatRevSummary;
      memo?: string;
    }) => saveRevision(a.projectId, a.plan, a.summary, a.memo).then((r) => r.revision),
    onSuccess: (_d, v) => {
      // 목록의 REV 번호·수정일이 함께 바뀌므로 프로젝트 목록까지 무효화한다
      qc.invalidateQueries({ queryKey: heatKeys.project(v.projectId) });
      qc.invalidateQueries({ queryKey: heatKeys.projects() });
    },
  });
}

export function useDeleteRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { projectId: string; revId: string }) => deleteRevision(a.projectId, a.revId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: heatKeys.project(v.projectId) });
      qc.invalidateQueries({ queryKey: heatKeys.projects() });
    },
  });
}

/**
 * 세부 프로젝트(또는 특정 REV)를 열어 계획 문서를 가져온다.
 *
 * 버튼 한 번에 "프로젝트 조회 → REV 결정 → REV 본문 조회" 세 단계가 필요해서 useQuery 로는
 * 표현이 어색하다. 그래서 명령형으로 감싸되 캐시는 같은 쿼리키를 쓴다(다시 열면 즉시 뜬다).
 * revId 가 null 이면 최신 REV, REV 가 하나도 없으면 plan 은 null 로 돌려준다(빈 계획으로 시작).
 */
export function useLoadPlan() {
  const qc = useQueryClient();
  return useCallback(
    async (projectId: string, revId: string | null) => {
      const detail = await qc.fetchQuery({
        queryKey: heatKeys.project(projectId),
        queryFn: () => getProject(projectId),
      });
      // revisions 는 rev_no 내림차순이라 첫 항목이 최신이다
      const targetRevId = revId ?? detail.revisions[0]?.id ?? null;
      if (!targetRevId) return { project: detail.project, plan: null, revNo: 0 };

      const revision = await qc.fetchQuery({
        queryKey: heatKeys.revision(projectId, targetRevId),
        queryFn: () => getRevision(projectId, targetRevId).then((r) => r.revision),
      });
      return { project: detail.project, plan: revision.plan, revNo: revision.rev_no };
    },
    [qc],
  );
}
