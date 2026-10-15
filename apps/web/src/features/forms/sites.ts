/**
 * 현장(프로젝트) — 서류를 현장별로 나눠 담는다.
 *
 * 서류는 현장마다 따로 쌓인다(부산장안 B1 의 작업일보와 다른 현장의 작업일보는 다른 서류다).
 * 현장 구분이 없으면 두 현장을 쓰는 순간 한 통에 섞이고, 그때 가서 나누려면 서류를 하나씩
 * 손으로 옮겨야 한다. 그래서 목록·올리기·내려받기 모두 "지금 보고 있는 현장" 기준으로 돈다.
 *
 * 코드표(분류)는 회사 공통이라 현장별로 나누지 않는다 — 나누면 같은 표를 현장 수만큼
 * 관리해야 한다.
 */

import type { LineDefaults, SiteMember } from "./approvalLine.ts";
import type { QmpSiteSettings } from "./qmpCycle.ts";

export interface FormSite {
  id: string;
  name: string;
  createdAt: number;
  /** 현장 조직 — 결재선에서 고르는 사람 명단 */
  members?: SiteMember[];
  /** 이 현장의 기본 결재선(칸 이름 → 사람들). 다음 서류에 미리 채운다. */
  lineDefaults?: LineDefaults;
  /** 이 현장 작성 일정(품질관리계획서에 맞춘다) — 착공일·서식별 작성 주기·적용 제외 절 */
  qmp?: QmpSiteSettings;
}

/** 현장 하나의 조직·기본 결재선 같은 부가 정보를 바꾼다. */
export function updateSite(
  sites: FormSite[],
  siteId: string,
  patch: Partial<Pick<FormSite, "members" | "lineDefaults" | "qmp">>,
): FormSite[] {
  return sites.map((site) => (site.id === siteId ? { ...site, ...patch } : site));
}

/** 현장이 하나도 없을 때 처음 만들어 주는 이름 */
export const FIRST_SITE_NAME = "우리 현장";

/**
 * 이 서류가 속한 현장.
 *
 * 현장이 생기기 전에 올린 서류에는 표시가 없다. 그런 서류는 **첫 현장 것으로 본다** —
 * 안 그러면 현장을 만든 순간 이미 올려 둔 서류가 어느 목록에도 안 보이게 된다.
 */
export function siteIdOf(form: { siteId?: string }, sites: FormSite[]): string | undefined {
  if (form.siteId && sites.some((site) => site.id === form.siteId)) return form.siteId;
  if (form.siteId) return undefined; // 지워진 현장의 서류
  return sites[0]?.id;
}

/** 그 현장에 속한 서류만 고른다. */
export function formsOfSite<T extends { siteId?: string }>(
  forms: T[],
  sites: FormSite[],
  siteId: string | undefined,
): T[] {
  if (!siteId) return forms;
  return forms.filter((form) => siteIdOf(form, sites) === siteId);
}

/** 이름이 같은 현장을 두 개 만들지 않는다 — 어느 쪽에 올렸는지 알 수 없어진다. */
export function addSite(sites: FormSite[], name: string, makeId: () => string): FormSite[] {
  const trimmed = name.trim();
  if (!trimmed || sites.some((site) => site.name === trimmed)) return sites;
  return [...sites, { id: makeId(), name: trimmed, createdAt: Date.now() }];
}

export function renameSite(sites: FormSite[], siteId: string, name: string): FormSite[] {
  const trimmed = name.trim();
  if (!trimmed || sites.some((site) => site.id !== siteId && site.name === trimmed)) return sites;
  return sites.map((site) => (site.id === siteId ? { ...site, name: trimmed } : site));
}

/** 현장 한 곳의 서류 현황(전 현장 보기에서 쓴다). */
export interface SiteProgress {
  site: FormSite;
  /** 코드표의 칸 중 서류가 하나라도 올라온 칸 수 */
  filled: number;
  /** 코드표의 칸 수(회사 공통이라 현장마다 같다) */
  total: number;
  /** 코드가 없어 어느 칸에도 안 들어간 서류 수 */
  unfiled: number;
  /** 이 현장에서 마지막으로 고친 시각(ms). 없으면 0 */
  updatedAt: number;
}

