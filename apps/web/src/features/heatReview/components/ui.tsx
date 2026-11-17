/**
 * 동절기 열원검토 — 화면 공용 조각 (입력 칸·카드·숫자 표기).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 억/만 단위로 줄인 금액 — 타일·막대 라벨용 */
export function wonShort(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`;
  return v.toLocaleString("ko-KR");
}

export const int = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function dec(n: number, digits = 2): string {
  return n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/**
 * 숫자 입력 칸.
 * 입력 중인 글자("-", "1." 등)를 그대로 두기 위해 문자열을 따로 들고,
 * 숫자로 읽히는 순간마다 바깥에 알린다. 포커스가 없을 때만 바깥 값으로 되돌린다.
 */
export function NumField({
  value,
  onChange,
  unit,
  min,
  step,
  className,
  placeholder,
  align = "right",
  disabled,
}: {
  value: number | null;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);

  return (
    <div
      className={cn(
        "flex h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 transition-colors",
        "focus-within:border-[#0a63b8] focus-within:ring-2 focus-within:ring-[#0a63b8]/15",
        disabled && "bg-slate-50 text-slate-400",
        className,
      )}
    >
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(value == null ? "" : String(value));
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/,/g, "");
          setText(raw);
          if (raw.trim() === "" || raw === "-" || raw === "." || raw === "-.") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(min != null && n < min ? min : n);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const s = step ?? 1;
          const cur = Number(text);
          const base = Number.isFinite(cur) ? cur : 0;
          const next = Math.round((base + (e.key === "ArrowUp" ? s : -s)) * 1e6) / 1e6;
          const clamped = min != null && next < min ? min : next;
          setText(String(clamped));
          onChange(clamped);
        }}
        className={cn(
          "w-full min-w-0 bg-transparent text-[13.5px] font-semibold tabular-nums text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-300",
          align === "right" ? "text-right" : "text-left",
        )}
      />
      {unit && <span className="ml-1.5 shrink-0 text-[11.5px] text-slate-400">{unit}</span>}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13.5px] font-semibold text-slate-800 outline-none transition-colors placeholder:font-normal placeholder:text-slate-300",
        "focus:border-[#0a63b8] focus:ring-2 focus:ring-[#0a63b8]/15",
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-slate-500">{label}</span>
        {hint && <span className="truncate text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Card({
  title,
  desc,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,42,74,0.04),0_8px_24px_-18px_rgba(15,42,74,0.25)]",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold tracking-tight text-slate-800">{title}</h3>
            {desc && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-400">{desc}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg bg-slate-100 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-md font-semibold transition-all",
            size === "sm" ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]",
            value === o.value
              ? "bg-white text-[#0a4f99] shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 판정 배지 — 색만으로 구분하지 않게 글자를 함께 쓴다 */
export function Verdict({ ok, className }: { ok: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-wide",
        ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        className,
      )}
    >
      {ok ? "O.K" : "부족"}
    </span>
  );
}
