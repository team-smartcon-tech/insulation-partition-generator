/**
 * 서류 분류 코드표(2차 분류 / 3차 분류)를 읽는다.
 *
 * 분류 체계를 코드에 박지 않고 **엑셀로 받아** 쓴다. 회사 문서 체계는 반드시 바뀌는데,
 * 코드에 박으면 항목 하나 늘릴 때마다 개발이 필요하다. 표가 바뀌면 엑셀만 다시 올린다.
 *
 * 읽는 표의 모양(`scripts/make-taxonomy-sample.mjs` 가 만드는 것과 같다):
 *
 *   | CODE | 분류명    | CODE | 분류명                |
 *   | 100  | 공통/일반 | 101  | 이해관계자 니즈와 기대 |
 *   |      |           | 102  | 리스크 및 기회 평가표  |
 *
 * 중분류 칸은 세로로 병합돼 있는데, 파서가 병합을 `rowSpan` 으로 넘겨 주므로 어느 줄이
 * 어느 중분류에 속하는지 그대로 알 수 있다.
 */
import { carryContacts, type Contact } from "./contacts.ts";
import type { FormSheet } from "./types";

export interface TaxonomyItem {
  /** 3차 분류 코드(예: "101") */
  code: string;
  name: string;
  /** 속한 2차 분류 코드(예: "100") */
  groupCode: string;
  /** 이 칸만의 담당. 없으면 중분류 담당을 물려받는다(`contacts.ts`). */
  contact?: Contact;
}

export interface TaxonomyGroup {
  /** 2차 분류 코드(예: "100") */
  code: string;
  name: string;
  items: TaxonomyItem[];
  /** 이 중분류 칸들의 기본 담당 */
  contact?: Contact;
}

export interface Taxonomy {
  /**
   * 저장소가 붙이는 고정 id. 서류는 이 id 로 "어느 코드표 소속인지"를 기억한다.
   *
   * 1차 분류가 여러 개면(공무관련·품질관련) **코드 번호가 겹친다** — 둘 다 101~900 을 쓴다.
   * 코드만으로는 서류가 어디 속하는지 알 수 없어 코드표마다 id 를 둔다. 이름이 아니라
   * id 로 묶는 이유: 1차 분류 이름을 바꿔도 서류가 떨어져 나가지 않게.
   * 엑셀을 막 읽은 직후에는 빈 문자열이고, 저장할 때 채워진다.
   */
  id: string;
  /**
   * 1차 분류 이름(예: "공무관련"). 코드표의 중분류·소분류를 한데 묶는 큰 갈래다.
   *
   * 코드표 엑셀의 **시트 이름**에서 가져온다 — 관리자가 엑셀만 고치면 되고 앱에서 따로
   * 입력할 것이 없다. 시트 이름이 `Sheet1` 같은 기본값이면 비워 두고 화면에서 붙인다.
   */
  division: string;
  groups: TaxonomyGroup[];
  /** 어떤 파일에서 읽었는지 — 화면에 "무엇을 기준으로 나눴는지" 보여주기 위해 */
  fileName: string;
  updatedAt: number;
  /**
   * 한 코드에 서로 **다른 이름**이 붙어 있던 경우의 코드 목록.
   *
   * 같은 코드·같은 이름은 조용히 하나로 합치지만(오프라인에서 부수가 많아 두 줄로
   * 적어 둔 경우), 이름까지 다르면 표의 실수일 수 있어 지우지 않고 알린다.
   */
  conflicts: string[];
}

/**
 * 시트 이름을 1차 분류 이름으로 다듬는다.
 * 엑셀이 붙인 기본 이름(`Sheet1`, `시트1`)은 이름으로 치지 않는다 — 그걸 대분류로 보이면 이상하다.
 */
export function divisionFromSheetName(name: string): string {
  const trimmed = name.trim();
  if (/^(sheet|시트)\s*\d*$/i.test(trimmed)) return "";
  return trimmed;
}

