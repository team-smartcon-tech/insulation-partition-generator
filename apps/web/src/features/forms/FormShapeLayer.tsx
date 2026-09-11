/**
 * 격자 위에 도형(순서도 상자·화살표)을 얹는다.
 *
 * 상자는 HTML `<div>` 로, 선·화살표는 `<svg>` 로 그린다. 상자를 SVG 로 그리면 안에
 * 든 글자를 접는 처리를 직접 해야 하고(SVG `<text>` 는 자동 줄바꿈이 없다), 선을
 * div 로 그리면 대각선과 화살촉을 만들 수 없다. 각자 잘하는 쪽에 맡긴다.
 */
import { useId } from "react";
import type { CSSProperties } from "react";
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

function boxCss(shape: FormShape): CSSProperties {
  const radius =
    shape.kind === "ellipse"
      ? "50%"
      : shape.kind === "roundBox"
        ? Math.min(shape.width, shape.height) * ROUND_RATIO
        : undefined;
  return {
    position: "absolute",
    left: shape.left,
    top: shape.top,
    width: shape.width,
    height: shape.height,
    background: shape.fill ?? "transparent",
    border: shape.line
      ? `${Math.max(MIN_LINE_PX, shape.lineWidth)}px ${shape.dash ?? "solid"} ${shape.line}`
      : undefined,
    borderRadius: radius,
    // 회전은 도형 가운데를 축으로 돈다. 엑셀도 같은 기준이라 자리가 어긋나지 않는다.
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
    // 도형 안의 글자는 가운데가 기본이다(엑셀도 그렇다).
    display: "flex",
    alignItems: "center",
    justifyContent:
      shape.align === "left" ? "flex-start" : shape.align === "right" ? "flex-end" : "center",
    padding: "2px 4px",
    boxSizing: "border-box",
  };
}

function textCss(shape: FormShape): CSSProperties {
  return {
    width: "100%",
    textAlign: shape.align ?? "center",
    fontSize: shape.fontSize ? `${shape.fontSize}pt` : undefined,
    fontFamily: shape.fontFamily ? `"${shape.fontFamily}", "맑은 고딕", sans-serif` : undefined,
    fontWeight: shape.bold ? 700 : undefined,
    color: shape.color,
    lineHeight: 1.25,
    whiteSpace: "pre-wrap",
    // 한글은 어절 단위로 끊어야 "지식관리"가 "지식관"+"리"로 쪼개지지 않는다.
    wordBreak: "keep-all",
    overflowWrap: "break-word",
  };
}

export default function FormShapeLayer({ shapes }: { shapes: FormShape[] }) {
  // 화살촉 정의(marker)는 문서 전체에서 id 로 참조된다. 시트를 바꿔 가며 그려도
  // 서로 충돌하지 않도록 이 컴포넌트만의 접두사를 붙인다.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  if (shapes.length === 0) return null;

  const lines = shapes.filter((shape) => shape.kind === "line" && shape.line);
  // 네모·타원으로 안 되는 것은 SVG 윤곽선으로 그리고, 글자만 그 위에 얹는다.
  const outlined = shapes.filter((shape) => outlinePath(shape) !== null);
  const boxes = shapes.filter(
    (shape) => shape.kind !== "line" && outlinePath(shape) === null,
  );

  const arrowColors = [
    ...new Set(
      lines
        .filter((line) => line.arrowStart || line.arrowEnd)
        .map((line) => line.line ?? "#000000"),
    ),
  ];

  return (
    // 도형은 보기용이다. 클릭이 통과해야 도형에 가린 칸도 눌러서 고칠 수 있다.
    <div className="pointer-events-none absolute inset-0">
      {(lines.length > 0 || outlined.length > 0) && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
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
          </defs>

          {outlined.map((shape, index) => (
            <path
              key={`o${index}`}
              d={outlinePath(shape) ?? undefined}
              fill={shape.fill ?? "none"}
              stroke={shape.line ?? "none"}
              strokeWidth={Math.max(MIN_LINE_PX, shape.lineWidth)}
              strokeDasharray={dashArray(shape)}
              strokeLinejoin="round"
              transform={svgRotate(shape)}
            />
          ))}

          {lines.map((shape, index) => {
            const { x1, y1, x2, y2 } = endpoints(shape);
            const color = shape.line ?? "#000000";
            const marker = `url(#${uid}-arrow-${colorKey(color)})`;
            return (
              shape.elbow !== undefined ? (
                <polyline
                  key={`l${index}`}
                  points={elbowPoints(shape)}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(MIN_LINE_PX, shape.lineWidth)}
                  strokeDasharray={dashArray(shape)}
                  strokeLinejoin="round"
                  markerStart={shape.arrowStart ? marker : undefined}
                  markerEnd={shape.arrowEnd ? marker : undefined}
                  transform={svgRotate(shape)}
                />
              ) : (
                <line
                  key={`l${index}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={Math.max(MIN_LINE_PX, shape.lineWidth)}
                  strokeDasharray={dashArray(shape)}
                  markerStart={shape.arrowStart ? marker : undefined}
                  markerEnd={shape.arrowEnd ? marker : undefined}
                  transform={svgRotate(shape)}
                />
              )
            );
          })}
        </svg>
      )}

      {boxes.map((shape, index) => (
        <div key={`b${index}`} style={boxCss(shape)}>
          {shape.text && <span style={textCss(shape)}>{shape.text}</span>}
        </div>
      ))}

      {/* 윤곽선은 SVG 로 그렸으니 글자만 그 자리에 얹는다. */}
      {outlined.map((shape, index) =>
        shape.text ? (
          <div
            key={`ot${index}`}
            style={{ ...boxCss(shape), background: "transparent", border: undefined }}
          >
            <span style={textCss(shape)}>{shape.text}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}
