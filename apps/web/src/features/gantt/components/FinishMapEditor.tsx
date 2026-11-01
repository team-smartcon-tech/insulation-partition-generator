/**
 * 스마트웍스 공종 연결 (2026-10-31) — 마감 예정 규칙의 공종마다 이 현장 스마트웍스 마감 공종 중 어느 것을 연결할지.
 * 스마트웍스는 현장마다 공종을 자유롭게 만들어(1차 「기본 욕실벽」, 2차 「타일공사」) 이름 규칙만으로는 맞추기 어렵다.
 * 값은 현장 설정 settings.finishMap(스마트웍스 공종 id → 공종 키, null = 제외). 고르지 않은 공종은 이름 규칙(finishTradeOf)으로 자동.
 * 여러 공종을 한 공종에 묶으면 세대 완료 = 그 세대에서 묶인 공종이 모두 끝난 날. 연결이 없는 공종은 마감 공정표에 예정만 나온다.
 * 2026-11-01: 행 = 마감 공종(마감 예정 규칙과 같은 순서), 칸 = 연결할 스마트웍스 공종 (사용자 요청으로 뒤집음)
 */
import { useMemo } from "react";
import { FINISH_TRADES, finishTradeOf, finishTradeOfType } from "@ipg/gantt-engine";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFinish } from "../hooks";

type Trade = { key: string; label: string };
const labelOf = (key: string | null) => (key ? (FINISH_TRADES.find((t) => t.key === key)?.label ?? key) : "제외");

export default function FinishMapEditor({
  siteId,
  value,
  onChange,
  trades = FINISH_TRADES,
}: {
  siteId: string | null;
  value: Record<string, string | null> | undefined;
  onChange: (next: Record<string, string | null>) => void;
  /** 행 — 마감 예정 규칙과 같은 공종 목록 */
  trades?: readonly Trade[];
}) {
  const q = useFinish(siteId);
  const types = q.data?.types ?? [];
  const map = value ?? {};

  // 공종 키 → 연결된 스마트웍스 공종 (자동 여부 포함)
  const linked = useMemo(() => {
    const m = new Map<string, { id: string; name: string; auto: boolean }[]>();
    for (const t of types) {
      const k = finishTradeOfType(map, t);
      if (k) m.set(k, [...(m.get(k) ?? []), { id: t.id, name: t.name, auto: !(t.id in map) }]);
    }
    return m;
  }, [types, map]);
  const unlinked = types.filter((t) => !finishTradeOfType(map, t));

  const link = (typeId: string, tradeKey: string) => {
    const next = { ...map };
    const t = types.find((x) => x.id === typeId);
    // 이름 규칙 추천과 같으면 「자동」 으로 둔다
    if (t && finishTradeOf(t.name) === tradeKey) delete next[typeId];
    else next[typeId] = tradeKey;
    onChange(next);
  };
  const unlink = (typeId: string) => onChange({ ...map, [typeId]: null });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">스마트웍스 공종 연결</h4>
        {Object.keys(map).length ? (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            title="직접 고른 연결을 모두 지우고 이름 추천(자동)으로"
          >
            자동 추천으로 되돌리기
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        마감 공종마다 실적을 가져올 이 현장 스마트웍스 공종을 고릅니다. 점선 칸은 이름으로 자동 추천한 것입니다. 여러 공종을 묶으면 세대 완료는 묶인 공종이 모두 끝난
        날입니다. 연결이 없는 공종은 실적 없이 예정만 나옵니다.
      </p>

      {!siteId ? (
        <p className="text-xs text-muted-foreground">현장을 고르세요.</p>
      ) : q.isPending ? (
        <p className="text-xs text-muted-foreground">스마트웍스 공종을 불러오는 중…</p>
      ) : q.isError ? (
        <p className="text-xs text-red-600">{(q.error as Error).message}</p>
      ) : !types.length ? (
        <p className="text-xs text-muted-foreground">이 현장 스마트웍스 마감 공종이 없습니다. 설정 탭 동 목록이 저장돼 있어야 불러옵니다.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {trades.map((tr) => {
              const items = linked.get(tr.key) ?? [];
              const options = types.filter((t) => finishTradeOfType(map, t) !== tr.key);
              return (
                <div key={tr.key} className="flex items-start gap-2 rounded-md border border-border/70 px-2 py-1.5">
                  <span className="w-24 shrink-0 pt-1 text-sm font-medium">{tr.label}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {items.length ? (
                      items.map((it) => (
                        <span
                          key={it.id}
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded-md border py-0.5 pl-1.5 pr-0.5 text-xs",
                            it.auto ? "border-dashed border-border text-muted-foreground" : "border-primary/50 bg-primary/5 text-primary",
                          )}
                          title={it.auto ? "이름으로 자동 추천" : "직접 연결"}
                        >
                          {it.name}
                          <button
                            type="button"
                            onClick={() => unlink(it.id)}
                            aria-label={`${it.name} 연결 해제`}
                            className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-amber-700">연결 없음 (예정만)</span>
                    )}
                    <select
                      value=""
                      onChange={(e) => e.target.value && link(e.target.value, tr.key)}
                      aria-label={`${tr.label}에 스마트웍스 공종 추가`}
                      className="h-6 w-[7.5rem] rounded-md border border-input bg-card px-1 text-xs text-muted-foreground"
                    >
                      <option value="">+ 공종 추가</option>
                      {options.map((t) => {
                        const cur = finishTradeOfType(map, t);
                        return (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {cur ? ` (← ${labelOf(cur)})` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">연결 안 된 스마트웍스 공종 ({unlinked.length}/{types.length})</span>
            {unlinked.length ? ` — ${unlinked.map((t) => t.name).join(", ")}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
