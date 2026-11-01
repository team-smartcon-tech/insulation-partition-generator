/**
 * 흐름선(라인 오브 밸런스) 차트 — 가로 작업일, 세로 누적 구간. 공종마다 구간별 (착수, j) → (완료, j+1) 을 이은 꺾은선
 * (엔진 zones). 느린 공종은 선이 눕고, 그 뒤 공종은 앞 공종을 기다리는 동안 가로로 멈춘다(계단). 모두 택트 페이스면 평행 직선.
 * 색은 단계 순서대로 고정 8색(dataviz 기본 범주 팔레트, 순서 고정·순환 없음 — 9번째 단계부터 회색).
 * 같은 단계의 둘째 공종부터는 같은 색 점선(선이 겹치므로), 3px 위로 비켜 둘 다 보이게. 범례는 늘 표시, 선에 마우스를 올리면 공종·구간 정보.
 */
import { useState } from "react";
import type { TaktResult, TaktTrade } from "@ipg/gantt-engine";

const STAGE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#8a8a86";
const DASHES = ["", "6 4", "2 3", "10 3 2 3"];

/** 소수 한 자리까지 (병목으로 택트가 소수가 될 때) */
const r1 = (n: number) => Math.round(n * 10) / 10;

const W = 960;
const H = 320;
const PAD = { l: 44, r: 16, t: 26, b: 32 };
/** 같은 단계 둘째 공종부터 선을 이만큼(px) 위로 비켜 그린다 — 완전히 겹치면 점선이 안 보인다 */
const NUDGE = 3;

/** 눈금 간격: 1·2·5 × 10^n 중 눈금이 maxTicks 개 이하가 되는 가장 작은 값 */
function niceStep(max: number, maxTicks: number) {
  const raw = max / maxTicks;
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

export type FlowLine = { name: string; color: string; dash: string; offset: number; stage: number; /** 같은 단계 몇 번째(0부터) */ nth: number };

/** 공종 → 선 모양 (색 = 단계 순번, 같은 단계 둘째부터 점선) */
export function flowLines(trades: TaktTrade[], result: TaktResult): FlowLine[] {
  const stageIdx = new Map(result.stages.map((s, i) => [s.stage, i]));
  const seen = new Map<number, number>();
  return trades.map((t, i) => {
    const k = stageIdx.get(t.stage) ?? 0;
    const nth = seen.get(t.stage) ?? 0;
    seen.set(t.stage, nth + 1);
    return { name: t.name, color: STAGE_COLORS[k] ?? OTHER, dash: DASHES[nth % DASHES.length], offset: result.trades[i].offset, stage: t.stage, nth };
  });
}

export default function FlowChart({ trades, result }: { trades: TaktTrade[]; result: TaktResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = flowLines(trades, result);
  const Z = result.totalZones;
  const maxX = result.totalDays;
  const x = (d: number) => PAD.l + (d / maxX) * (W - PAD.l - PAD.r);
  const y = (z: number) => H - PAD.b - (z / Z) * (H - PAD.t - PAD.b);
  const xStep = niceStep(maxX, 10);
  const yStep = Math.max(1, niceStep(Z, 8));
  const xTicks = Array.from({ length: Math.floor(maxX / xStep) + 1 }, (_, i) => i * xStep);
  const yTicks = Array.from({ length: Math.floor(Z / yStep) + 1 }, (_, i) => i * yStep);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">흐름선 (누적 구간 × 작업일)</h3>
        <p className="text-xs text-muted-foreground">
          평행하면 유휴 없이 같은 속도로 흐릅니다. 누운 선 = 택트보다 느린 공종, 가로로 멈춘 계단 = 앞 공종을 기다리는 날. 같은 단계 공종은 점선.
        </p>
      </div>
      {/* 범례 — 늘 표시. 글자는 본문색, 색은 옆 선이 맡는다 */}
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {lines.map((l, i) => (
          <li
            key={i}
            className="inline-flex cursor-default items-center gap-1.5"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} strokeLinecap="round" />
            </svg>
            <span className={hover === i ? "text-foreground" : undefined}>
              {l.stage}단계 {l.name}
            </span>
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="공종별 흐름선 차트">
        {/* 격자·축 — 눈에 띄지 않게 */}
        {yTicks.map((z) => (
          <g key={`y${z}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(z)} y2={y(z)} stroke="currentColor" className="text-border" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(z)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground" fontSize="11">
              {z}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={`x${d}`} x={x(d)} y={H - PAD.b + 16} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
            {d}
          </text>
        ))}
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-muted-foreground" fontSize="11">
          작업일
        </text>
        <text x={4} y={12} className="fill-muted-foreground" fontSize="11">
          구간
        </text>

        {lines.map((l, i) => {
          const t = result.trades[i];
          const dim = hover != null && hover !== i;
          const dy = -l.nth * NUDGE;
          // 구간마다 (착수, j) → (완료, j+1). 다음 착수가 늦으면 그 사이 가로선 = 기다림
          const pts = t.zones.flatMap((z, j) => [`${x(z.start)},${y(j) + dy}`, `${x(z.finish)},${y(j + 1) + dy}`]).join(" ");
          const end = t.zones.at(-1)?.finish ?? t.offset;
          const tip =
            `${l.stage}단계 ${l.name} · ${t.crew}명 · 구간당 ${r1(t.pace)}일 · 착수 ${r1(t.offset)}일 → 마지막 구간 완료 ${r1(end)}일` +
            (t.waitIdle > 1e-6 ? ` · 앞 공종 기다림 ${r1(t.waitIdle)}일` : "");
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <polyline
                points={pts}
                fill="none"
                stroke={l.color}
                strokeWidth={hover === i ? 3 : 2}
                strokeDasharray={l.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={dim ? 0.25 : 1}
              />
              {/* 마우스 받는 넓은 선 (보이지 않음) */}
              <polyline points={pts} fill="none" stroke="transparent" strokeWidth="12">
                <title>{tip}</title>
              </polyline>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
