/**
 * 코드표(1차 분류 / 중분류 / 소분류)를 따라 서류를 늘어놓는 화면.
 *
 * 왼쪽은 분류 트리, 오른쪽은 그 분류의 서류 카드다. **아직 안 올린 항목도 흐리게
 * 보여 준다** — 회사 표준 중 몇 개를 채웠는지가 한눈에 보여야 하고, 빠진 칸을 눌러
 * 바로 올릴 수 있어야 한다. 올린 것만 보여 주면 무엇이 없는지 알 수가 없다.
 *
 * 1차 분류(공무관련·품질관련 …)마다 코드표가 따로 있고 **코드 번호가 서로 겹친다**
 * (둘 다 101 을 쓴다). 그래서 칸은 늘 "코드표 id + 코드"로 가리킨다.
 */
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { FormSummary } from "./formStore";
import { taxonomyIdOf, type Taxonomy, type TaxonomyGroup, type TaxonomyItem } from "./taxonomy";

/** 왼쪽 트리 선택값. 코드표 id·코드와 겹치지 않게 앞에 표시를 붙인다. */
const ALL = " all";
const UNFILED = " unfiled";
const divisionKey = (taxonomyId: string) => `t:${taxonomyId}`;
const groupKey = (taxonomyId: string, groupCode: string) => `g:${taxonomyId}:${groupCode}`;
/** 한 칸(= 코드표 안의 한 코드)을 가리키는 열쇠 */
const slotKey = (taxonomyId: string, code: string) => `${taxonomyId}:${code}`;

/** 오른쪽에서 접어 둔 분류를 기억하는 자리 */
const COLLAPSED_KEY = "ipg-forms:collapsed-groups";
/** 왼쪽에서 접어 둔 1차 분류를 기억하는 자리 */
const FOLDED_DIVISIONS_KEY = "ipg-forms:folded-divisions";

