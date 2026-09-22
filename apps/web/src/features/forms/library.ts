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
import { sameNameSlots, taxonomyIdOf, type Taxonomy } from "./taxonomy.ts";

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
  /** 배포 양식: 한 번의 배포로 함께 올라간 묶음 번호 */
  batchId?: string;
  /** 현장 서류: 어느 배포 양식에서 만들었나 */
  templateId?: string;
  /** 현장 서류: 만들 때 그 배포 양식이 올라온 시각 — 이보다 새로 올라온 원본이 "새 판"이다 */
  templateUploadedAt?: number;
  /** 보기 이름(판 비교에 쓴다) */
  title?: string;
}

/**
 * 열 수 있는 엑셀 파일 확장자.
 *
 * `.xlsm`(매크로 포함)은 속이 `.xlsx` 와 같은 구조라 그대로 읽힌다 — 현장 양식에 수식·매크로가
 * 들어 있는 경우가 흔해 막아 둘 이유가 없다. `.xls`(2003년 형식)는 구조가 아예 달라 못 읽는다.
 */
export const EXCEL_FILE_RE = /\.xls[xm]$/i;
export const isExcelFile = (fileName: string) => EXCEL_FILE_RE.test(fileName);

/**
 * **첨부로만** 받는 파일 — 한글(아래아한글) 서식.
 *
 * 현장 서류 중에는 한글로 만든 것이 섞여 있다(검측요청서 등). 한글 파일은 화면에 그려 칸을
 * 채울 수 없으니 **보관하고 주고받기만** 한다: 배포 양식함에 올려 두면 현장이 내려받아 한글에서
 * 작성하고, 작성한 파일을 제 칸에 다시 올린다. 결재·인쇄는 이 파일에는 걸 수 없다.
 */
export const ATTACHMENT_FILE_RE = /\.hwpx?$/i;
export const isAttachmentFile = (fileName: string) => ATTACHMENT_FILE_RE.test(fileName);
/** 올릴 수 있는 파일인가(엑셀이거나 첨부) */
export const isUploadableFile = (fileName: string) => isExcelFile(fileName) || isAttachmentFile(fileName);
/** 파일 크기 표기 — `9876` → `9.6KB` */
export function fileSizeText(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10}KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

/** 확장자를 뗀 이름 */
export const baseFileName = (fileName: string) => fileName.replace(EXCEL_FILE_RE, "").replace(ATTACHMENT_FILE_RE, "");

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
    .replace(EXCEL_FILE_RE, "")
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

/**
 * 다른 1차 분류의 **같은 이름 칸**에만 새 판이 올라와, 이 칸이 옛 판으로 남은 경우.
 *
 * 회사 코드표는 분류마다 따로라 같은 서류가 공무관련·품질관련에 함께 들어 있다(번호는 다르다).
 * 올릴 때는 한 번에 함께 배포하지만, 나중에 한쪽 칸에만 새 파일을 올리면 **다른 쪽은 조용히
 * 옛 판으로 남는다.** 현장에서는 그 사실을 알 길이 없어 옛 양식으로 서류를 만든다.
 */
export interface StaleSlot<T> {
  /** 옛 판이 남아 있는 칸 */
  taxonomyId: string;
  division: string;
  code: string;
  name: string;
  /** 이 칸의 가장 새 판(그래도 옛 판) */
  old: T;
  /** 다른 분류에 올라온 더 새 판 */
  newer: T;
  newerDivision: string;
  newerCode: string;
}

/**
 * 배포 묶음 번호가 **없던 시절에 올린 양식**을 위한 관용 시간.
 *
 * 함께 배포하면 칸마다 따로 저장되어 시각이 몇 ms 씩 다르다. 묶음 번호가 있으면 그것으로
 * 가리지만, 옛 기록에는 없어서 시간으로 봐줄 수밖에 없다. 진짜 새 판은 며칠·몇 달 뒤에 온다.
 */
const SAME_BATCH_MS = 60_000;

