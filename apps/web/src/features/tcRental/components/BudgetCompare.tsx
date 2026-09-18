/**
 * 실행기준 vs 현장(공정표) 비교.
 *
 * 두 값은 **다른 것을 재고 있다.**
 *  - 실행기준: 층수만으로 표준 사이클을 돌려 나온 공기 → 견적의 기준선. 공정표가 없어도 나온다.
 *  - 현장    : 실제 공정표 날짜로 잰 반입~반출 구간 → 실제 일정에 붙는다.
 * 그래서 어느 한쪽으로 통일하지 않고 나란히 놓고 차이를 본다. 차이가 크면 둘 중 하나가
 * 틀린 게 아니라 **가정이 다른 것**이고, 그 가정을 드러내는 것이 이 표의 목적이다.
 *
 * 산출근거는 접었다 펴는 표가 아니라 **한 줄**로 적는다. 동별 층수·공기·환산·가산을 순서대로
 * 이어 붙여, 표를 열지 않고도 눈으로 검산할 수 있게 한다.
 */
import { useMemo } from "react";
import { Scale } from "lucide-react";
import type { BuildingFrameProfile, RentalParams, RentalSpan } from "../types";
import {
  budgetCycleOf,
  budgetFrameDays,
  budgetHoistDays,
  budgetHoistRow,
  budgetTcRow,
  daysToMonths,
  type BudgetCycle,
} from "../engine/budgetStandard";
import { unitColor } from "../theme";

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface CompareRow {
  kind: "tc" | "hc";
  unitNo: number;
  label: string;
  /** 한 줄 산출근거 */
  basis: string;
  budget: number;
  site: number;
}

/** 동 한 채의 규모 표기 — "201동(B2·25F·옥1)" */
function scaleOf(b: BuildingFrameProfile): string {
  const parts = [
    b.belowFloors > 0 ? `B${b.belowFloors}` : null,
    `${b.aboveFloors}F`,
    b.phFloors > 0 ? `옥${b.phFloors}` : null,
  ].filter(Boolean);
  return `${b.name}(${parts.join("·")})`;
}

/** 화면과 엑셀이 같은 값을 쓰도록 비교 행을 한 곳에서 만든다 */
export function buildCompareRows(
  spans: RentalSpan[],
  buildings: BuildingFrameProfile[],
  params: RentalParams,
): CompareRow[] {
  const cycle: BudgetCycle = budgetCycleOf(params);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const rows: CompareRow[] = [];

  for (const s of spans) {
    if (s.problem) continue;
    const targets = s.buildingIds
      .map((id) => byId.get(id))
      .filter((b): b is BuildingFrameProfile => !!b);
    if (targets.length === 0) continue;

    if (s.kind === "tc") {
      const r = budgetTcRow(s.no, targets, cycle);
      const each = targets
        .map((b) => `${scaleOf(b)} ${budgetFrameDays(b, cycle)}일`)
        .join(" · ");
      rows.push({
        kind: "tc",
        unitNo: s.no,
        label: `T/C ${s.no}`,
        basis:
          `${each} → 최장 ${r.maxDays}일 ≒ ${round1(daysToMonths(r.maxDays))}월` +
          ` → 올림 ${r.months} + ${cycle.tcAddMonths} = ${r.rentalMonths}개월`,
        budget: r.rentalMonths,
        site: s.rentalMonths,
      });
    } else {
      // 호이스트는 동 단위라 담당 동이 여럿이면 가장 긴 동이 임대개월을 정한다
      const rowsOf = targets.map((b) => ({ b, r: budgetHoistRow(s.no, b, cycle) }));
      const best = rowsOf.reduce((a, x) => (x.r.rentalMonths > a.r.rentalMonths ? x : a));
      const counted = Math.max(0, best.b.aboveFloors - cycle.hoistSkipFloors);
      rows.push({
        kind: "hc",
        unitNo: s.no,
        label: `H/C ${s.no}`,
        basis:
          `${scaleOf(best.b)} 계상 ${counted}개층` +
          ` → ${budgetHoistDays(best.b, cycle)}일 ≒ ${best.r.frameMonths}월` +
          ` + ${cycle.hoistAddMonths} = ${best.r.spanMonths}월 → 올림 ${best.r.rentalMonths}개월`,
        budget: best.r.rentalMonths,
        site: s.rentalMonths,
      });
    }
  }
  return rows;
}

