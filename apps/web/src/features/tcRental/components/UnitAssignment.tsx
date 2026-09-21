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
import { useMemo, useState } from "react";
import { Plus, Minus, WandSparkles, TriangleAlert, X } from "lucide-react";
import type {
  Assignment,
  BuildingFrameProfile,
  EquipmentKind,
  HeightBand,
  EquipmentUnit,
  RentalParams,
  RentalSpan,
} from "../types";
import { addMonths, buildDecadeAxis, dayPercent, shortYmd } from "../engine/dates";
import {
  floorFinish,
  frameFinish,
  frameStart,
  resolveBands,
  resolveHoistHeight,
  resolveOperation,
} from "../engine/profile";
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
    patch: {
      hoistAnchorFloor?: number | null;
      hoistPostFrameMonths?: number | null;
      hoistBaseHeight?: number | null;
      hoistHeightBands?: HeightBand[] | null;
      hoistOperation?: string | null;
    },
  ) => void;
}) {
  const assigned = useMemo(
    () => new Set(assignments.map((a) => `${a.unitId}|${a.buildingId}`)),
    [assignments],
  );
  /** 층고 구간을 고치는 중인 동 */
  const [bandEdit, setBandEdit] = useState<string | null>(null);
  const editing = buildings.find((b) => b.id === bandEdit) ?? null;

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
                  <th
                    colSpan={4}
                    className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold text-slate-500"
                  >
                    규격 · 층고 (m)
                    <span className="ml-1 font-normal text-slate-400">
                      규격은 층수로 자동(20층 이하 저속싱글) · 층수·연장은 동에서 자동
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
                  <th className="border-l border-slate-200 px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    운용 형태
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    지층
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    지상 층고 구간
                  </th>
                  <th className="px-2 py-1.5 text-center text-[12px] font-bold text-slate-500">
                    설치높이
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
                  const height = resolveHoistHeight(b, params);
                  const operation = resolveOperation(b, params);
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

                      {/* 운용 형태 — 입찰기준(안): 20층 이하 저속싱글 / 21층 이상 중속싱글 */}
                      <td className="border-l border-slate-200 px-2 py-1.5 text-center">
                        <select
                          value={b.hoistOperation ?? ""}
                          title={`비우면 층수로 자동 판정합니다 (${params.hc.lowSpeedMaxFloors}층 이하 저속싱글)`}
                          onChange={(e) =>
                            onChangeHoist(b.id, { hoistOperation: e.target.value || null })
                          }
                          className={
                            "h-7 w-[86px] rounded border px-1 text-center text-[12.5px] outline-none transition-colors focus:border-[#0a63b8] " +
                            (b.hoistOperation
                              ? "border-[#0a63b8]/40 bg-[#eef5fd] font-semibold text-[#0a63b8]"
                              : "border-slate-200 text-slate-600")
                          }
                        >
                          <option value="">{operation} (자동)</option>
                          <option value="저속싱글">저속싱글</option>
                          <option value="중속싱글">중속싱글</option>
                        </select>
                      </td>

                      {/* 층고 — 동마다 기초 레벨도 층고가 나뉘는 자리도 다르다 */}
                      <HeightCell
                        value={b.hoistBaseHeight ?? null}
                        placeholder="실측"
                        warn={height.baseMissing}
                        title="지층 높이(기초 레벨~1층 바닥). 동마다 달라 기본값이 없습니다 — 비우면 설치높이가 그만큼 짧게 나옵니다."
                        onChange={(v) => onChangeHoist(b.id, { hoistBaseHeight: v })}
                      />
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => setBandEdit(b.id)}
                          title="구간을 눌러 층고가 나뉘는 자리를 고칩니다"
                          className={
                            "inline-flex max-w-[260px] flex-wrap items-center justify-center gap-1 rounded border px-1.5 py-1 transition-colors " +
                            (b.hoistHeightBands && b.hoistHeightBands.length > 0
                              ? "border-[#0a63b8]/30 bg-[#eef5fd] hover:border-[#0a63b8]"
                              : "border-slate-200 bg-white hover:border-[#0a63b8]")
                          }
                        >
                          {height.bands.map((x) => (
                            <span
                              key={x.from}
                              className="whitespace-nowrap rounded bg-white/80 px-1 text-[12px] tabular-nums text-slate-600"
                            >
                              <b className="font-semibold text-slate-700">{x.label}</b> {x.height}
                            </span>
                          ))}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={
                            "inline-flex h-7 min-w-[58px] items-center justify-center rounded px-2 text-[13px] font-bold tabular-nums " +
                            (height.baseMissing
                              ? "bg-amber-50 text-amber-700"
                              : "bg-[#eef5fd] text-[#0a63b8]")
                          }
                          title={
                            `${height.describe} = ${height.total}m → 올림 ${height.installHeight}m` +
                            (height.baseMissing ? " · 지층이 비어 있어 그만큼 짧습니다" : "")
                          }
                        >
                          {height.installHeight}m
                        </span>
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

      {editing && (
        <BandEditor
          building={editing}
          params={params}
          onClose={() => setBandEdit(null)}
          onChange={(bands) => onChangeHoist(editing.id, { hoistHeightBands: bands })}
        />
      )}
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

/**
 * 층고 입력 한 칸.
 *
 * 비우면 기본값을 쓴다는 뜻이라 `0` 과 빈칸을 구분해야 한다 — placeholder 에 기본값을
 * 띄워 두고, 지운 값은 `null` 로 올려 보낸다(그래야 기본값으로 되돌아간다).
 */
