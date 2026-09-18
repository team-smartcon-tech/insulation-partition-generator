/**
 * ② 호기 배정 — 동 한 줄에 그 동의 모든 것이 모인다.
 *
 * 처음에는 타워크레인 표와 호이스트 표를 좌우로 나눴는데, 같은 "동" 열이 두 번 나오고
 * 호기 수가 다른 두 표가 서로 다른 폭을 요구해 빈 공간만 생겼다. 지금은 표 하나에
 * `동 | 타워크레인 n칸 | 호이스트 m칸 | 호이스트 설정`을 붙여 한 줄로 읽는다.
 *
 * 한 동에 두 대(예: "2,3호기"), 한 대가 여러 동을 담당하는 경우가 모두 흔해서 N:M 이다.
 * 셀을 누르면 아래 담당 구간 막대가 곧바로 다시 그려진다.
 */
import { useMemo } from "react";
import { Plus, Minus, WandSparkles, TriangleAlert } from "lucide-react";
import type {
  Assignment,
  BuildingFrameProfile,
  EquipmentKind,
  EquipmentUnit,
  RentalParams,
  RentalSpan,
} from "../types";
import { addMonths, buildDecadeAxis, dayPercent, shortYmd } from "../engine/dates";
import { floorFinish, frameFinish, frameStart } from "../engine/profile";
import { unitColor } from "../theme";

/** 담당 구간 한 줄(동 하나)의 높이 */
const LANE_H = 13;

