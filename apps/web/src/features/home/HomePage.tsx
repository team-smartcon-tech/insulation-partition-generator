/**
 * HomePage — 시공샵 자동화 플랫폼의 메인 허브(런처).
 * 로그인 후 "/" 에서 도구 목록을 카드로 보여주고, 카드를 누르면 각 도구로 이동한다.
 * 디자인: 프리미엄 다크 네이비 + 중앙 방사형 글로우 (우미 표지 톤) + 다크 글래스 카드.
 * 도구 목록은 features/home/tools.ts(TOOLS)를 원천으로 한다.
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
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useMarketApps } from "@/features/market/hooks";
import { TOOLS, type ToolDef } from "./tools";

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
  /** 카드 썸네일 (내장=public 경로, 게시=Storage signed URL) */
  thumbnail?: string | null;
  /** 카드 하단 좌측 표기 */
  meta: string;
  /** 클릭 시 이동할 내부 경로 (없으면 클릭 불가) */
  href?: string;
  stats?: { views: number; likes: number };
}

const toolToCard = (tool: ToolDef): HomeCard => ({
  key: `tool:${tool.id}`,
  name: tool.name,
  description: tool.description,
  tags: tool.tags ?? [],
  icon: tool.icon,
  available: tool.status === "available",
  thumbnail: tool.thumbnail,
  meta: "우미 · 오토콘",
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

  const cards = useMemo(() => {
    const published = marketApps.map<HomeCard>((app) => ({
      key: `market:${app.id}`,
      name: app.title,
      description: app.description ?? "",
      tags: app.tags ?? [],
      icon: LayoutGrid,
      available: true,
      thumbnail: app.thumbnail_url,
      meta: [app.author_name, app.team].filter(Boolean).join(" · ") || "우미 · 오토콘",
      href: `/market/${app.id}`,
      stats: { views: app.view_count, likes: app.like_count },
    }));

    // 같은 이름으로 실제 게시되면 "준비 중" 자리표시자는 감춘다 (줄눈컷팅 등 중복 방지).
    const publishedNames = new Set(published.map((c) => c.name.replace(/\s+/g, "")));
    const builtIn = TOOLS.map(toolToCard).filter(
      (c) => c.available || !publishedNames.has(c.name.replace(/\s+/g, "")),
    );

    // 사용 가능(내장 → 게시) 먼저, 준비 중 자리표시자는 뒤로.
    return [
      ...builtIn.filter((c) => c.available),
      ...published,
      ...builtIn.filter((c) => !c.available),
    ];
  }, [marketApps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [cards, query]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#e6eefb] via-[#f2f6fd] to-[#e8f0fa] text-slate-800">
      {/* ── 배경 레이어 (블루프린트 그리드 + 움직이는 오로라 광원) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* 블루프린트 그리드 — 천천히 흐름 */}
        <div
          className="ambient-anim absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(2,71,145,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(2,71,145,0.07) 1px, transparent 1px)",
            backgroundSize: "46px 46px",
            maskImage:
              "radial-gradient(120% 80% at 50% -10%, #000 35%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(120% 80% at 50% -10%, #000 35%, transparent 78%)",
            animation: "gridDrift 34s linear infinite",
          }}
        />
        {/* 움직이는 오로라 광원 */}
        <div
          className="ambient-anim absolute -left-44 -top-52 h-[580px] w-[580px] rounded-full blur-[92px]"
          style={{
            background: "radial-gradient(circle, #1478d6 0%, transparent 68%)",
            opacity: 0.28,
            animation: "ambientFloatA 17s ease-in-out infinite",
          }}
        />
        <div
          className="ambient-anim absolute -top-36 right-[-140px] h-[540px] w-[540px] rounded-full blur-[92px]"
          style={{
            background: "radial-gradient(circle, #22c1ff 0%, transparent 68%)",
            opacity: 0.24,
            animation: "ambientFloatB 21s ease-in-out infinite",
          }}
        />
        <div
          className="ambient-anim absolute bottom-[-160px] left-1/4 h-[540px] w-[780px] rounded-full blur-[112px]"
          style={{
            background: "radial-gradient(ellipse, #4f83e0 0%, transparent 70%)",
            opacity: 0.2,
            animation: "ambientFloatC 24s ease-in-out infinite 1.5s",
          }}
        />
        <div
          className="ambient-anim absolute left-1/2 top-1/3 h-[320px] w-[320px] rounded-full blur-[84px]"
          style={{
            background: "radial-gradient(circle, #7cc4ff 0%, transparent 65%)",
            opacity: 0.18,
            animation: "ambientFloatB 19s ease-in-out infinite 0.8s",
          }}
        />
        {/* 은은한 빛 스윕 */}
        <div className="absolute -top-1/2 left-0 h-[200%] w-full overflow-hidden">
          <div
            className="ambient-anim absolute top-0 h-full w-[26%] blur-2xl"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
              animation: "sheenSweep 13s ease-in-out infinite 3s",
            }}
          />
        </div>
      </div>

      {/* ── 상단 헤더 (흰색 글래스) ── */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 shadow-[0_8px_24px_-16px_rgba(8,22,52,0.4)] backdrop-blur-xl">
        <div className="flex h-[68px] w-full items-center justify-between px-8">
          {/* 좌: 우미 로고 + 워드마크 */}
          <div className="flex items-center gap-4">
            <WoomiLogo />
            <div className="h-7 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent" />
            <div className="flex flex-col leading-none">
              <div
                className="flex items-baseline gap-0.5"
                style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
              >
                <span className="text-[22px] tracking-tight text-slate-900">
                  Auto<span className="text-[#0a63b8]">Con</span>
                </span>
                <span className="text-[23px] leading-none text-[#1478d6]">.</span>
              </div>
              <span className="mt-[3px] text-[8.5px] font-bold uppercase tracking-[0.26em] text-slate-400">
                Construction Automation
              </span>
            </div>
          </div>

          {/* 우: 사용자 + 로그아웃 */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-[13.5px] font-bold text-slate-800">{user.name} 님</div>
                {roleLabel && <div className="text-[11px] text-slate-400">{roleLabel}</div>}
              </div>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2a8fe6] via-[#0a63b8] to-[#003a78] text-[13px] font-bold text-white shadow-[0_4px_12px_-2px_rgba(0,71,145,0.5)] ring-1 ring-white/30">
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

      {/* ── 본문 (App Market) ── */}
      <main className="relative w-full px-8 py-10">
        {/* 헤딩 + 검색 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="bg-gradient-to-r from-[#00274d] via-[#0a63b8] to-[#1478d6] bg-clip-text text-[34px] leading-tight text-transparent"
              style={{ fontFamily: "'Black Han Sans', 'SUIT Variable', sans-serif" }}
            >
              시공상세도 자동화 TOOL
            </h1>
            <p className="mt-1.5 text-[14px] text-slate-500">
              시공 자동화 앱·도구 디렉터리
            </p>
          </div>
          <div className="flex w-full max-w-2xl items-center gap-2.5 sm:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="도구명 · 설명 · 태그 검색"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-[14px] text-slate-800 shadow-sm outline-none backdrop-blur transition-all placeholder:text-slate-400 focus:border-[#0a63b8] focus:bg-white focus:ring-2 focus:ring-[#0a63b8]/15"
              />
            </div>
            {/* 게시하기 — 관리자만 노출 */}
            {canPublish && (
              <button
                type="button"
                onClick={() => navigate("/market/new")}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#0a63b8] px-4 text-[14px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(10,99,184,0.9)] transition-colors hover:bg-[#004791]"
              >
                <Plus className="h-4 w-4" />
                게시하기
              </button>
            )}
          </div>
        </div>

        {/* 카테고리 헤더 */}
        <div className="mt-8 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#0a63b8]" />
          <span className="text-[14px] font-bold text-slate-700">시공 도구</span>
          <span className="text-[13px] font-semibold text-slate-400">{filtered.length}</span>
        </div>

        {/* 카드 그리드 */}
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((card) => (
            <AppCard
              key={card.key}
              card={card}
              onOpen={() => card.href && navigate(card.href)}
            />
          ))}
        </div>
        {filtered.length === 0 && (
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

/** App Market 스타일 카드 — 썸네일 + 태그 + 상태 */
function AppCard({ card, onOpen }: { card: HomeCard; onOpen: () => void }) {
  const Icon = card.icon;
  const available = card.available;
  // 실제 화면 썸네일 (로드 실패 시 아이콘 썸네일 폴백)
  const [thumbOk, setThumbOk] = useState(true);
  const showThumb = available && !!card.thumbnail && thumbOk;

  const cardCls =
    "group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-[0_1px_3px_rgba(16,24,40,0.06),0_10px_24px_-14px_rgba(16,24,40,0.16)] transition-all duration-300" +
    (available
      ? " hover:-translate-y-1.5 hover:border-[#0a63b8]/30 hover:shadow-[0_24px_48px_-16px_rgba(0,71,145,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a63b8]/40"
      : "");

  const thumb = (
    <div className="relative h-40 w-full overflow-hidden">
      {showThumb ? (
        <img
          src={card.thumbnail ?? undefined}
          alt={`${card.name} 미리보기`}
          className="h-full w-full border-b border-slate-100 object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
          onError={() => setThumbOk(false)}
        />
      ) : available ? (
        <div className="relative h-full w-full bg-gradient-to-br from-[#2a8fe6] via-[#0a63b8] to-[#00274d]">
          <div
            className="absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          />
          <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#22c1ff] via-white/70 to-[#22c1ff]" />
          <Icon
            className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-white/90 drop-shadow transition-transform duration-300 group-hover:scale-110"
            strokeWidth={1.6}
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
          <Icon className="h-12 w-12 text-slate-300" strokeWidth={1.6} />
        </div>
      )}
      <span
        className={
          "absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur ring-1 " +
          (available
            ? "bg-white/90 text-emerald-600 ring-emerald-200/70"
            : "bg-white/85 text-slate-500 ring-slate-200")
        }
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " + (available ? "bg-emerald-500" : "bg-slate-400")
          }
        />
        {available ? "사용 가능" : "준비 중"}
      </span>
    </div>
  );

  const body = (
    <div className="flex flex-1 flex-col p-5">
      <div className="text-[16px] font-bold tracking-tight text-slate-900">{card.name}</div>
      {card.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-slate-500">
        {card.description}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="flex items-center gap-2.5 text-[12px] font-medium text-slate-400">
          {card.meta}
          {card.stats && (
            <span className="inline-flex items-center gap-2 text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {card.stats.views}
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" />
                {card.stats.likes}
              </span>
            </span>
          )}
        </span>
        {available ? (
          <span className="inline-flex items-center gap-1 text-[13px] font-bold text-[#0a63b8]">
            열기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : (
          <span className="text-[12px] font-medium text-slate-300">준비 중</span>
        )}
      </div>
    </div>
  );

  if (available) {
    return (
      <button type="button" onClick={onOpen} className={cardCls}>
        {thumb}
        {body}
      </button>
    );
  }
  return (
    <div className={cardCls}>
      {thumb}
      {body}
    </div>
  );
}
