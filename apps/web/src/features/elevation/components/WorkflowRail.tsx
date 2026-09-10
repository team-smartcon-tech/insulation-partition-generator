/**
 * WorkflowRail — 좌측 단계 레일 + 단계별 도구 패널.
 *
 * 왜 만들었나: 리본은 "기능 종류별" 구조라 한 장 뽑으려면 관리 → 삽입 → 홈 → 적산 → 출력 → 관리
 * 로 탭을 계속 오가야 했고, 홈 탭의 "패널" 그룹처럼 서로 다른 단계의 도구가 한 서랍에 섞여 있었다.
 * 현장 직원이 순서를 외우지 않아도 되도록 **작업 순서 자체를 화면 구조로** 만든다.
 *
 *   ① 도면 → ② 외벽 → ③ 창호 → ④ 동·타입 → ⑤ 나누기 → ⑥ 산출
 *
 * 각 단계는 자기 도구만 패널에 보여주고, 끝난 단계엔 ✓, 아직 못 하는 단계는 잠근다.
 * 기존 리본 명령(측정·수정·출력·초기화 등)은 하나도 버리지 않고 레일 맨 아래 [고급]으로 편다.
 *
 * 디자인: index.css 의 --ipg-* 토큰(정밀 계측기 컨셉)만 쓴다. 다크 레일이 캔버스와
 * 이어지고 인스펙터만 밝게 떠서 "작업대 위의 도면"처럼 읽히게 한다.
 */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowRight,
  Blocks,
  Check,
  CornerDownLeft,
  FileSpreadsheet,
  FolderOpen,
  History,
  Layers,
  LayoutList,
  Loader2,
  Lock,
  Maximize2,
  MousePointer2,
  Pencil,
  Save,
  SlidersHorizontal,
  Square,
  Sliders,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RibbonMode } from "./CadRibbon";

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;
export type DialogKey = "insul" | "types" | "elev" | "preset" | "openings" | "layers" | null;

export interface WorkflowRailProps {
  // ── 진행 판정 ──
  hasDxf: boolean;
  wallCount: number;
  openingCount: number;
  typeCount: number;
  insulOn: boolean;
  canExport: boolean;

  // ── ① 도면 ──
  onUploadDxf: (file: File) => void;
  onOpenBrowser: () => void;
  dxfName?: string | null;
  activeProjectName?: string;
  activeSiteName?: string | null;
  activeRevNo?: number;

  // ── ② 외벽 ──
  mode: RibbonMode;
  onMode: (m: RibbonMode) => void;
  onStartNewChain: () => void;
  draftCount: number;
  onCommitDraft: () => void;
  onUndoDraftPoint: () => void;

  // ── ③ 창호 ──
  presetControl: ReactNode;
  onTwoPoint: () => void;

  // ── ④ 동·타입 ──
  floorHeightInput: ReactNode;

  // ── ⑥ 산출 ──
  onOpenOutput: () => void;
  onOpenTakeoff: () => void;
  onExportSiteReportCsv: () => void;
  siteReportThkLabel: string;

  // ── 저장 ──
  onSaveRev: () => void;
  savingRev: boolean;
  activeProjectId: string | null;
  onToggleRevPanel: () => void;
  revCount: number;

  // ── 공용 ──
  onOpenDialog: (k: DialogKey) => void;
  openDialog: DialogKey;
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  layerControl: ReactNode;