/** 코드로 보이는 값인가. 숫자 3자리 이상(100, 101, 1010 …). */
/** 코드 — `101` 처럼 세 자리 이상 숫자, 또는 한 칸을 더 쪼갠 `802-1`(802 보고서 중 1번). */
const isCode = (text: string) => /^\d{3,}(-\d+)?$/.test(text.trim());

/**
 * 파일 이름 앞의 코드 후보. `101. 이해관계자.xlsx` → `["101"]`, `802-1. TFT성과보고서.xlsx` → `["802-1"]`.
 *
 * `802-1` 을 앞 번호 `802` 로 줄여 맞추지 않는다 — 코드표에서 802 는 전혀 다른 서류(착공보고서)일 수
 * 있어, 엉뚱한 칸에 조용히 들어간다. 맞는 칸이 없으면 "코드 없는 서류"로 두고 사용자가 옮긴다.
 */
export function fileNameCodes(fileName: string): string[] {
  const match = /^\s*(\d{3,})(?:-(\d+))?/.exec(fileName);
  if (!match) return [];
  return [match[2] ? `${match[1]}-${match[2]}` : match[1]];
}

/** 표에서 한 칸을 꺼낸다. 병합된 칸은 그 범위를 덮는 대표 칸이 나온다. */
function cellAt(sheet: FormSheet, row: number, col: number): string {
  const cell = sheet.cells.find(
    (item) =>
      item.row <= row &&
      item.row + item.rowSpan - 1 >= row &&
      item.col <= col &&
      item.col + item.colSpan - 1 >= col,
  );
  return cell ? cell.text.trim() : "";
}

/**
 * 코드 열이 어디인지 찾는다.
 *
 * 열 위치를 1·3번으로 고정하지 않는다 — 회사 표에 앞에 여백 열이 붙거나 순서가 바뀔 수
 * 있다. 머리글에 `CODE` 가 적힌 열을 찾고, 그 **오른쪽 열**을 이름 열로 본다.
 * 머리글이 없는 표는 코드처럼 생긴 숫자가 든 열 두 개를 쓴다.
 */
function findCodeColumns(sheet: FormSheet): { group: number; item: number } | null {
  for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
    const found: number[] = [];
    for (let col = 1; col <= sheet.colCount; col++) {
      if (cellAt(sheet, row, col).toUpperCase().replace(/\s+/g, "") === "CODE") found.push(col);
    }
    if (found.length >= 2) return { group: found[0], item: found[1] };
  }

  // 머리글이 없으면 숫자가 든 열을 센다. 가장 많이 나온 두 열을 코드 열로 본다.
  const counts = new Map<number, number>();
  for (const cell of sheet.cells) {
    if (isCode(cell.text)) counts.set(cell.col, (counts.get(cell.col) ?? 0) + 1);
  }
  const columns = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([col]) => col)
    .sort((a, b) => a - b);
  return columns.length === 2 ? { group: columns[0], item: columns[1] } : null;
}

/**
 * 코드표 시트를 분류 체계로 바꾼다. 읽을 수 없으면 null.
 *
 * 통째로 실패하는 대신 **읽을 수 있는 줄만** 모은다. 회사 표에는 빈 줄·소계 줄·메모가
 * 섞여 있기 마련이고, 그런 줄 하나 때문에 표 전체를 못 쓰게 되면 안 된다.
 */
