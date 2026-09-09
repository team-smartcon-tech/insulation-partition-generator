/**
 * 파싱한 엑셀 시트를 원본 모양 그대로 표로 그린다.
 *
 * 값을 항목 리스트로 재배치하지 않고 격자를 그대로 <table> 로 옮긴다.
 * 병합은 colSpan/rowSpan, 열 너비는 <colgroup>, 나머지는 인라인 스타일로 간다 —
 * 셀마다 테두리·글꼴이 달라 Tailwind 클래스로는 표현할 수 없다.
 */
import type { CSSProperties } from "react";
import type { FormBorder, FormCell, FormCellStyle, FormSheet } from "./types";

/** 엑셀 테두리 굵기 → CSS. 굵기만 다르고 색은 셀에서 따로 온다. */
const BORDER_WIDTH: Record<FormBorder["style"], string> = {
  thin: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  dashed: "1px dashed",
  dotted: "1px dotted",
  double: "3px double",
};

const DEFAULT_BORDER_COLOR = "#111827";

/**
 * 한글 글꼴은 PC에 없을 수 있어 같은 계열로 대체한다.
 * 바탕(명조)을 고딕으로 대체하면 공문서 느낌이 크게 달라져 계열을 맞춰 준다.
 */
const FONT_STACKS: Record<string, string> = {
  바탕: '"바탕", Batang, "Batang Che", serif',
  Batang: '"바탕", Batang, "Batang Che", serif',
  궁서: '"궁서", Gungsuh, serif',
  굴림: '"굴림", Gulim, sans-serif',
  Gulim: '"굴림", Gulim, sans-serif',
  돋움: '"돋움", Dotum, sans-serif',
  Dotum: '"돋움", Dotum, sans-serif',
  "맑은 고딕": '"맑은 고딕", "Malgun Gothic", sans-serif',
  "Malgun Gothic": '"맑은 고딕", "Malgun Gothic", sans-serif',
};

function fontStack(fontFamily: string | undefined): string | undefined {
  if (!fontFamily) return undefined;
  return FONT_STACKS[fontFamily] ?? `"${fontFamily}", "맑은 고딕", sans-serif`;
}

function borderCss(border: FormBorder | undefined): string | undefined {
  if (!border) return undefined;
  return `${BORDER_WIDTH[border.style]} ${border.color ?? DEFAULT_BORDER_COLOR}`;
}

function cellCss(style: FormCellStyle): CSSProperties {
  const css: CSSProperties = {
    borderTop: borderCss(style.borders.top),
    borderRight: borderCss(style.borders.right),
    borderBottom: borderCss(style.borders.bottom),
    borderLeft: borderCss(style.borders.left),
    textAlign: style.align,
    verticalAlign: style.valign ?? "middle",
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
    // 엑셀 원본이 pt 라 그대로 pt 로 넘긴다. px 로 환산하면 반올림 오차가 쌓인다.
    fontSize: style.fontSize ? `${style.fontSize}pt` : undefined,
    fontFamily: fontStack(style.fontFamily),
    color: style.color,
    background: style.background,
    // 셀 안 줄바꿈(\n)을 살리면서 칸을 넘치면 접는다.
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: "2px 4px",
  };
  return css;
}

interface FormSheetViewProps {
  sheet: FormSheet;
  /** 자동으로 입력칸이라 판정된 곳을 색으로 표시한다(판정이 맞는지 눈으로 보려고). */
  highlightInputs?: boolean;
}

export default function FormSheetView({ sheet, highlightInputs = false }: FormSheetViewProps) {
  if (sheet.rowCount === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
        이 시트에는 내용이 없습니다.
      </p>
    );
  }

  // 각 행에서 시작하는 칸만 모은다. 병합에 가려진 자리는 파서가 이미 뺐다.
  const rows: FormCell[][] = Array.from({ length: sheet.rowCount }, () => []);
  for (const cell of sheet.cells) rows[cell.row - 1].push(cell);

  return (
    <div className="overflow-x-auto">
      <table
        className="border-collapse bg-white"
        style={{ tableLayout: "fixed", width: sheet.colWidths.reduce((a, b) => a + b, 0) }}
      >
        <colgroup>
          {sheet.colWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} style={{ height: sheet.rowHeights[rowIndex] }}>
              {cells.map((cell) => (
                <td
                  key={cell.key}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  style={{
                    ...cellCss(cell.style),
                    ...(highlightInputs && cell.input
                      ? { background: "#dbeafe", outline: "1px dashed #3b82f6", outlineOffset: -2 }
                      : null),
                  }}
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
