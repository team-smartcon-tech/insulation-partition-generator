/**
 * BillingGrid — 층×호 기성 진도 입력 그리드 (명세 12단계).
 *
 * 범위 문자열을 외우기 싫은 사용자가 반드시 있다. 그리드로 클릭·드래그해 고르고,
 * **선택 결과를 범위 문자열로 역변환해 보여준다**(학습 효과).
 *
 * 진도 입력은 **공종별로 독립**이다. 상단 탭으로 공종을 고른다.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { UnitDto } from "./api";

export interface BillingGridProps {
  units: UnitDto[];
  works: { code: string; name: string }[];
  /** 공종별 누계 진도율 (unitKey → ratio) */
  progress: Record<string, Record<string, number>>;
  onChange: (work: string, unitKeys: string[], ratio: number) => void;
  /** 확정된 차수면 편집 불가 */
  locked?: boolean;
}

/** 선택 세대 → 범위 문자열 역변환 (예: "101동 2~10F 01,02호") */
export function toRangeString(units: UnitDto[], selected: Set<string>): string {
  const picked = units.filter(u => selected.has(u.key));
  if (picked.length === 0) return "";
  const byBuilding = new Map<string, UnitDto[]>();
  for (const u of picked) {
    const arr = byBuilding.get(u.building) ?? [];
    arr.push(u);
    byBuilding.set(u.building, arr);
  }
  const parts: string[] = [];
  for (const [bld, list] of byBuilding) {
    const floors = [...new Set(list.map(u => u.floor))].sort((a, b) => a - b);
    // 연속 구간 묶기
    const ranges: string[] = [];
    let s = floors[0];
    let p = floors[0];
    for (const f of floors.slice(1)) {
      if (f === p + 1) {
        p = f;
        continue;
      }
      ranges.push(s === p ? `${s}F` : `${s}~${p}F`);
      s = p = f;
    }
    ranges.push(s === p ? `${s}F` : `${s}~${p}F`);

    const allLines = [...new Set(units.filter(u => u.building === bld).map(u => u.line))];
    const lines = [...new Set(list.map(u => u.line))].sort();
    const unitPart =
      lines.length === allLines.length ? "전체" : `${lines.join(",")}호`;
    parts.push(`${bld}동 ${ranges.join(" ")} ${unitPart}`);
  }
  return parts.join("\n");
}

export default function BillingGrid({
  units,
  works,
  progress,
  onChange,
  locked = false,
}: BillingGridProps) {
  const [work, setWork] = useState(works[0]?.code ?? "");
  const [building, setBuilding] = useState(units[0]?.building ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ratio, setRatio] = useState(100);
  const [drag, setDrag] = useState<null | "add" | "remove">(null);

  const buildings = useMemo(
    () => [...new Set(units.map(u => u.building))].sort(),
    [units]
  );
  const scoped = useMemo(
    () => units.filter(u => u.building === building),
    [units, building]
  );
  const floors = useMemo(
    () => [...new Set(scoped.map(u => u.floor))].sort((a, b) => b - a), // 위층이 위로
    [scoped]
  );
  const lines = useMemo(
    () => [...new Set(scoped.map(u => u.line))].sort(),
    [scoped]
  );
  const cell = useMemo(() => {
    const m = new Map<string, UnitDto>();
    for (const u of scoped) m.set(`${u.floor}|${u.line}`, u);
    return m;
  }, [scoped]);

  const cur = progress[work] ?? {};

  const toggle = (key: string, mode: "add" | "remove") => {
    setSelected(prev => {
      const next = new Set(prev);
      if (mode === "add") next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const apply = () => {
    if (locked || selected.size === 0) return;
    onChange(work, [...selected], ratio / 100);
    setSelected(new Set());
  };

  const rangeText = toRangeString(units, selected);

  return (
    <div className="flex flex-col gap-3">
      {/* 공종 탭 — 진도는 공종별로 독립이다 */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-1">
        {works.map(w => (
          <button
            key={w.code}
            type="button"
            onClick={() => setWork(w.code)}
            className={cn(
              "rounded-t px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
              work === w.code
                ? "bg-[#004791] text-white"
                : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {w.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={building}
            onChange={e => setBuilding(e.target.value)}
            className="h-7 rounded border border-slate-300 px-2 text-[12px]"
          >
            {buildings.map(b => (
              <option key={b} value={b}>
                {b}동
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 그리드 — 세로축 층 / 가로축 호·라인 */}
      <div
        className="overflow-auto rounded border border-slate-200"
        onMouseUp={() => setDrag(null)}
        onMouseLeave={() => setDrag(null)}
      >
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1 text-slate-500">
                층 \ 호
              </th>
              {lines.map(l => (
                <th
                  key={l}
                  className="border-b border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-600"
                >
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floors.map(f => (
              <tr key={f}>
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-2 py-1 text-right font-semibold text-slate-600">
                  {f}F
                </td>
                {lines.map(l => {
                  const u = cell.get(`${f}|${l}`);
                  if (!u) {
                    return (
                      <td
                        key={l}
                        className="border border-slate-100 bg-slate-50/60 px-2 py-1 text-center text-slate-300"
                        title="결번/미존재"
                      >
                        ·
                      </td>
                    );
                  }
                  const r = cur[u.key] ?? 0;
                  const sel = selected.has(u.key);
                  return (
                    <td
                      key={l}
                      onMouseDown={() => {
                        if (locked) return;
                        const mode = sel ? "remove" : "add";
                        setDrag(mode);
                        toggle(u.key, mode);
                      }}
                      onMouseEnter={() => {
                        if (drag && !locked) toggle(u.key, drag);
                      }}
                      title={`${u.unit_no}호 · ${u.unit_type} · 누계 ${(r * 100).toFixed(0)}%`}
                      className={cn(
                        "cursor-pointer select-none border px-2 py-1 text-center tabular-nums transition-colors",
                        sel
                          ? "border-[#004791] bg-[#cfe3f7] font-bold text-[#0a4a86]"
                          : r >= 1
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : r > 0
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-100 text-slate-400 hover:bg-slate-50",
                        locked && "cursor-not-allowed opacity-60"
                      )}
                    >
                      {r > 0 ? `${(r * 100).toFixed(0)}` : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 선택 → 범위 문자열 역변환 (학습용) + 적용 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-[11.5px] font-semibold text-slate-600">
          선택 {selected.size}세대
        </span>
        {rangeText && (
          <code className="rounded bg-white px-2 py-0.5 text-[11px] text-[#004791] ring-1 ring-slate-200">
            {rangeText.replace(/\n/g, " / ")}
          </code>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="text-[11.5px] text-slate-500">진도율</label>
          <input
            type="number"
            min={0}
            max={100}
            value={ratio}
            onChange={e => setRatio(Number(e.target.value))}
            className="h-7 w-16 rounded border border-slate-300 px-1.5 text-right text-[12px]"
          />
          <span className="text-[11.5px] text-slate-500">%</span>
          <button
            type="button"
            onClick={apply}
            disabled={locked || selected.size === 0}
            className="rounded bg-[#004791] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            적용
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-[12px] text-slate-600"
          >
            해제
          </button>
        </div>
      </div>
      {locked && (
        <p className="text-[11.5px] font-semibold text-rose-600">
          확정된 차수입니다 — 수정하려면 확정을 해제하세요.
        </p>
      )}
    </div>
  );
}