export function parseTaxonomySheet(sheet: FormSheet, fileName: string): Taxonomy | null {
  const columns = findCodeColumns(sheet);
  if (!columns) return null;

  const groups = new Map<string, TaxonomyGroup>();
  const conflicts = new Set<string>();
  let lastGroup: TaxonomyGroup | null = null;

  for (let row = 1; row <= sheet.rowCount; row++) {
    const groupCode = cellAt(sheet, row, columns.group);
    if (isCode(groupCode)) {
      const existing = groups.get(groupCode);
      if (existing) {
        lastGroup = existing;
      } else {
        const group: TaxonomyGroup = {
          code: groupCode,
          name: cellAt(sheet, row, columns.group + 1) || groupCode,
          items: [],
        };
        groups.set(groupCode, group);
        lastGroup = group;
      }
    }

    const itemCode = cellAt(sheet, row, columns.item);
    if (!isCode(itemCode)) continue;
    const name = cellAt(sheet, row, columns.item + 1);
    if (!name) continue;
    // 중분류를 아직 못 만난 소분류는 버린다. 어디에 걸어야 할지 알 수 없다.
    if (!lastGroup) continue;
    const sameCode = lastGroup.items.filter((item) => item.code === itemCode);
    // 같은 코드·같은 이름은 한 줄로 합친다 — 오프라인에서 부수가 많아 표에 두 줄로
    // 적어 둔 경우다. 화면에는 한 칸으로 보여야 한다.
    if (sameCode.some((item) => item.name === name)) continue;
    // 이름까지 다르면 표의 실수일 수 있다. 지우면 서류 한 종류가 통째로 사라지므로
    // 둘 다 남기고 화면에서 알린다.
    if (sameCode.length > 0) conflicts.add(itemCode);

    lastGroup.items.push({ code: itemCode, name, groupCode: lastGroup.code });
  }

  const result = [...groups.values()].filter((group) => group.items.length > 0);
  if (result.length === 0) return null;
  return {
    id: "",
    division: divisionFromSheetName(sheet.name),
    groups: result,
    fileName,
    updatedAt: Date.now(),
    conflicts: [...conflicts],
  };
}

/** 코드표 전체에서 코드 → 항목을 찾는다. */
export function findItem(taxonomy: Taxonomy | null, code: string): TaxonomyItem | undefined {
  if (!taxonomy) return undefined;
  for (const group of taxonomy.groups) {
    const item = group.items.find((entry) => entry.code === code);
    if (item) return item;
  }
  return undefined;
}

/**
 * 파일 이름 앞의 숫자를 코드로 읽는다 — `101. 이해관계자니즈와기대2.xlsx` → `101`,
 * `802-1. TFT성과보고서.xlsx` → `802-1`.
 *
 * 사내 양식 파일은 이미 코드로 시작하는 이름을 쓰고 있어, 올릴 때 분류를 고르지 않아도
 * 제자리에 들어간다. 코드표에 없는 번호면 넘긴다(파일명이 옛 체계일 수 있다).
 */
export function codeFromFileName(fileName: string, taxonomy: Taxonomy | null): string | undefined {
  return fileNameCodes(fileName).find((code) => findItem(taxonomy, code));
}

// ─── 코드표 여러 벌(1차 분류가 여럿) ───────────────────────────

/**
 * 1차 분류가 생기기 전, 코드표를 한 벌만 담던 시절의 코드표에 붙이는 id.
 * 그때 올린 서류에는 코드표 id 가 없으므로 이 코드표 소속으로 본다.
 */
export const LEGACY_TAXONOMY_ID = "legacy";

/**
 * 저장된 코드표 목록에 새로 읽은 코드표들을 합친다.
 *
 * **같은 1차 분류 이름이면 내용만 갈아 끼우고 id 는 그대로 둔다.** 그래야 품질관련 코드표를
 * 고쳐 다시 올려도 이미 올린 품질 서류들이 떨어져 나가지 않는다. 이름이 비어 있는 코드표는
 * 파일 이름으로 같은지 본다. 처음 보는 코드표는 새 id 를 받아 뒤에 붙는다.
 */
export function upsertTaxonomies(
  existing: Taxonomy[],
  incoming: Taxonomy[],
  makeId: () => string,
): Taxonomy[] {
  const result = [...existing];
  for (const next of incoming) {
    const index = result.findIndex((current) =>
      next.division ? current.division === next.division : current.fileName === next.fileName,
    );
    // 화면에서 적어 둔 담당은 엑셀에 없다 — 같은 번호에 옮겨 붙여야 다시 올려도 안 사라진다.
    if (index >= 0) result[index] = { ...carryContacts(result[index], next), id: result[index].id };
    else result.push({ ...next, id: makeId() });
  }
  return result;
}

