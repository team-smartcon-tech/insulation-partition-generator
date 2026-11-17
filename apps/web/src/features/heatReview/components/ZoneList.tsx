/**
 * 보양 구역 목록 — 종류(단위세대·코어·주차장)별로 묶어 저장된 구역을 카드로 보여준다.
 * 카드 한 장에 형상·면적·손실열량·적용 열원 대수·판정이 다 들어 있어, 목록만 봐도 검토가 끝난다.
 */
import { Building2, Copy, DoorOpen, ParkingSquare, Plus, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZONE_KIND_LABEL, zoneColor } from "../defaults";
import type { HeaterNeed, ZoneLoss } from "../engine/calc";
import { polygonBounds } from "../engine/geometry";
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
  losses,
  needs,
  heaterOf,
  selectedId,
  onSelect,
  onAddManual,
  onDuplicate,
  onDelete,
}: {
  zones: Zone[];
  losses: Map<string, ZoneLoss>;
  needs: Map<string, HeaterNeed>;
  /** 구역에 적용하는 열원 (종류별로 다를 수 있다) */
  heaterOf: (zone: Zone) => Heater;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddManual: (kind: ZoneKind) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_24px_-18px_rgba(15,42,74,0.25)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-[14px] font-bold tracking-tight text-slate-800">보양 구역</h3>
          <p className="text-[11.5px] text-slate-400">
            {zones.length > 0 ? `${zones.length}개 구역 · 자동 저장` : "도면에 그리거나 치수로 추가"}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {KIND_ORDER.map((kind) => {
          const list = zones.filter((z) => z.kind === kind);
          const Icon = KIND_ICON[kind];
          const area = list.reduce((s, z) => s + z.geometry.area * z.qty, 0);
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
                          )}
                        >
                          <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
                          <ZoneThumb zone={z} color={color} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13.5px] font-bold text-slate-800">{z.name}</span>
                              {z.qty > 1 && (
                                <span className="shrink-0 rounded bg-slate-100 px-1 text-[10.5px] font-bold text-slate-500">
                                  ×{z.qty}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11.5px] tabular-nums text-slate-500">
                              {dec(z.geometry.area, 1)}㎡ · 층고 {dec(z.height, 2)}m
                              <span className="ml-1 text-slate-300">
                                {z.geometry.source === "cad" ? "도면" : "치수"}
                              </span>
                            </div>
                            {loss?.issue ? (
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
