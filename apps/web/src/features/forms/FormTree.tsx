/**
 * 코드표(1차 분류 / 중분류 / 소분류)를 따라 서류를 늘어놓는 화면.
 *
 * 왼쪽은 분류 트리, 오른쪽은 서류다. 회사 표준 124칸 중 채운 것은 소수라, **빈 칸을 카드와
 * 같은 크기로 그리면 화면이 빈 상자로 뒤덮인다.** 그래서:
 *  - 올린 서류는 세로로 긴 서류 카드로(모서리 별 = 즐겨찾기),
 *  - 빈 칸은 한 줄짜리 행으로 — 처음 몇 개만 보이고 나머지는 "더 보기",
 *  - 한 칸도 안 채운 중분류는 제목 한 줄로 접는다.
 * 빈 칸을 아예 안 보이게 하면 "무엇이 없는지"를 알 수 없어, 숨기기는 사용자가 고르게 둔다.
 *
 * 1차 분류(공무관련·품질관련 …)마다 코드표가 따로 있고 **코드 번호가 서로 겹친다**
 * (둘 다 101 을 쓴다). 그래서 칸은 늘 "코드표 id + 코드"로 가리킨다.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ClipboardPaste,
  Eye,
  EyeOff,
  FilePenLine,
  FolderTree,
  GripVertical,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
} from "lucide-react";
import { contactFor, formatContact, isEmptyContact } from "./contacts";
import type { FormSummary } from "./formStore";
import { divisionLabel, fileNameCodes, taxonomyIdOf, type Taxonomy, type TaxonomyGroup, type TaxonomyItem } from "./taxonomy";

/** 왼쪽 트리 선택값. 코드표 id·코드와 겹치지 않게 앞에 표시를 붙인다. */
const ALL = " all";
const UNFILED = " unfiled";
const divisionKey = (taxonomyId: string) => `t:${taxonomyId}`;
const groupKey = (taxonomyId: string, groupCode: string) => `g:${taxonomyId}:${groupCode}`;
/** 한 칸(= 코드표 안의 한 코드)을 가리키는 열쇠 */
const slotKey = (taxonomyId: string, code: string) => `${taxonomyId}:${code}`;

/** 오른쪽에서 사용자가 접어 둔 중분류 */
const COLLAPSED_KEY = "ipg-forms:collapsed-groups";
/** 왼쪽에서 접어 둔 1차 분류 */
const FOLDED_DIVISIONS_KEY = "ipg-forms:folded-divisions";
/** 빈 항목 숨기기 */
const HIDE_EMPTY_KEY = "ipg-forms:hide-empty";

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

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만 유지된다.
  }
}

/** Set 에서 하나를 넣고 빼는 새 Set */
function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export interface Badge {
  label: string;
  title: string;
  tone: "amber" | "rose" | "blue";
}

