/**
 * 슬래브 구분도 — 구조평면도(DXF)의 슬래브 기호를 읽어 데크·PC·RC 영역을 색으로 나누고 면적 비율을 낸다.
 *
 * 저장하지 않는다(서버·브라우저 모두). 도면을 올리면 그 자리에서 계산하고, 결과는 그림(PNG)으로 내려받는다.
 * 계산은 engine/analyze.ts, 도면은 워커(engine/slabZone.worker.ts)가 쥔다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Eraser, Hand, Loader2, PaintBucket, PenLine, RotateCcw, Undo2, Upload } from "lucide-react";
import ToolShell from "@/features/tcRental/components/ToolShell";
import { cn } from "@/lib/utils";
import {
  KIND_COLOR,
  type AnalyzeResult,
  type KindOrSkip,
  type ManualWall,
  type PaintKind,
  type Seed,
} from "./engine/analyze";
import { SlabZoneClient, type SheetDetail } from "./engine/client";
import { DEFAULT_RULE, type MarkRule, type SlabKind } from "./engine/marks";

const KIND_LABEL: Record<SlabKind, string> = { deck: "데크", pc: "PC", rc: "RC" };
const KINDS: SlabKind[] = ["deck", "pc", "rc"];
const rgb = (k: SlabKind) => `rgb(${KIND_COLOR[k].join(",")})`;
const num = (v: number) => Math.round(v).toLocaleString("ko-KR");

type Tool = "pan" | "line" | PaintKind;

/** 도면(시트)마다 따로 두는 설정 */
interface SheetSettings {
  barrier: Set<number>;
  /** 판 경계로 쓰는 중심선(열) 도면층 */
  grid: Set<number>;
  /** 구간 표시 도면층(「-PC구간」 등) — 도면층 번호 → 그 안쪽을 칠할 종류 */
  zone: Record<number, SlabKind>;
  overrides: Record<string, KindOrSkip>;
  seeds: Seed[];
  /** 사람이 그은 판 경계선 */
  walls: ManualWall[];
  /** 되돌리기 순서 — 마지막에 한 것이 칠하기인지 선 긋기인지 */
  history: ("seed" | "wall")[];
}

