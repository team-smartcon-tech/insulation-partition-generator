/**
 * ProjectBrowser — 현장 → 세부 프로젝트 → REV 를 카드로 고르는 프로젝트 관리 화면.
 *
 * 단열 Layout 의 같은 이름 컴포넌트와 **같은 계층·같은 껍데기**를 쓴다. 현장 목록도 같은
 * 테이블(elev_sites)을 보므로, 한 도구에서 만든 현장이 다른 도구에서도 그대로 보인다.
 * 다른 점은 안에 담기는 것뿐이다 — 도면/REV 대신 임대계획/REV.
 *
 * 계층: 현장(elev_sites) → 세부 프로젝트(tc_rental_projects) → REV(tc_rental_revisions)
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  FolderPlus,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateProject,
  useCreateSite,
  useDeleteProject,
  useDeleteRevision,
  useDeleteSite,
  useProject,
  useProjects,
  useSites,
  useUpdateSite,
} from "../hooks";
import type { TcProjectRow, TcRevisionMeta } from "../api";

/** 현장이 지정되지 않은 프로젝트를 담는 가상 현장 키 */
const UNASSIGNED = "__unassigned__";

export interface ProjectBrowserProps {
  onClose: () => void;
  /** 지금 열려 있는 세부 프로젝트 — 카드에 "열림" 표시 */
  currentProjectId: string | null;
  /** 세부 프로젝트 열기. revId 가 null 이면 최신 REV(없으면 빈 계획)로 연다. */
  onOpen: (projectId: string, revId: string | null) => void;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return "오늘";
  return `${String(d.getFullYear()).slice(2)}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(
    d.getDate(),
  ).padStart(2, "0")}.`;
}

