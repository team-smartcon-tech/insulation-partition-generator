/**
 * 열원 비교 — 구역 종류별로 적용 열원을 정하고(예: 주차장은 열풍기, 세대는 펠릿난로),
 * "한 열원만 썼을 때"의 금액과 나란히 비교한다.
 * 금액 표는 현장 엑셀의 「첨부2. 산출서 및 투입금액 비교」와 같은 줄 구성을 쓴다.
 */
import { CircleCheck, Flame, Layers, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { appliedHeater, METHOD_LABEL, uniformHeaterId, ZONE_KIND_LABEL, zoneColor } from "../defaults";
import { heaterNeed, heaterOutput, zoneLoss, type HeaterCost, type ProjectSummary } from "../engine/calc";
import type { Heater, HeatProject, ZoneKind } from "../types";
import { Card, dec, int, Verdict, won, wonShort } from "./ui";

/** 금액 구성 3종 — 막대와 범례가 같은 색을 쓴다 */
const PARTS = [
  { key: "seasonFuelCost", label: "연료비", color: "#e07b2c" },
  { key: "seasonRental", label: "임대료", color: "#0a63b8" },
  { key: "seasonLabor", label: "인건비", color: "#7b8aa3" },
] as const;

const KINDS = Object.keys(ZONE_KIND_LABEL) as ZoneKind[];

export default function CompareTab({
  project,
  summary,
  onApply,
}: {
  project: HeatProject;
  summary: ProjectSummary;
  onApply: (patch: Partial<Record<ZoneKind, string>>) => void;
}) {
  const { heaters, zones, cost } = project;
  const costOf = (id: string) => summary.costs.find((c) => c.heaterId === id)!;
  const plan = summary.plan;
  const uniform = uniformHeaterId(project);
  const mixed = uniform === null;
  const cheapest = summary.cheapestId ? costOf(summary.cheapestId) : null;
  const maxSeason = Math.max(1, plan.seasonTotal, ...summary.costs.map((c) => c.seasonTotal));
  const hasFloor = zones.some((z) => z.kind !== "parking");
  const parkingZones = zones.filter((z) => z.kind === "parking");
  const nameOf = (id: string) => heaters.find((h) => h.id === id)?.name ?? "";
  /** 제원 줄 — 적용 계획 열에는 열원 하나의 제원이 없다 */
  const spec = (id: string, fn: (h: Heater) => string): React.ReactNode => {
    const h = heaters.find((x) => x.id === id);
    return h ? fn(h) : <span className="text-slate-300">종류별</span>;
  };

  if (zones.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-white/70 px-8 py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Layers className="h-5 w-5" />
        </span>
        <p className="mt-4 text-[15px] font-bold text-slate-700">비교할 구역이 없습니다</p>
        <p className="mt-1.5 text-[13px] text-slate-400">「구역」 탭에서 보양 구역을 먼저 추가하세요.</p>
      </div>
    );
  }

  const diff = cheapest ? plan.seasonTotal - cheapest.seasonTotal : 0;
  const unitsText = heaters
    .filter((h) => plan.byHeater[h.id]?.units)
    .map((h) => `${h.name} ${int(plan.byHeater[h.id].units)}`)
    .join(" · ");
  /** 표의 열: 열원별(단일 적용) + 섞어 쓸 때만 적용 계획 */
  const columns: { id: string; label: string; color: string | null; cost: HeaterCost }[] = [
    ...heaters.map((h) => ({ id: h.id, label: h.name, color: h.color, cost: costOf(h.id) })),
    ...(mixed ? [{ id: "plan", label: "적용 계획", color: null, cost: plan }] : []),
  ];
  const isPlanCol = (id: string) => (mixed ? id === "plan" : id === uniform);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      {/* 요약 타일 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Layers}
          label="보양 구역"
          value={`${zones.length}`}
          unit="개"
          sub={`1회 타설 보양면적 ${dec(summary.totalArea, 0)}㎡`}
        />
        <Kpi
          icon={Flame}
          label="총 손실열량"
          value={int(summary.totalLoss)}
          unit="kcal/h"
          sub={`외기 ${project.conditions.outdoorTemp}℃ → 양생 ${project.conditions.cureTemp}℃`}
        />
        <Kpi
          icon={CircleCheck}
          label={mixed ? "적용 계획 · 동시 배치" : `적용 열원 · ${nameOf(uniform!)}`}
          value={int(plan.peakUnits)}
          unit="대"
          sub={plan.allOk ? unitsText || "모든 구역 급열량 충족" : "급열량이 부족한 구역이 있습니다"}
          tone={plan.allOk ? "ok" : "warn"}
        />
        <Kpi
          icon={Wallet}
          label="동절기 투입 금액"
          value={wonShort(plan.seasonTotal)}
          unit="원"
          sub={
            diff > 0.5 && cheapest
              ? `${nameOf(cheapest.heaterId)}만 쓸 때보다 +${wonShort(diff)}원`
              : diff < -0.5 && cheapest
                ? `어느 한 열원만 쓸 때보다 ${wonShort(-diff)}원 적음`
                : "비교 열원 중 최저"
          }
          tone={diff > 0.5 ? "warn" : "ok"}
          strong
        />
      </div>

      {/* 적용 계획 — 종류별 열원 */}
      <Card
        title="적용 계획 — 구역 종류별 열원"
        desc="종류마다 다른 열원을 쓸 수 있습니다. 도면의 배치점, 구역 목록의 대수, 엑셀 보고서가 이 계획을 따릅니다."
        bodyClassName="p-0"
      >
        <div className="grid divide-y divide-slate-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {KINDS.map((k) => {
            const list = zones.filter((z) => z.kind === k);
            const cur = appliedHeater(project, { kind: k });
            const units = plan.rows
              .filter((r) => list.some((z) => z.id === r.zoneId))
              .reduce((s, r) => s + r.units, 0);
            return (
              <div key={k} className={cn("p-5", list.length === 0 && "opacity-60")}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13.5px] font-extrabold tracking-tight text-slate-800">{ZONE_KIND_LABEL[k]}</span>
                  <span className="text-[11.5px] tabular-nums text-slate-400">
                    {list.length > 0 ? `구역 ${list.length}개 · ${int(units)}대` : "구역 없음"}
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {heaters.map((h) => {
                    const active = h.id === cur.id;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => onApply({ [k]: h.id })}
                        className={cn(
                          "flex h-9 items-center gap-2 rounded-lg border px-3 text-left text-[12.5px] font-bold transition-colors",
                          active
                            ? "border-[#0a63b8] bg-blue-50 text-[#0a4f99] ring-1 ring-[#0a63b8]/25"
                            : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                        )}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                        <span className="flex-1 truncate">{h.name}</span>
                        {active && <CircleCheck className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <span className="text-[12.5px] font-bold text-slate-600">
            적용 계획 동절기 금액 <b className="ml-1 text-[16px] tabular-nums text-[#0a4f99]">{won(plan.seasonTotal)}</b>
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] tabular-nums text-slate-500">
            {PARTS.map((p) => (
              <span key={p.key} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                {p.label} {won(plan[p.key])}
              </span>
            ))}
          </div>
          {mixed && hasFloor && (
            <span className="text-[11px] text-slate-400">
              기준층 인건비는 그 층에 쓴 열원 중 품이 큰 쪽({dec(plan.floor?.mandays ?? 0, 1)}품) 한 번만 셉니다.
            </span>
          )}
        </div>
      </Card>

      {/* 한 열원만 썼을 때 */}
      <div>
        <h3 className="mb-2 px-1 text-[12.5px] font-extrabold tracking-tight text-slate-600">
          한 열원만 썼을 때 <span className="font-medium text-slate-400">— 모든 구역에 같은 열원</span>
        </h3>
        <div className={cn("grid gap-4", heaters.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {heaters.map((h) => {
            const c = costOf(h.id);
            const active = uniform === h.id;
            const isCheapest = h.id === summary.cheapestId;
            const ratio = cheapest && cheapest.seasonTotal > 0 ? c.seasonTotal / cheapest.seasonTotal : 1;
            return (
              <div
                key={h.id}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-white p-5 transition-shadow",
                  active
                    ? "border-[#0a63b8] shadow-[0_12px_32px_-16px_rgba(10,99,184,0.55)] ring-1 ring-[#0a63b8]/30"
                    : "border-slate-200/80 shadow-[0_8px_24px_-18px_rgba(15,42,74,0.25)]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                      style={{ background: h.color }}
                    >
                      <Flame className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-[15px] font-extrabold tracking-tight text-slate-800">{h.name}</div>
                      <div className="text-[11.5px] tabular-nums text-slate-400">
                        대당 {int(heaterOutput(h))} kcal/h · {dec(h.burnHours, 1)}시간 지속
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isCheapest && (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">
                        최저 금액
                      </span>
                    )}
                    <Verdict ok={c.allOk} />
                  </div>
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-[30px] font-extrabold tabular-nums tracking-tight text-slate-900">
                    {wonShort(c.seasonTotal)}
                  </span>
                  <span className="text-[13px] font-semibold text-slate-400">원 · 동절기</span>
                  {!isCheapest && cheapest && cheapest.seasonTotal > 0 && (
                    <span className="ml-auto text-[12px] font-bold tabular-nums text-rose-600">×{dec(ratio, 2)}</span>
                  )}
                </div>

                {/* 금액 구성 막대 — 가장 비싼 경우를 100% 로 맞춰 길이로 비교한다 */}
                <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  {PARTS.map((p) => {
                    const v = c[p.key];
                    if (v <= 0) return null;
                    return (
                      <div
                        key={p.key}
                        title={`${p.label} ${won(v)}`}
                        className="h-full border-r-2 border-white last:border-0"
                        style={{ width: `${(v / maxSeason) * 100}%`, background: p.color }}
                      />
                    );
                  })}
                </div>
                <dl className="mt-3 space-y-1 text-[12px]">
                  {PARTS.map((p) => (
                    <div key={p.key} className="flex items-center justify-between">
                      <dt className="flex items-center gap-1.5 text-slate-500">
                        <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                        {p.label}
                      </dt>
                      <dd className="font-semibold tabular-nums text-slate-700">{won(c[p.key])}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11.5px]">
                  <Stat label="동시 배치 대수" value={`${int(c.peakUnits)}대`} />
                  <Stat label="동절기 연료" value={`${int(c.byHeater[h.id]?.seasonFuel ?? 0)}${h.fuelUnit}`} />
                  {c.floor && <Stat label="1개층 금액" value={won(c.floor.perPour)} />}
                  {c.floor && <Stat label="1개층 대수" value={`${int(c.floor.units)}대`} />}
                </div>

                {h.note && <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400">{h.note}</p>}

                <button
                  type="button"
                  onClick={() => onApply({ unit: h.id, core: h.id, parking: h.id })}
                  disabled={active}
                  className={cn(
                    "mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-bold transition-colors",
                    active
                      ? "bg-[#0a63b8] text-white"
                      : "border border-slate-200 text-slate-600 hover:border-[#0a63b8] hover:bg-blue-50 hover:text-[#0a63b8]",
                  )}
                >
                  {active ? (
                    <>
                      <CircleCheck className="h-4 w-4" />
                      전체 적용 중
                    </>
                  ) : (
                    "모든 구역에 이 열원 적용"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 금액 산출 */}
      <Card
        title="산출서 및 투입금액 비교"
        desc={`급열 ${cost.cureHours}시간 · 노임 ${won(cost.wage)}/품 기준. 「조건·열원」 탭에서 고칩니다.`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11.5px] font-bold text-slate-500">
                <th className="px-5 py-2.5 text-left">항목</th>
                {columns.map((c) => (
                  <th key={c.id} className={cn("px-4 py-2.5 text-right", isPlanCol(c.id) && "bg-blue-50/70 text-[#0a4f99]")}>
                    <span className="inline-flex items-center gap-1.5">
                      {c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
                      {c.label}
                      {isPlanCol(c.id) && !mixed && <span className="text-[10px]">(적용)</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <Row
                label="1회 투입량 · 지속시간"
                cells={columns.map((c) => spec(c.id, (h) => `${dec(h.loadPerFill, 1)}${h.fuelUnit} · ${dec(h.burnHours, 1)}h`))}
              />
              <Row label="대당 시간당 급열량" cells={columns.map((c) => spec(c.id, (h) => `${int(heaterOutput(h))} kcal/h`))} />
              <Row label="연료 단가" cells={columns.map((c) => spec(c.id, (h) => `${int(h.fuelPrice)}원/${h.fuelUnit}`))} />
              <Row label="대당 월 임대료" cells={columns.map((c) => spec(c.id, (h) => won(h.rentalMonthly)))} />

              {hasFloor && (
                <>
                  <GroupRow span={columns.length + 1}>
                    기준층 1개층 (세대·코어) — 동절기 {int(plan.floor?.repeats ?? 0)}회
                  </GroupRow>
                  <Row label="1개층 필요 대수" cells={columns.map((c) => `${int(c.cost.floor!.units)}대`)} />
                  <Row label="연료비" cells={columns.map((c) => won(c.cost.floor!.fuelCost))} />
                  <Row label="임대료 (월 임대료 ÷ 월 타설 층수)" cells={columns.map((c) => won(c.cost.floor!.rental))} />
                  <Row
                    label="인건비"
                    cells={columns.map((c) => `${won(c.cost.floor!.labor)} (${dec(c.cost.floor!.mandays, 1)}품)`)}
                  />
                  <Row strong label="1개층 합계" cells={columns.map((c) => won(c.cost.floor!.perPour))} />
                  <Row strong label="기준층 동절기 합계" cells={columns.map((c) => won(c.cost.floor!.season))} />
                </>
              )}

              {parkingZones.length > 0 && (
                <>
                  <GroupRow span={columns.length + 1}>주차장·지하 — 구역별</GroupRow>
                  {parkingZones.map((z) => (
                    <Row
                      key={z.id}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm" style={{ background: zoneColor(z.color) }} />
                          {z.name}
                          <span className="text-slate-400">
                            {z.qty > 1 && `×${z.qty} `}· {z.repeats}회 · 임대 {dec(z.rentalMonths, 1)}개월
                          </span>
                        </span>
                      }
                      cells={columns.map((c) => {
                        const b = c.cost.parking.find((p) => p.zoneId === z.id)!;
                        return (
                          <span>
                            {won(b.season)}
                            <span className="ml-1.5 text-[11px] text-slate-400">{int(b.units)}대</span>
                          </span>
                        );
                      })}
                    />
                  ))}
                </>
              )}

              <tr className="border-t-2 border-slate-300 bg-[#f3f7fd]">
                <td className="px-5 py-3 text-[13px] font-extrabold text-slate-800">동절기 투입 금액 합계</td>
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      "px-4 py-3 text-right text-[14px] font-extrabold",
                      isPlanCol(c.id) ? "text-[#0a4f99]" : "text-slate-800",
                    )}
                  >
                    {won(c.cost.seasonTotal)}
                  </td>
                ))}
              </tr>
              <tr className="bg-[#f3f7fd]">
                <td className="px-5 pb-3 text-[12px] font-semibold text-slate-500">
                  {mixed ? "적용 계획" : `${nameOf(uniform!)}(적용)`} 대비
                </td>
                {columns.map((c) => {
                  const d = c.cost.seasonTotal - plan.seasonTotal;
                  const pct = plan.seasonTotal > 0 ? (c.cost.seasonTotal / plan.seasonTotal) * 100 : 0;
                  return (
                    <td key={c.id} className="px-4 pb-3 text-right text-[12px] font-bold">
                      {isPlanCol(c.id) ? (
                        <span className="text-slate-400">기준</span>
                      ) : (
                        <span className={d < 0 ? "text-emerald-600" : "text-rose-600"}>
                          {d < 0 ? "(−)" : "(+)"}
                          {won(Math.abs(d))} · {dec(pct, 1)}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* 구역별 산출 */}
      <Card
        title="구역별 열원 산출"
        desc="구역 1개당 손실열량과 열원별 대수. 파란 칸이 그 구역에 적용한 열원입니다. 여유율 = (급열량 − 손실열량) ÷ 손실열량."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11.5px] font-bold text-slate-500">
                <th className="px-5 py-2.5 text-left">구역</th>
                <th className="px-3 py-2.5 text-left">종류 · 방식</th>
                <th className="px-3 py-2.5 text-right">면적</th>
                <th className="px-3 py-2.5 text-right">층고</th>
                <th className="px-3 py-2.5 text-right">수량</th>
                <th className="px-3 py-2.5 text-right">손실열량 kcal/h</th>
                {heaters.map((h) => (
                  <th key={h.id} className="px-3 py-2.5 text-right">
                    {h.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {zones.map((z) => {
                const loss = zoneLoss(z, project.conditions);
                const appliedId = appliedHeater(project, z).id;
                return (
                  <tr key={z.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center gap-2 font-bold text-slate-800">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: zoneColor(z.color) }} />
                        {z.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {ZONE_KIND_LABEL[z.kind]}
                      <span className="ml-1 text-[11px] text-slate-400">{METHOD_LABEL[z.method].split(" ")[0]}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{dec(z.geometry.area, 1)}㎡</td>
                    <td className="px-3 py-2.5 text-right">{dec(z.height, 2)}m</td>
                    <td className="px-3 py-2.5 text-right">{z.qty}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-800">
                      {loss.issue ? <span className="font-semibold text-amber-600">{loss.issue}</span> : int(loss.total)}
                    </td>
                    {heaters.map((h) => {
                      const need = heaterNeed(loss, h, z);
                      return (
                        <td key={h.id} className={cn("px-3 py-2.5 text-right", h.id === appliedId && "bg-blue-50/70")}>
                          {loss.issue ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              <span className="text-[11px] text-slate-400">
                                {need.marginPct >= 0 ? "+" : ""}
                                {dec(need.marginPct, 0)}%
                              </span>
                              <b className={cn("text-slate-800", need.overridden && "text-amber-600")}>{need.applied}대</b>
                              <Verdict ok={need.ok} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  tone,
  strong,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  unit: string;
  sub: string;
  tone?: "ok" | "warn";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        strong
          ? "border-transparent bg-gradient-to-br from-[#0f2a4a] to-[#0a4f99] text-white shadow-[0_14px_32px_-18px_rgba(10,79,153,0.8)]"
          : "border-slate-200/80 bg-white shadow-[0_8px_24px_-18px_rgba(15,42,74,0.25)]",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[12px] font-semibold", strong ? "text-blue-200" : "text-slate-500")}>
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={cn("text-[26px] font-extrabold tabular-nums tracking-tight", strong ? "text-white" : "text-slate-900")}>
          {value}
        </span>
        <span className={cn("text-[12px] font-semibold", strong ? "text-blue-200" : "text-slate-400")}>{unit}</span>
      </div>
      <div
        className={cn(
          "mt-1 truncate text-[11.5px] font-medium",
          strong
            ? tone === "warn"
              ? "text-amber-300"
              : "text-blue-200"
            : tone === "warn"
              ? "text-amber-600"
              : tone === "ok"
                ? "text-emerald-600"
                : "text-slate-400",
        )}
        title={sub}
      >
        {sub}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
      <div className="text-slate-400">{label}</div>
      <div className="font-bold tabular-nums text-slate-700">{value}</div>
    </div>
  );
}

function Row({
  label,
  cells,
  strong,
}: {
  label: React.ReactNode;
  cells: React.ReactNode[];
  strong?: boolean;
}) {
  return (
    <tr className={cn("border-b border-slate-100", strong && "bg-slate-50/70")}>
      <td className={cn("px-5 py-2", strong ? "font-bold text-slate-800" : "text-slate-600")}>{label}</td>
      {cells.map((c, i) => (
        <td key={i} className={cn("px-4 py-2 text-right", strong ? "font-bold text-slate-900" : "text-slate-700")}>
          {c}
        </td>
      ))}
    </tr>
  );
}

function GroupRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-200 bg-[#eef3fb]">
      <td colSpan={span} className="px-5 py-1.5 text-[11.5px] font-extrabold tracking-tight text-[#0a4f99]">
        {children}
      </td>
    </tr>
  );
}