/** 이 브라우저에 기억해 둔 목록을 읽는다. 저장이 막힌 브라우저면 빈 목록. */
function readStoredSet(key: string): Set<string> {
  try {
    const saved = localStorage.getItem(key);
    return new Set(saved ? (JSON.parse(saved) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeStoredSet(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만 유지된다.
  }
}

interface FormTreeProps {
  taxonomies: Taxonomy[];
  forms: FormSummary[];
  activeId: string | null;
  busy?: boolean;
  onOpen: (id: string) => void;
  onToggleFavorite: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  /** 빈 칸을 눌렀을 때 — 그 코드표의 그 코드로 양식을 올린다. */
  onUploadFor: (taxonomyId: string, item: TaxonomyItem) => void;
  /**
   * 그냥 올리기. 지금 보고 있는 1차 분류를 넘겨, 파일 이름 번호가 여러 코드표에
   * 겹칠 때 어느 쪽으로 넣을지 정하는 데 쓴다.
   */
  onUpload: (preferredTaxonomyId?: string) => void;
  /** 코드표 올리기(새 1차 분류 추가, 또는 같은 이름 코드표 바꾸기) */
  onUploadTaxonomy: () => void;
  /** 1차 분류 이름 바꾸기 */
  onRenameDivision: (taxonomyId: string) => void;
  /** 코드표 하나 지우기 — 서류는 남고 분류만 풀린다 */
  onRemoveTaxonomy: (taxonomyId: string) => void;
}

export default function FormTree({
  taxonomies,
  forms,
  activeId,
  busy = false,
  onOpen,
  onToggleFavorite,
  onDelete,
  onUploadFor,
  onUpload,
  onUploadTaxonomy,
  onRenameDivision,
  onRemoveTaxonomy,
}: FormTreeProps) {
  const [selected, setSelected] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * 오른쪽에서 접어 둔 분류. 빈 칸이 대부분이라 다 펼치면 스크롤이 길다.
   * 다음에 열었을 때도 그대로 두는 게 편해 이 브라우저에 기억해 둔다(보는 사람마다 따로).
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      return new Set(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // 저장이 막힌 브라우저 — 이번 화면에서만 접힌다.
      }
      return next;
    });
  }

  /**
   * 왼쪽에서 접어 둔 1차 분류. 코드표가 여럿이면 중분류가 줄줄이 늘어서 길어진다 —
   * 지금 쓰는 1차 분류만 펼쳐 두게 한다. 다음에 열어도 그대로 두려고 기억한다.
   */
  const [foldedDivisions, setFoldedDivisions] = useState<Set<string>>(() =>
    readStoredSet(FOLDED_DIVISIONS_KEY),
  );

  function toggleFoldedDivision(taxonomyId: string) {
    setFoldedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(taxonomyId)) next.delete(taxonomyId);
      else next.add(taxonomyId);
      writeStoredSet(FOLDED_DIVISIONS_KEY, next);
      return next;
    });
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 칸 → 그 칸에 올린 서류들. 한 칸에 여러 장(월별 등)이 올 수 있다. */
  const bySlot = useMemo(() => {
    const map = new Map<string, FormSummary[]>();
    for (const form of forms) {
      const taxonomyId = taxonomyIdOf(form, taxonomies);
      if (!taxonomyId || !form.code) continue;
      const key = slotKey(taxonomyId, form.code);
      const list = map.get(key) ?? [];
      list.push(form);
      map.set(key, list);
    }
    return map;
  }, [forms, taxonomies]);

  /** 어느 칸에도 못 들어간 서류 — 코드가 없거나, 코드표가 지워졌거나, 코드표에 없는 번호 */
  const unfiled = useMemo(() => {
    const slots = new Set<string>();
    for (const taxonomy of taxonomies) {
      for (const group of taxonomy.groups) {
        for (const item of group.items) slots.add(slotKey(taxonomy.id, item.code));
      }
    }
    return forms.filter((form) => {
      const taxonomyId = taxonomyIdOf(form, taxonomies);
      return !taxonomyId || !form.code || !slots.has(slotKey(taxonomyId, form.code));
    });
  }, [forms, taxonomies]);

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

  const filledIn = (taxonomy: Taxonomy, group: TaxonomyGroup) =>
    group.items.filter((item) => bySlot.has(slotKey(taxonomy.id, item.code))).length;
  const totalOf = (taxonomy: Taxonomy) =>
    taxonomy.groups.reduce((sum, group) => sum + group.items.length, 0);
  const filledOf = (taxonomy: Taxonomy) =>
    taxonomy.groups.reduce((sum, group) => sum + filledIn(taxonomy, group), 0);
  const totalItems = taxonomies.reduce((sum, taxonomy) => sum + totalOf(taxonomy), 0);
  const totalFilled = taxonomies.reduce((sum, taxonomy) => sum + filledOf(taxonomy), 0);

  /** 지금 보고 있는 1차 분류. 전체를 보고 있으면 코드표가 하나일 때만 그것으로 본다. */
  const preferredTaxonomyId = selected.startsWith("t:")
    ? selected.slice(2)
    : selected.startsWith("g:")
      ? selected.split(":")[1]
      : taxonomies.length === 1
        ? taxonomies[0].id
        : undefined;

  /** 오른쪽에 뿌릴 내용: 1차 분류 → 중분류 → 항목(올린 것/빈 칸) */
  const sections = useMemo(
    () =>
      taxonomies
        .filter(
          (taxonomy) =>
            selected === ALL ||
            selected === divisionKey(taxonomy.id) ||
            selected.startsWith(`g:${taxonomy.id}:`),
        )
        .map((taxonomy) => ({
          taxonomy,
          groups: taxonomy.groups
            .filter((group) => !selected.startsWith("g:") || selected === groupKey(taxonomy.id, group.code))
            .map((group) => ({
              group,
              items: group.items
                .map((item) => ({ item, related: bySlot.get(slotKey(taxonomy.id, item.code)) ?? [] }))
                .filter((entry) => matches(entry.item, entry.related)),
            }))
            .filter((row) => row.items.length > 0),
        }))
        .filter((section) => section.groups.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxonomies, bySlot, selected, needle, favoritesOnly],
  );

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

        {/* 1차 분류를 더하는 입구. 안내 문구 속 링크로 두면 찾지 못한다 — 버튼으로 둔다. */}
        <button
          type="button"
          onClick={onUploadTaxonomy}
          title="코드표 엑셀을 올립니다. 시트 이름이 1차 분류 이름이 되고, 같은 이름이 있으면 그 코드표를 바꿉니다."
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
        >
          <FolderTree size={13} /> 코드표 올리기
        </button>

        <button
          type="button"
          onClick={() => onUpload(preferredTaxonomyId)}
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
            onClick={() => setSelected(ALL)}
            className={
              selected === ALL
                ? "flex w-full items-center justify-between rounded-lg bg-[#1b3a6b] px-3 py-2 text-xs font-semibold text-white"
                : "flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            <span>전체</span>
            <span className={selected === ALL ? "text-blue-200" : "text-slate-400"}>
              {totalFilled}/{totalItems}
            </span>
          </button>

          {taxonomies.map((taxonomy) => {
            const divisionActive = selected === divisionKey(taxonomy.id);
            const folded = foldedDivisions.has(taxonomy.id);
            const filled = filledOf(taxonomy);
            return (
              <div key={taxonomy.id} className="mt-3">
                {/* 1차 분류 — 코드표 한 벌을 묶는 큰 갈래(예: 공무관련). 시트 이름에서 온다. */}
                <div
                  className={
                    divisionActive
                      ? "flex items-center gap-1 rounded-lg bg-blue-50 pr-1 ring-1 ring-blue-200"
                      : "flex items-center gap-1 rounded-lg pr-1 hover:bg-slate-50"
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleFoldedDivision(taxonomy.id)}
                    aria-expanded={!folded}
                    aria-label={`${taxonomy.division || "1차 분류"} ${folded ? "펼치기" : "접기"}`}
                    title={folded ? "펼치기" : "접기"}
                    className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700"
                  >
                    <ChevronDown
                      size={13}
                      aria-hidden
                      className={folded ? "-rotate-90 transition-transform" : "transition-transform"}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(divisionKey(taxonomy.id))}
                    className="flex min-w-0 flex-1 items-center justify-between py-1.5 text-left"
                  >
                    <span
                      className={
                        taxonomy.division
                          ? "min-w-0 truncate text-xs font-semibold text-slate-700"
                          : "min-w-0 truncate text-xs italic text-slate-400"
                      }
                    >
                      {taxonomy.division || "1차 분류 이름 없음"}
                    </span>
                    <span className={filled > 0 ? "ml-2 text-xs text-blue-600" : "ml-2 text-xs text-slate-300"}>
                      {filled}/{totalOf(taxonomy)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRenameDivision(taxonomy.id)}
                    title="1차 분류 이름 바꾸기"
                    aria-label={`${taxonomy.division || "1차 분류"} 이름 바꾸기`}
                    className="shrink-0 rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil size={11} />
                  </button>
                </div>

                {!folded && (
                <ul className="mt-1 ml-2 space-y-0.5 border-l-2 border-slate-100 pl-1">
                  {taxonomy.groups.map((group) => {
                    const key = groupKey(taxonomy.id, group.code);
                    const open = expanded.has(key);
                    const active = selected === key;
                    const groupFilled = filledIn(taxonomy, group);
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
                            onClick={() => toggleExpand(key)}
                            aria-label={`${group.name} ${open ? "접기" : "펴기"}`}
                            aria-expanded={open}
                            className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700"
                          >
                            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelected(key)}
                            className="flex min-w-0 flex-1 items-center justify-between py-2 pr-3 text-left"
                          >
                            <span className="min-w-0 truncate text-xs font-medium text-slate-700">
                              <span className="mr-1.5 text-slate-400">{group.code}</span>
                              {group.name}
                            </span>
                            <span
                              className={
                                groupFilled > 0 ? "ml-2 text-xs text-blue-600" : "ml-2 text-xs text-slate-300"
                              }
                            >
                              {groupFilled}/{group.items.length}
                            </span>
                          </button>
                        </div>

                        {open && (
                          <ul className="ml-6 border-l border-slate-200 pl-2">
                            {group.items.map((item, index) => {
                              const related = bySlot.get(slotKey(taxonomy.id, item.code)) ?? [];
                              return (
                                // 겹치는 코드(같은 번호 두 줄)가 있어 코드만으로는 열쇠가 겹친다.
                                <li key={`${item.code}-${index}`}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      related[0] ? onOpen(related[0].id) : onUploadFor(taxonomy.id, item)
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
                </ul>
                )}

                {!folded && taxonomy.conflicts.length > 0 && (
                  <p className="ml-4 mt-1 text-[11px] text-amber-600">
                    겹치는 코드: {taxonomy.conflicts.join(", ")}
                  </p>
                )}
              </div>
            );
          })}

          {unfiled.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected(UNFILED)}
              className={
                selected === UNFILED
                  ? "mt-3 flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-blue-200"
                  : "mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
              }
            >
              <span>코드 없는 서류</span>
              <span className="text-slate-400">{unfiled.length}</span>
            </button>
          )}

          <div className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
            <p className="mb-1">분류 기준</p>
            <ul className="space-y-1">
              {taxonomies.map((taxonomy) => (
                <li key={taxonomy.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate" title={taxonomy.fileName}>
                    {taxonomy.division || "이름 없음"} · {taxonomy.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveTaxonomy(taxonomy.id)}
                    title="이 코드표 지우기(서류는 남습니다)"
                    aria-label={`${taxonomy.division || "코드표"} 지우기`}
                    className="shrink-0 rounded p-0.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
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
          ) : sections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              조건에 맞는 서류가 없습니다.
            </p>
          ) : (
            sections.map(({ taxonomy, groups }) => (
              <div key={taxonomy.id} className="mb-8 last:mb-0">
                <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800">
                  {taxonomy.division || "1차 분류 이름 없음"}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {filledOf(taxonomy)}/{totalOf(taxonomy)}
                  </span>
                </h2>

                {groups.map(({ group, items }) => {
                  const key = slotKey(taxonomy.id, group.code);
                  // 검색 중에는 접어 둔 분류도 펼쳐 보인다 — 찾은 것이 접힌 칸에 숨으면 "없다"로 보인다.
                  const isCollapsed = needle === "" && collapsed.has(key);
                  return (
                    <section key={group.code} className="mb-6 last:mb-0">
                      <h3 className="mb-3">
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(key)}
                          aria-expanded={!isCollapsed}
                          title={isCollapsed ? "펼치기" : "접기"}
                          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                        >
                          <span className="text-slate-400">{group.code}</span>
                          {group.name}
                          <span className="font-normal text-slate-400">
                            {filledIn(taxonomy, group)}/{group.items.length}
                          </span>
                          <ChevronDown
                            size={14}
                            aria-hidden
                            className={
                              isCollapsed
                                ? "-rotate-90 text-slate-400 transition-transform"
                                : "text-slate-400 transition-transform"
                            }
                          />
                        </button>
                      </h3>
                      {!isCollapsed && (
                        <ul className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                          {items.map(({ item, related }, index) =>
                            related.length > 0 ? (
                              related.map((form) => (
                                <li key={`${form.id}-${index}`}>
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
                              <li key={`${item.code}-${index}`}>
                                <EmptyCard item={item} onUpload={() => onUploadFor(taxonomy.id, item)} />
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
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