export default function BudgetCompare({
  spans,
  buildings,
  params,
}: {
  spans: RentalSpan[];
  buildings: BuildingFrameProfile[];
  params: RentalParams;
}) {
  const cycle = budgetCycleOf(params);
  const rows = useMemo(
    () => buildCompareRows(spans, buildings, params),
    [spans, buildings, params],
  );

  if (rows.length === 0) return null;

  const sum = rows.reduce(
    (a, r) => ({ budget: a.budget + r.budget, site: a.site + r.site }),
    { budget: 0, site: 0 },
  );
  const groups = (["tc", "hc"] as const)
    .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-slate-400" />
          <span className="text-[15px] font-bold text-slate-800">실행기준 비교</span>
        </div>
        <span className="text-[12px] text-slate-400">
          기초 {cycle.foundation} · 지하 {cycle.basement} · 1층 {cycle.floor1} · 기준 {cycle.typical} ·
          최상 {cycle.top} · 옥탑 {cycle.roof}일
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-slate-200 text-[12.5px] text-slate-500">
              <th className="w-[110px] px-3 py-2 text-left font-bold">호기</th>
              <th className="w-[110px] px-3 py-2 text-right font-bold">현장산출</th>
              <th className="w-[110px] px-3 py-2 text-right font-bold">실행기준</th>
              <th className="w-[80px] px-3 py-2 text-right font-bold">차이</th>
              <th className="px-4 py-2 text-left font-bold">산출근거</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.kind}>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                <td colSpan={5} className="px-3 py-1 text-[12.5px] font-bold text-slate-500">
                  {g.kind === "tc" ? "타워크레인" : "건설용리프트"}
                </td>
              </tr>
              {g.rows.map((r) => {
                const diff = r.site - r.budget;
                return (
                  <tr key={`${r.kind}-${r.unitNo}`} className="border-b border-slate-100">
                    <td className="px-3 py-1.5">
                      <span
                        className="inline-flex h-[24px] w-[62px] items-center justify-center rounded text-[12px] font-bold text-white"
                        style={{ background: unitColor(r.unitNo, r.kind) }}
                      >
                        {r.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                      {r.site}
                      <span className="ml-0.5 text-[11.5px] font-normal text-slate-400">개월</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {r.budget}
                      <span className="ml-0.5 text-[11.5px] text-slate-400">개월</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className="inline-flex h-[23px] min-w-[50px] items-center justify-center rounded px-2 text-[12.5px] font-bold tabular-nums"
                        style={
                          diff === 0
                            ? { background: "#f1f5f9", color: "#64748b" }
                            : diff > 0
                              ? { background: "#fdeaea", color: "#b3322c" }
                              : { background: "#e8f7f0", color: "#0f7a53" }
                        }
                      >
                        {diff > 0 ? "+" : ""}
                        {diff}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-[12.5px] leading-relaxed text-slate-500">
                      {r.basis}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <td className="px-3 py-2 text-[13.5px] font-bold text-slate-700">합계</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-800">
                {sum.site}
                <span className="ml-0.5 text-[11.5px] font-normal text-slate-400">개월</span>
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">
                {sum.budget}
                <span className="ml-0.5 text-[11.5px] font-normal text-slate-400">개월</span>
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">
                {sum.site - sum.budget > 0 ? "+" : ""}
                {sum.site - sum.budget}
              </td>
              <td className="px-4 py-2 text-[12px] text-slate-400">
                실행기준은 담당 동 중 가장 긴 동 하나로 봅니다(T/C 골조완료 +{cycle.tcAddMonths}개월,
                리프트 +{cycle.hoistAddMonths}개월). 현장산출은 담당 동을 모두 이어 붙인 실제
                반입~반출 구간입니다.
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
