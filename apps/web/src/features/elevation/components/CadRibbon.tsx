/**
 * CadRibbon — AutoCAD 스타일 리본 UI (세대 단열재 나누기도 전용)
 *
 * 구성 (AutoCAD 2025 레이아웃 대응)
 *   ① 타이틀바   : 앱 아이콘 · 퀵액세스 툴바(새로/열기/저장/내보내기/실행취소) · 문서명 · 도움말/닫기
 *   ② 리본 탭    : 홈 · 삽입 · 수정 · 측정 · 출력 · 관리
 *   ③ 리본 패널  : 탭별 그룹(패널). 각 그룹 = 큰 버튼 + 작은 버튼 2단 + 하단 그룹명
 *
 * 기존 기능은 하나도 빼지 않고 전부 이 리본 안으로 재배치한다.
 * 상태·핸들러는 모두 페이지에서 props 로 주입받는다(로직 이동 없음).
 */
import { useState, type ComponentType } from "react";
import {
  Blocks,
  Calculator,
  Check,
  CornerDownLeft,
  Download,
  FileSpreadsheet,
  FilePlus2,
  FolderOpen,
  Hexagon,
  HelpCircle,
  Layers,
  LayoutList,
  History,
  Loader2,
  Maximize,
  Maximize2,
  Minimize,
  MousePointer2,
  MousePointerClick,
  Pencil,
  Route,
  Ruler,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

export type RibbonMode =
  | "view"
  | "trace"
  | "place"
  | "two-point"
  | "auto"
  | "seg"
  | "measure-dist"
  | "measure-path"
  | "measure-area"
  | "edit";

export interface CadRibbonProps {
  // ── 문서/프로젝트 ──
  projects: { id: string; name: string; latest_rev_no: number }[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  activeProjectName?: string;
  activeRevNo?: number;
  revCount: number;
  dxfName?: string | null;
  reusedRev?: boolean;
  // ── 파일 ──
  onUploadDxf: (file: File) => void;
  onImportProject: (file: File) => void;
  onNewProject: () => void;
  onSaveRev: () => void;
  savingRev: boolean;
  onToggleRevPanel: () => void;
  revPanelOpen: boolean;
  onExportProject: () => void;
  onDeleteProject: () => void;
  // ── 뷰 ──
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  hasDxf: boolean;
  // ── 작업 모드 ──
  mode: RibbonMode;
  onMode: (m: RibbonMode) => void;
  onStartNewChain: () => void;
  onTwoPoint: () => void;
  wallCount: number;
  // ── 편집 ──
  onDeleteEntity: () => void;
  hasSelectedEntity: boolean;
  onUndoEdit: () => void;
  onDownloadEditedDxf: () => void;
  hasRawDxf: boolean;
  // ── 트레이싱 진행 중 ──
  draftCount: number;
  onCommitDraft: () => void;
  onUndoDraftPoint: () => void;
  // ── 출력 ──
  /** 물량 표 CSV (전 입면 · 소스 보드 단위) */
  onExportInsulationCsv: () => void;
  /** 현장식 산출서 CSV (두께별 · 동별/타입별) */
  onExportSiteReportCsv: () => void;
  /** 현장식 산출서 버튼 라벨의 두께 표기 (예 "50T/90T") */
  siteReportThkLabel: string;
  onExportCombinedDxf: () => void;
  onExportSplitDxf: () => void;
  onExportCombinedSvg: () => void;
  onOpenOutput: () => void;
  canExport: boolean;
  // ── 패널(대화상자) ──
  onOpenDialog: (
    k: "insul" | "types" | "elev" | "preset" | "openings" | "layers" | null
  ) => void;
  openDialog:
    | "insul"
    | "types"
    | "elev"
    | "preset"
    | "openings"
    | "layers"
    | null;
  /** 리본에 얹는 오프닝 프리셋 갤러리 + 치수 입력 (페이지에서 조립) */
  presetControl: React.ReactNode;
  /** 리본 도면층 컨트롤 (텍스트 표시 · 레이어 on/off) */
  layerControl: React.ReactNode;
  // ── 기타 ──
  floorHeightInput: React.ReactNode;
  onResetAll: () => void;
  onHelp: () => void;
  onExit: () => void;
  /** 마감 물량 산출 · 기성 패널 열기 */
  onOpenTakeoff: () => void;
  // ── 전체화면 (CAD 처럼 브라우저 크롬 숨김) ──
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  autoFullscreen: boolean;
  onAutoFullscreen: (v: boolean) => void;
}

const TABS = ["홈", "삽입", "수정", "측정", "적산", "출력", "관리"] as const;
type TabKey = (typeof TABS)[number];

/* ── 리본 버튼 (큰 아이콘 = CAD 주요 명령) ───────────────── */
function BigBtn({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  title,
  tone = "default",
}: {
  icon: IconType;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        "flex w-[54px] shrink-0 flex-col items-center gap-0.5 rounded px-0.5 pb-1 pt-1.5 transition-colors",
        "text-[10px] font-medium leading-tight",
        active
          ? "bg-[#cfe3f7] text-[#0a4a86] ring-1 ring-[#7fb3e0]"
          : "text-slate-700 hover:bg-[#e3ecf6]",
        disabled && "cursor-not-allowed opacity-35 hover:bg-transparent"
      )}
    >
      <Icon
        className={cn(
          "h-[20px] w-[20px]",
          tone === "primary" && "text-[#0a63b8]",
          tone === "danger" && "text-rose-600",
          tone === "success" && "text-emerald-600",
          active && "text-[#0a4a86]"
        )}
      />
      <span className="w-full whitespace-pre-line break-keep text-center">
        {label}
      </span>
    </button>
  );
}

