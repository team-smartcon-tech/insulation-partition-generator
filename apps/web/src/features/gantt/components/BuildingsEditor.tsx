/**
 * 동 목록·규모 편집 — 동 번호, 이름, 기준층 시작 층, 코어(최상층·옥탑 층수), (일보 없을 때) 현재 층.
 * 같은 동이라도 코어마다 최상층·옥탑이 다를 수 있어, 동 한 줄 안에 코어를 세로로 쌓는다(동을 두 줄로 넣지 않는다).
 * 동의 최상층 = 코어 중 가장 높은 층. 최상층이 있어야 11월 이후 계획이 맞는다(최상층 타설 뒤 사이클에서 빠짐).
 */
import { useState } from "react";
import { Download, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listSmartworksBuildings, type Building } from "../api";
import { NumInput, StepInput } from "./StepInput";

const MAX_CORES = 8;

/** 이름 안의 첫 숫자를 d 만큼 올리고 내린다 ("401동" → "402동"). 숫자가 없으면 그대로 */
const stepName = (name: string, d: number) => name.replace(/\d+/, (m) => String(Math.max(0, Number(m) + d)).padStart(m.length, "0"));

/** 코어 칸 너비: 코어 | 세대 | 최상층 | 옥탑 | 삭제·코어 추가 — 헤더와 코어 줄이 같이 쓴다 */
// 입력란 너비(2026-10-30 사용자 지정): 동번호 60 · 이름 80 · 지하 50 · 기준층 시작 50 · 세대 50 · 최상층 60 · 옥탑 50 · 현재 층 100px.
// 입력란 사이 간격은 모두 12px(열 오른쪽 여백 pr-3 기준) — 열 너비 = 입력란 + 12px, 코어 묶음은 칸 = 입력란, 간격 12px(gap-x-3)
const CORE_GRID = "grid grid-cols-[2.75rem_50px_60px_50px_auto] items-center gap-x-3";

/** units = 그 코어가 한 층에서 맡는 세대 수 (0 = 모름) */
type Core = { top: number; rooftop: number; units?: number };
const coresOf = (b: Building): Core[] =>
  b.coreTopFloors.map((top, k) => ({ top, rooftop: b.coreRooftopFloors[k] ?? 0, units: b.coreUnits?.[k] ?? 0 }));
/** 코어 목록 → 동 필드 (코어 수·동 최상층·옥탑 여부를 같이 맞춘다) */
const fromCores = (cores: Core[]): Partial<Building> => ({
  coreTopFloors: cores.map((c) => c.top),
  coreRooftopFloors: cores.map((c) => c.rooftop),
  coreUnits: cores.map((c) => c.units ?? 0),
  cores: cores.length,
  topFloor: Math.max(...cores.map((c) => c.top)),
  hasRooftop: cores.some((c) => c.rooftop > 0),
});

/** 이름 속 옛 동 번호를 새 번호로 ("401동(A)" → "402동(A)"). 이름에 옛 번호가 없으면 그대로 */
const renumber = (name: string, from: number, to: number) => {
  const re = new RegExp(`(^|[^0-9])${from}(?![0-9])`);
  return re.test(name) ? name.replace(re, `$1${to}`) : name;
};

/** 일괄 적용 한 칸: 이름 · 숫자 · 「적용」 */
function BulkField({
  label,
  hint,
  min,
  max,
  value,
  onValue,
  onApply,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onValue: (v: number) => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5" title={hint}>
      <span className="whitespace-nowrap">{label}</span>
      <NumInput className="w-[50px]" min={min} max={max} value={value} aria-label={`${label} 일괄`} onValue={(v) => onValue(v ?? min)} />
      <span>층</span>
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onApply}>
        적용
      </Button>
    </div>
  );
}

