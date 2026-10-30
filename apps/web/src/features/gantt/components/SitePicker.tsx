/**
 * 현장 선택 (상단 PROJECT) — 검색되는 드롭다운. 기본 <select> 는 현장이 많아 찾기 어려웠다 (2026-10-30).
 * - 대소문자 무시, 띄어쓰기로 나눈 조각이 모두 들어 있으면 ("남원주 1"), 초성 검색("ㅎㅅㄴㅇ" → 화성남양)
 * - ↑↓ 로 고르고 Enter 선택, Esc·바깥 클릭으로 닫기
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Site } from "@ipg/gantt-engine";
import { cn } from "@/lib/utils";

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
/** 한글 음절 → 초성, 그 외 글자는 그대로 */
const choseong = (s: string) =>
  [...s].map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }).join("");
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const isChoseongQuery = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

const subLabel = (s: Site) => (s.lastReportDate ? `최근 ${s.lastReportDate.slice(5)}` : "일보 없음");

export default function SitePicker({
  sites,
  value,
  onChange,
  loading,
  error,
}: {
  sites: Site[];
  value: string | null;
  onChange: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = sites.find((s) => s.id === value) ?? null;

  // 띄어쓰기로 나눈 조각이 모두 이름에 있으면 ("남원주 1" → 남원주역세권 1차). 조각마다 초성도 된다
  const filtered = useMemo(() => {
    const tokens = q.trim().split(/\s+/).map(norm).filter(Boolean);
    if (!tokens.length) return sites;
    return sites.filter((s) => {
      const name = norm(s.name);
      const cho = choseong(name);
      return tokens.every((t) => (isChoseongQuery(t) ? cho.includes(t) : name.includes(t)));
    });
  }, [sites, q]);

  // 열 때: 검색칸 비우고 지금 현장에 맞춰 둔다
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(Math.max(0, sites.findIndex((s) => s.id === value)));
    requestAnimationFrame(() => input.current?.focus());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [q]);

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // 고른 줄이 보이게
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (s: Site | undefined) => {
    if (!s) return;
    onChange(s.id);
    setOpen(false);
  };

  const label = loading ? "현장 불러오는 중…" : error ? "현장 목록을 못 불러옴" : current ? current.name : "현장을 고르세요";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={loading || error}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="현장 선택"
        className="flex h-9 w-[22rem] max-w-[60vw] items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-left text-sm font-semibold text-slate-800 disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">
          {label}
          {current ? <span className="ml-1 font-normal text-slate-500">· {subLabel(current)}</span> : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-slate-500" />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-[24rem] max-w-[90vw] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-200 px-2">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(filtered.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(filtered[active]);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="현장 검색 (초성 가능: ㅎㅅㄴㅇ)"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              aria-label="현장 검색"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{filtered.length}</span>
          </div>
          <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-slate-400">맞는 현장이 없습니다.</li>
            ) : (
              filtered.map((s, i) => (
                <li
                  key={s.id}
                  data-i={i}
                  role="option"
                  aria-selected={s.id === value}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                    i === active ? "bg-primary text-primary-foreground" : "text-slate-800",
                  )}
                >
                  <Check className={cn("size-3.5 shrink-0", s.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className={cn("shrink-0 text-xs", i === active ? "text-primary-foreground/80" : "text-slate-400")}>{subLabel(s)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