function HeightCell({
  value,
  placeholder,
  title,
  warn,
  first,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  title: string;
  warn?: boolean;
  first?: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <td className={"px-2 py-1.5 text-center" + (first ? " border-l border-slate-200" : "")}>
      <input
        type="number"
        min={0}
        step={0.01}
        value={value ?? ""}
        placeholder={placeholder}
        title={title}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={
          "h-7 w-[58px] rounded border px-1 text-center text-[13px] tabular-nums outline-none transition-colors focus:border-[#0a63b8] " +
          (warn
            ? "border-amber-300 bg-amber-50/60 text-amber-700 placeholder:text-amber-500"
            : "border-slate-200 text-slate-700")
        }
      />
    </td>
  );
}

/**
 * 층고 구간 편집 — 층고가 나뉘는 자리를 동마다 정한다.
 *
 * "1층 / 기준층 / 최상층" 세 칸으로 고정하면 `1~3F 가 같은 층고` 인 현장을 못 적는다.
 * 그래서 **구간을 몇 개든 둘 수 있게** 하고, 각 구간은 `~N층까지 · 층고 Xm` 으로만 적는다.
 * 마지막 구간은 항상 최상층까지라 끝 층을 받지 않는다 — 층수는 동에서 나온다.
 */
function BandEditor({
  building,
  params,
  onClose,
  onChange,
}: {
  building: BuildingFrameProfile;
  params: RentalParams;
  onClose: () => void;
  onChange: (bands: HeightBand[] | null) => void;
}) {
  const resolved = resolveBands(building, params);
  /** 저장된 값이 없으면 기본형을 펼쳐 보여 주고, 고치는 순간 그 모양이 저장된다 */
  const bands: HeightBand[] =
    building.hoistHeightBands && building.hoistHeightBands.length > 0
      ? building.hoistHeightBands
      : resolved.map((x, i) => ({
          upTo: i === resolved.length - 1 ? null : x.to,
          height: x.height,
        }));

  const height = resolveHoistHeight(building, params);
  const patch = (next: HeightBand[]) => {
    // 마지막은 언제나 최상층까지다 — 끝 층을 들고 있으면 층수가 바뀔 때 어긋난다
    onChange(next.map((x, i) => (i === next.length - 1 ? { ...x, upTo: null } : x)));
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_70px_-30px_rgba(8,22,52,0.5)]">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h3 className="text-[14.5px] font-bold text-slate-800">{building.name} 층고 구간</h3>
            <p className="mt-0.5 text-[12.5px] text-slate-400">
              지상 {building.aboveFloors}층 · 층수는 동에서 자동으로 나옵니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </header>

        <div className="space-y-2 px-5 py-4">
          {bands.map((band, i) => {
            const r = resolved[i];
            const last = i === bands.length - 1;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-[72px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-600">
                  {r ? r.label : "—"}
                </span>
                {last ? (
                  <span className="h-8 w-[70px] text-center text-[13px] leading-8 text-slate-400">
                    최상층
                  </span>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={building.aboveFloors}
                    value={band.upTo ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      patch(bands.map((x, k) => (k === i ? { ...x, upTo: v } : x)));
                    }}
                    className="h-8 w-[70px] rounded-lg border border-slate-200 px-2 text-center text-[13.5px] tabular-nums text-slate-700 outline-none focus:border-[#0a63b8]"
                  />
                )}
                <span className="text-[12.5px] text-slate-400">층까지</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={band.height}
                  onChange={(e) =>
                    patch(
                      bands.map((x, k) =>
                        k === i ? { ...x, height: Number(e.target.value) || 0 } : x,
                      ),
                    )
                  }
                  className="h-8 w-[76px] rounded-lg border border-slate-200 px-2 text-right text-[13.5px] tabular-nums text-slate-700 outline-none focus:border-[#0a63b8]"
                />
                <span className="text-[12.5px] text-slate-400">m</span>
                <button
                  type="button"
                  disabled={bands.length <= 1}
                  onClick={() => patch(bands.filter((_, k) => k !== i))}
                  title="구간 삭제"
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              const prevTo = resolved[Math.max(0, resolved.length - 2)]?.to ?? 1;
              const tail = bands[bands.length - 1];
              patch([
                ...bands.slice(0, -1),
                {
                  upTo: Math.min(Math.max(1, building.aboveFloors - 1), prevTo + 1),
                  height: tail.height,
                },
                tail,
              ]);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 text-[13px] font-semibold text-slate-500 transition-colors hover:border-[#0a63b8] hover:text-[#0a63b8]"
          >
            <Plus className="h-3.5 w-3.5" />
            구간 추가
          </button>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-slate-400" title={height.describe}>
              {height.describe}
            </div>
            <div className="mt-0.5 text-[13px] text-slate-600">
              합계 <b className="text-slate-800">{height.total}m</b> → 설치높이{" "}
              <b className="text-[#0a63b8]">{height.installHeight}m</b>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            title={`1층 ${params.hc.floorHeight.first} · 기준층 ${params.hc.floorHeight.typical} · 최상층 ${params.hc.floorHeight.top}`}
            className="shrink-0 text-[12.5px] font-semibold text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
          >
            기본값으로
          </button>
        </footer>
      </div>
    </>
  );
}