  /** 기존 리본(고급 명령) 펼침 여부 */
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

interface StepDef {
  no: number;
  key: string;
  label: string;
  icon: IconType;
  title: string;
  hint: string;
  done: boolean;
  locked: boolean;
}

export default function WorkflowRail(p: WorkflowRailProps) {
  const steps: StepDef[] = useMemo(
    () => [
      {
        no: 1, key: "dxf", label: "도면", icon: Upload as IconType,
        title: "평면 도면 열기",
        hint: "프로젝트를 열고 평면 DXF를 올립니다.",
        done: p.hasDxf, locked: false,
      },
      {
        no: 2, key: "wall", label: "외벽", icon: Pencil as IconType,
        title: "외벽 그리기",
        hint: "외벽선을 따라 클릭하면 전개 입면 한 장이 됩니다.",
        done: p.wallCount > 0, locked: !p.hasDxf,
      },
      {
        no: 3, key: "open", label: "창호", icon: Square as IconType,
        title: "창·문 배치",
        hint: "창 종류를 고르고 입면 위를 클릭해 놓습니다.",
        done: p.openingCount > 0, locked: p.wallCount === 0,
      },
      {
        no: 4, key: "type", label: "타입", icon: Blocks as IconType,
        title: "동·타입·세대수",
        hint: "어느 동에 어떤 타입이 몇 세대인지 넣습니다.",
        done: p.typeCount > 0, locked: p.wallCount === 0,
      },
      {
        no: 5, key: "insul", label: "나누기", icon: SlidersHorizontal as IconType,
        title: "단열재 나누기",
        hint: "보드 규격과 조인트 정책을 정합니다.",
        done: p.insulOn && p.wallCount > 0, locked: p.wallCount === 0,
      },
      {
        no: 6, key: "out", label: "산출", icon: FileSpreadsheet as IconType,
        title: "물량 산출·출력",
        hint: "물량을 확인하고 도면·산출서를 내보냅니다.",
        done: false, locked: !p.canExport,
      },
    ],
    [p.hasDxf, p.wallCount, p.openingCount, p.typeCount, p.insulOn, p.canExport]
  );

  const doneCount = steps.filter(s => s.done).length;

  /** 지금 해야 할 단계 = 잠기지 않은 것 중 첫 미완료 */
  const currentNo = useMemo(() => {
    const next = steps.find(s => !s.done && !s.locked);
    return next ? next.no : steps[steps.length - 1].no;
  }, [steps]);

  /** 사용자가 직접 고른 단계(없으면 현재 단계를 따라간다) */
  const [picked, setPicked] = useState<number | null>(null);
  const selNo = picked ?? currentNo;
  const sel = steps.find(s => s.no === selNo) ?? steps[0];

  useEffect(() => {
    if (picked != null && steps.find(x => x.no === picked)?.locked) setPicked(null);
  }, [steps, picked]);

  return (
    <div className="ipg-panel flex min-h-0 shrink-0">
      {/* ── 레일 ── */}
      <nav
        className="flex w-[72px] shrink-0 flex-col py-2"
        style={{ background: "var(--ipg-rail)" }}
      >
        <div className="flex flex-1 flex-col gap-[3px] px-2">
          {steps.map((s, i) => (
            <RailItem
              key={s.key}
              step={s}
              active={s.no === selNo}
              isCurrent={s.no === currentNo}
              last={i === steps.length - 1}
              onClick={() => setPicked(s.no)}
            />
          ))}
        </div>

        <div className="mx-3 my-2 h-px" style={{ background: "rgba(255,255,255,.10)" }} />

        <div className="flex flex-col gap-[3px] px-2">
          <RailButton
            icon={p.savingRev ? Loader2 : Save}
            label="저장"
            spin={p.savingRev}
            disabled={!p.activeProjectId || p.savingRev}
            onClick={p.onSaveRev}
            title={p.activeProjectId ? "현재 상태를 새 REV로 저장" : "먼저 프로젝트를 여세요"}
          />
          <RailButton
            icon={Sliders}
            label="고급"
            active={p.advancedOpen}
            onClick={p.onToggleAdvanced}
            title="측정·도면 편집·개별 출력 등 전체 명령 리본 펼치기"
          />
        </div>
      </nav>

      {/* ── 단계 패널 ── */}
      <section
        className="flex w-[308px] shrink-0 flex-col"
        style={{ background: "var(--ipg-panel)", borderRight: "1px solid var(--ipg-line)" }}
      >
        {/* 헤더 — 단계 번호 · 제목 · 진행 */}
        <header className="shrink-0 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2">
            <StepBadge no={sel.no} done={sel.done} />
            <h2
              className="min-w-0 flex-1 truncate font-bold tracking-tight"
              style={{ fontSize: "var(--ipg-t-lg)", color: "var(--ipg-ink)" }}
            >
              {sel.title}
            </h2>
            <span className="ipg-num ipg-label shrink-0">{doneCount}/6</span>
          </div>
          <p
            className="mt-1.5 leading-relaxed"
            style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}
          >
            {sel.hint}
          </p>
          {/* 진행 게이지 — 6칸이 곧 6단계 */}
          <div className="mt-2.5 flex gap-1">
            {steps.map(s => (
              <span
                key={s.key}
                className="h-[3px] flex-1 rounded-full transition-colors"
                style={{
                  background: s.done
                    ? "var(--ipg-ok)"
                    : s.no === selNo
                      ? "var(--ipg-accent)"
                      : "var(--ipg-line)",
                }}
              />
            ))}
          </div>
        </header>

        <div className="h-px shrink-0" style={{ background: "var(--ipg-line)" }} />

        {/* 본문 */}
        <div className="ipg-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {sel.locked ? (
            <LockedNotice step={sel} steps={steps} onGo={setPicked} />
          ) : (
            <>
              {sel.key === "dxf" && <StepDxf p={p} />}
              {sel.key === "wall" && <StepWall p={p} />}
              {sel.key === "open" && <StepOpening p={p} />}
              {sel.key === "type" && <StepType p={p} />}
              {sel.key === "insul" && <StepInsul p={p} />}
              {sel.key === "out" && <StepOutput p={p} />}
            </>
          )}
        </div>

        {/* 다음 단계 */}
        {selNo < steps.length && (
          <div
            className="shrink-0 px-4 py-3"
            style={{ borderTop: "1px solid var(--ipg-line)" }}
          >
            <button
              type="button"
              onClick={() => setPicked(Math.min(selNo + 1, steps.length))}
              disabled={!sel.done}
              className={cn(
                "flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--ipg-r-md)] font-bold transition-all",
                sel.done
                  ? "text-white hover:brightness-110"
                  : "cursor-not-allowed"
              )}
              style={{
                fontSize: "var(--ipg-t-md)",
                background: sel.done ? "var(--ipg-accent-deep)" : "var(--ipg-panel-sub)",
                color: sel.done ? "#fff" : "var(--ipg-ink-3)",
                boxShadow: sel.done ? "var(--ipg-shadow-1)" : undefined,
              }}
            >
              {sel.done ? (
                <>
                  다음 · {steps[selNo].title}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              ) : (
                "이 단계를 먼저 끝내세요"
              )}
            </button>
          </div>
        )}

        {/* 화면 도구 — 어느 단계에서나 쓴다 */}
        <footer
          className="shrink-0 px-3 py-2"
          style={{ borderTop: "1px solid var(--ipg-line)", background: "var(--ipg-panel-sub)" }}
        >
          <div className="flex items-center gap-0.5">
            <MiniBtn
              icon={MousePointer2}
              label="보기"
              active={p.mode === "view"}
              onClick={() => p.onMode("view")}
            />
            <MiniBtn icon={Maximize2} label="맞춤" onClick={p.onFitToScreen} disabled={!p.hasDxf} />
            <MiniBtn icon={ZoomIn} onClick={p.onZoomIn} disabled={!p.hasDxf} />
            <MiniBtn icon={ZoomOut} onClick={p.onZoomOut} disabled={!p.hasDxf} />
            <span className="flex-1" />
            <MiniBtn
              icon={Layers}
              label="도면층"
              active={p.openDialog === "layers"}
              onClick={() => p.onOpenDialog(p.openDialog === "layers" ? null : "layers")}
              disabled={!p.hasDxf}
            />
          </div>
          <div className="mt-1.5">{p.layerControl}</div>
        </footer>
      </section>
    </div>
  );
}

