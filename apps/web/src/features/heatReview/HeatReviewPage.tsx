/**
 * 동절기 열원검토 — 골조 동절기공사(한중콘크리트) 급열 열원 산정·비교 도구.
 *
 * 현장에서 엑셀 두 개(단위세대 열원검토 · 주차장 열풍기 대수 산정툴)로 하던 일을 한 화면으로 옮겼다.
 *   구역      : 도면(DXF) 위에 보양 구역을 그리거나 치수로 넣는다. 구역은 CJ·세대 타입 단위로 저장된다.
 *               도면은 단위세대 / 코어 / 주차장·지하 **종류별로 따로** 올린다(서로 다른 도면이라서).
 *   조건·열원 : 온도·열손실계수·열원 제원·단가.
 *   열원 비교 : 열원별 대수·1회 타설 금액·동절기 금액, 엑셀 보고서.
 *
 * 저장은 이 브라우저(store.ts)에 자동으로 된다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronsUpDown,
  CloudOff,
  Copy,
  Download,
  FileSpreadsheet,
  Flame,
  Layers,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import ToolShell from "@/features/tcRental/components/ToolShell";
import { cn } from "@/lib/utils";
import CompareTab from "./components/CompareTab";
import ConditionsTab from "./components/ConditionsTab";
import ZoneCanvas, { type HeaterOverlay } from "./components/ZoneCanvas";
import ZoneInspector from "./components/ZoneInspector";
import ZoneList from "./components/ZoneList";
import { int, Segmented, wonShort } from "./components/ui";
import { appliedHeater, createZone, newId, normalizeProject, ZONE_KIND_LABEL, zoneSheet } from "./defaults";
import { heaterNeed, summarize, zoneLoss, type HeaterNeed, type ZoneLoss } from "./engine/calc";
import type { LiteDxf } from "./engine/dxfLite";
import { parseDxfBuffer } from "./engine/parseDxfFile";
import { measurePolygon } from "./engine/geometry";
import { exportHeatReviewXlsx } from "./exportXlsx";
import { deleteDrawing, deleteDrawings, loadDrawing, saveDrawing, useHeatStore, type SaveState } from "./store";
import type { Heater, HeatProject, Pt, Zone, ZoneKind } from "./types";

type Tab = "zones" | "conditions" | "compare";

const TABS: { id: Tab; label: string; icon: typeof Flame }[] = [
  { id: "zones", label: "구역", icon: Layers },
  { id: "conditions", label: "조건·열원", icon: SlidersHorizontal },
  { id: "compare", label: "열원 비교", icon: Flame },
];

const NAME_PREFIX: Record<ZoneKind, string> = { unit: "세대", core: "코어", parking: "CJ-" };

/** 이보다 큰 파일은 브라우저가 통째로 읽지 못할 수 있다 */
const MAX_DXF_BYTES = 700 * 1024 * 1024;

function nextZoneName(zones: Zone[], kind: ZoneKind): string {
  const prefix = NAME_PREFIX[kind];
  const used = new Set(zones.map((z) => z.name));
  for (let i = zones.filter((z) => z.kind === kind).length + 1; ; i++) {
    const name = kind === "parking" ? `${prefix}${i}` : `${prefix} ${i}`;
    if (!used.has(name)) return name;
  }
}

function nextColor(zones: Zone[]): number {
  return zones.length === 0 ? 0 : Math.max(...zones.map((z) => z.color)) + 1;
}

