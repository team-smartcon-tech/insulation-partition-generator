/**
 * 파싱한 엑셀 시트를 원본 모양 그대로 표로 그린다.
 *
 * 값을 항목 리스트로 재배치하지 않고 격자를 그대로 <table> 로 옮긴다.
 * 병합은 colSpan/rowSpan, 열 너비는 <colgroup>, 나머지는 인라인 스타일로 간다 —
 * 셀마다 테두리·글꼴이 달라 Tailwind 클래스로는 표현할 수 없다.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import FormCellContent from "./FormCellContent";
import type { FormBorder, FormCell, FormCellStyle, FormSheet, FormValues } from "./types";

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

function cellCss(style: FormCellStyle, align: FormCellStyle["align"]): CSSProperties {
  return {
    borderTop: borderCss(style.borders.top),
    borderRight: borderCss(style.borders.right),
    borderBottom: borderCss(style.borders.bottom),
    borderLeft: borderCss(style.borders.left),
    textAlign: align,
    verticalAlign: style.valign ?? "middle",
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
    // 엑셀 원본이 pt 라 그대로 pt 로 넘긴다. px 로 환산하면 반올림 오차가 쌓인다.
    fontSize: style.fontSize ? `${style.fontSize}pt` : undefined,
    fontFamily: fontStack(style.fontFamily),
    color: style.color,
    background: style.background,
    // 엑셀의 "자동 줄바꿈" 설정을 그대로 따른다. 끄여 있는 칸까지 접으면
    // 한 줄로 적힌 항목(예: "소속: … 직급: … 성명: … (서명 또는 날인)")이 쪼개진다.
    // 접지 않는 칸이 넘칠 때는 FormCellContent 가 글자를 줄여 맞춘다.
    whiteSpace: style.wrap ? "pre-wrap" : "pre",
    // 한글은 어절 단위로 끊어야 한다. break-word 만 쓰면 "특기사항"이 "특기사"+"항"으로 쪼개진다.
    wordBreak: "keep-all",
    overflowWrap: "break-word",
    // 칸이 좁아 글자가 접히는 것을 막으려고 여백을 최소로 둔다.
    padding: "1px 2px",
  };
}

/**
 * 첫 열은 구분 제목(①②③…)이 들어가는 자리다. 엑셀 원본은 가로 정렬을 지정하지 않아
 * 왼쪽에 붙는데, 제목이 줄바꿈되면 들쭉날쭉해 보인다. 원본에 지정이 없을 때만 가운데로
 * 맞춘다 — 엑셀이 명시한 정렬은 그대로 따른다.
 */
function effectiveAlign(cell: FormCell): FormCellStyle["align"] {
  if (cell.style.align) return cell.style.align;
  return cell.col === 1 ? "center" : undefined;
}

/** 화면 배율. "fit" 이면 표 전체가 가로로 들어가도록 자동 계산한다. */
export type FormScale = number | "fit";

interface FormSheetViewProps {
  sheet: FormSheet;
  /** true 면 모든 칸의 글자를 고칠 수 있다. false 는 인쇄·검토용 보기. */
  editable?: boolean;
  /** 고친 글자만 담긴다. 셀 키 → 값 */
  values?: FormValues;
  onChangeValue?: (cellKey: string, value: string) => void;
  /** 화면 배율. 엑셀과 브라우저의 글자 폭이 달라 한 배율로는 안 맞을 수 있다. */
  scale?: FormScale;
}

/**
 * 요소의 실제 크기를 따라간다.
 *
 * "가로 맞춤" 배율은 **화면에 남은 폭**을 알아야 계산할 수 있고, 그 폭은 창 크기·
 * 사이드바에 따라 바뀐다. 한 번 재고 마는 대신 계속 따라간다.
 */
function useElementSize(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return size;
}

export default function FormSheetView({
  sheet,
  editable = false,
  values = {},
  onChangeValue,
  scale = 1,
}: FormSheetViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const totalWidth = sheet.colWidths.reduce((a, b) => a + b, 0);
  // 남은 폭(가로 맞춤 계산용)과 표의 실제 높이(배율 적용 후 자리 확보용).
  const box = useElementSize(boxRef, []);
  const table = useElementSize(tableRef, [sheet, editable]);

  // 가로 맞춤은 줄이기만 한다. 좁은 표를 억지로 늘리면 글자가 뭉개진다.
  const effectiveScale =
    scale === "fit"
      ? box.width > 0 && totalWidth > 0
        ? Math.min(1, box.width / totalWidth)
        : 1
      : scale;

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
    // 가로 스크롤 영역이 표의 바깥 테두리를 1px 잘라먹어, 그만큼 안쪽 여백을 준다.
    <div ref={boxRef} className="overflow-x-auto p-0.5">
      {/*
        transform 은 레이아웃 크기를 바꾸지 않는다 — 줄여도 원래 폭만큼 자리를
        차지해 빈 공간이 남고, 키우면 아래 내용을 덮는다. 그래서 바깥 상자에
        배율을 곱한 크기를 직접 준다.
      */}
      <div
        style={
          effectiveScale === 1
            ? undefined
            : { width: totalWidth * effectiveScale, height: table.height * effectiveScale }
        }
      >
      {/* 표와 그림을 함께 담아 한 번에 배율을 건다 — 따로 걸면 그림 자리가 어긋난다. */}
      <div
        ref={tableRef}
        className="relative"
        style={{
          width: totalWidth,
          transform: effectiveScale === 1 ? undefined : `scale(${effectiveScale})`,
          transformOrigin: "top left",
        }}
      >
      <table
        className="border-collapse bg-white"
        style={{ tableLayout: "fixed", width: totalWidth }}
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
                  style={cellCss(cell.style, effectiveAlign(cell))}
                >
                  <FormCellContent
                    cell={cell}
                    editable={editable}
                    value={values[cell.key]}
                    onChange={(value) => onChangeValue?.(cell.key, value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        그림(로고·도장)은 칸 안이 아니라 격자 위에 떠 있다. 클릭이 통과하도록
        pointer-events 를 꺼 둬야 그림에 가린 칸도 눌러서 고칠 수 있다.
      */}
      {(sheet.images ?? []).map((image, index) => (
        <img
          key={index}
          src={image.src}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{
            left: image.left,
            top: image.top,
            width: image.width,
            height: image.height,
          }}
        />
      ))}
      </div>
      </div>
    </div>
  );
}
