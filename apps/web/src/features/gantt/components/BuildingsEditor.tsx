/**
 * 동 목록·규모 편집 — 동 번호, 이름, 코어 수, 기준층 시작 층, 최상층, 옥탑, (일보 없을 때) 현재 층.
 * 최상층이 있어야 11월 이후 계획이 맞는다(최상층 타설 뒤 사이클에서 빠짐, 최상층 사이클에 단열재).
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

export default function BuildingsEditor({ value, onChange }: { value: Building[]; onChange: (next: Building[]) => void }) {
  const update = (i: number, patch: Partial<Building>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    const next = (value.at(-1)?.buildingNo ?? 400) + 1;
    onChange([...value, { buildingNo: next, name: `${next}동`, cores: 1, baseFloor: 3, topFloor: 30, hasRooftop: false, currentFloor: null }]);
  };
  const cell = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm tabular-nums";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">동 목록·규모</h4>
          <p className="text-xs text-muted-foreground">동 번호는 작업일보의 "401동"과 같아야 합니다. 최상층을 꼭 넣어 주세요.</p>
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
              <th className="pb-1 pr-2">코어</th>
              <th className="pb-1 pr-2">기준층 시작</th>
              <th className="pb-1 pr-2">최상층</th>
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
                <td className="py-1 pr-2 w-20">
                  <input className={cell} type="number" min={1} max={8} value={b.cores} onChange={(e) => update(i, { cores: num(e.target.value, b.cores) })} />
                </td>
                <td className="py-1 pr-2 w-24">
                  <input className={cell} type="number" min={1} value={b.baseFloor} onChange={(e) => update(i, { baseFloor: num(e.target.value, b.baseFloor) })} />
                </td>
                <td className="py-1 pr-2 w-24">
                  <input className={cell} type="number" min={1} max={80} value={b.topFloor} onChange={(e) => update(i, { topFloor: num(e.target.value, b.topFloor) })} />
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
