/**
 * TakeoffPanel — 마감 물량 산출 + 기성 관리 대화상자 (오토콘 리본 [적산] 탭에서 연다).
 *
 * 3개 탭
 *   · 물량 산출 : 도면 분석 결과 · 추적된 실 목록 · 마감재별 집계
 *   · 세대 대장 : 규칙 생성 / Excel 붙여넣기
 *   · 기성      : 범위 문자열 + 미리보기 · 층×호 그리드 · 산출/검증
 *
 * 엔진(Python)이 꺼져 있으면 그 사실을 명확히 알린다 — 조용히 빈 화면을 두지 않는다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import BillingGrid from "./BillingGrid";
import * as api from "./api";

type Tab = "takeoff" | "registry" | "billing";

export interface PickedRoom {
  name: string;
  polygon: [number, number][];
  area_m2: number;
  approx: boolean;
}

export interface TakeoffPanelProps {
  onClose: () => void;
  /** 현재 도면 DXF 원문 — 있으면 열자마자 분석한다. */
  dxfBuffer?: ArrayBuffer | null;
  /** 실 클릭 모드 on/off */
  picking?: boolean;
  onPickingChange?: (v: boolean) => void;
  /** 평면에 하이라이트할 추적 결과 (페이지가 그린다) */
  rooms?: PickedRoom[];
  onRoomsChange?: (r: PickedRoom[]) => void;
  /** 평면 클릭 좌표를 이 패널로 넘겨줄 콜백을 등록한다 */
  registerClickHandler?: (fn: ((x: number, y: number) => void) | null) => void;
}

const KIND_LABEL: Record<string, string> = {
  sheet_floor: "장판/마루",
  floor_tile: "바닥타일",
  wallpaper: "벽 도배",
  ceiling: "천장 도배",
  baseboard: "걸레받이",
};

