/**
 * 스마트 공정표 공용 입력칸 (동 목록 카드에서 쓰던 것을 꺼냄, 2026-10-30) — 설정 폼도 같은 화살표를 쓴다.
 */
import type { InputHTMLAttributes } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

/**
 * 화살표가 달린 입력칸 — 동 목록·현장 설정의 숫자 칸이 모두 같은 화살표를 쓰게 한다.
 * 브라우저 기본 숫자 화살표는 숨기고, 마우스를 올리거나 칸에 들어가면 위·아래 화살표가 보인다. 방향키도 같다.
 * 화살표 자리(오른쪽 여백)는 화살표가 보일 때만 비운다 — 좁은 칸(42px)에서도 평소엔 두 자리 숫자가 다 보이게 (2026-10-30).
 */
export function StepInput({
  onStep,
  className = "",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { onStep: (d: 1 | -1) => void; className?: string }) {
  const btn = "flex h-3.5 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className={`group relative ${className}`}>
      <input
        {...rest}
        className="h-8 w-full rounded-md border border-input bg-card pl-2 pr-1 text-sm tabular-nums group-hover:pr-5 group-focus-within:pr-5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          onStep(e.key === "ArrowUp" ? 1 : -1);
        }}
      />
      <div className="absolute inset-y-0 right-0.5 flex flex-col justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" tabIndex={-1} aria-label="올리기" className={btn} onClick={() => onStep(1)}>
          <ChevronUp className="size-3" />
        </button>
        <button type="button" tabIndex={-1} aria-label="내리기" className={btn} onClick={() => onStep(-1)}>
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** 숫자 칸 — 화살표는 min·max 안에서만 움직인다 */
export function NumInput({
  value,
  onValue,
  min,
  max,
  className,
  ...rest
}: { value: number | null; onValue: (v: number | null) => void; min: number; max?: number; className?: string; placeholder?: string; "aria-label"?: string }) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v));
  return (
    <StepInput
      {...rest}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value ?? ""}
      onChange={(e) => onValue(e.target.value === "" ? null : num(e.target.value, value ?? min))}
      onStep={(d) => onValue(clamp((value ?? min - d) + d))}
    />
  );
}
