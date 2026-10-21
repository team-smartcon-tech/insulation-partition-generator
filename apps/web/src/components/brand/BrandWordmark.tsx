/**
 * 브랜드 로고 — 심볼 + 워드마크(`SMART TOOL BOX.`) + 캡션.
 *
 * 표기 규칙
 *  - 정식 표기는 `SMART TOOL BOX` / `스마트 툴박스` (2026-10 스마트덱에서 개명). **세 단어 모두 굵게는 쓰지 않는다.**
 *    앞 단어(`SMART`)는 얇은 회색으로 눌러 두고 `TOOL BOX` 만 본체로 세운다.
 *  - 심볼은 열린 공구함 — 흰 상자 위로 렌치(흰색)·자(하늘색)가 솟아 가방이 아니라 '공구'로 읽힌다.
 *    파비콘(16px)만 밝은 타일·자 눈금 생략형을 따로 쓴다. (`public/icon.svg` / `public/favicon.svg`)
 *  - 캡션은 `Smart Site Tools`, 홈 배너 제목은 `SMART TOOL BOX`.
 *  - 같은 틀로 안의 도구(Smart FORMS · SF)도 만든다 — 앞 단어·이름·글자·캡션만 바꾼다.
 */
import { useId } from "react";

/** 두 글자 심볼 — 둥근 타일 위에 두 글자를 겹쳐 깊이를 만든다 */
export function BrandMark({
  letters = "SD",
  label = "SMART TOOL BOX",
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

/** 공구함 심볼 — SMART TOOL BOX 전용. `public/icon.svg` 와 같은 도형이다(한쪽을 고치면 같이 고친다) */
export function ToolboxMark({ className = "h-9 w-9" }: { className?: string }) {
  // 한 화면에 심볼이 둘 이상 있어도 그라디언트·마스크 id 가 겹치지 않게 한다.
  const id = `toolbox-mark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="SMART TOOL BOX">
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00335f" />
          <stop offset="1" stopColor="#1478d6" />
        </linearGradient>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c4e8ff" />
          <stop offset="1" stopColor="#6cc2ff" />
        </linearGradient>
        {/* 렌치 머리의 벌어진 입 — 렌치를 기울이기 전 좌표로 판다 */}
        <mask id={`${id}-jaw`} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect x="0" y="0" width="48" height="48" fill="#ffffff" transform="rotate(20 18 22)" />
          <rect x="16" y="2" width="4" height="7.6" rx="0.8" fill="#000000" />
        </mask>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${id}-tile)`} />
      {/* 자 — 공구함 오른쪽 뒤에서 비스듬히 솟는다(하늘색) */}
      <g transform="rotate(16 31 20)">
        <rect x="27.6" y="6.5" width="6.8" height="20" rx="1.6" fill={`url(#${id}-sky)`} />
        <path
          d="M27.6 10.5h3M27.6 13.8h2M27.6 17.1h3M27.6 20.4h2"
          stroke="#0b4d97"
          strokeOpacity="0.7"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
      {/* 렌치 — 왼쪽 뒤에서 반대로 기운다(흰색) */}
      <g transform="rotate(-20 18 22)" mask={`url(#${id}-jaw)`}>
        <rect x="15.8" y="10" width="4.4" height="17" rx="2.2" fill="#ffffff" />
        <circle cx="18" cy="9" r="5.4" fill="#ffffff" />
      </g>
      {/* 공구함 — 테두리 띠 + 아래로 좁아지는 몸통, 가운데 잠금 홈 */}
      <path d="M9.6 26h28.8l-1.7 9.9a3 3 0 0 1-3 2.5H14.3a3 3 0 0 1-3-2.5z" fill="#ffffff" />
      <rect x="8" y="23.2" width="32" height="4.4" rx="2.2" fill="#ffffff" />
      <rect x="20.2" y="30.4" width="7.6" height="2.8" rx="1.4" fill={`url(#${id}-tile)`} />
    </svg>
  );
}

interface BrandWordmarkProps {
  /** 심볼 노출 여부 */
  showMark?: boolean;
  /** 캡션 노출 여부 — 좁은 헤더에서는 끈다 */
  showCaption?: boolean;
  /** 심볼 두 글자 — 주면 글자 심볼, 비우면 공구함 심볼 */
  letters?: string;
  /** 얇게 눌러 두는 앞 단어 (기본 SMART) */
  prefix?: string;
  /** 앞 단어 뒤에 세우는 본체 이름 (기본 TOOL BOX) */
  name?: string;
  /** 아래 작은 캡션 (기본 Smart Site Tools) */
  caption?: string;
  className?: string;
}

export default function BrandWordmark({
  showMark = true,
  showCaption = true,
  letters,
  prefix = "SMART",
  name = "TOOL BOX",
  caption = "Smart Site Tools",
  className,
}: BrandWordmarkProps) {
  const markClass = "h-9 w-9 shrink-0 drop-shadow-[0_3px_8px_rgba(0,71,145,0.35)]";
  return (
    <div className={"flex items-center gap-2.5" + (className ? ` ${className}` : "")}>
      {showMark &&
        (letters ? (
          <BrandMark letters={letters} label={`${prefix} ${name}`} className={markClass} />
        ) : (
          <ToolboxMark className={markClass} />
        ))}
      <div className="flex flex-col leading-none">
        {/*
          한 줄 표기 — 앞 단어는 얇게 눌러 두고 본체 이름만 세운다.
          대문자 앞 단어(SMART)는 본체와 같은 Archivo 가족의 Light 로 맞추고 사이를 조금 더 띄운다.
        */}
        <span className="flex items-baseline gap-[3px]">
          {prefix === prefix.toUpperCase() ? (
            <span
              className="mr-[4px] text-[21px] font-light tracking-[0.02em] text-slate-500"
              style={{ fontFamily: "'Archivo', 'SUIT Variable', sans-serif" }}
            >
              {prefix}
            </span>
          ) : (
            <span className="text-[19px] font-medium tracking-[-0.02em] text-slate-400">{prefix}</span>
          )}
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
          /*
           * 한글 부제는 라틴 글자용 설정(8.5px · 자간 0.26em)으로 두면 너무 작고 자간이 벌어져
           * 읽기 힘들다. 한글이 섞이면 조금 키우고 자간을 좁힌다.
           */
          <span
            className={
              "mt-[5px] font-bold text-slate-400 " +
              (/[가-힣]/.test(caption)
                ? "text-[10px] tracking-[0.06em]"
                : "text-[8.5px] uppercase tracking-[0.26em]")
            }
          >
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