/**
 * 서류가 속한 코드표 id. 속한 곳이 없으면 undefined(= 코드 없는 서류).
 *
 * - 코드가 없으면 어디에도 안 속한다.
 * - 코드표 id 가 있으면 그 코드표가 아직 있을 때만 그곳이다(지워졌으면 떨어진다).
 * - 코드표 id 가 **없는** 서류는 1차 분류가 생기기 전에 올린 것이라 옛 코드표 소속이다.
 *   "첫 번째 코드표"로 보지 않는 이유: 옛 코드표를 지우면 그 서류들이 엉뚱하게 다음
 *   코드표(예: 품질관련)로 옮겨 붙는다.
 */
export function taxonomyIdOf(
  form: { code?: string; taxonomyId?: string },
  taxonomies: Taxonomy[],
): string | undefined {
  if (!form.code) return undefined;
  const id = form.taxonomyId ?? LEGACY_TAXONOMY_ID;
  return taxonomies.some((taxonomy) => taxonomy.id === id) ? id : undefined;
}

/**
 * 파일 이름 앞 숫자로 어느 코드표의 어느 칸인지 정한다.
 *
 * 1차 분류가 여러 개면 같은 번호가 여러 코드표에 있다. 이때는:
 *  - 사용자가 지금 보고 있는 1차 분류(preferredId)에 있으면 그곳으로,
 *  - 한 코드표에만 있으면 그곳으로,
 *  - 여러 곳에 있는데 어느 쪽인지 모르면 **정하지 않는다**(코드 없는 서류로 둔다).
 *    공무 서류가 품질 칸에 조용히 들어가는 것보다, 사용자가 옮기는 편이 낫다.
 */
export function placeByFileName(
  fileName: string,
  taxonomies: Taxonomy[],
  preferredId?: string,
): { taxonomyId: string; code: string } | undefined {
  let code = "";
  let owners: Taxonomy[] = [];
  for (const candidate of fileNameCodes(fileName)) {
    owners = taxonomies.filter((taxonomy) => findItem(taxonomy, candidate));
    code = candidate;
    if (owners.length > 0) break;
  }
  if (owners.length === 0) return undefined;
  const preferred = owners.find((taxonomy) => taxonomy.id === preferredId);
  if (preferred) return { taxonomyId: preferred.id, code };
  if (owners.length === 1) return { taxonomyId: owners[0].id, code };
  return undefined;
}

// ─── 사이트에서 코드표 고치기 ──────────────────────────────────
// 코드표를 엑셀로만 넣을 수 있으면, 항목 하나 늘릴 때마다 엑셀을 고쳐 다시 올려야 한다.
// 아래 함수들은 코드표를 **새 값으로 바꿔 돌려준다**(원본은 건드리지 않는다) — 화면은
// 돌려받은 코드표를 저장하고 다시 그리기만 하면 된다.

/** 코드에서 숫자만 뽑는다. `802-1` → 802.1 처럼 뒤 번호까지 살려 정렬·다음 번호 계산에 쓴다. */
function codeValue(code: string): number {
  const [main, sub] = code.split("-");
  return Number(main) + (sub ? Number(sub) / 1000 : 0);
}

/** 사이트에서 새로 만든 빈 코드표. 저장할 때 id 가 붙는다. */
export function createTaxonomy(division: string): Taxonomy {
  return { id: "", division: division.trim(), groups: [], fileName: "", updatedAt: Date.now(), conflicts: [] };
}

/** 다음 중분류 번호 — 100, 200, 300 … 마지막 번호에서 100 을 더한다. */
export function nextGroupCode(taxonomy: Taxonomy): string {
  const numbers = taxonomy.groups.map((group) => Math.floor(codeValue(group.code))).filter(Number.isFinite);
  if (numbers.length === 0) return "100";
  return String(Math.max(...numbers) + 100);
}