export default function BuildingsEditor({ value, onChange, siteId = null }: { value: Building[]; onChange: (next: Building[]) => void; siteId?: string | null }) {
  // 스마트웍스에서 불러오기: 동·코어별 최상층을 채운다. 지하·기준층 시작·옥탑·이름은 있는 동은 그대로, 새 동은 마지막 동 값 복사.
  // 스마트웍스에 없는 동은 지우지 않는다. 화면에만 채우고 저장은 「저장」 버튼으로.
  const [importing, setImporting] = useState(false);
  // 일괄 적용 (지하·기준층 시작·옥탑): 모든 동(옥탑은 모든 코어)에 한 번에. 동별·코어별로 다시 고칠 수 있다
  const [bulkBasement, setBulkBasement] = useState<number>(() => value.at(-1)?.basementFloors ?? 0);
  const [bulkBase, setBulkBase] = useState<number>(() => value.at(-1)?.baseFloor ?? 3);
  const applyBulkBasement = () => {
    if (!value.length) return;
    onChange(value.map((b) => ({ ...b, basementFloors: bulkBasement })));
    toast.success(`모든 동의 지하를 ${bulkBasement}층으로 바꿨습니다. 「저장」을 눌러야 반영됩니다.`);
  };
  const applyBulkBase = () => {
    if (!value.length) return;
    onChange(value.map((b) => ({ ...b, baseFloor: bulkBase })));
    toast.success(`모든 동의 기준층 시작을 ${bulkBase}층으로 바꿨습니다. 「저장」을 눌러야 반영됩니다.`);
  };
  const [bulkRoof, setBulkRoof] = useState<number>(() => value.at(-1)?.coreRooftopFloors[0] ?? 1);
  const applyBulkRoof = () => {
    if (!value.length) return;
    onChange(value.map((b) => ({ ...b, ...fromCores(coresOf(b).map((c) => ({ ...c, rooftop: bulkRoof }))) })));
    toast.success(`모든 동·코어의 옥탑을 ${bulkRoof}층으로 바꿨습니다. 「저장」을 눌러야 반영됩니다.`);
  };
  const importFromSmartworks = async () => {
    if (!siteId) return;
    setImporting(true);
    try {
      const { buildings: sw } = await listSmartworksBuildings(siteId);
      if (!sw.length) {
        toast.info("스마트웍스 동/라인 설정에 이 현장 동 정보가 없습니다.");
        return;
      }
      const template = value.at(-1);
      let added = 0;
      let updated = 0;
      const merged: Building[] = value.map((b) => {
        const s = sw.find((x) => x.buildingNo === b.buildingNo);
        if (!s) return b;
        updated++;
        const roofs = b.coreRooftopFloors.length === s.coreTopFloors.length ? b.coreRooftopFloors : s.coreTopFloors.map(() => Math.max(0, ...b.coreRooftopFloors));
        return { ...b, ...fromCores(s.coreTopFloors.map((top, k) => ({ top, rooftop: roofs[k] ?? 0, units: s.coreUnits[k] ?? 0 }))) };
      });
      for (const s of sw) {
        if (merged.some((b) => b.buildingNo === s.buildingNo)) continue;
        added++;
        const rooftop = template ? Math.max(0, ...template.coreRooftopFloors) : 1;
        merged.push({
          buildingNo: s.buildingNo,
          name: s.name,
          baseFloor: template?.baseFloor ?? 3,
          basementFloors: template?.basementFloors ?? 0,
          currentFloor: null,
          ...fromCores(s.coreTopFloors.map((top, k) => ({ top, rooftop, units: s.coreUnits[k] ?? 0 }))),
        } as Building);
      }
      merged.sort((a, b) => a.buildingNo - b.buildingNo);
      onChange(merged);
      const kept = value.filter((b) => !sw.some((x) => x.buildingNo === b.buildingNo)).length;
      toast.success(
        `스마트웍스에서 ${sw.length}개 동을 불러왔습니다 (새 동 ${added}, 최상층 갱신 ${updated}${kept ? `, 스마트웍스에 없는 동 ${kept}개는 그대로` : ""}). 「저장」을 눌러야 반영됩니다.`,
      );
    } catch (e) {
      toast.error(`스마트웍스 불러오기 실패: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };
  const update = (i: number, patch: Partial<Building>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    // 비어 있으면 101동부터 (예전 401 은 남원주 1차 기준값이었다), 아니면 마지막 동 + 1.
    // 「코어 추가」 처럼 마지막 동의 지하·기준층 시작·코어별 최상층·옥탑을 그대로 가져온다. 현재 층은 동마다 달라 비운다.
    const last = value.at(-1);
    const next = (last?.buildingNo ?? 100) + 1;
    const name = last ? renumber(last.name, last.buildingNo, next) : `${next}동`;
    onChange([
      ...value,
      last
        ? { ...last, buildingNo: next, name: name === last.name ? `${next}동` : name, currentFloor: null, coreTopFloors: [...last.coreTopFloors], coreRooftopFloors: [...last.coreRooftopFloors] }
        : ({ buildingNo: next, name, baseFloor: 3, currentFloor: null, basementFloors: 0, ...fromCores([{ top: 30, rooftop: 1 }]) } as Building),
    ]);
  };
  /** 동 번호를 바꾸면 이름 속 같은 번호도 바꾼다 ("401동" → "101동", "401동(A)" → "101동(A)"). 이름에 옛 번호가 없으면 그대로 */
  const setNo = (i: number, no: number) => {
    const b = value[i];
    update(i, { buildingNo: no, name: renumber(b.name, b.buildingNo, no) });
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {siteId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={importFromSmartworks}
              disabled={importing}
              title="스마트웍스 옵션마감 「동/라인 설정」 에서 동 목록·코어별 최상층 가져오기 (지하·기준층 시작·옥탑은 그대로)"
            >
              <Download /> {importing ? "불러오는 중…" : "스마트웍스에서 불러오기"}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={add}>
            <Plus /> 동 추가
          </Button>
        </div>
      </div>
      {value.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">일괄 적용</span>
          <BulkField label="지하" hint="모든 동의 지하층 수 (0 = 없음)" min={0} max={10} value={bulkBasement} onValue={setBulkBasement} onApply={applyBulkBasement} />
          <BulkField label="기준층 시작" hint="모든 동의 기준층 시작 층" min={1} max={80} value={bulkBase} onValue={setBulkBase} onApply={applyBulkBase} />
          <BulkField label="옥탑" hint="모든 동·코어의 옥탑 층수 (0 = 없음)" min={0} max={10} value={bulkRoof} onValue={setBulkRoof} onApply={applyBulkRoof} />
        </div>
      ) : null}
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">아직 동이 없습니다. "동 추가"로 시작하세요.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-center text-xs text-muted-foreground">
              <th className="pb-1 pr-3 whitespace-nowrap">동 번호</th>
              <th className="pb-1 pr-3 whitespace-nowrap">이름</th>
              <th className="pb-1 pr-3 whitespace-nowrap" title="지하 맨 아래층 (B3 까지면 3). 일보 없는 동의 지하 출발 층">지하</th>
              <th className="pb-1 pr-3 whitespace-nowrap">기준층 시작</th>
              <th className="pb-1 pr-3 font-normal">
                {/* 코어 줄과 같은 칸 너비 — 헤더가 각 입력칸 바로 위에 온다 */}
                <div className={CORE_GRID}>
                  <span className="whitespace-nowrap text-center font-medium">코어</span>
                  <span className="whitespace-nowrap text-center font-medium">세대</span>
                  <span className="whitespace-nowrap text-center font-medium">최상층</span>
                  <span className="whitespace-nowrap text-center font-medium">옥탑</span>
                  <span />
                </div>
              </th>
              <th className="pb-1 pr-3 whitespace-nowrap">현재 층</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {value.map((b, i) => {
              const cores = coresOf(b);
              const multi = cores.length > 1;
              return (
                <tr key={i} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 w-[72px]">
                    <NumInput min={1} value={b.buildingNo} onValue={(v) => setNo(i, v ?? b.buildingNo)} aria-label="동 번호" />
                  </td>
                  <td className="py-1.5 pr-3 w-[92px]">
                    <StepInput
                      value={b.name}
                      aria-label="이름"
                      onChange={(e) => update(i, { name: e.target.value })}
                      onStep={(d) => update(i, { name: stepName(b.name, d) })}
                    />
                  </td>
                  <td className="py-1.5 pr-3 w-[62px]">
                    <NumInput min={0} max={10} value={b.basementFloors ?? 0} onValue={(v) => update(i, { basementFloors: v ?? 0 })} aria-label="지하층 수" />
                  </td>
                  <td className="py-1.5 pr-3 w-[62px]">
                    <NumInput min={1} value={b.baseFloor} onValue={(v) => update(i, { baseFloor: v ?? b.baseFloor })} aria-label="기준층 시작" />
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="space-y-1">
                      {cores.map((c, k) => {
                        const set = (patch: Partial<Core>) => setCores(i, cores.map((x, j) => (j === k ? { ...x, ...patch } : x)));
                        return (
                          <div key={k} className={`${CORE_GRID} whitespace-nowrap text-xs text-muted-foreground`}>
                            <span className="font-medium text-foreground">{k + 1}코어</span>
                            <NumInput
                              min={0}
                              max={10}
                              value={c.units ? c.units : null}
                              placeholder="–"
                              aria-label={`${b.name} ${k + 1}코어 세대수`}
                              onValue={(v) => set({ units: v ?? 0 })}
                            />
                            <NumInput min={1} max={80} value={c.top} aria-label={`${b.name} ${k + 1}코어 최상층`} onValue={(v) => set({ top: v ?? c.top })} />
                            <NumInput min={0} max={10} value={c.rooftop} aria-label={`${b.name} ${k + 1}코어 옥탑 층수`} onValue={(v) => set({ rooftop: v ?? c.rooftop })} />
                            <div className="flex items-center">
                            {/* 코어가 하나면 X 는 숨기되 자리는 남겨 "코어 추가" 위치를 맞춘다 */}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className={`text-muted-foreground hover:text-red-600 ${multi ? "" : "invisible"}`}
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
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 w-[112px]">
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
