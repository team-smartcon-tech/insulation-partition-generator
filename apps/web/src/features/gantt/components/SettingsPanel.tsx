/**
 * 설정 탭 — 현장 설정(§5) + 동 목록·규모 저장. 저장 전에는 바뀐 표시, 저장하면 공정표가 다시 계산된다.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_SITE_SETTINGS, FINISH_TRADES, type SiteSettings } from "@ipg/gantt-engine";
import { Button } from "@/components/ui/button";
import type { Building } from "../api";
import { useSaveBuildings, useSaveSettings, useSettings } from "../hooks";
import BuildingsEditor from "./BuildingsEditor";
import ZonesEditor from "./ZonesEditor";
import FinishPlanForm from "./FinishPlanForm";
import SettingsForm from "./SettingsForm";

export default function SettingsPanel({ siteId, siteName }: { siteId: string | null; siteName: string }) {
  const q = useSettings(siteId);
  const saveS = useSaveSettings(siteId);
  const saveB = useSaveBuildings(siteId);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [dirty, setDirty] = useState(false);

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
        <Button className="shrink-0" onClick={onSave} disabled={saveS.isPending || saveB.isPending || q.isPending}>
          {saveS.isPending || saveB.isPending ? "저장 중…" : "저장"}
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-4">
          <SettingsForm
            value={settings}
            onChange={(next) => {
              setSettings(next);
              setDirty(true);
            }}
          />
          <FinishPlanForm
            trades={FINISH_TRADES}
            value={settings.finish}
            onChange={(finish) => {
              setSettings({ ...settings, finish });
              setDirty(true);
            }}
          />
        </div>
        <div className="min-w-0 space-y-4">
          <BuildingsEditor
            siteId={siteId}
            value={buildings}
            onChange={(next) => {
              setBuildings(next);
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
      </div>
    </div>
  );
}