/** 다음 소분류 번호 — 중분류가 800 이면 801, 802 … 이미 있는 마지막 번호 다음. */
export function nextItemCode(group: TaxonomyGroup): string {
  const base = Math.floor(codeValue(group.code));
  const numbers = group.items.map((item) => Math.floor(codeValue(item.code))).filter(Number.isFinite);
  const last = numbers.length > 0 ? Math.max(...numbers) : base;
  return String(Math.max(last, base) + 1);
}

/** 코드표를 고친 뒤 부르는 마무리 — 고친 시각을 남긴다. */
function touched(taxonomy: Taxonomy, groups: TaxonomyGroup[]): Taxonomy {
  return { ...taxonomy, groups, updatedAt: Date.now() };
}

export function addGroup(taxonomy: Taxonomy, name: string, code = nextGroupCode(taxonomy)): Taxonomy {
  if (taxonomy.groups.some((group) => group.code === code)) return taxonomy;
  return touched(taxonomy, [...taxonomy.groups, { code, name: name.trim() || code, items: [] }]);
}

export function addItem(
  taxonomy: Taxonomy,
  groupCode: string,
  name: string,
  code?: string,
): Taxonomy {
  const groups = taxonomy.groups.map((group) => {
    if (group.code !== groupCode) return group;
    const itemCode = code ?? nextItemCode(group);
    if (group.items.some((item) => item.code === itemCode)) return group;
    return { ...group, items: [...group.items, { code: itemCode, name: name.trim() || itemCode, groupCode }] };
  });
  return touched(taxonomy, groups);
}

/** 중분류의 이름·번호를 고친다. 번호를 바꾸면 그 아래 소분류의 소속도 함께 따라간다. */
export function editGroup(
  taxonomy: Taxonomy,
  groupCode: string,
  next: { code?: string; name?: string },
): Taxonomy {
  const code = next.code?.trim() || groupCode;
  if (code !== groupCode && taxonomy.groups.some((group) => group.code === code)) return taxonomy;
  const groups = taxonomy.groups.map((group) =>
    group.code === groupCode
      ? {
          ...group,
          code,
          name: next.name?.trim() || group.name,
          items: group.items.map((item) => ({ ...item, groupCode: code })),
        }
      : group,
  );
  return touched(taxonomy, groups);
}

/** 소분류의 이름·번호를 고친다. 번호가 이미 쓰이고 있으면 그대로 둔다. */
export function editItem(
  taxonomy: Taxonomy,
  itemCode: string,
  next: { code?: string; name?: string },
): Taxonomy {
  const code = next.code?.trim() || itemCode;
  if (code !== itemCode && findItem(taxonomy, code)) return taxonomy;
  const groups = taxonomy.groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.code === itemCode ? { ...item, code, name: next.name?.trim() || item.name } : item,
    ),
  }));
  return touched(taxonomy, groups);
}

/**
 * 중분류·소분류를 지운다. **지워진 칸에 있던 코드 목록**을 함께 돌려준다 —
 * 그 칸에 올려 둔 서류는 지우지 않고 "코드 없는 서류"로 내려보내야 하기 때문이다.
 */
export function removeGroup(taxonomy: Taxonomy, groupCode: string): { taxonomy: Taxonomy; codes: string[] } {
  const target = taxonomy.groups.find((group) => group.code === groupCode);
  if (!target) return { taxonomy, codes: [] };
  return {
    taxonomy: touched(taxonomy, taxonomy.groups.filter((group) => group.code !== groupCode)),
    codes: target.items.map((item) => item.code),
  };
}

export function removeItem(taxonomy: Taxonomy, itemCode: string): { taxonomy: Taxonomy; codes: string[] } {
  if (!findItem(taxonomy, itemCode)) return { taxonomy, codes: [] };
  const groups = taxonomy.groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.code !== itemCode),
  }));
  return { taxonomy: touched(taxonomy, groups), codes: [itemCode] };
}

