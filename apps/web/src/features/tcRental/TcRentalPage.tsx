/**
 * TC 임대계획 — 동별 골조 공정으로 타워크레인·호이스트 임대기간을 산정한다.
 *
 * 탭 3개가 한 방향으로 흐른다: ① 골조를 정형화하고 → ② 호기를 배정하고 → ③ 임대 구간이 나온다.
 * ③의 해체일은 다시 ①의 공정표 위에 초록 마커로 찍혀, 현장에서 쓰던 예정공정표와
 * 같은 모양으로 완성된다.
 *
 * 저장은 아직 브라우저 초안 + 파일이다(Supabase 이관은 다음 단계). 초안은 원천이 아니라
 * 새로고침으로 날아가는 것을 막는 안전망이며, 계획 파일로 내보내야 남는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  Grid3x3,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  TowerControl,
  CalendarRange,
  FolderOpen,
  Save,
  FileDown,
} from "lucide-react";
import * as XLSX from "xlsx";

import ToolShell from "./components/ToolShell";
import FrameMatrix, { type DismantleMarker } from "./components/FrameMatrix";
import UnitAssignment from "./components/UnitAssignment";
import RentalTimeline from "./components/RentalTimeline";
import ParamsDrawer from "./components/ParamsDrawer";
import ProjectBrowser from "./components/ProjectBrowser";
import BudgetCompare from "./components/BudgetCompare";
import { useLoadPlan, useSaveRevision } from "./hooks";

import type {
  BuildingFrameProfile,
  EquipmentKind,
  HeightBand,
  RentalParams,
  TcRentalPlan,
} from "./types";
import { DEFAULT_PARAMS, mergeParams } from "./engine/constants";
import { addDays, diffDays, maxYmd, minYmd, shortYmd, todayYmd } from "./engine/dates";
import {
  emptySegments,
  floorFinish,
  frameFinish,
  frameStart,
  frameTotalDays,
  interpolateSegments,
  resolveWinterCuring,
} from "./engine/profile";
import {
  calcAllSpans,
  suggestHoistAssignment,
  suggestTowerCraneAssignment,
} from "./engine/rental";
import {
  clearDraft,
  downloadPlanJson,
  importCraneInput,
  loadDraft,
  readPlanJson,
  saveDraft,
} from "./io";
import { buildSamplePlan } from "./sample";
import { budgetCycleOf, budgetHoistRow, budgetTcRow } from "./engine/budgetStandard";
import { generateTcOrderForm } from "./tcOrderForm";
import { generateHcOrderForm } from "./hcOrderForm";

type TabKey = "frame" | "assign" | "rental";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Grid3x3; hint: string }> = [
  { key: "frame", label: "골조 정형표", icon: Grid3x3, hint: "동별 층별 골조 구간" },
  { key: "assign", label: "호기 배정", icon: TowerControl, hint: "동 × 호기 배정" },
  { key: "rental", label: "임대기간 산정", icon: CalendarRange, hint: "설치~해체 구간과 유휴" },
];

export default function TcRentalPage() {
  const [plan, setPlan] = useState<TcRentalPlan | null>(null);
  const [tab, setTab] = useState<TabKey>("frame");
  const [paramsOpen, setParamsOpen] = useState(false);
  /** 서버에 연결된 세부 프로젝트. null = 아직 저장 대상이 없는 로컬 작업 */
  const [project, setProject] = useState<{ id: string; name: string; revNo: number } | null>(null);
  /**
   * 도구에 들어오면 **프로젝트 화면부터** 연다 — 단열 Layout 과 같은 시작점이다.
   * 초안은 그대로 복원해 두고 그 위에 띄운다. 닫으면(X) 하던 작업으로 돌아간다.
   */
  const [browserOpen, setBrowserOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPlan = useLoadPlan();
  const saveRevision = useSaveRevision();

  // 초안 복원 — 원천이 아니라 안전망이다
  useEffect(() => {
    const draft = loadDraft();
    if (draft) setPlan(draft);
  }, []);

  useEffect(() => {
    if (plan) saveDraft(plan);
  }, [plan]);

  const update = useCallback((fn: (p: TcRentalPlan) => TcRentalPlan) => {
    setPlan((prev) => (prev ? { ...fn(prev), updatedAt: new Date().toISOString() } : prev));
  }, []);

  // ── 파생 값 ──
  const spans = useMemo(
    () =>
      plan ? calcAllSpans(plan.units, plan.buildings, plan.assignments, plan.params) : [],
    [plan],
  );

  const unitLabels = useMemo(() => {
    const map = new Map<string, { text: string; nos: number[] }>();
    if (!plan) return map;
    for (const b of plan.buildings) {
      const nos = plan.assignments
        .filter((a) => a.buildingId === b.id)
        .map((a) => plan.units.find((u) => u.id === a.unitId))
        .filter((u): u is NonNullable<typeof u> => !!u && u.kind === "tc")
        .map((u) => u.no)
        .sort((x, y) => x - y);
      map.set(b.id, { text: nos.length ? `${nos.join(",")}호기` : "", nos });
    }
    return map;
  }, [plan]);

  /** 해체 마커 — 호기가 마지막으로 담당한 동의 행에 찍는다 */
  const markers = useMemo<DismantleMarker[]>(() => {
    if (!plan) return [];
    const byId = new Map(plan.buildings.map((b) => [b.id, b]));
    const out: DismantleMarker[] = [];
    for (const s of spans) {
      if (s.problem || s.kind !== "tc" || !s.demobEnd) continue;
      let lastId: string | null = null;
      let lastFinish: string | null = null;
      for (const id of s.buildingIds) {
        const b = byId.get(id);
        if (!b) continue;
        const f = frameFinish(b);
        if (f && (!lastFinish || f > lastFinish)) {
          lastFinish = f;
          lastId = id;
        }
      }
      if (lastId) {
        out.push({
          buildingId: lastId,
          date: s.demobEnd,
          label: `${s.no}호기 해체`,
          unitNo: s.no,
        });
      }
    }
    return out;
  }, [plan, spans]);

  /** 가로축 범위 — 공정표와 임대 구간을 모두 담고 양옆에 한 달씩 여유를 준다 */
  const axis = useMemo(() => {
    const starts: Array<string | null> = [];
    const ends: Array<string | null> = [];
    for (const b of plan?.buildings ?? []) {
      starts.push(frameStart(b));
      ends.push(frameFinish(b));
    }
    for (const s of spans) {
      if (s.problem) continue;
      starts.push(s.mobilizeStart);
      ends.push(s.demobEnd);
    }
    const from = minYmd(starts);
    const to = maxYmd(ends);
    const today = todayYmd();
    return {
      from: from ? addDays(from, -20) : today,
      to: to ? addDays(to, 20) : addDays(today, 365),
    };
  }, [plan, spans]);

  // ── 동 편집 ──
  const setRange = useCallback(
    (buildingId: string, start: string | null, finish: string | null) => {
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          const segs = b.segments.map((s) => ({ ...s }));
          if (segs.length === 0) return b;
          // 양 끝만 고정하고 나머지는 비워서 다시 보간시킨다
          const first = segs[0];
          const last = segs[segs.length - 1];
          const keepDays = 30;
          if (start) {
            first.start = start;
            first.finish = addDays(start, keepDays - 1);
            first.source = "manual";
          }
          if (finish) {
            last.finish = finish;
            last.start = addDays(finish, -(keepDays - 1));
            last.source = "manual";
          }
          for (let i = 1; i < segs.length - 1; i += 1) {
            segs[i].start = null;
            segs[i].finish = null;
            segs[i].source = "missing";
          }
          return {
            ...b,
            segments: interpolateSegments(segs, b.aboveFloors, p.params, start ?? null),
          };
        }),
      }));
    },
    [update],
  );

  /** 동 전체를 days 만큼 민다 — 막대를 끌었을 때. 층 사이 간격은 그대로 유지된다 */
  const shiftBuilding = useCallback(
    (buildingId: string, days: number) => {
      if (!days) return;
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) =>
          b.id === buildingId
            ? {
                ...b,
                segments: b.segments.map((s) => ({
                  ...s,
                  start: s.start ? addDays(s.start, days) : null,
                  finish: s.finish ? addDays(s.finish, days) : null,
                })),
              }
            : b,
        ),
      }));
    },
    [update],
  );

  /**
   * 한 층의 기간만 늘리거나 줄인다 — 그 뒤 층은 같은 일수만큼 함께 밀린다.
   * 재보간하지 않으므로 손으로 맞춘 다른 층은 그대로 남는다.
   */
  const resizeSegment = useCallback(
    (buildingId: string, segmentKey: string, days: number) => {
      if (!days) return;
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          const idx = b.segments.findIndex((s) => s.key === segmentKey);
          if (idx < 0) return b;
          const target = b.segments[idx];
          if (!target.start || !target.finish) return b;
          // 하루 미만으로는 줄이지 않는다
          const nextFinish = addDays(target.finish, days);
          if (diffDays(target.start, nextFinish) < 0) return b;
          return {
            ...b,
            segments: b.segments.map((s, i) => {
              if (i < idx) return s;
              if (i === idx) return { ...s, finish: nextFinish, source: "manual" as const };
              return {
                ...s,
                start: s.start ? addDays(s.start, days) : null,
                finish: s.finish ? addDays(s.finish, days) : null,
              };
            }),
          };
        }),
      }));
    },
    [update],
  );

  /**
   * 전체 기간을 늘리거나 줄인다 — 층별 비율은 그대로 두고 길이만 신축한다.
   * 커서를 이어 붙여 계산하므로 반올림 오차가 누적돼 층 사이가 벌어지지 않는다.
   */
  const scaleBuilding = useCallback(
    (buildingId: string, days: number) => {
      if (!days) return;
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          const first = b.segments.find((s) => s.start && s.finish);
          const start = first?.start;
          const total = b.segments.reduce(
            (a, s) => a + (s.start && s.finish ? diffDays(s.start, s.finish) + 1 : 0),
            0,
          );
          if (!start || total <= 0 || total + days < 30) return b;
          const factor = (total + days) / total;
          let cursor = start;
          return {
            ...b,
            segments: b.segments.map((s) => {
              if (!s.start || !s.finish) return s;
              const len = Math.max(1, Math.round((diffDays(s.start, s.finish) + 1) * factor));
              const next = { ...s, start: cursor, finish: addDays(cursor, len - 1) };
              cursor = addDays(next.finish, 1);
              return next;
            }),
          };
        }),
      }));
    },
    [update],
  );

  const changeBuilding = useCallback(
    (
      buildingId: string,
      patch: Partial<Pick<BuildingFrameProfile, "name" | "belowFloors" | "aboveFloors">>,
    ) => {
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          const next = { ...b, ...patch };
          if (patch.belowFloors === undefined && patch.aboveFloors === undefined) return next;
          // 층 구성이 바뀌면 행을 다시 만들고, 남아 있던 날짜는 층 번호로 되살린다
          const prevByFloor = new Map(b.segments.map((s) => [s.floor, s]));
          const rebuilt = emptySegments(
            next.belowFloors,
            next.aboveFloors,
            next.phFloors,
          ).map((s) => {
            const old = prevByFloor.get(s.floor);
            if (old?.start && old.finish && old.source !== "estimated") {
              return { ...s, start: old.start, finish: old.finish, source: old.source };
            }
            return s;
          });
          return {
            ...next,
            segments: interpolateSegments(
              rebuilt,
              next.aboveFloors,
              p.params,
              frameStart(b) ?? todayYmd(),
            ),
          };
        }),
      }));
    },
    [update],
  );

  const addBuilding = useCallback(() => {
    update((p) => {
      const n = p.buildings.length + 1;
      const start = maxYmd(p.buildings.map((b) => frameStart(b))) ?? todayYmd();
      const base = emptySegments(2, 15, 1);
      base[0].start = start;
      base[0].finish = addDays(start, 39);
      base[0].source = "manual";
      return {
        ...p,
        buildings: [
          ...p.buildings,
          {
            id: `b-new-${Date.now()}`,
            name: `${100 + n}동`,
            belowFloors: 2,
            aboveFloors: 15,
            phFloors: 1,
            segments: interpolateSegments(base, 15, p.params, start),
          },
        ],
      };
    });
  }, [update]);

  const removeBuilding = useCallback(
    (buildingId: string) => {
      update((p) => ({
        ...p,
        buildings: p.buildings.filter((b) => b.id !== buildingId),
        assignments: p.assignments.filter((a) => a.buildingId !== buildingId),
      }));
    },
    [update],
  );

  /** 호이스트 동별 설정 — 설치 기준층 / EV 설치완료 예정일 */
  const changeHoist = useCallback(
    (
      buildingId: string,
      patch: {
        hoistAnchorFloor?: number | null;
        hoistPostFrameMonths?: number | null;
        hoistBaseHeight?: number | null;
        hoistHeightBands?: HeightBand[] | null;
      },
    ) => {
      update((p) => ({
        ...p,
        buildings: p.buildings.map((b) => (b.id === buildingId ? { ...b, ...patch } : b)),
      }));
    },
    [update],
  );

  // ── 호기 편집 ──
  const toggleAssignment = useCallback(
    (unitId: string, buildingId: string) => {
      update((p) => {
        const exists = p.assignments.some(
          (a) => a.unitId === unitId && a.buildingId === buildingId,
        );
        return {
          ...p,
          assignments: exists
            ? p.assignments.filter((a) => !(a.unitId === unitId && a.buildingId === buildingId))
            : [...p.assignments, { unitId, buildingId }],
        };
      });
    },
    [update],
  );

  const addUnit = useCallback(
    (kind: EquipmentKind) => {
      update((p) => {
        const nos = p.units.filter((u) => u.kind === kind).map((u) => u.no);
        const no = (nos.length ? Math.max(...nos) : 0) + 1;
        return { ...p, units: [...p.units, { id: `${kind}-${no}-${Date.now()}`, kind, no }] };
      });
    },
    [update],
  );

  const removeUnit = useCallback(
    (unitId: string) => {
      update((p) => ({
        ...p,
        units: p.units.filter((u) => u.id !== unitId),
        assignments: p.assignments.filter((a) => a.unitId !== unitId),
      }));
    },
    [update],
  );

  const autoSuggest = useCallback(
    (kind: EquipmentKind) => {
      update((p) => {
        const made =
          kind === "tc"
            ? suggestTowerCraneAssignment(p.buildings, p.params)
            : suggestHoistAssignment(p.buildings);
        if (made.units.length === 0) {
          toast.error("골조 일정이 있는 동이 없어 제안할 수 없습니다.");
          return p;
        }
        toast.success(
          `${kind === "tc" ? "타워크레인" : "호이스트"} ${made.units.length}대로 제안했습니다.`,
        );
        return {
          ...p,
          units: [...p.units.filter((u) => u.kind !== kind), ...made.units],
          assignments: [
            ...p.assignments.filter((a) =>
              p.units.some((u) => u.id === a.unitId && u.kind !== kind),
            ),
            ...made.assignments,
          ],
        };
      });
    },
    [update],
  );

  const setParams = useCallback(
    (next: RentalParams) => update((p) => ({ ...p, params: next })),
    [update],
  );

  // ── 가져오기 / 내보내기 ──
  const handleFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const asPlan = (json as { format?: string })?.format === "smartdeck.tc-rental-plan";
      if (asPlan) {
        setPlan(readPlanJson(json));
        toast.success("저장해 둔 계획을 불러왔습니다.");
        return;
      }
      const { plan: imported, notes } = importCraneInput(json);
      setPlan(imported);
      toast.success(`${imported.buildings.length}개 동을 가져왔습니다.`);
      for (const n of notes) toast.info(n, { duration: 6000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "파일을 읽지 못했습니다.");
    }
  }, []);

  /**
   * 엑셀 산정표 — 회사가 쓰던 양식(타워크레인 / 건설용리프트)을 시트로 나눠 뽑는다.
   * 견적팀이 그대로 받아 쓰도록 컬럼 이름과 순서를 원본에 맞췄다.
   */
  const exportExcel = useCallback(() => {
    if (!plan) return;
    const byId = new Map(plan.buildings.map((b) => [b.id, b]));
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const cycle = budgetCycleOf(plan.params);
    /** 일수 → 월 (회사 양식과 같은 30.4일/월) */
    const toMonths = (days: number) => round1(days / 30.4);

    const wb = XLSX.utils.book_new();

    // ── ① 타워크레인 산정 ──
    const tcHead = [
      ["[ 타워크레인 임대기간 산정 ]"],
      [`현장명 : ${plan.siteName}`],
      [
        `※ 해체시기: 골조완료 + ${plan.params.tc.postFrameMonths}개월 (전 동 동일 적용)` +
          ` · 설치 ${plan.params.tc.installDays}일 · 해체 ${plan.params.tc.dismantleDays}일`,
      ],
      [
        `※ 실행기준: 기초 ${cycle.foundation} · 지하 ${cycle.basement} · 1층 ${cycle.floor1}` +
          ` · 기준 ${cycle.typical} · 최상 ${cycle.top} · 옥탑 ${cycle.roof}일` +
          ` → ROUNDUP(최장 동 공기/365×12) + ${cycle.tcAddMonths}개월`,
      ],
      [],
      [
        "현장",
        "타워",
        "동",
        "지하",
        "지상",
        "1F 제외",
        "옥탑",
        "골조공기(일)",
        "골조공기(월)",
        "임대개월(현장)",
        "임대개월(실행기준)",
        "차이",
        "반입·설치",
        "가동 개시",
        "가동 종료",
        "해체 완료",
      ],
    ];
    const tcRows: unknown[][] = [];
    let tcMonthSum = 0;
    let tcBudgetSum = 0;
    for (const sp of spans.filter((x) => x.kind === "tc")) {
      if (sp.problem) continue;
      const targets = sp.buildingIds
        .map((id) => byId.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const budget = budgetTcRow(sp.no, targets, cycle).rentalMonths;
      tcMonthSum += sp.rentalMonths;
      tcBudgetSum += budget;
      sp.buildingIds.forEach((id, idx) => {
        const b = byId.get(id);
        if (!b) return;
        const days = frameTotalDays(b);
        tcRows.push([
          idx === 0 ? plan.siteName : "",
          idx === 0 ? `${sp.no}호기` : "",
          b.name,
          b.belowFloors,
          b.aboveFloors,
          Math.max(0, b.aboveFloors - 1),
          b.phFloors,
          days,
          toMonths(days),
          idx === 0 ? sp.rentalMonths : "",
          idx === 0 ? budget : "",
          idx === 0 ? sp.rentalMonths - budget : "",
          idx === 0 ? sp.mobilizeStart : "",
          idx === 0 ? sp.activeStart : "",
          idx === 0 ? sp.activeEnd : "",
          idx === 0 ? sp.demobEnd : "",
        ]);
      });
    }
    tcRows.push([]);
    tcRows.push([
      "합 계", "", "", "", "", "", "", "", "",
      tcMonthSum, tcBudgetSum, tcMonthSum - tcBudgetSum,
    ]);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([...tcHead, ...tcRows]),
      "타워크레인 산정",
    );

    // ── ② 건설용리프트(호이스트) 산정 ──
    const hcHead = [
      ["[ 건설용 리프트 임대기간 산정 ]"],
      [`현장명 : ${plan.siteName}`],
      [
        `※ 해체시기: 동별 골조완료 + ${plan.params.hc.postFrameMonths}개월` +
          ` · 설치 기준층 ${plan.params.hc.anchorFloor}F · 설치 ${plan.params.hc.installDays}일` +
          ` · 해체 ${plan.params.hc.dismantleDays}일`,
      ],
      [
        `※ 실행기준: 기준 ${cycle.typical} × (지상 − ${cycle.hoistSkipFloors}) + 최상 ${cycle.top}` +
          ` + 옥탑 ${cycle.roof} → ROUNDUP(공기/365×12 + ${cycle.hoistAddMonths})`,
      ],
      [],
      [
        "동",
        "지상",
        "1~4F, 최상층 제외",
        "최상층",
        "옥탑",
        "공기(일)",
        "골조완료(월)",
        "임대기간(월)",
        "임대개월(현장)",
        "임대개월(실행기준)",
        "차이",
        "설치 기준층",
        "설치 착수",
        "해체 완료",
        "호기",
      ],
    ];
    const hcRows: unknown[][] = [];
    let hcMonthSum = 0;
    let hcBudgetSum = 0;
    for (const sp of spans.filter((x) => x.kind === "hc")) {
      if (sp.problem) continue;
      const targets = sp.buildingIds
        .map((id) => byId.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const budget = targets.length
        ? targets
            .map((b) => budgetHoistRow(sp.no, b, cycle).rentalMonths)
            .reduce((a, x) => Math.max(a, x), 0)
        : 0;
      hcMonthSum += sp.rentalMonths;
      hcBudgetSum += budget;
      sp.buildingIds.forEach((id, idx) => {
        const b = byId.get(id);
        if (!b) return;
        const days = frameTotalDays(b);
        const anchor = b.hoistAnchorFloor ?? plan.params.hc.anchorFloor;
        const post = b.hoistPostFrameMonths ?? plan.params.hc.postFrameMonths;
        hcRows.push([
          b.name,
          b.aboveFloors,
          Math.max(0, b.aboveFloors - plan.params.hc.anchorFloor - 1),
          1,
          b.phFloors,
          days,
          toMonths(days),
          round1(toMonths(days) + post),
          idx === 0 ? sp.rentalMonths : "",
          idx === 0 ? budget : "",
          idx === 0 ? sp.rentalMonths - budget : "",
          `${anchor}F`,
          floorFinish(b, anchor) ?? "",
          sp.demobEnd,
          idx === 0 ? `${sp.no}호기` : "",
        ]);
      });
    }
    hcRows.push([]);
    hcRows.push([
      "합 계", "", "", "", "", "", "", "",
      hcMonthSum, hcBudgetSum, hcMonthSum - hcBudgetSum,
    ]);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([...hcHead, ...hcRows]),
      "건설용리프트 산정",
    );

    // ── ③ 골조 정형표 (원 데이터) ──
    const frameRows = plan.buildings.map((b) => {
      const wc = resolveWinterCuring(b, plan.params);
      return {
        동: b.name,
        지하층: b.belowFloors > 0 ? `B${b.belowFloors}` : "",
        지상층: `${b.aboveFloors}F`,
        옥탑: b.phFloors,
        타워: unitLabels.get(b.id)?.text ?? "",
        착수: frameStart(b) ?? "",
        완료: frameFinish(b) ?? "",
        소요일수: frameTotalDays(b),
        "동절기보양(지하)": wc.basement,
        "동절기보양(기준층)": wc.typical,
        "동절기보양(옥탑)": wc.rooftop,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(frameRows), "골조 정형표");

    XLSX.writeFile(wb, `${plan.siteName}_TC·HOIST 임대기간산정.xlsx`);
  }, [plan, spans, unitLabels]);

  /** 세부 프로젝트(또는 특정 REV) 열기 — 브라우저에서 고른 결과가 여기로 온다 */
  const openProject = useCallback(
    async (projectId: string, revId: string | null) => {
      try {
        const { project: row, plan: loaded, revNo } = await loadPlan(projectId, revId);
        setProject({ id: row.id, name: row.name, revNo });
        setBrowserOpen(false);
        if (loaded) {
          setPlan({ ...loaded, params: mergeParams(loaded.params) });
          toast.success(`'${row.name}' REV ${String(revNo).padStart(2, "0")} 을(를) 불러왔습니다.`);
        } else {
          // REV 가 아직 없는 새 프로젝트 — 빈 계획으로 시작한다
          setPlan({
            siteName: row.name,
            sourceLabel: "새 계획",
            buildings: [],
            units: [],
            assignments: [],
            params: DEFAULT_PARAMS,
            updatedAt: new Date().toISOString(),
          });
          toast.info("저장된 REV 가 없어 빈 계획으로 시작합니다.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "불러오기 실패");
      }
    },
    [loadPlan],
  );

  /** 현재 계획을 새 REV 로 저장 */
  const saveAsRevision = useCallback(async () => {
    if (!plan) return;
    if (!project) {
      toast.error("저장할 세부 프로젝트를 먼저 고르세요.");
      setBrowserOpen(true);
      return;
    }
    const memo = window.prompt("REV 메모 (선택) — 무엇을 바꿨는지 한 줄")?.trim() ?? "";
    try {
      const valid = spans.filter((sp) => !sp.problem);
      const revision = await saveRevision.mutateAsync({
        projectId: project.id,
        plan,
        summary: {
          siteName: plan.siteName,
          buildings: plan.buildings.length,
          units: valid.length,
          totalMonths: valid.reduce((a, sp) => a + sp.rentalMonths, 0),
          idleDays: valid.reduce((a, sp) => a + sp.idleGaps.reduce((x, g) => x + g.days, 0), 0),
        },
        memo: memo || undefined,
      });
      setProject((prev) => (prev ? { ...prev, revNo: revision.rev_no } : prev));
      toast.success(`REV ${String(revision.rev_no).padStart(2, "0")} 저장됨`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 실패");
    }
  }, [plan, project, spans, saveRevision]);
  /** 타워크레인 발주의뢰서 — 회사 표준 양식을 채워 내려받는다 */
  const exportTcOrderForm = useCallback(async () => {
    if (!plan) return;
    try {
      await generateTcOrderForm({ plan, spans });
      toast.success("타워크레인 발주의뢰서를 내려받았습니다.", {
        description: "표지 · 내역서 · 산출서 · 발주수량 검토 · 임대기간 · 건널다리 · 현장산출검토 7개 탭",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "발주의뢰서 생성에 실패했습니다.");
    }
  }, [plan, spans]);

  /** 건설용리프트 발주의뢰서 — 회사 표준 양식을 채워 내려받는다 */
  const exportHcOrderForm = useCallback(async () => {
    if (!plan) return;
    try {
      const warn = await generateHcOrderForm({ plan, spans });
      toast.success("건설용리프트 발주의뢰서를 내려받았습니다.", {
        description:
          warn.length > 0
            ? warn.join(" · ")
            : "갑지 · 내역서 · 임대기간 · 임대기간산출 · 설치높이 · 입면도 등 9개 탭",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "발주의뢰서 생성에 실패했습니다.");
    }
  }, [plan, spans]);

  const resetAll = useCallback(() => {
    clearDraft();
    setPlan(null);
    setProject(null);
    setTab("frame");
  }, []);

  // ── 렌더 ──
  if (!plan) {
    return (
      <ToolShell title="TC/HOIST 발주의뢰서">
        <StartPanel
          onOpenBrowser={() => setBrowserOpen(true)}
          onPickFile={() => fileRef.current?.click()}
          onSample={() => {
            setPlan(buildSamplePlan());
            toast.success("예시 현장을 불러왔습니다.");
          }}
          onBlank={() =>
            setPlan({
              siteName: "새 현장",
              sourceLabel: "직접 입력",
              buildings: [],
              units: [],
              assignments: [],
              params: DEFAULT_PARAMS,
              updatedAt: new Date().toISOString(),
            })
          }
          onDropFile={handleFile}
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {browserOpen && (
          <ProjectBrowser
            onClose={() => setBrowserOpen(false)}
            currentProjectId={project?.id ?? null}
            onOpen={(pid, rid) => void openProject(pid, rid)}
          />
        )}
      </ToolShell>
    );
  }

  return (
    <ToolShell
      title="TC/HOIST 발주의뢰서"
      subtitle={
        <span className="flex items-center gap-1.5 text-[13.5px] text-slate-400">
          {plan.siteName} · {plan.sourceLabel}
          {project && (
            <span className="rounded-full bg-[#eef5fd] px-2 py-0.5 text-[12.5px] font-bold text-[#0a63b8]">
              {project.name} · REV {String(project.revNo).padStart(2, "0")}
            </span>
          )}
        </span>
      }
      actions={
        <div className="flex items-center gap-1.5">
          <HeaderButton icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => setBrowserOpen(true)}>
            프로젝트
          </HeaderButton>
          <button
            type="button"
            onClick={() => void saveAsRevision()}
            disabled={saveRevision.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0a63b8] px-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#08508f] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden md:inline">REV 저장</span>
          </button>
          <HeaderButton icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
            가져오기
          </HeaderButton>
          {/*
            DB(REV 저장)가 정식 보관 경로다. 이 버튼은 파일로 빼두는 백업·공유용으로만 남긴다
            — 스마트덱 접근 권한이 없는 사람에게 넘기거나, 저장 전에 손에 쥐고 싶을 때.
          */}
          <HeaderButton
            icon={<FileJson className="h-3.5 w-3.5" />}
            onClick={() => downloadPlanJson(plan)}
            title="파일로 백업 — 정식 보관은 [REV 저장]입니다"
          >
            백업(JSON)
          </HeaderButton>
          <HeaderButton icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={exportExcel}>
            엑셀
          </HeaderButton>
          <HeaderButton icon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setParamsOpen(true)}>
            파라미터
          </HeaderButton>
          <button
            type="button"
            onClick={resetAll}
            title="처음 화면으로 (저장하지 않은 작업은 사라집니다)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <RotateCcw className="h-[15px] w-[15px]" />
          </button>
        </div>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {/* 탭 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14.5px] font-semibold transition-all " +
                  (on
                    ? "bg-[#0a63b8] text-white shadow-[0_6px_16px_-8px_rgba(10,99,184,0.9)]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
                }
              >
                <span
                  className={
                    "flex h-4 w-4 items-center justify-center rounded text-[9.5px] font-bold " +
                    (on ? "bg-white/25" : "bg-slate-100 text-slate-400")
                  }
                >
                  {i + 1}
                </span>
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void exportTcOrderForm()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
          >
            <FileDown className="h-4 w-4" />
            타워 발주의뢰서
          </button>
          <button
            type="button"
            onClick={() => void exportHcOrderForm()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
          >
            <FileDown className="h-4 w-4" />
            호이스트 발주의뢰서
          </button>
          <span className="ml-1 text-[13px] tabular-nums text-slate-400">
            {plan.buildings.length}개 동 · 축 {shortYmd(axis.from)} ~ {shortYmd(axis.to)}
          </span>
        </div>
      </div>

      {tab === "frame" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] leading-relaxed text-slate-500">
              막대를 끌면 동 전체가 이동하고, 막대 오른쪽 끝을 끌면 그 층 기간만 바뀝니다(뒤 층은 함께 밀림).
              <span className="ml-1.5 text-slate-400">빗금 = 추정 구간</span>
            </p>
            <button
              type="button"
              onClick={addBuilding}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[14px] font-semibold text-slate-600 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
            >
              <Plus className="h-3.5 w-3.5" />동 추가
            </button>
          </div>
          {plan.buildings.length === 0 ? (
            <EmptyHint
              text="등록된 동이 없습니다. [동 추가] 로 직접 입력하거나, 스마트웍스 내보내기 JSON 을 가져오세요."
            />
          ) : (
            <>
              <FrameMatrix
                buildings={plan.buildings}
                params={plan.params}
                axisFrom={axis.from}
                axisTo={axis.to}
                unitLabels={unitLabels}
                markers={markers}
                onChangeRange={setRange}
                onChangeBuilding={changeBuilding}
                onRemoveBuilding={removeBuilding}
                onShiftBuilding={shiftBuilding}
                onResizeSegment={resizeSegment}
                onScaleBuilding={scaleBuilding}
              />
              {/* 공정표 바로 아래에서 실행기준과 견줘 본다 — 탭을 옮기지 않고 비교하려고 */}
              <BudgetCompare spans={spans} buildings={plan.buildings} params={plan.params} />
            </>
          )}
        </div>
      )}

      {tab === "assign" &&
        (plan.buildings.length === 0 ? (
          <EmptyHint text="먼저 ① 골조 정형표에서 동을 등록하세요." />
        ) : (
          <UnitAssignment
            buildings={plan.buildings}
            units={plan.units}
            assignments={plan.assignments}
            spans={spans}
            axisFrom={axis.from}
            axisTo={axis.to}
            params={plan.params}
            onToggle={toggleAssignment}
            onAddUnit={addUnit}
            onRemoveUnit={removeUnit}
            onAutoSuggest={autoSuggest}
            onChangeHoist={changeHoist}
          />
        ))}

      {tab === "rental" &&
        (plan.units.length === 0 ? (
          <EmptyHint text="먼저 ② 호기 배정에서 호기를 등록하세요. [자동 제안] 을 쓰면 한 번에 만들어집니다." />
        ) : (
          <RentalTimeline
            spans={spans}
            buildings={plan.buildings}
            axisFrom={axis.from}
            axisTo={axis.to}
            params={plan.params}
          />
        ))}

      <ParamsDrawer
        open={paramsOpen}
        params={plan.params}
        onChange={setParams}
        onClose={() => setParamsOpen(false)}
      />

      {browserOpen && (
        <ProjectBrowser
          onClose={() => setBrowserOpen(false)}
          currentProjectId={project?.id ?? null}
          onOpen={(pid, rid) => void openProject(pid, rid)}
        />
      )}
    </ToolShell>
  );
}

function HeaderButton({
  icon,
  onClick,
  title,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[13.5px] font-semibold text-slate-600 transition-colors hover:border-[#0a63b8]/40 hover:text-[#0a63b8]"
    >
      {icon}
      <span className="hidden md:inline">{children}</span>
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center text-[14.5px] leading-relaxed text-slate-400">
      {text}
    </div>
  );
}

/** 시작 화면 — 무엇부터 해야 하는지 세 갈래로 보여준다 */
function StartPanel({
  onOpenBrowser,
  onPickFile,
  onSample,
  onBlank,
  onDropFile,
}: {
  onOpenBrowser: () => void;
  onPickFile: () => void;
  onSample: () => void;
  onBlank: () => void;
  onDropFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div className="mx-auto w-full max-w-5xl pt-6">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef5fd] px-3 py-1 text-[13px] font-bold text-[#0a63b8] ring-1 ring-[#dceaf9]">
          <Sparkles className="h-3.5 w-3.5" />
          골조 공정 → 임대기간
        </span>
        <h1 className="mt-3 text-[26px] font-bold tracking-tight text-slate-800">
          TC/HOIST 발주의뢰서
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-[13.5px] leading-relaxed text-slate-500">
          동별 골조 일정에 호기를 배정하면 장비마다 언제 들어와 언제 나가는지, 그 사이 며칠을
          서 있기만 하는지 계산합니다.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(f);
        }}
        className={
          "mt-8 rounded-2xl border-2 border-dashed p-6 transition-colors " +
          (over ? "border-[#0a63b8] bg-[#f2f8ff]" : "border-slate-300 bg-white/70")
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StartCard
            badge="권장"
            icon={<FolderOpen className="h-5 w-5" />}
            title="현장 프로젝트 열기"
            desc="저장해 둔 현장·세부 프로젝트를 열면 마지막 REV 의 골조와 호기 배정이 그대로 복원됩니다."
            action="현장 고르기"
            onClick={onOpenBrowser}
            primary
          />
          <StartCard
            icon={<Download className="h-5 w-5" />}
            title="스마트웍스에서 가져오기"
            desc="공정표에서 내보낸 JSON 을 올리면 동·층 일정이 그대로 들어옵니다. 파일을 이 영역에 끌어다 놓아도 됩니다."
            action="파일 선택"
            onClick={onPickFile}
          />
          <StartCard
            icon={<Sparkles className="h-5 w-5" />}
            title="예시로 둘러보기"
            desc="11개 동 · 타워크레인 6대 규모의 예시 현장을 불러옵니다. 층별 일정은 추정값입니다."
            action="예시 불러오기"
            onClick={onSample}
          />
          <StartCard
            icon={<Plus className="h-5 w-5" />}
            title="직접 입력"
            desc="동명·층수·골조 기간만 넣으면 사이 층은 공기산정 표준값으로 채워집니다."
            action="빈 계획 시작"
            onClick={onBlank}
          />
        </div>
      </div>

      <p className="mt-5 text-center text-[13px] leading-relaxed text-slate-400">
        작업 중인 내용은 이 브라우저에 임시 보관됩니다. 다른 기기에서 이어서 하려면
        <span className="mx-1 font-semibold text-slate-500">[계획 저장]</span>
        으로 파일을 내려받으세요.
      </p>
    </div>
  );
}

function StartCard({
  badge,
  icon,
  title,
  desc,
  action,
  onClick,
  primary,
}: {
  badge?: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-20px_rgba(0,71,145,0.3)]">
      <div className="flex items-center justify-between">
        <span
          className={
            "flex h-10 w-10 items-center justify-center rounded-xl " +
            (primary ? "bg-[#0a63b8] text-white" : "bg-slate-100 text-slate-500")
          }
        >
          {icon}
        </span>
        {badge && (
          <span className="rounded-full bg-[#eef5fd] px-2 py-0.5 text-[10.5px] font-bold text-[#0a63b8]">
            {badge}
          </span>
        )}
      </div>
      <h3 className="mt-3.5 text-[14px] font-bold text-slate-800">{title}</h3>
      <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-slate-500">{desc}</p>
      <button
        type="button"
        onClick={onClick}
        className={
          "mt-4 h-9 w-full rounded-lg text-[14.5px] font-bold transition-colors " +
          (primary
            ? "bg-[#0a63b8] text-white hover:bg-[#08508f]"
            : "border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50")
        }
      >
        {action}
      </button>
    </div>
  );
}
