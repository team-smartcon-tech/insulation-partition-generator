/**
 * HomePage — 스마트 툴박스의 메인 허브(런처).
 * 로그인 후 "/" 에서 도구 목록을 카드로 보여주고, 카드를 누르면 각 도구로 이동한다.
 * 디자인: 네이비 단색 상단 띠 + 연한 바탕 + 흰 카드(로고 패널 · 이름 · 두 줄 설명). 배지·알약·오로라는 두지 않는다
 *   (2026-10-29 — 「사용 가능」배지·조회수 알약·광원 배경이 브로슈어처럼 보여 걷어냄.
 *    로고를 48px 아이콘으로 줄이는 안은 게시 도구 로고가 얼룩이 돼 철회).
 *   예외: 관리자가 지정한 「출처+상태」 배지(본사·사내기준 등)만 로고 패널 왼쪽 위에 붙인다 (2026-11-05, cardBadge.ts).
 * 도구 목록은 features/home/tools.ts(TOOLS)를 원천으로 한다.
 * 카드는 섹션(시공 도구 · CAD 도구 …)별로 묶고, 카드가 없는 섹션은 제목까지 숨긴다.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  LogOut,
  ArrowRight,
  Search,
  Plus,
  LayoutGrid,
  Eye,
  Heart,
  Download,
  ArrowUpDown,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import BrandWordmark from "@/components/brand/BrandWordmark";
import { useHomeOrder, useMarketApps, useSaveHomeOrder } from "@/features/market/hooks";
import { SECTIONS, type SectionId } from "@/features/market/types";
import { TOOLS, canSeeTool, type ToolDef } from "./tools";
import { applyHomeOrder, moveCardKey, stepCardKey } from "./homeOrder";
import {
  BADGE_ORIGIN_CLASS,
  BADGE_ORIGIN_OPTIONS,
  BADGE_STATUS_CLASS,
  BADGE_STATUS_OPTIONS,
  originLabel,
  setCardBadge,
  statusLabel,
  type BadgeOrigin,
  type BadgeStatus,
  type CardBadge,
  type CardBadgeMap,
} from "./cardBadge";

/** 게시 권한 role — 최종 판정은 서버(market.ts)가 하고, 여기선 버튼 노출 여부만 본다. */
const PUBLISH_ROLES = new Set(["super_admin", "system_admin"]);

/** DCR role 코드 → 한국어 라벨 */
const ROLE_LABEL: Record<string, string> = {
  super_admin: "최고 관리자",
  system_admin: "시스템 관리자",
  site_admin: "현장 관리자",
  member: "회원",
};

/**
 * 카드 1장의 표시 모델 — 코드에 박힌 내장 도구(TOOLS)와 게시된 도구(DB)를 같은 모양으로 그린다.
 * 내장 도구 정의(tools.ts)는 그대로 두고 여기서 변환만 한다.
 */
interface HomeCard {
  key: string;
  name: string;
  description: string;
  tags: string[];
  icon: LucideIcon;
  available: boolean;
  /** 카드 로고 패널 이미지 (내장=public 경로, 게시=Storage signed URL 첫 스크린샷) */
  thumbnail?: string | null;
  /** 도구 전용 로고(심볼). 썸네일이 없을 때 패널 폴백 */
  logo?: string | null;
  /** 카드 하단 좌측 표기 */
  meta: string;
  /** 클릭 시 이동할 내부 경로 (없으면 클릭 불가) */
  href?: string;
  /** 홈 섹션 */
  section: SectionId;
  /** 설치형(다운로드) 도구 — 카드 우하단 화살표가 다운로드 아이콘이 된다 */
  download?: boolean;
  /** downloads 는 설치형에만 */
  stats?: { views: number; likes: number; downloads?: number };
  /** 게시일(게시 도구만) — 개요의 「새로 올라온 도구」 타일에 쓴다 */
  createdAt?: string;
}

/** DB 값이 모르는 섹션이면(구버전·오타) 첫 섹션으로 — 카드가 홈에서 사라지지 않게 한다 */
const toSection = (value: string | null | undefined): SectionId =>
  SECTIONS.find((s) => s.id === value)?.id ?? SECTIONS[0].id;

