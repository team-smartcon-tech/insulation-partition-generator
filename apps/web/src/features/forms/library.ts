/**
 * 배포 양식함 · 현장 서류함 — 원본과 작성본을 나눈다.
 *
 * 회사가 내려보낸 양식(배포 양식)은 **원본 그대로** 남아야 한다. 한 현장이 원본에 글자를
 * 적어 버리면 다음 현장이 그 글자가 든 양식을 받는다. 그래서 원본은 잠가 두고, 작성은
 * 현장 서류함에 **사본**을 만들어 거기서만 한다.
 *
 * 원본이 새 판으로 바뀌어도 현장 사본은 그대로 둔다 — 이미 적어 둔 내용을 조용히 바꾸면
 * 안 된다. 대신 "새 판 있음"을 띄워 현장이 알고 옮겨 가게 한다.
 */
import { taxonomyIdOf, type Taxonomy } from "./taxonomy.ts";

/** template = 배포 양식(원본, 읽기 전용) · site = 현장 서류(사본, 작성용) */
export type FormKind = "template" | "site";

/** 판정에 필요한 만큼만 받는다(저장본·요약 둘 다 넘길 수 있게). */
export interface LibraryEntry {
  id: string;
  kind?: FormKind;
  siteId?: string;
  code?: string;
  taxonomyId?: string;
  uploadedAt: number;
  /** 현장 서류: 어느 배포 양식에서 만들었나 */
  templateId?: string;
  /** 현장 서류: 만들 때 그 배포 양식이 올라온 시각 — 이보다 새로 올라온 원본이 "새 판"이다 */
  templateUploadedAt?: number;
  /** 보기 이름(판 비교에 쓴다) */
  title?: string;
}

/**
 * 판을 가리지 않는 서류 이름 — `(현장명) 인조강화석공사_현장설명서_Ver3_25.11` → `현장명인조강화석공사현장설명서`.
 *
 * 한 칸에 **서로 다른 서류**가 여럿 올라온다(공종별 현장설명서 9종). 같은 칸에 나중에 올라왔다고 모두
 * "새 판"으로 보면, 인조강화석공사 현장설명서에 주방가구공사 것이 새 판이라고 뜬다(실제로 그랬다).
 * 그래서 판 표시(Ver3, Ver3-4)·날짜(25.11, 2026-06)·앞 기호(●)를 떼고 **이름이 같을 때만** 새 판으로 본다.
 * 이름을 크게 바꿔 올리면 새 판으로 못 알아보지만, 엉뚱한 서류를 새 판이라고 하는 것보다 낫다.
 */