/* ── 단계별 패널 본문 ─────────────────────────────────── */

function StepDxf({ p }: { p: WorkflowRailProps }) {
  return (
    <Stack>
      <Field label="현재 문서">
        <div
          className="rounded-[var(--ipg-r-md)] px-3 py-2.5"
          style={{ background: "var(--ipg-panel-sub)", border: "1px solid var(--ipg-line)" }}
        >
          <div
            className="truncate font-bold"
            style={{ fontSize: "var(--ipg-t-md)", color: "var(--ipg-ink)" }}
          >
            {p.activeProjectName ?? "열린 프로젝트 없음"}
          </div>
          <div
            className="mt-0.5 truncate"
            style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}
          >
            {p.activeProjectName ? (
              <>
                {p.activeSiteName ?? "미분류"}
                <span style={{ color: "var(--ipg-ink-3)" }}> · </span>
                <span className="ipg-num">REV {p.activeRevNo ?? 0}</span>
              </>
            ) : (
              "프로젝트를 열어야 저장할 수 있습니다"
            )}
          </div>
        </div>
      </Field>

      <PanelBtn icon={FolderOpen} label="프로젝트 열기 · 새로 만들기" onClick={p.onOpenBrowser} />

      <Field label="평면 도면">
        <FileBtn
          icon={Upload}
          label={p.hasDxf ? "다른 DXF로 교체" : "DXF 업로드"}
          accept=".dxf"
          onFile={p.onUploadDxf}
          primary={!p.hasDxf}
        />
        {p.dxfName && (
          <div
            className="mt-2 flex items-center gap-1.5 truncate"
            style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}
          >
            <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--ipg-ok)" }} />
            <span className="truncate">{p.dxfName}</span>
          </div>
        )}
      </Field>
    </Stack>
  );
}

