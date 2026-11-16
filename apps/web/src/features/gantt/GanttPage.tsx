/**
 * 스마트 공정표 — /tools/gantt
 *
 * 스마트웍스 작업일보를 읽어 골조 공정을 동·층·단계로 해석하고(작업일보 탭), 실적 기준으로 앞으로의
 * 공정을 반일 단위로 계산해 간트로 보여준다(공정표 탭). 3D 골조 탭은 같은 실적을 동·층 블록으로 쌓아 보여 준다.
 * 택트 인원 탭은 마감 공종 구간별 적정 인원·전체 마감 기간(takt/TaktPanel).
 * 현장 규모·설정은 설정 탭에서 저장한다.
 * 현장은 상단에서 고르고 브라우저에 기억한다. 규칙의 1차 소스는 docs/gantt/설계.md.
 */
import { useEffect, useMemo, useState } from "react";
import { Box, CalendarRange, PaintRoller, ClipboardList, Settings2, Users } from "lucide-react";
import ToolShell from "@/features/tcRental/components/ToolShell";
import { cn } from "@/lib/utils";
import { useSites } from "./hooks";
import DailyReportPanel from "./components/DailyReportPanel";
import SitePicker from "./components/SitePicker";
import SchedulePanel from "./components/SchedulePanel";
import FinishPanel from "./components/FinishPanel";
import TaktPanel from "./takt/TaktPanel";
import Frame3DPanel from "./components/Frame3DPanel";
import SettingsPanel from "./components/SettingsPanel";

type Tab = "reports" | "schedule" | "frame3d" | "finish" | "takt" | "settings";
// hidden = 탭 줄에서 숨김 (코드는 그대로 둔다)
const TABS: { id: Tab; label: string; icon: typeof ClipboardList; hidden?: boolean }[] = [
  { id: "reports", label: "작업일보", icon: ClipboardList },
  { id: "schedule", label: "골조 공정표", icon: CalendarRange },
  { id: "frame3d", label: "3D 골조", icon: Box, hidden: true }, // 2026-11-04 사용자: 「3D골조 탭은 일단 숨겨줘」
  { id: "finish", label: "마감 공정표", icon: PaintRoller },
  { id: "takt", label: "택트 인원", icon: Users },
  { id: "settings", label: "설정", icon: Settings2 },
];
const SITE_KEY = "gantt.siteId";

export default function GanttPage() {
  const sites = useSites();
  const [tabActions, setTabActions] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [siteId, setSiteId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SITE_KEY);
    } catch {
      return null;
    }
  });

  // 저장된 현장이 목록에 없으면(권한·삭제) 최근 일보가 있는 첫 현장으로
  useEffect(() => {
    if (!sites.data) return;
    const list = sites.data.sites;
    // 소속 현장이 하나도 없으면 다른 계정이 남긴 현장 id 로 조회하지 않게 비운다 (2026-11-05 소속 현장만)
    if (!list.length) {
      if (siteId) setSiteId(null);
      return;
    }
    if (!siteId || !list.some((s) => s.id === siteId)) setSiteId(list[0].id);
  }, [sites.data, siteId]);
  useEffect(() => {
    try {
      if (siteId) localStorage.setItem(SITE_KEY, siteId);
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
  }, [siteId]);

  const site = useMemo(() => sites.data?.sites.find((s) => s.id === siteId) ?? null, [sites.data, siteId]);

  return (
    <ToolShell
      title="스마트 공정표"
      subtitle={<span className="text-[12px] text-slate-400">작업일보 기반 골조 공정 자동 재산정</span>}
      actions={
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] font-semibold tracking-widest text-slate-400 sm:block">PROJECT</span>
          <SitePicker
            sites={sites.data?.sites ?? []}
            value={siteId}
            onChange={(id) => setSiteId(id)}
            loading={sites.isPending}
            error={sites.isError}
          />
        </div>
      }
    >
      <div className="px-6 py-4 lg:px-8">
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {TABS.filter((t) => !t.hidden).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
          {/* 탭 줄 오른쪽: 탭 화면이 버튼을 끼워 넣는 자리 (공정표 탭의 엑셀·인쇄) */}
          <div ref={setTabActions} className="ml-auto flex items-center gap-1 pb-1" />
        </div>

        {sites.isError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{(sites.error as Error).message}</div>
        ) : sites.data && !sites.data.sites.length ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            볼 수 있는 현장이 없습니다. 스마트웍스에서 소속 현장이 지정돼 있는지 확인해 주세요.
          </div>
        ) : tab === "reports" ? (
          <DailyReportPanel key={siteId ?? ""} siteId={siteId} siteName={site?.name ?? ""} initialDate={site?.lastReportDate ?? null} />
        ) : tab === "schedule" ? (
          <SchedulePanel siteId={siteId} siteName={site?.name ?? ""} actionsSlot={tabActions} />
        ) : tab === "frame3d" ? (
          <Frame3DPanel key={siteId ?? ""} siteId={siteId} siteName={site?.name ?? ""} onBack={() => setTab("schedule")} />
        ) : tab === "takt" ? (
          <TaktPanel key={siteId ?? ""} siteId={siteId} siteName={site?.name ?? ""} actionsSlot={tabActions} />
        ) : tab === "finish" ? (
          <FinishPanel siteId={siteId} siteName={site?.name ?? ""} actionsSlot={tabActions} onGoSettings={() => setTab("settings")} />
        ) : (
          <SettingsPanel siteId={siteId} siteName={site?.name ?? ""} />
        )}
      </div>
    </ToolShell>
  );
}
