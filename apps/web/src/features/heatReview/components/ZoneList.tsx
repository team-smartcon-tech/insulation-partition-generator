/**
 * 보양 구역 목록 — 종류(단위세대·코어·주차장)별로 묶어 저장된 구역을 카드로 보여준다.
 * 카드 한 장에 형상·면적·손실열량·적용 열원 대수·판정이 다 들어 있어, 목록만 봐도 검토가 끝난다.
 */
import { Building2, Copy, DoorOpen, ParkingSquare, Plus, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZONE_KIND_LABEL, zoneColor } from "../defaults";
import type { HeaterNeed, ZoneLoss } from "../engine/calc";
import { polygonBounds } from "../engine/geometry";
import type { PartView } from "./ZoneCanvas";
import type { Heater, Zone, ZoneKind } from "../types";
import { dec, int, Verdict } from "./ui";

const KIND_ICON: Record<ZoneKind, LucideIcon> = {
  unit: Building2,
  core: DoorOpen,
  parking: ParkingSquare,
};
const KIND_ORDER: ZoneKind[] = ["unit", "core", "parking"];

export default function ZoneList({
  zones,
  autoQty,
  frameParts,
  losses,
  needs,
  heaterOf,
  selectedId,
  onSelect,
  onAddManual,
  onDuplicate,
  onDelete,
  onToggleInclude,
  onIncludeAll,
}: {
  zones: Zone[];
  /** 동 외곽이 세어 준 타입·코어 개수 (zones 의 qty 에는 이미 반영돼 있다) */
  autoQty: Map<string, number>;
  /** 동 외곽 id → 안에서 찾은 세대·코어. 여기 있는 구역은 계산하지 않는 틀이다 */
  frameParts: Map<string, PartView[]>;
  losses: Map<string, ZoneLoss>;
  needs: Map<string, HeaterNeed>;
  /** 구역에 적용하는 열원 (종류별로 다를 수 있다) */
  heaterOf: (zone: Zone) => Heater;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddManual: (kind: ZoneKind) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** 이 구역을 계산(열원 비교·엑셀 보고서)에 넣을지 뒤집는다 */
  onToggleInclude: (id: string) => void;
  /** 전부 넣기 / 전부 빼기 */
  onIncludeAll: (on: boolean) => void;
}) {
  const includedCount = zones.filter((z) => !z.excluded || autoQty.has(z.id)).length;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_24px_-18px_rgba(15,42,74,0.25)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-[14px] font-bold tracking-tight text-slate-800">보양 구역</h3>
          <p className="text-[11.5px] text-slate-400">
            {zones.length > 0
              ? includedCount === zones.length
                ? `${zones.length}개 구역 · 자동 저장`
                : `${zones.length}개 중 ${includedCount}개만 계산`
              : "도면에 그리거나 치수로 추가"}
          </p>
        </div>
        {zones.length > 0 && (
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-semibold text-slate-500"
            title="체크한 구역만 열원 비교와 엑셀 보고서에 들어갑니다"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#0a63b8]"
              checked={includedCount === zones.length}
              ref={(el) => {
                if (el) el.indeterminate = includedCount > 0 && includedCount < zones.length;
              }}
              onChange={(e) => onIncludeAll(e.target.checked)}
            />
            전체
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {KIND_ORDER.map((kind) => {
          const list = zones.filter((z) => z.kind === kind);
          const Icon = KIND_ICON[kind];
          // 틀(세대를 인식한 동 외곽)은 안의 타입·코어가 대신 계산되므로 합계에서 뺀다
          const area = list.reduce((s, z) => s + (frameParts.has(z.id) ? 0 : z.geometry.area * z.qty), 0);
          return (
            <div key={kind}>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                  {ZONE_KIND_LABEL[kind]}
                  {list.length > 0 && (
                    <span className="font-medium text-slate-400">
                      {list.length} · {dec(area, 0)}㎡
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onAddManual(kind)}
                  title={`${ZONE_KIND_LABEL[kind]} 구역을 치수로 추가`}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-[#0a63b8] hover:bg-blue-50"
                >
                  <Plus className="h-3 w-3" />
                  치수로 추가
                </button>
              </div>

              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-[11.5px] text-slate-400">
                  아직 없습니다
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((z) => {
                    const loss = losses.get(z.id);
                    const need = needs.get(z.id);
                    const heater = heaterOf(z);
                    const selected = z.id === selectedId;
                    const color = zoneColor(z.color);
                    const parts = frameParts.get(z.id);
                    // 타입별 개수 — "84A ×2 · 59A ×2"
                    const partSummary = parts
                      ? Array.from(
                          parts.reduce((m, p) => m.set(p.name, (m.get(p.name) ?? 0) + 1), new Map<string, number>()),
                        )
                          .map(([name, n]) => `${name} ×${n}`)
                          .join(" · ")
                      : "";
                    return (
                      <li key={z.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelect(z.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") onSelect(z.id);
                          }}
                          className={cn(
                            "group relative flex cursor-pointer gap-3 overflow-hidden rounded-xl border p-2.5 pl-3.5 transition-all",
                            selected
                              ? "border-[#0a63b8]/50 bg-blue-50/60 shadow-sm ring-1 ring-[#0a63b8]/20"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
                            z.excluded && !autoQty.has(z.id) && "opacity-55",
                          )}
                        >
                          <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#0a63b8]"
                            // 동 외곽이 세어 주는 타입·코어는 따로 켜고 끄지 않는다 — 그 동 외곽의 체크를 따른다
                            checked={autoQty.has(z.id) ? true : !z.excluded}
                            disabled={autoQty.has(z.id)}
                            title={
                              autoQty.has(z.id)
                                ? "동 외곽이 세는 구역입니다 — 넣고 빼기는 동 외곽의 체크로 합니다"
                                : z.excluded
                                  ? "계산에서 뺀 구역 — 체크하면 열원 비교·엑셀 보고서에 들어갑니다"
                                  : "체크를 끄면 열원 비교·엑셀 보고서에서 빠집니다"
                            }
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleInclude(z.id)}
                          />
                          <ZoneThumb zone={z} color={color} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13.5px] font-bold text-slate-800">{z.name}</span>
                              {z.container && (
                                <span className="shrink-0 rounded bg-indigo-50 px-1 text-[10.5px] font-bold text-indigo-600 ring-1 ring-indigo-200">
                                  동 외곽
                                </span>
                              )}
                              {(z.qty > 1 || autoQty.has(z.id)) && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded px-1 text-[10.5px] font-bold",
                                    autoQty.has(z.id) ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500",
                                  )}
                                  title={autoQty.has(z.id) ? "동 외곽에서 자동으로 센 개수" : undefined}
                                >
                                  ×{z.qty}
                                  {autoQty.has(z.id) ? " 자동" : ""}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-500">
                              {dec(z.geometry.area, 1)}㎡ · 층고 {dec(z.height, 2)}m
                              <span className="ml-1 text-slate-300">
                                {z.geometry.source === "cad" ? "도면" : "치수"}
                              </span>
                            </div>
                            {parts ? (
                              <>
                                <div className="mt-1 text-[11.5px] font-semibold leading-snug text-indigo-600">
                                  {partSummary}
                                </div>
                                {/* 동 합계 — 안에 든 세대·코어의 손실열량·대수 합 */}
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className="text-[12px] font-bold tabular-nums text-slate-700">
                                    {int(parts.reduce((s, p) => s + p.loss, 0))}
                                    <span className="ml-0.5 text-[10.5px] font-medium text-slate-400">kcal/h</span>
                                  </span>
                                  <span className="whitespace-nowrap rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10.5px] font-extrabold text-white">
                                    동 합계 {parts.reduce((n, p) => n + p.count, 0)}대
                                  </span>
                                </div>
                              </>
                            ) : loss?.issue ? (
                              <div className="mt-1 text-[11.5px] font-semibold text-amber-600">{loss.issue}</div>
                            ) : (
                              <div className="mt-1 flex items-center gap-1.5">
                                <span className="text-[12px] font-bold tabular-nums text-slate-700">
                                  {int(loss?.total ?? 0)}
                                  <span className="ml-0.5 text-[10.5px] font-medium text-slate-400">kcal/h</span>
                                </span>
                                {need && (
                                  <>
                                    <span
                                      className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold text-white"
                                      style={{ background: heater.color }}
                                      title={heater.name}
                                    >
                                      {need.applied}대
                                    </span>
                                    <Verdict ok={need.ok} />
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              title="복제"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDuplicate(z.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="삭제"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(z.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 구역 형상 썸네일 — 도면 다각형이면 그 모양, 치수 입력이면 가로×세로 비율의 사각형 */
function ZoneThumb({ zone, color }: { zone: Zone; color: string }) {
  const S = 44;
  const pad = 5;
  let pts: { x: number; y: number }[];
  const poly = zone.geometry.polygon;
  if (poly && poly.length >= 3) {
    pts = poly;
  } else {
    const l = zone.geometry.dims?.l ?? Math.sqrt(Math.max(zone.geometry.area, 1));
    const w = zone.geometry.dims?.w ?? Math.sqrt(Math.max(zone.geometry.area, 1));
    pts = [
      { x: 0, y: 0 },
      { x: l, y: 0 },
      { x: l, y: w },
      { x: 0, y: w },
    ];
  }
  const b = polygonBounds(pts);
  const bw = Math.max(1e-9, b.maxX - b.minX);
  const bh = Math.max(1e-9, b.maxY - b.minY);
  const k = Math.min((S - pad * 2) / bw, (S - pad * 2) / bh);
  const ox = (S - bw * k) / 2;
  const oy = (S - bh * k) / 2;
  const d = pts
    .map((p) => `${(ox + (p.x - b.minX) * k).toFixed(1)},${(S - oy - (p.y - b.minY) * k).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0 rounded-lg bg-slate-50 ring-1 ring-slate-100">
      <polygon points={d} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
