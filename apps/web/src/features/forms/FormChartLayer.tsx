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

/**
 * 0 부터 시작하는 눈금 — 엑셀처럼 **차트 높이**로 눈금 수를 정한다(글자 두 줄 남짓마다 하나).
 * 1·2·5 단위 가운데 그 수 안에 드는 가장 촘촘한 간격을 고른다. 높이를 안 보고 다섯 칸으로만 나눴더니
 * 엑셀이 0~16 을 2 간격으로 그리는 공정 차트가 0·5·10·15 로 성겼다(9.4).
 */
function niceScale(max: number, plotHeight: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.2 };
  const most = Math.max(2, Math.floor(plotHeight / 30));
  const power = 10 ** Math.floor(Math.log10(max / most));
  const step =
    [1, 2, 5, 10, 20, 50].map((m) => m * power).find((s) => Math.ceil(max / s - 1e-9) <= most) ?? 100 * power;
  return { top: Math.ceil(max / step - 1e-9) * step, step };
}

/** 엑셀 차트 글자 크기(px) — 기본 10pt, 제목 18pt */
const TEXT_PX = 13;
const TITLE_PX = 24;
const LEGEND_PX = 12;
const EXCEL_LEGEND_PX = 13.3;

/** 눈금 글자 — 엑셀이 세로축에 적은 표시 형식(0.0% 등)을 따른다. */
const label = (n: number, format: string | undefined) =>
  format && !/^general$/i.test(format) ? formatValue(Number(n.toPrecision(12)), format) : String(Number(n.toPrecision(6)));

