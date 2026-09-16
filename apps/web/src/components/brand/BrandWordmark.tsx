/**
 * 스마트 시리즈 브랜드 로고 — 두 글자 심볼 + 워드마크(`Smart DECK.`) + 캡션.
 *
 * 표기 규칙
 *  - 정식 표기는 `SmartDeck` / `스마트덱`. **전체 대문자 굵게(SMARTDECK)는 쓰지 않는다.**
 *    `Smart` 는 얇은 회색으로 눌러 두고 `DECK` 만 본체로 세운다.
 *  - 심볼은 겹침형(첫 글자 위에 둘째 글자를 하늘색으로) — 파비콘(16px)만 솔리드형을 따로 쓴다.
 *    (`public/icon.svg` = 겹침 / `public/favicon.svg` = 솔리드)
 *  - 본사 Smart Works 와의 구분: 본사는 두 단어(Smart Works), 이 도구는 한 단어(SmartDeck) + 캡션.
 *  - 같은 틀로 다른 도구(Smart FORMS · SF)도 만든다 — 글자·이름·캡션만 바꾼다.
 */
import { useId } from "react";

/** 두 글자 심볼 — 둥근 타일 위에 두 글자를 겹쳐 깊이를 만든다 */
export function BrandMark({
  letters = "SD",
  label = "SmartDeck",
  className = "h-9 w-9",
}: {
  letters?: string;
  label?: string;
  className?: string;
}) {
  // 한 화면에 심볼이 둘 이상 있어도 그라디언트 id 가 겹치지 않게 한다.
  const gradientId = `brand-mark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const glyph = {
    fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif",
  } as const;
  const [first = "", second = ""] = letters;

  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00335f" />
          <stop offset="1" stopColor="#1478d6" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${gradientId})`} />
      <text
        x="18"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="25"
        fill="#ffffff"
        fillOpacity="0.92"
        style={glyph}
      >
        {first}
      </text>
      {/* 둘째 글자는 기둥이 두꺼워 그냥 겹치면 뭉친다 → 배경과 같은 그라디언트로 둘레를 그어 틈을 만든다 */}
      <text
        x="31"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="25"
        fill="#8fd4ff"
        fillOpacity="0.72"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.6"
        strokeLinejoin="round"
        style={{ ...glyph, paintOrder: "stroke" }}
      >
        {second}
      </text>
    </svg>
  );
}

/** SD 심볼 — SmartDeck 전용 */
export function SdMark({ className = "h-9 w-9" }: { className?: string }) {
  return <BrandMark letters="SD" label="SmartDeck" className={className} />;
}

interface BrandWordmarkProps {
  /** 심볼 노출 여부 */
  showMark?: boolean;
  /** 캡션 노출 여부 — 좁은 헤더에서는 끈다 */
  showCaption?: boolean;
  /** 심볼 두 글자 (기본 SD) */
  letters?: string;
  /** `Smart` 뒤에 붙는 본체 이름 (기본 DECK) */
  name?: string;
  /** 아래 작은 캡션 (기본 Construction Planning) */
  caption?: string;
  className?: string;
}

export default function BrandWordmark({
  showMark = true,
  showCaption = true,
  letters = "SD",
  name = "DECK",
  caption = "Construction Planning",
  className,
}: BrandWordmarkProps) {
  return (
    <div className={"flex items-center gap-2.5" + (className ? ` ${className}` : "")}>
      {showMark && (
        <BrandMark
          letters={letters}
          label={`Smart ${name}`}
          className="h-9 w-9 shrink-0 drop-shadow-[0_3px_8px_rgba(0,71,145,0.35)]"
        />
      )}
      <div className="flex flex-col leading-none">
        {/* 한 줄 표기 — Smart 는 얇게 눌러 두고 본체 이름만 세운다 */}
        <span className="flex items-baseline gap-[3px]">
          <span className="text-[19px] font-medium tracking-[-0.02em] text-slate-400">Smart</span>
          <span
            className="text-[22px] tracking-[-0.045em] text-slate-900"
            style={{ fontFamily: "'Archivo Black', 'SUIT Variable', sans-serif" }}
          >
            {name}
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
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