/**
 * 칸을 다른 자리로 옮긴다(끌어다 놓기).
 *
 * **번호는 그대로 둔다.** 끌어 놓을 때마다 번호를 새로 매기면, 그 칸에 이미 올려 둔 서류의
 * 번호까지 줄줄이 따라 바뀐다. 순서만 먼저 맞추고, 번호를 가지런히 하고 싶으면
 * `renumberGroup` 을 따로 부른다.
 *
 * @param before 이 칸 **앞**에 끼워 넣는다. 없으면 그 중분류 맨 끝에 붙인다.
 */
export function moveItem(
  taxonomy: Taxonomy,
  code: string,
  toGroupCode: string,
  before?: string,
): Taxonomy {
  const moving = findItem(taxonomy, code);
  if (!moving || code === before) return taxonomy;
  if (!taxonomy.groups.some((group) => group.code === toGroupCode)) return taxonomy;

  const groups = taxonomy.groups.map((group) => {
    const items = group.items.filter((item) => item.code !== code);
    if (group.code !== toGroupCode) return { ...group, items };
    const placed = { ...moving, groupCode: toGroupCode };
    const at = before ? items.findIndex((item) => item.code === before) : -1;
    if (at < 0) return { ...group, items: [...items, placed] };
    return { ...group, items: [...items.slice(0, at), placed, ...items.slice(at)] };
  });
  return touched(taxonomy, groups);
}

/** 중분류 자체의 순서를 바꾼다. `before` 중분류 앞에, 없으면 맨 끝으로. */
export function moveGroup(taxonomy: Taxonomy, code: string, before?: string): Taxonomy {
  const moving = taxonomy.groups.find((group) => group.code === code);
  if (!moving || code === before) return taxonomy;
  const rest = taxonomy.groups.filter((group) => group.code !== code);
  const at = before ? rest.findIndex((group) => group.code === before) : -1;
  const groups = at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)];
  return touched(taxonomy, groups);
}

/**
 * 한 중분류의 칸 번호를 지금 순서대로 다시 매긴다(700 → 701, 702 …).
 *
 * 바뀐 번호를 함께 돌려준다 — 그 칸에 올려 둔 서류의 번호도 같이 바꿔야 서류가
 * 제자리에 남기 때문이다. 쪼갠 번호(802-1)는 건드리지 않는다.
 */
export function renumberGroup(
  taxonomy: Taxonomy,
  groupCode: string,
): { taxonomy: Taxonomy; changes: { from: string; to: string }[] } {
  const target = taxonomy.groups.find((group) => group.code === groupCode);
  if (!target) return { taxonomy, changes: [] };
  const base = Math.floor(codeValue(groupCode));
  const changes: { from: string; to: string }[] = [];
  const items = target.items.map((item, index) => {
    const to = String(base + index + 1);
    if (item.code !== to) changes.push({ from: item.code, to });
    return { ...item, code: to };
  });
  // 다른 중분류가 쓰고 있는 번호와 부딪히면 손대지 않는다(번호가 겹치면 서류가 섞인다).
  const others = taxonomy.groups
    .filter((group) => group.code !== groupCode)
    .flatMap((group) => group.items.map((item) => item.code));
  if (items.some((item) => others.includes(item.code))) return { taxonomy, changes: [] };

  const groups = taxonomy.groups.map((group) => (group.code === groupCode ? { ...group, items } : group));
  return { taxonomy: touched(taxonomy, groups), changes };
}

/** 붙여넣은 글에서 읽어 낸 한 줄. */
export interface PastedLine {
  code: string;
  name: string;
  /** 중분류(100·200 처럼 100 단위)인가 */
  isGroup: boolean;
}

/**
 * 폴더 이름 목록을 붙여넣어 코드표를 만든다.
 *
 * 탐색기에서 폴더를 복사해 붙이면 `Z:\01. 공사\100. 공통일반` 같은 전체 경로가,
 * 엑셀에서 복사하면 `100\t공통일반` 이 온다. 둘 다 받아 **맨 앞 번호 + 이름**만 남긴다.
 * 100 단위(100·200·800)는 중분류로, 나머지(101·802-1)는 바로 위 중분류의 소분류로 본다.
 */