function StepWall({ p }: { p: WorkflowRailProps }) {
  const tracing = p.mode === "trace";
  return (
    <Stack>
      <PanelBtn
        icon={Pencil}
        label={p.wallCount === 0 ? "외벽 트레이싱 시작" : "입면 추가로 그리기"}
        onClick={p.onStartNewChain}
        primary={!tracing}
        active={tracing}
      />

      {tracing && (
        <div
          className="rounded-[var(--ipg-r-md)] p-3"
          style={{
            background: "var(--ipg-accent-soft)",
            border: "1px solid var(--ipg-accent-line)",
          }}
        >
          <div
            className="ipg-num font-bold"
            style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-accent-deep)" }}
          >
            그리는 중 · 점 {p.draftCount}개
          </div>
          <p
            className="mt-1 leading-relaxed"
            style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}
          >
            외벽 모서리를 순서대로 클릭하고, 끝나면 확정하세요.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={p.onCommitDraft}
              disabled={p.draftCount < 2}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-[var(--ipg-r-sm)] font-bold text-white transition-all disabled:cursor-not-allowed"
              style={{
                fontSize: "var(--ipg-t-md)",
                background: p.draftCount >= 2 ? "var(--ipg-ok)" : "var(--ipg-line-strong)",
              }}
            >
              <Check className="h-3.5 w-3.5" /> 입면 확정
            </button>
            <button
              type="button"
              onClick={p.onUndoDraftPoint}
              title="마지막 점 취소"
              className="flex h-8 w-9 items-center justify-center rounded-[var(--ipg-r-sm)] bg-white transition-colors hover:bg-slate-50"
              style={{ border: "1px solid var(--ipg-line-strong)", color: "var(--ipg-ink-2)" }}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <CountRow
        label="만들어진 입면"
        count={p.wallCount}
        unit="장"
        actionLabel="목록"
        icon={Layers}
        onAction={() => p.onOpenDialog(p.openDialog === "elev" ? null : "elev")}
        active={p.openDialog === "elev"}
      />
    </Stack>
  );
}

function StepOpening({ p }: { p: WorkflowRailProps }) {
  return (
    <Stack>
      <Field label="창 종류 · 치수">
        <div
          className="rounded-[var(--ipg-r-md)] p-2.5"
          style={{ border: "1px solid var(--ipg-line)" }}
        >
          {p.presetControl}
        </div>
      </Field>

      <Field label="놓는 방법">
        <div className="flex flex-col gap-1.5">
          <PanelBtn
            icon={Square}
            label="클릭해서 놓기"
            onClick={() => p.onMode("place")}
            active={p.mode === "place"}
            primary={p.mode !== "place"}
          />
          <div className="flex gap-1.5">
            <PanelBtn
              icon={CornerDownLeft}
              label="정밀"
              onClick={p.onTwoPoint}
              active={p.mode === "two-point"}
              compact
            />
            <PanelBtn
              icon={Wand2}
              label="자동 인식"
              onClick={() => p.onMode("auto")}
              active={p.mode === "auto"}
              disabled={!p.hasDxf}
              compact
            />
          </div>
        </div>
      </Field>

      <CountRow
        label="배치된 창·문"
        count={p.openingCount}
        unit="개"
        actionLabel="목록"
        icon={LayoutList}
        onAction={() => p.onOpenDialog(p.openDialog === "openings" ? null : "openings")}
        active={p.openDialog === "openings"}
      />

      <TextLink onClick={() => p.onOpenDialog(p.openDialog === "preset" ? null : "preset")}>
        창 종류 직접 편집
      </TextLink>
    </Stack>
  );
}

