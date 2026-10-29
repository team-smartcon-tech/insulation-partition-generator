/**
 * HomePage — 스마트 툴박스의 메인 허브(런처).
 * 로그인 후 "/" 에서 도구 목록을 카드로 보여주고, 카드를 누르면 각 도구로 이동한다.
 * 디자인: 네이비 단색 상단 띠 + 연한 바탕 + 흰 카드(로고 패널 · 이름 · 두 줄 설명). 배지·알약·오로라는 두지 않는다
 *   (2026-10-29 — 「사용 가능」배지·조회수 알약·광원 배경이 브로슈어처럼 보여 걷어냄.
 *    로고를 48px 아이콘으로 줄이는 안은 게시 도구 로고가 얼룩이 돼 철회).
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
import { TOOLS, type ToolDef } from "./tools";
import { applyHomeOrder, moveCardKey, stepCardKey } from "./homeOrder";

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
  meta: "우미 · 스마트 툴박스",
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

  // ── 카드 순서: 관리자가 저장한 순서(DB)를 기본 정렬 위에 덮는다. 편집 중엔 초안 순서로 그린다 ──
  const { data: homeOrder } = useHomeOrder();
  const saveOrder = useSaveHomeOrder();
  const [draftKeys, setDraftKeys] = useState<string[] | null>(null);
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
        stats: {
          views: app.view_count,
          likes: app.like_count,
          downloads: download ? app.download_count ?? 0 : undefined,
        },
      };
    });

    // 같은 이름으로 실제 게시되면 "준비 중" 자리표시자는 감춘다 (줄눈컷팅 등 중복 방지).
    const publishedNames = new Set(published.map((c) => c.name.replace(/\s+/g, "")));
    const builtIn = TOOLS.map(toolToCard).filter(
      (c) => c.available || !publishedNames.has(c.name.replace(/\s+/g, "")),
    );

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
  }, [marketApps]);

  const savedKeys = homeOrder?.keys;
  const cards = useMemo(() => {
    const ordered = applyHomeOrder(defaultCards, savedKeys ?? []);
    return draftKeys ? applyHomeOrder(ordered, draftKeys) : ordered;
  }, [defaultCards, savedKeys, draftKeys]);

  const sectionByKey = useMemo(() => new Map(cards.map((c) => [c.key, c.section])), [cards]);
  const sectionOf = (key: string) => sectionByKey.get(key) ?? "";

  const startEdit = () => {
    setQuery("");
    setOrderError(null);
    setDraftKeys(cards.map((c) => c.key));
  };
  const cancelEdit = () => {
    setDraftKeys(null);
    setDragKey(null);
    setOrderError(null);
  };
  const commitEdit = () => {
    if (!draftKeys) return;
    setOrderError(null);
    saveOrder.mutate(draftKeys, {
      onSuccess: () => setDraftKeys(null),
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

  const availableCount = useMemo(() => cards.filter((c) => c.available).length, [cards]);

  // 툴바 버튼 — 흰 바탕 위 외곽선형 / 채움형 두 가지만 쓴다
  const btnBase =
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50";
  const btnOutline =
    btnBase + " border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
  const btnPrimary = btnBase + " bg-[#004791] text-white hover:bg-[#003a78]";

  return (
    <div className="min-h-screen bg-[#f4f6fa] text-slate-800">
      {/* ── 상단 헤더 ── */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex h-16 w-full items-center justify-between px-8">
          {/* 좌: 우미 로고 + 워드마크 */}
          <div className="flex items-center gap-4">
            <WoomiLogo />
            <div className="h-6 w-px bg-slate-200" />
            <BrandWordmark />
          </div>

          {/* 우: 사용자 + 로그아웃 */}
          <div className="flex items-center gap-3">
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

      {/* ── 개요 띠 — 브랜드 네이비 단색. 소제목 · 제목 · 요약 수치. 헤더 워드마크와 겹치지 않게 이름은 다시 쓰지 않는다 ── */}
      <section className="bg-[#00254f]">
        <div className="mx-auto flex w-full max-w-[2100px] flex-wrap items-end justify-between gap-x-10 gap-y-5 px-8 pb-7 pt-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="h-px w-6 bg-[#5cc8ff]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8fd4ff]">Tool Directory</span>
            </div>
            <h1 className="mt-2.5 text-[26px] font-bold leading-tight tracking-tight text-white">현장 시공 자동화 도구</h1>
            <p className="mt-2 text-[13.5px] text-white/60">
              현장에서 바로 쓰는 도구를 한곳에서 찾고, 직접 만든 도구를 공유합니다.
            </p>
          </div>
          <dl className="hidden divide-x divide-white/15 sm:flex">
            <OverviewStat label="등록 도구" value={cards.length} />
            <OverviewStat label="사용 가능" value={availableCount} />
            <OverviewStat label="섹션" value={SECTIONS.filter((s) => cards.some((c) => c.section === s.id)).length} />
          </dl>
        </div>
        <span className="block h-[3px] w-full bg-[#1478d6]" />
      </section>

      {/* ── 툴바 — 검색 · 관리자 버튼. 헤더(h-16) 아래 붙는다 ── */}
      <section className="sticky top-16 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[2100px] flex-wrap items-center justify-between gap-3 px-8 py-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              disabled={editing}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="도구명 · 설명 · 태그 검색"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#004791] focus:ring-2 focus:ring-[#004791]/15 disabled:bg-slate-50"
            />
          </div>
          <div className="flex items-center gap-2">
            {/* 순서 편집 — 관리자만. 편집 중엔 저장/취소로 바뀐다 */}
            {canPublish && !editing && (
              <button
                type="button"
                onClick={startEdit}
                className={btnOutline}
                title="카드 순서를 바꿉니다 (모든 사용자에게 같은 순서로 보입니다)"
              >
                <ArrowUpDown className="h-4 w-4" />
                순서 편집
              </button>
            )}
            {editing && (
              <>
                <button type="button" onClick={cancelEdit} disabled={saveOrder.isPending} className={btnOutline}>
                  <X className="h-4 w-4" />
                  취소
                </button>
                <button type="button" onClick={commitEdit} disabled={saveOrder.isPending} className={btnPrimary}>
                  <Check className="h-4 w-4" />
                  {saveOrder.isPending ? "저장 중…" : "순서 저장"}
                </button>
              </>
            )}
            {/* 게시하기 — 관리자만 노출 */}
            {canPublish && !editing && (
              <button type="button" onClick={() => navigate("/market/new")} className={btnPrimary}>
                <Plus className="h-4 w-4" />
                게시하기
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── 본문 (App Market) ── */}
      <main className="mx-auto w-full max-w-[2100px] px-8 pb-14 pt-8">
        {editing && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-[#004791]/20 bg-[#eaf2fb] px-4 py-3 text-[13px] text-[#0a4a8a]">
            <ArrowUpDown className="h-4 w-4 shrink-0" />
            <span>
              카드를 끌어다 놓거나 ← → 버튼으로 순서를 바꾸세요. 같은 섹션 안에서만 옮길 수 있고, 저장하면 모든 사용자에게 같은 순서로 보입니다.
            </span>
            {orderError && <span className="font-semibold text-red-600">{orderError}</span>}
          </div>
        )}
        {sections.map((sec, idx) => (
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
                    <AppCard card={card} onOpen={() => {}} />
                    {/* 편집 중엔 카드 클릭(이동)을 막고 순서 조작만 받는다 */}
                    <div className="absolute inset-0 rounded-xl">
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200">
                        <GripVertical className="h-3.5 w-3.5" />
                        {i + 1}
                      </span>
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

/** 개요 띠의 요약 수치 한 칸 — 숫자를 세우고 라벨은 아래에 작게 */
function OverviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-7 first:pl-0 last:pr-0">
      <dt className="text-[11.5px] font-medium text-white/55">{label}</dt>
      <dd className="mt-1 text-[26px] font-bold leading-none tabular-nums text-white">{value}</dd>
    </div>
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
function AppCard({ card, onOpen }: { card: HomeCard; onOpen: () => void }) {
  const available = card.available;

  const cardCls =
    "group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-all duration-200" +
    (available
      ? " hover:border-[#004791]/50 hover:shadow-[0_8px_24px_-12px_rgba(0,37,79,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004791]/40"
      : " opacity-70");

  const body = (
    <>
      <LogoPanel card={card} />
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
 * 배지·조회수 알약은 올리지 않는다(카드 본문에 있다). 이미지가 없으면 lucide 아이콘을 연한 바탕에.
 */
function LogoPanel({ card }: { card: HomeCard }) {
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
      </div>
    );
  }
  return (
    <div className={panel + " flex items-center justify-center"}>
      <Icon className={"h-12 w-12 " + (card.available ? "text-[#004791]/70" : "text-slate-300")} strokeWidth={1.4} />
    </div>
  );
}
