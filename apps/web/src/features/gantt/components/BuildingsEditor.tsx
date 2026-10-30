/**
 * 동 목록·규모 편집 — 동 번호, 이름, 기준층 시작 층, 코어(최상층·옥탑 층수), (일보 없을 때) 현재 층.
 * 같은 동이라도 코어마다 최상층·옥탑이 다를 수 있어, 동 한 줄 안에 코어를 세로로 쌓는다(동을 두 줄로 넣지 않는다).
 * 동의 최상층 = 코어 중 가장 높은 층. 최상층이 있어야 11월 이후 계획이 맞는다(최상층 타설 뒤 사이클에서 빠짐).
 */
import type { InputHTMLAttributes } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));
const MAX_CORES = 8;

/** 이름 안의 첫 숫자를 d 만큼 올리고 내린다 ("401동" → "402동"). 숫자가 없으면 그대로 */
const stepName = (name: string, d: number) => name.replace(/\d+/, (m) => String(Math.max(0, Number(m) + d)).padStart(m.length, "0"));

/**
 * 화살표가 달린 입력칸 — 이 표의 모든 칸(숫자·이름)이 같은 화살표를 쓰게 한다.
 * 브라우저 기본 숫자 화살표는 숨기고, 마우스를 올리거나 칸에 들어가면 위·아래 화살표가 보인다. 방향키도 같다.
 */
function StepInput({
  onStep,
  className = "",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { onStep: (d: 1 | -1) => void; className?: string }) {
  const btn = "flex h-3.5 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className={`group relative ${className}`}>
      <input
        {...rest}
        className="h-8 w-full rounded-md border border-input bg-card pl-2 pr-5 text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          onStep(e.key === "ArrowUp" ? 1 : -1);
        }}
      />
      <div className="absolute inset-y-0 right-0.5 flex flex-col justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" tabIndex={-1} aria-label="올리기" className={btn} onClick={() => onStep(1)}>
          <ChevronUp className="size-3" />
        </button>
        <button type="button" tabIndex={-1} aria-label="내리기" className={btn} onClick={() => onStep(-1)}>
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** 숫자 칸 — 화살표는 min·max 안에서만 움직인다 */
function NumInput({
  value,
  onValue,
  min,
  max,
  className,
  ...rest
}: { value: number | null; onValue: (v: number | null) => void; min: number; max?: number; className?: string; placeholder?: string; "aria-label"?: string }) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v));
  return (
    <StepInput
      {...rest}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value ?? ""}
      onChange={(e) => onValue(e.target.value === "" ? null : num(e.target.value, value ?? min))}
      onStep={(d) => onValue(clamp((value ?? min - d) + d))}
    />
  );
}

type Core = { top: number; rooftop: number };
const coresOf = (b: Building): Core[] => b.coreTopFloors.map((top, k) => ({ top, rooftop: b.coreRooftopFloors[k] ?? 0 }));
/** 코어 목록 → 동 필드 (코어 수·동 최상층·옥탑 여부를 같이 맞춘다) */
const fromCores = (cores: Core[]): Partial<Building> => ({
  coreTopFloors: cores.map((c) => c.top),
  coreRooftopFloors: cores.map((c) => c.rooftop),
  cores: cores.length,
  topFloor: Math.max(...cores.map((c) => c.top)),
  hasRooftop: cores.some((c) => c.rooftop > 0),
});

