/**
 * 지하층 구역별 순서 — 형틀(거푸집) 팀별로 묶는다 (설정 탭, 동 목록·규모 카드와 별도, 2026-10-30).
 * - 팀(A팀·B팀·C팀 …)마다 맡은 구역을 순서대로 돈다. 팀 안에서 위·아래로 순서를 바꾼다.
 * - 구역마다 이름·지하 몇 층까지·관련 동·메모. 팀 선택으로 다른 팀에 옮긴다.
 * - 현장 설정(settings.zones · settings.formTeams)에 같이 저장된다. 이 순서로 지하 예정을 내는 계산은 다음 단계.
 */
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { UndergroundZone } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Building } from "../api";
import { NumInput } from "./StepInput";

const LETTERS = "ABCDEFGHIJ".split("");
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `z${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

/** 팀 목록: 저장된 팀 + 구역에 쓰인 팀 (순서 유지). 아무것도 없으면 A팀 하나 */
function teamsOf(zones: UndergroundZone[], formTeams: string[] | undefined): string[] {
  const out = [...(formTeams ?? [])];
  for (const z of zones) if (!out.includes(z.team)) out.push(z.team);
  return out.length ? out : ["A"];
}

export default function ZonesEditor({
  zones,
  formTeams,
  buildings,
  onChange,
}: {
  zones: UndergroundZone[];
  formTeams: string[] | undefined;
  buildings: Building[];
  onChange: (zones: UndergroundZone[], formTeams: string[]) => void;
}) {
  const teams = teamsOf(zones, formTeams);
  const set = (next: UndergroundZone[], nextTeams = teams) => onChange(next, nextTeams);
  const update = (id: string, patch: Partial<UndergroundZone>) => set(zones.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const remove = (id: string) => set(zones.filter((z) => z.id !== id));

  /** 같은 팀 안에서 앞·뒤 구역과 자리 바꾸기 */
  const move = (id: string, d: -1 | 1) => {
    const z = zones.find((x) => x.id === id);
    if (!z) return;
    const same = zones.map((x, i) => ({ x, i })).filter(({ x }) => x.team === z.team);
    const k = same.findIndex(({ x }) => x.id === id);
    const other = same[k + d];
    if (!other) return;
    const next = [...zones];
    [next[same[k].i], next[other.i]] = [next[other.i], next[same[k].i]];
    set(next);
  };

  /** 그 팀에 구역 추가 — 그 팀 마지막 구역의 지하 층수·관련 동을 가져온다 */
  const addZone = (team: string) => {
    const mine = zones.filter((z) => z.team === team);
    const last = mine.at(-1);
    const maxBasement = Math.max(0, ...buildings.map((b) => b.basementFloors ?? 0));
    set([
      ...zones,
      {
        id: newId(),
        team,
        name: `${team}${mine.length + 1}구역`,
        basementFloors: last?.basementFloors ?? (maxBasement || 1),
        buildingNos: last ? [...last.buildingNos] : [],
        memo: "",
      },
    ]);
  };
  const nextLetter = LETTERS.find((l) => !teams.includes(l));
  const addTeam = () => nextLetter && set(zones, [...teams, nextLetter]);
  const removeTeam = (team: string) => set(zones, teams.filter((t) => t !== team));

  const toggleBuilding = (z: UndergroundZone, no: number) =>
    update(z.id, { buildingNos: z.buildingNos.includes(no) ? z.buildingNos.filter((n) => n !== no) : [...z.buildingNos, no].sort((a, b) => a - b) });
  const cell = "h-8 w-full rounded-md border border-input bg-card px-2 text-sm";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">지하층 구역별 순서 (형틀·거푸집 팀별)</h4>
          <p className="text-xs text-muted-foreground">
            팀마다 맡은 구역을 위에서 아래 순서로 돕니다. 주차장처럼 동 밖 구역은 관련 동을 비워 두세요. 이 순서로 지하 예정을 내는 계산은 다음 단계입니다.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={addTeam} disabled={!nextLetter}>
          <Plus /> 팀 추가
        </Button>
      </div>

      <div className="space-y-3">
        {teams.map((team) => {
          const mine = zones.filter((z) => z.team === team);
          return (
            <div key={team} className="rounded-md border border-border/80">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
                <span className="text-sm font-semibold">
                  {team}팀 <span className="ml-1 text-xs font-normal text-muted-foreground">형틀·거푸집 · 구역 {mine.length}개</span>
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addZone(team)}>
                    <Plus className="size-3.5" /> 구역 추가
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    disabled={mine.length > 0 || teams.length <= 1}
                    title={mine.length ? "구역이 있는 팀은 지울 수 없습니다 (구역을 옮기거나 지운 뒤)" : `${team}팀 삭제`}
                    aria-label={`${team}팀 삭제`}
                    onClick={() => removeTeam(team)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
              {mine.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">아직 구역이 없습니다. "구역 추가"로 시작하세요.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-2 pb-1 pt-1.5 whitespace-nowrap">순서</th>
                      <th className="pb-1 pr-2 pt-1.5 whitespace-nowrap">구역 이름</th>
                      <th className="pb-1 pr-2 pt-1.5 whitespace-nowrap">팀</th>
                      <th className="pb-1 pr-2 pt-1.5 whitespace-nowrap">지하</th>
                      <th className="pb-1 pr-2 pt-1.5 whitespace-nowrap">관련 동</th>
                      <th className="pb-1 pr-2 pt-1.5 whitespace-nowrap">메모</th>
                      <th className="pb-1 pt-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((z, i) => (
                      <tr key={z.id} className="border-t border-border/60 align-top">
                        <td className="px-2 py-1.5 w-20">
                          <div className="flex items-center gap-0.5">
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
                            <Button variant="ghost" size="icon-sm" className="size-6" disabled={i === 0} title="위로" aria-label={`${z.name} 위로`} onClick={() => move(z.id, -1)}>
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" className="size-6" disabled={i === mine.length - 1} title="아래로" aria-label={`${z.name} 아래로`} onClick={() => move(z.id, 1)}>
                              <ArrowDown className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 w-36">
                          <input className={cell} value={z.name} maxLength={60} aria-label="구역 이름" onChange={(e) => update(z.id, { name: e.target.value })} />
                        </td>
                        <td className="py-1.5 pr-2 w-20">
                          <select
                            value={z.team}
                            onChange={(e) => update(z.id, { team: e.target.value })}
                            aria-label="맡는 팀"
                            className="h-8 w-full rounded-md border border-input bg-card px-1 text-sm"
                          >
                            {teams.map((t) => (
                              <option key={t} value={t}>
                                {t}팀
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2 w-24">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">B</span>
                            <NumInput className="w-14" min={1} max={10} value={z.basementFloors} aria-label="지하 몇 층까지" onValue={(v) => update(z.id, { basementFloors: v ?? z.basementFloors })} />
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
                                    onClick={() => toggleBuilding(z, b.buildingNo)}
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
                        <td className="py-1.5 pr-2 w-36">
                          <input className={cell} value={z.memo} maxLength={200} placeholder="예: 램프·전기실 포함" aria-label="메모" onChange={(e) => update(z.id, { memo: e.target.value })} />
                        </td>
                        <td className="py-1.5 pr-1 text-right">
                          <Button variant="ghost" size="icon-sm" title={`${z.name} 삭제`} aria-label={`${z.name} 삭제`} onClick={() => remove(z.id)}>
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
        })}
      </div>
    </div>
  );
}
