/**
 * CadStatusBar — 하단 상태바(계측기 표시창).
 *
 * 좌: 문서 탭 → 평면도 · PLAN / 전개 입면 · ELEVATION
 * 중: 명령행 힌트 — 현재 모드에서 무엇을 클릭해야 하는지
 * 우: 입면·오프닝 수, 층고, 축척
 *
 * 디자인: 타이틀바·좌측 레일과 같은 다크 크롬. 캔버스를 위아래로 감싸 "장비의 몸체"가
 * 되고, 밝은 인스퍼터만 그 위에 종이처럼 떠 있게 한다. 수치는 전부 tabular-nums.
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
    <div
      className="flex h-[30px] shrink-0 items-stretch text-[11.5px]"
      style={{ background: "var(--ipg-rail)", borderTop: "1px solid rgba(255,255,255,.08)" }}
    >
      {/* 문서 탭 */}
      <div className="flex items-stretch">
        <StatusTab
          active={canvasTab === "plan"}
          onClick={() => onCanvasTab("plan")}
          icon={LayoutGrid}
          label="평면도"
          sub="PLAN"
        />
        <StatusTab
          active={canvasTab === "elev"}
          onClick={() => onCanvasTab("elev")}
          icon={Layers}
          label="전개 입면"
          sub="ELEVATION"
          badge={wallCount > 0 ? wallCount : undefined}
        />
      </div>

      {/* 명령행 힌트 — 지금 뭘 하면 되는지 한 줄 */}
      <div
        className="flex min-w-0 flex-1 items-center gap-2 px-3 text-white/55"
        style={{ borderLeft: "1px solid rgba(255,255,255,.08)" }}
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-white/30" />
        <span className="truncate">{hint}</span>
      </div>

      {/* 계측 표시 */}
      <div className="flex items-center">
        <Stat label="입면" value={String(wallCount)} />
        <Stat label="오프닝" value={String(openingCount)} />
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
  sub,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
  sub: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} · ${sub}`}
      className={cn(
        "relative flex items-center gap-1.5 px-3.5 font-semibold transition-colors",
        active ? "text-white" : "text-white/45 hover:text-white/80"
      )}
      style={{
        background: active ? "rgba(255,255,255,.07)" : undefined,
        borderRight: "1px solid rgba(255,255,255,.08)",
      }}
    >
      {active && (
        <span
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: "var(--ipg-accent)" }}
        />
      )}
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="text-[9.5px] font-bold tracking-[0.14em] text-white/25">{sub}</span>
      {badge != null && (
        <span
          className="ipg-num rounded-full px-1.5 text-[10px] font-bold"
          style={{ background: "rgba(26,126,224,.28)", color: "#8ecbff" }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="flex items-center gap-1.5 px-3"
      style={{ borderLeft: "1px solid rgba(255,255,255,.08)" }}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
        {label}
      </span>
      <span className="ipg-num font-bold text-white/85">{value}</span>
    </span>
  );
}
