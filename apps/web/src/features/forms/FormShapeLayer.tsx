/**
 * 격자 위에 도형(순서도 상자·화살표)을 얹는다.
 *
 * 상자는 HTML `<div>` 로, 선·화살표·윤곽선은 `<svg>` 로 그린다. 상자를 SVG 로 그리면 안에
 * 든 글자를 접는 처리를 직접 해야 하고(SVG `<text>` 는 자동 줄바꿈이 없다), 선을
 * div 로 그리면 대각선과 화살촉을 만들 수 없다. 각자 잘하는 쪽에 맡긴다.
 *
 * **도형은 엑셀에 적힌 순서대로 하나씩 쌓는다.** 뒤에 적힌 것이 위에 온다. 선을 전부 한
 * SVG 에 모아 먼저 그리고 상자를 나중에 얹으면, 회색 배경 띠(구역 표시)가 그 위를 지나는
 * 화살표를 덮어 흐름이 끊겨 보인다.
 */
import { Fragment, useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { FormShape } from "./types";

/** 엑셀 둥근 사각형의 모서리 반경은 짧은 변의 약 16%다. */
const ROUND_RATIO = 0.16;
/** 선이 너무 얇으면 화면에서 사라진다. */
const MIN_LINE_PX = 1;

/** 색을 CSS id 로 쓸 수 있게 다듬는다(`#404040` → `404040`). */
const colorKey = (color: string) => color.replace(/[^a-zA-Z0-9]/g, "");

/** 회전한 도형을 SVG 에서 같은 자리에 돌린다(가운데 축 — CSS 와 기준을 맞춘다). */
function svgRotate(shape: FormShape): string | undefined {
  if (!shape.rotation) return undefined;
  const cx = shape.left + shape.width / 2;
  const cy = shape.top + shape.height / 2;
  return `rotate(${shape.rotation} ${cx} ${cy})`;
}

/** 점선 간격은 선 굵기에 비례해야 굵은 선에서도 점선으로 보인다. */
function dashArray(shape: FormShape): string | undefined {
  const width = Math.max(MIN_LINE_PX, shape.lineWidth);
  if (shape.dash === "dashed") return `${width * 3} ${width * 2}`;
  if (shape.dash === "dotted") return `${width} ${width * 2}`;
  return undefined;
}

/**
 * 네모·타원으로 안 되는 도형의 윤곽선(SVG path).
 *
 * 좌표는 엑셀(DrawingML) 규격의 프리셋 정의를 그대로 옮긴 것이다. 눈대중으로 그리면
 * 원본과 물결 깊이·기울기가 달라져 "비슷한 다른 도형"이 된다.
 */
function outlinePath(shape: FormShape): string | null {
  const { left: x, top: y, width: w, height: h } = shape;

  if (shape.kind === "diamond") {
    return [
      `M ${x + w / 2} ${y}`,
      `L ${x + w} ${y + h / 2}`,
      `L ${x + w / 2} ${y + h}`,
      `L ${x} ${y + h / 2}`,
      "Z",
    ].join(" ");
  }

  if (shape.kind === "document") {
    // flowChartDocument: 21600 격자 기준 y1=17322, y2=20172, y3=23922.
    // 아래변이 3차 베지에 곡선이라 한쪽은 올라가고 한쪽은 내려간다(물결).
    const y1 = y + h * (17322 / 21600);
    const y2 = y + h * (20172 / 21600);
    const y3 = y + h * (23922 / 21600);
    const mid = x + w / 2;
    return [
      `M ${x} ${y}`,
      `L ${x + w} ${y}`,
      `L ${x + w} ${y1}`,
      `C ${mid} ${y1} ${mid} ${y3} ${x} ${y2}`,
      "Z",
    ].join(" ");
  }

  return null;
}

/** 틀 비율(0~1)로 적힌 윤곽선 조각을 화면 좌표의 SVG path 로. 뒤집기도 여기서 건다. */
function framePath(shape: FormShape, segments: NonNullable<FormShape["paths"]>[number]["segments"]): string {
  const { left, top, width: w, height: h, flipH, flipV } = shape;
  return segments
    .map(({ op, points }) => {
      const coords: string[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        const x = flipH ? 1 - points[i] : points[i];
        const y = flipV ? 1 - points[i + 1] : points[i + 1];
        coords.push(`${left + x * w} ${top + y * h}`);
      }
      return `${op} ${coords.join(" ")}`.trim();
    })
    .join(" ");
}

/**
 * 꺾인 연결선의 점들. 틀 안에서 "가로 → 세로 → 가로"를 만들고 뒤집기를 건다.
 * bentConnector3 정의: (0,0) → (w·꺾는자리, 0) → (w·꺾는자리, h) → (w, h)
 * 꺾는 자리가 음수거나 1보다 크면 틀 밖으로 돌아 나간다(되돌아가는 화살표).
 */
function elbowPoints(shape: FormShape): string {
  const { left, top, width: w, height: h, flipH, flipV } = shape;
  const bend = w * (shape.elbow ?? 0.5);
  const frame: [number, number][] = [
    [0, 0],
    [bend, 0],
    [bend, h],
    [w, h],
  ];
  return frame
    .map(([x, y]) => `${left + (flipH ? w - x : x)},${top + (flipV ? h - y : y)}`)
    .join(" ");
}

/** 선의 두 끝점. 엑셀은 사각형 + 뒤집기로 방향을 표현한다. */
function endpoints(shape: FormShape) {
  const { left, top, width, height, flipH, flipV } = shape;
  return {
    x1: flipH ? left + width : left,
    y1: flipV ? top + height : top,
    x2: flipH ? left : left + width,
    y2: flipV ? top : top + height,
  };
}

function boxCss(shape: FormShape, outlined: boolean): CSSProperties {
  const radius =
    shape.kind === "ellipse"
      ? "50%"
      : shape.kind === "roundBox"
        ? Math.min(shape.width, shape.height) * ROUND_RATIO
        : undefined;
  const [padTop, padRight, padBottom, padLeft] = shape.inset ?? [2, 4, 2, 4];
  return {
    position: "absolute",
    left: shape.left,
    top: shape.top,
    width: shape.width,
    height: shape.height,
    background: outlined ? "transparent" : (shape.fill ?? "transparent"),
    border:
      !outlined && shape.line
        ? `${Math.max(MIN_LINE_PX, shape.lineWidth)}px ${shape.dash ?? "solid"} ${shape.line}`
        : undefined,
    borderRadius: radius,
    // 회전은 도형 가운데를 축으로 돈다. 엑셀도 같은 기준이라 자리가 어긋나지 않는다.
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
    display: "flex",
    alignItems:
      shape.valign === "top" ? "flex-start" : shape.valign === "bottom" ? "flex-end" : "center",
    justifyContent:
      shape.align === "left" ? "flex-start" : shape.align === "right" ? "flex-end" : "center",
    padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
    boxSizing: "border-box",
  };
}

/** 도형 글자 크기를 엑셀이 적지 않았을 때(pt) */
const DEFAULT_SHAPE_FONT_PT = 11;

function textCss(shape: FormShape): CSSProperties {
  const vertical = shape.vertical;
  return {
    // 세로 글자는 줄 방향이 바뀌므로 너비 대신 높이를 채운다.
    width: vertical ? undefined : shape.noWrap ? "max-content" : "100%",
    height: vertical ? "100%" : undefined,
    flexShrink: 0,
    // DrawingML 의 기본 정렬은 왼쪽이다(가운데는 엑셀이 algn="ctr" 로 적는다). 가운데로 두면
    // [비고]·[작성방법] 같은 설명 상자가 가운데로 몰렸다(7.6-5·6.3-2).
    textAlign: shape.align ?? "left",
    fontSize: shape.fontSize ? `${shape.fontSize}pt` : undefined,
    fontFamily: shape.fontFamily ? `"${shape.fontFamily}", "맑은 고딕", sans-serif` : undefined,
    fontWeight: shape.bold ? 700 : undefined,
    color: shape.color,
    lineHeight: 1.25,
    whiteSpace: shape.noWrap ? "pre" : "pre-wrap",
    // 한글은 어절 단위로 끊어야 "지식관리"가 "지식관"+"리"로 쪼개지지 않는다.
    wordBreak: "keep-all",
    overflowWrap: "break-word",
    writingMode: vertical ? "vertical-rl" : undefined,
    textOrientation: vertical === "eaVert" ? "upright" : undefined,
    transform: vertical === "vert270" ? "rotate(180deg)" : undefined,
  };
}

/** 선·윤곽선 하나를 그리는 SVG. 도형마다 따로 둬야 도형 순서대로 쌓인다. */
function ShapeSvg({ children }: { children: ReactNode }) {
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      {children}
    </svg>
  );
}

