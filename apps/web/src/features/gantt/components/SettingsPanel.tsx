/**
 * 설정 탭 — 현장 설정(§5) + 동 목록·규모 저장. 저장 전에는 바뀐 표시, 저장하면 공정표가 다시 계산된다.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_SITE_SETTINGS, FINISH_TRADES, type SiteSettings } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";
import { useSaveBuildings, useSaveSettings, useSaveTakt, useSettings, useTaktLink } from "../hooks";
import BuildingsEditor from "./BuildingsEditor";
import ZonesEditor from "./ZonesEditor";
import FinishPlanForm from "./FinishPlanForm";
import FinishMapEditor from "./FinishMapEditor";
import SettingsForm from "./SettingsForm";

export default function SettingsPanel({ siteId, siteName }: { siteId: string | null; siteName: string }) {
  const q = useSettings(siteId);
  const saveS = useSaveSettings(siteId);
  const saveB = useSaveBuildings(siteId);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [dirty, setDirty] = useState(false);
  // 마감 예정 규칙의 인원 = 택트 투입 인원 (2026-10-31). 여기서 바꾼 인원은 「저장」 때 택트 입력에도 저장한다 — 택트 공종명 → 명
  const saveT = useSaveTakt(siteId);
  const [crewEdits, setCrewEdits] = useState<Record<string, number>>({});
  const taktLink = useTaktLink(siteId, crewEdits);
  useEffect(() => setCrewEdits({}), [siteId]);

  useEffect(() => {
    if (q.data) {
      setSettings(q.data.settings);
      setBuildings(q.data.buildings);
      setDirty(false);
    }
  }, [q.data]);

  const onSave = async () => {
    if (!siteId) return;
    const bad = buildings.find((b) => !b.name.trim() || b.coreTopFloors.some((f) => f < b.baseFloor));
    if (bad) {
      toast.error(`${bad.buildingNo}동: 이름이 비었거나 최상층이 기준층 시작보다 낮은 코어가 있습니다.`);
      return;
    }
    if ((settings.zones ?? []).some((z) => !z.name.trim())) {
      toast.error("지하층 구역: 이름이 빈 구역이 있습니다.");
      return;
    }
        const nos = buildings.map((b) => b.buildingNo);
    if (new Set(nos).size !== nos.length) {
      toast.error("동 번호가 중복됩니다. 코어별 층이 다르면 한 줄에서 코어를 추가하세요.");
      return;
    }
    try {
      await saveS.mutateAsync(settings);
      await saveB.mutateAsync(buildings);
      if (Object.keys(crewEdits).length) {
        const { input, saved } = taktLink;
        await saveT.mutateAsync({
          ...input,
          trades: input.trades.map((t) => ({ ...t, crew: t.crew ?? null, mode: t.mode ?? "rate", fixedDays: t.fixedDays ?? null })),
          frameZoneDays: saved?.frameZoneDays ?? null,
        });
        setCrewEdits({});
      }
      setDirty(false);
      toast.success("현장 설정을 저장했습니다. 공정표가 다시 계산됩니다.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!siteId) return <p className="text-sm text-muted-foreground">현장을 먼저 고르세요.</p>;
  if (q.isError) return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(q.error as Error).message}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <b className="text-foreground">{siteName}</b> 현장의 공정 설정과 동별 규모.{" "}
          {q.data?.saved ? `마지막 저장 ${q.data.updatedAt?.slice(0, 16).replace("T", " ") ?? ""} ${q.data.updatedBy ?? ""}` : "아직 저장된 설정이 없어 기본값을 보여줍니다."}
          {dirty ? <span className="ml-2 font-medium text-amber-700">· 저장 안 됨</span> : null}
        </p>
        <Button className="shrink-0" onClick={onSave} disabled={saveS.isPending || saveB.isPending || saveT.isPending || q.isPending}>
          {saveS.isPending || saveB.isPending || saveT.isPending ? "저장 중…" : "저장"}
        </Button>
      </div>
      {/* 단계별 설정 (2026-11-01): 공통 동 목록 → 지하층·저층부(같은 팀) → 기준층 → 마감공정. 단계마다 작업일·자원이 따로다 */}
      <Stage n="공통" title="동 목록·규모">
        <BuildingsEditor
          siteId={siteId}
          value={buildings}
          onChange={(next) => {
            setBuildings(next);
            setDirty(true);
          }}
          gangformFloors={settings.gangformFloors}
          onGangform={(no, floor) => {
            // 함수형 갱신 — 일괄 적용이 동마다 연달아 부른다
            setSettings((cur) => {
              const next = { ...(cur.gangformFloors ?? {}) };
              if (floor == null) delete next[String(no)];
              else next[String(no)] = floor;
              return { ...cur, gangformFloors: next };
            });
            setDirty(true);
          }}
        />
      </Stage>
      <Stage n="1·2" title="지하층 · 저층부" hint="재래식 거푸집. 지하층과 저층부는 같은 팀(형틀·철근)을 이어서 쓰고, 기준층 자원과는 따로입니다.">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <SettingsForm
            part="underground"
            value={settings}
            onChange={(next) => {
              setSettings(next);
              setDirty(true);
            }}
          />
          <ZonesEditor
            zones={settings.zones ?? []}
            formTeams={settings.formTeams}
            buildings={buildings}
            onChange={(zones, formTeams) => {
              setSettings({ ...settings, zones, formTeams });
              setDirty(true);
            }}
          />
        </div>
      </Stage>
      <Stage n="3" title="기준층" hint="갱폼·알폼 사이클. 자원 용량은 기준층에만 쓰입니다.">
        <div className="max-w-xl">
          <SettingsForm
            part="base"
            value={settings}
            onChange={(next) => {
              setSettings(next);
              setDirty(true);
            }}
          />
        </div>
      </Stage>
      <Stage n="4" title="마감공정" hint="공종 14개. 인원은 택트 인원 탭과 연동, 스마트웍스 공종은 아래 연결표로 맞춥니다.">
        <div className="grid gap-4 xl:grid-cols-2">
          <FinishPlanForm
            trades={FINISH_TRADES}
            value={settings.finish}
            onChange={(finish) => {
              setSettings({ ...settings, finish });
              setDirty(true);
            }}
            links={taktLink.links}
            onCrew={(key, crew) => {
              const name = taktLink.links.get(key as never)?.name;
              if (!name) return;
              setCrewEdits((e) => ({ ...e, [name]: crew }));
              setDirty(true);
            }}
          />
          <FinishMapEditor
            siteId={siteId}
            trades={FINISH_TRADES}
            value={settings.finishMap}
            onChange={(finishMap) => {
              setSettings({ ...settings, finishMap });
              setDirty(true);
            }}
          />
        </div>
      </Stage>
    </div>
  );
}

/** 설정 단계 묶음 — 번호·제목·설명 + 그 단계 카드들 */
function Stage({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 border-b border-border pb-1">
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">{n}</span>
        <h3 className="text-base font-semibold">{title}</h3>
        {hint ? <p className="min-w-0 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