export default function UnitAssignment({
  buildings,
  units,
  assignments,
  spans,
  axisFrom,
  axisTo,
  params,
  onToggle,
  onAddUnit,
  onRemoveUnit,
  onAutoSuggest,
  onChangeHoist,
}: {
  buildings: BuildingFrameProfile[];
  units: EquipmentUnit[];
  assignments: Assignment[];
  spans: RentalSpan[];
  axisFrom: string;
  axisTo: string;
  params: RentalParams;
  onToggle: (unitId: string, buildingId: string) => void;
  onAddUnit: (kind: EquipmentKind) => void;
  onRemoveUnit: (unitId: string) => void;
  onAutoSuggest: (kind: EquipmentKind) => void;
  onChangeHoist: (
    buildingId: string,
    patch: { hoistAnchorFloor?: number | null; hoistPostFrameMonths?: number | null },
  ) => void;
}) {
  const assigned = useMemo(
    () => new Set(assignments.map((a) => `${a.unitId}|${a.buildingId}`)),
    [assignments],
  );
  const tcUnits = units.filter((u) => u.kind === "tc").sort((a, b) => a.no - b.no);
  const hcUnits = units.filter((u) => u.kind === "hc").sort((a, b) => a.no - b.no);

  const unassignedTc = buildings.filter(
    (b) => !tcUnits.some((u) => assigned.has(`${u.id}|${b.id}`)),
  );

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
          <span className="text-[15px] font-bold text-slate-800">호기 배정</span>
          <div className="flex flex-wrap items-center gap-4">
            <KindControls
              kind="tc"
              label="타워크레인"
              count={tcUnits.length}
              onAddUnit={onAddUnit}
              onAutoSuggest={onAutoSuggest}
            />
            <span className="h-4 w-px bg-slate-200" />
            <KindControls
              kind="hc"
              label="호이스트"
              count={hcUnits.length}
              onAddUnit={onAddUnit}
              onAutoSuggest={onAutoSuggest}
            />
          </div>
        </header>

        {buildings.length === 0 ? (
          <p className="px-4 py-12 text-center text-[14.5px] text-slate-400">
            먼저 ① 골조 정형표에서 동을 등록하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-left text-[13px] font-bold text-slate-500"
                  >
                    동
                  </th>
                  <GroupHead span={Math.max(1, tcUnits.length)} label="타워크레인" color="#0a63b8" />
                  <GroupHead span={Math.max(1, hcUnits.length)} label="호이스트" color="#d2456e" />
                  <th
                    colSpan={4}
                    className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold text-slate-500"
                  >
                    호이스트 설정
                    <span className="ml-1 font-normal text-slate-400">
                      설치 = 기준층 골조완료 후 · 해체 = 옥탑 골조완료 + N개월
                    </span>
                  </th>
                </tr>
                <tr className="border-b border-slate-200">
                  {tcUnits.length === 0 ? (
                    <th className="px-2 py-2 text-center text-[12.5px] text-slate-300">없음</th>
                  ) : (
                    tcUnits.map((u) => <UnitHead key={u.id} unit={u} onRemove={onRemoveUnit} />)
                  )}
                  {hcUnits.length === 0 ? (
                    <th className="border-l border-slate-200 px-2 py-2 text-center text-[12.5px] text-slate-300">
                      없음
                    </th>
                  ) : (
                    hcUnits.map((u, i) => (
                      <UnitHead key={u.id} unit={u} onRemove={onRemoveUnit} first={i === 0} />
                    ))
                  )}
                  <th className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    기준층
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    설치 착수
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    골조완료 +
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    해체 완료
                  </th>
                </tr>
              </thead>
              <tbody>
                {buildings.map((b, i) => {
                  const zebra = i % 2 === 1;
                  const anchor = b.hoistAnchorFloor ?? params.hc.anchorFloor;
                  const overAbove = anchor > b.aboveFloors;
                  const installFrom = floorFinish(b, anchor);
                  const fin = frameFinish(b);
                  const dismantleAt = fin
                    ? addMonths(fin, b.hoistPostFrameMonths ?? params.hc.postFrameMonths)
                    : null;
                  return (
                    <tr
                      key={b.id}
                      className={
                        "border-b border-slate-100 " + (zebra ? "bg-slate-50/50" : "bg-white")
                      }
                    >
                      <th
                        className={
                          "sticky left-0 z-10 border-r border-slate-200 px-3 py-1.5 text-left text-[13.5px] font-bold text-slate-700 " +
                          (zebra ? "bg-slate-50" : "bg-white")
                        }
                      >
                        {b.name}
                        <span className="ml-1.5 text-[12px] font-normal text-slate-400">
                          {b.belowFloors > 0 ? `B${b.belowFloors}/` : ""}
                          {b.aboveFloors}F
                        </span>
                      </th>

                      {tcUnits.length === 0 ? (
                        <td />
                      ) : (
                        tcUnits.map((u) => (
                          <ToggleCell
                            key={u.id}
                            on={assigned.has(`${u.id}|${b.id}`)}
                            unit={u}
                            buildingName={b.name}
                            onClick={() => onToggle(u.id, b.id)}
                          />
                        ))
                      )}
                      {hcUnits.length === 0 ? (
                        <td className="border-l border-slate-200" />
                      ) : (
                        hcUnits.map((u, k) => (
                          <ToggleCell
                            key={u.id}
                            on={assigned.has(`${u.id}|${b.id}`)}
                            unit={u}
                            buildingName={b.name}
                            first={k === 0}
                            onClick={() => onToggle(u.id, b.id)}
                          />
                        ))
                      )}

                      {/* 호이스트 동별 설정 — 동마다 층수·공법이 달라 전역 값 하나로는 못 맞춘다 */}
                      <td className="border-l border-slate-200 px-2 py-1.5 text-center">
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            type="number"
                            min={1}
                            max={b.aboveFloors}
                            value={b.hoistAnchorFloor ?? ""}
                            placeholder={String(params.hc.anchorFloor)}
                            title={`비우면 기본값 ${params.hc.anchorFloor}층`}
                            onChange={(e) =>
                              onChangeHoist(b.id, {
                                hoistAnchorFloor: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            className={
                              "h-8 w-[54px] rounded border px-1 text-center text-[13.5px] tabular-nums outline-none transition-colors focus:border-[#0a63b8] " +
                              (overAbove
                                ? "border-rose-300 text-rose-600"
                                : "border-slate-200 text-slate-700")
                            }
                          />
                          <span className="text-[12px] text-slate-400">F</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[13px] tabular-nums">
                        {overAbove ? (
                          <span className="text-rose-500">층수 초과</span>
                        ) : installFrom ? (
                          <span className="text-slate-600">{shortYmd(installFrom)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={b.hoistPostFrameMonths ?? ""}
                            placeholder={String(params.hc.postFrameMonths)}
                            title={`옥탑 골조완료 후 몇 달 더 쓰는지. 비우면 기본값 ${params.hc.postFrameMonths}개월`}
                            onChange={(e) =>
                              onChangeHoist(b.id, {
                                hoistPostFrameMonths: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            className="h-7 w-[46px] rounded border border-slate-200 px-1 text-center text-[13.5px] tabular-nums text-slate-700 outline-none transition-colors focus:border-[#0a63b8]"
                          />
                          <span className="text-[12px] text-slate-400">개월</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[13px] tabular-nums">
                        {dismantleAt ? (
                          <span className="text-slate-600">{shortYmd(dismantleAt)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tcUnits.length > 0 && unassignedTc.length > 0 && (
          <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-[13px] leading-relaxed text-amber-800">
              타워크레인이 배정되지 않은 동 {unassignedTc.length}개 —{" "}
              {unassignedTc.map((b) => b.name).join(", ")}
            </p>
          </div>
        )}
      </section>

      <CoverageStrip buildings={buildings} spans={spans} axisFrom={axisFrom} axisTo={axisTo} />
    </div>
  );
}

function KindControls({
  kind,
  label,
  count,
  onAddUnit,
  onAutoSuggest,
}: {
  kind: EquipmentKind;
  label: string;
  count: number;
  onAddUnit: (kind: EquipmentKind) => void;
  onAutoSuggest: (kind: EquipmentKind) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[13.5px] font-bold text-slate-600">{label}</span>
      <span className="rounded-full bg-slate-200/70 px-1.5 py-px text-[12px] font-bold text-slate-600">
        {count}대
      </span>
      <button
        type="button"
        onClick={() => onAutoSuggest(kind)}
        title={
          kind === "tc"
            ? "골조 구간이 겹치지 않는 동끼리 묶어 최소 대수를 제안합니다"
            : "동마다 1대씩 배정합니다"
        }
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-600 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
      >
        <WandSparkles className="h-3.5 w-3.5" />
        자동
      </button>
      <button
        type="button"
        onClick={() => onAddUnit(kind)}
        className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#0a63b8] px-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#08508f]"
      >
        <Plus className="h-3.5 w-3.5" />
        추가
      </button>
    </div>
  );
}

function GroupHead({ span, label, color }: { span: number; label: string; color: string }) {
  return (
    <th
      colSpan={span}
      className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold text-slate-500"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-[3px] rounded-full" style={{ background: color }} />
        {label}
      </span>
    </th>
  );
}

function UnitHead({
  unit,
  onRemove,
  first,
}: {
  unit: EquipmentUnit;
  onRemove: (unitId: string) => void;
  first?: boolean;
}) {
  return (
    <th className={"px-1 py-1.5 text-center " + (first ? "border-l border-slate-200" : "")}>
      <div className="flex flex-col items-center gap-0.5">
        <span
          className="inline-flex h-[24px] min-w-[46px] items-center justify-center whitespace-nowrap rounded px-2 text-[12px] font-bold text-white"
          style={{ background: unitColor(unit.no, unit.kind) }}
        >
          {unit.no}호기
        </span>
        <button
          type="button"
          onClick={() => onRemove(unit.id)}
          title={`${unit.kind === "tc" ? "T/C" : "H/C"} ${unit.no}호기 삭제`}
          className="flex h-3.5 w-3.5 items-center justify-center rounded text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
      </div>
    </th>
  );
}

function ToggleCell({
  on,
  unit,
  buildingName,
  first,
  onClick,
}: {
  on: boolean;
  unit: EquipmentUnit;
  buildingName: string;
  first?: boolean;
  onClick: () => void;
}) {
  return (
    <td className={"px-1 py-1.5 text-center " + (first ? "border-l border-slate-200" : "")}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        aria-label={`${buildingName} ${unit.kind === "tc" ? "타워크레인" : "호이스트"} ${unit.no}호기 배정`}
        className={
          "h-7 w-11 rounded-[5px] border text-[13.5px] font-bold transition-all " +
          (on
            ? "border-transparent text-white shadow-sm"
            : "border-slate-200 bg-white text-transparent hover:border-slate-300 hover:bg-slate-50")
        }
        style={on ? { background: unitColor(unit.no, unit.kind) } : undefined}
      >
        {on ? "✓" : "·"}
      </button>
    </td>
  );
}

/** 호기별 커버 구간 — 배정을 바꾼 결과가 바로 보이는 미니 간트 */
function CoverageStrip({
  buildings,
  spans,
  axisFrom,
  axisTo,
}: {
  buildings: BuildingFrameProfile[];
  spans: RentalSpan[];
  axisFrom: string;
  axisTo: string;
}) {
  const axis = useMemo(() => buildDecadeAxis(axisFrom, axisTo), [axisFrom, axisTo]);
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const pct = (ymd: string) => dayPercent(axis, ymd);

  const rows = spans.filter((s) => !s.problem);
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center text-[14.5px] text-slate-400 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        호기를 배정하면 담당 구간이 여기에 표시됩니다.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <header className="border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <span className="text-[15px] font-bold text-slate-800">호기별 담당 구간</span>
        <span className="ml-2 text-[13px] text-slate-400">
          동별 골조 구간을 이어 붙인 모습 — 사이가 비면 유휴입니다
        </span>
      </header>
      <div className="space-y-2 px-4 py-3.5">
        {rows.map((s) => (
          <div key={s.unitId} className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex h-[23px] w-[58px] shrink-0 items-center justify-center rounded text-[12px] font-bold text-white"
              style={{ background: unitColor(s.no, s.kind) }}
            >
              {s.kind === "tc" ? "T/C" : "H/C"} {s.no}
            </span>
            {/*
              담당 동이 서로 겹치면 한 줄에 그렸을 때 뒤 막대가 앞 막대를 가려
              "2개 동인데 하나만 보이는" 착시가 난다. 동마다 제 줄을 준다.
            */}
            <div
              className="relative flex-1 overflow-hidden rounded bg-slate-100"
              style={{ height: Math.max(18, s.buildingIds.length * LANE_H + 4) }}
            >
              {s.buildingIds.map((id, laneIdx) => {
                const b = byId.get(id);
                if (!b) return null;
                const st = frameStart(b);
                const fi = frameFinish(b);
                if (!st || !fi) return null;
                const left = pct(st);
                const w = Math.max(1.2, pct(fi) - left);
                return (
                  <div
                    key={id}
                    title={`${b.name} · ${shortYmd(st)} ~ ${shortYmd(fi)}`}
                    className="absolute flex items-center justify-center overflow-hidden rounded-[3px] text-[10.5px] font-bold text-white/95"
                    style={{
                      left: `${left}%`,
                      width: `${w}%`,
                      top: laneIdx * LANE_H + 2,
                      height: LANE_H - 2,
                      background: unitColor(s.no, s.kind),
                    }}
                  >
                    <span className="truncate px-1">{b.name}</span>
                  </div>
                );
              })}
              {s.idleGaps.map((g) => (
                <div
                  key={g.from}
                  title={`유휴 ${g.days}일 · ${shortYmd(g.from)} ~ ${shortYmd(g.to)}`}
                  className="absolute inset-y-0 border-x border-dashed border-rose-400 bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.22)_0_4px,transparent_4px_8px)]"
                  style={{
                    left: `${pct(g.from)}%`,
                    width: `${Math.max(0.8, pct(g.to) - pct(g.from))}%`,
                  }}
                />
              ))}
            </div>
            <span className="mt-1 w-[86px] shrink-0 text-right text-[12.5px] tabular-nums text-slate-500">
              {s.rentalMonths}개월
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