export default function FormShapeLayer({ shapes }: { shapes: FormShape[] }) {
  // 화살촉 정의(marker)는 문서 전체에서 id 로 참조된다. 시트를 바꿔 가며 그려도
  // 서로 충돌하지 않도록 이 컴포넌트만의 접두사를 붙인다.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  if (shapes.length === 0) return null;

  const arrowColors = [
    ...new Set(
      shapes
        .filter((shape) => (shape.kind === "line" || shape.kind === "path") && (shape.arrowStart || shape.arrowEnd))
        .map((shape) => shape.line ?? "#000000"),
    ),
  ];
  const markerOf = (color: string, cap?: "oval" | "diamond") => `url(#${uid}-${cap ?? "arrow"}-${colorKey(color)})`;

  const text = (shape: FormShape, outlined: boolean) =>
    shape.text ? (
      <div style={boxCss(shape, outlined)}>
        <span style={textCss(shape)}>
          {shape.textRuns
            ? shape.textRuns.map((run, index) => (
                <span
                  key={index}
                  style={{
                    // 도형 글자 크기에 대한 비율 — 도형마다 기준 크기가 달라도 조각 사이 비율이 맞는다.
                    fontSize: run.fontSize ? `${run.fontSize / (shape.fontSize ?? DEFAULT_SHAPE_FONT_PT)}em` : undefined,
                    fontWeight: run.bold ? 700 : shape.bold ? 400 : undefined,
                    fontStyle: run.italic ? "italic" : undefined,
                    textDecoration: run.underline ? "underline" : undefined,
                    color: run.color,
                  }}
                >
                  {run.text}
                </span>
              ))
            : shape.text}
        </span>
      </div>
    ) : null;

  return (
    // 도형은 보기용이다. 클릭이 통과해야 도형에 가린 칸도 눌러서 고칠 수 있다.
    <div className="pointer-events-none absolute inset-0">
      {arrowColors.length > 0 && (
        <svg className="absolute h-0 w-0" aria-hidden>
          <defs>
            {arrowColors.map((color) => (
              <marker
                key={color}
                id={`${uid}-arrow-${colorKey(color)}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                // start 쪽에 쓰면 저절로 뒤집힌다 — 화살촉 정의를 두 벌 두지 않아도 된다.
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
            {/* 원형·다이아몬드 끝 — 선 끝점이 모양의 한가운데에 온다(엑셀과 같다). */}
            {arrowColors.map((color) => (
              <marker
                key={`oval-${color}`}
                id={`${uid}-oval-${colorKey(color)}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="4"
                markerHeight="4"
              >
                <circle cx="5" cy="5" r="5" fill={color} />
              </marker>
            ))}
            {arrowColors.map((color) => (
              <marker
                key={`diamond-${color}`}
                id={`${uid}-diamond-${colorKey(color)}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="5"
                markerHeight="5"
              >
                <path d="M 5 0 L 10 5 L 5 10 L 0 5 z" fill={color} />
              </marker>
            ))}
          </defs>
        </svg>
      )}

      {shapes.map((shape, index) => {
        const strokeWidth = Math.max(MIN_LINE_PX, shape.lineWidth);

        if (shape.kind === "line") {
          if (!shape.line) return null;
          const color = shape.line;
          const common = {
            stroke: color,
            strokeWidth,
            strokeDasharray: dashArray(shape),
            markerStart: shape.arrowStart ? markerOf(color, shape.startCap) : undefined,
            markerEnd: shape.arrowEnd ? markerOf(color, shape.endCap) : undefined,
            transform: svgRotate(shape),
          };
          return (
            <ShapeSvg key={index}>
              {shape.elbow !== undefined ? (
                <polyline points={elbowPoints(shape)} fill="none" strokeLinejoin="round" {...common} />
              ) : (
                <line {...endpoints(shape)} {...common} />
              )}
            </ShapeSvg>
          );
        }

        if (shape.kind === "path" && shape.paths) {
          const color = shape.line;
          return (
            <Fragment key={index}>
            <ShapeSvg>
              {shape.paths.map((path, pathIndex) => (
                <path
                  key={pathIndex}
                  d={framePath(shape, path.segments)}
                  fill={path.fill ? (shape.fill ?? "none") : "none"}
                  stroke={path.stroke ? (color ?? "none") : "none"}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dashArray(shape)}
                  strokeLinejoin="round"
                  markerStart={color && shape.arrowStart ? markerOf(color, shape.startCap) : undefined}
                  markerEnd={color && shape.arrowEnd ? markerOf(color, shape.endCap) : undefined}
                  transform={svgRotate(shape)}
                />
              ))}
            </ShapeSvg>
            {text(shape, true)}
            </Fragment>
          );
        }

        const outline = outlinePath(shape);
        if (outline) {
          return (
            <Fragment key={index}>
            <ShapeSvg>
              <path
                d={outline}
                fill={shape.fill ?? "none"}
                stroke={shape.line ?? "none"}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray(shape)}
                strokeLinejoin="round"
                transform={svgRotate(shape)}
              />
            </ShapeSvg>
            {text(shape, true)}
            </Fragment>
          );
        }

        return (
          <div key={index} style={boxCss(shape, false)}>
            {shape.text && <span style={textCss(shape)}>{shape.text}</span>}
          </div>
        );
      })}
    </div>
  );
}
