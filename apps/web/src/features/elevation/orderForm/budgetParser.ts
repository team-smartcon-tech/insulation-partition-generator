/**
 * 실행예산 내역서(2-2 건축(기) · 11-3 건축(확+옵)) 에서 **지급자재 단열재 줄**을 찾아낸다.
 *
 * 본사 내역서는 공종(`04.조적공사`) → 소제목(`[지급자재]`) → 품목 줄 순서로 한 열(A)에 섞여 있다.
 * 행 번호는 현장마다 다르므로 **절대 고정하지 않고** 매번 훑는다.
 * 단열재 줄의 기준은 "품명이 정확히 `단열재`" 다 — `단열재타설부착`·`결로방지단열재`·
 * `단열재깔기` 같은 시공 줄은 발주 대상이 아니라 걸러진다(부산장안 2-2 에서 8줄, 11-3 에서 5줄).
 *
 * 순수 함수만 둔다 — 엑셀 읽기는 호출하는 쪽(ExcelJS)이 하고 여기엔 2차원 배열만 넘긴다.
 * 그래야 node 내장 러너로 시험할 수 있다.
 */

/** 시트 한 장 — `rows[r][c]` (0 기준). 수식 셀은 **계산된 값**으로 넘긴다 */
export interface BudgetSheetGrid {
  name: string;
  rows: (string | number | null | undefined)[][];
}

/** 내역서에서 찾은 단열재 한 줄 */
export interface BudgetInsulRow {
  sheet: string;
  /** 엑셀 행 번호(1 기준) — 발주수량 검토 시트의 수식이 이 행을 가리킨다 */
  excelRow: number;
  /** 공종 — `04.조적공사` */
  section: string;
  /** 소제목 — `[지급자재]` (없으면 빈 문자열) */
  subsection: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
}

/** 기본(2-2)·확장(11-3) 을 같은 공종·규격끼리 맞춘 한 품목 */
export interface InsulBudgetItem {
  key: string;
  section: string;
  name: string;
  spec: string;
  unit: string;
  base: BudgetInsulRow | null;
  ext: BudgetInsulRow | null;
  baseQty: number;
  extQty: number;
}

export interface InsulBudget {
  /** 기본 내역서 시트 이름 (없으면 null) */
  baseSheet: string | null;
  /** 확장 내역서 시트 이름 (없으면 null) */
  extSheet: string | null;
  items: InsulBudgetItem[];
}

const text = (v: unknown): string => (v == null ? "" : String(v)).trim();

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(text(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** `04.조적공사` 꼴의 공종 머리줄 */
const SECTION_RE = /^\d{1,2}\s*[.．]\s*\S/;

/**
 * 시트 이름으로 기본/확장 내역서를 가려낸다.
 *  - 기본: `건축(기)` 가 들어간 이름 — `2-2.건축(기)(발주용)`
 *  - 확장: `건축(확` 가 들어간 이름 — `11-3.건축(확+옵)(발주용)`
 * 둘 다 없으면 시트가 한 장뿐일 때 그것을 기본으로 본다.
 */
export function classifyBudgetSheets(names: string[]): { base: string | null; ext: string | null } {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const base = names.find((n) => /건축\(기\)/.test(norm(n))) ?? null;
  const ext = names.find((n) => /건축\(확/.test(norm(n))) ?? null;
  if (!base && !ext && names.length === 1) return { base: names[0], ext: null };
  return { base, ext };
}

/** 내역서 한 장에서 단열재 줄을 전부 찾는다 (품명 열 A, 규격 B, 단위 C, 수량 D) */
export function scanInsulRows(grid: BudgetSheetGrid): BudgetInsulRow[] {
  const out: BudgetInsulRow[] = [];
  let section = "";
  let subsection = "";
  grid.rows.forEach((row, i) => {
    const a = text(row?.[0]);
    if (!a) return;
    if (SECTION_RE.test(a)) {
      section = a;
      subsection = "";
      return;
    }
    if (a.startsWith("[")) {
      subsection = a;
      return;
    }
    if (a.replace(/\s+/g, "") !== "단열재") return;
    out.push({
      sheet: grid.name,
      excelRow: i + 1,
      section,
      subsection,
      name: a,
      spec: text(row[1]),
      unit: text(row[2]) || "M2",
      qty: num(row[3]),
    });
  });
  return out;
}

/** 규격 문자열에서 두께(mm) — `T:150 비드법보온판 2종2호` · `T: 60, PF보드` · `THK150` → 150/60 */
export function parseThicknessMm(spec: string): number | null {
  const m = /T(?:HK)?\s*:?\s*(\d{2,3})/i.exec(spec);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** 규격 문자열의 두께만 바꾼다 — `T:150 비드법보온판 2종2호` + 55 → `T:55 비드법보온판 2종2호` */
export function specWithThickness(spec: string, mm: number): string {
  if (parseThicknessMm(spec) == null) return `T${mm} ${spec}`.trim();
  return spec.replace(/(T(?:HK)?\s*:?\s*)(\d{2,3})/i, (_m, head: string) => `${head}${mm}`);
}

/** 공종·규격을 느슨하게 맞추는 키 — 공백·콜론·쉼표 차이(`T: 60, PF보드` ↔ `T:60 PF보드`)를 무시 */
export function itemKey(section: string, spec: string): string {
  const sec = section.replace(/\s+/g, "");
  const sp = spec.replace(/[\s:,，]/g, "").toUpperCase();
  return `${sec}|${sp}`;
}

/** 기본·확장 내역서를 합쳐 품목 목록으로. 순서는 기본 내역서 등장 순, 확장에만 있는 줄은 뒤에 */
export function buildInsulBudget(grids: BudgetSheetGrid[]): InsulBudget {
  const { base, ext } = classifyBudgetSheets(grids.map((g) => g.name));
  const byName = new Map(grids.map((g) => [g.name, g]));
  const baseRows = base ? scanInsulRows(byName.get(base)!) : [];
  const extRows = ext ? scanInsulRows(byName.get(ext)!) : [];

  const items: InsulBudgetItem[] = [];
  const index = new Map<string, InsulBudgetItem>();
  const put = (row: BudgetInsulRow, side: "base" | "ext") => {
    const key = itemKey(row.section, row.spec);
    let it = index.get(key);
    if (!it) {
      it = {
        key,
        section: row.section,
        name: row.name,
        spec: row.spec,
        unit: row.unit,
        base: null,
        ext: null,
        baseQty: 0,
        extQty: 0,
      };
      index.set(key, it);
      items.push(it);
    }
    // 같은 공종·규격이 두 줄이면(드묾) 수량을 더한다 — 줄 참조는 첫 줄만 남긴다
    if (side === "base") {
      it.base ??= row;
      it.baseQty += row.qty;
    } else {
      it.ext ??= row;
      it.extQty += row.qty;
    }
  };
  baseRows.forEach((r) => put(r, "base"));
  extRows.forEach((r) => put(r, "ext"));
  return { baseSheet: base, extSheet: ext, items };
}