/**
 * 저 양식이 이 양식보다 **나중에 올라온 새 판**인가.
 *
 * 묶음 번호가 양쪽에 다 있으면 그것만 본다 — 같은 묶음이면 함께 배포한 것이라 새 판이 아니고,
 * 다른 묶음이면 시각 그대로 견준다(같은 날 새로 올려도 잡힌다). 한쪽이라도 번호가 없으면
 * 옛 기록이라 {@link SAME_BATCH_MS} 만큼 봐준다.
 */
function isNewerEdition(candidate: LibraryEntry, current: LibraryEntry): boolean {
  if (candidate.batchId && current.batchId) {
    return candidate.batchId !== current.batchId && candidate.uploadedAt > current.uploadedAt;
  }
  return candidate.uploadedAt > current.uploadedAt + SAME_BATCH_MS;
}

/** 칸 하나에 올라온 배포 양식을 서류별(판 무시) 최신 한 장씩으로 간추린다. */
function latestByEdition<T extends LibraryEntry>(
  slot: string,
  templates: T[],
  taxonomies: Taxonomy[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const template of templates) {
    if (!isTemplate(template) || slotOf(template, taxonomies) !== slot) continue;
    const key = editionName(template.title) || template.id;
    const current = latest.get(key);
    if (!current || template.uploadedAt > current.uploadedAt) latest.set(key, template);
  }
  return latest;
}

/**
 * 다른 분류에만 새 판이 올라온 칸들을 찾는다. 새 판이 먼저 오게 정렬한다.
 *
 * 서류를 맞추는 방법이 두 가지다.
 * 1. **이름이 같은 파일끼리**({@link editionName}) — 한 번에 함께 배포하면 파일이 같으니 이게 맞는다.
 * 2. 이름이 안 맞고 **양쪽 칸에 서류가 하나씩만** 있으면 그 둘을 같은 서류로 본다 — 파일 이름
 *    앞에 분류 번호를 붙여 올리면(`104. 품질환경방침` / `103. 품질환경방침`) 이름이 갈리기 때문이다.
 *    한 칸에 서로 다른 서류가 여럿이면(공종별 현장설명서) 짝을 잘못 지을 수 있어 1번만 쓴다.
 */
export function staleAcrossDivisions<T extends LibraryEntry>(
  templates: T[],
  taxonomies: Taxonomy[],
): StaleSlot<T>[] {
  const rows: StaleSlot<T>[] = [];
  const bySlot = new Map<string, Map<string, T>>();
  const editions = (taxonomyId: string, code: string) => {
    const slot = `${taxonomyId}:${code}`;
    let found = bySlot.get(slot);
    if (!found) {
      found = latestByEdition(slot, templates, taxonomies);
      bySlot.set(slot, found);
    }
    return found;
  };

  for (const taxonomy of taxonomies) {
    for (const group of taxonomy.groups) {
      for (const item of group.items) {
        const mine = editions(taxonomy.id, item.code);
        if (mine.size === 0) continue;
        const others = sameNameSlots(taxonomies, { taxonomyId: taxonomy.id, code: item.code });
        if (others.length === 0) continue;

        for (const [key, old] of mine) {
          let best: { template: T; slot: (typeof others)[number] } | undefined;
          for (const other of others) {
            const theirs = editions(other.taxonomyId, other.code);
            // ① 같은 이름의 파일, ② 없으면 양쪽 모두 서류가 하나뿐일 때만 그 하나.
            const candidate =
              theirs.get(key) ?? (mine.size === 1 && theirs.size === 1 ? [...theirs.values()][0] : undefined);
            if (!candidate || !isNewerEdition(candidate, old)) continue;
            if (!best || candidate.uploadedAt > best.template.uploadedAt) best = { template: candidate, slot: other };
          }
          if (!best) continue;
          rows.push({
            taxonomyId: taxonomy.id,
            division: taxonomy.division || "이름 없음",
            code: item.code,
            name: item.name,
            old,
            newer: best.template,
            newerDivision: best.slot.division,
            newerCode: best.slot.code,
          });
        }
      }
    }
  }
  return rows.sort((a, b) => b.newer.uploadedAt - a.newer.uploadedAt);
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
