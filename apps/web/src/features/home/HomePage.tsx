/**
 * HomePage — 시공샵 자동화 플랫폼의 메인 허브(런처).
 * 로그인 후 "/" 에서 도구 목록을 카드로 보여주고, 카드를 누르면 각 도구로 이동한다.
 * 디자인: 프리미엄 다크 네이비 + 중앙 방사형 글로우 (우미 표지 톤) + 다크 글래스 카드.
 * 도구 목록은 features/home/tools.ts(TOOLS)를 원천으로 한다.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Search,
  Plus,
  LayoutGrid,
  Eye,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import BrandWordmark from "@/components/brand/BrandWordmark";
import { HeroChip, SmartBackground, SmartHeader, SmartHero } from "@/components/layout/SmartShell";
import { useMarketApps } from "@/features/market/hooks";
import { TOOLS, type ToolDef } from "./tools";

/** 게시 권한 role — 최종 판정은 서버(market.ts)가 하고, 여기선 버튼 노출 여부만 본다. */
const PUBLISH_ROLES = new Set(["super_admin", "system_admin"]);

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
  meta: "우미 · 스마트덱",
  href: tool.status === "available" ? tool.path : undefined,
});

export default function HomePage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

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
      meta: [app.author_name, app.team].filter(Boolean).join(" · ") || "우미 · 스마트덱",
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

  const availableCount = useMemo(() => cards.filter((c) => c.available).length, [cards]);

  return (
    <SmartBackground>
      <SmartHeader brand={<BrandWordmark />} />

      <SmartHero
        eyebrow="SmartDeck · Tool Directory"
        chips={
          <>
            <HeroChip>도구 {cards.length}</HeroChip>
            <HeroChip dot>사용 가능 {availableCount}</HeroChip>
          </>
        }
        title="건설계획 자동화 TOOL"
        description="현장에서 바로 쓰는 시공 자동화 앱·도구를 한곳에서 찾고, 직접 만든 도구를 공유해 보세요."
        actions={
          <>
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="도구명 · 설명 · 태그 검색"
                className="h-11 w-full rounded-xl border border-white/25 bg-white/12 pl-10 pr-3 text-[14px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] outline-none backdrop-blur transition-all placeholder:text-white/55 focus:border-white/60 focus:bg-white/20 focus:ring-2 focus:ring-white/25"
              />
            </div>
            {/* 게시하기 — 관리자만 노출 */}
            {canPublish && (
              <button
                type="button"
                onClick={() => navigate("/market/new")}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-5 text-[14px] font-bold text-[#0a5aa8] shadow-[0_14px_30px_-14px_rgba(0,20,45,0.9)] transition-all hover:-translate-y-0.5 hover:bg-[#f2f8ff]"
              >
                <Plus className="h-4 w-4" />
                게시하기
              </button>
            )}
          </>
        }
      />

      {/* ── 본문 (App Market) ── */}
      <main className="relative mx-auto w-full max-w-[2100px] px-8 pb-14 pt-9">
        {/* 카테고리 헤더 */}
        <SectionHeading title="시공 도구" count={filtered.length} />

        {/* 카드 그리드 — 준비 중 도구도 같은 크기 카드로 이어 붙인다 */}
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
    </SmartBackground>
  );
}

/** 섹션 제목 — "시공 도구 5" 처럼 개수와 함께 위계를 준다. */
function SectionHeading({
  title,
  count,
  muted = false,
}: {
  title: string;
  count: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={"h-2 w-2 rounded-full " + (muted ? "bg-slate-300" : "bg-[#0a63b8]")}
      />
      <span
        className={
          "text-[15px] font-bold tracking-tight " + (muted ? "text-slate-400" : "text-slate-800")
        }
      >
        {title}
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold text-slate-500">
        {count}
      </span>
      <span className="ml-1 h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
    </div>
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
    // 16:10 고정 프레임 — 카드 높이는 모든 카드에서 같게 유지한다.
    // 이미지는 잘라내지 않고(object-contain) 프레임 안에 통째로 맞춘다:
    // 올린 원본과 상세 "화면" 이 같은 비율로 보이게 하기 위함(정사각 로고가 카드에서만 잘리던 문제).
    <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-slate-100 bg-slate-50">
      {showThumb ? (
        <img
          src={card.thumbnail ?? undefined}
          alt={`${card.name} 미리보기`}
          className="h-full w-full object-contain object-center transition-transform duration-300 group-hover:scale-[1.03]"
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
      {/* 조회/좋아요는 썸네일 위로 — 카드 하단 줄을 모든 카드에서 동일하게 유지한다. */}
      {card.stats && (
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-2.5 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur">
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
    </div>
  );

  const body = (
    <div className="flex flex-1 flex-col p-5">
      <div className="truncate text-[16px] font-bold tracking-tight text-slate-900">
        {card.name}
      </div>
      {/* 태그 줄 — 태그가 없어도 높이를 차지해 카드 간 본문 위치를 맞춘다. */}
      <div className="mt-2.5 flex min-h-[22px] flex-wrap gap-1.5">
        {card.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
          >
            {tag}
          </span>
        ))}
      </div>
      <p
        className={
          "mt-2.5 line-clamp-2 min-h-[40px] flex-1 text-[13px] leading-relaxed " +
          (card.description ? "text-slate-500" : "text-slate-300")
        }
      >
        {card.description || "소개 문구가 아직 등록되지 않았습니다."}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="truncate text-[12px] font-medium text-slate-400">{card.meta}</span>
        {available ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-bold text-[#0a63b8]">
            열기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : (
          <span className="shrink-0 text-[12px] font-medium text-slate-300">준비 중</span>
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