const toolToCard = (tool: ToolDef): HomeCard => ({
  key: `tool:${tool.id}`,
  section: toSection(tool.section),
  name: tool.name,
  description: tool.description,
  tags: tool.tags ?? [],
  icon: tool.icon,
  available: tool.status === "available",
  thumbnail: tool.thumbnail,
  logo: tool.logo,
  meta: tool.author ?? "우미 · 스마트 툴박스",
  href: tool.status === "available" ? tool.path : undefined,
});

export default function HomePage() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  const roleLabel = user?.role ? ROLE_LABEL[user.role] ?? undefined : undefined;

  const { data: market } = useMarketApps();
  const marketApps = market?.apps ?? [];
  // 목록 API가 실패해도(마이그레이션 전 등) 관리자에겐 버튼이 보여야 한다 → 세션 role 기준.
  const canPublish = PUBLISH_ROLES.has(user?.role ?? "");

  const [query, setQuery] = useState("");
  /** 섹션 탭 — "all" 이면 전부, 아니면 그 섹션만 */
  const [activeSec, setActiveSec] = useState<SectionId | "all">("all");

  // ── 카드 순서: 관리자가 저장한 순서(DB)를 기본 정렬 위에 덮는다. 편집 중엔 초안 순서로 그린다 ──
  const { data: homeOrder } = useHomeOrder();
  const saveOrder = useSaveHomeOrder();
  const [draftKeys, setDraftKeys] = useState<string[] | null>(null);
  /** 편집 중 배지 초안 — null 이면 서버 저장본을 보여준다 */
  const [draftBadges, setDraftBadges] = useState<CardBadgeMap | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const editing = draftKeys !== null;

  const defaultCards = useMemo(() => {
    const published = marketApps.map<HomeCard>((app) => {
      const download = app.distribution === "download";
      return {
        key: `market:${app.id}`,
        name: app.title,
        description: app.description ?? "",
        tags: app.tags ?? [],
        icon: LayoutGrid,
        available: true,
        thumbnail: app.thumbnail_url,
        meta: [app.author_name, app.team].filter(Boolean).join(" · ") || "우미 · 스마트 툴박스",
        // 설치형도 카드는 상세로 보낸다(설명·화면을 보고 받도록).
        href: `/market/${app.id}`,
        section: toSection(app.section),
        download,
        createdAt: app.created_at,
        stats: {
          views: app.view_count,
          likes: app.like_count,
          downloads: download ? app.download_count ?? 0 : undefined,
        },
      };
    });

    // 같은 이름으로 실제 게시되면 "준비 중" 자리표시자는 감춘다 (줄눈컷팅 등 중복 방지).
    const publishedNames = new Set(published.map((c) => c.name.replace(/\s+/g, "")));
    // 내장 도구를 App Market 에 게시했으면(배포 URL = 그 도구 경로, 예: /tools/gantt) 내장 카드는 감추고 게시 카드만 —
    // 게시 카드가 소개·수정·삭제를 맡는다 (2026-11-04). 게시를 지우면 내장 카드가 다시 나온다.
    const publishedPaths = new Set(marketApps.map((a) => a.deploy_url).filter((u): u is string => !!u?.startsWith("/")));
    const builtIn = TOOLS.filter((t) => !publishedPaths.has(t.path) && canSeeTool(t, user?.email))
      .map(toolToCard)
      .filter((c) => c.available || !publishedNames.has(c.name.replace(/\s+/g, "")));

    // 사용 가능(내장 → 게시) 먼저, 준비 중 자리표시자는 뒤로.
    // sortLast 를 단 내장 도구는 게시 도구들보다 뒤에 놓는다(도구별로 자리를 지정할 수 있게).
    const sortLastIds = new Set(TOOLS.filter((t) => t.sortLast).map((t) => t.id));
    const isLast = (c: HomeCard) => sortLastIds.has(c.key.replace(/^tool:/, ""));
    const availableBuiltIn = builtIn.filter((c) => c.available);
    return [
      ...availableBuiltIn.filter((c) => !isLast(c)),
      ...published,
      ...availableBuiltIn.filter(isLast),
      ...builtIn.filter((c) => !c.available),
    ];
  }, [marketApps, user?.email]);

  const savedKeys = homeOrder?.keys;
  const cards = useMemo(() => {
    const ordered = applyHomeOrder(defaultCards, savedKeys ?? []);
    return draftKeys ? applyHomeOrder(ordered, draftKeys) : ordered;
  }, [defaultCards, savedKeys, draftKeys]);

  const badges = draftBadges ?? homeOrder?.badges ?? {};

  const sectionByKey = useMemo(() => new Map(cards.map((c) => [c.key, c.section])), [cards]);
  const sectionOf = (key: string) => sectionByKey.get(key) ?? "";

  const startEdit = () => {
    setQuery("");
    setOrderError(null);
    setDraftKeys(cards.map((c) => c.key));
    setDraftBadges(homeOrder?.badges ?? {});
  };
  const cancelEdit = () => {
    setDraftKeys(null);
    setDraftBadges(null);
    setDragKey(null);
    setOrderError(null);
  };
  const commitEdit = () => {
    if (!draftKeys) return;
    setOrderError(null);
    saveOrder.mutate({ keys: draftKeys, badges: draftBadges ?? undefined }, {
      onSuccess: (data) => {
        setDraftKeys(null);
        setDraftBadges(null);
        if (data.warning) window.alert(data.warning);
      },
      onError: (err) => setOrderError(err instanceof Error ? err.message : "순서 저장에 실패했습니다."),
    });
  };

  const filtered = useMemo(() => {
    const q = editing ? "" : query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [cards, query, editing]);

  // 섹션별로 묶는다(섹션 안 순서는 위 cards 정렬 그대로). 카드가 없는 섹션은 제목까지 숨긴다.
  const sections = useMemo(
    () =>
      SECTIONS.map((sec) => ({ ...sec, cards: filtered.filter((c) => c.section === sec.id) })).filter(
        (sec) => sec.cards.length > 0,
      ),
    [filtered],
  );

  // 탭으로 고른 섹션만 — 편집 중이거나 고른 섹션이 검색으로 사라졌으면 전부
  const visibleSections =
    editing || activeSec === "all" || !sections.some((sec) => sec.id === activeSec)
      ? sections
      : sections.filter((sec) => sec.id === activeSec);

  /** 개요 타일 — 섹션별 등록 수(카드 있는 섹션만) */
  const sectionCounts = useMemo(
    () =>
      SECTIONS.map((sec) => ({ ...sec, count: cards.filter((c) => c.section === sec.id).length })).filter(
        (sec) => sec.count > 0,
      ),
    [cards],
  );
  /** 개요 타일 — 가장 최근에 게시된 도구(게시 도구가 없으면 타일을 그리지 않는다) */
  const newestTool = useMemo(
    () =>
      cards
        .filter((c) => c.available && c.href && c.createdAt)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null,
    [cards],
  );
  /** 개요 — 누적 조회·좋아요 */
  const totals = useMemo(
    () => cards.reduce((acc, c) => ({ views: acc.views + (c.stats?.views ?? 0), likes: acc.likes + (c.stats?.likes ?? 0) }), { views: 0, likes: 0 }),
    [cards],
  );
  /** 개요 타일 — 많이 쓰는 도구 3개(조회 많은 순, 같으면 홈 순서). 조회 기록이 없으면 앞에서 3개 */
  const topTools = useMemo(
    () =>
      cards
        .filter((c) => c.available && c.href)
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (b.c.stats?.views ?? 0) - (a.c.stats?.views ?? 0) || a.i - b.i)
        .slice(0, 3)
        .map((x) => x.c),
    [cards],
  );

  // 툴바 버튼 — 흰 바탕 위 외곽선형 / 채움형 두 가지만 쓴다
  const btnBase =
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50";
  const btnOutline =
    btnBase + " border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
  const btnPrimary = btnBase + " bg-[#004791] text-white hover:bg-[#003a78]";

  return (
    <div className="min-h-screen bg-[#f4f6fa] text-slate-800">
      {/* ── 상단 헤더 — 로고 · 검색(가운데) · 사용자. 검색은 어디서나 닿도록 헤더에 둔다 ── */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-6 px-8">
          {/* 좌: 우미 로고 + 워드마크 */}
          <div className="flex shrink-0 items-center gap-4">
            <WoomiLogo />
            <div className="h-6 w-px bg-slate-200" />
            <BrandWordmark />
          </div>

          {/* 가운데: 검색 */}
          <div className="relative mx-auto hidden w-full max-w-[560px] md:block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              disabled={editing}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="도구명 · 설명 · 태그 검색"
              className="h-10 w-full rounded-full border border-transparent bg-slate-100 pl-11 pr-4 text-[14px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:bg-slate-200/60 focus:border-[#004791]/40 focus:bg-white focus:ring-4 focus:ring-[#004791]/10 disabled:opacity-60"
            />
          </div>

          {/* 우: 사용자 + 로그아웃 */}
          <div className="ml-auto flex shrink-0 items-center gap-3 md:ml-0">
            {user && (
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-[13.5px] font-bold text-slate-800">{user.name} 님</div>
                {roleLabel && <div className="text-[11px] text-slate-400">{roleLabel}</div>}
              </div>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#004791] text-[13px] font-bold text-white">
              {user?.name?.trim().charAt(0) ?? "?"}
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title="로그아웃"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      {/* ── 개요 — 밝은 바탕. 왼쪽 큰 제목, 오른쪽 타일 두 장(등록 현황 · 많이 쓰는 도구).
            (2026-11-23 재디자인) 남색 띠 + 검색 띠 구성을 버렸다 — "있는 틀을 고치지 말고 다시 디자인" 요청.
            광원·장식 배지는 2026-10-29 에 걷어낸 것이라 쓰지 않는다. ── */}
      <section className="relative isolate overflow-hidden border-b border-slate-200 bg-white">
        {/* 바탕 — 오른쪽으로 옅은 하늘빛, 왼쪽 아래 점 무늬, 기울인 둥근 사각 윤곽. 흰 면이 밋밋하지 않게만 */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "linear-gradient(100deg, #ffffff 0%, #ffffff 30%, #eaf2fb 100%)" }} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-[55%]"
          style={{
            backgroundImage: "radial-gradient(rgba(0,71,145,0.16) 1.2px, transparent 1.2px)",
            backgroundSize: "20px 20px",
            maskImage: "linear-gradient(60deg, #000 0%, transparent 46%)",
            WebkitMaskImage: "linear-gradient(60deg, #000 0%, transparent 46%)",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -top-28 left-[34%] -z-10 h-72 w-72 rotate-[22deg] rounded-[56px] border-2 border-[#004791]/[0.07]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 left-[44%] -z-10 h-80 w-80 rotate-[22deg] rounded-[64px] bg-[#1478d6]/[0.06]" />
        <div className="mx-auto grid w-full max-w-[2100px] items-center gap-x-14 gap-y-8 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,700px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1060px)]">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[#1478d6]">
              {user?.name ? `${user.name} 님, 안녕하세요` : "Smart Site Tools"}
            </p>
            <h1 className="mt-2 text-[42px] font-extrabold leading-[1.12] tracking-[-0.03em] text-slate-900">
              현장 시공
              <br />
              <span className="bg-gradient-to-r from-[#004791] to-[#1e9bff] bg-clip-text text-transparent">자동화</span> 도구
            </h1>
            <p className="mt-3 max-w-[30rem] text-[15px] leading-relaxed text-slate-500">
              현장에서 바로 쓰는 도구를 한곳에서 찾고, 직접 만든 도구를 공유합니다.
            </p>
            {/* 누적 수치 — 아이콘 동그라미 + 숫자 */}
            <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              <HeroFact icon={Eye} tone="bg-emerald-50 text-emerald-600" label="누적 조회" value={totals.views} />
              <HeroFact icon={Heart} tone="bg-rose-50 text-rose-500" label="좋아요" value={totals.likes} />
            </dl>
            {canPublish && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {!editing && (
                  <button type="button" onClick={() => navigate("/market/new")} className={btnPrimary}>
                    <Plus className="h-4 w-4" />
                    도구 게시하기
                  </button>
                )}
                {!editing && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className={btnOutline}
                    title="카드 순서와 상태 배지(본사·현장 / 사내기준·운영중·검증중)를 바꿉니다. 모든 사용자에게 같게 보입니다"
                  >
                    <ArrowUpDown className="h-4 w-4" />
                    순서·배지 편집
                  </button>
                )}
                {editing && (
                  <>
                    <button type="button" onClick={commitEdit} disabled={saveOrder.isPending} className={btnPrimary}>
                      <Check className="h-4 w-4" />
                      {saveOrder.isPending ? "저장 중…" : "저장"}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={saveOrder.isPending} className={btnOutline}>
                      <X className="h-4 w-4" />
                      취소
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className={"grid gap-3 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" + (newestTool ? " 2xl:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,6fr)]" : "")}>
            {/* 타일 1 — 등록 현황: 큰 숫자 + 섹션별 비율 막대 */}
            <div
              className="relative isolate flex min-h-[212px] flex-col justify-between overflow-hidden rounded-3xl p-6 text-white shadow-[0_14px_30px_-14px_rgba(0,55,120,0.55)]"
              style={{ background: "linear-gradient(140deg, #00254f 0%, #003a7d 58%, #0b5cc0 100%)" }}
            >
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 -z-10 h-56 w-56 rotate-[22deg] rounded-[44px] bg-white/[0.08]" />
              <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 -z-10 h-48 w-48 rotate-[22deg] rounded-[40px] border border-white/10" />
              <span className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <LayoutGrid className="h-5 w-5 text-[#8fd4ff]" />
              </span>
              <div>
                <div className="text-[13px] font-semibold text-white/65">등록 도구</div>
                <div className="mt-1 text-[60px] font-extrabold leading-none tracking-[-0.04em] tabular-nums">{cards.length}</div>
              </div>
              <ul className="space-y-2.5">
                {sectionCounts.map((sec) => (
                  <li key={sec.id}>
                    <div className="flex items-baseline justify-between text-[12.5px]">
                      <span className="font-medium text-white/75">{sec.label}</span>
                      <span className="font-bold tabular-nums">{sec.count}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-[#5cc8ff]" style={{ width: `${cards.length ? (sec.count / cards.length) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* 타일 — 새로 올라온 도구: 가장 최근 게시 1건을 로고째 크게. 넓은 화면(2xl)에서만 */}
            {newestTool && (
              <button
                type="button"
                disabled={editing}
                onClick={() => newestTool.href && navigate(newestTool.href)}
                className="group hidden min-h-[212px] flex-col overflow-hidden rounded-3xl bg-white text-left ring-1 ring-slate-200 transition hover:ring-[#004791]/40 hover:shadow-[0_14px_30px_-16px_rgba(0,37,79,0.4)] disabled:pointer-events-none 2xl:flex"
              >
                <div className="relative flex-1 bg-[#f7f9fc]">
                  <MiniLogo card={newestTool} bare className="absolute inset-0 h-full w-full p-5 transition-transform duration-300 group-hover:scale-[1.04]" />
                  <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#1478d6]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#1478d6]" />
                    새로 올라온 도구
                  </span>
                </div>
                <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-bold text-slate-900">{newestTool.name}</span>
                    <span className="block truncate text-[12px] text-slate-400">{newestTool.description || newestTool.tags.join(" · ")}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#004791]" />
                </div>
              </button>
            )}

            {/* 타일 2 — 많이 쓰는 도구: 조회 많은 순 3개 바로가기 */}
            <div className="flex min-h-[212px] flex-col rounded-3xl bg-white/70 p-5 ring-1 ring-slate-200 backdrop-blur">
              <div className="flex items-center justify-between px-1">
                <span className="text-[13px] font-bold text-slate-700">많이 쓰는 도구</span>
                <span className="text-[11.5px] font-medium text-slate-400">조회순</span>
              </div>
              <ol className="mt-3 flex flex-1 flex-col justify-between gap-1.5">
                {topTools.map((card, i) => (
                  <li key={card.key}>
                    <button
                      type="button"
                      disabled={editing}
                      onClick={() => card.href && navigate(card.href)}
                      className="group flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-slate-900/[0.04] transition hover:ring-[#004791]/30 disabled:pointer-events-none"
                    >
                      <span className="relative shrink-0">
                        <MiniLogo card={card} className="h-11 w-[72px]" />
                        <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#004791] text-[11px] font-extrabold tabular-nums text-white ring-2 ring-white">
                          {i + 1}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-slate-900">{card.name}</span>
                        <span className="block truncate text-[12px] text-slate-400">{card.tags.slice(0, 3).join(" · ") || card.meta}</span>
                      </span>
                      {card.stats && card.stats.views > 0 && (
                        <span className="hidden shrink-0 items-center gap-1 text-[12px] font-medium tabular-nums text-slate-400 sm:flex">
                          <Eye className="h-3.5 w-3.5" />
                          {card.stats.views.toLocaleString()}
                        </span>
                      )}
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#004791]" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ── 섹션 탭 줄 — 스크롤하면 헤더(h-16) 아래에 붙는다. 좁은 화면에선 검색이 여기로 내려온다 ── */}
      <div className="sticky top-16 z-10 border-b border-slate-200/70 bg-[#f4f6fa]/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[2100px] flex-wrap items-center justify-between gap-3 px-8 py-2.5">
          <div role="tablist" aria-label="섹션" className="flex items-center gap-1">
            {[{ id: "all" as const, label: "전체", count: filtered.length }, ...sections.map((sec) => ({ id: sec.id, label: sec.label, count: sec.cards.length }))].map((tab) => {
              const active = !editing && activeSec === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={editing}
                  onClick={() => setActiveSec(tab.id)}
                  className={
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold transition-colors " +
                    (active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800")
                  }
                >
                  {tab.label}
                  <span className={"text-[12px] font-medium tabular-nums " + (active ? "text-white/60" : "text-slate-400")}>{tab.count}</span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full md:hidden">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              disabled={editing}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="도구명 · 설명 · 태그 검색"
              className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-[14px] outline-none focus:border-[#004791]"
            />
          </div>
          {query.trim() && !editing && (
            <span className="hidden text-[13px] text-slate-500 md:block">
              “{query.trim()}” 검색 결과 <strong className="font-bold text-slate-800">{filtered.length}</strong>개
            </span>
          )}
        </div>
      </div>

      {/* ── 본문 (App Market) ── */}
      <main className="mx-auto w-full max-w-[2100px] px-8 pb-14 pt-8">
        {editing && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-[#004791]/20 bg-[#eaf2fb] px-4 py-3 text-[13px] text-[#0a4a8a]">
            <ArrowUpDown className="h-4 w-4 shrink-0" />
            <span>
              카드를 끌어다 놓거나 ← → 버튼으로 순서를 바꾸고, 카드 왼쪽 아래 칸에서 출처(본사·현장)와 상태(사내기준·운영중·검증중) 배지를 고르세요. 저장하면 모든 사용자에게 같게 보입니다.
            </span>
            {orderError && <span className="font-semibold text-red-600">{orderError}</span>}
          </div>
        )}
        {visibleSections.map((sec, idx) => (
          <section key={sec.id} className={idx > 0 ? "mt-10" : undefined}>
            {/* 섹션 헤더 */}
            <SectionHeading title={sec.label} count={sec.cards.length} />

            {/* 카드 그리드 — 준비 중 도구도 같은 크기 카드로 이어 붙인다 */}
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {sec.cards.map((card, i) =>
                editing ? (
                  <div
                    key={card.key}
                    draggable
                    onDragStart={(e) => {
                      setDragKey(card.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragKey(null)}
                    onDragOver={(e) => {
                      if (dragKey && sectionOf(dragKey) === card.section) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) setDraftKeys((prev) => prev && moveCardKey(prev, sectionOf, dragKey, card.key));
                      setDragKey(null);
                    }}
                    className={
                      "relative grid cursor-grab rounded-xl outline-dashed outline-2 outline-offset-2 transition-opacity active:cursor-grabbing " +
                      (dragKey === card.key ? "opacity-40 outline-[#004791]" : "outline-[#004791]/35")
                    }
                  >
                    <AppCard card={card} badge={badges[card.key]} onOpen={() => {}} />
                    {/* 편집 중엔 카드 클릭(이동)을 막고 순서·배지 조작만 받는다 */}
                    <div className="absolute inset-0 rounded-xl">
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200">
                        <GripVertical className="h-3.5 w-3.5" />
                        {i + 1}
                      </span>
                      <BadgeEditor
                        cardName={card.name}
                        badge={badges[card.key]}
                        onChange={(patch) => setDraftBadges((prev) => setCardBadge(prev ?? {}, card.key, patch))}
                      />
                      <div className="absolute bottom-3 right-3 flex gap-1">
                        <button
                          type="button"
                          aria-label={`${card.name} 앞으로`}
                          disabled={i === 0}
                          onClick={() => setDraftKeys((prev) => prev && stepCardKey(prev, sectionOf, card.key, -1))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${card.name} 뒤로`}
                          disabled={i === sec.cards.length - 1}
                          onClick={() => setDraftKeys((prev) => prev && stepCardKey(prev, sectionOf, card.key, 1))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <AppCard
                    key={card.key}
                    card={card}
                    badge={badges[card.key]}
                    onOpen={() => card.href && navigate(card.href)}
                  />
                ),
              )}
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <div className="mt-16 text-center text-[14px] text-slate-400">
            검색 결과가 없습니다.
          </div>
        )}
      </main>
    </div>
  );
}

/** 우미 로고 (실패 시 대체 이미지로 폴백) */
function WoomiLogo() {
  const [src, setSrc] = useState("/woomi_short.png");
  return (
    <img
      src={src}
      alt="우미"
      className="h-9 w-auto select-none object-contain"
      draggable={false}
      loading="eager"
      onError={() =>
        setSrc((prev) =>
          prev === "/woomi_short.png" ? "/woomi_logo.png" : "/woomi_browser_logo.png"
        )
      }
    />
  );
}

/** 개요의 누적 수치 한 칸 — 색 동그라미 아이콘 + 숫자 + 라벨 */
function HeroFact({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={"flex h-9 w-9 items-center justify-center rounded-full " + tone}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="leading-tight">
        <dd className="text-[17px] font-extrabold tabular-nums text-slate-900">{value.toLocaleString()}</dd>
        <dt className="text-[11.5px] font-medium text-slate-400">{label}</dt>
      </div>
    </div>
  );
}

/** 도구 로고 작은 판 — 카드 로고 패널과 같은 이미지(썸네일 → 로고 → 아이콘). bare 면 테두리·바탕 없이 이미지만 */
function MiniLogo({ card, className, bare }: { card: HomeCard; className?: string; bare?: boolean }) {
  const Icon = card.icon;
  const [imgOk, setImgOk] = useState(true);
  const src = card.thumbnail ?? card.logo ?? null;
  const frame = bare ? "" : "overflow-hidden rounded-lg bg-[#f7f9fc] ring-1 ring-slate-200 ";
  if (src && imgOk) {
    return (
      <img
        src={src}
        alt=""
        className={frame + "object-contain " + (bare ? "" : "p-1 ") + (className ?? "")}
        loading="lazy"
        draggable={false}
        onError={() => setImgOk(false)}
      />
    );
  }
  return (
    <span className={frame + "flex items-center justify-center " + (className ?? "")}>
      <Icon className={bare ? "h-12 w-12 text-[#004791]/60" : "h-5 w-5 text-[#004791]/70"} strokeWidth={1.5} />
    </span>
  );
}

/** 섹션 제목 — "시공 도구 5" 처럼 개수와 함께 위계를 준다. */
function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[16px] font-bold tracking-tight text-slate-900">{title}</span>
      <span className="text-[13px] font-medium text-slate-400">{count}</span>
    </div>
  );
}

/** 카드 — 로고 패널 · 이름 · 태그 · 두 줄 설명 · 작성자 · 조회/좋아요 */
function AppCard({ card, badge, onOpen }: { card: HomeCard; badge?: CardBadge; onOpen: () => void }) {
  const available = card.available;

  const cardCls =
    "group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-all duration-200" +
    (available
      ? " hover:border-[#004791]/50 hover:shadow-[0_8px_24px_-12px_rgba(0,37,79,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004791]/40"
      : " opacity-70");

  const body = (
    <>
      <LogoPanel card={card} badge={badge} />
      <div className="flex flex-1 flex-col p-5">
        <div className="truncate text-[16px] font-bold tracking-tight text-slate-900">{card.name}</div>
        {/* 태그는 칩 대신 점으로 이어 붙인다 — 한 줄로 눌러 카드 높이를 맞춘다 */}
        <div className="mt-1 min-h-[18px] truncate text-[12px] text-slate-400">
          {card.tags.length > 0 ? card.tags.join(" · ") : available ? "" : "준비 중"}
        </div>
        <p
          className={
            "mt-3 line-clamp-2 min-h-[42px] flex-1 text-[13.5px] leading-[1.55] " +
            (card.description ? "text-slate-600" : "text-slate-300")
          }
        >
          {card.description || "소개 문구가 아직 없습니다."}
        </p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="truncate text-[12px] text-slate-400">{card.meta}</span>
        <span className="flex shrink-0 items-center gap-2.5 text-[12px] text-slate-400">
          {card.stats && (
            <>
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {card.stats.views}
              </span>
              {card.stats.downloads !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <Download className="h-3.5 w-3.5" />
                  {card.stats.downloads}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" />
                {card.stats.likes}
              </span>
            </>
          )}
          {available ? (
            card.download ? (
              <Download className="h-4 w-4 text-slate-300 transition-colors group-hover:text-[#004791]" />
            ) : (
              <ArrowRight className="h-4 w-4 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-[#004791]" />
            )
          ) : (
            <span className="text-[12px] font-medium text-slate-400">준비 중</span>
          )}
        </span>
      </div>
      </div>
    </>
  );

  if (available) {
    return (
      <button type="button" onClick={onOpen} className={cardCls}>
        {body}
      </button>
    );
  }
  return <div className={cardCls}>{body}</div>;
}

/**
 * 로고 패널(16:9) — 게시 도구의 첫 스크린샷은 대개 도구 로고 아트라 잘라내지 않고 통째로 보여준다.
 * 조회수 알약은 올리지 않는다(카드 본문에 있다). 관리자가 지정한 출처+상태 배지만 왼쪽 위에 붙인다.
 * 이미지가 없으면 lucide 아이콘을 연한 바탕에.
 */
function LogoPanel({ card, badge }: { card: HomeCard; badge?: CardBadge }) {
  const Icon = card.icon;
  const [imgOk, setImgOk] = useState(true);
  const src = card.available ? card.thumbnail ?? card.logo ?? null : null;
  const panel = "relative aspect-[16/9] w-full overflow-hidden border-b border-slate-100 bg-[#f7f9fc]";

  if (src && imgOk) {
    return (
      <div className={panel}>
        <img
          src={src}
          alt={`${card.name} 로고`}
          className="h-full w-full object-contain p-5 transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
          draggable={false}
          onError={() => setImgOk(false)}
        />
        <StatusBadge badge={badge} />
      </div>
    );
  }
  return (
    <div className={panel + " flex items-center justify-center"}>
      <Icon className={"h-12 w-12 " + (card.available ? "text-[#004791]/70" : "text-slate-300")} strokeWidth={1.4} />
      <StatusBadge badge={badge} />
    </div>
  );
}

/** 출처+상태 배지 — 두 칸을 붙인 알약. 지정이 없으면 그리지 않는다 */
function StatusBadge({ badge }: { badge?: CardBadge }) {
  if (!badge?.origin && !badge?.status) return null;
  const origin = badge.origin ? BADGE_ORIGIN_OPTIONS.find((o) => o.value === badge.origin) : undefined;
  return (
    <span
      className="absolute left-3 top-3 inline-flex overflow-hidden rounded-md text-[11.5px] font-bold leading-none shadow-sm ring-1 ring-slate-300/80"
      title={[origin?.title, statusLabel(badge.status)].filter(Boolean).join(" · ")}
    >
      {badge.origin && (
        <span className={"px-2 py-[5px] " + BADGE_ORIGIN_CLASS[badge.origin]}>{originLabel(badge.origin)}</span>
      )}
      {badge.status && (
        <span className={"px-2 py-[5px] " + BADGE_STATUS_CLASS[badge.status]}>{statusLabel(badge.status)}</span>
      )}
    </span>
  );
}

/** 편집 모드 배지 선택 — 카드 왼쪽 아래(← → 버튼 맞은편)에 출처 · 상태 드롭다운 두 개 */
function BadgeEditor({
  cardName,
  badge,
  onChange,
}: {
  cardName: string;
  badge?: CardBadge;
  onChange: (patch: Partial<CardBadge>) => void;
}) {
  const sel =
    "h-8 cursor-pointer rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 shadow ring-1 ring-slate-200 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-[#004791]/40";
  return (
    <div className="absolute bottom-3 left-3 flex gap-1" onDragStart={(e) => e.preventDefault()}>
      <select
        aria-label={`${cardName} 출처`}
        value={badge?.origin ?? ""}
        onChange={(e) => onChange({ origin: (e.target.value || undefined) as BadgeOrigin | undefined })}
        className={sel}
      >
        <option value="">출처 없음</option>
        {BADGE_ORIGIN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.title}
          </option>
        ))}
      </select>
      <select
        aria-label={`${cardName} 상태`}
        value={badge?.status ?? ""}
        onChange={(e) => onChange({ status: (e.target.value || undefined) as BadgeStatus | undefined })}
        className={sel}
      >
        <option value="">상태 없음</option>
        {BADGE_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
