/**
 * ① 골조 정형표 — 현장에서 쓰던 예정공정표를 그대로 화면으로 옮긴 표.
 *
 * 가로축은 순(旬) 단위(한 달 = 10일/20일/30일 세 칸)이고, 막대는 칸에 딱 맞추지 않고
 * 실제 날짜 비율로 그린다. 왼쪽 정보 블록과 오른쪽 보양 블록은 sticky 로 고정해
 * 공정표를 길게 스크롤해도 어느 동인지 놓치지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingFrameProfile, FloorSegment, RentalParams } from "../types";
import {
  addDays,
  axisDayCount,
  buildDecadeAxis,
  cellDayCount,
  dayOffset,
  diffDays,
  isWinterDecade,
  shortYmd,
  type DecadeCell,
} from "../engine/dates";
import { frameFinish, frameStart, frameTotalDays, resolveWinterCuring } from "../engine/profile";
import { ESTIMATED_PATTERN, segmentStyle, unitColor } from "../theme";
import { Maximize2, Minus as MinusIcon, Plus as PlusIcon } from "lucide-react";

/**
 * 하루당 픽셀(기본 배율). 순 칸을 전부 같은 폭으로 그리면 하순(11일)이 상·중순(10일)과
 * 같은 폭이 되어 **같은 기간이 위치에 따라 다른 길이로 보인다.**
 * 좌표를 일 단위로 잡아 이 왜곡을 없앤다.
 */
const BASE_DAY_W = 2.6;
/** 화면 맞춤에서 허용할 하루 폭 범위 — 너무 좁으면 층 라벨이 전부 사라진다 */
const MIN_DAY_W = 1.1;
const MAX_DAY_W = 10;
const ROW_H = 40;
const LEFT_COLS = [
  { key: "name", label: "동", w: 88 },
  { key: "below", label: "지하층", w: 64 },
  { key: "above", label: "지상층", w: 64 },
  { key: "unit", label: "타워", w: 104 },
  { key: "range", label: "기간", w: 262 },
  { key: "days", label: "소요일수", w: 76 },
] as const;
const LEFT_W = LEFT_COLS.reduce((a, c) => a + c.w, 0);
const RIGHT_COLS = [
  { key: "basement", label: "지하층" },
  { key: "typical", label: "기준층" },
  { key: "rooftop", label: "옥탑" },
] as const;
const RIGHT_COL_W = 54;
const RIGHT_W = RIGHT_COL_W * RIGHT_COLS.length;

export interface DismantleMarker {
  buildingId: string;
  date: string;
  label: string;
  unitNo: number;
}

/** 연속한 동절기 칸들을 하나의 박스로 묶는다 */
function winterRuns(axis: DecadeCell[], params: RentalParams, dayW: number) {
  const runs: Array<{ fromPx: number; widthPx: number }> = [];
  let openIdx: number | null = null;
  const close = (endIdx: number) => {
    if (openIdx === null) return;
    const fromPx = dayOffset(axis, axis[openIdx].start) * dayW;
    const toPx = (dayOffset(axis, axis[endIdx].end) + 1) * dayW;
    runs.push({ fromPx, widthPx: toPx - fromPx });
    openIdx = null;
  };
  axis.forEach((cell, i) => {
    const w = isWinterDecade(cell, params.winter.from, params.winter.to);
    if (w && openIdx === null) openIdx = i;
    if (!w) close(i - 1);
  });
  close(axis.length - 1);
  return runs;
}


/** 화면에 그릴 막대 — 원본 세그먼트이거나, 기준층 여러 개를 묶은 하나 */
interface DisplaySegment {
  key: string;
  floor: number;
  label: string;
  start: string;
  finish: string;
  source: FloorSegment["source"];
  /** 묶인 층 수 (0 = 안 묶음) */
  mergedCount: number;
  /** 묶인 경우 내부 층 경계 날짜 — 눈금으로 그려 층 수를 잃지 않는다 */
  innerBoundaries: string[];
}

