/**
 * 코드표(중분류/소분류)를 따라 서류를 늘어놓는 화면.
 *
 * 왼쪽은 분류 트리, 오른쪽은 그 분류의 서류 카드다. **아직 안 올린 항목도 흐리게
 * 보여 준다** — 회사 표준 65개 중 몇 개를 채웠는지가 한눈에 보여야 하고, 빠진 칸을
 * 눌러 바로 올릴 수 있어야 한다. 올린 것만 보여 주면 무엇이 없는지 알 수가 없다.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Star, Trash2, Upload } from "lucide-react";
import type { FormSummary } from "./formStore";
import type { Taxonomy, TaxonomyItem } from "./taxonomy";

/** 왼쪽 트리에서 "전체"를 나타내는 값. 코드(숫자)와 겹치지 않게 잡았다. */
const ALL_GROUPS = " all";
/** 코드표에 없는 서류가 모이는 자리 */
const UNFILED = " unfiled";

interface FormTreeProps {
  taxonomy: Taxonomy;
  forms: FormSummary[];
  activeId: string | null;
  busy?: boolean;
  onOpen: (id: string) => void;
  onToggleFavorite: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  /** 빈 칸을 눌렀을 때 — 그 코드로 양식을 올린다. */
  onUploadFor: (item: TaxonomyItem) => void;
  /** 코드 없이 그냥 올리기 */
  onUpload: () => void;
  /** 코드표 바꾸기 */
  onReplaceTaxonomy: () => void;
  /** 코드표 지우기 — 양식은 남고 분류만 풀린다 */
  onClearTaxonomy: () => void;
}