function ChartSvg({ chart }: { chart: FormChart }) {
  const { width: W, height: H } = chart;
  const series = chart.groups.flatMap((group) => group.series.map((s) => ({ ...s, group })));
  const legend = chart.legend === undefined ? { pos: "r" as const } : chart.legend;
  // 자리를 정해 둔 범례는 그림 위에 얹고, 아니면 오른쪽(또는 위)에 자리를 비운다.
  const sideLegend = legend && !legend.box && legend.pos === "r";
  const topLegend = legend && !legend.box && legend.pos === "t";
  // 그림 영역은 제목 아래·양옆에 여백을 두고 들인다(엑셀 기본 배치) — 꽉 채웠더니 제목이 맨 위 눈금선에 닿았다.
  const padTop = (chart.title ? TITLE_PX + 26 : 16) + (topLegend ? 18 : 0);
  const padLeft = (chart.valueTitle ? 26 : 0) + 56;
  const padRight = sideLegend ? Math.min(120, W * 0.28) : 28;
  // 가로축 글자를 눕힌 차트는 아래 자리를 더 둔다(9.4 재검사율 45°).
  const padBottom = chart.categoryRotation ? 44 : 26;
  // 3차원 차트는 뒷벽 눈금선을 깊이만큼 비스듬히 올려 그린다(엑셀 3차원 묶은·누적 막대).
  const depth = chart.groups.some((group) => group.threeD) ? 8 : 0;
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
  const auto = niceScale((chart.valueMax ?? max) - bottom, plotH);
  const top = chart.valueMax ?? bottom + auto.top;
  const step = chart.valueStep ?? auto.step;
  const y = (v: number) => padTop + plotH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * plotH;
  const band = plotW / n;
  const colorOf = (index: number, own?: string) => own ?? PALETTE[index % PALETTE.length];

  let seriesIndex = 0;
  const bars: ReactElement[] = [];
  const lines: ReactElement[] = [];
  const labels: ReactElement[] = [];
  const valueText = (v: number, format?: string) =>
    format ? formatValue(Number(v.toPrecision(12)), format) : String(Number(v.toPrecision(6)));
  for (const group of chart.groups) {
    if (group.type === "bar") {
      const stacked = group.grouping === "stacked" || group.grouping === "percentStacked";
      // 막대 너비는 엑셀 "간격 너비"(gapWidth, 막대 너비에 대한 %)로 — 기본 150% 면 막대가 칸의 40%.
      const gap = (group.gapWidth ?? 150) / 100;
      const barW = stacked ? band / (1 + gap) : band / (group.series.length + gap);
      const clusterLeft = (band - barW * group.series.length) / 2;
      const base = new Array<number>(n).fill(0);
      group.series.forEach((s, k) => {
        const color = colorOf(seriesIndex++, s.color);
        for (let i = 0; i < n; i++) {
          let v = s.values[i] ?? 0;
          if (group.grouping === "percentStacked") {
            const total = group.series.reduce((sum, t) => sum + Math.max(0, t.values[i] ?? 0), 0);
            v = total > 0 ? (Math.max(0, v) / total) * 100 : 0;
          }
          if (!(v > 0)) {
            // 3차원 막대는 값이 0 이어도 납작한 판(윗면)이 보인다(9.4 재검사율·NCR).
            if (group.threeD && s.values[i] === 0) {
              const x0 = stacked ? padLeft + band * i + (band - barW) / 2 : padLeft + band * i + clusterLeft + barW * k;
              const base0 = y(stacked ? base[i] : 0);
              const d = Math.min(8, barW * 0.25);
              bars.push(
                <polygon
                  key={`zs${seriesIndex}-${i}`}
                  points={`${x0},${base0} ${x0 + d},${base0 - d} ${x0 + barW + d},${base0 - d} ${x0 + barW},${base0}`}
                  fill={color}
                />,
              );
            }
            // 0 인 값도 엑셀은 "0" 레이블을 바닥에 적는다(9.4 NCR 4월·6~11월).
            if (s.showValues && s.values[i] === 0) {
              const x0 = stacked ? padLeft + band * i + (band - barW) / 2 : padLeft + band * i + clusterLeft + barW * k;
              labels.push(
                <text key={`z${seriesIndex}-${i}`} x={x0 + barW / 2} y={y(stacked ? base[i] : 0) - 4} textAnchor="middle" fontSize={TEXT_PX} fill="#404040">
                  0
                </text>,
              );
            }
            continue;
          }
          const x = stacked ? padLeft + band * i + (band - barW) / 2 : padLeft + band * i + clusterLeft + barW * k;
          const from = stacked ? base[i] : 0;
          const topY = y(from + v);
          const bottomY = y(from);
          bars.push(<rect key={`${seriesIndex}-${i}`} x={x} y={topY} width={barW} height={bottomY - topY} fill={color} />);
          if (group.threeD) {
            // 3차원 막대 — 오른쪽 옆면(어둡게)과 윗면(밝게)을 비스듬히 붙인다(엑셀 3차원 묶은·누적 막대).
            const d = Math.min(8, barW * 0.25);
            bars.push(
              <polygon
                key={`s${seriesIndex}-${i}`}
                points={`${x + barW},${topY} ${x + barW + d},${topY - d} ${x + barW + d},${bottomY - d} ${x + barW},${bottomY}`}
                fill={color}
                style={{ filter: "brightness(0.7)" }}
              />,
              <polygon
                key={`t${seriesIndex}-${i}`}
                points={`${x},${topY} ${x + d},${topY - d} ${x + barW + d},${topY - d} ${x + barW},${topY}`}
                fill={color}
                style={{ filter: "brightness(1.2)" }}
              />,
            );
          }
          if (s.showValues) {
            // 누적 막대는 조각 가운데, 묶은 막대는 막대 위에(엑셀 기본 자리).
            const ly = stacked ? (y(from) + y(from + v)) / 2 + 4 : y(from + v) - 4;
            labels.push(
              <text key={`v${seriesIndex}-${i}`} x={x + barW / 2} y={ly} textAnchor="middle" fontSize={TEXT_PX} fill="#404040">
                {valueText(s.values[i] ?? 0, s.pointFormats?.[i] ?? s.format)}
              </text>,
            );
          }
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
        <text x={W / 2} y={TITLE_PX + 6} textAnchor="middle" fontSize={TITLE_PX} fontWeight={700} fill="#000000">
          {chart.title}
        </text>
      )}
      {chart.valueTitle && (
        // 엑셀처럼 한 글자씩 세로로 쌓는다(회전하면 작은 한글이 뭉개졌다).
        <text x={13} y={padTop + plotH / 2 - (chart.valueTitle.length - 1) * 6.5} textAnchor="middle" fontSize={TEXT_PX} fontWeight={700} fill="#000000">
          {[...chart.valueTitle].map((ch, i) => (
            <tspan key={i} x={13} dy={i === 0 ? 0 : 13}>
              {ch}
            </tspan>
          ))}
        </text>
      )}
      {ticks.map((v) => (
        <g key={v}>
          {depth > 0 && <line x1={padLeft} x2={padLeft + depth} y1={y(v)} y2={y(v) - depth} stroke="#d9d9d9" />}
          <line x1={padLeft + depth} x2={padLeft + plotW + depth} y1={y(v) - depth} y2={y(v) - depth} stroke="#e5e5e5" />
          <text x={padLeft - 6} y={y(v) + 4} textAnchor="end" fontSize={TEXT_PX} fill="#000000">
            {label(v, chart.valueFormat)}
          </text>
        </g>
      ))}
      <line x1={padLeft} x2={padLeft + plotW} y1={y(0)} y2={y(0)} stroke="#bfbfbf" />
      {depth > 0 && (
        // 바닥 — 앞 모서리와 뒷모서리를 잇는 평행사변형
        <polygon
          points={`${padLeft},${y(0)} ${padLeft + depth},${y(0) - depth} ${padLeft + plotW + depth},${y(0) - depth} ${padLeft + plotW},${y(0)}`}
          fill="none"
          stroke="#d9d9d9"
        />
      )}
      {bars}
      {lines}
      {labels}
      {chart.categories.map((name, i) => {
        const cx = padLeft + band * i + band / 2;
        const cy = padTop + plotH + 17;
        return chart.categoryRotation ? (
          <text key={i} x={cx} y={cy - 4} textAnchor="start" fontSize={TEXT_PX} fill="#000000" transform={`rotate(${chart.categoryRotation} ${cx} ${cy - 8})`}>
            {name}
          </text>
        ) : (
          <text key={i} x={cx} y={cy} textAnchor="middle" fontSize={TEXT_PX} fill="#000000">
            {name}
          </text>
        );
      })}
      {legend && <Legend chart={chart} series={series} W={W} H={H} padTop={padTop} padRight={padRight} colorOf={colorOf} />}
    </svg>
  );
}

/**
 * 범례. 엑셀이 상자를 정해 두었으면(manualLayout) 그 안에 가로로 늘어놓고 **넘치는 항목은 뺀다** —
 * 엑셀도 상자에 안 들어가는 항목은 보이지 않는다(9.4 부적합 차트: 세 계열 중 하나만 보임).
 */
function Legend({
  chart,
  series,
  W,
  H,
  padTop,
  padRight,
  colorOf,
}: {
  chart: FormChart;
  series: { name: string; color?: string }[];
  W: number;
  H: number;
  padTop: number;
  padRight: number;
  colorOf: (index: number, own?: string) => string;
}) {
  const legend = chart.legend ?? { pos: "r" as const };
  // 들어가는지는 엑셀 글자 크기(10pt ≈ 13.3px)로 어림한다 — 한글은 글자 크기만큼, 나머지는 그 반 남짓.
  // 앞 표지·간격 20px. 화면 글자(12px)로 재면 엑셀에서 안 들어가는 항목까지 들어갔다.
  const entryWidth = (name: string) =>
    20 +
    [...name.trim()].reduce(
      (sum, ch) => sum + (ch === " " ? 4 : /[ㄱ-힣]/.test(ch) ? EXCEL_LEGEND_PX : EXCEL_LEGEND_PX * 0.55),
      0,
    );
  if (legend.box || legend.pos === "t" || legend.pos === "b") {
    const box = legend.box
      ? { x: legend.box.x * W, y: legend.box.y * H, w: legend.box.w * W, h: legend.box.h * H }
      : { x: 0, y: legend.pos === "t" ? padTop - 22 : H - 20, w: W, h: 20 };
    const shown: { name: string; color: string; x: number }[] = [];
    let used = 0;
    // 엑셀처럼 순서대로 넣다가 안 들어가는 항목에서 멈춘다(뒤 항목을 건너뛰어 넣지 않는다).
    for (const [i, s] of series.entries()) {
      const width = entryWidth(s.name);
      if (used + width > box.w + 2) break;
      shown.push({ name: s.name, color: colorOf(i, s.color), x: used });
      used += width;
    }
    const start = box.x + (box.w - used) / 2;
    const cy = box.y + box.h / 2;
    return (
      <g>
        {shown.map((entry, i) => (
          <g key={i}>
            <rect x={start + entry.x} y={cy - 4.5} width={9} height={9} fill={entry.color} />
            <text x={start + entry.x + 13} y={cy + 4} fontSize={LEGEND_PX} fill="#404040">
              {entry.name}
            </text>
          </g>
        ))}
      </g>
    );
  }
  return (
    <g>
      {series.map((s, i) => (
        <g key={i}>
          <rect x={W - padRight + 10} y={padTop + 6 + i * 16} width={9} height={9} fill={colorOf(i, s.color)} />
          <text x={W - padRight + 23} y={padTop + 14 + i * 16} fontSize={LEGEND_PX} fill="#404040">
            {s.name}
          </text>
        </g>
      ))}
    </g>
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
