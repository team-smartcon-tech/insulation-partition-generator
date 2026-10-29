/**
 * 동 목록·규모 편집 — 동 번호, 이름, 기준층 시작 층, 코어(최상층·옥탑 층수), (일보 없을 때) 현재 층.
 * 같은 동이라도 코어마다 최상층·옥탑이 다를 수 있어, 동 한 줄 안에 코어를 세로로 쌓는다(동을 두 줄로 넣지 않는다).
 * 동의 최상층 = 코어 중 가장 높은 층. 최상층이 있어야 11월 이후 계획이 맞는다(최상층 타설 뒤 사이클에서 빠짐).
 */
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));
const MAX_CORES = 8;

/** 이름 안의 첫 숫자를 d 만큼 올리고 내린다 ("401동" → "402동"). 숫자가 없으면 그대로 */
const stepName = (name: string, d: number) => name.replace(/\d+/, (m) => String(Math.max(0, Number(m) + d)).padStart(m.length, "0"));

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
    const next = (value.at(-1)?.buildingNo ?? 400) + 1;
    onChange([...value, { buildingNo: next, name: `${next}동`, baseFloor: 3, currentFloor: null, ...fromCores([{ top: 30, rooftop: 1 }]) } as Building]);
  };
  const setCores = (i: number, cores: Core[]) => update(i, fromCores(cores));

  const cell = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm tabular-nums";
  const small = "h-8 w-14 rounded-md border border-input bg-card px-2 text-sm tabular-nums";

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
                    <input className={cell} type="number" min={1} value={b.buildingNo} onChange={(e) => update(i, { buildingNo: num(e.target.value, b.buildingNo) })} />
                  </td>
                  <td className="py-1.5 pr-2 w-28">
                    <div className="relative">
                      <input
                        className={`${cell} pr-6`}
                        value={b.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                          e.preventDefault();
                          update(i, { name: stepName(b.name, e.key === "ArrowUp" ? 1 : -1) });
                        }}
                      />
                      <div className="absolute inset-y-0 right-0.5 flex flex-col justify-center">
                        <button type="button" tabIndex={-1} aria-label={`${b.name} 이름 숫자 올리기`} className="flex h-3.5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => update(i, { name: stepName(b.name, 1) })}>
                          <ChevronUp className="size-3" />
                        </button>
                        <button type="button" tabIndex={-1} aria-label={`${b.name} 이름 숫자 내리기`} className="flex h-3.5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => update(i, { name: stepName(b.name, -1) })}>
                          <ChevronDown className="size-3" />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 w-20">
                    <input className={cell} type="number" min={1} value={b.baseFloor} onChange={(e) => update(i, { baseFloor: num(e.target.value, b.baseFloor) })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="space-y-1">
                      {cores.map((c, k) => {
                        const set = (patch: Partial<Core>) => setCores(i, cores.map((x, j) => (j === k ? { ...x, ...patch } : x)));
                        return (
                          <div key={k} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                            <span className="w-10 shrink-0 font-medium text-foreground">{k + 1}코어</span>
                            <span>최상층</span>
                            <input
                              className={small}
                              type="number"
                              min={1}
                              max={80}
                              value={c.top}
                              aria-label={`${b.name} ${k + 1}코어 최상층`}
                              onChange={(e) => set({ top: num(e.target.value, c.top) })}
                            />
                            <span className="mr-2">층</span>
                            <span>옥탑</span>
                            <input
                              className={small}
                              type="number"
                              min={0}
                              max={10}
                              value={c.rooftop}
                              aria-label={`${b.name} ${k + 1}코어 옥탑 층수`}
                              onChange={(e) => set({ rooftop: num(e.target.value, c.rooftop) })}
                            />
                            <span>층</span>
                            {multi ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="ml-1 text-muted-foreground hover:text-red-600"
                                title={`${k + 1}코어 삭제`}
                                aria-label={`${b.name} ${k + 1}코어 삭제`}
                                onClick={() => setCores(i, cores.filter((_, j) => j !== k))}
                              >
                                <X />
                              </Button>
                            ) : null}
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
                    <input className={cell} type="number" min={0} value={b.currentFloor ?? ""} placeholder="일보 우선" onChange={(e) => update(i, { currentFloor: e.target.value === "" ? null : num(e.target.value, 0) })} />
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
