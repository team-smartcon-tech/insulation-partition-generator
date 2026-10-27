/**
 * 발주수량 검토 줄 만들기 — 실행예산 품목 + 단열 Layout 현장 산출을 맞붙인다.
 *
 * 회사 양식의 핵심 규칙은 **"겹침이음 시공 규격 세분화"** 다. 실행예산은 `T:150 비드법보온판`
 * 한 줄인데 현장은 1P·2P 두 겹(55T + 95T)으로 나눠 발주한다. 두께 합이 예산 두께와 같은
 * 노출 프리셋(직접외기 150 = 95+55, 간접외기 110 = 55+55)을 찾아 겹마다 한 줄씩 낸다.
 *
 * 겹별 수량은 두께가 아니라 **(노출타입, 겹 번호)** 로 받는다 — 간접외기 55/55 처럼 두 겹의
 * 두께가 같으면 두께 합계로는 둘을 가를 수 없기 때문이다.
 *
 * 순수 함수만 — 화면·엑셀과 무관. node 러너로 시험한다.
 */
import { parseThicknessMm, specWithThickness, type InsulBudget, type InsulBudgetItem } from "./budgetParser.ts";

export type OrderExposure = "direct" | "indirect" | "custom";

/** 페이지의 노출 프리셋(직접/간접외기 → 1P/2P 두께) — 화면 타입을 그대로 받는다 */
export interface OrderPreset {
  exposure: OrderExposure;
  label: string;
  ply1: number;
  ply2: number;
}

/** 단열 Layout 현장 합계 한 줄 — (노출, 겹) 별 주문 판수·현장식 면적 */
export interface LayoutPlyTotal {
  exposure: OrderExposure;
  ply: 1 | 2;
  thickness: number;
  /** 주문 판수 합(정척 + 절단판) × 세대수 */
  boards: number;
  /** 현장식 면적(㎡) = 판수 × 정척 1판 면적 */
  areaM2: number;
}

export interface LayoutTotals {
  plies: LayoutPlyTotal[];
  /** 집계에 들어간 세대수 합 */
  units: number;
}

/** 발주수량 검토의 오른쪽(발주) 한 줄 */
export interface OrderRow {
  spec: string;
  unit: string;
  orderBase: number;
  orderExt: number;
  /** P열 사유 */
  reason: string;
  /** R열 적용 위치 */
  where: string;
}

/** 실행예산 품목 하나에 대한 발주 결정 */
export interface OrderLine {
  item: InsulBudgetItem;
  /** 두께 합이 맞는 노출 프리셋 (없으면 Layout 적용 불가) */
  preset: OrderPreset | null;
  /** Layout 산출로 겹별 세분화해 발주한다 */
  useLayout: boolean;
  /** 예산 그대로 발주할 때의 한 줄 */
  budgetRow: OrderRow;
  /** 겹별 발주 줄 (preset 이 없으면 빈 배열) */
  layoutRows: OrderRow[];
}

export const LAYOUT_REASON = "겹침이음 시공 규격 세분화";
export const LAYOUT_WHERE = "세대 (단열 Layout 산출)";

/** 실제로 양식에 나갈 발주 줄 */
export function effectiveRows(line: OrderLine): OrderRow[] {
  return line.useLayout && line.layoutRows.length > 0 ? line.layoutRows : [line.budgetRow];
}

/** 품목이 Layout 산출 대상인지 — 세대 외벽 단열은 `09.내장목공사` 지급자재로 잡힌다 */
export function isUnitWallSection(section: string): boolean {
  return /내장목/.test(section.replace(/\s+/g, ""));
}

function plyTotal(totals: LayoutTotals, exposure: OrderExposure, ply: 1 | 2): LayoutPlyTotal | null {
  return totals.plies.find((p) => p.exposure === exposure && p.ply === ply) ?? null;
}

/** 두께 합이 예산 두께와 같은 프리셋 — 같은 합이 둘이면 Layout 에 물량이 있는 쪽을 고른다 */
export function matchPreset(
  item: InsulBudgetItem,
  presets: OrderPreset[],
  totals: LayoutTotals,
): OrderPreset | null {
  const t = parseThicknessMm(item.spec);
  if (t == null) return null;
  const cands = presets.filter((p) => p.exposure !== "custom" && p.ply1 + p.ply2 === t);
  if (cands.length === 0) return null;
  return cands.find((p) => plyTotal(totals, p.exposure, 1) || plyTotal(totals, p.exposure, 2)) ?? cands[0];
}

/** 실행예산 품목마다 발주 줄을 제안한다 */
export function proposeOrderLines(
  budget: InsulBudget,
  totals: LayoutTotals,
  presets: OrderPreset[],
): OrderLine[] {
  return budget.items.map((item) => {
    const preset = matchPreset(item, presets, totals);
    const budgetRow: OrderRow = {
      spec: item.spec,
      unit: item.unit,
      orderBase: item.baseQty,
      orderExt: item.extQty,
      reason: "",
      where: "",
    };
    const layoutRows: OrderRow[] = [];
    if (preset) {
      for (const ply of [1, 2] as const) {
        const thk = ply === 1 ? preset.ply1 : preset.ply2;
        if (thk <= 0) continue; // 2P=0(단일겹) 프리셋
        const tot = plyTotal(totals, preset.exposure, ply);
        layoutRows.push({
          spec: specWithThickness(item.spec, thk),
          unit: item.unit,
          // 기본/확장은 Layout 이 가르지 않는다 — 전체를 기본에 넣고 사유에 적는다
          orderBase: Math.round(tot?.areaM2 ?? 0),
          orderExt: 0,
          reason: LAYOUT_REASON,
          where: LAYOUT_WHERE,
        });
      }
    }
    return {
      item,
      preset,
      useLayout: !!preset && layoutRows.length > 0 && isUnitWallSection(item.section),
      budgetRow,
      layoutRows,
    };
  });
}

/** 발주 줄 요약 — 화면 안내용 (예산 합계 · 발주 합계) */
export function sumLines(lines: OrderLine[]): { budget: number; order: number } {
  let budget = 0;
  let order = 0;
  for (const l of lines) {
    budget += l.item.baseQty + l.item.extQty;
    for (const r of effectiveRows(l)) order += r.orderBase + r.orderExt;
  }
  return { budget, order };
}
