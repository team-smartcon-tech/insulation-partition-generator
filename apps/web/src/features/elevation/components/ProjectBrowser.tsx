/**
 * ProjectBrowser — 현장 → 세부 프로젝트 → REV 를 카드로 고르는 프로젝트 관리 화면.
 *
 * 왜 만들었나: 리본 [관리] 탭의 `<select>` 하나로 프로젝트를 고르던 방식은
 *   ① 같은 이름이 여러 개 보여도 구분이 안 되고(부산장안 2개 …)
 *   ② 언제 작업했는지·도면이 뭔지 알 수 없고
 *   ③ 현장 단위로 묶을 방법이 없었다.
 * 그래서 현장(카드) 한 단계를 위에 두고, 카드를 눌러 그 안의 세부 프로젝트를 고른다.
 *
 * 계층: 현장(elev_sites) → 세부 프로젝트(elev_projects) → REV(elev_revisions)
 * 데이터: 현장 목록은 useElevSites, 세부 프로젝트는 기존 useElevProjects 를 site_id 로 묶어 쓴다
 *        (프로젝트 목록 API 를 그대로 재사용 — 서버 왕복 추가 없음).
 */
import { useMemo, useRef, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  FolderPlus,
  History,
  ImagePlus,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { DbElevProject, DbElevSite } from "@ipg/shared";
import { cn } from "@/lib/utils";
import {
  useCreateElevProject,
  useCreateElevSite,
  useDeleteElevProject,
  useDeleteElevRevision,
  useDeleteElevSite,
  useElevProject,
  useElevProjects,
  useElevSites,
  useRenameElevProject,
  useUpdateElevSite,
} from "../hooks";

export interface ProjectBrowserProps {
  open: boolean;
  onClose: () => void;
  /** 현재 열려 있는 세부 프로젝트 — 카드에 "열림" 표시 */
  activeProjectId: string | null;
  /**
   * 세부 프로젝트 열기. revId 가 null 이면 최신 REV(없으면 빈 상태)로 연다.
   * 실제 로드는 페이지가 담당하고, 성공하면 이 화면은 닫힌다.
   */
  onOpenProject: (projectId: string, revId: string | null) => void | Promise<void>;
}

/** 카드 상단 요약 — "세부 3 · REV 21" */
interface SiteStat {
  projectCount: number;
  revTotal: number;
  latestAt: string | null;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return "작업 기록 없음";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
};

export default function ProjectBrowser({
  open,
  onClose,
  activeProjectId,
  onOpenProject,
}: ProjectBrowserProps) {
  const { data: sites = [], isLoading: sitesLoading, error: sitesError } = useElevSites();
  const { data: projects = [], isLoading: projectsLoading } = useElevProjects();

  const createSiteMut = useCreateElevSite();
  const updateSiteMut = useUpdateElevSite();
  const deleteSiteMut = useDeleteElevSite();
  const createProjectMut = useCreateElevProject();
  const renameProjectMut = useRenameElevProject();
  const deleteProjectMut = useDeleteElevProject();

  /** null = 현장 목록, 그 외 = 그 현장의 세부 프로젝트 목록(UNASSIGNED = 미분류) */
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [siteForm, setSiteForm] = useState<null | { id: string | null; name: string; thumb: File | null }>(
    null
  );

  /** site_id → 세부 프로젝트 목록 (미분류는 UNASSIGNED 키) */
  const bySite = useMemo(() => {
    const m = new Map<string, DbElevProject[]>();
    for (const p of projects) {
      const key = p.site_id ?? UNASSIGNED;
      const list = m.get(key);
      if (list) list.push(p);
      else m.set(key, [p]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return m;
  }, [projects]);

  const statOf = (siteId: string): SiteStat => {
    const list = bySite.get(siteId) ?? [];
    return {
      projectCount: list.length,
      revTotal: list.reduce((s, p) => s + (p.latest_rev_no ?? 0), 0),
      latestAt: list.length ? list[0].updated_at : null,
    };
  };

  const unassigned = bySite.get(UNASSIGNED) ?? [];

  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withStat = sites.map((s) => ({ site: s, stat: statOf(s.id) }));
    // 최근 작업한 현장이 위로 — 작업 기록이 없으면 뒤로 민다.
    withStat.sort((a, b) => (b.stat.latestAt ?? "").localeCompare(a.stat.latestAt ?? ""));
    if (!q) return withStat;
    return withStat.filter(
      ({ site }) =>
        site.name.toLowerCase().includes(q) ||
        (site.description ?? "").toLowerCase().includes(q) ||
        (bySite.get(site.id) ?? []).some((p) => p.name.toLowerCase().includes(q))
    );
    // statOf 는 bySite 파생이라 deps 에 bySite 만 있으면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, bySite, query]);

  const openedSite = openSiteId && openSiteId !== UNASSIGNED
    ? sites.find((s) => s.id === openSiteId) ?? null
    : null;

  const siteProjects = useMemo(() => {
    if (!openSiteId) return [];
    const list = bySite.get(openSiteId) ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [openSiteId, bySite, query]);

  if (!open) return null;

  // ── 현장 저장(추가/수정) ──
  const submitSiteForm = async () => {
    if (!siteForm) return;
    const name = siteForm.name.trim();
    if (!name) {
      toast.error("현장 이름을 입력하세요.");
      return;
    }
    try {
      if (siteForm.id) {
        await updateSiteMut.mutateAsync({ siteId: siteForm.id, name, thumb: siteForm.thumb });
        toast.success("현장 정보를 저장했습니다.");
      } else {
        await createSiteMut.mutateAsync({ name, thumb: siteForm.thumb });
        toast.success(`현장 '${name}' 추가됨`);
      }
      setSiteForm(null);
    } catch (e) {
      toast.error(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const addProject = async (siteId: string | null) => {
    const name = window.prompt("새 세부 프로젝트 이름 (예: 84A 타입, 101동)")?.trim();
    if (!name) return;
    try {
      const { project } = await createProjectMut.mutateAsync({ name, siteId });
      toast.success(`세부 프로젝트 '${project.name}' 생성됨`);
      await onOpenProject(project.id, null);
    } catch (e) {
      toast.error(`생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="ipg-ui fixed inset-0 z-[90] flex items-center justify-center bg-[#050d16]/70 p-4 backdrop-blur-sm">
      <div
        className="flex h-[min(92vh,900px)] w-[min(1480px,96vw)] flex-col overflow-hidden rounded-[18px] bg-white"
        style={{ boxShadow: "0 40px 120px -24px rgba(3,15,35,.75)" }}
      >
        {/* ── 헤더 (네이비 배너) ── */}
        <header
          className="relative shrink-0 overflow-hidden px-6 py-4 text-white"
          style={{ background: "var(--ipg-rail)" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
              backgroundSize: "34px 34px",
              maskImage: "radial-gradient(120% 90% at 20% 0%, #000 30%, transparent 80%)",
              WebkitMaskImage: "radial-gradient(120% 90% at 20% 0%, #000 30%, transparent 80%)",
            }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {/* 브레드크럼 — 현재 어느 단계인지 항상 보이게 */}
              <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/65">
                <button
                  type="button"
                  onClick={() => setOpenSiteId(null)}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-colors hover:bg-white/15 hover:text-white",
                    !openSiteId && "text-white"
                  )}
                >
                  현장
                </button>
                {openSiteId && (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span className="truncate text-white">
                      {openSiteId === UNASSIGNED ? "미분류" : openedSite?.name ?? "…"}
                    </span>
                  </>
                )}
              </div>
              <h2 className="mt-0.5 truncate text-[19px] font-extrabold tracking-tight">
                {openSiteId
                  ? openSiteId === UNASSIGNED
                    ? "미분류 세부 프로젝트"
                    : openedSite?.name ?? "세부 프로젝트"
                  : "현장 프로젝트"}
              </h2>
              <p className="mt-0.5 text-[12px] text-white/70">
                {openSiteId
                  ? "세부 프로젝트를 열면 최신 REV 도면과 설정이 그대로 복원됩니다."
                  : "현장을 고르면 그 안의 세부 프로젝트를 골라 작업을 이어갑니다."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/55" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={openSiteId ? "세부 프로젝트 검색" : "현장 · 세부 프로젝트 검색"}
                  className="h-10 w-[240px] rounded-xl border border-white/25 bg-white/12 pl-9 pr-3 text-[13px] text-white outline-none backdrop-blur transition-colors placeholder:text-white/50 focus:border-white/60 focus:bg-white/20"
                />
              </div>
              {openSiteId ? (
                <button
                  type="button"
                  onClick={() => addProject(openSiteId === UNASSIGNED ? null : openSiteId)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-[var(--ipg-accent-deep)] transition-transform hover:-translate-y-0.5"
                >
                  <FolderPlus className="h-4 w-4" />
                  세부 프로젝트 추가
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSiteForm({ id: null, name: "", thumb: null })}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-[var(--ipg-accent-deep)] transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4" />
                  현장 추가
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                title="닫기 (작업 화면으로)"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-white/15 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {/* ── 본문 ── */}
        <div className="ipg-scroll flex-1 overflow-auto px-6 py-5" style={{ background: "var(--ipg-panel-sub)" }}>
          {/* 현장 목록을 못 읽는 상황(마이그레이션 전 등) — 기존 프로젝트는 미분류로 계속 열 수 있다 */}
          {sitesError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              현장 목록을 불러오지 못했습니다 — 저장된 프로젝트는 아래 <b>미분류</b>에서 그대로 열 수
              있습니다.
              <span className="ml-1 text-amber-700/80">
                ({sitesError instanceof Error ? sitesError.message : String(sitesError)})
              </span>
            </div>
          )}

          {/* 현장 추가·수정 폼 */}
          {siteForm && !openSiteId && (
            <SiteForm
              form={siteForm}
              onChange={setSiteForm}
              onCancel={() => setSiteForm(null)}
              onSubmit={submitSiteForm}
              busy={createSiteMut.isPending || updateSiteMut.isPending}
            />
          )}

          {openSiteId ? (
            /* ── 2단계: 세부 프로젝트 ── */
            <>
              <div className="mb-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenSiteId(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  현장 목록
                </button>
                <span className="text-[12.5px] text-slate-400">
                  세부 프로젝트 {siteProjects.length}
                </span>
              </div>

              {projectsLoading ? (
                <CardGridSkeleton />
              ) : siteProjects.length === 0 ? (
                <EmptyState
                  icon={Layers}
                  title="세부 프로젝트가 없습니다"
                  desc="동·타입 단위로 세부 프로젝트를 만들어 도면과 REV를 따로 관리하세요."
                  actionLabel="세부 프로젝트 추가"
                  onAction={() => addProject(openSiteId === UNASSIGNED ? null : openSiteId)}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {siteProjects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      sites={sites}
                      active={p.id === activeProjectId}
                      onOpen={(revId) => onOpenProject(p.id, revId)}
                      onRename={async (name) => {
                        try {
                          await renameProjectMut.mutateAsync({ projectId: p.id, name });
                          toast.success("이름을 바꿨습니다.");
                        } catch (e) {
                          toast.error(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      }}
                      onMove={async (siteId) => {
                        try {
                          await renameProjectMut.mutateAsync({ projectId: p.id, siteId });
                          toast.success("현장을 옮겼습니다.");
                        } catch (e) {
                          toast.error(`이동 실패: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      }}
                      onDelete={async () => {
                        if (
                          !window.confirm(
                            `'${p.name}' 세부 프로젝트를 삭제할까요?\n저장된 REV ${p.latest_rev_no}개와 도면이 함께 삭제됩니다.`
                          )
                        )
                          return;
                        try {
                          await deleteProjectMut.mutateAsync(p.id);
                          toast.success("삭제됨");
                        } catch (e) {
                          toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ── 1단계: 현장 카드 ── */
            <>
              {sitesLoading || projectsLoading ? (
                <CardGridSkeleton />
              ) : filteredSites.length === 0 && unassigned.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title={query ? "검색 결과가 없습니다" : "현장이 없습니다"}
                  desc={
                    query
                      ? "다른 이름으로 찾아보세요."
                      : "현장을 먼저 만들고, 그 안에 동·타입별 세부 프로젝트를 추가하세요."
                  }
                  actionLabel={query ? undefined : "현장 추가"}
                  onAction={query ? undefined : () => setSiteForm({ id: null, name: "", thumb: null })}
                />
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredSites.map(({ site, stat }) => (
                    <SiteCard
                      key={site.id}
                      site={site}
                      stat={stat}
                      hasActive={(bySite.get(site.id) ?? []).some((p) => p.id === activeProjectId)}
                      onOpen={() => {
                        setQuery("");
                        setOpenSiteId(site.id);
                      }}
                      onEdit={() => setSiteForm({ id: site.id, name: site.name, thumb: null })}
                      onDelete={async () => {
                        if (!window.confirm(`현장 '${site.name}'을(를) 삭제할까요?`)) return;
                        try {
                          await deleteSiteMut.mutateAsync(site.id);
                          toast.success("현장을 삭제했습니다.");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    />
                  ))}

                  {/* 현장에 소속되지 않은 프로젝트 — 옮기기 전까지 여기서 접근 */}
                  {unassigned.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setOpenSiteId(UNASSIGNED);
                      }}
                      className="flex flex-col overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-left transition-colors hover:border-[var(--ipg-accent)]/50 hover:bg-white"
                    >
                      <div className="flex aspect-[16/10] w-full items-center justify-center bg-slate-100/70">
                        <Layers className="h-10 w-10 text-slate-300" strokeWidth={1.6} />
                      </div>
                      <div className="p-4">
                        <div className="text-[15px] font-bold text-slate-700">미분류</div>
                        <div className="mt-1 text-[12.5px] text-slate-400">
                          현장에 넣지 않은 세부 프로젝트 {unassigned.length}개
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 현장에 속하지 않은 프로젝트 묶음 키 — 실제 site_id 와 겹치지 않는 값 */
const UNASSIGNED = "__unassigned__";

/* ── 현장 카드 ─────────────────────────────────────────── */
function SiteCard({
  site,
  stat,
  hasActive,
  onOpen,
  onEdit,
  onDelete,
}: {
  site: DbElevSite;
  stat: SiteStat;
  hasActive: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [thumbOk, setThumbOk] = useState(true);
  const showThumb = !!site.thumbnail_url && thumbOk;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-[0_1px_3px_rgba(16,24,40,0.06),0_10px_24px_-14px_rgba(16,24,40,0.16)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--ipg-shadow-2)]",
        hasActive ? "border-[var(--ipg-accent)]" : "border-slate-200"
      )}
    >
      <button type="button" onClick={onOpen} className="text-left">
        <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-slate-100 bg-slate-50">
          {showThumb ? (
            <img
              src={site.thumbnail_url ?? undefined}
              alt={`${site.name} 조감도`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              loading="lazy"
              onError={() => setThumbOk(false)}
            />
          ) : (
            <div className="relative h-full w-full bg-gradient-to-br from-[#2a8fe6] via-[#0a63b8] to-[#00274d]">
              <div
                className="absolute inset-0 opacity-[0.16]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
                  backgroundSize: "26px 26px",
                }}
              />
              <Building2
                className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/85"
                strokeWidth={1.5}
              />
            </div>
          )}
          {hasActive && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-bold text-[var(--ipg-accent-deep)] shadow-sm">
              <Check className="h-3 w-3" />열림
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="truncate text-[16px] font-bold tracking-tight text-slate-900">
            {site.name}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[12.5px] text-slate-500">
            <span className="ipg-num font-semibold text-slate-600">세부 {stat.projectCount}</span>
            <span className="text-slate-300">·</span>
            <span className="ipg-num">REV {stat.revTotal}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400">{fmtDate(stat.latestAt)}</span>
          </div>
        </div>
      </button>

      {/* 카드 액션 — 카드에 마우스를 올렸을 때만 노출해 그리드를 조용하게 유지 */}
      <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconBtn icon={ImagePlus} title="이름·사진 변경" onClick={onEdit} />
        <IconBtn icon={Trash2} title="현장 삭제" onClick={onDelete} danger />
      </div>
    </div>
  );
}

/* ── 세부 프로젝트 카드 ────────────────────────────────── */
function ProjectCard({
  project,
  sites,
  active,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  project: DbElevProject;
  sites: DbElevSite[];
  active: boolean;
  onOpen: (revId: string | null) => void | Promise<void>;
  onRename: (name: string) => void;
  onMove: (siteId: string | null) => void;
  onDelete: () => void;
}) {
  const [revOpen, setRevOpen] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-colors",
        active ? "border-[var(--ipg-accent)] ring-1 ring-[var(--ipg-accent)]/25" : "border-slate-200"
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2a8fe6] to-[#00396f] text-white">
          <Layers className="h-5 w-5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold text-slate-900">{project.name}</span>
            {active && (
              <span className="shrink-0 rounded-full bg-[#0a63b8]/10 px-2 py-0.5 text-[10.5px] font-bold text-[var(--ipg-accent-deep)]">
                열림
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
              REV {project.latest_rev_no}
            </span>
            <span className="text-slate-400">{fmtDate(project.updated_at)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpen(null)}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--ipg-accent-deep)] px-3 text-[12.5px] font-bold text-white transition-all hover:brightness-110"
        >
          열기
          {project.latest_rev_no > 0 && (
            <span className="text-white/70">· 최신 REV {project.latest_rev_no}</span>
          )}
        </button>
        <IconBtn
          icon={History}
          title="REV 목록"
          onClick={() => setRevOpen((v) => !v)}
          active={revOpen}
          disabled={project.latest_rev_no === 0}
        />
        <IconBtn
          icon={Pencil}
          title="이름 변경"
          onClick={() => {
            const name = window.prompt("세부 프로젝트 이름", project.name)?.trim();
            if (name && name !== project.name) onRename(name);
          }}
        />
        <IconBtn icon={Trash2} title="삭제" onClick={onDelete} danger />
      </div>

      {/* 현장 이동 — 잘못 들어간 프로젝트를 카드에서 바로 옮긴다 */}
      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
        <span className="text-[11.5px] font-semibold text-slate-400">현장</span>
        <select
          value={project.site_id ?? ""}
          onChange={(e) => onMove(e.target.value || null)}
          className="h-7 flex-1 rounded border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 outline-none focus:border-[var(--ipg-accent)]"
        >
          <option value="">미분류</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {revOpen && <RevisionList projectId={project.id} onOpen={onOpen} />}
    </div>
  );
}

/** REV 목록 — 카드를 펼쳤을 때만 조회한다(목록 화면에서 전부 불러오지 않도록) */
function RevisionList({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (revId: string) => void | Promise<void>;
}) {
  const { data, isLoading } = useElevProject(projectId);
  const deleteRevMut = useDeleteElevRevision();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-[12px] text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> REV 불러오는 중…
      </div>
    );
  }
  const revisions = data?.revisions ?? [];
  if (revisions.length === 0) {
    return (
      <div className="border-t border-slate-100 px-4 py-3 text-[12px] text-slate-400">
        저장된 REV가 없습니다.
      </div>
    );
  }
  return (
    <div className="max-h-52 divide-y divide-slate-100 overflow-auto border-t border-slate-100 bg-slate-50/60">
      {revisions.map((r) => (
        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
          <span className="w-12 shrink-0 font-bold text-slate-700">REV {r.rev_no}</span>
          <span className="shrink-0 tabular-nums text-slate-400">
            {new Date(r.created_at).toLocaleString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="flex-1 truncate text-slate-500">
            {r.dxf_name ?? "-"}
            {r.memo ? ` · ${r.memo}` : ""}
          </span>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="shrink-0 rounded border border-[#004791] px-2 py-0.5 font-semibold text-[#004791] transition-colors hover:bg-blue-50"
          >
            열기
          </button>
          <button
            type="button"
            title="REV 삭제"
            onClick={async () => {
              if (!window.confirm(`REV ${r.rev_no} 삭제?`)) return;
              try {
                await deleteRevMut.mutateAsync({ projectId, revId: r.id });
                toast.success("삭제됨");
              } catch (e) {
                toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            className="shrink-0 rounded p-1 text-rose-500 transition-colors hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── 현장 추가·수정 폼 ─────────────────────────────────── */
function SiteForm({
  form,
  onChange,
  onCancel,
  onSubmit,
  busy,
}: {
  form: { id: string | null; name: string; thumb: File | null };
  onChange: (f: { id: string | null; name: string; thumb: File | null }) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewUrl = useMemo(
    () => (form.thumb ? URL.createObjectURL(form.thumb) : null),
    [form.thumb]
  );

  return (
    <div className="mb-5 rounded-xl border border-[var(--ipg-accent)]/25 bg-white p-4 shadow-sm">
      <div className="mb-3 text-[13.5px] font-bold text-slate-800">
        {form.id ? "현장 정보 수정" : "새 현장 추가"}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {/* 썸네일 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative h-[92px] w-[148px] shrink-0 overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-[var(--ipg-accent)]"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="미리보기" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11.5px] text-slate-400">
              <ImagePlus className="h-5 w-5" />
              조감도 이미지
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) onChange({ ...form, thumb: f });
            e.target.value = "";
          }}
        />

        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">현장명</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="예: 화성남양 2차"
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-[13.5px] outline-none focus:border-[var(--ipg-accent)]"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--ipg-accent-deep)] px-5 text-[13px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            저장
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-300 px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 공통 조각 ─────────────────────────────────────────── */
function IconBtn({
  icon: Icon,
  title,
  onClick,
  danger,
  active,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border bg-white/95 transition-colors",
        danger
          ? "border-rose-200 text-rose-500 hover:bg-rose-50"
          : active
            ? "border-[var(--ipg-accent)] bg-blue-50 text-[var(--ipg-accent-deep)]"
            : "border-slate-200 text-slate-500 hover:bg-slate-100",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white/95"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  desc,
  actionLabel,
  onAction,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-20 text-center">
      <Icon className="h-12 w-12 text-slate-300" strokeWidth={1.4} />
      <div className="mt-4 text-[15px] font-bold text-slate-700">{title}</div>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-400">{desc}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--ipg-accent-deep)] px-5 text-[13px] font-bold text-white transition-all hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** 로딩 중에도 카드 격자 모양을 유지해 화면이 튀지 않게 한다 */
function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="aspect-[16/10] w-full animate-pulse bg-slate-100" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