/**
 * 기준층(4층 ~ 최상층 직전)이 연속되면 하나의 띠로 묶는다.
 *
 * 25층짜리 동을 층마다 칸으로 그리면 한 칸이 10px 남짓이라 라벨이 다 사라진다.
 * 실무에서 기준층은 "몇 층부터 몇 층까지 며칠 사이클"로 읽지 층마다 따로 읽지 않는다.
 * 대신 층 경계를 눈금으로 남겨 몇 개 층인지는 그대로 보이게 한다.
 */
function buildDisplaySegments(
  b: BuildingFrameProfile,
  grouped: boolean,
): DisplaySegment[] {
  const plain = (s: FloorSegment): DisplaySegment => ({
    key: s.key,
    floor: s.floor,
    label: s.label,
    start: s.start as string,
    finish: s.finish as string,
    source: s.source,
    mergedCount: 0,
    innerBoundaries: [],
  });

  const dated = b.segments.filter((s) => s.start && s.finish);
  if (!grouped) return dated.map(plain);

  const isTypical = (s: FloorSegment) => s.floor >= 4 && s.floor < b.aboveFloors;
  const out: DisplaySegment[] = [];
  let run: FloorSegment[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < 3) {
      // 두 층까지는 묶어도 이득이 없다
      run.forEach((r) => out.push(plain(r)));
      run = [];
      return;
    }
    const first = run[0];
    const last = run[run.length - 1];
    out.push({
      key: `TYP-${first.key}`,
      floor: first.floor,
      label: `${first.floor}F~${last.floor}F`,
      start: first.start as string,
      finish: last.finish as string,
      source: run.some((r) => r.source === "estimated") ? "estimated" : first.source,
      mergedCount: run.length,
      innerBoundaries: run.slice(0, -1).map((r) => r.finish as string),
    });
    run = [];
  };

  for (const s of dated) {
    if (isTypical(s)) {
      run.push(s);
      continue;
    }
    flush();
    out.push(plain(s));
  }
  flush();
  return out;
}

