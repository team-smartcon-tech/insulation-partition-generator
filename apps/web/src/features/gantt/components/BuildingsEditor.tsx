/**
 * 동 목록·규모 편집 — 동 번호, 이름, 기준층 시작 층, 코어별 최상층, 옥탑, (일보 없을 때) 현재 층.
 * 같은 동이라도 코어마다 최상층이 다를 수 있어 한 줄 안에서 코어를 늘린다(동을 두 줄로 넣지 않는다).
 * 동의 최상층 = 코어 중 가장 높은 층. 최상층이 있어야 11월 이후 계획이 맞는다(최상층 타설 뒤 사이클에서 빠짐).
 */
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

export default function BuildingsEditor({ value, onChange }: { value: Building[]; onChange: (next: Building[]) => void }) {
  const update = (i: number, patch: Partial<Building>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    const next = (value.at(-1)?.buildingNo ?? 400) + 1;
    onChange([...value, { buildingNo: next, name: `${next}동`, cores: 1, coreTopFloors: [30], baseFloor: 3, topFloor: 30, hasRooftop: false, currentFloor: null }]);
  };
  /** 코어별 최상층을 바꾸면 코어 수·동 최상층(최댓값)도 같이 맞춘다 */
  const setCores = (i: number, floors: number[]) => update(i, { coreTopFloors: floors, cores: floors.length, topFloor: Math.max(...floors) });
  const cell = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm tabular-nums";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">동 목록·규모</h4>
          <p className="text-xs text-muted-foreground">동 번호는 작업일보의 "401동"과 같아야 합니다. 코어마다 최상층이 다르면 "+ 코어"로 한 줄 안에 추가하세요.</p>
        </div>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus /> 동 추가
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">아직 동이 없습니다. "동 추가"로 시작하세요.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-2">동 번호</th>
              <th className="pb-1 pr-2">이름</th>
              <th className="pb-1 pr-2">기준층 시작</th>
              <th className="pb-1 pr-2">코어별 최상층</th>
              <th className="pb-1 pr-2">옥탑</th>
              <th className="pb-1 pr-2">현재 층</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {value.map((b, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1 pr-2 w-24">
                  <input className={cell} type="number" min={1} value={b.buildingNo} onChange={(e) => update(i, { buildingNo: num(e.target.value, b.buildingNo) })} />
                </td>
                <td className="py-1 pr-2 w-32">
                  <input className={cell} value={b.name} onChange={(e) => update(i, { name: e.target.value })} />
                </td>
                <td className="py-1 pr-2 w-24">
                  <input className={cell} type="number" min={1} value={b.baseFloor} onChange={(e) => update(i, { baseFloor: num(e.target.value, b.baseFloor) })} />
                </td>
                <td className="py-1 pr-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.coreTopFloors.map((f, k) => (
                      <label key={k} className="flex items-center gap-1">
                        {b.coreTopFloors.length > 1 ? <span className="text-xs text-muted-foreground">{k + 1}코어</span> : null}
                        <input
                          className={`${cell} w-16`}
                          type="number"
                          min={1}
                          max={80}
                          value={f}
                          aria-label={`${k + 1}코어 최상층`}
                          onChange={(e) => setCores(i, b.coreTopFloors.map((x, j) => (j === k ? num(e.target.value, x) : x)))}
                        />
                        {b.coreTopFloors.length > 1 ? (
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={`${k + 1}코어 빼기`}
                            onClick={() => setCores(i, b.coreTopFloors.filter((_, j) => j !== k))}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </label>
                    ))}
                    {b.coreTopFloors.length < 8 ? (
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setCores(i, [...b.coreTopFloors, b.coreTopFloors.at(-1) ?? 30])}>
                        <Plus className="size-3.5" /> 코어
                      </Button>
                    ) : null}
                  </div>
                </td>
                <td className="py-1 pr-2 w-16 text-center">
                  <input type="checkbox" checked={b.hasRooftop} onChange={(e) => update(i, { hasRooftop: e.target.checked })} className="size-4 accent-primary" />
                </td>
                <td className="py-1 pr-2 w-24">
                  <input className={cell} type="number" min={0} value={b.currentFloor ?? ""} placeholder="일보 우선" onChange={(e) => update(i, { currentFloor: e.target.value === "" ? null : num(e.target.value, 0) })} />
                </td>
                <td className="py-1 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label="삭제" onClick={() => remove(i)}>
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