function StepType({ p }: { p: WorkflowRailProps }) {
  return (
    <Stack>
      <PanelBtn
        icon={Blocks}
        label="동·타입·세대수 입력"
        onClick={() => p.onOpenDialog(p.openDialog === "types" ? null : "types")}
        active={p.openDialog === "types"}
        primary={p.openDialog !== "types"}
      />
      <CountRow label="등록된 타입" count={p.typeCount} unit="개" />
      <Field label="층고 (층 그룹별)">
        <div
          className="rounded-[var(--ipg-r-md)] p-2.5"
          style={{ border: "1px solid var(--ipg-line)" }}
        >
          {p.floorHeightInput}
        </div>
      </Field>
    </Stack>
  );
}

function StepInsul({ p }: { p: WorkflowRailProps }) {
  return (
    <Stack>
      <PanelBtn
        icon={SlidersHorizontal}
        label="나누기 설정 열기"
        onClick={() => p.onOpenDialog(p.openDialog === "insul" ? null : "insul")}
        active={p.openDialog === "insul"}
        primary={p.openDialog !== "insul"}
      />
      <div
        className="flex items-center gap-2 rounded-[var(--ipg-r-md)] px-3 py-2.5 font-semibold"
        style={{
          fontSize: "var(--ipg-t-md)",
          background: p.insulOn ? "#eafaf4" : "var(--ipg-panel-sub)",
          border: `1px solid ${p.insulOn ? "#a7e5cd" : "var(--ipg-line)"}`,
          color: p.insulOn ? "var(--ipg-ok)" : "var(--ipg-ink-3)",
        }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: p.insulOn ? "var(--ipg-ok)" : "var(--ipg-line-strong)" }}
        />
        {p.insulOn ? "나누기 계산 켜짐" : "아직 꺼져 있습니다"}
      </div>
      <p
        className="leading-relaxed"
        style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}
      >
        설정 창에서 보드 규격(길이·높이·두께)과 조인트·최소 조각 폭을 정하면 화면의 전개
        입면에 나누기 결과가 바로 그려집니다.
      </p>
    </Stack>
  );
}

function StepOutput({ p }: { p: WorkflowRailProps }) {
  return (
    <Stack>
      <PanelBtn
        icon={FileSpreadsheet}
        label="물량 산출 (Output)"
        onClick={p.onOpenOutput}
        disabled={!p.canExport}
        primary
      />
      <PanelBtn
        icon={FileSpreadsheet}
        label={`현장식 산출서 CSV · ${p.siteReportThkLabel}`}
        onClick={p.onExportSiteReportCsv}
        disabled={!p.canExport}
      />
      <PanelBtn icon={Blocks} label="마감 물량 · 기성 관리" onClick={p.onOpenTakeoff} />

      <div className="pt-1" style={{ borderTop: "1px solid var(--ipg-line)" }}>
        <div className="pt-3">
          <Field label="저장">
            <PanelBtn
              icon={p.savingRev ? Loader2 : Save}
              label={p.savingRev ? "저장 중…" : "저장 (새 REV)"}
              onClick={p.onSaveRev}
              disabled={!p.activeProjectId || p.savingRev}
              primary
            />
            <div className="mt-2">
              <TextLink onClick={p.onToggleRevPanel} disabled={!p.activeProjectId}>
                <History className="h-3 w-3" /> REV 목록{p.revCount > 0 ? ` (${p.revCount})` : ""}
              </TextLink>
            </div>
          </Field>
        </div>
      </div>

      <p style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-3)" }}>
        DXF·SVG 개별 출력은 왼쪽 <b style={{ color: "var(--ipg-ink-2)" }}>고급</b> 에서 열 수 있습니다.
      </p>
    </Stack>
  );
}