/** 빈 칸·(+) 단추가 무엇을 하는지. 현장 서류함에서는 원본이 있으면 "작성하기"가 된다. */
export interface SlotAction {
  label: string;
  title: string;
  /** true 면 배포 양식에서 사본 만들기, false 면 파일 올리기 */
  write: boolean;
  /** true 면 할 수 있는 일이 없다 — 누를 것 없이 흐린 글자만 보인다 */
  none?: boolean;
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
  /** 코드표 편집 모드인가 — 켜면 칸을 더하고 고치고 지우는 버튼이 붙는다 */
  editing: boolean;
  onToggleEditing: () => void;
  onAddDivision: () => void;
  onAddGroup: (taxonomyId: string) => void;
  onEditGroup: (taxonomyId: string, groupCode: string) => void;
  onRemoveGroup: (taxonomyId: string, groupCode: string) => void;
  onAddItem: (taxonomyId: string, groupCode: string) => void;
  onEditItem: (taxonomyId: string, item: TaxonomyItem) => void;
  onRemoveItem: (taxonomyId: string, item: TaxonomyItem) => void;
  /** 폴더 이름 목록을 붙여넣어 한 번에 채우기 */
  onPasteInto: (taxonomyId: string) => void;
  /** 칸을 끌어다 놓아 옮기기. before 가 없으면 그 중분류 맨 끝으로. */
  onMoveItem: (taxonomyId: string, code: string, toGroupCode: string, before?: string) => void;
  /** 중분류 순서 바꾸기 */
  onMoveGroup: (taxonomyId: string, code: string, before?: string) => void;
  /** 한 중분류의 칸 번호를 지금 순서대로 다시 매기기 */
  onRenumberGroup: (taxonomyId: string, groupCode: string) => void;
  /** 중분류 담당 적기(그 아래 칸이 물려받는다) */
  onEditGroupContact?: (taxonomyId: string, groupCode: string) => void;
  /** 칸 담당 적기(비우면 다시 중분류 담당을 따른다) */
  onEditItemContact?: (taxonomyId: string, item: TaxonomyItem) => void;
  /** 머리 제목(배포 양식함 / 현장 서류함) */
  title?: string;
  /** 제목 아래 한 줄 설명 */
  subtitle?: ReactNode;
  /**
   * 코드표를 고치고 올리는 도구를 보일지. 코드표는 회사 공통이라 배포 양식함에서만 다룬다 —
   * 현장 서류함에까지 두면 한 현장에서 칸을 지워 다른 현장 목록까지 바뀐다.
   */
  manageTaxonomy?: boolean;
  /** "양식 올리기" 단추 글자. null 이면 단추를 감춘다(빈 칸의 올리기는 남는다). */
  uploadLabel?: string | null;
  /** 도구 줄 맨 앞에 더 붙일 것(예: 배포 양식에서 가져오기) */
  toolbarExtra?: ReactNode;
  /** 화면이 더 붙이는 표시(예: 새 판 있음) */
  extraBadges?: (form: FormSummary) => Badge[];
  /** 칸마다 올리기/작성하기 중 무엇을 할지. 없으면 늘 올리기. */
  slotAction?: (taxonomyId: string, item: TaxonomyItem) => SlotAction;
  /**
   * 세는 칸(`코드표id:코드`). 주면 **이 칸들만** 분모로 센다 — 현장 서류함은 배포 양식이 있는 서류만
   * 셈에 넣어 홈의 서류 진척도와 숫자가 같게 한다. 없으면 코드표의 모든 칸.
   */
  countableSlots?: Set<string>;
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
  editing,
  onToggleEditing,
  onAddDivision,
  onAddGroup,
  onEditGroup,
  onRemoveGroup,
  onAddItem,
  onEditItem,
  onRemoveItem,
  onPasteInto,
  onMoveItem,
  onMoveGroup,
  onRenumberGroup,
  onEditGroupContact,
  onEditItemContact,
  title = "서류 목록",
  subtitle,
  manageTaxonomy = true,
  uploadLabel = "양식 올리기",
  toolbarExtra,
  extraBadges,
  slotAction,
  countableSlots,
}: FormTreeProps) {
  const actionFor = (taxonomyId: string, item: TaxonomyItem): SlotAction =>
    slotAction?.(taxonomyId, item) ?? {
      label: "올리기",
      title: `${item.code} ${item.name} 칸에 파일을 올립니다`,
      write: false,
    };
  const [selected, setSelected] = useState<string>(ALL);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");
  /** 사용자가 접어 둔 중분류(채운 것이 있는 중분류). 다음에 열어도 그대로 둔다. */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStoredSet(COLLAPSED_KEY));
  /** 왼쪽에서 접어 둔 1차 분류 */
  const [foldedDivisions, setFoldedDivisions] = useState<Set<string>>(() =>
    readStoredSet(FOLDED_DIVISIONS_KEY),
  );
  const [hideEmpty, setHideEmpty] = useState<boolean>(() => readStoredFlag(HIDE_EMPTY_KEY));
  /** ⋯ 메뉴가 열린 서류 */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 지금 끌고 있는 것(칸 또는 중분류) */
  const [dragging, setDragging] = useState<{ kind: "item" | "group"; taxonomyId: string; code: string } | null>(null);
  /** 끌고 있는 것이 놓일 자리 — 이 줄 위에 파란 선을 그린다. */
  const [dropBefore, setDropBefore] = useState<string | null>(null);

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

  /**
   * 파일 이름 → 그 파일이 들어가 있는 칸들. 같은 파일을 두 칸에 올린 것을 찾는다.
   *
   * 올릴 때 한 번 계산해 서류에 박아 두지 않는다 — 그러면 다른 서류를 지우거나 코드표를
   * 바꿔도 표시가 그대로 남아 거짓말이 된다. 서류가 수십 개라 그릴 때마다 세도 가볍다.
   */
  const slotsByFileName = useMemo(() => {
    const map = new Map<string, { key: string; code: string }[]>();
    for (const form of forms) {
      const taxonomyId = taxonomyIdOf(form, taxonomies);
      if (!taxonomyId || !form.code) continue;
      const list = map.get(form.fileName) ?? [];
      list.push({ key: slotKey(taxonomyId, form.code), code: form.code });
      map.set(form.fileName, list);
    }
    return map;
  }, [forms, taxonomies]);

  function badgesFor(form: FormSummary): Badge[] {
    const badges: Badge[] = [];
    // 파일 이름 앞 번호와 들어간 칸의 번호가 다르다(옛 체계 파일명이거나, 다른 칸에 올린 경우).
    const candidates = fileNameCodes(form.fileName);
    const numbered = candidates[0];
    if (numbered && form.code && !candidates.includes(form.code)) {
      badges.push({
        label: "코드 불일치",
        title: `파일 이름은 ${numbered}, 들어간 칸은 ${form.code}입니다.`,
        tone: "amber",
      });
    }
    const taxonomyId = taxonomyIdOf(form, taxonomies);
    if (taxonomyId && form.code) {
      const mine = slotKey(taxonomyId, form.code);
      const others = [
        ...new Set(
          (slotsByFileName.get(form.fileName) ?? [])
            .filter((slot) => slot.key !== mine)
            .map((slot) => slot.code),
        ),
      ];
      if (others.length > 0) {
        badges.push({
          label: `${others.join("·")}와 중복`,
          title: `같은 파일이 ${others.join(", ")} 칸에도 올라가 있습니다.`,
          tone: "rose",
        });
      }
    }
    return extraBadges ? [...badges, ...extraBadges(form)] : badges;
  }

  const needle = query.trim().toLowerCase();
  const searching = needle !== "";
  const matches = (item: TaxonomyItem, related: FormSummary[]) => {
    if (favoritesOnly && !related.some((form) => form.favorite)) return false;
    if (!searching) return true;
    return (
      item.name.toLowerCase().includes(needle) ||
      item.code.includes(needle) ||
      related.some(
        (form) =>
          form.title.toLowerCase().includes(needle) || form.fileName.toLowerCase().includes(needle),
      )
    );
  };

  const countable = (taxonomy: Taxonomy, group: TaxonomyGroup) =>
    countableSlots ? group.items.filter((item) => countableSlots.has(slotKey(taxonomy.id, item.code))) : group.items;
  const filledIn = (taxonomy: Taxonomy, group: TaxonomyGroup) =>
    countable(taxonomy, group).filter((item) => bySlot.has(slotKey(taxonomy.id, item.code))).length;
  const groupTotal = (taxonomy: Taxonomy, group: TaxonomyGroup) => countable(taxonomy, group).length;
  const totalOf = (taxonomy: Taxonomy) =>
    taxonomy.groups.reduce((sum, group) => sum + groupTotal(taxonomy, group), 0);
  const filledOf = (taxonomy: Taxonomy) =>
    taxonomy.groups.reduce((sum, group) => sum + filledIn(taxonomy, group), 0);
  const totalItems = taxonomies.reduce((sum, taxonomy) => sum + totalOf(taxonomy), 0);
  const totalFilled = taxonomies.reduce((sum, taxonomy) => sum + filledOf(taxonomy), 0);
  const percent = totalItems > 0 ? Math.round((totalFilled / totalItems) * 100) : 0;

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
            // 편집 중에는 빈 중분류·빈 분류도 보여야 한다 — 방금 만든 칸이 안 보이면 이어서 못 채운다.
            .filter((row) => editing || row.items.length > 0),
        }))
        .filter((section) => editing || section.groups.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxonomies, bySlot, selected, needle, favoritesOnly, editing],
  );

  function toggleHideEmpty() {
    setHideEmpty((on) => {
      writeStoredFlag(HIDE_EMPTY_KEY, !on);
      return !on;
    });
  }

  function renderGroup(
    taxonomy: Taxonomy,
    group: TaxonomyGroup,
    items: { item: TaxonomyItem; related: FormSummary[] }[],
  ) {
    const key = slotKey(taxonomy.id, group.code);

    // 편집 중에는 서류 카드 대신 칸 목록을 편다 — 지금 하는 일이 "칸 정리"라서,
    // 채워진 칸만 크게 보이면 어디를 고쳐야 할지 보이지 않는다.
    if (editing) {
      const groupDropKey = `g:${group.code}`;
      return (
        <section
          key={group.code}
          className={
            "mb-2 rounded-xl ring-1 ring-amber-200" +
            (dropBefore === groupDropKey ? " ring-2 ring-blue-400" : "") +
            (dragging?.kind === "group" && dragging.code === group.code ? " opacity-50" : "")
          }
          onDragOver={(event) => {
            if (!dragging || dragging.taxonomyId !== taxonomy.id) return;
            event.preventDefault();
            // 칸을 끌고 있으면 이 중분류 맨 끝으로, 중분류를 끌고 있으면 이 중분류 앞으로.
            setDropBefore(dragging.kind === "group" ? groupDropKey : `end:${group.code}`);
          }}
          onDrop={(event) => {
            if (!dragging || dragging.taxonomyId !== taxonomy.id) return;
            event.preventDefault();
            if (dragging.kind === "group") onMoveGroup(taxonomy.id, dragging.code, group.code);
            else onMoveItem(taxonomy.id, dragging.code, group.code);
            setDragging(null);
            setDropBefore(null);
          }}
        >
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setDragging({ kind: "group", taxonomyId: taxonomy.id, code: group.code });
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropBefore(null);
            }}
            title="끌어서 중분류 순서를 바꿉니다"
            className="flex cursor-grab flex-wrap items-center gap-2 rounded-t-xl bg-amber-50/70 px-3 py-2 active:cursor-grabbing"
          >
            <GripVertical size={14} aria-hidden className="shrink-0 text-amber-400" />
            <span className="text-sm font-semibold text-slate-800">
              <span className="mr-1.5 tabular-nums">{group.code}</span>
              {group.name}
            </span>
            <span className="text-xs tabular-nums text-slate-500">칸 {group.items.length}개</span>
            {onEditGroupContact && (
              <button
                type="button"
                onClick={() => onEditGroupContact(taxonomy.id, group.code)}
                title="이 중분류의 기본 담당. 아래 칸들이 물려받습니다."
                className={
                  isEmptyContact(group.contact)
                    ? "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 ring-1 ring-dashed ring-slate-300 hover:bg-white"
                    : "inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                }
              >
                <UserRound size={12} />
                {isEmptyContact(group.contact) ? "담당 정하기" : formatContact(group.contact!)}
              </button>
            )}
            <span className="ml-auto flex items-center gap-1">
              {group.items.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRenumberGroup(taxonomy.id, group.code)}
                  title="지금 순서대로 번호를 다시 매깁니다(701, 702 …). 올려 둔 서류도 새 번호를 따라갑니다."
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-white"
                >
                  <ListOrdered size={12} /> 번호 정리
                </button>
              )}
              <button
                type="button"
                onClick={() => onAddItem(taxonomy.id, group.code)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-300 hover:bg-white"
              >
                <Plus size={12} /> 칸 추가
              </button>
              <button
                type="button"
                onClick={() => onEditGroup(taxonomy.id, group.code)}
                title="중분류 번호·이름 고치기"
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onRemoveGroup(taxonomy.id, group.code)}
                title="중분류 지우기"
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>

          {group.items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">아직 칸이 없습니다. “칸 추가”를 누르세요.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {group.items.map((item, index) => {
                const count = bySlot.get(slotKey(taxonomy.id, item.code))?.length ?? 0;
                return (
                  <li
                    key={`${item.code}-${index}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging({ kind: "item", taxonomyId: taxonomy.id, code: item.code });
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropBefore(null);
                    }}
                    onDragOver={(event) => {
                      if (!dragging || dragging.kind !== "item" || dragging.taxonomyId !== taxonomy.id) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDropBefore(item.code);
                    }}
                    onDrop={(event) => {
                      if (!dragging || dragging.kind !== "item" || dragging.taxonomyId !== taxonomy.id) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onMoveItem(taxonomy.id, dragging.code, group.code, item.code);
                      setDragging(null);
                      setDropBefore(null);
                    }}
                    className={
                      "flex cursor-grab items-center gap-2 px-3 py-2 active:cursor-grabbing" +
                      (dropBefore === item.code ? " border-t-2 border-blue-500" : "") +
                      (dragging?.kind === "item" && dragging.code === item.code ? " opacity-40" : "")
                    }
                  >
                    <GripVertical size={14} aria-hidden className="shrink-0 text-slate-300" />
                    <span className="w-14 shrink-0 text-xs tabular-nums text-slate-500">{item.code}</span>
                    <span className="truncate text-sm text-slate-700">{item.name}</span>
                    {count > 0 && (
                      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        서류 {count}
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {onEditItemContact && (
                        <button
                          type="button"
                          onClick={() => onEditItemContact(taxonomy.id, item)}
                          title={
                            isEmptyContact(item.contact)
                              ? "이 칸만 담당이 다르면 적습니다. 비워 두면 중분류 담당을 따릅니다."
                              : "이 칸만의 담당입니다. 비우면 중분류 담당을 따릅니다."
                          }
                          className={
                            isEmptyContact(item.contact)
                              ? "inline-flex max-w-[16rem] items-center gap-1 truncate rounded px-1.5 py-1 text-[11px] text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                              : "inline-flex max-w-[16rem] items-center gap-1 truncate rounded bg-blue-50 px-1.5 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                          }
                        >
                          <UserRound size={12} className="shrink-0" />
                          {isEmptyContact(item.contact)
                            ? isEmptyContact(group.contact)
                              ? "담당"
                              : "중분류 담당"
                            : formatContact(item.contact!)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditItem(taxonomy.id, item)}
                        title="번호·이름 고치기"
                        className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(taxonomy.id, item)}
                        title="칸 지우기"
                        className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-rose-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 맨 끝에 놓으려고 상자 아래쪽으로 끌고 왔을 때 */}
          {dropBefore === `end:${group.code}` && <div className="mx-3 mb-2 h-0.5 rounded bg-blue-500" />}
        </section>
      );
    }

    const filledEntries = items.filter((entry) => entry.related.length > 0);
    const emptyEntries = items.filter((entry) => entry.related.length === 0);
    const allEmpty = filledEntries.length === 0;

    // 빈 항목 숨기기 — 한 칸도 안 채운 중분류는 통째로 뺀다(검색 중에는 찾은 것을 보여 준다).
    if (hideEmpty && allEmpty && !searching) return null;

    // 빈 칸도 처음부터 모두 보여 준다(사용자 판단: 몇 개만 보이고 "더 보기"로 숨기면 오히려 찾기 어렵다).
    // 줄이고 싶으면 [빈 항목 숨기기], 중분류째 접으려면 제목을 누른다.
    const isCollapsed = !searching && collapsed.has(key);
    const visibleEmpty = hideEmpty ? [] : emptyEntries;

    return (
      <section key={group.code} className="mb-2">
        <h3>
          <button
            type="button"
            onClick={() =>
              setCollapsed((prev) => {
                const next = toggled(prev, key);
                writeStoredSet(COLLAPSED_KEY, next);
                return next;
              })
            }
            aria-expanded={!isCollapsed}
            title={isCollapsed ? "펼치기" : "접기"}
            className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
          >
            <ChevronDown
              size={15}
              aria-hidden
              className={isCollapsed ? "-rotate-90 text-slate-400 transition-transform" : "text-slate-400 transition-transform"}
            />
            <span className="tabular-nums">{group.code}</span>
            {group.name}
            <span className="font-normal tabular-nums text-slate-500">
              {/* 셀 서류가 없으면(현장 서류함에서 배포 양식이 하나도 없는 중분류) 0/0 대신 – */}
              {groupTotal(taxonomy, group) === 0 ? "–" : `${filledIn(taxonomy, group)}/${groupTotal(taxonomy, group)}`}
            </span>
          </button>
          {/* 서류를 쓰다 막히면 물어볼 곳. 중분류 제목 옆에 한 번만 — 칸마다 되풀이하면 목록이 글자로 덮인다. */}
          {!isEmptyContact(group.contact) && (
            <span
              className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-slate-500"
              title="이 중분류 서류의 담당입니다. 담당이 다른 칸은 칸 옆에 따로 표시됩니다."
            >
              <UserRound size={12} aria-hidden className="text-slate-400" />
              담당 {formatContact(group.contact!)}
            </span>
          )}
        </h3>

        {!isCollapsed && (
          <div className="mt-2">
            {filledEntries.length > 0 && (
              // 칸(코드)마다 "712 현장설명서" 라벨을 달고 그 아래에 올린 서류를 둔다.
              // 카드에는 파일 이름이 뜨는데, 파일 이름은 보통 코드표의 칸 이름과 달라
              // (`● (현장명) OO공사 현장설명서(공통사항)_Ver3-4_26.06`) 라벨이 없으면
              // **어느 칸이 채워진 것인지 목록에서 사라져 버린다.**
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,8.5rem))] gap-x-3 gap-y-4">
                {filledEntries.flatMap(({ item, related }) =>
                  related.map((form, index) => (
                    <li key={`${form.id}-${item.code}`}>
                      {/* 같은 칸에 여러 장(월별 등)이면 첫 장에만 라벨을 붙인다. */}
                      <div className="mb-1 flex items-center gap-1 leading-tight">
                        <p
                          className={
                            "min-w-0 truncate text-[11px] " +
                            (index === 0 ? "text-slate-500" : "text-transparent")
                          }
                          title={(() => {
                            const resolved = contactFor(taxonomy, item.code);
                            return resolved
                              ? `${item.code} ${item.name}
담당 ${formatContact(resolved.contact)}`
                              : `${item.code} ${item.name}`;
                          })()}
                        >
                          <span className="tabular-nums">{item.code}</span> {item.name}
                        </p>
                        {/* 같은 칸에 한 장 더 올리기. 이미 한 장 올린 칸은 "올리기" 줄이 사라져,
                            여기 말고는 그 칸에 더 올릴 입구가 없다. */}
                        {index === 0 && !actionFor(taxonomy.id, item).none && (
                          <button
                            type="button"
                            onClick={() => onUploadFor(taxonomy.id, item)}
                            title={
                              actionFor(taxonomy.id, item).write
                                ? `${item.code} ${item.name} 한 부 더 작성하기`
                                : `${item.code} ${item.name} 칸에 파일을 더 올립니다`
                            }
                            aria-label={`${item.code} ${item.name} 칸에 한 부 더`}
                            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                      <DocCard
                        form={form}
                        code={item.code}
                        badges={badgesFor(form)}
                        active={form.id === activeId}
                        menuOpen={menuFor === form.id}
                        onOpen={() => onOpen(form.id)}
                        onToggleMenu={() => setMenuFor((current) => (current === form.id ? null : form.id))}
                        onToggleFavorite={() => {
                          setMenuFor(null);
                          onToggleFavorite(form);
                        }}
                        onDelete={() => {
                          setMenuFor(null);
                          onDelete(form);
                        }}
                      />
                    </li>
                  )),
                )}
              </ul>
            )}

            {/* 빈 칸은 한 줄짜리 행으로. 카드 크기로 그리면 같은 내용이 여덟 배 높이를 먹는다. */}
            {visibleEmpty.length > 0 && (
              <ul className="mt-3 grid gap-x-8 lg:grid-cols-2">
                {visibleEmpty.map(({ item }, index) => (
                  // 같은 번호가 두 줄인 코드표가 있어 번호만으로는 열쇠가 겹친다.
                  <li key={`${item.code}-${index}`}>
                    <EmptyRow
                      item={item}
                      ownContact={contactFor(taxonomy, item.code)?.inherited === false ? formatContact(item.contact!) : undefined}
                      action={actionFor(taxonomy.id, item)}
                      onUpload={() => onUploadFor(taxonomy.id, item)}
                    />
                  </li>
                ))}
              </ul>
            )}

          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {/* ⋯ 메뉴 바깥을 누르면 닫는다 */}
      {menuFor && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          tabIndex={-1}
          onClick={() => setMenuFor(null)}
          className="fixed inset-0 z-[5] cursor-default"
        />
      )}

      {/* ── 머리: 진행률 + 도구 ── */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            {title}{" "}
            <span className="text-sm font-normal tabular-nums text-slate-500">
              {totalFilled} / {totalItems}종
            </span>
          </h2>
          <div
            role="progressbar"
            aria-label="회사 표준 서류 채움 정도"
            aria-valuemin={0}
            aria-valuemax={totalItems}
            aria-valuenow={totalFilled}
            className="mt-2 h-1.5 w-44 overflow-hidden rounded-full bg-slate-100"
          >
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          {subtitle && <p className="mt-2 text-xs text-slate-500">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {toolbarExtra}
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
              className="w-44 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-700 placeholder:text-slate-400"
            />
          </div>

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

          <button
            type="button"
            onClick={toggleHideEmpty}
            aria-pressed={hideEmpty}
            title={hideEmpty ? "안 올린 칸도 보여 줍니다" : "안 올린 칸을 감춥니다"}
            className={
              hideEmpty
                ? "inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white"
                : "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            }
          >
            {hideEmpty ? <Eye size={13} /> : <EyeOff size={13} />}
            {hideEmpty ? "빈 항목 보이기" : "빈 항목 숨기기"}
          </button>

          {manageTaxonomy && (
          <button
            type="button"
            onClick={onToggleEditing}
            aria-pressed={editing}
            title="코드표(분류 칸)를 사이트에서 직접 만들고 고칩니다."
            className={
              editing
                ? "inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white"
                : "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            }
          >
            <Pencil size={13} /> {editing ? "편집 끝내기" : "코드표 편집"}
          </button>
          )}

          {editing && (
            <button
              type="button"
              onClick={onAddDivision}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-amber-300 transition hover:bg-amber-50"
            >
              <Plus size={13} /> 1차 분류
            </button>
          )}

          {/* 1차 분류를 더하는 입구. 안내 문구 속 링크로 두면 찾지 못한다 — 버튼으로 둔다. */}
          {manageTaxonomy && (
          <button
            type="button"
            onClick={onUploadTaxonomy}
            title="코드표 엑셀을 올립니다. 시트 이름이 1차 분류 이름이 되고, 같은 이름이 있으면 그 코드표를 바꿉니다."
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-50"
          >
            <FolderTree size={13} /> 코드표 올리기
          </button>
          )}

          {uploadLabel !== null && (
          <button
            type="button"
            onClick={() => onUpload(preferredTaxonomyId)}
            disabled={busy}
            title="엑셀 양식을 올립니다. 여러 개를 한 번에 골라도 됩니다 — 파일 이름 앞 번호로 각자 제자리에 들어갑니다."
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Upload size={13} /> {busy ? "읽는 중..." : uploadLabel}
          </button>
          )}
        </div>
      </div>

      {editing && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800 ring-1 ring-amber-200">
          코드표 편집 중입니다. 칸을 지워도 <strong className="font-semibold">올려 둔 서류는 지워지지 않고</strong>{" "}
          “코드 없는 서류”로 옮겨집니다. 다 고치면 <strong className="font-semibold">편집 끝내기</strong>를 누르세요.
        </p>
      )}

      {/*
        ── 1차 분류 탭 ──
        서류철 라벨처럼 위에 붙여, 지금 어느 분류를 보고 있는지 한눈에 보이게 한다.
        왼쪽 트리에도 같은 항목이 있지만, 분류를 옮길 때마다 왼쪽 목록을 훑어야 했다.
      */}
      {(taxonomies.length > 1 || unfiled.length > 0) && (
        <div className="mt-5 flex flex-wrap items-end gap-1 border-b border-slate-200">
          {[
            { key: ALL, label: "전체", filled: totalFilled, total: totalItems, tone: "normal" as const },
            ...taxonomies.map((taxonomy) => ({
              key: divisionKey(taxonomy.id),
              label: divisionLabel(taxonomy.division) || "이름 없음",
              filled: filledOf(taxonomy),
              total: totalOf(taxonomy),
              tone: "normal" as const,
            })),
            ...(unfiled.length > 0
              ? [{ key: UNFILED, label: "코드 없는 서류", filled: unfiled.length, total: 0, tone: "warn" as const }]
              : []),
          ].map((tab) => {
            const active = selected === tab.key || (tab.key !== ALL && tab.key !== UNFILED && selected.startsWith(`g:${tab.key.slice(2)}:`));
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelected(tab.key)}
                aria-current={active ? "page" : undefined}
                className={
                  "-mb-px rounded-t-lg border border-b-0 px-3.5 py-2 text-sm transition " +
                  (active
                    ? tab.tone === "warn"
                      ? "border-amber-300 bg-amber-100 font-semibold text-amber-900"
                      : "border-slate-200 bg-white font-semibold text-slate-900"
                    : tab.tone === "warn"
                      ? "border-transparent bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200/70")
                }
              >
                {tab.tone === "warn" && <TriangleAlert size={13} aria-hidden className="mr-1 inline align-[-2px]" />}
                {tab.label}{" "}
                <span className="font-normal tabular-nums text-slate-400">
                  {tab.total > 0 ? `${tab.filled}/${tab.total}` : tab.filled}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-6 lg:flex-row">
        {/* ── 왼쪽: 분류 트리 ── */}
        <nav className="shrink-0 lg:w-60" aria-label="서류 분류">
          {/*
            1차 분류는 **위 탭**이 맡는다. 여기 또 두면 같은 이름이 두 번 보여
            "중복돼 보인다"는 말이 나온다(사용자 지적). 왼쪽은 그 아래 중분류만 맡는다.
          */}
          {taxonomies
            // 한 분류를 고르면 그 분류의 중분류만 보여 준다(탭과 나란히 보이는 겹침을 없앤다).
            .filter((taxonomy) => selected === ALL || selected === UNFILED || selected === divisionKey(taxonomy.id) || selected.startsWith(`g:${taxonomy.id}:`))
            .map((taxonomy) => {
            const divisionActive = selected === divisionKey(taxonomy.id);
            const folded = foldedDivisions.has(taxonomy.id);
            return (
              <div key={taxonomy.id} className="mt-1">
                <div
                  className={
                    divisionActive
                      ? "group flex items-center rounded-lg bg-slate-100"
                      : "group flex items-center rounded-lg hover:bg-slate-50"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setFoldedDivisions((prev) => {
                        const next = toggled(prev, taxonomy.id);
                        writeStoredSet(FOLDED_DIVISIONS_KEY, next);
                        return next;
                      })
                    }
                    aria-expanded={!folded}
                    aria-label={`${divisionLabel(taxonomy.division) || "1차 분류"} ${folded ? "펼치기" : "접기"}`}
                    title={folded ? "펼치기" : "접기"}
                    className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700"
                  >
                    <ChevronDown
                      size={14}
                      aria-hidden
                      className={folded ? "-rotate-90 transition-transform" : "transition-transform"}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(divisionKey(taxonomy.id))}
                    className="flex min-w-0 flex-1 items-center justify-between py-2 text-left"
                  >
                    <span
                      className={
                        taxonomy.division
                          ? divisionActive
                            ? "min-w-0 truncate text-sm font-semibold text-slate-900"
                            : "min-w-0 truncate text-sm font-medium text-slate-700"
                          : "min-w-0 truncate text-sm italic text-slate-400"
                      }
                    >
                      {divisionLabel(taxonomy.division) || "1차 분류 이름 없음"}
                    </span>
                    <span className="ml-2 text-sm tabular-nums text-slate-500">
                      {filledOf(taxonomy)}/{totalOf(taxonomy)}
                    </span>
                  </button>
                  {manageTaxonomy && (
                  <button
                    type="button"
                    onClick={() => onRenameDivision(taxonomy.id)}
                    title="1차 분류 이름 바꾸기"
                    aria-label={`${divisionLabel(taxonomy.division) || "1차 분류"} 이름 바꾸기`}
                    className="shrink-0 rounded p-1.5 text-slate-300 transition hover:text-slate-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                  >
                    <Pencil size={12} />
                  </button>
                  )}
                </div>

                {!folded && (
                  <ul className="mb-1 ml-5 mt-0.5 space-y-px">
                    {taxonomy.groups.map((group) => {
                      const key = groupKey(taxonomy.id, group.code);
                      const active = selected === key;
                      const filled = filledIn(taxonomy, group);
                      return (
                        <li key={group.code}>
                          <button
                            type="button"
                            onClick={() => setSelected(key)}
                            className={
                              active
                                ? "flex w-full items-center justify-between rounded-md bg-slate-100 px-2 py-1.5 text-left text-[13px] font-medium text-slate-900"
                                : "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-slate-50"
                            }
                          >
                            <span className={filled > 0 ? "min-w-0 truncate text-slate-700" : "min-w-0 truncate text-slate-400"}>
                              <span className="mr-1.5 tabular-nums">{group.code}</span>
                              {group.name}
                            </span>
                            <span className={filled > 0 ? "ml-2 tabular-nums text-slate-600" : "ml-2 tabular-nums text-slate-300"}>
                              {groupTotal(taxonomy, group) === 0 ? "–" : `${filled}/${groupTotal(taxonomy, group)}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!folded && taxonomy.conflicts.length > 0 && (
                  <p className="mb-1 ml-7 text-[11px] text-amber-600">
                    겹치는 코드: {taxonomy.conflicts.join(", ")}
                  </p>
                )}
              </div>
            );
          })}

          {manageTaxonomy && (
          <div className="mt-4 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
            <p className="mb-1">분류 기준</p>
            <ul className="space-y-1">
              {taxonomies.map((taxonomy) => (
                <li key={taxonomy.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate" title={taxonomy.fileName}>
                    {divisionLabel(taxonomy.division) || "이름 없음"} · {taxonomy.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveTaxonomy(taxonomy.id)}
                    title="이 코드표 지우기(서류는 남습니다)"
                    aria-label={`${divisionLabel(taxonomy.division) || "코드표"} 지우기`}
                    className="shrink-0 rounded p-0.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}
        </nav>

        {/* ── 오른쪽: 서류 ── */}
        <div className="min-w-0 flex-1">
          {selected === UNFILED ? (
            unfiled.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                코드 없는 서류가 없습니다.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-600">
                  코드표의 어느 칸에도 들어가지 않은 서류입니다. 파일 이름 앞에 번호가 없거나, 번호가
                  여러 1차 분류에 겹쳐 자리를 정하지 못한 경우입니다.
                </p>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,8.5rem))] gap-x-3 gap-y-4">
                  {unfiled.map((form) => (
                    <li key={form.id}>
                      <DocCard
                        form={form}
                        badges={[]}
                        active={form.id === activeId}
                        menuOpen={menuFor === form.id}
                        onOpen={() => onOpen(form.id)}
                        onToggleMenu={() => setMenuFor((current) => (current === form.id ? null : form.id))}
                        onToggleFavorite={() => {
                          setMenuFor(null);
                          onToggleFavorite(form);
                        }}
                        onDelete={() => {
                          setMenuFor(null);
                          onDelete(form);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : sections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              조건에 맞는 서류가 없습니다.
            </p>
          ) : (
            sections.map(({ taxonomy, groups }) => {
              const rendered = groups
                .map(({ group, items }) => renderGroup(taxonomy, group, items))
                .filter(Boolean);
              if (rendered.length === 0 && !editing) return null;
              return (
                <div key={taxonomy.id} className="mb-8 last:mb-0">
                  {(taxonomies.length > 1 || editing) && (
                    <h2 className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-slate-200 pb-2">
                      <span className="text-base font-semibold text-slate-900">
                        {divisionLabel(taxonomy.division) || "1차 분류 이름 없음"}
                      </span>
                      <span className="text-sm tabular-nums text-slate-500">
                        {filledOf(taxonomy)}/{totalOf(taxonomy)}
                      </span>
                      {editing && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onAddGroup(taxonomy.id)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50"
                          >
                            <Plus size={12} /> 중분류
                          </button>
                          <button
                            type="button"
                            onClick={() => onPasteInto(taxonomy.id)}
                            title="탐색기에서 폴더를 복사해 붙여넣으면 한 번에 채웁니다."
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50"
                          >
                            <ClipboardPaste size={12} /> 여러 줄 넣기
                          </button>
                        </span>
                      )}
                    </h2>
                  )}
                  <div className="space-y-3">{rendered}</div>
                  {editing && rendered.length === 0 && (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center text-xs text-amber-800">
                      아직 중분류가 없습니다. 위의 <strong className="font-semibold">＋ 중분류</strong> 로 하나 만들거나,{" "}
                      <strong className="font-semibold">여러 줄 넣기</strong> 로 폴더 목록을 붙여넣으세요.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * 올린 서류 카드 — 세로로 긴 서류 모양. 번호와 제목이 가운데 오고, 접힌 모서리가 즐겨찾기다.
 *
 * 윗부분에 양식의 열 구성을 작게 그린 미리보기를 넣어 봤지만, 칸 모양만 보여 줄 뿐 무슨
 * 서류인지 알려 주지 못해 뺐다(사용자 판단: "무의미해 보인다"). 서류를 고르는 데 필요한 건
 * 번호와 제목이다.
 */
function DocCard({
  form,
  code,
  badges,
  active,
  menuOpen,
  onOpen,
  onToggleMenu,
  onToggleFavorite,
  onDelete,
}: {
  form: FormSummary;
  code?: string;
  badges: Badge[];
  active: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        active
          ? "group relative rounded-sm ring-2 ring-blue-500"
          : "group relative rounded-sm ring-1 ring-slate-300 transition hover:ring-slate-400"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        title={form.fileName}
        className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1 bg-slate-50 px-2 text-center transition hover:bg-slate-100"
      >
        <span className="text-[10px] tabular-nums text-slate-400">{code ?? "코드 없음"}</span>
        <span className="line-clamp-4 break-keep text-xs font-medium leading-snug text-slate-700">
          {form.title}
        </span>
        {badges.length > 0 && (
          <span className="flex flex-wrap justify-center gap-1 pt-0.5">
            {badges.map((badge) => (
              <span
                key={badge.label}
                title={badge.title}
                className={
                  badge.tone === "amber"
                    ? "rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
                    : badge.tone === "blue"
                      ? "rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold text-blue-700"
                      : "rounded bg-rose-100 px-1 py-0.5 text-[10px] font-medium text-rose-700"
                }
              >
                {badge.label}
              </span>
            ))}
          </span>
        )}
      </button>

      {/* 접힌 모서리 = 즐겨찾기. 그룹웨어 서식함과 같은 자리에 둔다. */}
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={form.favorite}
        aria-label={`${form.title} 즐겨찾기`}
        title={form.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
        className="absolute right-0 top-0 h-7 w-7"
      >
        <span
          aria-hidden
          className="absolute right-0 top-0 h-0 w-0 border-l-[28px] border-t-[28px] border-l-transparent"
          style={{ borderTopColor: form.favorite ? "#1b3a6b" : "#cbd5e1" }}
        />
        <Star
          size={10}
          aria-hidden
          className="absolute right-0.5 top-0.5 text-white"
          fill={form.favorite ? "currentColor" : "none"}
        />
      </button>

      {/* 지우기는 ⋯ 안에 둔다. 휴지통을 늘 띄워 두면 누르다 지우는 사고가 난다. */}
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label={`${form.title} 메뉴`}
        aria-expanded={menuOpen}
        className={
          menuOpen
            ? "absolute bottom-1.5 right-1.5 z-10 rounded-md bg-white p-1 text-slate-600 shadow-sm ring-1 ring-slate-200"
            : "absolute bottom-1.5 right-1.5 z-10 rounded-md bg-white/90 p-1 text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-800 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
        }
      >
        <MoreHorizontal size={13} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-9 right-1.5 z-10 w-28 overflow-hidden rounded-lg bg-white py-1 text-xs shadow-lg ring-1 ring-slate-200"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onDelete}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
          >
            <Trash2 size={13} /> 지우기
          </button>
        </div>
      )}
    </div>
  );
}

/** 아직 안 올린 칸 — 한 줄짜리 행. 누르면 그 칸으로 바로 올린다. */
function EmptyRow({
  item,
  action,
  ownContact,
  onUpload,
}: {
  item: TaxonomyItem;
  action: SlotAction;
  /** 중분류와 담당이 다른 칸이면 그 담당 */
  ownContact?: string;
  onUpload: () => void;
}) {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-slate-100 text-sm">
      <span className="w-9 shrink-0 text-xs tabular-nums text-slate-400">{item.code}</span>
      <span className="min-w-0 flex-1 truncate text-slate-600">
        {item.name}
        {ownContact && (
          <span className="ml-2 text-[11px] text-slate-400" title="이 칸의 담당(중분류 담당과 다름)">
            담당 {ownContact}
          </span>
        )}
      </span>
      {action.none ? (
        <span title={action.title} className="shrink-0 px-1.5 text-xs text-slate-300">
          {action.label}
        </span>
      ) : (
      <button
        type="button"
        onClick={onUpload}
        aria-label={`${item.code} ${item.name} ${action.label}`}
        title={action.title}
        className={
          action.write
            ? "inline-flex shrink-0 items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
            : "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-blue-600 transition hover:bg-blue-50"
        }
      >
        {action.write ? <FilePenLine size={12} aria-hidden /> : <Upload size={12} aria-hidden />} {action.label}
      </button>
      )}
    </div>
  );
}