/* ── 리본 버튼 (작은 아이콘 = 보조 명령, 2~3단 스택) ──────── */
function SmallBtn({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  title,
  tone = "default",
}: {
  icon: IconType;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        "flex h-[20px] items-center gap-1.5 rounded px-1.5 text-[10.5px] font-medium transition-colors",
        active
          ? "bg-[#cfe3f7] text-[#0a4a86] ring-1 ring-[#7fb3e0]"
          : "text-slate-700 hover:bg-[#e3ecf6]",
        disabled && "cursor-not-allowed opacity-35 hover:bg-transparent"
      )}
    >
      <Icon
        className={cn(
          "h-[14px] w-[14px] shrink-0",
          tone === "danger" && "text-rose-600",
          tone === "success" && "text-emerald-600"
        )}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** 리본 그룹(패널) — 하단에 그룹명, 우측에 세로 구분선 */
function Group({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex h-full min-w-0 shrink-0 flex-col border-r border-[#c9d2dc] px-2 pb-0.5 pt-1">
      <div
        className={cn(
          "flex min-h-0 flex-1 items-start gap-1.5 overflow-hidden",
          wide && "min-w-[160px]"
        )}
      >
        {children}
      </div>
      <div className="shrink-0 pt-1 text-center text-[10px] font-medium leading-none text-slate-400">
        {title}
      </div>
    </div>
  );
}

/** 작은 버튼 세로 스택 (한 칸에 2~3개) */
function Stack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[1px] pt-0.5">{children}</div>;
}