function LockedNotice({
  step,
  steps,
  onGo,
}: {
  step: StepDef;
  steps: StepDef[];
  onGo: (n: number) => void;
}) {
  const blocker = steps.find(s => s.no < step.no && !s.done) ?? steps[0];
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-[var(--ipg-r-lg)] px-4 py-10 text-center"
      style={{ border: "1px dashed var(--ipg-line-strong)", background: "var(--ipg-panel-sub)" }}
    >
      <Lock className="h-7 w-7" strokeWidth={1.5} style={{ color: "var(--ipg-ink-3)" }} />
      <p
        className="leading-relaxed"
        style={{ fontSize: "var(--ipg-t-md)", color: "var(--ipg-ink-2)" }}
      >
        <b style={{ color: "var(--ipg-ink)" }}>
          {blocker.no} {blocker.title}
        </b>
        을(를) 먼저 끝내야 합니다.
      </p>
      <button
        type="button"
        onClick={() => onGo(blocker.no)}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--ipg-r-sm)] px-4 font-bold text-white transition-all hover:brightness-110"
        style={{ fontSize: "var(--ipg-t-md)", background: "var(--ipg-accent-deep)" }}
      >
        {blocker.no}단계로 가기 <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── 조각들 ───────────────────────────────────────────── */

function StepBadge({ no, done }: { no: number; done: boolean }) {
  return (
    <span
      className="ipg-num flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        fontSize: "11px",
        background: done ? "var(--ipg-ok)" : "var(--ipg-accent)",
      }}
    >
      {done ? <Check className="h-3 w-3" strokeWidth={3.5} /> : no}
    </span>
  );
}