export default function HeatReviewPage() {
  const { project, index, saveState, update, open, create, adopt, remove } = useHeatStore();
  const [tab, setTab] = useState<Tab>("zones");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 지금 보고 있는 도면 — 종류별로 한 장씩. 여기서 그린 구역은 이 종류가 된다 */
  const [sheet, setSheet] = useState<ZoneKind>("parking");
  const [parsed, setParsed] = useState<LiteDxf | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── 검토서를 열거나 도면 종류를 바꾸면 저장해 둔 그 도면을 되살린다 ──
  const projectId = project.id;
  useEffect(() => {
    setSelectedId(null);
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    setParsed(null);
    setLoading(true);
    void loadDrawing(projectId, sheet).then((dxf) => {
      if (!alive) return;
      if (dxf) setParsed(dxf);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, sheet]);

  const handleLoadFile = useCallback(
    async (file: File) => {
      if (/\.dwg$/i.test(file.name)) {
        toast.error("DWG 는 바로 읽지 못합니다. 캐드에서 「다른 이름으로 저장 → DXF」로 저장한 파일을 넣어 주세요.", {
          duration: 8000,
        });
        return;
      }
      if (!/\.dxf$/i.test(file.name)) {
        toast.error("DXF 파일만 불러올 수 있습니다.");
        return;
      }
      if (file.size > MAX_DXF_BYTES) {
        toast.error(`도면이 너무 큽니다(${Math.round(file.size / 1e6)}MB). 필요한 층만 남겨 DXF 로 저장해 주세요.`);
        return;
      }
      setLoading(true);
      try {
        const next = await parseDxfBuffer(await file.arrayBuffer());
        if (next.stats.segments === 0) throw new Error("표시할 선이 없습니다 (모형 공간이 비어 있음)");
        const extent = Math.max(next.fit.maxX - next.fit.minX, next.fit.maxY - next.fit.minY);
        // 건축 평면은 거의 mm 다. 전체 폭이 2,000 미만이면 m 도면으로 본다
        const unit: "mm" | "m" = extent >= 2000 ? "mm" : "m";
        setParsed(next);
        update((p) => ({
          ...p,
          drawings: { ...p.drawings, [sheet]: { fileName: file.name, unit } },
          zones: remeasure(p.zones, sheet, unit),
        }));
        const stored = await saveDrawing(projectId, sheet, next);
        toast.success(
          `${ZONE_KIND_LABEL[sheet]} 도면을 불러왔습니다 · 선 ${next.stats.segments.toLocaleString("ko-KR")}개 · 단위 ${unit}${stored ? "" : " (이 브라우저에 보관하지 못했습니다 — 다음에 다시 불러와야 합니다)"}`,
        );
        if (next.warnings.length > 0) toast.warning(next.warnings[0]);
      } catch (err) {
        toast.error(`도면을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId, sheet, update],
  );

  // ── 계산 (문서가 바뀔 때만) ──
  // 적용 열원은 구역 종류별로 다를 수 있다 → 구역마다 그 종류의 열원으로 대수를 낸다
  const { losses, needs, summary, heaterOverlay } = useMemo(() => {
    const losses = new Map<string, ZoneLoss>();
    const needs = new Map<string, HeaterNeed>();
    const heaterOverlay: HeaterOverlay = new Map();
    for (const z of project.zones) {
      const loss = zoneLoss(z, project.conditions);
      const h = appliedHeater(project, z);
      const need = heaterNeed(loss, h, z);
      losses.set(z.id, loss);
      needs.set(z.id, need);
      heaterOverlay.set(z.id, { count: need.applied, color: h.color });
    }
    return { losses, needs, summary: summarize(project), heaterOverlay };
  }, [project]);

  // ── 구역 편집 ──
  const patchZone = useCallback(
    (id: string, patch: Partial<Zone>) =>
      update((p) => ({
        ...p,
        zones: p.zones.map((z) =>
          z.id === id ? { ...z, ...patch, updatedAt: new Date().toISOString() } : z,
        ),
      })),
    [update],
  );

  const addFromPolygon = useCallback(
    (polygon: Pt[]) => {
      const id = newId();
      update((p) => {
        const unit = p.drawings[sheet]?.unit ?? "mm";
        const m = measurePolygon(polygon, unit);
        const zone = createZone(sheet, nextZoneName(p.zones, sheet), nextColor(p.zones), {
          source: "cad",
          polygon,
          sheet,
          dims: null,
          area: m.area,
          perimeter: m.perimeter,
        });
        return { ...p, zones: [...p.zones, { ...zone, id }] };
      });
      setSelectedId(id);
    },
    [update, sheet],
  );

  const addManual = useCallback(
    (kind: ZoneKind) => {
      const id = newId();
      update((p) => {
        const dims = kind === "parking" ? { l: 45, w: 25 } : kind === "core" ? { l: 8, w: 6 } : { l: 10, w: 9 };
        const zone = createZone(kind, nextZoneName(p.zones, kind), nextColor(p.zones), {
          source: "manual",
          polygon: null,
          dims,
          area: dims.l * dims.w,
          perimeter: 2 * (dims.l + dims.w),
        });
        return { ...p, zones: [...p.zones, { ...zone, id }] };
      });
      setSelectedId(id);
    },
    [update],
  );

  const duplicateZone = useCallback(
    (zoneId: string) => {
      const id = newId();
      update((p) => {
        const src = p.zones.find((z) => z.id === zoneId);
        if (!src) return p;
        const now = new Date().toISOString();
        // 도면 구역은 같은 자리에 겹치므로 복제본은 치수 구역으로 만든다(면적·둘레는 그대로)
        const copy: Zone = {
          ...src,
          id,
          name: `${src.name} 복사`,
          color: nextColor(p.zones),
          geometry: { ...src.geometry, source: "manual", polygon: null },
          openings: src.openings.map((o) => ({ ...o, id: newId() })),
          applied: { ...src.applied },
          createdAt: now,
          updatedAt: now,
        };
        return { ...p, zones: [...p.zones, copy] };
      });
      setSelectedId(id);
    },
    [update],
  );

  const deleteZone = useCallback(
    (zoneId: string) => {
      const z = project.zones.find((x) => x.id === zoneId);
      if (!z || !window.confirm(`「${z.name}」 구역을 삭제할까요?`)) return;
      update((p) => ({ ...p, zones: p.zones.filter((x) => x.id !== zoneId) }));
      setSelectedId((cur) => (cur === zoneId ? null : cur));
    },
    [project.zones, update],
  );

  const selectedZone = project.zones.find((z) => z.id === selectedId) ?? null;
  /** 지금 도면에 그린 구역만 캔버스에 올린다 (다른 도면의 좌표는 이 도면과 무관하다) */
  const sheetZones = useMemo(
    () => project.zones.filter((z) => z.geometry.polygon && zoneSheet(z) === sheet),
    [project.zones, sheet],
  );
  const selectedCost = summary.plan;

  return (
    <ToolShell
      title="동절기 열원검토"
      subtitle={<span className="text-[12px] text-slate-400">한중콘크리트 급열 열원 산정·비교</span>}
      actions={
        <>
          <SaveBadge state={saveState} />
          <ProjectMenu
            project={project}
            index={index}
            onOpen={(id) => {
              if (!open(id)) toast.error("검토서를 열지 못했습니다.");
            }}
            onCreate={(name) => create(name)}
            onRename={(name) => update((p) => ({ ...p, name }))}
            onDuplicate={() => {
              const now = new Date().toISOString();
              adopt({
                ...project,
                id: newId(),
                name: `${project.name} 복사`,
                drawings: { unit: null, core: null, parking: null },
                createdAt: now,
                updatedAt: now,
              });
              toast.success("검토서를 복제했습니다. (도면은 다시 불러와야 합니다)");
            }}
            onDelete={() => {
              void deleteDrawings(project.id);
              remove(project.id);
            }}
            onImport={(p) => {
              adopt(p);
              toast.success(`「${p.name}」 검토서를 가져왔습니다.`);
            }}
          />
          <button
            type="button"
            disabled={exporting || project.zones.length === 0}
            onClick={async () => {
              setExporting(true);
              try {
                await exportHeatReviewXlsx(project);
              } catch (err) {
                toast.error(`엑셀을 만들지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setExporting(false);
              }
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#0a63b8] px-3.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-[#08539b] disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            엑셀 보고서
          </button>
        </>
      }
    >
      {/* 탭 + 적용 열원 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-bold transition-colors",
                tab === t.id ? "bg-[#0f2a4a] text-white shadow" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {t.id === "zones" && project.zones.length > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10.5px] tabular-nums",
                    tab === t.id ? "bg-white/20" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {project.zones.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[11.5px] font-semibold text-slate-400">적용 열원</span>
            {(Object.keys(ZONE_KIND_LABEL) as ZoneKind[]).map((k) => (
              <HeaterPicker
                key={k}
                label={ZONE_KIND_LABEL[k]}
                heaters={project.heaters}
                value={project.appliedHeaters[k]}
                onChange={(id) => update((p) => ({ ...p, appliedHeaters: { ...p.appliedHeaters, [k]: id } }))}
              />
            ))}
          </div>
          {project.zones.length > 0 && (
            <div className="hidden items-center gap-3 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-[11.5px] tabular-nums text-slate-500 shadow-sm lg:flex">
              <span>
                <b className="text-slate-800">{int(selectedCost.peakUnits)}</b>대
              </span>
              <span className="h-3 w-px bg-slate-200" />
              <span>
                동절기 <b className="text-[#0a4f99]">{wonShort(selectedCost.seasonTotal)}</b>원
              </span>
            </div>
          )}
        </div>
      </div>

      {tab === "zones" && (
        <div
          className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_380px]"
          style={{ height: "max(640px, calc(100vh - 68px - 24px - 60px - 28px))" }}
        >
          <div className="min-h-0">
            <ZoneList
              zones={project.zones}
              losses={losses}
              needs={needs}
              heaterOf={(z) => appliedHeater(project, z)}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                // 도면에 그린 구역이면 그 도면으로 넘어간다
                const z = project.zones.find((x) => x.id === id);
                if (z?.geometry.polygon) setSheet(zoneSheet(z));
              }}
              onAddManual={addManual}
              onDuplicate={duplicateZone}
              onDelete={deleteZone}
            />
          </div>
          <div className="flex min-h-[420px] flex-col gap-2">
            {/* 도면 탭 — 종류별로 다른 도면을 올린다 */}
            <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm">
              {(Object.keys(ZONE_KIND_LABEL) as ZoneKind[]).map((k) => {
                const meta = project.drawings[k];
                const count = project.zones.filter((z) => z.geometry.polygon && zoneSheet(z) === k).length;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setSheet(k);
                      setSelectedId(null);
                    }}
                    title={meta ? meta.fileName : `${ZONE_KIND_LABEL[k]} 도면을 아직 올리지 않았습니다`}
                    className={cn(
                      "flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[12.5px] font-bold transition-colors",
                      sheet === k ? "bg-[#0a63b8] text-white shadow" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                    )}
                  >
                    <span className="shrink-0">{ZONE_KIND_LABEL[k]} 도면</span>
                    <span
                      className={cn(
                        "min-w-0 truncate text-[11px] font-medium",
                        sheet === k ? "text-blue-100" : meta ? "text-slate-400" : "text-slate-300",
                      )}
                    >
                      {meta ? meta.fileName : "도면 없음"}
                    </span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 text-[10.5px] tabular-nums",
                          sheet === k ? "bg-white/20" : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1">
            <ZoneCanvas
              key={`${projectId}:${sheet}`}
              sheetLabel={ZONE_KIND_LABEL[sheet]}
              parsed={parsed}
              drawing={project.drawings[sheet]}
              loading={loading}
              zones={sheetZones}
              selectedId={selectedId}
              heaterOverlay={heaterOverlay}
              onSelect={setSelectedId}
              onCreate={addFromPolygon}
              onUpdatePolygon={(zoneId, polygon) => {
                const m = measurePolygon(polygon, project.drawings[sheet]?.unit ?? "mm");
                const z = project.zones.find((x) => x.id === zoneId);
                if (!z) return;
                const perimeter = z.geometry.perimeterLocked ? z.geometry.perimeter : m.perimeter;
                patchZone(zoneId, { geometry: { ...z.geometry, polygon, area: m.area, perimeter } });
              }}
              onLoadFile={(f) => void handleLoadFile(f)}
              onUnitChange={(unit) =>
                update((p) => {
                  const cur = p.drawings[sheet];
                  return {
                    ...p,
                    drawings: { ...p.drawings, [sheet]: cur ? { ...cur, unit } : cur },
                    zones: remeasure(p.zones, sheet, unit),
                  };
                })
              }
              onClearDrawing={() => {
                if (!window.confirm(`${ZONE_KIND_LABEL[sheet]} 도면을 닫을까요? 그려 둔 구역은 그대로 남습니다.`)) return;
                setParsed(null);
                void deleteDrawing(project.id, sheet);
                update((p) => ({ ...p, drawings: { ...p.drawings, [sheet]: null } }));
              }}
            />
            </div>
          </div>
          <div className="min-h-0">
            <ZoneInspector
              zone={selectedZone}
              loss={selectedZone ? (losses.get(selectedZone.id) ?? null) : null}
              heaters={project.heaters}
              selectedHeaterId={selectedZone ? appliedHeater(project, selectedZone).id : ""}
              measuredPerimeter={
                selectedZone?.geometry.polygon
                  ? measurePolygon(
                      selectedZone.geometry.polygon,
                      project.drawings[zoneSheet(selectedZone)]?.unit ?? "mm",
                    ).perimeter
                  : null
              }
              onChange={(patch) => selectedZone && patchZone(selectedZone.id, patch)}
              onDelete={() => selectedZone && deleteZone(selectedZone.id)}
            />
          </div>
        </div>
      )}

      {tab === "conditions" && <ConditionsTab project={project} update={update} />}

      {tab === "compare" && (
        <CompareTab
          project={project}
          summary={summary}
          onApply={(patch) => update((p) => ({ ...p, appliedHeaters: { ...p.appliedHeaters, ...patch } }))}
        />
      )}
    </ToolShell>
  );
}

/** 도면 단위가 바뀌면 그 도면에서 딴 구역의 면적·둘레를 다시 잰다 */
function remeasure(zones: Zone[], sheet: ZoneKind, unit: "mm" | "m"): Zone[] {
  return zones.map((z) => {
    const poly = z.geometry.polygon;
    if (z.geometry.source !== "cad" || !poly || zoneSheet(z) !== sheet) return z;
    const m = measurePolygon(poly, unit);
    const perimeter = z.geometry.perimeterLocked ? z.geometry.perimeter : m.perimeter;
    return { ...z, geometry: { ...z.geometry, area: m.area, perimeter } };
  });
}

/** 구역 종류 하나의 적용 열원 고르기 */
function HeaterPicker({
  label,
  heaters,
  value,
  onChange,
}: {
  label: string;
  heaters: Heater[];
  value: string;
  onChange: (id: string) => void;
}) {
  const cur = heaters.find((h) => h.id === value) ?? heaters[0];
  return (
    <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white pl-2.5 pr-1 shadow-sm hover:border-slate-300">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cur.color }} />
      <select
        value={cur.id}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent py-1 pr-1 text-[12px] font-bold text-slate-800 outline-none"
      >
        {heaters.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span
      className={cn(
        "hidden items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold md:flex",
        state === "error" ? "bg-rose-50 text-rose-600" : "text-slate-400",
      )}
      title="이 브라우저에 자동 저장됩니다. 다른 PC 로 옮길 때는 검토서 메뉴의 내보내기를 쓰세요."
    >
      {state === "saving" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          저장 중
        </>
      ) : state === "error" ? (
        <>
          <CloudOff className="h-3 w-3" />
          저장 실패
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          자동 저장됨
        </>
      )}
    </span>
  );
}

function ProjectMenu({
  project,
  index,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onImport,
}: {
  project: HeatProject;
  index: { id: string; name: string; zoneCount: number; updatedAt: string }[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onImport: (p: HeatProject) => void;
}) {
  const [openMenu, setOpenMenu] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  const item =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className="flex h-9 max-w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-sm hover:border-slate-300"
      >
        <span className="truncate">{project.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {openMenu && (
        <div className="absolute right-0 top-11 z-50 w-[300px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(15,42,74,0.35)]">
          <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold tracking-wide text-slate-400">검토서 (현장)</div>
          <div className="max-h-[240px] overflow-y-auto">
            {index.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setOpenMenu(false);
                  if (e.id !== project.id) onOpen(e.id);
                }}
                className={cn(item, e.id === project.id && "bg-blue-50 text-[#0a4f99]")}
              >
                <span className="min-w-0 flex-1 truncate">{e.id === project.id ? project.name : e.name}</span>
                <span className="shrink-0 text-[11px] font-medium text-slate-400">
                  구역 {e.id === project.id ? project.zones.length : e.zoneCount}
                </span>
                {e.id === project.id && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
          <div className="my-1.5 h-px bg-slate-100" />
          <button
            type="button"
            className={item}
            onClick={() => {
              const name = window.prompt("새 검토서 이름 (현장명)", "");
              if (name?.trim()) {
                onCreate(name.trim());
                setOpenMenu(false);
              }
            }}
          >
            <Plus className="h-3.5 w-3.5" />새 검토서
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              const name = window.prompt("검토서 이름", project.name);
              if (name?.trim()) onRename(name.trim());
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            이름 바꾸기
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              onDuplicate();
              setOpenMenu(false);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            복제
          </button>
          <div className="my-1.5 h-px bg-slate-100" />
          <button
            type="button"
            className={item}
            onClick={() => {
              const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `동절기 열원검토_${project.name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 2000);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            내보내기 (JSON)
          </button>
          <button type="button" className={item} onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            가져오기 (JSON)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const p = normalizeProject(JSON.parse(await f.text()));
                if (!p) throw new Error("검토서 파일이 아닙니다");
                const now = new Date().toISOString();
                // 같은 파일을 두 번 가져와도 기존 검토서를 덮어쓰지 않게 새 id 를 준다
                onImport({ ...p, id: newId(), drawings: { unit: null, core: null, parking: null }, updatedAt: now });
                setOpenMenu(false);
              } catch (err) {
                toast.error(`가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          />
          <div className="my-1.5 h-px bg-slate-100" />
          <button
            type="button"
            className={cn(item, "text-rose-600 hover:bg-rose-50")}
            onClick={() => {
              if (!window.confirm(`「${project.name}」 검토서와 그 안의 구역 ${project.zones.length}개를 삭제할까요? 되돌릴 수 없습니다.`)) return;
              onDelete();
              setOpenMenu(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />이 검토서 삭제
          </button>
          <p className="px-2.5 pb-1 pt-2 text-[10.5px] leading-relaxed text-slate-400">
            검토서는 이 브라우저에 저장됩니다. 다른 PC·동료에게는 내보내기 파일로 전달하세요.
          </p>
        </div>
      )}
    </div>
  );
}
