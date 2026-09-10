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
      ? `${Math.max(MIN_LINE_PX, shape.lineWidth)}px solid ${shape.line}`
      : undefined,
    borderRadius: radius,
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

  const lines = shapes.filter((shape) => shape.kind === "line");
  const diamonds = shapes.filter((shape) => shape.kind === "diamond");
  const boxes = shapes.filter((shape) => shape.kind !== "line" && shape.kind !== "diamond");

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
      {(lines.length > 0 || diamonds.length > 0) && (
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

          {diamonds.map((shape, index) => (
            <polygon
              key={`d${index}`}
              points={[
                `${shape.left + shape.width / 2},${shape.top}`,
                `${shape.left + shape.width},${shape.top + shape.height / 2}`,
                `${shape.left + shape.width / 2},${shape.top + shape.height}`,
                `${shape.left},${shape.top + shape.height / 2}`,
              ].join(" ")}
              fill={shape.fill ?? "none"}
              stroke={shape.line ?? "#000000"}
              strokeWidth={Math.max(MIN_LINE_PX, shape.lineWidth)}
            />
          ))}

          {lines.map((shape, index) => {
            const { x1, y1, x2, y2 } = endpoints(shape);
            const color = shape.line ?? "#000000";
            const marker = `url(#${uid}-arrow-${colorKey(color)})`;
            return (
              <line
                key={`l${index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={Math.max(MIN_LINE_PX, shape.lineWidth)}
                markerStart={shape.arrowStart ? marker : undefined}
                markerEnd={shape.arrowEnd ? marker : undefined}
              />
            );
          })}
        </svg>
      )}

      {boxes.map((shape, index) => (
        <div key={`b${index}`} style={boxCss(shape)}>
          {shape.text && <span style={textCss(shape)}>{shape.text}</span>}
        </div>
      ))}

      {/* 마름모는 SVG 로 그렸으니 글자만 그 자리에 얹는다. */}
      {diamonds.map((shape, index) => (
        <div
          key={`dt${index}`}
          style={{ ...boxCss(shape), background: "transparent", border: undefined }}
        >
          {shape.text && <span style={textCss(shape)}>{shape.text}</span>}
        </div>
      ))}
    </div>
  );
}