export default function SlabZonePage() {
  const clientRef = useRef<SlabZoneClient | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<SheetDetail[]>([]);
  const [sheetId, setSheetId] = useState(0);
  const [rule, setRule] = useState<MarkRule>(DEFAULT_RULE);
  const [settings, setSettings] = useState<Record<number, SheetSettings>>({});
  const [maxReachM, setMaxReachM] = useState(60);
  const [inferPc, setInferPc] = useState(true);
  const [beamWalls, setBeamWalls] = useState(true);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [tool, setTool] = useState<Tool>("pan");
  const [showLayers, setShowLayers] = useState(false);

  useEffect(() => () => clientRef.current?.dispose(), []);

  const detail = sheets.find((s) => s.sheet.id === sheetId) ?? null;
  const cur = settings[sheetId];

  /** 도면 목록이 바뀌면 시트별 설정을 기본값으로 채운다(이미 있는 것은 둔다) */
  const adoptSheets = useCallback((list: SheetDetail[], reset: boolean) => {
    setSheets(list);
    setSettings((prev) => {
      const next: Record<number, SheetSettings> = {};
      for (const d of list) {
        const old = reset ? undefined : prev[d.sheet.id];
        next[d.sheet.id] = old ?? {
          barrier: new Set(d.layers.filter((l) => l.barrier).map((l) => l.index)),
          grid: new Set(d.layers.filter((l) => l.grid).map((l) => l.index)),
          zone: Object.fromEntries(d.layers.filter((l) => l.zone).map((l) => [l.index, l.zone as SlabKind])),
          overrides: {},
          seeds: [],
          walls: [],
          history: [],
        };
      }
      return next;
    });
  }, []);

  const onFile = async (file: File) => {
    if (!/\.dxf$/i.test(file.name)) {
      toast.error("DXF 파일만 읽을 수 있습니다. DWG 는 CAD 에서 DXF 로 저장해 올려 주세요.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      clientRef.current?.dispose();
      const client = new SlabZoneClient();
      clientRef.current = client;
      const { sheets: list, warnings } = await client.load(await file.arrayBuffer(), rule);
      setFileName(file.name);
      adoptSheets(list, true);
      setSheetId(list[0]?.sheet.id ?? 0);
      for (const w of warnings) toast.warning(w);
      if (list.length === 0) toast.error("슬래브 기호(예: DS12 · RS10 · RPS1)를 찾지 못했습니다. 기호 규칙을 확인해 주세요.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "도면을 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const applyRule = async (next: MarkRule) => {
    setRule(next);
    const client = clientRef.current;
    if (!client || sheets.length === 0) return;
    try {
      adoptSheets(await client.setRule(next), false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "기호를 다시 읽지 못했습니다.");
    }
  };

  // 설정이 바뀌면 다시 계산한다 — 마지막 요청의 결과만 쓴다
  const runRef = useRef(0);
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !detail || !cur) return;
    const run = ++runRef.current;
    setBusy(true);
    const t = window.setTimeout(() => {
      client
        .analyze(detail.sheet.id, {
          barrierLayers: [...cur.barrier],
          gridLayers: [...cur.grid],
          zoneLayers: Object.entries(cur.zone).map(([i, kind]) => ({ index: Number(i), kind })),
          beamWalls,
          overrides: cur.overrides,
          seeds: cur.seeds,
          walls: cur.walls,
          maxReachM,
          inferPc,
        })
        .then((r) => {
          if (run === runRef.current) setResult(r);
        })
        .catch((err) => {
          if (run === runRef.current) toast.error(err instanceof Error ? err.message : "계산에 실패했습니다.");
        })
        .finally(() => {
          if (run === runRef.current) setBusy(false);
        });
    }, 120);
    return () => window.clearTimeout(t);
  }, [detail, cur, maxReachM, inferPc, beamWalls]);

  const patch = (fn: (s: SheetSettings) => SheetSettings) =>
    setSettings((prev) => (prev[sheetId] ? { ...prev, [sheetId]: fn(prev[sheetId]) } : prev));

  const total = result ? result.area.deck + result.area.pc + result.area.rc : 0;

  const exportPng = () => {
    if (!result || !detail) return;
    const pad = 24;
    const legendH = 150;
    const c = document.createElement("canvas");
    c.width = result.width;
    c.height = result.height + legendH;
    const g = c.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
    g.font = "bold 26px sans-serif";
    g.fillStyle = "#1e293b";
    g.fillText(`${detail.sheet.title || "슬래브 구분도"} — 슬래브 종류별 현황`, pad, result.height + 40);
    g.font = "22px sans-serif";
    KINDS.forEach((k, i) => {
      const x = pad + i * 380;
      const y = result.height + 70;
      g.fillStyle = rgb(k);
      g.fillRect(x, y, 56, 30);
      g.strokeStyle = "#334155";
      g.strokeRect(x, y, 56, 30);
      g.fillStyle = "#1e293b";
      const pct = total > 0 ? ((result.area[k] / total) * 100).toFixed(1) : "0.0";
      g.fillText(`${KIND_LABEL[k]}  ${num(result.area[k])}㎡ (${pct}%)`, x + 68, y + 23);
    });
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `슬래브구분도_${detail.sheet.title || fileName.replace(/\.dxf$/i, "")}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  return (
    <ToolShell
      title="슬래브 구분도"
      subtitle={fileName ? <span className="text-[12px] text-slate-400">{fileName}</span> : undefined}
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".dxf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#004791] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#003a78] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            도면 올리기
          </button>
          <button
            type="button"
            onClick={exportPng}
            disabled={!result}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            그림 저장
          </button>
        </>
      }
    >
      {sheets.length === 0 ? (
        <EmptyState loading={loading} onPick={() => fileRef.current?.click()} onDrop={(f) => void onFile(f)} />
      ) : (
        <div className="grid h-[calc(100vh-130px)] min-h-[520px] grid-cols-[300px_minmax(0,1fr)] gap-4">
          {/* ── 왼쪽: 설정 ── */}
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <Panel title="도면">
              <div className="flex flex-col gap-1.5">
                {sheets.map((d, i) => (
                  <button
                    key={d.sheet.id}
                    type="button"
                    onClick={() => setSheetId(d.sheet.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      d.sheet.id === sheetId
                        ? "border-[#004791] bg-blue-50/70"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <div className="text-[13px] font-semibold text-slate-800">{d.sheet.title || `평면 ${i + 1}`}</div>
                    <div className="mt-0.5 text-[11.5px] text-slate-500">
                      기호 — 데크 {d.sheet.counts.deck} · PC {d.sheet.counts.pc} · RC {d.sheet.counts.rc}
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="종류별 면적">
              {result ? (
                <div className="flex flex-col gap-1.5">
                  {KINDS.map((k) => (
                    <div key={k} className="flex items-center gap-2 text-[13px]">
                      <span className="h-4 w-6 shrink-0 rounded-sm border border-slate-400" style={{ background: rgb(k) }} />
                      <span className="w-10 font-semibold text-slate-700">{KIND_LABEL[k]}</span>
                      <span className="ml-auto tabular-nums text-slate-600">{num(result.area[k])}㎡</span>
                      <span className="w-14 text-right font-bold tabular-nums text-slate-800">
                        {total > 0 ? ((result.area[k] / total) * 100).toFixed(1) : "0.0"}%
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-[12px] text-slate-500">
                    <span>합계(분류된 면적)</span>
                    <span className="tabular-nums">{num(total)}㎡</span>
                  </div>
                  {result.pcInferredArea >= 1 && (
                    <p className="text-[11.5px] leading-snug text-slate-500">
                      PC 중 {num(result.pcInferredArea)}㎡ 는 슬래브 기호 없이 PC 거더·보 기호로 추정한 구간입니다.
                    </p>
                  )}
                  {(["pc", "deck"] as const).map(
                    (k) =>
                      result.zoneArea[k] >= 1 && (
                        <p key={k} className="text-[11.5px] leading-snug text-slate-500">
                          {KIND_LABEL[k]} 중 {num(result.zoneArea[k])}㎡ 는 기호가 아니라 도면의 「{KIND_LABEL[k]} 구간」 표시(빗금
                          테두리)로 칠한 구간입니다.
                        </p>
                      ),
                  )}
                  {result.warnings.map((w) => (
                    <p key={w} className="rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] leading-snug text-amber-800">
                      {w}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="h-20 animate-pulse rounded-md bg-slate-100" />
              )}
            </Panel>

            <Panel title="기호 규칙">
              <div className="grid grid-cols-2 gap-2">
                <RuleInput label="데크 글자" value={rule.deck} onCommit={(v) => void applyRule({ ...rule, deck: v })} />
                <RuleInput label="PC 글자" value={rule.pc} onCommit={(v) => void applyRule({ ...rule, pc: v })} />
              </div>
              <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
                슬래브 기호(…S숫자)에서 S 앞 글자로 나눕니다. 예) <b>D</b>S12 → 데크, R<b>P</b>S1 → PC, 그 밖은 RC.
              </p>
              {detail && cur && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200">
                  {detail.marks.map((m) => (
                    <div
                      key={m.text}
                      className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-[12px] last:border-b-0"
                    >
                      <span className="font-mono font-semibold text-slate-700">{m.text}</span>
                      <span className="text-slate-400">×{m.count}</span>
                      {m.aux && <span className="rounded bg-slate-100 px-1 text-[10.5px] text-slate-500">거더·보</span>}
                      <select
                        value={cur.overrides[m.text] ?? m.kind}
                        onChange={(e) => {
                          const v = e.target.value as KindOrSkip;
                          patch((s) => {
                            const o = { ...s.overrides };
                            if (v === m.kind) delete o[m.text];
                            else o[m.text] = v;
                            return { ...s, overrides: o };
                          });
                        }}
                        className="ml-auto rounded border border-slate-200 bg-white px-1 py-0.5 text-[12px]"
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                        <option value="skip">무시</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="계산 설정">
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-slate-700">
                기호 하나가 번지는 한도
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={maxReachM}
                    onChange={(e) => setMaxReachM(Math.max(5, Math.min(300, Number(e.target.value) || 60)))}
                    className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-right text-[12.5px]"
                  />
                  m
                </span>
              </label>
              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-slate-700">
                <input type="checkbox" checked={inferPc} onChange={(e) => setInferPc(e.target.checked)} />
                PC 거더·보 기호로 PC 구간 추정
              </label>
              <label className="mt-1.5 flex items-center gap-2 text-[12.5px] text-slate-700">
                <input type="checkbox" checked={beamWalls} onChange={(e) => setBeamWalls(e.target.checked)} />
                보·거더 기호 자리를 판 경계로 쓰기
              </label>
              <button
                type="button"
                onClick={() => setShowLayers((v) => !v)}
                className="mt-2 text-[12px] font-semibold text-[#004791] hover:underline"
              >
                도면층 쓰임 {cur ? `(벽 ${cur.barrier.size} · 판 경계 ${cur.grid.size})` : ""} {showLayers ? "접기" : "펼치기"}
              </button>
              {showLayers && detail && cur && (
                <div className="mt-1.5 max-h-64 overflow-y-auto rounded-md border border-slate-200">
                  {detail.layers.map((l) => (
                    <label
                      key={l.index}
                      className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-[11.5px] last:border-b-0"
                      title={l.markLayer ? "슬래브 기호가 놓인 도면층 — 기호 테두리라 벽으로 쓰지 않는 것이 맞습니다" : l.name}
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-700">{l.name}</span>
                      <span className="tabular-nums text-slate-400">{l.segments.toLocaleString("ko-KR")}</span>
                      <select
                        value={
                          cur.zone[l.index]
                            ? `zone-${cur.zone[l.index]}`
                            : cur.barrier.has(l.index)
                              ? "wall"
                              : cur.grid.has(l.index)
                                ? "grid"
                                : "off"
                        }
                        onChange={(e) =>
                          patch((s) => {
                            const b = new Set(s.barrier);
                            const g = new Set(s.grid);
                            const z = { ...s.zone };
                            b.delete(l.index);
                            g.delete(l.index);
                            delete z[l.index];
                            if (e.target.value === "wall") b.add(l.index);
                            if (e.target.value === "grid") g.add(l.index);
                            if (e.target.value === "zone-pc") z[l.index] = "pc";
                            if (e.target.value === "zone-deck") z[l.index] = "deck";
                            return { ...s, barrier: b, grid: g, zone: z };
                          })
                        }
                        className="rounded border border-slate-200 bg-white px-0.5 py-0.5 text-[11.5px]"
                      >
                        <option value="wall">벽</option>
                        <option value="grid">판 경계</option>
                        <option value="zone-pc">PC 구간</option>
                        <option value="zone-deck">데크 구간</option>
                        <option value="off">안 씀</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </Panel>
          </aside>

          {/* ── 오른쪽: 도면 ── */}
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2">
              <ToolButton active={tool === "pan"} onClick={() => setTool("pan")} icon={<Hand className="h-4 w-4" />}>
                이동
              </ToolButton>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <span className="text-[12px] text-slate-500">칠하기</span>
              {KINDS.map((k) => (
                <ToolButton
                  key={k}
                  active={tool === k}
                  onClick={() => setTool(k)}
                  icon={<PaintBucket className="h-4 w-4" />}
                  swatch={rgb(k)}
                >
                  {KIND_LABEL[k]}
                </ToolButton>
              ))}
              <ToolButton active={tool === "none"} onClick={() => setTool("none")} icon={<Eraser className="h-4 w-4" />}>
                제외
              </ToolButton>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <ToolButton active={tool === "line"} onClick={() => setTool("line")} icon={<PenLine className="h-4 w-4" />}>
                경계선 긋기
              </ToolButton>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <ToolButton
                disabled={!cur?.history.length}
                onClick={() =>
                  patch((s) => {
                    const last = s.history[s.history.length - 1];
                    return {
                      ...s,
                      history: s.history.slice(0, -1),
                      seeds: last === "seed" ? s.seeds.slice(0, -1) : s.seeds,
                      walls: last === "wall" ? s.walls.slice(0, -1) : s.walls,
                    };
                  })
                }
                icon={<Undo2 className="h-4 w-4" />}
              >
                되돌리기
              </ToolButton>
              <ToolButton
                disabled={!cur?.history.length}
                onClick={() => patch((s) => ({ ...s, seeds: [], walls: [], history: [] }))}
                icon={<RotateCcw className="h-4 w-4" />}
              >
                고친 것 모두 지우기
              </ToolButton>
              <span className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-500">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {tool === "pan"
                  ? "끌어서 이동 · 휠로 확대"
                  : tool === "line"
                    ? "두 점을 눌러 판 경계선을 긋습니다 (선이 없어 한 칸에 두 종류가 섞인 곳)"
                    : "잘못 칠해진 칸을 눌러 종류를 바꿉니다"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ZoneCanvas
                result={result}
                sheetKey={sheetId}
                tool={tool}
                onPaint={(x, y, kind) =>
                  patch((s) => ({ ...s, seeds: [...s.seeds, { x, y, kind }], history: [...s.history, "seed"] }))
                }
                onWall={(w) => patch((s) => ({ ...s, walls: [...s.walls, w], history: [...s.history, "wall"] }))}
              />
            </div>
          </section>
        </div>
      )}
    </ToolShell>
  );
}

// ── 작은 부품 ───────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 text-[12.5px] font-bold text-slate-800">{title}</div>
      {children}
    </div>
  );
}

function RuleInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim().toUpperCase();
    if (v !== value) onCommit(v);
  };
  return (
    <label className="text-[11.5px] text-slate-500">
      {label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 font-mono text-[13px] text-slate-800"
      />
    </label>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  icon,
  swatch,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  swatch?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40",
        active ? "border-[#004791] bg-blue-50 text-[#004791]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {swatch ? <span className="h-3.5 w-3.5 rounded-sm border border-slate-400" style={{ background: swatch }} /> : icon}
      {children}
    </button>
  );
}

function EmptyState({ loading, onPick, onDrop }: { loading: boolean; onPick: () => void; onDrop: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
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
        if (f) onDrop(f);
      }}
      className={cn(
        "mx-auto mt-10 flex max-w-2xl flex-col items-center rounded-2xl border-2 border-dashed bg-white px-8 py-14 text-center transition-colors",
        over ? "border-[#004791] bg-blue-50/50" : "border-slate-300",
      )}
    >
      {loading ? (
        <>
          <Loader2 className="h-9 w-9 animate-spin text-[#004791]" />
          <p className="mt-4 text-[14px] font-semibold text-slate-700">도면을 읽는 중입니다…</p>
          <p className="mt-1 text-[12.5px] text-slate-500">큰 도면(수십 MB)은 몇 초 걸립니다.</p>
        </>
      ) : (
        <>
          <Upload className="h-9 w-9 text-slate-400" />
          <p className="mt-4 text-[15px] font-bold text-slate-800">구조평면도 DXF 를 올려 주세요</p>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500">
            슬래브 기호(DS12 · RS10 · RPS1 …)를 읽어 데크 · PC · RC 영역을 색으로 나누고 면적 비율을 계산합니다. DWG 는 CAD
            에서 DXF 로 저장해 올려 주세요. 도면은 서버로 보내지 않고 이 브라우저 안에서만 계산합니다.
          </p>
          <button
            type="button"
            onClick={onPick}
            className="mt-5 h-10 rounded-lg bg-[#004791] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#003a78]"
          >
            파일 고르기
          </button>
        </>
      )}
    </div>
  );
}

// ── 도면 캔버스 ─────────────────────────────────────────────────────────────

/**
 * 결과 그림(격자)을 끌어 옮기고 휠로 확대해 본다.
 * 화면 좌표 = 격자 좌표 × scale + offset. 충분히 확대하면 기호 글자를 함께 그린다.
 */
function ZoneCanvas({
  result,
  sheetKey,
  tool,
  onPaint,
  onWall,
}: {
  result: AnalyzeResult | null;
  sheetKey: number;
  tool: Tool;
  onPaint: (x: number, y: number, kind: PaintKind) => void;
  onWall: (w: ManualWall) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const fittedRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** 경계선 긋기: 첫 점(도면 좌표)과 지금 커서 자리(화면 좌표) */
  const lineRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (tool !== "line") lineRef.current = null;
  }, [tool]);

  const bitmap = useMemo(() => {
    if (!result) return null;
    const c = document.createElement("canvas");
    c.width = result.width;
    c.height = result.height;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
    return c;
  }, [result]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#f1f3f6";
    g.fillRect(0, 0, w, h);
    if (!bitmap || !result) return;
    const { scale, ox, oy } = viewRef.current;
    g.imageSmoothingEnabled = scale < 1.5;
    g.drawImage(bitmap, ox, oy, result.width * scale, result.height * scale);

    // 기호: 확대했을 때만 글자를 쓴다 (격자 한 칸이 화면 3px 이상)
    const showText = scale * (100 / (result.res || 100)) >= 3 || scale >= 4;
    g.font = "600 11px ui-monospace, monospace";
    g.textBaseline = "middle";
    for (const m of result.marks) {
      const sx = ((m.x - result.originX) / result.res) * scale + ox;
      const sy = ((result.originY - m.y) / result.res) * scale + oy;
      if (sx < -40 || sy < -10 || sx > w + 40 || sy > h + 10) continue;
      if (showText) {
        g.fillStyle = m.kind === "deck" ? "#ffffff" : "#1e293b";
        g.textAlign = "center";
        g.fillText(m.text, sx, sy);
      } else if (scale >= 0.7 && !m.aux) {
        g.fillStyle = m.kind === "deck" ? "rgba(255,255,255,0.85)" : "rgba(30,41,59,0.55)";
        g.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }
    // 긋는 중인 경계선
    const first = lineRef.current;
    if (first) {
      const fx = ((first.x - result.originX) / result.res) * scale + ox;
      const fy = ((result.originY - first.y) / result.res) * scale + oy;
      g.strokeStyle = "#dc2626";
      g.fillStyle = "#dc2626";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(fx, fy, 4, 0, Math.PI * 2);
      g.fill();
      const c = cursorRef.current;
      if (c) {
        g.setLineDash([6, 4]);
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(c.x, c.y);
        g.stroke();
        g.setLineDash([]);
      }
    }
  }, [bitmap, result]);

  // 새 도면이면 화면에 맞춘다(설정만 바뀐 재계산에서는 보던 자리를 유지)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (result && wrap && fittedRef.current !== sheetKey) {
      const s = Math.min(wrap.clientWidth / result.width, wrap.clientHeight / result.height) * 0.96;
      viewRef.current = {
        scale: s,
        ox: (wrap.clientWidth - result.width * s) / 2,
        oy: (wrap.clientHeight - result.height * s) / 2,
      };
      fittedRef.current = sheetKey;
    }
    draw();
  }, [result, sheetKey, draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const v = viewRef.current;
      const next = Math.max(0.05, Math.min(40, v.scale * Math.exp(-e.deltaY * 0.0015)));
      const k = next / v.scale;
      viewRef.current = { scale: next, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k };
      draw();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      wrap.removeEventListener("wheel", onWheel);
    };
  }, [draw]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-full w-full touch-none select-none", tool === "pan" ? "cursor-grab" : "cursor-crosshair")}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        if (lineRef.current) {
          const r = e.currentTarget.getBoundingClientRect();
          cursorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          draw();
        }
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        viewRef.current = { ...viewRef.current, ox: viewRef.current.ox + dx, oy: viewRef.current.oy + dy };
        draw();
      }}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d || d.moved || tool === "pan" || !result) return;
        const r = e.currentTarget.getBoundingClientRect();
        const v = viewRef.current;
        const gx = (e.clientX - r.left - v.ox) / v.scale;
        const gy = (e.clientY - r.top - v.oy) / v.scale;
        if (gx < 0 || gy < 0 || gx >= result.width || gy >= result.height) return;
        const wx = result.originX + gx * result.res;
        const wy = result.originY - gy * result.res;
        if (tool === "line") {
          const first = lineRef.current;
          if (!first) {
            lineRef.current = { x: wx, y: wy };
            cursorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          } else {
            lineRef.current = null;
            onWall({ x1: first.x, y1: first.y, x2: wx, y2: wy });
          }
          draw();
          return;
        }
        onPaint(wx, wy, tool);
      }}
      onPointerCancel={() => (dragRef.current = null)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {!result && <div className="absolute inset-4 animate-pulse rounded-lg bg-slate-200/70" />}
    </div>
  );
}
