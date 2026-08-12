/**
 * SmartPlan 브랜드 로고 — SP 심볼 + 스택형 워드마크(작은 SMART 라벨 + PLAN 본체 + 캡션).
 *
 * 표기 규칙
 *  - 정식 표기는 `SmartPlan` / `스마트플랜`. **전체 대문자 굵게(SMARTPLAN)는 쓰지 않는다.**
 *  - 심볼은 겹침형(S 위에 P를 하늘색으로) — 파비콘(16px)만 솔리드형을 따로 쓴다.
 *    (`public/icon.svg` = 겹침 / `public/favicon.svg` = 솔리드)
 *  - 본사 Smart Works 와의 구분: 본사는 두 단어(Smart Works), 이 도구는 한 단어(SmartPlan) + 캡션.
 */

/** SP 심볼 — 둥근 타일 위에 S와 P를 겹쳐 깊이를 만든다 */
export function SpMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="SmartPlan">
      <defs>
        <linearGradient id="sp-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00335f" />
          <stop offset="1" stopColor="#1478d6" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#sp-mark-gradient)" />
      <text
        x="19"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="25"
        fill="#ffffff"
        fillOpacity="0.92"
        style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
      >
        S
      </text>
      <text
        x="30"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="25"
        fill="#8fd4ff"
        fillOpacity="0.72"
        style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
      >
        P
      </text>
    </svg>
  );
}

interface BrandWordmarkProps {
  /** SP 심볼 노출 여부 */
  showMark?: boolean;
  /** 캡션(Construction Planning) 노출 여부 — 좁은 헤더에서는 끈다 */
  showCaption?: boolean;
  className?: string;
}

export default function BrandWordmark({
  showMark = true,
  showCaption = true,
  className,
}: BrandWordmarkProps) {
  return (
    <div className={"flex items-center gap-2.5" + (className ? ` ${className}` : "")}>
      {showMark && <SpMark className="h-9 w-9 shrink-0 drop-shadow-[0_3px_8px_rgba(0,71,145,0.35)]" />}
      <div className="flex flex-col leading-none">
        {/* 한 줄 표기 — Smart 는 얇게 눌러 두고 PLAN 만 본체로 세운다 */}
        <span className="flex items-baseline gap-[3px]">
          <span className="text-[19px] font-medium tracking-[-0.02em] text-slate-400">Smart</span>
          <span
            className="text-[22px] tracking-[-0.045em] text-slate-900"
            style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
          >
            PLAN
          </span>
          <span
            className="text-[22px] leading-none text-[#1478d6]"
            style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
          >
            .
          </span>
        </span>
        {showCaption && (
          <span className="mt-[5px] text-[8.5px] font-bold uppercase tracking-[0.26em] text-slate-400">
            Construction Planning
          </span>
        )}
      </div>
    </div>
  );
}
