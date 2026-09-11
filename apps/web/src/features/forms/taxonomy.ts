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
import type { FormSheet } from "./types";

export interface TaxonomyItem {
  /** 3차 분류 코드(예: "101") */
  code: string;
  name: string;
  /** 속한 2차 분류 코드(예: "100") */
  groupCode: string;
}

export interface TaxonomyGroup {
  /** 2차 분류 코드(예: "100") */
  code: string;
  name: string;
  items: TaxonomyItem[];
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
const isCode = (text: string) => /^\d{3,}$/.test(text.trim());

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
 * 파일 이름 앞의 숫자를 코드로 읽는다 — `101. 이해관계자니즈와기대2.xlsx` → `101`.
 *
 * 사내 양식 파일은 이미 코드로 시작하는 이름을 쓰고 있어, 올릴 때 분류를 고르지 않아도
 * 제자리에 들어간다. 코드표에 없는 번호면 넘긴다(파일명이 옛 체계일 수 있다).
 */
export function codeFromFileName(fileName: string, taxonomy: Taxonomy | null): string | undefined {
  const match = /^\s*(\d{3,})/.exec(fileName);
  if (!match) return undefined;
  return findItem(taxonomy, match[1]) ? match[1] : undefined;
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
    if (index >= 0) result[index] = { ...next, id: result[index].id };
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
  const match = /^\s*(\d{3,})/.exec(fileName);
  if (!match) return undefined;
  const code = match[1];
  const owners = taxonomies.filter((taxonomy) => findItem(taxonomy, code));
  if (owners.length === 0) return undefined;
  const preferred = owners.find((taxonomy) => taxonomy.id === preferredId);
  if (preferred) return { taxonomyId: preferred.id, code };
  if (owners.length === 1) return { taxonomyId: owners[0].id, code };
  return undefined;
}