export default function BuildingsEditor({ value, onChange }: { value: Building[]; onChange: (next: Building[]) => void }) {
  const update = (i: number, patch: Partial<Building>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    // 비어 있으면 101동부터 (예전 401 은 남원주 1차 기준값이었다), 아니면 마지막 동 + 1
    const next = (value.at(-1)?.buildingNo ?? 100) + 1;
    onChange([...value, { buildingNo: next, name: `${next}동`, baseFloor: 3, currentFloor: null, basementFloors: null, ...fromCores([{ top: 30, rooftop: 1 }]) } as Building]);
  };
  /** 동 번호를 바꾸면 이름 속 같은 번호도 바꾼다 ("401동" → "101동", "401동(A)" → "101동(A)"). 이름에 옛 번호가 없으면 그대로 */
  const setNo = (i: number, no: number) => {
    const b = value[i];
    const re = new RegExp(`(^|[^\d])${b.buildingNo}(?!\d)`);
    const name = re.test(b.name) ? b.name.replace(re, `$1${no}`) : b.name;
    update(i, { buildingNo: no, name });
  };
  const setCores = (i: number, cores: Core[]) => update(i, fromCores(cores));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">동 목록·규모</h4>
          <p className="text-xs text-muted-foreground">
            동 번호는 작업일보의 "401동"과 같아야 합니다. 코어마다 최상층·옥탑이 다르면 그 동 안에서 "코어 추가"를 누르세요. 옥탑 0층 = 없음.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={add}>
          <Plus /> 동 추가
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">아직 동이 없습니다. "동 추가"로 시작하세요.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-2 whitespace-nowrap">동 번호</th>
              <th className="pb-1 pr-2 whitespace-nowrap">이름</th>
              <th className="pb-1 pr-2 whitespace-nowrap" title="지하 맨 아래층 (B3 까지면 3). 일보 없는 동의 지하 출발 층">지하</th>
              <th className="pb-1 pr-2 whitespace-nowrap">기준층 시작</th>
              <th className="pb-1 pr-2 whitespace-nowrap">코어별 최상층 · 옥탑</th>
              <th className="pb-1 pr-2 whitespace-nowrap">현재 층</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {value.map((b, i) => {
              const cores = coresOf(b);
              const multi = cores.length > 1;
              return (
                <tr key={i} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-2 w-20">
                    <NumInput min={1} value={b.buildingNo} onValue={(v) => setNo(i, v ?? b.buildingNo)} aria-label="동 번호" />
                  </td>
                  <td className="py-1.5 pr-2 w-28">
                    <StepInput
                      value={b.name}
                      aria-label="이름"
                      onChange={(e) => update(i, { name: e.target.value })}
                      onStep={(d) => update(i, { name: stepName(b.name, d) })}
                    />
                  </td>
                  <td className="py-1.5 pr-2 w-16">
                    <NumInput min={0} max={10} value={b.basementFloors ?? null} placeholder="—" onValue={(v) => update(i, { basementFloors: v })} aria-label="지하층 수" />
                  </td>
                  <td className="py-1.5 pr-2 w-20">
                    <NumInput min={1} value={b.baseFloor} onValue={(v) => update(i, { baseFloor: v ?? b.baseFloor })} aria-label="기준층 시작" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="space-y-1">
                      {cores.map((c, k) => {
                        const set = (patch: Partial<Core>) => setCores(i, cores.map((x, j) => (j === k ? { ...x, ...patch } : x)));
                        return (
                          <div key={k} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                            <span className="w-10 shrink-0 font-medium text-foreground">{k + 1}코어</span>
                            <span>최상층</span>
                            <NumInput
                              className="w-16"
                              min={1}
                              max={80}
                              value={c.top}
                              aria-label={`${b.name} ${k + 1}코어 최상층`}
                              onValue={(v) => set({ top: v ?? c.top })}
                            />
                            <span className="mr-2">층</span>
                            <span>옥탑</span>
                            <NumInput
                              className="w-16"
                              min={0}
                              max={10}
                              value={c.rooftop}
                              aria-label={`${b.name} ${k + 1}코어 옥탑 층수`}
                              onValue={(v) => set({ rooftop: v ?? c.rooftop })}
                            />
                            <span>층</span>
                            {/* 코어가 하나면 X 는 숨기되 자리는 남겨 "코어 추가" 위치를 맞춘다 */}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className={`ml-1 text-muted-foreground hover:text-red-600 ${multi ? "" : "invisible"}`}
                              disabled={!multi}
                              aria-hidden={!multi}
                              title={`${k + 1}코어 삭제`}
                              aria-label={`${b.name} ${k + 1}코어 삭제`}
                              onClick={() => setCores(i, cores.filter((_, j) => j !== k))}
                            >
                              <X />
                            </Button>
                            {k === cores.length - 1 && cores.length < MAX_CORES ? (
                              <button
                                type="button"
                                className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary hover:bg-muted"
                                onClick={() => setCores(i, [...cores, cores.at(-1) ?? { top: 30, rooftop: 1 }])}
                              >
                                <Plus className="size-3.5" /> 코어 추가
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 w-24">
                    <NumInput min={0} value={b.currentFloor} placeholder="일보 우선" onValue={(v) => update(i, { currentFloor: v })} aria-label="현재 층" />
                  </td>
                  <td className="py-1.5 text-right">
                    <Button variant="ghost" size="icon-sm" title={`${b.name} 삭제`} aria-label={`${b.name} 삭제`} onClick={() => remove(i)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