/** 파일 선택 버튼 — <input type=file> 을 감싼 리본 큰 버튼 */
function FileBigBtn({
  icon: Icon,
  label,
  accept,
  onFile,
  title,
  tone = "default",
}: {
  icon: IconType;
  label: string;
  accept: string;
  onFile: (f: File) => void;
  title?: string;
  tone?: "default" | "primary";
}) {
  return (
    <label
      title={title ?? label}
      className="flex w-[54px] shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded px-0.5 pb-1 pt-1.5 text-[10px] font-medium leading-tight text-slate-700 transition-colors hover:bg-[#e3ecf6]"
    >
      <Icon
        className={cn("h-[20px] w-[20px]", tone === "primary" && "text-[#0a63b8]")}
      />
      <span className="w-full whitespace-pre-line break-keep text-center">
        {label}
      </span>
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

export default function CadRibbon(p: CadRibbonProps) {
  const [tab, setTab] = useState<TabKey>("홈");

  const docTitle = p.activeProjectName
    ? `${p.activeProjectName}${p.activeRevNo != null ? ` — REV ${p.activeRevNo}` : ""}`
    : "Drawing1";

  return (
    <div className="shrink-0 select-none">
      {/* ① 타이틀바 + 퀵액세스 툴바 */}
      <div className="flex h-9 items-center gap-2 bg-[#2b3038] px-2 text-white">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-[#1478d6] to-[#003a78] text-[11px] font-black">
          IP
        </span>
        <div className="flex items-center gap-0.5">
          <QatBtn icon={FilePlus2} title="새 프로젝트" onClick={p.onNewProject} />
          <QatFile
            icon={FolderOpen}
            title="프로젝트 불러오기 (.swelev.json)"
            accept=".json,.swelev.json,application/json"
            onFile={p.onImportProject}
          />
          <QatBtn
            icon={p.savingRev ? Loader2 : Save}
            title="저장 (새 REV)"
            onClick={p.onSaveRev}
            disabled={!p.activeProjectId || p.savingRev}
            spin={p.savingRev}
          />
          <QatBtn
            icon={Download}
            title="프로젝트 내보내기"
            onClick={p.onExportProject}
            disabled={p.wallCount === 0}
          />
          <span className="mx-1 h-4 w-px bg-white/20" />
          <QatBtn
            icon={Undo2}
            title="되돌리기 (도면 편집)"
            onClick={p.onUndoEdit}
            disabled={!p.hasRawDxf}
          />
        </div>

        <div className="flex flex-1 items-center justify-center gap-2 truncate px-4">
          <span className="truncate text-[12px] font-medium text-white/85">
            세대 단열재 나누기도 — {docTitle}
          </span>
        </div>

        <button
          type="button"
          onClick={p.onToggleFullscreen}
          title={
            p.isFullscreen
              ? "전체화면 해제 (Esc)"
              : "전체화면 — 브라우저 탭·주소창 숨김"
          }
          className="flex h-7 w-7 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {p.isFullscreen ? (
            <Minimize className="h-[16px] w-[16px]" />
          ) : (
            <Maximize className="h-[16px] w-[16px]" />
          )}
        </button>
        <label
          title="이 도구를 열 때 자동으로 전체화면으로 전환합니다"
          className="mr-1 flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-1 text-[10.5px] text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
        >
          <input
            type="checkbox"
            checked={p.autoFullscreen}
            onChange={ev => p.onAutoFullscreen(ev.target.checked)}
            className="h-3 w-3"
          />
          자동
        </label>
        <button
          type="button"
          onClick={p.onHelp}
          title="사용법 보기"
          className="flex h-7 w-7 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <HelpCircle className="h-[17px] w-[17px]" />
        </button>
        <button
          type="button"
          onClick={p.onExit}
          title="나가기"
          className="flex h-7 w-7 items-center justify-center rounded text-white/70 transition-colors hover:bg-rose-500 hover:text-white"
        >
          <X className="h-[17px] w-[17px]" />
        </button>
      </div>

      {/* ② 리본 탭 */}
      <div className="flex items-end gap-0.5 border-b border-[#c9d2dc] bg-[#e8edf3] px-2 pt-1">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-t px-3.5 py-1 text-[12px] font-medium transition-colors",
              tab === t
                ? "border border-b-0 border-[#c9d2dc] bg-[#f3f6f9] text-[#0a4a86]"
                : "text-slate-600 hover:bg-white/60"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ③ 리본 패널 */}
      <div className="flex h-[96px] items-stretch overflow-hidden border-b border-[#c9d2dc] bg-[#f3f6f9] px-1">
        {tab === "홈" && (
          <>
            <Group title="그리기">
              <BigBtn
                icon={Pencil}
                label={p.wallCount === 0 ? "트레이싱" : "새 입면"}
                onClick={p.onStartNewChain}
                active={p.mode === "trace"}
                disabled={!p.hasDxf}
                tone="primary"
                title="외벽선을 클릭해 입면(체인)을 그립니다"
              />
              <BigBtn
                icon={Square}
                label={"프리셋\n배치"}
                onClick={() => p.onMode("place")}
                active={p.mode === "place"}
                disabled={p.wallCount === 0}
                title="선택한 오프닝 프리셋을 벽에 배치"
              />
              <BigBtn
                icon={CornerDownLeft}
                label="정밀"
                onClick={p.onTwoPoint}
                active={p.mode === "two-point"}
                disabled={p.wallCount === 0}
                title="두 점을 찍어 정확한 위치·폭으로 배치"
              />
              <BigBtn
                icon={Wand2}
                label={"창호\n자동"}
                onClick={() => p.onMode("auto")}
                active={p.mode === "auto"}
                disabled={p.wallCount === 0 || !p.hasDxf}
                title="평면 라벨(W×H)에서 창호를 자동 인식"
              />
            </Group>

            {p.mode === "trace" && p.draftCount > 0 && (
              <Group title="트레이싱">
                <BigBtn
                  icon={Check}
                  label={"입면\n확정"}
                  onClick={p.onCommitDraft}
                  disabled={p.draftCount < 2}
                  tone="success"
                />
                <Stack>
                  <SmallBtn
                    icon={Undo2}
                    label="점 되돌리기"
                    onClick={p.onUndoDraftPoint}
                  />
                  <SmallBtn
                    icon={MousePointer2}
                    label="보기 모드"
                    onClick={() => p.onMode("view")}
                  />
                </Stack>
              </Group>
            )}

            <Group title="뷰">
              <BigBtn
                icon={MousePointer2}
                label="보기"
                onClick={() => p.onMode("view")}
                active={p.mode === "view"}
                title="화면 이동·확대만 (선택/그리기 없음)"
              />
              <BigBtn
                icon={Maximize2}
                label={"화면\n맞춤"}
                onClick={p.onFitToScreen}
                disabled={!p.hasDxf}
              />
              <Stack>
                <SmallBtn
                  icon={ZoomIn}
                  label="확대"
                  onClick={p.onZoomIn}
                  disabled={!p.hasDxf}
                />
                <SmallBtn
                  icon={ZoomOut}
                  label="축소"
                  onClick={p.onZoomOut}
                  disabled={!p.hasDxf}
                />
              </Stack>
            </Group>

            <Group title="오프닝" wide>{p.presetControl}</Group>

            <Group title="도면층">
              {p.layerControl}
              <Stack>
                <SmallBtn
                  icon={Layers}
                  label="도면층 목록"
                  onClick={() => p.onOpenDialog("layers")}
                  active={p.openDialog === "layers"}
                />
              </Stack>
            </Group>

            <Group title="패널">
              <BigBtn
                icon={SlidersHorizontal}
                label={"단열재\n나누기"}
                onClick={() => p.onOpenDialog("insul")}
                active={p.openDialog === "insul"}
                title="단열재 나누기도 설정 (보드 규격·조인트)"
              />
              <BigBtn
                icon={Blocks}
                label={"동·타입\n설정"}
                onClick={() => p.onOpenDialog("types")}
                active={p.openDialog === "types"}
                title="동·타입·세대수 매트릭스"
              />
              <Stack>
                <SmallBtn
                  icon={Layers}
                  label="입면 목록"
                  onClick={() => p.onOpenDialog("elev")}
                  active={p.openDialog === "elev"}
                />
                <SmallBtn
                  icon={LayoutList}
                  label="오프닝 목록"
                  onClick={() => p.onOpenDialog("openings")}
                  active={p.openDialog === "openings"}
                />
                <SmallBtn
                  icon={Square}
                  label="프리셋 편집"
                  onClick={() => p.onOpenDialog("preset")}
                  active={p.openDialog === "preset"}
                />
              </Stack>
            </Group>

            <Group title="설정" wide>
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  층고
                </span>
                <div className="w-[132px]">{p.floorHeightInput}</div>
              </div>
            </Group>

            <Group title="초기화">
              <BigBtn
                icon={Trash2}
                label={"전체\n초기화"}
                onClick={p.onResetAll}
                disabled={p.wallCount === 0 && p.draftCount === 0}
                tone="danger"
                title="입면·오프닝을 모두 지웁니다"
              />
            </Group>
          </>
        )}

        {tab === "삽입" && (
          <>
            <Group title="도면">
              <FileBigBtn
                icon={Upload}
                label={"DXF\n업로드"}
                accept=".dxf"
                onFile={p.onUploadDxf}
                tone="primary"
                title="평면 DXF 도면 불러오기"
              />
              <FileBigBtn
                icon={FolderOpen}
                label={"프로젝트\n열기"}
                accept=".json,.swelev.json,application/json"
                onFile={p.onImportProject}
                title="내보낸 프로젝트 파일(.swelev.json) 불러오기"
              />
            </Group>
            <Group title="현재 도면" wide>
              <div className="flex flex-col justify-center gap-1 pt-1 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
                  <span className="max-w-[240px] truncate">
                    {p.dxfName ?? "불러온 도면 없음"}
                  </span>
                </div>
                {p.reusedRev && (
                  <span className="text-[10.5px] text-slate-400">
                    불러온 REV · DXF 재사용
                  </span>
                )}
              </div>
            </Group>
          </>
        )}

        {tab === "수정" && (
          <>
            <Group title="편집">
              <BigBtn
                icon={MousePointerClick}
                label="편집"
                onClick={() => p.onMode("edit")}
                active={p.mode === "edit"}
                disabled={!p.hasDxf}
                title="도면 요소 선택·이동·삭제"
              />
              <Stack>
                <SmallBtn
                  icon={Trash2}
                  label="선택 삭제"
                  onClick={p.onDeleteEntity}
                  disabled={!p.hasSelectedEntity}
                  tone="danger"
                />
                <SmallBtn
                  icon={Undo2}
                  label="되돌리기"
                  onClick={p.onUndoEdit}
                  disabled={!p.hasRawDxf}
                />
              </Stack>
            </Group>
            <Group title="도면 저장">
              <BigBtn
                icon={Download}
                label={"수정본\nDXF"}
                onClick={p.onDownloadEditedDxf}
                disabled={!p.hasRawDxf}
                title="편집한 도면을 DXF 로 저장"
              />
            </Group>
          </>
        )}

        {tab === "측정" && (
          <Group title="측정">
            <BigBtn
              icon={Ruler}
              label="거리"
              onClick={() => p.onMode("measure-dist")}
              active={p.mode === "measure-dist"}
              disabled={!p.hasDxf}
              title="두 점 클릭 (Esc 초기화)"
            />
            <BigBtn
              icon={Route}
              label="연속"
              onClick={() => p.onMode("measure-path")}
              active={p.mode === "measure-path"}
              disabled={!p.hasDxf}
              title="점을 이어 클릭해 누적 길이"
            />
            <BigBtn
              icon={Hexagon}
              label="면적"
              onClick={() => p.onMode("measure-area")}
              active={p.mode === "measure-area"}
              disabled={!p.hasDxf}
              title="꼭짓점 3개 이상 클릭"
            />
          </Group>
        )}

        {tab === "적산" && (
          <Group title="마감 물량" wide>
            <BigBtn
              icon={Calculator}
              label={"물량\n산출"}
              onClick={p.onOpenTakeoff}
              tone="primary"
              title="실 영역을 추적해 마감 물량을 산출합니다 (장판·타일·도배·걸레받이)"
            />
            <BigBtn
              icon={LayoutList}
              label={"세대\n대장"}
              onClick={p.onOpenTakeoff}
              title="동·층·호 세대 대장 (규칙 생성 / Excel 붙여넣기)"
            />
            <BigBtn
              icon={Blocks}
              label={"기성\n관리"}
              onClick={p.onOpenTakeoff}
              tone="success"
              title="차수별 진도 입력 → 기성 물량 산출 · 검증"
            />
          </Group>
        )}

        {tab === "출력" && (
          <>
            <Group title="도면 출력">
              <BigBtn
                icon={Download}
                label={"DXF\n통합"}
                onClick={p.onExportCombinedDxf}
                disabled={!p.canExport}
                title="모든 입면을 한 DXF 에 위/아래로 통합"
              />
              <BigBtn
                icon={Download}
                label={"DXF\n분할"}
                onClick={p.onExportSplitDxf}
                disabled={!p.canExport}
                title="입면별 분할 DXF 저장"
              />
              <BigBtn
                icon={Download}
                label={"SVG\n통합"}
                onClick={p.onExportCombinedSvg}
                disabled={!p.canExport}
                title="모든 입면을 한 SVG 로 통합"
              />
            </Group>
            <Group title="물량" wide>
              <BigBtn
                icon={FileSpreadsheet}
                label={"물량 표\nCSV"}
                onClick={p.onExportInsulationCsv}
                disabled={!p.canExport}
                tone="success"
                title="전 입면 물량 표 CSV — 소스 보드(판) 단위로 묶어 내보냅니다"
              />
              <BigBtn
                icon={FileSpreadsheet}
                label={"현장식\n산출서"}
                onClick={p.onExportSiteReportCsv}
                disabled={!p.canExport}
                tone="primary"
                title={`두께(${p.siteReportThkLabel || "두께별"})별 · 동별/타입별 현장식 산출서 CSV. 세대수는 입면별 '세대수'로 곱합니다`}
              />
              <BigBtn
                icon={FileSpreadsheet}
                label="Output"
                onClick={p.onOpenOutput}
                disabled={!p.canExport}
                title="동·코어별 통합 물량 산출"
              />
            </Group>
            <Group title="프로젝트">
              <BigBtn
                icon={Download}
                label={"파일로\n내보내기"}
                onClick={p.onExportProject}
                disabled={p.wallCount === 0}
                title="설정·입면·DXF 를 한 파일로"
              />
            </Group>
          </>
        )}

        {tab === "관리" && (
          <>
            <Group title="프로젝트" wide>
              <div className="flex flex-col gap-1 pt-1">
                <select
                  value={p.activeProjectId ?? ""}
                  onChange={e => p.onSelectProject(e.target.value || null)}
                  className="h-7 min-w-[220px] rounded border border-slate-300 bg-white px-2 text-[12px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#004791]/30"
                >
                  <option value="">— 프로젝트 선택 —</option>
                  {p.projects.map(pr => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name} (REV {pr.latest_rev_no})
                    </option>
                  ))}
                </select>
                <div className="flex gap-1">
                  <SmallBtn
                    icon={FilePlus2}
                    label="새 프로젝트"
                    onClick={p.onNewProject}
                  />
                  <SmallBtn
                    icon={Trash2}
                    label="삭제"
                    onClick={p.onDeleteProject}
                    disabled={!p.activeProjectId}
                    tone="danger"
                  />
                </div>
              </div>
            </Group>
            <Group title="리비전">
              <BigBtn
                icon={p.savingRev ? Loader2 : Save}
                label={"저장\n(새 REV)"}
                onClick={p.onSaveRev}
                disabled={!p.activeProjectId || p.savingRev}
                tone="primary"
              />
              <BigBtn
                icon={History}
                label={`REV 목록${p.revCount ? `\n(${p.revCount})` : ""}`}
                onClick={p.onToggleRevPanel}
                active={p.revPanelOpen}
                disabled={!p.activeProjectId}
              />
            </Group>
          </>
        )}
      </div>
    </div>
  );
}

/* ── 퀵액세스 툴바 버튼 ─────────────────────────────────── */
function QatBtn({
  icon: Icon,
  title,
  onClick,
  disabled,
  spin,
}: {
  icon: IconType;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/15 hover:text-white",
        disabled && "cursor-not-allowed opacity-30 hover:bg-transparent"
      )}
    >
      <Icon className={cn("h-[15px] w-[15px]", spin && "animate-spin")} />
    </button>
  );
}

function QatFile({
  icon: Icon,
  title,
  accept,
  onFile,
}: {
  icon: IconType;
  title: string;
  accept: string;
  onFile: (f: File) => void;
}) {
  return (
    <label
      title={title}
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      <Icon className="h-[15px] w-[15px]" />
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
