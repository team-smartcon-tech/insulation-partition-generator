/**
 * 구역 상세 — 선택한 구역의 입력(형상·층고·개구부·수량)과 결과(손실열량 내역·열원별 필요 대수).
 */
import { Flame, MousePointerClick, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_DEFAULTS, METHOD_LABEL, ZONE_KIND_LABEL, newId, zoneColor } from "../defaults";
import { edgeLossShare, heaterNeed, type ZoneLoss } from "../engine/calc";
import { round } from "../engine/geometry";
import type { CalcMethod, Heater, Zone, ZoneKind } from "../types";
import { dec, Field, int, NumField, Segmented, TextField, Verdict } from "./ui";
import type { PartView } from "./ZoneCanvas";

export default function ZoneInspector({
  zone,
  loss,
  heaters,
  selectedHeaterId,
  measuredPerimeter,
  autoQty,
  parts,
  insideFrame,
  misses,
  onOffset,
  onChange,
  onDelete,
}: {
  zone: Zone | null;
  loss: ZoneLoss | null;
  heaters: Heater[];
  selectedHeaterId: string;
  /** 도면 다각형의 외곽선 길이(m). 치수 구역이면 null */
  measuredPerimeter: number | null;
  /** 동 외곽이 세어 준 개수. 없으면 null (직접 입력) */
  autoQty: number | null;
  /** 이 구역이 동 외곽이고 안에서 세대·코어를 찾았으면 그 목록 */
  parts: PartView[] | null;
  /** 이 구역이 어느 동 외곽 안에 그려져 있으면 그 동 외곽 이름 — 이런 구역은 동 외곽이 될 수 없다 */
  insideFrame: string | null;
  /** 이 동 외곽 안에서 한 곳도 못 찾은 타입·코어 — 꼭짓점이 몇 개까지 맞았는지 */
  misses: { name: string; matched: number; total: number }[];
  /** 외곽 여유(m) 변경 — 면적·둘레를 다시 내야 해서 페이지가 처리한다 */
  onOffset: (offset: number) => void;
  onChange: (patch: Partial<Zone>) => void;
  onDelete: () => void;
}) {
  if (!zone || !loss) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <MousePointerClick className="h-5 w-5" />
        </span>
        <p className="mt-4 text-[14px] font-bold text-slate-700">구역을 선택하세요</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">
          도면에서 구역을 그리거나 왼쪽 목록에서 고르면
          <br />
          손실열량과 필요 열원 대수가 여기에 나옵니다.
        </p>
      </div>
    );
  }

  const g = zone.geometry;
  const manual = g.source === "manual";
  const setGeom = (patch: Partial<Zone["geometry"]>) => onChange({ geometry: { ...g, ...patch } });
  /** 가로×세로 치수 → 면적·둘레. 외곽 여유만큼 사방으로 넓힌 크기로 낸다 */
  const dimGeom = (l: number, w: number) => {
    const o = g.offset ?? 0;
    return {
      dims: { l, w },
      area: round((l + 2 * o) * (w + 2 * o), 3),
      perimeter: round(2 * (l + w + 4 * o), 3),
    };
  };
  const groups = Array.from(new Set(loss.items.map((i) => i.group)));
  // 세대·코어를 찾은 동 외곽 — 외곽 전체를 한 방으로 본 값이 아니라 안에 든 세대·코어의 합계를 보여 준다
  const frame = zone.container && parts && parts.length > 0 ? parts : null;
  const frameRows = frame
    ? Array.from(
        frame
          .reduce((m, p) => {
            const r = m.get(p.templateId) ?? { name: p.name, n: 0, loss: 0, count: 0 };
            r.n += 1;
            r.loss += p.loss;
            r.count += p.count;
            return m.set(p.templateId, r);
          }, new Map<string, { name: string; n: number; loss: number; count: number }>())
          .values(),
      )
    : [];
  const frameLoss = frameRows.reduce((s, r) => s + r.loss, 0);
  const frameCount = frameRows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_24px_-18px_rgba(15,42,74,0.25)]">
      {/* 머리 */}
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: zoneColor(zone.color) }} />
        <input
          value={zone.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="구역 이름 (예: CJ-1, 59A형)"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[16px] font-extrabold tracking-tight text-slate-800 outline-none placeholder:font-semibold placeholder:text-slate-300 hover:bg-slate-50 focus:bg-slate-50"
        />
        <button
          type="button"
          onClick={onDelete}
          title="구역 삭제"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* 결과 요약 */}
        <div className="rounded-xl bg-gradient-to-br from-[#0f2a4a] to-[#0a4f99] p-4 text-white">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-blue-200">
            <Flame className="h-3.5 w-3.5" />
            {frame ? "동 합계 손실열량" : "총 손실열량"}
            {loss.safetyPct > 0 && <span className="text-blue-300/80">(여유율 {loss.safetyPct}% 포함)</span>}
          </div>
          {frame ? (
            <>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[28px] font-extrabold tabular-nums tracking-tight">{int(frameLoss)}</span>
                <span className="text-[12px] font-medium text-blue-200">kcal/h</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-[11px] text-blue-200">
                <Mini label="세대·코어" value={`${frame.length}곳`} />
                <Mini label="열원 합계" value={`${frameCount}대`} />
                <Mini label="외곽 면적" value={`${dec(loss.area, 1)}㎡`} />
              </div>
            </>
          ) : loss.issue ? (
            <div className="mt-1.5 text-[14px] font-bold text-amber-300">{loss.issue}</div>
          ) : (
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[28px] font-extrabold tabular-nums tracking-tight">{int(loss.total)}</span>
              <span className="text-[12px] font-medium text-blue-200">kcal/h</span>
            </div>
          )}
          {!frame && (
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-[11px] text-blue-200">
              <Mini label="바닥면적" value={`${dec(loss.area, 1)}㎡`} />
              <Mini label="둘레" value={`${dec(loss.perimeter, 1)}m`} />
              <Mini label="체적" value={`${dec(loss.volume, 0)}㎥`} />
            </div>
          )}
        </div>

        {/* 동 합계 내역 — 타입·코어별 세대수 × 손실열량 · 대수 */}
        {frame && (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {frameRows.map((r) => (
              <div
                key={r.name}
                className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-[12px]"
              >
                <span className="font-bold text-slate-700">
                  {r.name} <span className="font-medium text-slate-400">×{r.n}</span>
                </span>
                <span className="tabular-nums text-slate-600">
                  {int(r.loss)} <span className="text-[10.5px] text-slate-400">kcal/h</span>
                  <span className="ml-2 font-bold text-slate-800">{r.count}대</span>
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
              <span className="text-[12px] font-bold text-slate-600">동 합계</span>
              <span className="text-[13.5px] font-extrabold tabular-nums text-[#0a4f99]">
                {int(frameLoss)} · {frameCount}대
              </span>
            </div>
          </div>
        )}

        {/* 종류·방식 */}
        <div className="space-y-3">
          <Field label="구역 종류">
            <Segmented<ZoneKind>
              className="flex w-full"
              value={zone.kind}
              options={(Object.keys(ZONE_KIND_LABEL) as ZoneKind[]).map((k) => ({
                value: k,
                label: ZONE_KIND_LABEL[k],
              }))}
              onChange={(kind) =>
                // 종류를 바꾸면 그 종류의 기본 산정 방식으로 따라간다 (층고는 사용자가 넣은 값 유지)
                onChange({ kind, method: KIND_DEFAULTS[kind].method })
              }
            />
          </Field>
          {zone.kind === "unit" && !manual && insideFrame && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
              동 외곽 <b className="text-slate-700">「{insideFrame}」</b> 안에 그린 <b className="text-slate-700">세대 타입</b>
              입니다. 같은 모양의 세대를 그 동에서 찾아 세대수를 셉니다.
            </p>
          )}
          {zone.kind === "unit" && !manual && !insideFrame && (
            <Field label="그린 범위" hint={zone.container ? "한 층 전체" : "세대 하나"}>
              <Segmented<"type" | "frame">
                className="flex w-full"
                value={zone.container ? "frame" : "type"}
                options={[
                  { value: "type", label: "세대 타입" },
                  { value: "frame", label: "동 외곽" },
                ]}
                onChange={(v) => onChange(v === "frame" ? { container: true } : { container: false, parts: [] })}
              />
            </Field>
          )}
          {zone.container && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-indigo-900">
              {parts && parts.length > 0 ? (
                <>
                  <b>안에서 세대·코어 {parts.length}곳을 찾았습니다.</b>
                  <div className="mt-1 font-semibold">
                    {Array.from(
                      parts.reduce((m, p) => m.set(p.name, (m.get(p.name) ?? 0) + 1), new Map<string, number>()),
                    )
                      .map(([name, n]) => `${name} ×${n}`)
                      .join(" · ")}
                  </div>
                  <div className="mt-1 text-indigo-700/90">
                    이 구역은 세대수를 세는 틀입니다. 손실열량·대수는 각 타입·코어 구역에서 계산하고, 열원은 세대마다
                    따로 놓습니다. 빠진 세대가 있으면 그 타입을 한 번 그려 주세요.
                  </div>
                </>
              ) : (
                <>
                  <b>안에서 찾은 세대가 없습니다.</b> 지금은 이 외곽 전체를 한 구역으로 계산합니다. 세대 타입(예:
                  84A, 59A)과 코어를 이 도면에 한 번씩 그리면, 뒤집힌 것까지 찾아 세대수를 세고 세대마다 열원을
                  놓습니다.
                </>
              )}
              {misses.length > 0 && (
                <div className="mt-2 border-t border-indigo-200 pt-2 text-amber-800">
                  <b>이 동에서 못 찾은 타입</b>
                  <ul className="mt-0.5 space-y-0.5">
                    {misses.map((m) => (
                      <li key={m.name}>
                        {m.name} — 가장 비슷한 자리에서 꼭짓점 {m.total}개 중 {m.matched}개만 벽선에 맞음
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 text-amber-700/90">
                    크기나 모양이 다른 세대는 다른 타입입니다. 이 동 안에 그 세대를 한 번 그리면 그 타입으로 잡힙니다.
                  </div>
                </div>
              )}
            </div>
          )}
          <Field
            label="산정 방식"
            hint={zone.method === "enclosure" ? "한중콘크리트 적용지침" : "표면적 × 평균 열관류율"}
          >
            <Segmented<CalcMethod>
              className="flex w-full"
              value={zone.method}
              options={(Object.keys(METHOD_LABEL) as CalcMethod[]).map((m) => ({
                value: m,
                label: METHOD_LABEL[m],
              }))}
              onChange={(method) => onChange({ method })}
            />
          </Field>
        </div>

        {/* 형상 */}
        <Section
          title="형상"
          badge={
            manual ? (
              <Segmented<"dims" | "direct">
                size="sm"
                value={g.dims ? "dims" : "direct"}
                options={[
                  { value: "dims", label: "가로×세로" },
                  { value: "direct", label: "면적·둘레" },
                ]}
                onChange={(v) => {
                  if (v === "direct") setGeom({ dims: null });
                  else {
                    const side = round(Math.sqrt(Math.max(g.area, 0)) || 10, 2);
                    setGeom(dimGeom(side, side));
                  }
                }}
              />
            ) : (
              <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-bold text-sky-700 ring-1 ring-sky-200">
                도면에서 측정
              </span>
            )
          }
        >
          {manual && g.dims ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="가로 (L)">
                <NumField
                  value={g.dims.l}
                  unit="m"
                  min={0}
                  onChange={(l) => setGeom(dimGeom(l, g.dims!.w))}
                />
              </Field>
              <Field label="세로 (W)">
                <NumField
                  value={g.dims.w}
                  unit="m"
                  min={0}
                  onChange={(w) => setGeom(dimGeom(g.dims!.l, w))}
                />
              </Field>
            </div>
          ) : null}
          <div className={cn("grid grid-cols-2 gap-2.5", manual && g.dims && "mt-2.5")}>
            <Field label="바닥면적">
              <NumField
                value={g.area}
                unit="㎡"
                min={0}
                disabled={!manual || !!g.dims}
                onChange={(area) => setGeom({ area })}
              />
            </Field>
            <Field
              label="둘레 (벽 길이)"
              hint={
                g.perimeterLocked && measuredPerimeter != null ? (
                  <button
                    type="button"
                    className="font-semibold text-[#0a63b8] hover:underline"
                    title="도면 외곽선 길이로 되돌립니다"
                    onClick={(e) => {
                      e.preventDefault();
                      setGeom({ perimeter: measuredPerimeter, perimeterLocked: false });
                    }}
                  >
                    도면값 {dec(measuredPerimeter, 2)}m 로
                  </button>
                ) : undefined
              }
            >
              <NumField
                value={g.perimeter}
                unit="m"
                min={0}
                disabled={manual && !!g.dims}
                className={cn(g.perimeterLocked && "border-amber-300 bg-amber-50/60")}
                onChange={(perimeter) => setGeom(manual ? { perimeter } : { perimeter, perimeterLocked: true })}
              />
            </Field>
            <Field label="층고">
              <NumField value={zone.height} unit="m" min={0} step={0.05} onChange={(height) => onChange({ height })} />
            </Field>
            <Field label="같은 구역 수" hint={autoQty != null ? "동 외곽에서 자동" : "1회 타설 기준"}>
              <NumField
                value={autoQty ?? zone.qty}
                unit="개"
                min={1}
                disabled={autoQty != null}
                onChange={(qty) => onChange({ qty: Math.max(1, Math.round(qty)) })}
              />
            </Field>
            <Field label="외곽 여유 (옵셋)" hint="딴 선에서 바깥으로">
              <NumField
                value={g.offset ?? 0}
                unit="m"
                min={0}
                step={0.1}
                disabled={manual && !g.dims}
                onChange={onOffset}
              />
            </Field>
            {(g.offset ?? 0) > 0 && (
              <p className="col-span-2 -mt-1 text-[11px] leading-relaxed text-slate-400">
                면적·둘레는 바깥으로 {dec(g.offset ?? 0, 2)}m 띄운 선 기준입니다(도면의 점선이 딴 선).
              </p>
            )}
            {!manual && (
              <p className="col-span-2 -mt-1 text-[11px] leading-relaxed text-slate-400">
                둘레는 그린 외곽선 길이입니다. 세대 내부 벽까지 넣는 기준이면 값을 직접 고치세요(면적은 도면값 유지).
              </p>
            )}
            {zone.kind === "parking" && (
              <>
                <Field label="동절기 보양 횟수">
                  <NumField
                    value={zone.repeats}
                    unit="회"
                    min={0}
                    onChange={(repeats) => onChange({ repeats: Math.max(0, Math.round(repeats)) })}
                  />
                </Field>
                <Field label="장비 임대 기간">
                  <NumField
                    value={zone.rentalMonths}
                    unit="개월"
                    min={0}
                    step={0.5}
                    onChange={(rentalMonths) => onChange({ rentalMonths })}
                  />
                </Field>
              </>
            )}
          </div>
        </Section>

        {/* 개구부 — 정밀식에서만 따로 본다 */}
        {zone.method === "enclosure" && (
          <Section
            title="벽 개구부"
            badge={
              <span className="text-[11.5px] font-semibold tabular-nums text-slate-500">
                합계 {dec(loss.openingArea, 2)}㎡
              </span>
            }
          >
            {zone.openings.length > 0 && (
              <div className="mb-2 space-y-1.5">
                <div className="grid grid-cols-[1fr_62px_62px_48px_24px] gap-1.5 px-0.5 text-[10.5px] font-semibold text-slate-400">
                  <span>이름</span>
                  <span className="text-right">가로 m</span>
                  <span className="text-right">세로 m</span>
                  <span className="text-right">개수</span>
                  <span />
                </div>
                {zone.openings.map((o, i) => {
                  const patch = (p: Partial<typeof o>) =>
                    onChange({ openings: zone.openings.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <div key={o.id} className="grid grid-cols-[1fr_62px_62px_48px_24px] items-center gap-1.5">
                      <TextField value={o.label} onChange={(label) => patch({ label })} placeholder="창호" className="h-8 text-[12.5px]" />
                      <NumField value={o.w} min={0} step={0.1} onChange={(w) => patch({ w })} className="h-8 px-1.5" />
                      <NumField value={o.h} min={0} step={0.1} onChange={(h) => patch({ h })} className="h-8 px-1.5" />
                      <NumField value={o.count} min={0} onChange={(count) => patch({ count: Math.round(count) })} className="h-8 px-1.5" />
                      <button
                        type="button"
                        title="삭제"
                        onClick={() => onChange({ openings: zone.openings.filter((_, j) => j !== i) })}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                onChange({
                  openings: [
                    ...zone.openings,
                    { id: newId(), label: `창호 ${zone.openings.length + 1}`, w: 1.5, h: 1.18, count: 1 },
                  ],
                })
              }
              className="flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-[12px] font-semibold text-slate-500 hover:border-[#0a63b8] hover:bg-blue-50/50 hover:text-[#0a63b8]"
            >
              <Plus className="h-3.5 w-3.5" />
              개구부 추가
            </button>
            {zone.openings.length === 0 && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                창·문 자리는 버블시트로 막으므로 벽체보다 열이 많이 샙니다. 넣지 않으면 전부 콘크리트 벽으로 계산합니다.
              </p>
            )}
          </Section>
        )}

        {/* 손실열량 내역 */}
        {!loss.issue && !frame && (
          <Section title="손실열량 내역" badge={<span className="text-[10.5px] text-slate-400">kcal/h</span>}>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              {groups.map((grp) => (
                <div key={grp}>
                  <div className="bg-slate-50 px-3 py-1 text-[10.5px] font-bold tracking-wide text-slate-500">{grp}</div>
                  {loss.items
                    .filter((i) => i.group === grp)
                    .map((i) => (
                      <div key={i.key} className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-slate-700">{i.label}</div>
                          <div className="truncate text-[10.5px] tabular-nums text-slate-400" title={i.formula}>
                            {i.formula}
                          </div>
                        </div>
                        <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-slate-800">{int(i.value)}</span>
                      </div>
                    ))}
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-[12px] font-bold text-slate-600">
                  전열 {int(loss.conduction)} + 환기 {int(loss.ventilation)}
                  {loss.safetyPct > 0 && ` · ×${dec(1 + loss.safetyPct / 100, 2)}`}
                </span>
                <span className="text-[13.5px] font-extrabold tabular-nums text-[#0a4f99]">{int(loss.total)}</span>
              </div>
            </div>
          </Section>
        )}

        {/* 열원별 필요 대수 */}
        {/* 배치 근거 — 손실이 어디서 나는지에 따라 열원을 둔다 */}
        {!loss.issue && !frame && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-600">
            <b className="text-slate-700">열원 배치 근거</b> — 손실열량의{" "}
            <b className="tabular-nums text-[#0a4f99]">{Math.round(edgeLossShare(loss) * 100)}%</b>가 외벽 쪽(벽체·개구부·천막
            벽)에서, 나머지가 바닥·천장·환기로 바닥 전체에서 빠져나갑니다.{" "}
            {zone.kind === "parking"
              ? "지하주차장은 외기에 닿는 가장자리를 따라 같은 간격으로 놓습니다."
              : "이 비율만큼 열원을 외벽 쪽으로 당겨, 각 열원이 맡는 손실열량이 비슷해지게 놓습니다."}
          </div>
        )}

        {!loss.issue && !frame && (
          <Section title="열원별 필요 대수" badge={<span className="text-[10.5px] text-slate-400">구역 1개 기준</span>}>
            <div className="space-y-2">
              {heaters.map((h) => {
                const need = heaterNeed(loss, h, zone);
                const active = h.id === selectedHeaterId;
                return (
                  <div
                    key={h.id}
                    className={cn(
                      "rounded-xl border p-3",
                      active ? "border-[#0a63b8]/40 bg-blue-50/40" : "border-slate-200",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                        <span className="truncate text-[13px] font-bold text-slate-800">{h.name}</span>
                        {active && (
                          <span className="shrink-0 rounded bg-[#0a63b8] px-1.5 py-0.5 text-[9.5px] font-extrabold text-white">
                            적용
                          </span>
                        )}
                      </div>
                      <Verdict ok={need.ok} />
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-[11px] leading-relaxed tabular-nums text-slate-500">
                        대당 {int(need.output)} kcal/h
                        {h.electric && <span className="ml-1 text-slate-400">(전기식 · 환기 10%)</span>}
                        <br />
                        급열 {int(need.supply)} ·{" "}
                        <span className={need.ok ? "text-emerald-600" : "font-bold text-rose-600"}>
                          여유 {need.marginPct >= 0 ? "+" : ""}
                          {dec(need.marginPct, 1)}%
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {need.overridden && (
                          <button
                            type="button"
                            title={`산정 대수(${need.count}대)로 되돌리기`}
                            onClick={() => {
                              const next = { ...zone.applied };
                              delete next[h.id];
                              onChange({ applied: next });
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <div className="text-right">
                          <div className="mb-0.5 text-[10px] text-slate-400">
                            산정 {need.count}대{need.overridden && " → 적용"}
                          </div>
                          <NumField
                            value={need.applied}
                            unit="대"
                            min={0}
                            className={cn("h-8 w-[78px]", need.overridden && "border-amber-300 bg-amber-50/60")}
                            onChange={(v) => {
                              const n = Math.max(0, Math.round(v));
                              const next = { ...zone.applied };
                              if (n === need.count) delete next[h.id];
                              else next[h.id] = n;
                              onChange({ applied: next });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        <Field label="메모">
          <textarea
            value={zone.memo}
            onChange={(e) => onChange({ memo: e.target.value })}
            rows={2}
            placeholder="타설 예정일, 특이사항 등"
            className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-[12.5px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-[#0a63b8] focus:ring-2 focus:ring-[#0a63b8]/15"
          />
        </Field>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div>{label}</div>
      <div className="mt-0.5 text-[13px] font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[12.5px] font-extrabold tracking-tight text-slate-700">{title}</h4>
        {badge}
      </div>
      {children}
    </div>
  );
}
