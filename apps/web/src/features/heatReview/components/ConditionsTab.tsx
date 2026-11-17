/**
 * 조건·열원 — 검토서 전체에 걸리는 가정(온도·계수·열원 제원·비용).
 * 값의 출처(한중콘크리트 적용지침 / 현장 엑셀)를 칸 옆에 적어, 어디를 현장에 맞게 고쳐야 하는지 보이게 한다.
 */
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_CONDITIONS, DEFAULT_COST, DEFAULT_HEATERS, newId, pickHeater } from "../defaults";
import { floorRepeats, heaterOutput } from "../engine/calc";
import type { Conditions, CostSettings, CountRule, Heater, HeatProject } from "../types";
import { Card, dec, Field, int, NumField, Segmented, TextField } from "./ui";

const HEATER_COLORS = ["#e2622b", "#2f9e6e", "#5a6b8c", "#9a4fc4", "#1f9bb5", "#d2456e"];

export default function ConditionsTab({
  project,
  update,
}: {
  project: HeatProject;
  update: (fn: (p: HeatProject) => HeatProject) => void;
}) {
  const c = project.conditions;
  const cost = project.cost;
  const setC = (patch: Partial<Conditions>) =>
    update((p) => ({ ...p, conditions: { ...p.conditions, ...patch } }));
  const setCost = (patch: Partial<CostSettings>) => update((p) => ({ ...p, cost: { ...p.cost, ...patch } }));
  const setHeater = (id: string, patch: Partial<Heater>) =>
    update((p) => ({ ...p, heaters: p.heaters.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));

  const dA = c.cureTemp - c.outdoorTemp;
  const dB = c.cureTemp - c.upperTemp;
  const dC = c.upperTemp - c.outdoorTemp;
  const factorApt = c.fSize * c.fJoint * c.fShapeApt * c.fOverlap;
  const factorOpen = c.fSize * c.fJoint * c.fShapeOpen * c.fOverlap;

  const reset = (
    <button
      type="button"
      onClick={() => {
        if (!window.confirm("온도·계수·비용 가정을 기본값으로 되돌릴까요? (열원 제원과 구역은 그대로 둡니다)")) return;
        update((p) => ({ ...p, conditions: { ...DEFAULT_CONDITIONS }, cost: { ...DEFAULT_COST } }));
      }}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      <RotateCcw className="h-3 w-3" />
      기본값
    </button>
  );

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-2">
      <Card title="온도 조건" desc="현장 기준에 맞게 입력합니다. 한중콘크리트: 일평균 4℃ 이하." action={reset}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="외기 온도 (a)">
            <NumField value={c.outdoorTemp} unit="℃" onChange={(outdoorTemp) => setC({ outdoorTemp })} />
          </Field>
          <Field label="양생실 목표 (b)">
            <NumField value={c.cureTemp} unit="℃" onChange={(cureTemp) => setC({ cureTemp })} />
          </Field>
          <Field label="상옥 목표 (c)" hint="정밀식">
            <NumField value={c.upperTemp} unit="℃" onChange={(upperTemp) => setC({ upperTemp })} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Delta label="내부−외기 (A)" value={dA} />
          <Delta label="내부−상옥 (B)" value={dB} />
          <Delta label="상옥−외기 (C)" value={dC} />
        </div>
        {(dA <= 0 || dB < 0 || dC < 0) && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-200">
            온도 순서를 확인하세요 — 외기 &lt; 상옥 ≤ 양생실이어야 합니다.
          </p>
        )}
      </Card>

      <Card title="비용 가정" desc="1회 타설 금액과 동절기 전체 금액을 내는 데 씁니다.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="급열 시간" hint="타설 후 급열 유지">
            <NumField value={cost.cureHours} unit="시간" min={0} onChange={(cureHours) => setCost({ cureHours })} />
          </Field>
          <Field label="노임 단가" hint="식대 포함">
            <NumField value={cost.wage} unit="원/품" min={0} step={10000} onChange={(wage) => setCost({ wage })} />
          </Field>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
          <div className="mb-2 text-[12px] font-bold text-slate-600">기준층(세대·코어) 동절기 반복</div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="월 타설 층수" className="w-[104px]">
              <NumField value={cost.floorsPerMonth} unit="층" min={0} onChange={(floorsPerMonth) => setCost({ floorsPerMonth })} />
            </Field>
            <span className="pb-2 text-slate-300">×</span>
            <Field label="동절기 기간" className="w-[104px]">
              <NumField value={cost.months} unit="개월" min={0} onChange={(months) => setCost({ months })} />
            </Field>
            <span className="pb-2 text-slate-300">×</span>
            <Field label="동 수" className="w-[104px]">
              <NumField value={cost.buildings} unit="개동" min={0} onChange={(buildings) => setCost({ buildings })} />
            </Field>
            <span className="pb-2 text-slate-300">=</span>
            <div className="pb-1.5 text-[18px] font-extrabold tabular-nums text-[#0a4f99]">
              {int(floorRepeats(cost))}
              <span className="ml-0.5 text-[12px] font-semibold text-slate-400">회</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            주차장·지하 구역은 구역마다 보양 횟수와 임대 기간을 따로 넣습니다(구역 상세).
          </p>
        </div>
      </Card>

      <Card
        title="정밀식 계수 — 양생실 + 상옥공간"
        desc="단위세대·코어 구역에 적용. 한중콘크리트 적용지침 값을 현장 여건에 맞게 고칩니다."
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          <Field label="상옥 층고 (d')" hint="층고 +2m">
            <NumField value={c.upperHeight} unit="m" min={0} step={0.1} onChange={(upperHeight) => setC({ upperHeight })} />
          </Field>
          <Field label="콘크리트 (i)">
            <NumField value={c.uConcrete} min={0} step={0.1} onChange={(uConcrete) => setC({ uConcrete })} />
          </Field>
          <Field label="개구부 버블시트 (j)">
            <NumField value={c.uOpening} min={0} step={0.1} onChange={(uOpening) => setC({ uOpening })} />
          </Field>
          <Field label="천막지 (k)">
            <NumField value={c.uTent} min={0} step={0.1} onChange={(uTent) => setC({ uTent })} />
          </Field>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">열손실계수 단위: kcal/㎡·h·℃</p>

        <div className="mt-4 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
          <div className="mb-2 text-[12px] font-bold text-slate-600">필요 대수 규칙</div>
          <div className="space-y-1.5">
            {(
              [
                ["단위세대", "enclosureCountRule"],
                ["코어", "coreCountRule"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-slate-500">{label}</span>
                <Segmented<CountRule>
                  size="sm"
                  value={c[key]}
                  options={[
                    { value: "roundPlus1", label: "반올림 + 1대" },
                    { value: "ceil", label: "올림 (최소 대수)" },
                  ]}
                  onChange={(v) => setC({ [key]: v })}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
            <b>반올림 + 1대</b>: 손실열량 ÷ 대당 급열량을 반올림하고 1대를 더합니다(1.92 → 3대). 세대는 벽으로 칸이
            나뉘어 열이 고르게 퍼지지 않아 여유를 둡니다(당사 검토서·배치도).
            <br />
            <b>올림</b>: 손실열량을 넘기는 가장 적은 대수입니다(1.92 → 2대). 코어처럼 한 공간인 곳의 기본값입니다.
            주차장·지하는 항상 올림입니다.
          </p>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 text-[12px] font-bold text-slate-600">환기횟수 = 기준(가) × 나 × 다 × 라 × 마</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
            <Field label="기준 (가) 내부">
              <NumField value={c.ventBaseInner} unit="회/h" min={0} onChange={(ventBaseInner) => setC({ ventBaseInner })} />
            </Field>
            <Field label="기준 (가) 상옥">
              <NumField value={c.ventBaseOuter} unit="회/h" min={0} onChange={(ventBaseOuter) => setC({ ventBaseOuter })} />
            </Field>
            <Field label="(나) 양생포 크기">
              <NumField value={c.fSize} min={0} step={0.1} onChange={(fSize) => setC({ fSize })} />
            </Field>
            <Field label="(다) 이음 상태">
              <NumField value={c.fJoint} min={0} step={0.1} onChange={(fJoint) => setC({ fJoint })} />
            </Field>
            <Field label="(라) 평면형상 · 아파트">
              <NumField value={c.fShapeApt} min={0} step={0.1} onChange={(fShapeApt) => setC({ fShapeApt })} />
            </Field>
            <Field label="(라) 오피스·주차장">
              <NumField value={c.fShapeOpen} min={0} step={0.1} onChange={(fShapeOpen) => setC({ fShapeOpen })} />
            </Field>
            <Field label="(마) 겹침·이음매">
              <NumField value={c.fOverlap} min={0} step={0.1} onChange={(fOverlap) => setC({ fOverlap })} />
            </Field>
            <Field label="여유율">
              <NumField value={c.enclosureSafety} unit="%" min={0} onChange={(enclosureSafety) => setC({ enclosureSafety })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11.5px] tabular-nums text-slate-500">
            <Chip>세대·코어: 내부 {dec(c.ventBaseInner * factorApt, 2)} · 상옥 {dec(c.ventBaseOuter * factorApt, 2)} 회/h</Chip>
            <Chip>주차장(정밀식 선택 시): 내부 {dec(c.ventBaseInner * factorOpen, 2)} · 상옥 {dec(c.ventBaseOuter * factorOpen, 2)} 회/h</Chip>
          </div>
        </div>
      </Card>

      <Card title="간이식 계수 — 표면적" desc="주차장·지하 등 넓은 구획에 적용. (바닥+천장+벽) × 평균 열관류율.">
        <div className="grid grid-cols-3 gap-3">
          <Field label="평균 열관류율">
            <NumField value={c.simpleU} unit="kcal/㎡h℃" min={0} step={0.1} onChange={(simpleU) => setC({ simpleU })} />
          </Field>
          <Field label="시간당 환기 횟수">
            <NumField value={c.simpleAch} unit="회/h" min={0} step={0.1} onChange={(simpleAch) => setC({ simpleAch })} />
          </Field>
          <Field label="안전율">
            <NumField value={c.simpleSafety} unit="%" min={0} onChange={(simpleSafety) => setC({ simpleSafety })} />
          </Field>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-[12px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          <b className="text-slate-700">총 소요 열량</b> = (표면적 × 열관류율 × 온도차 + 체적 × 환기횟수 × 0.24 × 1.2 × 온도차) × (1 + 안전율)
          <br />
          0.24 = 공기 비열(kcal/kg℃), 1.2 = 공기 밀도(kg/㎥)
        </div>
      </Card>

      <Card
        className="xl:col-span-2"
        title="열원 제원·단가"
        desc="비교할 열원을 넣습니다. 급열량은 「정격 × 효율」 또는 「kg당 열량 × 1회 투입량 ÷ 연소시간」으로 계산합니다."
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("열원 목록을 기본 3종(등유 열풍기·펠릿난로·고체연료)으로 되돌릴까요?")) return;
                update((p) => ({
                  ...p,
                  heaters: DEFAULT_HEATERS.map((h) => ({ ...h })),
                  appliedHeaters: {
                    unit: pickHeater(DEFAULT_HEATERS, p.appliedHeaters.unit),
                    core: pickHeater(DEFAULT_HEATERS, p.appliedHeaters.core),
                    parking: pickHeater(DEFAULT_HEATERS, p.appliedHeaters.parking),
                  },
                }));
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <RotateCcw className="h-3 w-3" />
              기본값
            </button>
            <button
              type="button"
              onClick={() =>
                update((p) => ({
                  ...p,
                  heaters: [
                    ...p.heaters,
                    {
                      ...DEFAULT_HEATERS[0],
                      id: newId(),
                      name: `열원 ${p.heaters.length + 1}`,
                      color: HEATER_COLORS[p.heaters.length % HEATER_COLORS.length],
                      note: "",
                    },
                  ],
                }))
              }
              className="flex h-8 items-center gap-1 rounded-lg bg-[#0a63b8] px-3 text-[12px] font-bold text-white hover:bg-[#08539b]"
            >
              <Plus className="h-3.5 w-3.5" />
              열원 추가
            </button>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold text-slate-500">
                <th className="px-4 py-2.5">열원</th>
                <th className="px-2 py-2.5">급열량 산정</th>
                <th className="px-2 py-2.5">제원</th>
                <th className="px-2 py-2.5 text-right">대당 급열량</th>
                <th className="px-2 py-2.5">연료 (1회 투입 · 지속)</th>
                <th className="px-2 py-2.5">연료 단가</th>
                <th className="px-2 py-2.5">월 임대료</th>
                <th className="px-2 py-2.5">투입 인원</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {project.heaters.map((h) => (
                <tr key={h.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: h.color }} />
                      <TextField value={h.name} onChange={(name) => setHeater(h.id, { name })} className="w-[150px]" />
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={h.electric}
                        onChange={(e) => setHeater(h.id, { electric: e.target.checked })}
                        className="h-3.5 w-3.5 accent-[#0a63b8]"
                      />
                      전기식 (환기손실 10%)
                    </label>
                  </td>
                  <td className="px-2 py-3">
                    <Segmented<Heater["mode"]>
                      size="sm"
                      value={h.mode}
                      options={[
                        { value: "rated", label: "정격×효율" },
                        { value: "fuel", label: "연료 열량" },
                      ]}
                      onChange={(mode) => setHeater(h.id, { mode })}
                    />
                  </td>
                  <td className="px-2 py-3">
                    {h.mode === "rated" ? (
                      <div className="flex gap-1.5">
                        <NumField value={h.ratedKcal} unit="kcal/h" min={0} step={1000} className="w-[132px]" onChange={(ratedKcal) => setHeater(h.id, { ratedKcal })} />
                        <NumField value={h.efficiency} unit="효율" min={0} step={0.01} className="w-[92px]" onChange={(efficiency) => setHeater(h.id, { efficiency })} />
                      </div>
                    ) : (
                      <NumField value={h.kcalPerUnit} unit={`kcal/${h.fuelUnit}`} min={0} step={100} className="w-[132px]" onChange={(kcalPerUnit) => setHeater(h.id, { kcalPerUnit })} />
                    )}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <div className="pt-2 text-[13.5px] font-extrabold tabular-nums text-[#0a4f99]">{int(heaterOutput(h))}</div>
                    <div className="text-[10.5px] text-slate-400">kcal/h</div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex gap-1.5">
                      <NumField value={h.loadPerFill} min={0} className="w-[72px]" onChange={(loadPerFill) => setHeater(h.id, { loadPerFill })} />
                      <TextField value={h.fuelUnit} onChange={(fuelUnit) => setHeater(h.id, { fuelUnit })} className="w-[46px] px-1.5 text-center" />
                      <NumField value={h.burnHours} unit="h" min={0} step={0.5} className="w-[78px]" onChange={(burnHours) => setHeater(h.id, { burnHours })} />
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <NumField value={h.fuelPrice} unit={`원/${h.fuelUnit}`} min={0} className="w-[124px]" onChange={(fuelPrice) => setHeater(h.id, { fuelPrice })} />
                  </td>
                  <td className="px-2 py-3">
                    <NumField value={h.rentalMonthly} unit="원" min={0} step={1000} className="w-[112px]" onChange={(rentalMonthly) => setHeater(h.id, { rentalMonthly })} />
                  </td>
                  <td className="px-2 py-3">
                    <NumField value={h.laborMandays} unit="품/회" min={0} className="w-[98px]" onChange={(laborMandays) => setHeater(h.id, { laborMandays })} />
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      disabled={project.heaters.length <= 1}
                      title="열원 삭제"
                      onClick={() =>
                        update((p) => {
                          const heaters = p.heaters.filter((x) => x.id !== h.id);
                          return {
                            ...p,
                            heaters,
                            // 지운 열원을 쓰던 종류는 첫 열원으로 돌린다
                            appliedHeaters: {
                              unit: pickHeater(heaters, p.appliedHeaters.unit),
                              core: pickHeater(heaters, p.appliedHeaters.core),
                              parking: pickHeater(heaters, p.appliedHeaters.parking),
                            },
                          };
                        })
                      }
                      className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-[11.5px] leading-relaxed text-slate-400">
          투입 인원 = 1회 타설(급열 {cost.cureHours}시간)에 들어가는 품. 기본값: 인양·배치 4 + 해체·하역 3 + 주간 관리 4 + 야간 관리(열풍기·고체연료 8, 펠릿 2).
        </div>
      </Card>
    </div>
  );
}

function Delta({ label, value }: { label: string; value: number }) {
  return (
    <div className={cn("rounded-xl px-3 py-2.5 ring-1", value > 0 ? "bg-blue-50/60 ring-blue-100" : "bg-amber-50 ring-amber-200")}>
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 text-[18px] font-extrabold tabular-nums text-[#0a4f99]">
        {dec(value, 1)}
        <span className="ml-0.5 text-[12px] font-semibold text-slate-400">℃</span>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-slate-100 px-2 py-1">{children}</span>;
}
