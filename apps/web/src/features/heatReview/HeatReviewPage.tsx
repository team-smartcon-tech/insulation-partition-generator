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
import ZoneCanvas, { type HeaterOverlay, type PartView } from "./components/ZoneCanvas";
import ZoneInspector from "./components/ZoneInspector";
import ZoneList from "./components/ZoneList";
import { int, Segmented, wonShort } from "./components/ui";
import {
  appliedHeater,
  createProject,
  createZone,
  newId,
  normalizeProject,
  ZONE_KIND_LABEL,
  zoneSheet,
} from "./defaults";
import { edgeLossShare, heaterNeed, summarize, zoneLoss, type HeaterNeed, type ZoneLoss } from "./engine/calc";
import type { LiteDxf } from "./engine/dxfLite";
import { parseDxfBuffer } from "./engine/parseDxfFile";
import {
  labelPoint,
  measurePolygon,
  offsetPolygon,
  pointInPolygon,
  polygonArea,
  polygonPerimeter,
  unitFactor,
} from "./engine/geometry";
import {
  calcProject,
  isCountingFrame,
  leftoverRegions,
  recognizeParts,
  recognizedCounts,
  widenedId,
  type PartMiss,
} from "./engine/recognize";
import { exportHeatReviewXlsx } from "./exportXlsx";
import ProjectBrowser from "./components/ProjectBrowser";
import { deleteRemoteDrawing, downloadDrawing, uploadDrawing } from "./remote/api";
import { useLoadPlan, useProjects, useSaveRevision, useSites } from "./remote/hooks";
import {
  deleteDrawing,
  deleteDrawings,
  loadDrawing,
  loadProject,
  saveDrawing,
  useHeatStore,
  type SaveState,
} from "./store";
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
  const { project, index, saveState, update: rawUpdate, open, create, adopt, remove } = useHeatStore();
  /** 문서를 고친다. 서버에 연결된 검토서면 "저장 안 된 변경 있음" 표시를 함께 남긴다 */
  const update = useCallback(
    (fn: (p: HeatProject) => HeatProject) =>
      rawUpdate((p) => {
        const next = fn(p);
        return next.remote && !next.remote.dirty ? { ...next, remote: { ...next.remote, dirty: true } } : next;
      }),
    [rawUpdate],
  );

  // ── 서버 저장 (현장 → 세부 프로젝트 → REV) ──
  /** 현장 카드 화면. 들어오면 먼저 띄운다 — 어느 현장의 검토서인지부터 고른다 */
  const [browserOpen, setBrowserOpen] = useState(true);
  const loadPlan = useLoadPlan();
  const saveRevision = useSaveRevision();
  const { data: remoteProjects = [] } = useProjects();
  const { data: sites = [] } = useSites();
  const remoteRow = project.remote ? remoteProjects.find((p) => p.id === project.id) : undefined;
  const siteName = remoteRow?.site_id ? (sites.find((s) => s.id === remoteRow.site_id)?.name ?? null) : null;

  /** 현장 카드 화면에서 세부 프로젝트(또는 특정 REV)를 연다 */
  const openRemote = useCallback(
    async (projectId: string, revId: string | null) => {
      try {
        const { project: row, plan, revNo } = await loadPlan(projectId, revId);
        const local = loadProject(projectId);
        if (plan) {
          // 이 브라우저에 그 REV 뒤로 고치다 만 게 있으면 그걸 이어 갈지 묻는다(최신 REV 를 열 때만)
          if (
            revId === null &&
            local?.remote?.dirty &&
            local.remote.revNo === revNo &&
            window.confirm(
              "이 브라우저에 서버에 저장하지 않은 변경이 있습니다.\n이어서 할까요? (취소 = 서버에 저장된 REV " + revNo + " 를 불러옵니다)",
            )
          ) {
            open(projectId);
          } else {
            const doc = normalizeProject({ ...plan, id: row.id, name: row.name });
            if (!doc) throw new Error("저장된 검토서를 읽지 못했습니다.");
            adopt({ ...doc, remote: { revNo, dirty: false } });
          }
          toast.success(`「${row.name}」 REV ${revNo} 불러옴`);
        } else if (local) {
          // 저장한 REV 는 없지만 이 브라우저에서 하던 작업이 있다
          open(projectId);
        } else if (
          !project.remote &&
          project.zones.length > 0 &&
          window.confirm(
            `지금 이 브라우저에 있는 「${project.name}」 검토서(구역 ${project.zones.length}개)를 이 프로젝트로 가져올까요?\n(취소 = 빈 검토서로 시작)`,
          )
        ) {
          // 도면은 검토서 id 로 보관돼 있다 → 새 id 로 옮겨 담는다
          for (const k of Object.keys(ZONE_KIND_LABEL) as ZoneKind[]) {
            const dxf = await loadDrawing(project.id, k);
            if (dxf) await saveDrawing(row.id, k, dxf);
          }
          adopt({ ...project, id: row.id, name: row.name, remote: { revNo: 0, dirty: true } });
          toast.success(
            "검토서를 가져왔습니다. [서버에 저장]을 누르면 REV 1 로 올라갑니다. 도면은 「도면 교체」로 한 번 다시 올려야 서버에 보관됩니다.",
            { duration: 9000 },
          );
        } else {
          adopt({ ...createProject(row.name), id: row.id, remote: { revNo: 0, dirty: false } });
          toast.info("저장된 REV 가 없습니다. 구역을 넣고 [서버에 저장]을 누르면 REV 1 이 됩니다.");
        }
        setBrowserOpen(false);
      } catch (err) {
        toast.error(`열지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [loadPlan, open, adopt, project],
  );
  const [tab, setTab] = useState<Tab>("zones");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 지금 보고 있는 도면 — 종류별로 한 장씩. 여기서 그린 구역은 이 종류가 된다 */
  const [sheet, setSheet] = useState<ZoneKind>("parking");
  const [parsed, setParsed] = useState<LiteDxf | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── 검토서를 열거나 도면 종류를 바꾸면 저장해 둔 그 도면을 되살린다 ──
  const projectId = project.id;
  const isRemote = !!project.remote;
  /** 이 종류의 도면을 올린 적이 있는가(파일명이 문서에 남아 있다) */
  const hasDrawingMeta = !!project.drawings[sheet];
  useEffect(() => {
    setSelectedId(null);
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    setParsed(null);
    setLoading(true);
    void (async () => {
      let dxf = await loadDrawing(projectId, sheet);
      // 이 브라우저에 없으면(다른 PC 에서 올린 도면) 서버에서 받아 온다. 한 번 받으면 이 브라우저에 보관한다
      if (!dxf && isRemote && hasDrawingMeta) {
        try {
          const buf = await downloadDrawing(projectId, sheet);
          if (buf && alive) {
            dxf = await parseDxfBuffer(buf);
            void saveDrawing(projectId, sheet, dxf);
          }
        } catch (err) {
          if (alive) toast.error(`서버의 도면을 받지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!alive) return;
      if (dxf) setParsed(dxf);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, sheet, isRemote, hasDrawingMeta]);

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
        // 서버에 연결된 검토서면 원본을 서버에도 보관한다(다른 PC 에서 그대로 보이게). 화면은 기다리지 않는다
        if (isRemote) {
          void uploadDrawing(projectId, sheet, file)
            .then((size) =>
              toast.success(
                `${ZONE_KIND_LABEL[sheet]} 도면을 서버에 보관했습니다 (${Math.round(file.size / 1e6)}MB → ${Math.max(1, Math.round(size / 1e6))}MB).`,
              ),
            )
            .catch((err) =>
              toast.error(
                `도면을 서버에 보관하지 못했습니다(이 브라우저에서는 그대로 쓸 수 있습니다): ${err instanceof Error ? err.message : String(err)}`,
                { duration: 9000 },
              ),
            );
        }
      } catch (err) {
        toast.error(`도면을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId, sheet, update, isRemote],
  );

  // ── 계산 (문서가 바뀔 때만) ──
  // 적용 열원은 구역 종류별로 다를 수 있다 → 구역마다 그 종류의 열원으로 대수를 낸다
  const { losses, needs, summary, heaterOverlay, calc, autoQty, frameParts } = useMemo(() => {
    const losses = new Map<string, ZoneLoss>();
    const needs = new Map<string, HeaterNeed>();
    const heaterOverlay: HeaterOverlay = new Map();
    for (const z of project.zones) {
      const loss = zoneLoss(z, project.conditions);
      const h = appliedHeater(project, z);
      const need = heaterNeed(loss, h, z);
      losses.set(z.id, loss);
      needs.set(z.id, need);
      heaterOverlay.set(z.id, { count: need.applied, color: h.color, edgeShare: edgeLossShare(loss) });
    }
    // 세대·코어를 인식한 동 외곽은 계산에서 빠지고, 안의 타입·코어가 인식된 개수만큼 계산된다
    const calc = calcProject(project);
    // 외곽 여유를 준 동 안의 세대는 면적이 늘어난 별도 구역으로 계산된다 — 그 손실열량·대수도 구해 둔다
    for (const z of calc.zones) {
      if (losses.has(z.id)) continue;
      const loss = zoneLoss(z, project.conditions);
      losses.set(z.id, loss);
      needs.set(z.id, heaterNeed(loss, appliedHeater(project, z), z));
    }
    const autoQty = recognizedCounts(project.zones);
    // 동 외곽 안에 놓인 세대·코어 — 도면에 그리고 열원을 세대마다 놓는 데 쓴다
    const frameParts = new Map<string, PartView[]>();
    const byId = new Map(project.zones.map((z) => [z.id, z]));
    for (const z of project.zones) {
      if (!isCountingFrame(z)) continue;
      heaterOverlay.delete(z.id); // 틀 자체에는 열원을 놓지 않는다
      const list: PartView[] = [];
      for (const part of z.parts!) {
        const t = byId.get(part.templateId);
        if (!t) continue;
        // 이 동에 외곽 여유를 줬으면 늘어난 면적으로 계산한 값을 쓴다
        const calcId = losses.has(widenedId(t.id, z.id)) ? widenedId(t.id, z.id) : t.id;
        list.push({
          templateId: t.id,
          polygon: part.polygon,
          name: t.name,
          color: t.color,
          count: needs.get(calcId)?.applied ?? 0,
          heaterColor: appliedHeater(project, t).color,
          loss: losses.get(calcId)?.total ?? 0,
          edgeShare: losses.has(calcId) ? edgeLossShare(losses.get(calcId)!) : 0,
          // 남은 자리를 코어로 본 것은 원본과 모양이 달라 기준 배치를 옮길 수 없다
          templatePolygon: part.rest ? null : t.geometry.polygon,
        });
        // 원본 자리는 틀이 그려 주므로 타입 구역 쪽에서 또 놓지 않는다
        if (t.geometry.polygon && pointInPolygon(labelPoint(t.geometry.polygon), z.geometry.polygon!)) {
          heaterOverlay.delete(t.id);
        }
      }
      frameParts.set(z.id, list);
    }
    return { losses, needs, summary: summarize(calc), heaterOverlay, calc, autoQty, frameParts };
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
    (polygon: Pt[], opts?: { frame?: boolean }) => {
      const id = newId();
      const myArea = polygonArea(polygon);
      /** 같은 도면의 세대·코어 구역 중 이 다각형과 "품고 품기는" 사이인 것 */
      const related = (zones: Zone[]) =>
        sheet !== "unit"
          ? []
          : zones.filter((z) => z.kind !== "parking" && z.geometry.polygon && zoneSheet(z) === "unit");
      // 큰 쪽이 동 외곽, 작은 쪽이 세대다. 무게중심만 보면 ㄴ자 건물의 중심이 세대 안에 떨어져
      // 세대가 외곽으로 뒤집히므로(2026-11-18) 반드시 넓이를 함께 본다.
      const isFrameOf = (zones: Zone[]) =>
        !!opts?.frame ||
        related(zones).some(
          (z) =>
            !z.container &&
            myArea >= polygonArea(z.geometry.polygon!) * 1.5 &&
            pointInPolygon(labelPoint(z.geometry.polygon!), polygon),
        );
      /** 내가 세대로 들어가는 큰 구역 — 아직 동 외곽이 아니면 외곽으로 바꿔 준다(큰 걸 먼저 그린 경우) */
      const hostOf = (zones: Zone[]) =>
        related(zones).find(
          (z) =>
            !z.container &&
            polygonArea(z.geometry.polygon!) >= myArea * 1.5 &&
            pointInPolygon(labelPoint(polygon), z.geometry.polygon!),
        );
      update((p) => {
        const unit = p.drawings[sheet]?.unit ?? "mm";
        const m = measurePolygon(polygon, unit);
        const holds = isFrameOf(p.zones);
        const host = holds ? undefined : hostOf(p.zones);
        const name = holds
          ? `동 외곽 ${p.zones.filter((z) => z.container).length + 1}`
          : nextZoneName(p.zones, sheet);
        const zone = createZone(sheet, name, nextColor(p.zones), {
          source: "cad",
          polygon,
          sheet,
          dims: null,
          area: m.area,
          perimeter: m.perimeter,
        });
        const zones = host ? p.zones.map((z) => (z.id === host.id ? { ...z, container: true } : z)) : p.zones;
        return { ...p, zones: [...zones, { ...zone, id, ...(holds ? { container: true } : {}) }] };
      });
      if (isFrameOf(project.zones)) {
        toast.success(
          opts?.frame
            ? "동 외곽을 땄습니다 — 이 안에 세대 타입을 한 번씩 그리면 세대수를 세고 남은 자리를 코어로 잡습니다."
            : "동 외곽으로 넣었습니다 — 안에 있는 세대 타입·코어를 찾아 세대수를 셉니다.",
        );
      } else {
        const host = hostOf(project.zones);
        if (host) toast.success(`「${host.name}」을(를) 동 외곽으로 바꿨습니다 — 방금 그린 세대와 같은 타입을 그 안에서 찾습니다.`);
      }
      setSelectedId(id);
    },
    [update, sheet, project.zones],
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

  /** 동 외곽 id → 그 안에서 한 곳도 못 찾은 타입·코어 (도면이 열려 있을 때만 안다) */
  const [frameMisses, setFrameMisses] = useState<Map<string, PartMiss[]>>(new Map());

  // ── 동 외곽 안의 세대·코어 찾기 ──
  // 지금 열린 도면의 동 외곽마다, 그려 둔 타입·코어 모양을 도면 선에 맞춰 찾는다(뒤집힌 것까지).
  // 외곽이나 타입을 고치면 다시 찾는다. 결과가 그대로면 문서를 건드리지 않는다.
  useEffect(() => {
    if (!parsed) return;
    // 뒤집힌 지정 바로잡기: 동 외곽이라는 구역이 더 큰 보통 구역 안에 들어 있으면 둘이 바뀐 것이다
    // (무게중심만 보고 판정하던 때 만든 문서 — 작은 세대가 외곽, 건물 전체가 세대로 들어가 있다).
    for (const c of project.zones) {
      if (!c.container || !c.geometry.polygon || zoneSheet(c) !== sheet || (c.parts?.length ?? 0) > 0) continue;
      const area = polygonArea(c.geometry.polygon);
      const center = labelPoint(c.geometry.polygon);
      const host = project.zones.find(
        (z) =>
          z.id !== c.id &&
          z.kind !== "parking" &&
          !!z.geometry.polygon &&
          zoneSheet(z) === sheet &&
          polygonArea(z.geometry.polygon) >= area * 1.5 &&
          pointInPolygon(center, z.geometry.polygon),
      );
      if (host) {
        update((p) => ({
          ...p,
          zones: p.zones.map((z) =>
            z.id === c.id ? { ...z, container: false, parts: [] } : z.id === host.id ? { ...z, container: true } : z,
          ),
        }));
        return; // 고친 문서로 이 효과가 다시 돈다
      }
    }
    const unit = project.drawings[sheet]?.unit ?? "mm";
    const tol = 0.03 / unitFactor(unit);
    const sameFile = (k: ZoneKind) =>
      k === sheet || (!!project.drawings[k] && project.drawings[k]?.fileName === project.drawings[sheet]?.fileName);
    const templates = project.zones
      .filter((z) => !z.container && z.kind !== "parking" && z.geometry.polygon && sameFile(zoneSheet(z)))
      .map((z) => ({ id: z.id, polygon: z.geometry.polygon! }));
    /** 남은 자리를 맡길 코어 구역 — 도면에 그렸든 치수로 넣었든 첫 번째 코어. 없으면 새로 만든다 */
    const coreZone = project.zones.find((z) => z.kind === "core" && !z.container);
    const coreId = coreZone?.id ?? newId();
    /** 남은 자리(코어)들의 넓이 ㎡ · 둘레 m */
    const restSizes: { area: number; perimeter: number }[] = [];
    const changed = new Map<string, Zone["parts"]>();
    const missed = new Map<string, PartMiss[]>();
    for (const z of project.zones) {
      if (!z.container || !z.geometry.polygon || zoneSheet(z) !== sheet) continue;
      const misses: PartMiss[] = [];
      const parts = recognizeParts(z.geometry.polygon, templates, parsed.segs, tol, 0.6 / unitFactor(unit), misses);
      // 세대를 하나라도 찾았으면, 외곽에서 세대를 빼고 남은 자리(계단실·승강기·복도)를 코어로 센다.
      // 코어 모양은 동마다 달라서 그려 둔 코어와 꼭 맞는 자리가 없는 게 보통이다.
      if (parts.length > 0) {
        const k = unitFactor(unit);
        // 아직 안 그린 세대가 있으면 그 자리도 "남은 자리"로 나온다 — 세대만큼 큰 덩어리는 코어가 아니다.
        // 찾은 세대 중 가장 작은 것의 90% 를 넘는 덩어리는 버린다(그 타입을 그리면 그때 세대로 잡힌다).
        const unitAreas = parts
          .filter((p) => project.zones.find((t) => t.id === p.templateId)?.kind === "unit")
          .map((p) => polygonArea(p.polygon));
        const coreMax = unitAreas.length > 0 ? Math.min(...unitAreas) * 0.9 : 0;
        const rest = leftoverRegions(
          z.geometry.polygon,
          parts.map((p) => p.polygon),
          0.25 / k,
          0.7 / k,
          10 / (k * k),
        ).filter((polygon) => polygonArea(polygon) <= coreMax);
        for (const polygon of rest) {
          parts.push({ templateId: coreId, polygon, rest: true });
          restSizes.push({ area: polygonArea(polygon) * k * k, perimeter: polygonPerimeter(polygon) * k });
        }
        // 남은 자리로 코어를 채웠으면 "코어를 못 찾음" 안내는 필요 없다
        if (rest.length > 0) {
          for (let i = misses.length - 1; i >= 0; i--) if (misses[i].templateId === coreId) misses.splice(i, 1);
        }
      }
      missed.set(z.id, misses);
      if (JSON.stringify(parts) !== JSON.stringify(z.parts ?? [])) changed.set(z.id, parts);
    }
    setFrameMisses((cur) => (JSON.stringify([...cur]) === JSON.stringify([...missed]) ? cur : missed));
    // 남은 자리를 맡을 코어 구역: 없으면 만들고, 도구가 만든 것이면 크기를 남은 자리 평균에 맞춘다
    // (평균 × 개수 = 남은 자리 전체 넓이). 사용자가 직접 만든 코어 구역의 크기는 건드리지 않는다.
    const mean = (pick: (r: { area: number; perimeter: number }) => number) =>
      Math.round((restSizes.reduce((s, r) => s + pick(r), 0) / Math.max(1, restSizes.length)) * 100) / 100;
    const coreSize = restSizes.length > 0 ? { area: mean((r) => r.area), perimeter: mean((r) => r.perimeter) } : null;
    const makeCore = !coreZone && coreSize !== null;
    const resizeCore =
      !!coreZone?.autoCore &&
      coreSize !== null &&
      (coreZone.geometry.area !== coreSize.area || coreZone.geometry.perimeter !== coreSize.perimeter);
    if (changed.size === 0 && !makeCore && !resizeCore) return;
    update((p) => {
      let zones = p.zones.map((z) => (changed.has(z.id) ? { ...z, parts: changed.get(z.id) } : z));
      if (makeCore && coreSize) {
        const core = createZone("core", "코어", nextColor(p.zones), {
          source: "manual",
          polygon: null,
          dims: null,
          ...coreSize,
        });
        zones = [...zones, { ...core, id: coreId, autoCore: true }];
      } else if (resizeCore && coreSize) {
        zones = zones.map((z) => (z.id === coreId ? { ...z, geometry: { ...z.geometry, ...coreSize } } : z));
      }
      return { ...p, zones };
    });
  }, [parsed, sheet, project.zones, project.drawings, update]);

  /** 외곽 여유를 바꾸면 면적·둘레를 다시 낸다 (딴 선은 그대로 두고 바깥으로 띄운 선으로 잰다) */
  const setZoneOffset = useCallback(
    (zoneId: string, offset: number) =>
      update((p) => ({
        ...p,
        zones: p.zones.map((z) => {
          if (z.id !== zoneId) return z;
          const g = { ...z.geometry, offset: Math.max(0, offset) };
          if (g.polygon) {
            const m = measureGeom(g.polygon, p.drawings[zoneSheet(z)]?.unit ?? "mm", g.offset);
            g.area = m.area;
            if (!g.perimeterLocked) g.perimeter = m.perimeter;
          } else if (g.dims) {
            const l = g.dims.l + 2 * g.offset;
            const w = g.dims.w + 2 * g.offset;
            g.area = Math.round(l * w * 1000) / 1000;
            g.perimeter = Math.round(2 * (l + w) * 1000) / 1000;
          }
          return { ...z, geometry: g, updatedAt: new Date().toISOString() };
        }),
      })),
    [update],
  );

  /** 지금 상태를 새 REV 로 서버에 저장한다. 연결된 프로젝트가 없으면 고르러 간다 */
  const saveToServer = useCallback(async () => {
    if (!project.remote) {
      setBrowserOpen(true);
      toast.info("저장할 현장을 고르고 세부 프로젝트를 만들어 주세요. 지금 검토서를 그 프로젝트로 가져옵니다.");
      return;
    }
    try {
      // remote 는 이 브라우저의 상태 표시라 서버에 올리지 않는다
      const { remote: _local, ...plan } = project;
      const rev = await saveRevision.mutateAsync({
        projectId: project.id,
        plan,
        summary: {
          zones: calc.zones.length,
          units: Math.round(summary.plan.peakUnits),
          seasonTotal: Math.round(summary.plan.seasonTotal),
        },
      });
      rawUpdate((p) => ({ ...p, remote: { revNo: rev.rev_no, dirty: false } }));
      toast.success(`REV ${rev.rev_no} 저장됨`);
    } catch (err) {
      toast.error(`저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [project, calc, summary, saveRevision, rawUpdate]);

  /** 목록·도면에 보여 주는 구역 — 인식된 타입·코어는 개수를 인식된 수로 */
  const shownZones = useMemo(
    () => project.zones.map((z) => (autoQty.has(z.id) ? { ...z, qty: autoQty.get(z.id)! } : z)),
    [project.zones, autoQty],
  );

  const selectedZone = project.zones.find((z) => z.id === selectedId) ?? null;
  /** 지금 도면에 그린 구역만 캔버스에 올린다 (다른 도면의 좌표는 이 도면과 무관하다) */
  const sheetZones = useMemo(
    () => shownZones.filter((z) => z.geometry.polygon && zoneSheet(z) === sheet),
    [shownZones, sheet],
  );
  const selectedCost = summary.plan;

  return (
    <ToolShell
      title="동절기 열원검토"
      subtitle={<span className="text-[12px] text-slate-400">한중콘크리트 급열 열원 산정·비교</span>}
      actions={
        <>
          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            title="현장·세부 프로젝트 고르기"
            className="flex h-9 max-w-[280px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-700 shadow-sm hover:border-slate-300"
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate">
              {project.remote
                ? `${siteName ?? "미분류"} · ${project.name}${project.remote.revNo > 0 ? ` — REV ${project.remote.revNo}` : ""}`
                : "현장 프로젝트 선택"}
            </span>
          </button>
          <button
            type="button"
            disabled={saveRevision.isPending}
            onClick={() => void saveToServer()}
            title={
              project.remote
                ? "지금 상태를 새 REV 로 서버에 저장합니다 (다른 사람·다른 PC 에서 볼 수 있습니다)"
                : "이 검토서는 이 브라우저에만 있습니다. 현장·세부 프로젝트를 골라 서버에 올립니다"
            }
            className={cn(
              "relative flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-bold shadow-sm transition-colors disabled:opacity-50",
              !project.remote || project.remote.dirty
                ? "bg-[#0f2a4a] text-white hover:bg-[#0b2038]"
                : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300",
            )}
          >
            {saveRevision.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {project.remote ? (project.remote.dirty ? "서버에 저장" : "저장됨") : "현장에 저장"}
            {project.remote?.dirty && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
            )}
          </button>
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
                // 복사본은 서버 프로젝트와 연결되지 않은 이 브라우저만의 검토서다
                remote: undefined,
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
              // 파일로 가져온 검토서는 서버 프로젝트와 연결되지 않은 것으로 넣는다
              adopt({ ...p, remote: undefined });
              toast.success(`「${p.name}」 검토서를 가져왔습니다.`);
            }}
          />
          <button
            type="button"
            disabled={exporting || project.zones.length === 0}
            onClick={async () => {
              setExporting(true);
              try {
                await exportHeatReviewXlsx(calc);
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
              zones={shownZones}
              autoQty={autoQty}
              frameParts={frameParts}
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
              onToggleInclude={(id) => {
                const z = project.zones.find((x) => x.id === id);
                if (z) patchZone(id, { excluded: !z.excluded });
              }}
              onIncludeAll={(on) => update((p) => ({ ...p, zones: p.zones.map((z) => ({ ...z, excluded: !on })) }))}
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
              frameParts={frameParts}
              onSelect={setSelectedId}
              onCreate={addFromPolygon}
              onUpdatePolygon={(zoneId, polygon) => {
                const z = project.zones.find((x) => x.id === zoneId);
                if (!z) return;
                const m = measureGeom(polygon, project.drawings[sheet]?.unit ?? "mm", z.geometry.offset);
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
                if (project.remote) void deleteRemoteDrawing(project.id, sheet).catch(() => {});
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
                  ? measureGeom(
                      selectedZone.geometry.polygon,
                      project.drawings[zoneSheet(selectedZone)]?.unit ?? "mm",
                      selectedZone.geometry.offset,
                    ).perimeter
                  : null
              }
              autoQty={selectedZone ? (autoQty.get(selectedZone.id) ?? null) : null}
              parts={selectedZone ? (frameParts.get(selectedZone.id) ?? null) : null}
              insideFrame={selectedZone ? (hostFrameOf(project.zones, selectedZone)?.name ?? null) : null}
              misses={
                selectedZone
                  ? (frameMisses.get(selectedZone.id) ?? []).map((m) => ({
                      name: project.zones.find((z) => z.id === m.templateId)?.name ?? "?",
                      matched: m.matched,
                      total: m.total,
                    }))
                  : []
              }
              onOffset={(offset) => selectedZone && setZoneOffset(selectedZone.id, offset)}
              onChange={(patch) => selectedZone && patchZone(selectedZone.id, patch)}
              onDelete={() => selectedZone && deleteZone(selectedZone.id)}
            />
          </div>
        </div>
      )}

      {tab === "conditions" && <ConditionsTab project={project} update={update} />}

      {browserOpen && (
        <ProjectBrowser
          onClose={() => setBrowserOpen(false)}
          currentProjectId={project.remote ? project.id : null}
          onOpen={(projectId, revId) => void openRemote(projectId, revId)}
        />
      )}

      {tab === "compare" && (
        <CompareTab
          project={calc}
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
    const m = measureGeom(poly, unit, z.geometry.offset);
    const perimeter = z.geometry.perimeterLocked ? z.geometry.perimeter : m.perimeter;
    return { ...z, geometry: { ...z.geometry, area: m.area, perimeter } };
  });
}

/**
 * 이 구역을 품고 있는 더 큰 구역(같은 도면) — 동 외곽 안에 그린 세대인지 가릴 때 쓴다.
 * 넓이가 1.5배 넘게 크고 이 구역의 한가운데를 품어야 한다.
 */
function hostFrameOf(zones: Zone[], z: Zone): Zone | undefined {
  const poly = z.geometry.polygon;
  if (!poly) return undefined;
  const area = polygonArea(poly);
  const center = labelPoint(poly);
  return zones.find(
    (h) =>
      h.id !== z.id &&
      h.kind !== "parking" &&
      !!h.geometry.polygon &&
      zoneSheet(h) === zoneSheet(z) &&
      polygonArea(h.geometry.polygon) >= area * 1.5 &&
      pointInPolygon(center, h.geometry.polygon),
  );
}

/** 딴 선을 바깥으로 offset(m) 띄운 선의 면적·둘레 */
function measureGeom(poly: Pt[], unit: "mm" | "m", offset: number | undefined) {
  return measurePolygon(offset ? offsetPolygon(poly, offset / unitFactor(unit)) : poly, unit);
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
