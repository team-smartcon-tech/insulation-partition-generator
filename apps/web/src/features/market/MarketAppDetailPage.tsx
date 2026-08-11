/**
 * 게시 도구 상세 — 메타 + 바로가기 + 설명 + 화면(스크린샷) + 버전 이력.
 * 진입 시 조회수 1회 증가, 좋아요 토글 지원. 관리자는 버전 추가·게시 삭제 가능.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  Eye,
  ExternalLink,
  Github,
  Heart,
  Loader2,
  MapPin,
  Plus,
  Tag,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MarketShell from "./MarketShell";
import { bumpMarketAppView } from "./api";
import {
  useAddMarketAppVersion,
  useDeleteMarketApp,
  useMarketApp,
  useToggleMarketAppLike,
} from "./hooks";

/** 2026-06-17T… → 2026.06.17 */
const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

export default function MarketAppDetailPage() {
  const [, params] = useRoute<{ appId: string }>("/market/:appId");
  const [, navigate] = useLocation();
  const appId = params?.appId ?? null;

  const { data, isLoading, isError, error } = useMarketApp(appId);
  const like = useToggleMarketAppLike(appId ?? "");
  const addVersion = useAddMarketAppVersion(appId ?? "");
  const removeApp = useDeleteMarketApp();

  // 조회수는 마운트당 1회만 (react-query refetch 로 부풀지 않도록 ref 로 잠근다)
  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!appId || viewedRef.current === appId) return;
    viewedRef.current = appId;
    bumpMarketAppView(appId).catch(() => undefined);
  }, [appId]);

  const [versionDraft, setVersionDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);

  if (isLoading) {
    return (
      <MarketShell>
        <div className="space-y-4">
          <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-slate-200/70" />
          <div className="h-11 w-32 animate-pulse rounded-lg bg-slate-200/70" />
          <div className="h-64 w-full animate-pulse rounded-xl bg-slate-200/60" />
        </div>
      </MarketShell>
    );
  }

  if (isError || !data?.app) {
    return (
      <MarketShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="text-[15px] font-bold text-slate-800">게시물을 불러오지 못했습니다.</div>
          <p className="mt-2 text-[13px] text-slate-500">
            {error instanceof Error ? error.message : "삭제되었거나 주소가 잘못되었습니다."}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-5 h-10 rounded-lg border border-slate-200 bg-white px-5 text-[13.5px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            홈으로
          </button>
        </div>
      </MarketShell>
    );
  }

  const { app, versions, canManage } = data;

  const onDelete = async () => {
    if (!appId) return;
    if (!window.confirm(`"${app.title}" 게시를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await removeApp.mutateAsync(appId);
      toast.success("삭제했습니다.");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  };

  const onAddVersion = async () => {
    if (!versionDraft.trim()) {
      toast.error("버전을 입력하세요.");
      return;
    }
    try {
      await addVersion.mutateAsync({ version: versionDraft.trim(), note: noteDraft.trim() });
      setVersionDraft("");
      setNoteDraft("");
      setVersionOpen(false);
      toast.success("버전을 추가했습니다.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "버전 추가에 실패했습니다.");
    }
  };

  return (
    <MarketShell>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[30px] font-bold tracking-tight text-slate-900">{app.title}</h1>
        {canManage && (
          <button
            type="button"
            onClick={onDelete}
            disabled={removeApp.isPending}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-[13px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        )}
      </div>

      {/* 메타 바 */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-600">
        {app.author_name && (
          <Meta icon={UserRound}>
            <span className="font-bold text-slate-800">{app.author_name}</span>
          </Meta>
        )}
        {app.team && <Meta icon={Building2}>{app.team}</Meta>}
        {app.owners.length > 0 && (
          <Meta icon={Users}>
            담당자 <span className="font-bold text-slate-800">{app.owners.join(", ")}</span>
          </Meta>
        )}
        <Meta icon={MapPin}>
          {app.platform_type} · {app.location}
        </Meta>
        <Meta icon={Tag}>{app.category}</Meta>
        <Meta icon={CalendarDays}>{formatDate(app.created_at)}</Meta>
        <Meta icon={Eye}>조회 {app.view_count}</Meta>
        <button
          type="button"
          onClick={() => like.mutate()}
          disabled={like.isPending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors disabled:opacity-60",
            app.liked ? "text-rose-500" : "text-slate-500 hover:text-rose-500",
          )}
          title={app.liked ? "좋아요 취소" : "좋아요"}
        >
          <Heart className={cn("h-[15px] w-[15px]", app.liked && "fill-rose-500")} />
          {app.like_count}
        </button>
      </div>

      {/* 바로가기 */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <a
          href={app.deploy_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0a63b8] px-5 text-[14px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(10,99,184,0.9)] transition-colors hover:bg-[#004791]"
        >
          <ExternalLink className="h-4 w-4" />
          바로가기
        </a>
        {app.repo_url && (
          <a
            href={app.repo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Github className="h-4 w-4" />
            레포
          </a>
        )}
      </div>

      {app.description && (
        <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-[#0a63b8]">
          {app.description}
        </p>
      )}

      {app.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {app.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-500"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 화면 */}
      {app.screenshots.length > 0 && (
        <section className="mt-9">
          <h2 className="text-[17px] font-bold text-slate-900">화면</h2>
          <div className="mt-3 space-y-4">
            {app.screenshots.map((shot, idx) => (
              <img
                key={`${shot.url}-${idx}`}
                src={shot.url}
                alt={`${app.title} 화면 ${idx + 1}`}
                className="w-full rounded-xl border border-slate-200 bg-white shadow-sm"
                loading={idx === 0 ? "eager" : "lazy"}
              />
            ))}
          </div>
        </section>
      )}

      {/* 버전 이력 */}
      <section className="mt-10 border-t border-slate-200 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-slate-900">버전 이력</h2>
          {canManage && (
            <button
              type="button"
              onClick={() => setVersionOpen((v) => !v)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              버전 추가
            </button>
          )}
        </div>

        {versionOpen && (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <input
                className="h-10 rounded-lg border border-slate-200 px-3 text-[13.5px] outline-none focus:border-[#0a63b8]"
                value={versionDraft}
                onChange={(e) => setVersionDraft(e.target.value)}
                placeholder="예) v1.1"
              />
              <input
                className="h-10 rounded-lg border border-slate-200 px-3 text-[13.5px] outline-none focus:border-[#0a63b8]"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="변경 내용 (선택)"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAddVersion}
                disabled={addVersion.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0a63b8] px-4 text-[13px] font-bold text-white hover:bg-[#004791] disabled:opacity-60"
              >
                {addVersion.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                등록
              </button>
            </div>
          </div>
        )}

        {versions.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-400">등록된 버전 이력이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[15px] font-bold text-slate-900">{v.version}</span>
                <span className="text-[12.5px] text-slate-400">
                  등록 {formatDate(v.created_at)}
                  {v.created_by_name ? ` · ${v.created_by_name}` : ""}
                </span>
                {v.note && <span className="text-[13px] text-slate-600">{v.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </MarketShell>
  );
}

function Meta({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-[15px] w-[15px] text-slate-400" />
      {children}
    </span>
  );
}