export default function FrameMatrix({
  buildings,
  params,
  axisFrom,
  axisTo,
  unitLabels,
  markers,
  onChangeRange,
  onChangeBuilding,
  onRemoveBuilding,
  onShiftBuilding,
  onResizeSegment,
  onScaleBuilding,
}: {
  buildings: BuildingFrameProfile[];
  params: RentalParams;
  axisFrom: string;
  axisTo: string;
  /** 동 id → "1호기" / "2,3호기" */
  unitLabels: Map<string, { text: string; nos: number[] }>;
  markers: DismantleMarker[];
  onChangeRange: (buildingId: string, start: string | null, finish: string | null) => void;
  onChangeBuilding: (
    buildingId: string,
    patch: Partial<Pick<BuildingFrameProfile, "name" | "belowFloors" | "aboveFloors">>,
  ) => void;
  onRemoveBuilding: (buildingId: string) => void;
  /** 동 전체를 days 만큼 앞뒤로 민다 (막대 몸통을 끌었을 때) */
  onShiftBuilding: (buildingId: string, days: number) => void;
  /** 한 층의 기간만 days 만큼 늘리거나 줄이고, 그 뒤 층들을 같이 민다 */
  onResizeSegment: (buildingId: string, segmentKey: string, days: number) => void;
  /** 전체 기간을 days 만큼 늘리거나 줄인다 (층별 비율 유지) */
  onScaleBuilding: (buildingId: string, days: number) => void;
}) {
  const axis = useMemo(() => buildDecadeAxis(axisFrom, axisTo), [axisFrom, axisTo]);
  const totalDays = useMemo(() => axisDayCount(axis), [axis]);

  /**
   * 가로 배율. 세로는 남는데 가로로만 스크롤하는 게 답답해서 기본을 **화면 맞춤**으로 둔다.
   * (zoom === null 이 화면 맞춤, 숫자면 기본 배율의 배수)
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  /** 기준층을 한 띠로 묶어 보기 (층이 많은 현장에서 기본값) */
  const [groupTypical, setGroupTypical] = useState(true);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setAvailW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitDayW = availW > 0 ? (availW - LEFT_W - RIGHT_W) / totalDays : BASE_DAY_W;
  const dayW =
    zoom === null
      ? Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, fitDayW))
      : Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, BASE_DAY_W * zoom));

  const timelineW = totalDays * dayW;
  const totalW = LEFT_W + timelineW + RIGHT_W;
  /** 칸 폭 — 그 칸이 가진 일수에 비례한다 */
  const cellW = (cell: DecadeCell) => cellDayCount(cell) * dayW;
  /** 칸 시작의 좌측 오프셋(px) */
  const cellLeft = (cell: DecadeCell) => dayOffset(axis, cell.start) * dayW;
  const runs = useMemo(() => winterRuns(axis, params, dayW), [axis, params, dayW]);

  // 연 / 월 헤더 묶음
  const yearGroups = useMemo(() => {
    const out: Array<{ year: number; days: number }> = [];
    for (const c of axis) {
      const last = out[out.length - 1];
      if (last && last.year === c.year) last.days += cellDayCount(c);
      else out.push({ year: c.year, days: cellDayCount(c) });
    }
    return out;
  }, [axis]);

  const monthGroups = useMemo(() => {
    const out: Array<{ year: number; month: number; days: number }> = [];
    for (const c of axis) {
      const last = out[out.length - 1];
      if (last && last.year === c.year && last.month === c.month) last.days += cellDayCount(c);
      else out.push({ year: c.year, month: c.month, days: cellDayCount(c) });
    }
    return out;
  }, [axis]);

  const pos = (ymd: string) => dayOffset(axis, ymd) * dayW;

  /**
   * 막대 끌어서 조정.
   *  - 막대 몸통을 끌면 그 동의 전체 일정이 통째로 이동한다.
   *  - 첫 막대(기초) 왼쪽 손잡이는 착수일, 마지막 막대(옥탑) 오른쪽 손잡이는 완료일을 바꾼다.
   *    둘 다 기존 [기간] 입력칸과 같은 경로(onChangeRange)로 들어가므로 사이 층은 다시 보간된다.
   *
   * 픽셀 → 일수 환산은 축 전체를 기준으로 한다(순 칸은 10일/11일이 섞여 칸당 환산이 일정하지 않다).
   */
  const pxPerDay = dayW;

  const dragRef = useRef<{
    buildingId: string;
    mode: "move" | "start" | "scale" | "resize";
    /** mode === "resize" 일 때 대상 층 */
    segmentKey?: string;
    startX: number;
    dx: number;
  } | null>(null);
  // 드래그 중 화면을 다시 그리기 위한 신호(값 자체는 쓰지 않는다)
  const [, bumpDrag] = useState(0);

  const beginDrag = useCallback(
    (
      e: React.PointerEvent,
      building: BuildingFrameProfile,
      mode: "move" | "start" | "scale" | "resize",
      segmentKey?: string,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { buildingId: building.id, mode, segmentKey, startX: e.clientX, dx: 0 };
      bumpDrag((t) => t + 1);

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        dragRef.current.dx = ev.clientX - dragRef.current.startX;
        bumpDrag((t) => t + 1);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const d = dragRef.current;
        dragRef.current = null;
        bumpDrag((t) => t + 1);
        if (!d) return;
        const days = Math.round(d.dx / pxPerDay);
        if (days === 0) return;
        const st = frameStart(building);
        const fi = frameFinish(building);
        const total = st && fi ? diffDays(st, fi) : 0;
        if (d.mode === "move") {
          onShiftBuilding(building.id, days);
        } else if (d.mode === "start") {
          // 착수일 손잡이 = 동 전체 이동. (재보간하지 않는다 — 손으로 맞춘 층이 지워진다)
          onShiftBuilding(building.id, days);
        } else if (d.mode === "scale") {
          // 완료일 손잡이 = 전체 기간 신축. 최소 30일은 남긴다
          if (total + days >= 30) onScaleBuilding(building.id, days);
        } else if (d.mode === "resize" && d.segmentKey) {
          onResizeSegment(building.id, d.segmentKey, days);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [pxPerDay, onShiftBuilding, onScaleBuilding, onResizeSegment],
  );

  const drag = dragRef.current;
  /**
   * 드래그 중 막대에 줄 오프셋(커밋 전 미리보기).
   *  - move/start : 전부 같이 민다
   *  - scale      : 뒤로 갈수록 더 많이 민다(비율 신축을 눈으로 보여준다)
   *  - resize     : 대상 층은 늘어나고, 그 뒤 층들은 통째로 밀린다
   */
  const previewDx = (
    buildingId: string,
    segIdx: number,
    segCount: number,
    segKey: string,
    resizeIdx: number,
  ) => {
    if (!drag || drag.buildingId !== buildingId) return { shift: 0, grow: 0 };
    if (drag.mode === "move" || drag.mode === "start") return { shift: drag.dx, grow: 0 };
    if (drag.mode === "scale") {
      const ratio = segCount > 1 ? segIdx / (segCount - 1) : 1;
      const nextRatio = segCount > 1 ? (segIdx + 1) / (segCount - 1) : 1;
      return { shift: drag.dx * ratio, grow: drag.dx * (nextRatio - ratio) };
    }
    if (drag.mode === "resize" && resizeIdx >= 0) {
      if (segKey === drag.segmentKey) return { shift: 0, grow: drag.dx };
      if (segIdx > resizeIdx) return { shift: drag.dx, grow: 0 };
    }
    return { shift: 0, grow: 0 };
  };

  if (axis.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-400">
        표시할 일정이 없습니다.
      </div>
    );
  }

  const zoomPct = Math.round((dayW / BASE_DAY_W) * 100);

  return (
    <div
      ref={wrapRef}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]"
    >
      <div className="flex items-center justify-end gap-1.5 border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setGroupTypical((v) => !v)}
          title={
            groupTypical
              ? "기준층을 층마다 따로 보기 (층별 기간 조정이 가능해집니다)"
              : "기준층을 한 구간으로 묶어 보기"
          }
          className={
            "mr-auto inline-flex h-6 items-center gap-1 rounded border px-2 text-[12.5px] font-semibold transition-colors " +
            (groupTypical
              ? "border-[#0a63b8] bg-[#eef5fd] text-[#0a63b8]"
              : "border-slate-200 bg-white text-slate-500 hover:border-[#0a63b8]/40 hover:text-[#0a63b8]")
          }
        >
          {groupTypical ? "기준층 묶음" : "전체 층"}
        </button>
        <span className="mr-1 text-[12px] text-slate-400">가로 배율</span>
        <button
          type="button"
          onClick={() => setZoom(Math.max(0.3, (zoom ?? dayW / BASE_DAY_W) - 0.15))}
          title="축소"
          className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
        >
          <MinusIcon className="h-3 w-3" />
        </button>
        <span className="w-[42px] text-center text-[12.5px] font-semibold tabular-nums text-slate-600">
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => setZoom(Math.min(4, (zoom ?? dayW / BASE_DAY_W) + 0.15))}
          title="확대"
          className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(null)}
          title="가로 스크롤 없이 화면 폭에 맞춘다"
          className={
            "ml-1 inline-flex h-6 items-center gap-1 rounded border px-2 text-[12.5px] font-semibold transition-colors " +
            (zoom === null
              ? "border-[#0a63b8] bg-[#eef5fd] text-[#0a63b8]"
              : "border-slate-200 bg-white text-slate-500 hover:border-[#0a63b8]/40 hover:text-[#0a63b8]")
          }
        >
          <Maximize2 className="h-3 w-3" />
          화면 맞춤
        </button>
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: totalW }} className="relative">
          {/* ── 헤더 ── */}
          <div className="sticky top-0 z-30">
            {/* 연도 */}
            <div className="flex border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
              <div
                className="sticky left-0 z-10 flex items-center justify-center border-r border-slate-200 bg-slate-100 text-[12px] font-bold text-slate-600"
                style={{ width: LEFT_W, height: 26 }}
              >
                구분
              </div>
              {yearGroups.map((g) => (
                <div
                  key={g.year}
                  className="flex items-center justify-center border-r border-slate-200 text-[13px] font-bold tracking-tight text-slate-700"
                  style={{ width: g.days * dayW, height: 26 }}
                >
                  {g.year}년
                </div>
              ))}
              <div
                className="sticky right-0 z-10 flex items-center justify-center border-l border-slate-200 bg-slate-100 text-[12.5px] font-bold text-slate-600"
                style={{ width: RIGHT_W, height: 26 }}
              >
                동절기 보양
              </div>
            </div>

            {/* 월 */}
            <div className="flex border-b border-slate-200 bg-white">
              <div
                className="sticky left-0 z-10 flex border-r border-slate-200 bg-slate-100"
                style={{ width: LEFT_W, height: 24 }}
              />
              {monthGroups.map((g) => (
                <div
                  key={`${g.year}-${g.month}`}
                  className={
                    "flex items-center justify-center border-r text-[12.5px] font-semibold " +
                    (g.month === 12 || g.month <= 2
                      ? "border-slate-200 bg-[#fff4f4] text-[#b4453f]"
                      : "border-slate-200 text-slate-500")
                  }
                  style={{ width: g.days * dayW, height: 24 }}
                >
                  {g.days * dayW >= 40 ? `${g.month}월` : g.month}
                </div>
              ))}
              <div
                className="sticky right-0 z-10 border-l border-slate-200 bg-slate-100"
                style={{ width: RIGHT_W, height: 24 }}
              />
            </div>

            {/* 순 + 좌/우 컬럼 제목 */}
            <div className="flex border-b border-slate-300 bg-white">
              <div
                className="sticky left-0 z-10 flex border-r border-slate-300 bg-slate-100"
                style={{ width: LEFT_W, height: 26 }}
              >
                {LEFT_COLS.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center justify-center border-r border-slate-200 text-[12.5px] font-bold text-slate-600 last:border-r-0"
                    style={{ width: c.w }}
                  >
                    {c.label}
                  </div>
                ))}
              </div>
              {axis.map((c) => (
                <div
                  key={c.index}
                  className={
                    "flex items-center justify-center border-r text-[10.5px] tabular-nums " +
                    (c.part === 2
                      ? "border-slate-300 text-slate-400"
                      : "border-slate-100 text-slate-400")
                  }
                  style={{ width: cellW(c), height: 26 }}
                >
                  {cellW(c) >= 18 ? (c.part === 0 ? "10" : c.part === 1 ? "20" : "30") : ""}
                </div>
              ))}
              <div
                className="sticky right-0 z-10 flex border-l border-slate-300 bg-slate-100"
                style={{ width: RIGHT_W, height: 26 }}
              >
                {RIGHT_COLS.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center justify-center border-r border-slate-200 text-[12px] font-bold text-slate-600 last:border-r-0"
                    style={{ width: RIGHT_COL_W }}
                  >
                    {c.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 본문 ── */}
          <div className="relative">
            {/* 동절기 구간 — 본문 전체를 가로지르는 점선 박스 */}
            <div className="pointer-events-none absolute inset-0 z-0">
              {runs.map((r) => (
                <div
                  key={`w-${r.fromPx}`}
                  className="absolute top-0 bottom-0 border-x-2 border-dashed border-[#e0453e]/70 bg-[#e8433c]/[0.045]"
                  style={{ left: LEFT_W + r.fromPx, width: r.widthPx }}
                />
              ))}
            </div>

            {buildings.map((b, rowIdx) => {
              const start = frameStart(b);
              const finish = frameFinish(b);
              const wc = resolveWinterCuring(b, params);
              const unit = unitLabels.get(b.id);
              const rowMarkers = markers.filter((m) => m.buildingId === b.id);
              return (
                <div
                  key={b.id}
                  className={
                    "group/row relative flex border-b border-slate-100 transition-colors hover:bg-[#f2f8ff]/70 " +
                    (rowIdx % 2 === 1 ? "bg-slate-50/50" : "bg-white/50")
                  }
                  style={{ height: ROW_H }}
                >
                  {/* 좌측 고정 정보 */}
                  <div
                    className="sticky left-0 z-20 flex border-r border-slate-200 bg-white shadow-[6px_0_8px_-6px_rgba(15,42,74,0.18)]"
                    style={{ width: LEFT_W }}
                  >
                    <div
                      className="group/name relative flex items-center border-r border-slate-100"
                      style={{ width: LEFT_COLS[0].w }}
                    >
                      <input
                        value={b.name}
                        onChange={(e) => onChangeBuilding(b.id, { name: e.target.value })}
                        className="h-[28px] w-full rounded border border-transparent bg-transparent px-1 text-center text-[13.5px] font-bold text-slate-800 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-[#0a63b8] focus:bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveBuilding(b.id)}
                        title={`${b.name} 삭제`}
                        className="absolute -left-0.5 hidden h-4 w-4 items-center justify-center rounded bg-white text-slate-300 shadow-sm transition-colors hover:text-rose-500 group-hover/name:flex"
                      >
                        <span className="text-[13px] leading-none">×</span>
                      </button>
                    </div>
                    <FloorInput
                      width={LEFT_COLS[1].w}
                      value={b.belowFloors}
                      prefix="B"
                      onChange={(v) => onChangeBuilding(b.id, { belowFloors: v })}
                    />
                    <FloorInput
                      width={LEFT_COLS[2].w}
                      value={b.aboveFloors}
                      suffix="F"
                      onChange={(v) => onChangeBuilding(b.id, { aboveFloors: v })}
                    />

                    <div
                      className="flex items-center justify-center gap-1 border-r border-slate-100 px-1"
                      style={{ width: LEFT_COLS[3].w }}
                    >
                      {unit && unit.nos.length > 0 ? (
                        unit.nos.map((no) => (
                          <span
                            key={no}
                            className="inline-flex h-[21px] min-w-[21px] items-center justify-center rounded px-1.5 text-[12px] font-bold text-white"
                            style={{ background: unitColor(no) }}
                            title={`${no}호기`}
                          >
                            {no}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12.5px] text-slate-300">미배정</span>
                      )}
                    </div>
                    {/* 기간 — 여기서 직접 고치면 표 전체가 다시 계산된다 */}
                    <div
                      className="flex items-center justify-center gap-0.5 border-r border-slate-100 px-1"
                      style={{ width: LEFT_COLS[4].w }}
                    >
                      <input
                        type="date"
                        value={start ?? ""}
                        onChange={(e) => onChangeRange(b.id, e.target.value || null, finish)}
                        className="h-[26px] w-[120px] rounded border border-transparent bg-transparent px-0.5 text-center text-[12px] tabular-nums text-slate-600 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-[#0a63b8] focus:bg-white"
                      />
                      <span className="text-[11.5px] text-slate-300">~</span>
                      <input
                        type="date"
                        value={finish ?? ""}
                        onChange={(e) => onChangeRange(b.id, start, e.target.value || null)}
                        className="h-[26px] w-[120px] rounded border border-transparent bg-transparent px-0.5 text-center text-[12px] tabular-nums text-slate-600 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-[#0a63b8] focus:bg-white"
                      />
                    </div>
                    <div
                      className="flex items-center justify-center"
                      style={{ width: LEFT_COLS[5].w }}
                    >
                      {frameTotalDays(b) ? (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12.5px] font-bold tabular-nums text-slate-700">
                          {frameTotalDays(b)}
                          <span className="ml-0.5 text-[10.5px] font-normal text-slate-400">일</span>
                        </span>
                      ) : (
                        <span className="text-[13px] text-slate-300">—</span>
                      )}
                    </div>
                  </div>

                  {/* 타임라인 */}
                  <div className="relative" style={{ width: timelineW }}>
                    {/* 월 경계 세로선 */}
                    {axis.map((c) =>
                      c.part === 2 ? (
                        <div
                          key={c.index}
                          className="pointer-events-none absolute top-0 bottom-0 border-r border-slate-200/70"
                          style={{ left: cellLeft(c) + cellW(c) - 1, width: 1 }}
                        />
                      ) : null,
                    )}

                    {buildDisplaySegments(b, groupTypical).map((s, segIdx, arr) => {
                      const isFirst = segIdx === 0;
                      const isLast = segIdx === arr.length - 1;
                      const resizeIdx =
                        drag?.mode === "resize" && drag.buildingId === b.id
                          ? arr.findIndex((x) => x.key === drag.segmentKey)
                          : -1;
                      const { shift, grow } = previewDx(
                        b.id,
                        segIdx,
                        arr.length,
                        s.key,
                        resizeIdx,
                      );
                      const left = pos(s.start) + shift;
                      const right = pos(s.finish);
                      const w = Math.max(dayW * 3, right - pos(s.start) + grow);
                      const st = segmentStyle(s.floor, b.aboveFloors);
                      const estimated = s.source === "estimated";
                      const dragging = drag?.buildingId === b.id;
                      return (
                        <div
                          key={s.key}
                          onPointerDown={(e) => beginDrag(e, b, "move")}
                          title={
                            `${b.name} ${s.label}` +
                            (s.mergedCount ? ` (${s.mergedCount}개 층)` : "") +
                            ` · ${shortYmd(s.start)} ~ ${shortYmd(s.finish)}` +
                            (estimated ? " (추정)" : "") +
                            "\n끌어서 이 동의 일정을 통째로 옮길 수 있습니다"
                          }
                          className={
                            "absolute flex items-center justify-center overflow-hidden rounded-[4px] text-[11.5px] font-bold leading-none select-none shadow-[0_1px_1.5px_rgba(15,42,74,0.12)] " +
                            (dragging ? "cursor-grabbing" : "cursor-grab")
                          }
                          style={{
                            left,
                            width: w,
                            top: 5,
                            height: ROW_H - 11,
                            background: st.bg,
                            color: st.text,
                            border: `1px solid ${st.border}`,
                            backgroundImage: estimated ? ESTIMATED_PATTERN : undefined,
                            boxShadow: dragging ? "0 2px 8px rgba(8,22,52,0.25)" : undefined,
                          }}
                        >
                          {/* 묶인 띠 안에 층 경계를 눈금으로 남긴다 — 몇 개 층인지 잃지 않게 */}
                          {s.innerBoundaries.map((d) => (
                            <span
                              key={d}
                              className="pointer-events-none absolute inset-y-0 w-px bg-black/10"
                              style={{ left: pos(d) - pos(s.start) }}
                            />
                          ))}
                          {(() => {
                            // 좁은 막대에서 truncate 를 쓰면 "11F" 가 "1…" 로 잘려 오히려 오독을 부른다.
                            // 폭에 맞춰 ① 전체 → ② 짧게 → ③ 생략 순으로 내린다.
                            const full = s.mergedCount
                              ? `${s.label} · ${s.mergedCount}개층`
                              : s.label;
                            const mid = s.label;
                            const compact = s.label.replace(/F$/, "");
                            const need = (t: string) => t.length * 7 + 6;
                            const pick =
                              w >= need(full) ? full : w >= need(mid) ? mid : w >= need(compact) ? compact : null;
                            if (!pick) return null;
                            return (
                              <span
                                className={
                                  "relative overflow-hidden whitespace-nowrap px-0.5 " +
                                  (pick === compact && pick !== mid ? "text-[10px]" : "")
                                }
                              >
                                {pick}
                              </span>
                            );
                          })()}
                          {/* 왼쪽 손잡이(첫 막대) — 착수일. 동 전체가 함께 움직인다 */}
                          {isFirst && (
                            <span
                              onPointerDown={(e) => beginDrag(e, b, "start")}
                              title="착수일 조정 — 동 전체가 함께 이동합니다"
                              className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize rounded-l-[3px] bg-slate-900/0 transition-colors hover:bg-slate-900/30"
                            />
                          )}
                          {/* 오른쪽 손잡이 — 이 층의 기간. 마지막 막대는 전체 기간 신축 */}
                          <span
                            onPointerDown={(e) =>
                              beginDrag(e, b, isLast ? "scale" : "resize", s.key)
                            }
                            title={
                              isLast
                                ? "완료일 조정 — 전체 기간이 층별 비율을 유지한 채 늘고 줄어듭니다"
                                : `${s.label} 기간 조정 — 이 층만 늘리고 이후 층은 함께 밀립니다`
                            }
                            className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize rounded-r-[3px] bg-slate-900/0 transition-colors hover:bg-slate-900/30"
                          />
                        </div>
                      );
                    })}

                    {/* 드래그 중 이동량 표시 — 며칠 밀렸는지 숫자로 보여준다 */}
                    {drag?.buildingId === b.id && Math.round(drag.dx / pxPerDay) !== 0 && (
                      <span
                        className="pointer-events-none absolute z-30 -top-1 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
                        style={{ left: Math.max(0, pos(frameStart(b) ?? axisFrom) + drag.dx) }}
                      >
                        {Math.round(drag.dx / pxPerDay) > 0 ? "+" : ""}
                        {Math.round(drag.dx / pxPerDay)}일
                      </span>
                    )}

                    {/* 해체 마커 — ③ 임대기간 산정 결과가 여기로 되돌아온다 */}
                    {rowMarkers.map((m) => (
                      <div
                        key={`${m.buildingId}-${m.unitNo}`}
                        title={`${m.label} · ${shortYmd(m.date)}`}
                        className="absolute z-10 flex items-center gap-1 rounded-[3px] border px-2 text-[11px] font-bold leading-none shadow-sm"
                        style={{
                          left: pos(m.date),
                          top: 6,
                          height: ROW_H - 13,
                          background: "#1f9d55",
                          borderColor: "#177a42",
                          color: "#ffffff",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.label}
                      </div>
                    ))}
                  </div>

                  {/* 우측 고정 — 동절기 보양 횟수 */}
                  <div
                    className="sticky right-0 z-20 flex border-l border-slate-200 bg-white shadow-[-6px_0_8px_-6px_rgba(15,42,74,0.18)]"
                    style={{ width: RIGHT_W }}
                  >
                    {RIGHT_COLS.map((c) => {
                      const v = wc[c.key];
                      return (
                        <div
                          key={c.key}
                          className="flex items-center justify-center border-r border-slate-100 text-[13px] font-semibold tabular-nums last:border-r-0"
                          style={{ width: RIGHT_COL_W }}
                        >
                          {v > 0 ? (
                            <span className="text-slate-700">{v}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Legend />
    </div>
  );
}

/** 층수 입력 — 값을 바꾸면 층 행이 다시 만들어지고 사이가 보간된다 */
function FloorInput({
  width,
  value,
  prefix,
  suffix,
  onChange,
}: {
  width: number;
  value: number;
  prefix?: string;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-center gap-0 border-r border-slate-100"
      style={{ width }}
    >
      {prefix && <span className="text-[12.5px] text-slate-400">{prefix}</span>}
      <input
        type="number"
        min={0}
        max={99}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
        className="h-[28px] w-[34px] rounded border border-transparent bg-transparent px-0 text-center text-[13px] tabular-nums text-slate-600 outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none hover:border-slate-200 hover:bg-slate-50 focus:border-[#0a63b8] focus:bg-white"
      />
      {suffix && <span className="text-[12.5px] text-slate-400">{suffix}</span>}
    </div>
  );
}

function Legend() {
  const items: Array<[string, number, number]> = [
    ["기초", 0, 20],
    ["지하", -1, 20],
    ["1F", 1, 20],
    ["2~3F", 2, 20],
    ["기준층", 5, 20],
    ["최상층", 20, 20],
    ["옥탑", 21, 20],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5">
      {items.map(([label, floor, above]) => {
        const st = segmentStyle(floor, above);
        return (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200">
            <span
              className="inline-block h-3 w-5 rounded-[2px]"
              style={{ background: st.bg, border: `1px solid ${st.border}` }}
            />
            {label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200">
        <span
          className="inline-block h-3 w-5 rounded-[2px] border border-slate-300 bg-slate-200"
          style={{ backgroundImage: ESTIMATED_PATTERN }}
        />
        추정(빗금)
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200">
        <span className="inline-block h-3 w-5 rounded-[2px] border border-[#177a42] bg-[#1f9d55]" />
        호기 해체
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200">
        <span className="inline-block h-3 w-5 rounded-[2px] border-x-2 border-dashed border-[#e0453e]/70 bg-[#e8433c]/[0.06]" />
        동절기
      </span>
    </div>
  );
}