export default function TakeoffPanel({
  onClose,
  dxfBuffer,
  picking = false,
  onPickingChange,
  rooms: pickedRooms,
  onRoomsChange,
  registerClickHandler,
}: TakeoffPanelProps) {
  const [tab, setTab] = useState<Tab>("takeoff");
  const [alive, setAlive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [analysis, setAnalysis] = useState<api.AnalyzeResult | null>(null);
  const [rooms, setRooms] = useState<api.RoomInput[]>([]);
  // 자동 인식 원본(치수 포함) — AI 검수 입력으로 쓴다
  const [autoRooms, setAutoRooms] = useState<api.AutoRoom[]>([]);
  const [verdicts, setVerdicts] = useState<api.VerifyResult | null>(null);
  const [result, setResult] = useState<api.TakeoffResult | null>(null);

  const [registry, setRegistry] = useState<api.RegistryResult | null>(null);
  const [ruleForm, setRuleForm] = useState({
    buildings: "101,102",
    from: 1,
    to: 15,
    lines: "01=84A, 02=84B",
    exclude: "1",
  });
  const [pasteText, setPasteText] = useState("");

  const [rangeText, setRangeText] = useState("101동 2~10F 전체 @50%");
  const [preview, setPreview] = useState<api.ParsePreview | null>(null);
  const [progress, setProgress] = useState<Record<string, Record<string, number>>>({});
  const [billing, setBilling] = useState<api.BillingResultDto | null>(null);

  useEffect(() => {
    void api.ping().then(setAlive);
  }, []);

  // 도면이 있으면 자동 분석
  useEffect(() => {
    if (!dxfBuffer || analysis || alive === false) return;
    setBusy("도면 분석 중…");
    api
      .analyze(dxfBuffer)
      .then(setAnalysis)
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setBusy(""));
  }, [dxfBuffer, analysis, alive]);

  /**
   * 세션 만료 시 도면을 다시 올려 새 세션을 받는다.
   *
   * 엔진은 도면을 메모리에 들고 있어서 엔진이 재기동되면 세션이 사라진다.
   * 그때마다 사용자가 도면을 다시 여는 건 말이 안 되므로 조용히 복구한다.
   */
  const recoverSession = useCallback(async (): Promise<string | null> => {
    if (!dxfBuffer) return null;
    const a = await api.analyze(dxfBuffer);
    setAnalysis(a);
    return a.session;
  }, [dxfBuffer]);

  const isExpired = (e: unknown) =>
    String((e as Error)?.message ?? e).includes("세션이 만료");

  /** 평면 클릭 → 엔진 추적 → 실 목록/하이라이트 반영 */
  const handleCanvasClick = useCallback(
    async (x: number, y: number) => {
      if (!analysis) {
        setError("도면 분석이 끝난 뒤 클릭하세요.");
        return;
      }
      setBusy("실 추적 중…");
      setError("");
      try {
        let t = await api.trace(analysis.session, x, y, { allowRaster: true }).catch(
          async err => {
            if (!isExpired(err)) throw err;
            setBusy("도면 세션 복구 중…");
            const sid = await recoverSession();
            if (!sid) throw err;
            setBusy("실 추적 중…");
            return api.trace(sid, x, y, { allowRaster: true });
          }
        );
        if (!t.ok || !t.polygon) {
          const msg = t.warnings[0]?.message ?? "실을 추적하지 못했습니다.";
          setError(
            t.touched_border
              ? msg + " (열린 공간으로 새어나감 — 임의 면적을 내지 않습니다)"
              : msg
          );
          return;
        }
        // 엔진이 스냅한 도면 실명을 쓴다 — "실 1" 보다 훨씬 알아보기 쉽다
        const name = t.name || "실 " + (rooms.length + 1);
        setRooms(prev => [
          ...prev,
          {
            name,
            polygon: t.polygon!,
            holes: t.holes,
            is_approximate: !!t.is_approximate,
            openings: [{ width_mm: 900, height_mm: 2100, kind: "door" as const }],
          },
        ]);
        onRoomsChange?.([
          ...(pickedRooms ?? []),
          {
            name,
            polygon: t.polygon,
            area_m2: t.area_m2 ?? 0,
            approx: !!t.is_approximate,
          },
        ]);
      } catch (e) {
        setError(String((e as Error).message));
      } finally {
        setBusy("");
      }
    },
    [analysis, rooms.length, pickedRooms, onRoomsChange, recoverSession]
  );

  useEffect(() => {
    registerClickHandler?.(handleCanvasClick);
    return () => registerClickHandler?.(null);
  }, [registerClickHandler, handleCanvasClick]);

  // 창을 닫았다 열면 이 컴포넌트의 로컬 상태는 사라지지만 평면에 그려진 실
  // (부모가 들고 있는 pickedRooms) 은 남는다. 그대로 두면 "아직 클릭한 실이
  // 없습니다" 라고 뜨면서 실제로는 실이 표시되는 불일치가 생긴다. 부모 목록에서 복원한다.
  useEffect(() => {
    if (rooms.length > 0 || !pickedRooms?.length) return;
    setRooms(
      pickedRooms.map(r => ({
        name: r.name,
        polygon: r.polygon as [number, number][],
        is_approximate: !!r.approx,
        openings: [{ width_mm: 900, height_mm: 2100, kind: "door" as const }],
      }))
    );
    // 최초 복원 1회만 — 이후 편집은 로컬 상태가 원천이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 실명 텍스트 기반 자동 인식 — 클릭 없이 도면 전체 실을 한 번에 잡는다 */
  const runAutoRooms = useCallback(async () => {
    if (!analysis) return;
    setBusy("실 자동 인식 중…");
    setError("");
    setVerdicts(null);
    try {
      const r = await api.autoRooms(analysis.session).catch(async err => {
        if (!isExpired(err)) throw err;
        setBusy("도면 세션 복구 중…");
        const sid = await recoverSession();
        if (!sid) throw err;
        setBusy("실 자동 인식 중…");
        return api.autoRooms(sid);
      });
      if (r.rooms.length === 0) {
        setError(
          `실을 하나도 잡지 못했습니다. 실명 텍스트 레이어가 인식되지 않았거나 ` +
            `벽선이 없는 도면일 수 있습니다. (실패 ${r.failed.length}건)`
        );
        return;
      }
      setAutoRooms(r.rooms);
      setRooms(
        r.rooms.map(x => ({
          name: x.name,
          polygon: x.polygon,
          is_approximate: x.is_approximate,
          openings: [{ width_mm: 900, height_mm: 2100, kind: "door" as const }],
        }))
      );
      onRoomsChange?.(
        r.rooms.map(x => ({
          name: x.name,
          polygon: x.polygon,
          area_m2: x.area_m2,
          approx: x.is_approximate,
        }))
      );
      if (r.failed.length > 0) {
        setError(
          `${r.rooms.length}개 인식 · ${r.failed.length}개는 사방이 벽으로 닫히지 않아 건너뛰었습니다.`
        );
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [analysis, onRoomsChange, recoverSession]);

  /** LLM 검수 — 치수가 실무 통상값을 벗어난 실을 걸러낸다 */
  const runVerify = useCallback(async () => {
    if (autoRooms.length === 0) {
      setError("먼저 [실 자동 인식] 을 실행하세요.");
      return;
    }
    setBusy("AI 검수 중…");
    setError("");
    try {
      const r = await api.verifyRooms(
        autoRooms.map(x => ({
          name: x.name,
          area_m2: x.area_m2,
          width_mm: x.width_mm,
          depth_mm: x.depth_mm,
        }))
      );
      setVerdicts(r);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [autoRooms]);

  const runTakeoff = useCallback(async () => {
    if (rooms.length === 0) return;
    setBusy("물량 산출 중…");
    setError("");
    try {
      setResult(await api.takeoff(rooms));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [rooms]);

  const makeRegistry = useCallback(async () => {
    setBusy("대장 생성 중…");
    setError("");
    try {
      const line_types: Record<string, string> = {};
      for (const pair of ruleForm.lines.split(",")) {
        const [k, v] = pair.split("=").map(s => s.trim());
        if (k && v) line_types[k] = v;
      }
      setRegistry(
        await api.registryFromRule({
          buildings: ruleForm.buildings.split(",").map(s => s.trim()).filter(Boolean),
          floor_from: ruleForm.from,
          floor_to: ruleForm.to,
          line_types,
          exclude_floors: ruleForm.exclude
            .split(",")
            .map(s => Number(s.trim()))
            .filter(n => Number.isFinite(n)),
        })
      );
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [ruleForm]);

  const doPaste = useCallback(async () => {
    setBusy("붙여넣기 파싱 중…");
    try {
      setRegistry(await api.registryFromPaste(pasteText));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [pasteText]);

  const doPreview = useCallback(async () => {
    if (!registry) return;
    setBusy("범위 해석 중…");
    setError("");
    try {
      setPreview(await api.parseRange(registry.units, rangeText));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [registry, rangeText]);

  /** 미리보기 확인 후에만 진도에 반영한다 */
  const applyPreview = useCallback(
    (work: string) => {
      if (!preview?.matched.length) return;
      setProgress(prev => {
        const next = { ...prev, [work]: { ...(prev[work] ?? {}) } };
        for (const m of preview.matched) next[work][m.key] = m.ratio;
        return next;
      });
      setPreview(null);
    },
    [preview]
  );

  const works = billing?.works ?? [
    { code: "SHEET_FLOOR", name: "장판/마루" },
    { code: "FLOOR_TILE", name: "바닥타일" },
    { code: "WALLPAPER", name: "벽 도배" },
    { code: "CEILING", name: "천장 도배" },
    { code: "BASEBOARD", name: "걸레받이" },
  ];

  const quantities = useMemo(() => {
    // 도면 산출 결과 → 타입별 단위물량 (타입 구분 전이면 전체를 한 타입으로)
    const q: Record<string, { by_work: Record<string, number> }> = {};
    if (!result) return q;
    const map: Record<string, string> = {
      sheet_floor: "SHEET_FLOOR",
      floor_tile: "FLOOR_TILE",
      wallpaper: "WALLPAPER",
      ceiling: "CEILING",
      baseboard: "BASEBOARD",
    };
    const by: Record<string, number> = {};
    for (const s of result.summary) {
      const code = map[s.kind];
      if (code) by[code] = s.count ?? s.with_waste;
    }
    for (const t of Object.keys(registry?.type_counts ?? { 기본: 1 })) q[t] = { by_work: by };
    return q;
  }, [result, registry]);

  const runBilling = useCallback(async () => {
    if (!registry) return;
    setBusy("기성 산출 중…");
    setError("");
    try {
      const prog: { period: number; unit_key: string; work: string; ratio: number }[] = [];
      for (const [work, m] of Object.entries(progress)) {
        for (const [key, ratio] of Object.entries(m)) {
          prog.push({ period: 1, unit_key: key, work, ratio });
        }
      }
      setBilling(
        await api.computeBilling({
          units: registry.units,
          progress: prog,
          quantities,
          period: { seq: 1, title: "1차", cutoff: new Date().toISOString().slice(0, 10) },
        })
      );
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy("");
    }
  }, [registry, progress, quantities]);

  // 실 클릭 모드 — 오버레이를 걷고 우측 상단 작은 바로 접는다.
  // (대화상자가 화면을 덮고 있으면 평면을 클릭할 수 없다)
  if (picking) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[72]">
        <div className="pointer-events-auto absolute right-4 top-4 w-[360px] rounded-xl border border-slate-300 bg-white/95 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <span className="flex h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            <b className="text-[12.5px] text-slate-800">실 클릭 중</b>
            <span className="text-[11px] text-slate-500">
              평면에서 실 안쪽을 클릭하세요
            </span>
            <button
              type="button"
              onClick={() => onPickingChange?.(false)}
              className="ml-auto rounded bg-rose-600 px-2.5 py-1 text-[11.5px] font-semibold text-white"
            >
              중지
            </button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto px-3 py-2">
            {busy && (
              <p className="flex items-center gap-1.5 py-1 text-[11.5px] text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {busy}
              </p>
            )}
            {error && (
              <p className="mb-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                {error}
              </p>
            )}
            {rooms.length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-slate-400">
                아직 클릭한 실이 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {rooms.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 rounded border border-slate-100 px-2 py-1 text-[11.5px]"
                  >
                    <input
                      value={r.name}
                      onChange={e =>
                        setRooms(prev =>
                          prev.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x
                          )
                        )
                      }
                      className="w-24 rounded border border-slate-200 px-1 py-0.5"
                    />
                    <span className="tabular-nums text-slate-600">
                      {(pickedRooms?.[i]?.area_m2 ?? 0).toFixed(2)}㎡
                    </span>
                    {r.is_approximate && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[9.5px] font-bold text-amber-700">
                        근사
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRooms(prev => prev.filter((_, j) => j !== i));
                        onRoomsChange?.((pickedRooms ?? []).filter((_, j) => j !== i));
                      }}
                      className="ml-auto text-slate-300 hover:text-rose-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
            <span className="text-[11.5px] text-slate-500">
              추적 {rooms.length}개
            </span>
            <button
              type="button"
              onClick={() => {
                onPickingChange?.(false);
                void runTakeoff();
              }}
              disabled={rooms.length === 0}
              className="ml-auto rounded bg-[#004791] px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-40"
            >
              물량 산출
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[72] flex items-start justify-center bg-slate-900/40 p-6 backdrop-blur-[2px]">
      <div className="mt-4 flex max-h-[88vh] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="text-[15px] font-bold text-slate-800">마감 물량 산출 · 기성</h2>
          {alive === false && (
            <span className="flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
              <AlertTriangle className="h-3 w-3" />
              엔진 미연결 — `python -m finish_takeoff.server` 실행 필요
            </span>
          )}
          {alive && (
            <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />
              엔진 연결됨
            </span>
          )}
          {busy && (
            <span className="flex items-center gap-1 text-[11.5px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {busy}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex shrink-0 gap-1 border-b border-slate-200 px-4 pt-2">
          {(
            [
              ["takeoff", "물량 산출"],
              ["registry", "세대 대장"],
              ["billing", "기성"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "rounded-t px-4 py-1.5 text-[12.5px] font-semibold",
                tab === k
                  ? "border border-b-0 border-slate-200 bg-white text-[#004791]"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </div>
          )}

          {/* ── 물량 산출 ── */}
          {tab === "takeoff" && (
            <div className="space-y-4">
              {analysis ? (
                <>
                  <section className="rounded-lg border border-slate-200 p-3">
                    <h3 className="mb-2 text-[12.5px] font-bold text-slate-700">도면 분석</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-slate-600 sm:grid-cols-4">
                      <Fact label="엔티티" value={analysis.drawing.entities.toLocaleString()} warn={analysis.drawing.is_large} />
                      <Fact label="레이어" value={`${analysis.drawing.layers} (사용 ${analysis.drawing.layers_with_entities})`} />
                      <Fact
                        label="단위"
                        value={`×${analysis.drawing.unit_scale} (${analysis.drawing.unit_source})`}
                        warn={analysis.drawing.unit_source === "bbox_guess"}
                      />
                      <Fact label="미러 INSERT" value={String(analysis.drawing.mirrored_inserts)} />
                    </div>
                    <div className="mt-2 text-[11.5px] text-slate-500">
                      벽체 후보:{" "}
                      {analysis.wall_candidates.slice(0, 3).map(w => (
                        <code key={w.layer} className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5">
                          {w.layer} ({w.median_mm}mm)
                        </code>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-[#004791]/25 bg-blue-50/40 p-3">
                    <h3 className="mb-1.5 text-[12.5px] font-bold text-[#004791]">
                      사용법
                    </h3>
                    <ol className="ml-4 list-decimal space-y-0.5 text-[11.5px] text-slate-600">
                      <li>
                        <b>[실 자동 인식]</b> 을 누르면 도면의 실명(거실·침실·안방…)을 읽어
                        <b>전체 실을 한 번에</b> 잡습니다. 클릭할 필요 없습니다.
                      </li>
                      <li>
                        <b>[AI 검수]</b> 로 치수가 통상값을 벗어난 실을 걸러냅니다.
                      </li>
                      <li>
                        빠진 실만 <b>[실 클릭 시작]</b> 으로 보완한 뒤 <b>[물량 산출]</b>.
                      </li>
                      <li>
                        세대별 기성까지 뽑으려면 <b>[세대 대장]</b> → <b>[기성]</b> 탭으로.
                      </li>
                    </ol>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={runAutoRooms}
                        disabled={!analysis || !!busy}
                        className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        실 자동 인식
                      </button>
                      <button
                        type="button"
                        onClick={runVerify}
                        disabled={rooms.length === 0 || !!busy}
                        className="rounded bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                      >
                        AI 검수
                      </button>
                      <button
                        type="button"
                        onClick={() => onPickingChange?.(!picking)}
                        disabled={!analysis}
                        className={cn(
                          "rounded px-3 py-1.5 text-[12px] font-semibold text-white transition-colors disabled:opacity-40",
                          picking ? "bg-rose-600" : "bg-[#004791] hover:bg-[#003a78]"
                        )}
                      >
                        {picking ? "실 클릭 중지" : "실 클릭 시작"}
                      </button>
                      {picking && (
                        <span className="text-[11.5px] font-semibold text-rose-600">
                          평면도에서 실 안쪽을 클릭하세요 — 이 창은 열어둬도 됩니다
                        </span>
                      )}
                      {rooms.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRooms([]);
                            setAutoRooms([]);
                            setVerdicts(null);
                            setResult(null);
                            onRoomsChange?.([]);
                          }}
                          className="ml-auto rounded border border-slate-300 px-2.5 py-1.5 text-[11.5px] text-slate-600"
                        >
                          전체 지우기
                        </button>
                      )}
                    </div>
                  </section>

                  {verdicts && (
                    <section className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                      <h3 className="mb-1.5 text-[12.5px] font-bold text-violet-800">
                        AI 검수 결과
                        <span className="ml-2 font-normal text-violet-600">
                          {verdicts.checked}개 검수
                          {verdicts.skipped > 0 && ` · ${verdicts.skipped}개 생략(면적 하위)`}
                        </span>
                      </h3>
                      {verdicts.summary && (
                        <p className="mb-2 text-[11.5px] text-slate-600">{verdicts.summary}</p>
                      )}
                      {(() => {
                        const bad = verdicts.verdicts.filter(v => v.verdict !== "ok");
                        if (bad.length === 0) {
                          return (
                            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              모든 실이 통상 치수 범위입니다.
                            </p>
                          );
                        }
                        return (
                          <ul className="space-y-1">
                            {bad.map(v => {
                              const rm = autoRooms[v.index];
                              return (
                                <li
                                  key={v.index}
                                  className="flex items-start gap-2 rounded border border-amber-200 bg-white px-2 py-1.5 text-[11.5px]"
                                >
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                  <span>
                                    <b>{rm?.name ?? `#${v.index}`}</b>
                                    {rm && (
                                      <span className="ml-1 tabular-nums text-slate-500">
                                        {rm.area_m2.toFixed(1)}㎡
                                      </span>
                                    )}
                                    <span className="ml-1 text-amber-700">
                                      —{" "}
                                      {v.verdict === "too_big"
                                        ? "과대"
                                        : v.verdict === "too_small"
                                          ? "과소"
                                          : "실 아님"}
                                    </span>
                                    <span className="ml-1 text-slate-600">{v.reason}</span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()}
                      <p className="mt-2 text-[11px] text-slate-500">
                        AI 는 치수 타당성만 판정합니다. 면적 자체는 도면 기하에서 계산된
                        값이며 AI 가 바꾸지 않습니다.
                      </p>
                    </section>
                  )}

                  <section className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-[12.5px] font-bold text-slate-700">
                        추적된 실 {rooms.length}개
                      </h3>
                      <button
                        type="button"
                        onClick={runTakeoff}
                        disabled={rooms.length === 0 || !!busy}
                        className="rounded bg-[#004791] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                      >
                        물량 산출
                      </button>
                    </div>
                    {rooms.length === 0 && (
                      <p className="py-4 text-center text-[12px] text-slate-400">
                        평면도에서 실 내부를 클릭하면 여기에 추가됩니다.
                      </p>
                    )}
                    {rooms.length > 0 && !result && (
                      <ul className="space-y-1 text-[11.5px]">
                        {rooms.map((r, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-2 rounded border border-slate-100 px-2 py-1"
                          >
                            <input
                              value={r.name}
                              onChange={e =>
                                setRooms(prev =>
                                  prev.map((x, j) =>
                                    j === i ? { ...x, name: e.target.value } : x
                                  )
                                )
                              }
                              className="w-32 rounded border border-slate-200 px-1.5 py-0.5"
                            />
                            <span className="tabular-nums text-slate-500">
                              {(pickedRooms?.[i]?.area_m2 ?? 0).toFixed(2)}㎡
                            </span>
                            {r.is_approximate && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                근사추적
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setRooms(prev => prev.filter((_, j) => j !== i));
                                onRoomsChange?.(
                                  (pickedRooms ?? []).filter((_, j) => j !== i)
                                );
                              }}
                              className="ml-auto text-slate-300 hover:text-rose-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {result && (
                      <table className="w-full text-[11.5px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1 text-left">실명</th>
                            <th className="text-right">면적㎡</th>
                            <th className="text-right">평</th>
                            <th className="text-right">둘레m</th>
                            <th className="text-right">벽도배</th>
                            <th className="text-right">타일</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {result.rooms.map(r => (
                            <tr key={r.name} className={cn("border-b border-slate-100", r.is_approximate && "bg-amber-50/60")}>
                              <td className="py-1">{r.name}</td>
                              <td className="text-right tabular-nums">{r.area_m2}</td>
                              <td className="text-right tabular-nums">{r.pyeong}</td>
                              <td className="text-right tabular-nums">{r.perimeter_m}</td>
                              <td className="text-right tabular-nums">
                                {r.lines.find(l => l.kind === "wallpaper")?.with_waste ?? "-"}
                              </td>
                              <td className="text-right tabular-nums">
                                {r.lines.find(l => l.kind === "floor_tile")?.count ?? "-"}
                              </td>
                              <td className="pl-2">
                                {r.is_approximate && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    근사추적
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {result && (
                      <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-200 pt-2 text-[12px]">
                        {result.summary.map(s => (
                          <span key={s.kind} className="text-slate-600">
                            {KIND_LABEL[s.kind] ?? s.kind}{" "}
                            <b className="text-slate-900 tabular-nums">
                              {s.count ?? s.with_waste}
                            </b>
                            <span className="text-slate-400"> {s.count ? "장" : s.unit}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <p className="py-10 text-center text-[12.5px] text-slate-400">
                  {alive === false
                    ? "엔진이 실행 중이 아닙니다. engine 폴더에서 python -m finish_takeoff.server 를 실행하세요."
                    : busy
                      ? "도면을 분석하고 있습니다… 18만 엔티티 도면은 20초쯤 걸립니다."
                      : "DXF 를 업로드하면 도면 분석이 시작됩니다."}
                </p>
              )}
            </div>
          )}

          {/* ── 세대 대장 ── */}
          {tab === "registry" && (
            <div className="space-y-4">
              <section className="rounded-lg border border-slate-200 p-3">
                <h3 className="mb-2 text-[12.5px] font-bold text-slate-700">규칙 생성</h3>
                <div className="flex flex-wrap items-end gap-2 text-[12px]">
                  <Field label="동 (쉼표)">
                    <input value={ruleForm.buildings} onChange={e => setRuleForm(f => ({ ...f, buildings: e.target.value }))} className="h-7 w-28 rounded border border-slate-300 px-2" />
                  </Field>
                  <Field label="층">
                    <div className="flex items-center gap-1">
                      <input type="number" value={ruleForm.from} onChange={e => setRuleForm(f => ({ ...f, from: Number(e.target.value) }))} className="h-7 w-14 rounded border border-slate-300 px-1 text-right" />
                      <span className="text-slate-400">~</span>
                      <input type="number" value={ruleForm.to} onChange={e => setRuleForm(f => ({ ...f, to: Number(e.target.value) }))} className="h-7 w-14 rounded border border-slate-300 px-1 text-right" />
                    </div>
                  </Field>
                  <Field label="라인=타입">
                    <input value={ruleForm.lines} onChange={e => setRuleForm(f => ({ ...f, lines: e.target.value }))} className="h-7 w-48 rounded border border-slate-300 px-2" />
                  </Field>
                  <Field label="제외 층 (필로티)">
                    <input value={ruleForm.exclude} onChange={e => setRuleForm(f => ({ ...f, exclude: e.target.value }))} className="h-7 w-20 rounded border border-slate-300 px-2" />
                  </Field>
                  <button type="button" onClick={makeRegistry} disabled={!!busy} className="h-7 rounded bg-[#004791] px-3 text-[12px] font-semibold text-white disabled:opacity-40">
                    생성
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 p-3">
                <h3 className="mb-2 text-[12.5px] font-bold text-slate-700">Excel 붙여넣기 (동/층/호/타입)</h3>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  rows={4}
                  placeholder={"101\t15\t1501\t84A\n101\t15\t1502\t84B"}
                  className="w-full rounded border border-slate-300 p-2 font-mono text-[11.5px]"
                />
                <button type="button" onClick={doPaste} disabled={!pasteText.trim() || !!busy} className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-[12px] disabled:opacity-40">
                  파싱
                </button>
              </section>

              {registry && (
                <section className="rounded-lg border border-slate-200 p-3 text-[12px]">
                  <b className="text-slate-800">{registry.count}세대</b>{" "}
                  <span className="text-slate-500">
                    · {Object.entries(registry.type_counts).map(([t, n]) => `${t} ${n}`).join(" / ")}
                    {" · "}동 {registry.buildings.join(", ")}
                  </span>
                  {!!registry.errors?.length && (
                    <ul className="mt-2 list-disc pl-5 text-[11.5px] text-rose-600">
                      {registry.errors.slice(0, 5).map(e => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}

          {/* ── 기성 ── */}
          {tab === "billing" && (
            <div className="space-y-4">
              {!registry ? (
                <p className="py-10 text-center text-[12.5px] text-slate-400">
                  먼저 [세대 대장] 탭에서 대장을 만들어주세요.
                </p>
              ) : (
                <>
                  <section className="rounded-lg border border-slate-200 p-3">
                    <h3 className="mb-2 text-[12.5px] font-bold text-slate-700">범위 입력</h3>
                    <div className="flex gap-2">
                      <textarea
                        value={rangeText}
                        onChange={e => setRangeText(e.target.value)}
                        rows={2}
                        className="flex-1 rounded border border-slate-300 p-2 font-mono text-[12px]"
                        placeholder="101동 1~15F 전체&#10;101동 16F 01,02호 @50%"
                      />
                      <button type="button" onClick={doPreview} disabled={!!busy} className="h-fit rounded bg-slate-700 px-3 py-2 text-[12px] font-semibold text-white">
                        미리보기
                      </button>
                    </div>
                    {preview && (
                      <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-[11.5px]">
                        <b className={preview.ok ? "text-slate-700" : "text-rose-600"}>{preview.summary}</b>
                        {preview.errors.map((e, i) => (
                          <div key={i} className="text-rose-600">
                            {e.line}번째 줄 &apos;{e.token}&apos;: {e.message}
                          </div>
                        ))}
                        {preview.missing.map((m, i) => (
                          <div key={i} className="text-amber-600">⚠ {m}</div>
                        ))}
                        {preview.ok && preview.count > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {works.map(w => (
                              <button key={w.code} type="button" onClick={() => applyPreview(w.code)} className="rounded border border-[#004791] px-2 py-0.5 text-[11px] font-semibold text-[#004791] hover:bg-blue-50">
                                {w.name}에 적용
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  <BillingGrid
                    units={registry.units}
                    works={works}
                    progress={progress}
                    onChange={(work, keys, ratio) =>
                      setProgress(prev => {
                        const next = { ...prev, [work]: { ...(prev[work] ?? {}) } };
                        for (const k of keys) next[work][k] = ratio;
                        return next;
                      })
                    }
                  />

                  <div className="flex items-center gap-2">
                    <button type="button" onClick={runBilling} disabled={!!busy} className="rounded bg-[#004791] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
                      기성 산출
                    </button>
                    {billing && (
                      <span className={cn("text-[12px] font-semibold", billing.validation.can_lock ? "text-emerald-600" : "text-rose-600")}>
                        {billing.validation.summary}
                      </span>
                    )}
                  </div>

                  {billing && (
                    <section className="rounded-lg border border-slate-200 p-3">
                      <table className="w-full text-[11.5px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1 text-left">공종</th>
                            <th className="text-right">계약</th>
                            <th className="text-right">금회</th>
                            <th className="text-right">누계</th>
                            <th className="text-right">잔여</th>
                            <th className="text-right">기성률</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(billing.by_work).map(([code, d]) => {
                            const w = works.find(x => x.code === code);
                            const rate = d["계약"] ? (d["누계"] / d["계약"]) * 100 : 0;
                            return (
                              <tr key={code} className="border-b border-slate-100">
                                <td className="py-1">{w?.name ?? code}</td>
                                <td className="text-right tabular-nums">{d["계약"].toFixed(1)}</td>
                                <td className="text-right font-semibold tabular-nums">{d["금회"].toFixed(1)}</td>
                                <td className="text-right tabular-nums">{d["누계"].toFixed(1)}</td>
                                <td className="text-right tabular-nums">{d["잔여"].toFixed(1)}</td>
                                <td className="text-right tabular-nums">{rate.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {billing.validation.issues.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[11.5px]">
                          {billing.validation.issues.slice(0, 8).map((i, k) => (
                            <li key={k} className={cn("flex items-start gap-1", i.severity === "error" ? "text-rose-600" : i.severity === "warning" ? "text-amber-600" : "text-slate-500")}>
                              {i.severity === "info" ? <Info className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                              <span>{i.message}{i.unit ? ` [${i.unit}]` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <span className="text-slate-400">{label} </span>
      <b className={cn("tabular-nums", warn ? "text-amber-600" : "text-slate-800")}>{value}</b>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </div>
  );
}