export default function FormTree({
  taxonomy,
  forms,
  activeId,
  busy = false,
  onOpen,
  onToggleFavorite,
  onDelete,
  onUploadFor,
  onUpload,
  onReplaceTaxonomy,
  onClearTaxonomy,
}: FormTreeProps) {
  const [selected, setSelected] = useState<string>(ALL_GROUPS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");

  /** 코드 → 그 코드로 올린 서류들. 한 코드에 여러 장(월별 등)이 올 수 있다. */
  const byCode = useMemo(() => {
    const map = new Map<string, FormSummary[]>();
    for (const form of forms) {
      if (!form.code) continue;
      const list = map.get(form.code) ?? [];
      list.push(form);
      map.set(form.code, list);
    }
    return map;
  }, [forms]);

  const unfiled = useMemo(
    () => forms.filter((form) => !form.code || !byCode.has(form.code)),
    [forms, byCode],
  );

  const needle = query.trim().toLowerCase();
  const matches = (item: TaxonomyItem, related: FormSummary[]) => {
    if (favoritesOnly && !related.some((form) => form.favorite)) return false;
    if (needle === "") return true;
    return (
      item.name.toLowerCase().includes(needle) ||
      item.code.includes(needle) ||
      related.some((form) => form.title.toLowerCase().includes(needle))
    );
  };

  /** 화면에 뿌릴 줄: 분류 + 그 아래 항목(올린 것/빈 칸) */
  const rows = useMemo(() => {
    return taxonomy.groups
      .filter((group) => selected === ALL_GROUPS || selected === group.code)
      .map((group) => {
        const items = group.items
          .map((item) => ({ item, related: byCode.get(item.code) ?? [] }))
          .filter((entry) => matches(entry.item, entry.related));
        return { group, items };
      })
      .filter((row) => row.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomy, byCode, selected, needle, favoritesOnly]);

  const filledCount = (groupCode: string) =>
    taxonomy.groups
      .find((group) => group.code === groupCode)
      ?.items.filter((item) => byCode.has(item.code)).length ?? 0;

  const totalItems = taxonomy.groups.reduce((sum, group) => sum + group.items.length, 0);
  const totalFilled = taxonomy.groups.reduce((sum, group) => sum + filledCount(group.code), 0);

  function toggleExpand(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {/* ── 도구 줄 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-slate-700">
          서류 목록{" "}
          <span className="font-normal text-slate-400">
            {totalFilled} / {totalItems}
          </span>
        </h2>

        <button
          type="button"
          onClick={() => setFavoritesOnly((on) => !on)}
          aria-pressed={favoritesOnly}
          className={
            favoritesOnly
              ? "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white"
              : "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
          }
        >
          <Star size={13} fill={favoritesOnly ? "currentColor" : "none"} /> 즐겨찾기
        </button>

        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="서류명 · 코드 검색"
            aria-label="서류 검색"
            className="w-48 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-700 placeholder:text-slate-400"
          />
        </div>

        <button
          type="button"
          onClick={onUpload}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Upload size={13} /> {busy ? "읽는 중..." : "양식 올리기"}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-5 lg:flex-row">
        {/* ── 왼쪽: 분류 트리 ── */}
        <nav className="shrink-0 lg:w-64" aria-label="서류 분류">
          <button
            type="button"
            onClick={() => setSelected(ALL_GROUPS)}
            className={
              selected === ALL_GROUPS
                ? "flex w-full items-center justify-between rounded-lg bg-[#1b3a6b] px-3 py-2 text-xs font-semibold text-white"
                : "flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            <span>전체</span>
            <span className={selected === ALL_GROUPS ? "text-blue-200" : "text-slate-400"}>
              {totalFilled}/{totalItems}
            </span>
          </button>

          <ul className="mt-1 space-y-0.5">
            {taxonomy.groups.map((group) => {
              const filled = filledCount(group.code);
              const open = expanded.has(group.code);
              const active = selected === group.code;
              return (
                <li key={group.code}>
                  <div
                    className={
                      active
                        ? "flex items-center rounded-lg bg-blue-50 ring-1 ring-blue-200"
                        : "flex items-center rounded-lg hover:bg-slate-50"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(group.code)}
                      aria-label={`${group.name} ${open ? "접기" : "펴기"}`}
                      aria-expanded={open}
                      className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700"
                    >
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(group.code)}
                      className="flex min-w-0 flex-1 items-center justify-between py-2 pr-3 text-left"
                    >
                      <span className="min-w-0 truncate text-xs font-medium text-slate-700">
                        <span className="mr-1.5 text-slate-400">{group.code}</span>
                        {group.name}
                      </span>
                      <span
                        className={
                          filled > 0 ? "ml-2 text-xs text-blue-600" : "ml-2 text-xs text-slate-300"
                        }
                      >
                        {filled}/{group.items.length}
                      </span>
                    </button>
                  </div>

                  {open && (
                    <ul className="ml-6 border-l border-slate-200 pl-2">
                      {group.items.map((item) => {
                        const related = byCode.get(item.code) ?? [];
                        return (
                          <li key={item.code}>
                            <button
                              type="button"
                              onClick={() =>
                                related[0] ? onOpen(related[0].id) : onUploadFor(item)
                              }
                              title={related.length > 0 ? "열기" : "이 자리에 양식 올리기"}
                              className={
                                related.length > 0
                                  ? "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-50"
                                  : "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-slate-400 hover:bg-slate-50"
                              }
                            >
                              <span
                                aria-hidden
                                className={
                                  related.length > 0
                                    ? "h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                                    : "h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-slate-300"
                                }
                              />
                              <span className="shrink-0 tabular-nums">{item.code}</span>
                              <span className="truncate">{item.name}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}

            {unfiled.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setSelected(UNFILED)}
                  className={
                    selected === UNFILED
                      ? "flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-blue-200"
                      : "flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  }
                >
                  <span>코드 없는 서류</span>
                  <span className="text-slate-400">{unfiled.length}</span>
                </button>
              </li>
            )}
          </ul>

          <div className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
            <p className="truncate" title={taxonomy.fileName}>
              분류 기준: {taxonomy.fileName}
            </p>
            {taxonomy.conflicts.length > 0 && (
              <p className="mt-1 text-amber-600">
                겹치는 코드: {taxonomy.conflicts.join(", ")}
              </p>
            )}
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={onReplaceTaxonomy}
                className="rounded px-1.5 py-1 text-[11px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
              >
                코드표 바꾸기
              </button>
              <button
                type="button"
                onClick={onClearTaxonomy}
                className="rounded px-1.5 py-1 text-[11px] text-slate-400 underline-offset-2 hover:text-red-600 hover:underline"
              >
                코드표 지우기
              </button>
            </div>
          </div>
        </nav>

        {/* ── 오른쪽: 서류 카드 ── */}
        <div className="min-w-0 flex-1">
          {selected === UNFILED ? (
            <FormCards
              forms={unfiled}
              activeId={activeId}
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
            />
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              조건에 맞는 서류가 없습니다.
            </p>
          ) : (
            rows.map(({ group, items }) => (
              <section key={group.code} className="mb-6 last:mb-0">
                <h3 className="mb-3 text-xs font-semibold text-slate-600">
                  <span className="mr-1.5 text-slate-400">{group.code}</span>
                  {group.name}
                  <span className="ml-2 font-normal text-slate-400">
                    {filledCount(group.code)}/{group.items.length}
                  </span>
                </h3>
                <ul className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {items.map(({ item, related }) =>
                    related.length > 0 ? (
                      related.map((form) => (
                        <li key={form.id}>
                          <Card
                            title={form.title}
                            code={item.code}
                            favorite={form.favorite}
                            active={form.id === activeId}
                            onOpen={() => onOpen(form.id)}
                            onToggleFavorite={() => onToggleFavorite(form)}
                            onDelete={() => onDelete(form)}
                          />
                        </li>
                      ))
                    ) : (
                      <li key={item.code}>
                        <EmptyCard item={item} onUpload={() => onUploadFor(item)} />
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/** 코드 없이 올린 서류를 늘어놓는다(코드표를 쓰기 전에 올린 것들). */
function FormCards({
  forms,
  activeId,
  onOpen,
  onToggleFavorite,
  onDelete,
}: {
  forms: FormSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onToggleFavorite: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
}) {
  if (forms.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        코드 없는 서류가 없습니다.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {forms.map((form) => (
        <li key={form.id}>
          <Card
            title={form.title}
            favorite={form.favorite}
            active={form.id === activeId}
            onOpen={() => onOpen(form.id)}
            onToggleFavorite={() => onToggleFavorite(form)}
            onDelete={() => onDelete(form)}
          />
        </li>
      ))}
    </ul>
  );
}

function Card({
  title,
  code,
  favorite,
  active,
  onOpen,
  onToggleFavorite,
  onDelete,
}: {
  title: string;
  code?: string;
  favorite: boolean;
  active: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div
        className={
          active
            ? "relative rounded-sm ring-2 ring-blue-500"
            : "relative rounded-sm ring-1 ring-slate-300 transition hover:ring-slate-400"
        }
      >
        <button
          type="button"
          onClick={onOpen}
          title={title}
          className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 bg-slate-50 px-2.5 text-center transition hover:bg-slate-100"
        >
          {code && <span className="text-[10px] tabular-nums text-slate-400">{code}</span>}
          <span className="line-clamp-4 break-keep text-xs font-medium leading-snug text-slate-700">
            {title}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={`${title} 즐겨찾기`}
          title={favorite ? "즐겨찾기 해제" : "즐겨찾기"}
          className="absolute right-0 top-0 h-9 w-9"
        >
          <span
            aria-hidden
            className="absolute right-0 top-0 h-0 w-0 border-l-[36px] border-t-[36px] border-l-transparent"
            style={{ borderTopColor: favorite ? "#1b3a6b" : "#cbd5e1" }}
          />
          <Star
            size={12}
            aria-hidden
            className="absolute right-1 top-1 text-white"
            fill={favorite ? "currentColor" : "none"}
          />
        </button>
      </div>

      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${title} 지우기`}
          title="지우기"
          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </>
  );
}

/** 아직 안 올린 자리. 흐리게 두되 눌러서 바로 올릴 수 있다. */
function EmptyCard({ item, onUpload }: { item: TaxonomyItem; onUpload: () => void }) {
  return (
    <button
      type="button"
      onClick={onUpload}
      title={`${item.code} ${item.name} — 양식 올리기`}
      className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-slate-300 bg-white px-2.5 text-center text-slate-400 transition hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-600"
    >
      <span className="text-[10px] tabular-nums">{item.code}</span>
      <span className="line-clamp-3 break-keep text-[11px] leading-snug">{item.name}</span>
      <Plus size={14} aria-hidden />
    </button>
  );
}
