/**
 * CadStatusBar — AutoCAD 하단 상태바 대응.
 *
 * 좌: 문서(모형/배치) 탭 → 평면도 · PLAN / 전개 입면 · ELEVATION
 * 중: 명령행 힌트 — 현재 모드에서 무엇을 클릭해야 하는지 (AutoCAD 명령행 자리)
 * 우: 축척 · 입면/오프닝 수 · 층고 등 상태 표시
 */
import { Layers, LayoutGrid, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CadStatusBarProps {
  canvasTab: "plan" | "elev";
  onCanvasTab: (t: "plan" | "elev") => void;
  wallCount: number;
  openingCount: number;
  /** 현재 모드 안내문 (명령행 자리) */
  hint: string;
  /** 평면 표시 배율 */
  scale: number;
  floorHeight: number;
}

export default function CadStatusBar({
  canvasTab,
  onCanvasTab,
  wallCount,
  openingCount,
  hint,
  scale,
  floorHeight,
}: CadStatusBarProps) {
  return (
    <div className="flex h-[30px] shrink-0 items-stretch border-t border-[#c9d2dc] bg-[#e8edf3] text-[11px]">
      {/* 문서 탭 — AutoCAD 의 모형/배치1/배치2 자리 */}
      <div className="flex items-stretch">
        <StatusTab
          active={canvasTab === "plan"}
          onClick={() => onCanvasTab("plan")}
          icon={LayoutGrid}
          label="평면도 · PLAN"
        />
        <StatusTab
          active={canvasTab === "elev"}
          onClick={() => onCanvasTab("elev")}
          icon={Layers}
          label="전개 입면 · ELEVATION"
          badge={wallCount > 0 ? wallCount : undefined}
        />
      </div>

      {/* 명령행 힌트 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-[#c9d2dc] px-3 text-slate-500">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{hint}</span>
      </div>

      {/* 상태 표시 */}
      <div className="flex items-center gap-0 text-slate-500">
        <Stat label="입면" value={`${wallCount}`} />
        <Stat label="오프닝" value={`${openingCount}`} />
        <Stat label="층고" value={`${floorHeight.toLocaleString()}mm`} />
        <Stat label="축척" value={`1:${(1 / Math.max(scale, 1e-6)).toFixed(0)}`} />
      </div>
    </div>
  );
}

function StatusTab({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-r border-[#c9d2dc] px-3 font-medium transition-colors",
        active
          ? "bg-[#f3f6f9] text-[#0a4a86] shadow-[inset_0_2px_0_0_#0a63b8]"
          : "text-slate-500 hover:bg-white/70"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {badge != null && (
        <span className="rounded-full bg-[#0a63b8]/12 px-1.5 text-[10px] font-bold tabular-nums text-[#0a4a86]">
          {badge}
        </span>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 border-l border-[#c9d2dc] px-3">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold tabular-nums text-slate-600">{value}</span>
    </span>
  );
}