export default function ProjectBrowser({ onClose, currentProjectId, onOpen }: ProjectBrowserProps) {
  /** null = 현장 목록, 그 외 = 그 현장의 세부 프로젝트 목록 */
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [siteForm, setSiteForm] = useState<{ id: string | null; name: string; thumb: File | null } | null>(
    null,
  );
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const { data: sites = [], isLoading: sitesLoading, error: sitesError } = useSites();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  /** site_id → 세부 프로젝트 목록 (미분류는 UNASSIGNED 키) */
  const bySite = useMemo(() => {
    const map = new Map<string, TcProjectRow[]>();
    for (const p of projects) {
      const key = p.site_id ?? UNASSIGNED;
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [projects]);

  const openedSite = openSiteId && openSiteId !== UNASSIGNED ? sites.find((s) => s.id === openSiteId) : null;

  const q = query.trim().toLowerCase();

  /** 현장 카드 — 검색어는 현장명과 그 안의 세부 프로젝트명 양쪽에 걸린다 */
  const visibleSites = useMemo(() => {
    const rows = sites.map((s) => ({ site: s, projects: bySite.get(s.id) ?? [] }));
    const unassigned = bySite.get(UNASSIGNED) ?? [];
    if (unassigned.length > 0) {
      rows.push({
        site: {
          id: UNASSIGNED,
          name: "미분류",
          description: null,
          thumbnail_url: null,
          created_at: "",
          updated_at: unassigned[0]?.updated_at ?? "",
        },
        projects: unassigned,
      });
    }
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.site.name.toLowerCase().includes(q) ||
        r.projects.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [sites, bySite, q]);

  const siteProjects = useMemo(() => {
    const list = openSiteId ? (bySite.get(openSiteId) ?? []) : [];
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [openSiteId, bySite, q]);

  const addProject = async (siteId: string | null) => {
    const name = window.prompt("새 세부 프로젝트 이름 (예: 1공구, 예정공정표 A안)")?.trim();
    if (!name) return;
    try {
      const project = await createProject.mutateAsync({ name, siteId });
      toast.success(`세부 프로젝트 '${project.name}' 생성됨`);
      onOpen(project.id, null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "생성 실패");
    }
  };

  const submitSiteForm = async () => {
    if (!siteForm) return;
    const name = siteForm.name.trim();
    if (!name) {
      toast.error("현장 이름을 입력하세요.");
      return;
    }
    try {
      if (siteForm.id) {
        await updateSite.mutateAsync({ siteId: siteForm.id, name, thumb: siteForm.thumb });
        toast.success("현장 정보를 수정했습니다.");
      } else {
        await createSite.mutateAsync({ name, thumb: siteForm.thumb });
        toast.success(`현장 '${name}' 추가됨`);
      }
      setSiteForm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 실패");
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
              <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/65">
                <button
                  type="button"
                  onClick={() => {
                    setOpenSiteId(null);
                    setExpandedProjectId(null);
                  }}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-colors hover:bg-white/15 hover:text-white",
                    !openSiteId && "text-white",
                  )}
                >
                  현장
                </button>
                {openSiteId && (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span className="truncate text-white">
                      {openSiteId === UNASSIGNED ? "미분류" : (openedSite?.name ?? "…")}
                    </span>
                  </>
                )}
              </div>
              <h2 className="mt-0.5 truncate text-[19px] font-extrabold tracking-tight">
                {openSiteId
                  ? openSiteId === UNASSIGNED
                    ? "미분류 세부 프로젝트"
                    : (openedSite?.name ?? "세부 프로젝트")
                  : "현장 프로젝트"}
              </h2>
              <p className="mt-0.5 text-[12px] text-white/70">
                {openSiteId
                  ? "세부 프로젝트를 열면 최신 REV 의 골조·호기 배정이 그대로 복원됩니다."
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
        <div
          className="ipg-scroll flex-1 overflow-auto px-6 py-5"
          style={{ background: "var(--ipg-panel-sub)" }}
        >
          {sitesError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              현장 목록을 불러오지 못했습니다 — 저장된 계획은 아래 <b>미분류</b>에서 그대로 열 수
              있습니다.
              <span className="ml-1 text-amber-700/80">
                ({sitesError instanceof Error ? sitesError.message : String(sitesError)})
              </span>
            </div>
          )}

          {siteForm && (
            <SiteForm
              form={siteForm}
              busy={createSite.isPending || updateSite.isPending}
              onChange={setSiteForm}
              onCancel={() => setSiteForm(null)}
              onSubmit={submitSiteForm}
            />
          )}

          {(sitesLoading || projectsLoading) && (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중…
            </div>
          )}

          {!sitesLoading && !projectsLoading && !openSiteId && (
            <SiteGrid
              rows={visibleSites}
              currentProjectId={currentProjectId}
              onOpenSite={(id) => {
                setOpenSiteId(id);
                setQuery("");
              }}
              onEdit={(site) => setSiteForm({ id: site.id, name: site.name, thumb: null })}
              onDelete={async (site) => {
                if (!window.confirm(`'${site.name}' 현장을 삭제할까요?`)) return;
                try {
                  await deleteSite.mutateAsync(site.id);
                  toast.success("현장을 삭제했습니다.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "삭제 실패");
                }
              }}
              onAddSite={() => setSiteForm({ id: null, name: "", thumb: null })}
            />
          )}

          {!sitesLoading && !projectsLoading && openSiteId && (
            <ProjectList
              projects={siteProjects}
              currentProjectId={currentProjectId}
              expandedProjectId={expandedProjectId}
              onToggleExpand={(id) => setExpandedProjectId((p) => (p === id ? null : id))}
              onOpen={onOpen}
              onAdd={() => addProject(openSiteId === UNASSIGNED ? null : openSiteId)}
              onDelete={async (p) => {
                if (
                  !window.confirm(
                    `'${p.name}' 세부 프로젝트를 삭제할까요?\n저장된 REV ${p.latest_rev_no}개가 함께 삭제됩니다.`,
                  )
                )
                  return;
                try {
                  await deleteProject.mutateAsync(p.id);
                  toast.success("삭제했습니다.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "삭제 실패");
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 현장 추가·수정 폼 — 카드 그리드 위에 펼쳐진다 */
function SiteForm({
  form,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: { id: string | null; name: string; thumb: File | null };
  busy: boolean;
  onChange: (f: { id: string | null; name: string; thumb: File | null }) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mb-5 rounded-xl border border-[var(--ipg-line)] bg-white p-4">
      <h3 className="text-[13.5px] font-bold text-slate-800">
        {form.id ? "현장 수정" : "현장 추가"}
      </h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-slate-500">현장 이름</span>
          <input
            value={form.name}
            autoFocus
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder="예: 평택고덕1차"
            className="h-9 w-[260px] rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[var(--ipg-accent)]"
          />
        </label>
        <label className="flex cursor-pointer flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-slate-500">조감도 (선택)</span>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] text-slate-600 transition-colors hover:border-[var(--ipg-accent)]">
            <ImagePlus className="h-4 w-4" />
            {form.thumb ? form.thumb.name : "이미지 선택"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onChange({ ...form, thumb: e.target.files?.[0] ?? null })}
            />
          </span>
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--ipg-accent-deep)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#003a78] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg border border-slate-200 px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}

/** 1단계 — 현장 카드 그리드 */
function SiteGrid({
  rows,
  currentProjectId,
  onOpenSite,
  onEdit,
  onDelete,
  onAddSite,
}: {
  rows: Array<{
    site: { id: string; name: string; thumbnail_url: string | null; updated_at: string };
    projects: TcProjectRow[];
  }>;
  currentProjectId: string | null;
  onOpenSite: (id: string) => void;
  onEdit: (site: { id: string; name: string }) => void;
  onDelete: (site: { id: string; name: string }) => void;
  onAddSite: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="현장이 없습니다"
        desc="현장을 먼저 만들고, 그 안에 공구·안별로 세부 프로젝트를 추가하세요."
        actionLabel="현장 추가"
        onAction={onAddSite}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map(({ site, projects }) => {
        const maxRev = projects.reduce((a, p) => Math.max(a, p.latest_rev_no), 0);
        const latest = projects.reduce<string>(
          (a, p) => (p.updated_at > a ? p.updated_at : a),
          site.updated_at || "",
        );
        const opened = !!currentProjectId && projects.some((p) => p.id === currentProjectId);
        return (
          <div
            key={site.id}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-xl border bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_22px_44px_-20px_rgba(0,71,145,0.35)]",
              opened ? "border-[var(--ipg-accent)]" : "border-[var(--ipg-line)]",
            )}
          >
            <button
              type="button"
              onClick={() => onOpenSite(site.id)}
              className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-[#1a7ee0] to-[#004791]"
            >
              {site.thumbnail_url ? (
                <img
                  src={site.thumbnail_url}
                  alt={site.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Building2 className="h-10 w-10 text-white/70" />
                </span>
              )}
              {opened && (
                <span className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[var(--ipg-accent-deep)] shadow">
                  열림
                </span>
              )}
            </button>
            <div className="flex flex-1 flex-col px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSite(site.id)}
                  className="min-w-0 flex-1 text-left text-[14px] font-bold text-slate-800 hover:text-[var(--ipg-accent-deep)]"
                >
                  <span className="block truncate">{site.name}</span>
                </button>
                {site.id !== UNASSIGNED && (
                  <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onEdit(site)}
                      title="현장 수정"
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(site)}
                      title="현장 삭제"
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-slate-400">
                <span>세부 {projects.length}</span>
                <span className="text-slate-300">·</span>
                <span>REV {maxRev}</span>
                <span className="text-slate-300">·</span>
                <span>{latest ? fmtDate(latest) : "—"}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 2단계 — 세부 프로젝트 목록 (각 행을 펼치면 REV 목록) */
function ProjectList({
  projects,
  currentProjectId,
  expandedProjectId,
  onToggleExpand,
  onOpen,
  onAdd,
  onDelete,
}: {
  projects: TcProjectRow[];
  currentProjectId: string | null;
  expandedProjectId: string | null;
  onToggleExpand: (id: string) => void;
  onOpen: (projectId: string, revId: string | null) => void;
  onAdd: () => void;
  onDelete: (p: TcProjectRow) => void;
}) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="세부 프로젝트가 없습니다"
        desc="공구·검토안 단위로 세부 프로젝트를 만들어 계획과 REV 를 따로 관리하세요."
        actionLabel="세부 프로젝트 추가"
        onAction={onAdd}
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {projects.map((p) => {
        const opened = p.id === currentProjectId;
        const expanded = p.id === expandedProjectId;
        return (
          <div
            key={p.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-white transition-colors",
              opened ? "border-[var(--ipg-accent)]" : "border-[var(--ipg-line)]",
            )}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-bold text-slate-800">{p.name}</span>
                  {opened && (
                    <span className="rounded-full bg-[var(--ipg-accent-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--ipg-accent-deep)]">
                      열림
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-400">
                  <span>REV {p.latest_rev_no}</span>
                  <span className="text-slate-300">·</span>
                  <span>{fmtDate(p.updated_at)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleExpand(p.id)}
                className="h-8 rounded-lg border border-slate-200 px-3 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                REV {expanded ? "닫기" : "목록"}
              </button>
              <button
                type="button"
                onClick={() => onOpen(p.id, null)}
                className="h-8 rounded-lg bg-[var(--ipg-accent-deep)] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[#003a78]"
              >
                열기
              </button>
              <button
                type="button"
                onClick={() => onDelete(p)}
                title="세부 프로젝트 삭제"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {expanded && <RevisionList projectId={p.id} onOpen={onOpen} />}
          </div>
        );
      })}
    </div>
  );
}

/** REV 목록 — 펼쳤을 때만 조회한다(계획 본문은 빼고 요약만 온다) */
function RevisionList({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (projectId: string, revId: string) => void;
}) {
  const { data, isLoading } = useProject(projectId);
  const deleteRev = useDeleteRevision();
  const revisions: TcRevisionMeta[] = data?.revisions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--ipg-line)] px-4 py-3 text-[12px] text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        REV 불러오는 중…
      </div>
    );
  }
  if (revisions.length === 0) {
    return (
      <div className="border-t border-[var(--ipg-line)] px-4 py-3 text-[12px] text-slate-400">
        저장된 REV 가 없습니다. 작업 화면에서 [REV 저장] 을 누르면 첫 REV 가 만들어집니다.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--ipg-line)] border-t border-[var(--ipg-line)]">
      {revisions.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-[62px] shrink-0 text-[12px] font-bold text-slate-700">
            REV {String(r.rev_no).padStart(2, "0")}
          </span>
          <span className="flex-1 truncate text-[12px] text-slate-500">
            {r.memo || <span className="text-slate-300">메모 없음</span>}
          </span>
          <span className="hidden shrink-0 items-center gap-2 text-[11px] tabular-nums text-slate-400 sm:flex">
            {r.summary?.buildings != null && <span>동 {r.summary.buildings}</span>}
            {r.summary?.units != null && <span>장비 {r.summary.units}</span>}
            {r.summary?.totalMonths != null && <span>{r.summary.totalMonths}개월</span>}
          </span>
          <span className="w-[76px] shrink-0 text-right text-[11px] text-slate-400">
            {fmtDate(r.created_at)}
          </span>
          <button
            type="button"
            onClick={() => onOpen(projectId, r.id)}
            className="h-7 shrink-0 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-600 transition-colors hover:border-[var(--ipg-accent)] hover:text-[var(--ipg-accent-deep)]"
          >
            불러오기
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`REV ${r.rev_no} 을(를) 삭제할까요?`)) return;
              try {
                await deleteRev.mutateAsync({ projectId, revId: r.id });
                toast.success("REV 를 삭제했습니다.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "삭제 실패");
              }
            }}
            title="REV 삭제"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  title,
  desc,
  actionLabel,
  onAction,
}: {
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ipg-line-strong)] bg-white/60 px-6 py-20 text-center">
      <Building2 className="h-9 w-9 text-slate-300" />
      <h3 className="mt-3 text-[14px] font-bold text-slate-700">{title}</h3>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-slate-400">{desc}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--ipg-accent-deep)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#003a78]"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