export function editionName(title: string | undefined): string {
  return (title ?? "")
    .replace(/\.xlsx$/i, "")
    .replace(/(?<![a-z])(?:ver|v)\.?\s*\d+(?:[.\-]\d+)*/gi, "")
    .replace(/(?:19|20)?\d{2}[.\-/]\d{1,2}(?:[.\-/]\d{1,2})?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

export const isTemplate = (form: { kind?: FormKind }) => form.kind === "template";
export const isSiteDoc = (form: { kind?: FormKind }) => form.kind === "site";

/**
 * 배포 양식 → 현장 사본의 틀. 저장소가 id·바이트·시각을 채운다.
 *
 * 적은 글자·더한 시트·더한 줄은 **빈 채로** 시작한다. 원본에 남아 있을 리 없지만, 혹시
 * 남아 있어도 새 현장으로 딸려 가면 안 된다.
 */
export function siteCopyFields(
  template: LibraryEntry & { title: string },
  siteId: string,
) {
  return {
    kind: "site" as const,
    siteId,
    title: template.title,
    code: template.code,
    taxonomyId: template.taxonomyId,
    templateId: template.id,
    templateUploadedAt: template.uploadedAt,
    values: {},
    customSheets: [],
    extraRows: {},
    approvalLines: {},
    approvals: {},
  };
}

/** 코드표의 한 칸을 가리키는 열쇠. 코드가 없으면 칸도 없다. */
function slotOf(form: LibraryEntry, taxonomies: Taxonomy[]): string | undefined {
  const taxonomyId = taxonomyIdOf(form, taxonomies);
  return taxonomyId && form.code ? `${taxonomyId}:${form.code}` : undefined;
}

/**
 * 이 현장 서류보다 새로 올라온 배포 양식(새 판)을 찾는다. 없으면 undefined.
 *
 * "새 판"은 **같은 칸에 나중에 올라온 원본**이다. 원본 파일을 덮어쓰는 기능을 따로 두지
 * 않았다 — 배포 담당자는 늘 하던 대로 새 파일을 그 칸에 올리면 된다. 여러 판이 쌓이면
 * 가장 최근 것을 알려 준다.
 */
export function newerTemplateFor<T extends LibraryEntry>(
  doc: LibraryEntry,
  templates: T[],
  taxonomies: Taxonomy[],
): T | undefined {
  if (!isSiteDoc(doc) || !doc.templateId) return undefined;
  const slot = slotOf(doc, taxonomies);
  if (!slot) return undefined;
  const since = doc.templateUploadedAt ?? 0;
  // 현장에서 서류 이름을 바꿨을 수 있어, 만들 때 쓴 원본의 이름으로 견준다(원본이 지워졌으면 서류 이름).
  const name = editionName(templates.find((template) => template.id === doc.templateId)?.title ?? doc.title);
  return templates
    .filter(
      (template) =>
        isTemplate(template) &&
        template.id !== doc.templateId &&
        template.uploadedAt > since &&
        slotOf(template, taxonomies) === slot &&
        editionName(template.title) === name,
    )
    .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
}

/**
 * 이 칸에 올라온 배포 양식들 — 한 칸에 서로 다른 서류가 여럿일 수 있다(공종별 현장설명서).
 * **같은 서류의 옛 판은 빼고** 서류마다 최신 판만, 이름 순으로 돌려준다.
 */
export function templatesIn<T extends LibraryEntry>(
  taxonomyId: string,
  code: string,
  templates: T[],
  taxonomies: Taxonomy[],
): T[] {
  const slot = `${taxonomyId}:${code}`;
  const latest = new Map<string, T>();
  for (const template of templates) {
    if (!isTemplate(template) || slotOf(template, taxonomies) !== slot) continue;
    const key = editionName(template.title) || template.id;
    const current = latest.get(key);
    if (!current || template.uploadedAt > current.uploadedAt) latest.set(key, template);
  }
  return [...latest.values()].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "ko"));
}

/** 이 칸에 올라온 배포 양식 중 가장 최근 것 — 현장 서류함의 빈 칸에서 "작성하기"에 쓴다. */
export function latestTemplateIn<T extends LibraryEntry>(
  taxonomyId: string,
  code: string,
  templates: T[],
  taxonomies: Taxonomy[],
): T | undefined {
  const slot = `${taxonomyId}:${code}`;
  return templates
    .filter((template) => isTemplate(template) && slotOf(template, taxonomies) === slot)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
}

/** 옛 저장본(구분이 생기기 전)을 옮겨 담는 방법. */
export interface LegacyPlan<T> {
  /** 배포 양식이 된 원본 */
  template: T;
  /** 적어 둔 내용이 있었다면 그 내용을 들고 현장 서류함으로 간 사본 */
  copy?: T;
}

/**
 * 구분이 생기기 전에 올린 서류를 나눈다.
 *
 * 그때까지 올린 것은 회사 양식이라 **배포 양식함으로** 간다. 다만 그 위에 이미 적어 둔
 * 내용(글자·더한 시트·더한 줄)이 있으면 그건 어느 현장의 작성본이다 — 버리지 않고
 * **그 현장 서류함에 사본으로** 옮긴다. 현장 표시가 없으면 첫 현장으로 본다.
 * 원본 쪽은 적어 둔 것을 비운다(사본이 들고 갔으므로 사라지는 것은 없다).
 */
export function planLegacyForm<
  T extends LibraryEntry & {
    values: Record<string, Record<string, string>>;
    customSheets: unknown[];
    extraRows: Record<string, number>;
  },
>(form: T, firstSiteId: string | undefined, makeId: () => string): LegacyPlan<T> {
  const written =
    Object.values(form.values).some((cells) => Object.keys(cells).length > 0) ||
    form.customSheets.length > 0 ||
    Object.keys(form.extraRows).length > 0;
  const targetSite = form.siteId ?? firstSiteId;

  const template: T = { ...form, kind: "template", siteId: undefined };
  if (!written || !targetSite) return { template };

  const copy: T = {
    ...form,
    id: makeId(),
    kind: "site",
    siteId: targetSite,
    templateId: form.id,
    templateUploadedAt: form.uploadedAt,
  };
  return {
    template: { ...template, values: {}, customSheets: [], extraRows: {} },
    copy,
  };
}