function RailItem({
  step,
  active,
  isCurrent,
  last,
  onClick,
}: {
  step: StepDef;
  active: boolean;
  isCurrent: boolean;
  last: boolean;
  onClick: () => void;
}) {
  const Icon = step.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${step.no}. ${step.title}`}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-[var(--ipg-r-md)] py-2.5 transition-colors",
        active ? "text-white" : "text-white/50 hover:text-white/85"
      )}
      style={{
        background: active ? "rgba(255,255,255,.10)" : undefined,
        opacity: step.locked && !active ? 0.38 : 1,
      }}
    >
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ background: "var(--ipg-accent)" }}
        />
      )}
      {/* 단계 연결선 — 순서가 있다는 걸 조용히 보여준다 */}
      {!last && (
        <span
          className="absolute -bottom-[3px] left-1/2 h-[3px] w-px -translate-x-1/2"
          style={{ background: step.done ? "var(--ipg-ok)" : "rgba(255,255,255,.14)" }}
        />
      )}
      <span className="relative">
        <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
        {step.done ? (
          <span
            className="absolute -right-2 -top-1.5 flex h-[13px] w-[13px] items-center justify-center rounded-full"
            style={{ background: "var(--ipg-ok)", boxShadow: "0 0 0 2px var(--ipg-rail)" }}
          >
            <Check className="h-2 w-2 text-white" strokeWidth={4} />
          </span>
        ) : isCurrent ? (
          <span
            className="absolute -right-2 -top-1 h-[7px] w-[7px] rounded-full"
            style={{ background: "var(--ipg-accent)", boxShadow: "0 0 0 2px var(--ipg-rail)" }}
          />
        ) : null}
      </span>
      <span className="flex items-baseline gap-[3px] whitespace-nowrap leading-none">
        <span className="ipg-num text-[9.5px] font-bold opacity-55">{step.no}</span>
        <span className="text-[10.5px] font-semibold">{step.label}</span>
      </span>
    </button>
  );
}

function RailButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  spin,
  title,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  spin?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        "flex w-full flex-col items-center gap-1.5 rounded-[var(--ipg-r-md)] py-2.5 transition-colors",
        active ? "text-white" : "text-white/50 hover:text-white/85",
        disabled && "cursor-not-allowed opacity-25"
      )}
      style={{ background: active ? "rgba(255,255,255,.10)" : undefined }}
    >
      <Icon className={cn("h-[18px] w-[18px]", spin && "animate-spin")} strokeWidth={1.8} />
      <span className="whitespace-nowrap text-[10.5px] font-semibold leading-none">{label}</span>
    </button>
  );
}

/** 단계 패널 본문의 세로 리듬 — 간격을 한 곳에서 정한다 */
function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3.5">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="ipg-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function PanelBtn({
  icon: Icon,
  label,
  onClick,
  primary,
  active,
  disabled,
  compact,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const bg = active
    ? "var(--ipg-accent)"
    : primary
      ? "var(--ipg-accent-deep)"
      : "#fff";
  const fg = active || primary ? "#fff" : "var(--ipg-ink)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex h-[34px] items-center gap-2 rounded-[var(--ipg-r-md)] px-3 font-semibold transition-all",
        compact ? "flex-1 justify-center" : "w-full",
        !disabled && (active || primary ? "hover:brightness-110" : "hover:bg-slate-50"),
        disabled && "cursor-not-allowed opacity-40"
      )}
      style={{
        fontSize: "var(--ipg-t-md)",
        background: bg,
        color: fg,
        border: active || primary ? "1px solid transparent" : "1px solid var(--ipg-line-strong)",
        boxShadow: active || primary ? "var(--ipg-shadow-1)" : undefined,
      }}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FileBtn({
  icon: Icon,
  label,
  accept,
  onFile,
  primary,
}: {
  icon: IconType;
  label: string;
  accept: string;
  onFile: (f: File) => void;
  primary?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-[var(--ipg-r-md)] px-3 font-semibold transition-all",
        primary ? "hover:brightness-110" : "hover:bg-slate-50"
      )}
      style={{
        fontSize: "var(--ipg-t-md)",
        background: primary ? "var(--ipg-accent-deep)" : "#fff",
        color: primary ? "#fff" : "var(--ipg-ink)",
        border: primary ? "1px solid transparent" : "1px solid var(--ipg-line-strong)",
        boxShadow: primary ? "var(--ipg-shadow-1)" : undefined,
      }}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
      <span className="truncate">{label}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={ev => {
          const f = ev.target.files?.[0];
          if (f) onFile(f);
          ev.target.value = "";
        }}
      />
    </label>
  );
}

function CountRow({
  label,
  count,
  unit,
  actionLabel,
  icon: Icon,
  onAction,
  active,
}: {
  label: string;
  count: number;
  unit: string;
  actionLabel?: string;
  icon?: IconType;
  onAction?: () => void;
  active?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-[var(--ipg-r-md)] px-3 py-2"
      style={{ border: "1px solid var(--ipg-line)" }}
    >
      <span style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-ink-2)" }}>{label}</span>
      <div className="flex items-center gap-2">
        <span
          className="ipg-num font-bold"
          style={{ fontSize: "13.5px", color: count > 0 ? "var(--ipg-ink)" : "var(--ipg-ink-3)" }}
        >
          {count}
          <span className="ml-0.5 text-[11px] font-medium" style={{ color: "var(--ipg-ink-3)" }}>
            {unit}
          </span>
        </span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={count === 0}
            className={cn(
              "flex items-center gap-1 rounded-[var(--ipg-r-sm)] px-1.5 py-[3px] text-[10.5px] font-bold transition-colors",
              count === 0 && "cursor-not-allowed opacity-40"
            )}
            style={{
              border: `1px solid ${active ? "var(--ipg-accent)" : "var(--ipg-line-strong)"}`,
              background: active ? "var(--ipg-accent-soft)" : "#fff",
              color: active ? "var(--ipg-accent-deep)" : "var(--ipg-ink-2)",
            }}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function TextLink({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 self-start font-bold transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-35"
      style={{ fontSize: "var(--ipg-t-sm)", color: "var(--ipg-accent-deep)" }}
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </button>
  );
}

function MiniBtn({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: IconType;
  label?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex h-7 items-center gap-1 rounded-[var(--ipg-r-sm)] px-2 font-semibold transition-colors",
        !disabled && !active && "hover:bg-white",
        disabled && "cursor-not-allowed opacity-35"
      )}
      style={{
        fontSize: "var(--ipg-t-sm)",
        background: active ? "var(--ipg-accent)" : "transparent",
        color: active ? "#fff" : "var(--ipg-ink-2)",
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label && <span>{label}</span>}
    </button>
  );
}
