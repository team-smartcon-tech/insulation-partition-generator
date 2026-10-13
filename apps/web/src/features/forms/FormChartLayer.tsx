/**
 * 시트에 얹힌 차트를 그린다(막대·꺾은선, 평면). 값은 엑셀이 차트에 저장해 둔 것(`formCharts.ts`).
 *
 * 엑셀 차트를 똑같이 흉내 내지는 않는다 — 축 눈금 개수·글자 크기는 엑셀 기본값에 가깝게만 맞춘다.
 * 목표는 "차트 자리가 비어 보이지 않고, 막대 높이·순서·범례가 원본과 같다" 까지다.
 */
import type { ReactElement } from "react";
import type { FormChart } from "./types";
import { formatValue } from "./numberFormat";

/** 엑셀 기본 계열 색(Office 테마) — 계열 색을 따로 적지 않은 차트용 */
const PALETTE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

/** 0 부터 시작하는 보기 좋은 눈금 — 최댓값을 1·2·2.5·5·10 단위로 올린다. */
function niceScale(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.2 };
  const rough = max / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  return { top: Math.ceil(max / step) * step, step };
}

/** 눈금 글자 — 엑셀이 세로축에 적은 표시 형식(0.0% 등)을 따른다. */
const label = (n: number, format: string | undefined) =>
  format && !/^general$/i.test(format) ? formatValue(Number(n.toPrecision(12)), format) : String(Number(n.toPrecision(6)));

function ChartSvg({ chart }: { chart: FormChart }) {
  const { width: W, height: H } = chart;
  const series = chart.groups.flatMap((group) => group.series.map((s) => ({ ...s, group })));
  const showLegend = series.length > 1 || series.some((s) => s.name);
  const padTop = chart.title ? 26 : 10;
  const padLeft = (chart.valueTitle ? 22 : 0) + 42;
  const padRight = showLegend ? Math.min(110, W * 0.28) : 12;
  const padBottom = 24;
  const plotW = Math.max(10, W - padLeft - padRight);
  const plotH = Math.max(10, H - padTop - padBottom);
  const n = Math.max(1, chart.categories.length || Math.max(0, ...series.map((s) => s.values.length)));

  // 세로축 최댓값 — 누적 막대는 분류마다 합, 나머지는 가장 큰 값
  let max = 0;
  for (const group of chart.groups) {
    if (group.type === "bar" && group.grouping === "percentStacked") max = Math.max(max, 100);
    else if (group.type === "bar" && group.grouping === "stacked") {
      for (let i = 0; i < n; i++) max = Math.max(max, group.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
    } else for (const s of group.series) for (const v of s.values) if (v !== null) max = Math.max(max, v);
  }
  // 엑셀에서 축 범위·간격을 고정해 두었으면 그대로 쓴다(9.4 재검측율: 0~3%, 1% 간격).
  const bottom = chart.valueMin ?? 0;
  const auto = niceScale((chart.valueMax ?? max) - bottom);
  const top = chart.valueMax ?? bottom + auto.top;
  const step = chart.valueStep ?? auto.step;
  const y = (v: number) => padTop + plotH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * plotH;
  const band = plotW / n;
  const colorOf = (index: number, own?: string) => own ?? PALETTE[index % PALETTE.length];

  let seriesIndex = 0;
  const bars: ReactElement[] = [];
  const lines: ReactElement[] = [];
  for (const group of chart.groups) {
    if (group.type === "bar") {
      const stacked = group.grouping === "stacked" || group.grouping === "percentStacked";
      const barW = stacked ? band * 0.6 : (band * 0.7) / Math.max(1, group.series.length);
      const base = new Array<number>(n).fill(0);
      group.series.forEach((s, k) => {
        const color = colorOf(seriesIndex++, s.color);
        for (let i = 0; i < n; i++) {
          let v = s.values[i] ?? 0;
          if (group.grouping === "percentStacked") {
            const total = group.series.reduce((sum, t) => sum + Math.max(0, t.values[i] ?? 0), 0);
            v = total > 0 ? (Math.max(0, v) / total) * 100 : 0;
          }
          if (!(v > 0)) continue;
          const x = stacked ? padLeft + band * i + (band - barW) / 2 : padLeft + band * i + band * 0.15 + barW * k;
          const from = stacked ? base[i] : 0;
          bars.push(<rect key={`${seriesIndex}-${i}`} x={x} y={y(from + v)} width={barW} height={y(from) - y(from + v)} fill={color} />);
          if (stacked) base[i] += v;
        }
      });
    } else {
      group.series.forEach((s) => {
        const color = colorOf(seriesIndex++, s.color);
        const points = s.values
          .map((v, i) => (v === null ? null : `${padLeft + band * i + band / 2},${y(v)}`))
          .filter(Boolean)
          .join(" ");
        lines.push(<polyline key={`l${seriesIndex}`} points={points} fill="none" stroke={color} strokeWidth={2} />);
      });
    }
  }

  const ticks: number[] = [];
  for (let i = 0; bottom + i * step <= top + step * 0.01 && i < 50; i++) ticks.push(bottom + i * step);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title ?? "차트"}>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="#ffffff" stroke="#d9d9d9" />
      {chart.title && (
        <text x={W / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={700} fill="#404040">
          {chart.title}
        </text>
      )}
      {chart.valueTitle && (
        // 엑셀처럼 한 글자씩 세로로 쌓는다(회전하면 작은 한글이 뭉개졌다).
        <text x={13} y={padTop + plotH / 2 - (chart.valueTitle.length - 1) * 6.5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">
          {[...chart.valueTitle].map((ch, i) => (
            <tspan key={i} x={13} dy={i === 0 ? 0 : 13}>
              {ch}
            </tspan>
          ))}
        </text>
      )}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padLeft} x2={padLeft + plotW} y1={y(v)} y2={y(v)} stroke="#e5e5e5" />
          <text x={padLeft - 5} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#595959">
            {label(v, chart.valueFormat)}
          </text>
        </g>
      ))}
      <line x1={padLeft} x2={padLeft + plotW} y1={y(0)} y2={y(0)} stroke="#bfbfbf" />
      {bars}
      {lines}
      {chart.categories.map((name, i) => (
        <text key={i} x={padLeft + band * i + band / 2} y={padTop + plotH + 16} textAnchor="middle" fontSize={11} fill="#595959">
          {name}
        </text>
      ))}
      {showLegend &&
        series.map((s, i) => (
          <g key={`g${i}`}>
            <rect x={W - padRight + 10} y={padTop + 6 + i * 16} width={9} height={9} fill={colorOf(i, s.color)} />
            <text x={W - padRight + 23} y={padTop + 14 + i * 16} fontSize={10} fill="#404040">
              {s.name}
            </text>
          </g>
        ))}
    </svg>
  );
}

export default function FormChartLayer({ charts }: { charts: FormChart[] }) {
  if (charts.length === 0) return null;
  return (
    <>
      {charts.map((chart, index) => (
        <div key={index} className="pointer-events-none absolute select-none" style={{ left: chart.left, top: chart.top }}>
          <ChartSvg chart={chart} />
        </div>
      ))}
    </>
  );
}
