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

export interface FormSite {
  id: string;
  name: string;
  createdAt: number;
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
