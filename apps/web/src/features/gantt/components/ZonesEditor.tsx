/**
 * 지하층 구역별 순서 (설정 탭, 동 목록·규모 카드와 별도, 2026-10-30).
 * 줄 순서 = 시공 순서(위·아래 버튼으로 바꾼다). 구역마다 이름·지하 몇 층까지·관련 동·메모.
 * 현장 설정(gantt_site_settings.settings.zones)에 같이 저장된다. 이 순서로 지하 예정을 내는 계산은 다음 단계.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { UndergroundZone } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Building } from "../api";
import { NumInput } from "./StepInput";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `z${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

export default function ZonesEditor({
  value,
  buildings,
  onChange,
}: {
  value: UndergroundZone[];
  buildings: Building[];
  onChange: (next: UndergroundZone[]) => void;
}) {
  const update = (i: number, patch: Partial<UndergroundZone>) => onChange(value.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // 「동 추가」 처럼 마지막 구역의 지하 층수·관련 동을 가져온다
  const add = () => {
    const last = value.at(-1);
    const maxBasement = Math.max(0, ...buildings.map((b) => b.basementFloors ?? 0));
    onChange([
      ...value,
      {
        id: newId(),
        name: `${value.length + 1}구역`,
        basementFloors: last?.basementFloors ?? (maxBasement || 1),
        buildingNos: last ? [...last.buildingNos] : [],
        memo: "",
      },
    ]);
  };
  const toggleBuilding = (i: number, no: number) => {
    const z = value[i];
    const has = z.buildingNos.includes(no);
    update(i, { buildingNos: has ? z.buildingNos.filter((n) => n !== no) : [...z.buildingNos, no].sort((a, b) => a - b) });
  };
  const cell = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">지하층 구역별 순서</h4>
          <p className="text-xs text-muted-foreground">
            위에서 아래 순서가 시공 순서입니다. 주차장처럼 동 밖 구역은 관련 동을 비워 두세요. 이 순서로 지하 예정을 내는 계산은 다음 단계입니다.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={add}>
          <Plus /> 구역 추가
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">아직 구역이 없습니다. "구역 추가"로 시작하세요.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-2 whitespace-nowrap">순서</th>
              <th className="pb-1 pr-2 whitespace-nowrap">구역 이름</th>
              <th className="pb-1 pr-2 whitespace-nowrap">지하</th>
              <th className="pb-1 pr-2 whitespace-nowrap">관련 동</th>
              <th className="pb-1 pr-2 whitespace-nowrap">메모</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {value.map((z, i) => (
              <tr key={z.id} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-2 w-20">
                  <div className="flex items-center gap-0.5">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
                    <Button variant="ghost" size="icon-sm" className="size-6" disabled={i === 0} title="위로" aria-label={`${z.name} 위로`} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="size-6" disabled={i === value.length - 1} title="아래로" aria-label={`${z.name} 아래로`} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="py-1.5 pr-2 w-40">
                  <input className={cell} value={z.name} maxLength={60} aria-label="구역 이름" onChange={(e) => update(i, { name: e.target.value })} />
                </td>
                <td className="py-1.5 pr-2 w-24">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">B</span>
                    <NumInput className="w-14" min={1} max={10} value={z.basementFloors} aria-label="지하 몇 층까지" onValue={(v) => update(i, { basementFloors: v ?? z.basementFloors })} />
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  {buildings.length ? (
                    <div className="flex flex-wrap gap-1">
                      {buildings.map((b) => {
                        const on = z.buildingNos.includes(b.buildingNo);
                        return (
                          <button
                            key={b.buildingNo}
                            type="button"
                            onClick={() => toggleBuilding(i, b.buildingNo)}
                            aria-pressed={on}
                            className={cn(
                              "h-7 rounded-full border px-2 text-xs tabular-nums transition-colors",
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50",
                            )}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">동 목록을 먼저 넣으세요</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 w-40">
                  <input className={cell} value={z.memo} maxLength={200} placeholder="예: 램프·전기실 포함" aria-label="메모" onChange={(e) => update(i, { memo: e.target.value })} />
                </td>
                <td className="py-1.5 text-right">
                  <Button variant="ghost" size="icon-sm" title={`${z.name} 삭제`} aria-label={`${z.name} 삭제`} onClick={() => remove(i)}>
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