/**
 * 현장별 서류 현황을 센다.
 *
 * 서류 점검은 "어느 현장이 무엇을 안 올렸나"를 보는 일이다. 그래서 **칸 기준**으로 센다 —
 * 한 칸에 여러 장을 올려도 한 칸으로, 코드 없는 서류는 따로 센다.
 */
export function summarizeSites(
  sites: FormSite[],
  forms: { siteId?: string; code?: string; taxonomyId?: string; updatedAt: number }[],
  total: number,
): SiteProgress[] {
  return sites.map((site) => {
    const mine = forms.filter((form) => siteIdOf(form, sites) === site.id);
    const slots = new Set<string>();
    let unfiled = 0;
    let updatedAt = 0;
    for (const form of mine) {
      if (form.code) slots.add(`${form.taxonomyId ?? ""}:${form.code}`);
      else unfiled += 1;
      if (form.updatedAt > updatedAt) updatedAt = form.updatedAt;
    }
    return { site, filled: slots.size, total, unfiled, updatedAt };
  });
}

/**
 * 서버 현장 목록을 브라우저 목록에 합친다.
 *
 * 화면은 브라우저에 있는 현장만 보여 줬다. 그래서 다른 사람이 처음 열면 현장이 하나도 없어
 * "우리 현장"이 새로 생겼고, 부산장안(B1) 같은 실제 현장은 보이지 않았다(2026-10-15 사용자 신고).
 * - 같은 번호: 브라우저에 있는 값을 쓰되, 비어 있는 조직·결재선·작성 일정은 서버 것으로 채운다.
 * - 같은 이름·다른 번호: 서버 번호로 바꾼다(`adopted` — 서류도 옮겨야 한다).
 * - 서버에만 있음: 더한다. 브라우저에만 있는 현장은 그대로 둔다(아직 못 올린 것).
 */
export function mergeServerSites(
  local: FormSite[],
  server: FormSite[],
): { list: FormSite[]; adopted: [oldId: string, newId: string][] } {
  const used = new Set<string>();
  const adopted: [string, string][] = [];
  const list = server.map((remote) => {
    const mine = local.find((site) => site.id === remote.id) ?? local.find((site) => site.name === remote.name && !used.has(site.id));
    if (!mine) return remote;
    used.add(mine.id);
    if (mine.id !== remote.id) adopted.push([mine.id, remote.id]);
    return {
      ...remote,
      ...mine,
      id: remote.id,
      members: mine.members ?? remote.members,
      lineDefaults: mine.lineDefaults ?? remote.lineDefaults,
      qmp: mine.qmp ?? remote.qmp,
    };
  });
  return { list: [...list, ...local.filter((site) => !used.has(site.id) && !list.some((item) => item.id === site.id))], adopted };
}

/**
 * 처음 보여 줄 현장. 지난번에 본 현장이 있으면 그것 — 다만 저절로 만들어진 빈 "우리 현장"이면
 * 실제 현장을 먼저 보여 준다. 서류가 있는 현장 → "우리 현장"이 아닌 현장 → 첫 현장 순.
 */
export function pickStartSite(
  sites: FormSite[],
  remembered: string | undefined,
  docSiteIds: (string | undefined)[],
): string | undefined {
  const hasDocs = (id: string) => docSiteIds.includes(id);
  const placeholder = (site: FormSite) => site.name === FIRST_SITE_NAME && !hasDocs(site.id);
  const mine = sites.find((site) => site.id === remembered);
  if (mine && !(placeholder(mine) && sites.length > 1)) return mine.id;
  return (sites.find((site) => hasDocs(site.id)) ?? sites.find((site) => !placeholder(site)) ?? sites[0])?.id;
}