export function parsePastedTaxonomy(text: string): PastedLine[] {
  const out: PastedLine[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    // 경로로 붙은 줄은 마지막 칸(폴더 이름)만 쓴다. 엑셀에서 온 탭은 사이 띄어쓰기로 본다.
    const line = (rawLine.split(/[\\/]/).pop() ?? "").replace(/\t+/g, " ").trim();
    if (!line) continue;
    const match = /^(\d{3,})(?:-(\d+))?[.)\s]+(.*)$/.exec(line);
    if (!match) continue;
    const code = match[2] ? `${match[1]}-${match[2]}` : match[1];
    if (seen.has(code)) continue;
    const name = match[3].replace(/\.(xlsx|xls|pdf|hwp|docx?)$/i, "").trim();
    if (!name) continue;
    seen.add(code);
    out.push({ code, name, isGroup: !match[2] && Number(match[1]) % 100 === 0 });
  }
  return out;
}

/** 붙여넣어 읽은 줄들을 코드표에 더한다. 이미 있는 번호는 건너뛴다. */
export function applyPastedLines(taxonomy: Taxonomy, lines: PastedLine[]): Taxonomy {
  let result = taxonomy;
  let currentGroup = result.groups[result.groups.length - 1]?.code ?? "";
  for (const line of lines) {
    if (line.isGroup) {
      if (!result.groups.some((group) => group.code === line.code)) {
        result = addGroup(result, line.name, line.code);
      }
      currentGroup = line.code;
      continue;
    }
    // 중분류를 아직 못 만난 소분류는 번호의 100 단위로 중분류를 만들어 건다(101 → 100).
    let groupCode = currentGroup;
    const hundred = String(Math.floor(codeValue(line.code) / 100) * 100);
    if (!groupCode || Math.floor(codeValue(groupCode) / 100) !== Math.floor(codeValue(line.code) / 100)) {
      groupCode = result.groups.find((group) => group.code === hundred)?.code ?? hundred;
      if (!result.groups.some((group) => group.code === groupCode)) {
        result = addGroup(result, groupCode, groupCode);
      }
      currentGroup = groupCode;
    }
    if (!findItem(result, line.code)) result = addItem(result, groupCode, line.name, line.code);
  }
  return result;
}

/**
 * 같은 서류인데 다른 1차 분류에도 칸이 있는 곳 — **이름으로** 찾는다.
 *
 * 회사 코드표는 분류마다 따로 만들어져, 같은 서류라도 번호가 다르다(공무 104 품질환경방침 =
 * 품질 103 품질환경방침). 그래서 번호로는 묶을 수 없다. 띄어쓰기·가운뎃점만 다른 것도 같은
 * 서류로 본다(`개인업무분장표` = `개인 업무 분장표`).
 *
 * 배포 양식을 올릴 때 "여기도 같은 칸이 있는데 함께 배포할까요?"를 묻는 데 쓴다. 이름이 크게
 * 다르면 못 찾지만, 엉뚱한 칸에 함께 배포하는 것보다 낫다.
 */
export function sameNameSlots(
  taxonomies: Taxonomy[],
  place: { taxonomyId: string; code: string },
): { taxonomyId: string; division: string; code: string; name: string }[] {
  const source = taxonomies.find((taxonomy) => taxonomy.id === place.taxonomyId);
  const item = source && findItem(source, place.code);
  if (!item) return [];

  const key = (text: string) => text.replace(/[\s·/]+/g, "").toLowerCase();
  const wanted = key(item.name);
  const found: { taxonomyId: string; division: string; code: string; name: string }[] = [];
  for (const taxonomy of taxonomies) {
    if (taxonomy.id === place.taxonomyId) continue;
    for (const group of taxonomy.groups) {
      for (const entry of group.items) {
        if (key(entry.name) === wanted) {
          found.push({
            taxonomyId: taxonomy.id,
            division: taxonomy.division || "이름 없음",
            code: entry.code,
            name: entry.name,
          });
        }
      }
    }
  }
  return found;
}
