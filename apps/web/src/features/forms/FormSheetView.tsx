/**
 * 파싱한 엑셀 시트를 원본 모양 그대로 표로 그린다.
 *
 * 값을 항목 리스트로 재배치하지 않고 격자를 그대로 <table> 로 옮긴다.
 * 병합은 colSpan/rowSpan, 열 너비는 <colgroup>, 나머지는 인라인 스타일로 간다 —
 * 셀마다 테두리·글꼴이 달라 Tailwind 클래스로는 표현할 수 없다.
 */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import FormCellContent from "./FormCellContent";
import FormShapeLayer from "./FormShapeLayer";
import FormChartLayer from "./FormChartLayer";
import { cellRangeOf, type CellRange } from "./sheetMerges";
import type { FormBorder, FormCell, FormCellStyle, FormCellValues, FormSheet } from "./types";

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

/** 고친 글자가 없는 줄에 넘기는 빈 값. 매번 새 객체를 만들면 줄 메모가 듣지 않는다. */
const EMPTY_VALUES: FormCellValues = {};

/**
 * 칸마다 "오른쪽 옆 칸이 비어 있어 글자를 넘겨도 되는가".
 *
 * 엑셀은 줄바꿈을 끈 칸의 글자가 길면 **옆 칸이 비어 있는 동안 그 위로 넘겨서** 보여 준다.
 * 우리는 칸 안에 가두고 글자를 줄여 맞췄더니, 한 줄짜리 설명문이 7px 까지 작아져 읽을 수
 * 없게 됐다(사용자 신고: "글씨 크기 왜 이래?"). 옆이 비었으면 줄이지 말고 넘긴다.
 */
/**
 * 칸 키 → 넘겨 쓸 수 있는 폭(px, 자기 칸 포함). 오른쪽으로 **이어진 빈 칸까지만** 넘긴다 — 엑셀은 글자가
 * 있는 칸을 만나면 거기서 자른다. 끝까지 보면 각주가 옆 칸 글자("일반문서→")를 덮었다(7.6).
 * 표 오른쪽 끝까지 비어 있으면 끝이 없다(Infinity) — 표 밖 빈 열 위로 넘긴다.
 */
function spillableKeys(sheet: FormSheet): Map<string, number> {
  // 글자가 있는 칸이 차지하는 자리(행:열)를 모두 표시한다. 병합은 그 범위 전부.
  const filled = new Set<string>();
  for (const cell of sheet.cells) {
    if (cell.text.trim() === "") continue;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (let col = cell.col; col < cell.col + cell.colSpan; col++) filled.add(`${row}:${col}`);
    }
  }

  const keys = new Map<string, number>();
  const widthOf = (from: number, count: number) =>
    sheet.colWidths.slice(from - 1, from - 1 + count).reduce((sum, w) => sum + w, 0);
  for (const cell of sheet.cells) {
    if (cell.style.wrap === true || cell.text.trim() === "") continue;
    const next = cell.col + cell.colSpan;
    // 마지막 열에 닿은 칸도 넘긴다 — 엑셀은 표 밖의 빈 열 위로 넘겨 보여 준다. 가두면 두 열짜리
    // 시트의 제목("Ⅰ. 현장 품질방침 및 품질목표")이 7px 까지 줄어 "Ⅰ" 만 보였다(9.4 경영검토).
    if (next <= sheet.colCount && filled.has(`${cell.row}:${next}`)) continue;
    let col = next;
    while (col <= sheet.colCount && !filled.has(`${cell.row}:${col}`)) col += 1;
    keys.set(cell.key, col > sheet.colCount ? Infinity : widthOf(cell.col, col - cell.col));
  }
  return keys;
}

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

/**
 * 들여쓰기 한 단계의 폭(px). 엑셀이 PDF 로 뽑은 QA-4.3-4 와 견줘 잰 값이다(4단계 ≈ 68px —
 * 글자 앞이 아래 표의 왼쪽 선과 맞는다). 명세는 "한 단계 = 공백 3칸"이라 글꼴마다 다르다.
 */
const INDENT_STEP_PX = 17;

/**
 * 대각선 테두리를 배경 그림으로. `to top right` 처럼 모서리를 향한 그라디언트는 50% 선이 정확히
 * 반대쪽 두 모서리를 잇는다 — 칸이 납작해도 꼭짓점끼리 이어진다.
 */
function diagonalImage(borders: FormCellStyle["borders"]): string | undefined {
  const line = (border: NonNullable<FormCellStyle["borders"]["diagonalUp"]>, toward: string) => {
    const half = border.style === "medium" || border.style === "double" ? 1 : border.style === "thick" ? 1.5 : 0.6;
    const color = border.color ?? DEFAULT_BORDER_COLOR;
    return `linear-gradient(${toward}, transparent calc(50% - ${half}px), ${color} calc(50% - ${half}px), ${color} calc(50% + ${half}px), transparent calc(50% + ${half}px))`;
  };
  const images = [
    borders.diagonalDown ? line(borders.diagonalDown, "to top right") : undefined,
    borders.diagonalUp ? line(borders.diagonalUp, "to bottom right") : undefined,
  ].filter(Boolean);
  return images.length > 0 ? images.join(", ") : undefined;
}

function cellCss(style: FormCellStyle, align: FormCellStyle["align"]): CSSProperties {
  const indent = (style.indent ?? 0) * INDENT_STEP_PX;
  const diagonals = diagonalImage(style.borders);
  return {
    ...(diagonals ? { backgroundImage: diagonals } : {}),
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
    backgroundColor: style.background,
    // 엑셀의 "자동 줄바꿈" 설정을 그대로 따른다. 끄여 있는 칸까지 접으면
    // 한 줄로 적힌 항목(예: "소속: … 직급: … 성명: … (서명 또는 날인)")이 쪼개진다.
    // 접지 않는 칸이 넘칠 때는 FormCellContent 가 글자를 줄여 맞춘다.
    whiteSpace: style.wrap ? "pre-wrap" : "pre",
    // 한글은 어절 단위로 끊어야 한다. break-word 만 쓰면 "특기사항"이 "특기사"+"항"으로 쪼개진다.
    wordBreak: "keep-all",
    overflowWrap: "break-word",
    // 칸이 좁아 글자가 접히는 것을 막으려고 여백을 최소로 둔다.
    padding: "1px 2px",
    // 세로 글자. 표 칸에는 회전(transform)이 듣지 않아 쓰기 방향으로 돌린다.
    ...(style.textDirection === "up"
      ? { writingMode: "sideways-lr" as const }
      : style.textDirection === "down"
        ? { writingMode: "sideways-rl" as const }
        : style.textDirection === "stacked"
          ? { writingMode: "vertical-rl" as const, textOrientation: "upright" as const }
          : {}),
    // 들여쓰기는 정렬한 쪽에 준다(가운데 정렬에는 엑셀도 쓰지 않는다).
    ...(indent > 0 && align !== "center"
      ? align === "right"
        ? { paddingRight: 2 + indent }
        : { paddingLeft: 2 + indent }
      : {}),
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

/**
 * 줄 왼쪽 끝에 붙는 단추 — 마우스를 올린 줄에만 나타난다.
 *
 * 표 중간에 줄이 한 줄 더 필요할 때 쓴다. 단추를 늘 보이게 두면 표가 어수선해지고, 메뉴에 넣으면
 * 못 찾는다(사용자와 정한 방식).
 */
export interface RowActions {
  /** 이 줄 **앞에** 빈 줄을 넣는다 */
  onInsert: (displayRow: number) => void;
  /** 끼워 넣은 줄인가 — 그때만 뺄 수 있다(원본 줄은 못 뺀다) */
  isInserted: (displayRow: number) => boolean;
  onRemove: (displayRow: number) => void;
}

/** 두 범위를 함께 감싸는 범위 — 합친 칸을 스치면 그 칸 전체가 들어와야 한다(엑셀과 같다). */
const union = (a: CellRange, b: CellRange): CellRange => ({
  top: Math.min(a.top, b.top),
  left: Math.min(a.left, b.left),
  bottom: Math.max(a.bottom, b.bottom),
  right: Math.max(a.right, b.right),
});

/**
 * 끌어서 범위를 고르는 동안 **글자 고치기를 접는다.**
 *
 * 칸을 누르면 그 칸이 입력 상자로 바뀐다(`FormCellContent`). 누른 채로 옆 칸까지 끌면
 * 범위를 고르려는 뜻이므로, 열린 입력 상자에서 초점을 빼 원래 모습으로 돌린다.
 * 초점을 빼면 그 칸의 `onBlur` 가 돌아 적던 글자도 제대로 저장된다.
 */
function dropEditing(): void {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) active.blur();
}

/** 이 줄이 고른 범위에 드는가 */
const inSelection = (range: CellRange | null | undefined, displayRow: number) =>
  !!range && displayRow >= range.top && displayRow <= range.bottom;

interface FormSheetViewProps {
  sheet: FormSheet;
  /** true 면 모든 칸의 글자를 고칠 수 있다. false 는 인쇄·검토용 보기. */
  editable?: boolean;
  /** 이 시트에서 고친 글자만 담긴다. 셀 키 → 값 */
  values?: FormCellValues;
  onChangeValue?: (cellKey: string, value: string) => void;
  /** 한 칸 고치기를 끝냈을 때. 되돌리기(Ctrl+Z)를 이 단위로 쌓는다. */
  onCommitValue?: (cellKey: string, before: string | undefined, after: string) => void;
  /**
   * 칸에 글을 치는 중에 Ctrl+Z 를 눌렀을 때 — 그 칸에 적던 것을 **들어올 때 값으로** 되돌린다.
   * 입력 상자의 글자를 우리가 들고 있어서 브라우저의 되돌리기가 듣지 않는다(사용자 신고).
   */
  onRevertValue?: (cellKey: string, to: string | undefined) => void;
  /** 그 칸에서 되돌릴 것이 없을 때 서류 전체의 되돌리기·다시하기 */
  onUndo?: () => void;
  onRedo?: () => void;
  /** 고칠 수 있는 칸에 하늘색을 칠할까. 잠긴 시트에서만 뜻이 있다. */
  tint?: boolean;
  /** 결재 서명 자리 — 파란 점선 테두리로 알린다(`approval.ts` 가 찾는다). */
  signKeys?: Set<string>;
  /** 결재칸에 얹을 것: 서명 자리의 서명 그림·결재자 이름, 날짜 자리의 `09/17` */
  cellMarks?: Map<string, CellMark>;
  /** 화면 배율. 엑셀과 브라우저의 글자 폭이 달라 한 배율로는 안 맞을 수 있다. */
  scale?: FormScale;
  /** 줄 넣기·빼기 단추(없으면 아예 안 그린다 — 인쇄·점검 화면에는 필요 없다) */
  rowActions?: RowActions;
  /** 지금 고른 범위(칸 합치기용). `onSelect` 를 넘기면 끌어서 고를 수 있다. */
  selection?: CellRange | null;
  onSelect?: (range: CellRange | null) => void;
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

/** 결재칸이 없는 시트 — 줄 메모가 듣도록 늘 같은 빈 묶음을 넘긴다. */
const EMPTY_KEYS: Set<string> = new Set();
const EMPTY_MARKS: Map<string, CellMark> = new Map();

/** 칸 위에 얹는 결재 표시 */
export interface CellMark {
  /** 서명 그림(data URL) — 칸 가운데 */
  image?: string;
  /** 결재자 이름 — 칸 아래쪽에 작게 */
  caption?: string;
  /** 칸 글자를 덮어 보일 글자(날짜 자리의 `/` 대신 `09/17`) */
  text?: string;
}

/**
 * 결재 표시. 칸 글자를 고치는 것을 막지 않도록 누르기는 통과시킨다.
 * 날짜는 원본의 `/` 위에 흰 바탕으로 덮는다 — 엑셀 값은 내려받기 단계에서 바꾼다.
 */
function CellMarkLayer({ mark }: { mark: CellMark | undefined }) {
  if (!mark) return null;
  return (
    <>
      {/* 서명은 이름 줄 위의 남은 자리에 맞춘다(이름과 겹치지 않게). */}
      {mark.image && (
        <span className="pointer-events-none absolute inset-x-1 bottom-[18px] top-1 flex items-center justify-center">
          <img src={mark.image} alt="" className="max-h-full max-w-full object-contain" />
        </span>
      )}
      {/*
        이름 줄 — 위에 가는 선을 그어 서명과 나눈다(사용자 판단: 선이 없으면 서명과 이름이 섞여 보인다).
        화면에만 얹는 선이라 엑셀 양식(합친 칸)은 그대로다.
      */}
      {mark.caption && (
        <span className="pointer-events-none absolute inset-x-1 bottom-0 flex h-[17px] items-center justify-center truncate border-t border-slate-300 text-[11px] font-medium leading-none text-blue-800">
          {mark.caption}
        </span>
      )}
      {mark.text && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white text-[12px] tabular-nums text-slate-800">
          {mark.text}
        </span>
      )}
    </>
  );
}

/**
 * 한 줄. **줄 단위로 메모**해 둔다 — 한 칸에 글자를 치면 시트 전체가 다시 그려지는데,
 * 큰 시트(수천 칸)에서는 그것만으로 타자가 눈에 띄게 밀린다. 값이 바뀐 줄만 다시 그린다.
 */
/** 칸 위아래 여백(1px + 1px)과 테두리 몫 — 글자 상자는 줄 높이에서 이만큼 뺀 높이까지만 쓴다. */
const CELL_CHROME_PX = 3;

/** 칸이 차지하는 줄들의 높이 합에서 여백을 뺀 값. 줄 높이를 모르면 제한하지 않는다. */
function spanHeight(rowHeights: number[], firstRow: number, rowSpan: number): number | undefined {
  let total = 0;
  for (let row = firstRow; row < firstRow + Math.max(1, rowSpan); row += 1) {
    const height = rowHeights[row];
    if (!(height > 0)) return undefined;
    total += height;
  }
  return Math.max(0, total - CELL_CHROME_PX);
}

const SheetRow = memo(function SheetRow({
  cells,
  height,
  rowHeights,
  displayRow,
  rowActions,
  editable,
  sheetLocked,
  tint,
  values,
  spillable,
  signKeys,
  cellMarks,
  onChangeValue,
  onCommitValue,
  onRevertValue,
  onUndo,
  onRedo,
  selLeft,
  selRight,
  onPickCell,
  onSweepCell,
}: {
  cells: FormCell[];
  /**
   * 이 줄에서 고른 범위의 왼쪽·오른쪽 열(고른 게 없거나 이 줄이 아니면 -1).
   *
   * 범위 자체를 넘기면 끌 때마다 객체가 새로 생겨 **모든 줄이 다시 그려진다**(수천 줄에서
   * 끌기가 눈에 띄게 뻑뻑해진다). 숫자로 넘기면 범위에 드나든 줄만 다시 그린다.
   */
  selLeft: number;
  selRight: number;
  /** 칸을 눌렀다(범위 고르기 시작, 또는 Shift 로 늘리기) */
  onPickCell?: (cell: FormCell, shift: boolean) => void;
  /** 누른 채로 이 칸을 스쳤다(범위 늘리기) */
  onSweepCell?: (cell: FormCell) => void;
  /** 화면에서 몇 번째 줄인가(1부터) — 줄 넣기·빼기에 쓴다 */
  displayRow: number;
  rowActions?: RowActions;
  cellMarks: Map<string, CellMark>;
  /** 결재 서명 자리 */
  signKeys: Set<string>;
  height: number | undefined;
  /** 시트 전체 줄 높이(px) — 여러 줄을 합친 칸의 높이를 셀 때 쓴다 */
  rowHeights: number[];
  editable: boolean;
  /** 엑셀에서 시트 보호가 걸린 시트인가 — 이때만 "고칠 수 있는 칸"을 칠해 준다. */
  sheetLocked: boolean;
  /** 고칠 수 있는 칸에 하늘색을 칠할까(사용자가 끌 수 있다) */
  tint: boolean;
  /** 옆 칸으로 글자를 넘겨도 되는 칸들의 키 */
  spillable: Map<string, number>;
  /** 이 줄에서 고친 글자만 담긴다(셀 키 → 값). 줄마다 잘라 넘겨야 메모가 듣는다. */
  values: FormCellValues;
  onChangeValue: (cellKey: string, value: string) => void;
  onCommitValue: (cellKey: string, before: string | undefined, after: string) => void;
  /** 칸에 적던 것을 들어올 때 값으로 되돌린다(Ctrl+Z) */
  onRevertValue?: (cellKey: string, to: string | undefined) => void;
  /** 그 칸에서 되돌릴 것이 없으면 서류 전체 되돌리기로 */
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  return (
    <tr style={{ height }} className={rowActions ? "group/row" : undefined}>
      {cells.map((cell, index) => {
        // 숨긴 열·줄의 칸 — 표 자리만 지키고 테두리·여백·글자는 그리지 않는다.
        if (cell.hidden) {
          return (
            <td
              key={cell.key}
              colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
              rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
              style={{ padding: 0, border: "none", overflow: "hidden", fontSize: 0, lineHeight: 0 }}
            />
          );
        }
        const canEdit = editable && !cell.locked;
        const showActions = rowActions && index === 0;
        const selected =
          selLeft >= 0 && cell.col <= selRight && cell.col + cell.colSpan - 1 >= selLeft;
        return (
        <td
          key={cell.key}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
          onMouseDown={onPickCell ? (event) => {
            if (event.button !== 0) return;
            onPickCell(cell, event.shiftKey);
          } : undefined}
          onMouseEnter={onSweepCell ? () => onSweepCell(cell) : undefined}
          title={
            signKeys.has(cell.key)
              ? "결재 서명 자리로 인식한 칸입니다."
              : editable && cell.locked
                ? "엑셀에서 잠가 둔 칸이라 고칠 수 없습니다(엑셀 원본에 잠금이 걸려 있습니다)."
                : undefined
          }
          style={{
            ...cellCss(cell.style, effectiveAlign(cell)),
            // 잠긴 시트에서 "여기에 적으면 된다"를 한눈에 보이게 연한 하늘색을 덧칠한다.
            // 배경색 대신 덧칠(gradient)이라 엑셀 원본의 칸 색이 그대로 비쳐 보인다.
            //
            // **글자가 없는 칸은 칠하지 않는다.** 양식의 빈 자리는 대부분 줄 간격을 맞추려고
            // 둔 칸이라, 칠하면 화면이 하늘색 띠로 뒤덮여 오히려 어디를 적어야 할지 모른다
            // (사용자 판단). 적는 자리에는 보통 `0000년 00월 00일` 같은 예시 글자가 들어 있다.
            ...(sheetLocked && tint && canEdit && cell.text.trim() !== ""

              ? {
                  backgroundImage: [
                    "linear-gradient(rgba(125, 211, 252, 0.38), rgba(125, 211, 252, 0.38))",
                    // 대각선 테두리가 있으면 덧칠 위에 함께 그린다(덮어쓰면 빗금이 사라진다).
                    diagonalImage(cell.style.borders),
                  ]
                    .filter(Boolean)
                    .join(", "),
                }
              : {}),
            // 결재 서명 자리 — 엑셀 테두리를 가리지 않게 안쪽에 점선을 그린다.
            ...(cellMarks.has(cell.key) || showActions ? { position: "relative" as const } : {}),
            ...(signKeys.has(cell.key)
              ? {
                  outline: "2px dashed rgba(37, 99, 235, 0.55)",
                  outlineOffset: "-4px",
                  backgroundColor: "rgba(219, 234, 254, 0.35)",
                  position: "relative",
                }
              : {}),
            // 고른 범위 — 엑셀처럼 안쪽에 파란 테두리. 파란 덮개는 글자 위에 얹는다(아래 참조).
            ...(selected
              ? { boxShadow: "inset 0 0 0 1px rgba(37, 99, 235, 0.65)", position: "relative" as const }
              : {}),
          }}
        >
          {/* 줄 단추는 첫 칸에 붙여 표 왼쪽 바깥에 띄운다. 줄에 마우스를 올려야 보인다. */}
          {showActions && (
            <span className="pointer-events-none absolute left-0 top-0 z-20 flex h-full -translate-x-full items-center gap-0.5 pr-1 opacity-0 transition group-hover/row:pointer-events-auto group-hover/row:opacity-100">
              <button
                type="button"
                title="이 줄 위에 빈 줄 넣기"
                aria-label={`${displayRow}번째 줄 위에 빈 줄 넣기`}
                onClick={() => rowActions?.onInsert(displayRow)}
                className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-[11px] font-bold leading-none text-white shadow hover:bg-blue-700"
              >
                +
              </button>
              {rowActions?.isInserted(displayRow) && (
                <button
                  type="button"
                  title="끼워 넣은 이 줄 빼기"
                  aria-label={`${displayRow}번째 줄 빼기`}
                  onClick={() => rowActions?.onRemove(displayRow)}
                  className="flex h-4 w-4 items-center justify-center rounded bg-rose-600 text-[11px] font-bold leading-none text-white shadow hover:bg-rose-700"
                >
                  −
                </button>
              )}
            </span>
          )}
          {/*
            고른 범위를 덮는 파란 막 — 칸 배경이 아니라 **글자 위에** 얹는다.
            배경으로 칠하면, 마우스가 놓인 칸은 글자 상자의 옅은 hover 색이 그 위를 덮어
            그 칸만 색이 달라 보인다(실제로 그렇게 보였다). 누르기는 통과시킨다.
          */}
          {selected && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                pointerEvents: "none",
                background: "rgba(37, 99, 235, 0.15)",
              }}
            />
          )}
          <CellMarkLayer mark={cellMarks.get(cell.key)} />
          <FormCellContent
            cell={cell}
            // 엑셀에서 잠긴 칸은 여기서도 못 고친다(시트 보호가 걸린 시트에만 표시가 붙는다).
            editable={canEdit}
            value={values[cell.key]}
            spill={spillable.has(cell.key)}
            spillWidth={spillable.get(cell.key)}
            // 원본 글자만 줄 높이 안에 가둔다. 사용자가 적은 글은 다 보여야 하므로 늘어나게 둔다.
            maxHeight={values[cell.key] === undefined ? spanHeight(rowHeights, displayRow - 1, cell.rowSpan) : undefined}
            onChange={onChangeValue}
            onCommit={onCommitValue}
            onRevert={onRevertValue}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        </td>
        );
      })}
    </tr>
  );
});

export default function FormSheetView({
  sheet,
  editable = false,
  values = {},
  onChangeValue,
  onCommitValue,
  onRevertValue,
  onUndo,
  onRedo,
  tint = true,
  signKeys = EMPTY_KEYS,
  cellMarks = EMPTY_MARKS,
  scale = 1,
  rowActions,
  selection = null,
  onSelect,
}: FormSheetViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  /**
   * 끌어서 범위 고르기 — 시작점(누른 칸이 차지하는 범위)과 "지금 끌고 있나".
   *
   * 상태(useState)로 두면 칸을 스칠 때마다 시트 전체가 다시 그려진다. 끌기는 그림에 쓰이지
   * 않으니 ref 로 들고, 화면에 보이는 것은 고른 범위뿐이다.
   */
  const anchorRef = useRef<CellRange | null>(null);
  const draggingRef = useRef(false);

  const pickCell = useCallback(
    (cell: FormCell, shift: boolean) => {
      if (!onSelect) return;
      const range = cellRangeOf(cell);
      if (shift && anchorRef.current) {
        onSelect(union(anchorRef.current, range));
        return;
      }
      anchorRef.current = range;
      draggingRef.current = true;
      onSelect(range);
      // 단추를 떼면 끌기가 끝난다. 표 밖에서 떼도 알아채야 하니 창에 붙인다.
      window.addEventListener(
        "mouseup",
        () => {
          draggingRef.current = false;
        },
        { once: true },
      );
    },
    [onSelect],
  );

  const sweepCell = useCallback(
    (cell: FormCell) => {
      if (!onSelect || !draggingRef.current || !anchorRef.current) return;
      const range = union(anchorRef.current, cellRangeOf(cell));
      // 시작점 그대로면 아직 한 칸이다 — 글자 고치기를 접지 않는다(그냥 누른 것일 수 있다).
      if (range.top === range.bottom && range.left === range.right) return;
      dropEditing();
      onSelect(range);
    },
    [onSelect],
  );

  const totalWidth = sheet.colWidths.reduce((a, b) => a + b, 0);
  // 남은 폭(가로 맞춤 계산용)과 표의 실제 높이(배율 적용 후 자리 확보용).
  const box = useElementSize(boxRef, []);
  const table = useElementSize(tableRef, [sheet, editable]);

  // 글자를 고칠 때 넘기는 함수가 매번 새로 만들어지면 줄 메모가 듣지 않는다.
  const handleChange = useCallback(
    (cellKey: string, next: string) => onChangeValue?.(cellKey, next),
    [onChangeValue],
  );
  const handleCommit = useCallback(
    (cellKey: string, before: string | undefined, after: string) => onCommitValue?.(cellKey, before, after),
    [onCommitValue],
  );

  // 옆 칸으로 넘겨도 되는 칸은 시트가 바뀔 때만 다시 센다.
  const spillable = useMemo(() => spillableKeys(sheet), [sheet]);

  /**
   * 고친 글자를 줄별로 잘라 둔다. 줄마다 자기 줄의 값만 받아야, 다른 줄에 글자를 쳐도
   * 이 줄은 다시 그리지 않는다(큰 시트에서 타자가 밀리는 주된 원인).
   */
  const rowValues = useMemo(() => {
    const byRow: Record<number, FormCellValues> = {};
    for (const [key, text] of Object.entries(values)) {
      const row = Number(key.split(":")[0]) - 1;
      if (!Number.isFinite(row)) continue;
      (byRow[row] ??= {})[key] = text;
    }
    return byRow;
  }, [values]);

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
    // 줄 단추는 표 **왼쪽 바깥**에 뜬다. 가로 스크롤 상자가 잘라내지 않게 그만큼 자리를 준다.
    <div ref={boxRef} className={"overflow-x-auto p-0.5" + (rowActions ? " pl-7" : "")}>
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
            <SheetRow
              key={rowIndex}
              cells={cells}
              displayRow={rowIndex + 1}
              rowActions={rowActions}
              height={sheet.rowHeights[rowIndex]}
              rowHeights={sheet.rowHeights}
              editable={editable}
              sheetLocked={sheet.locked === true}
              tint={tint}
              values={rowValues[rowIndex] ?? EMPTY_VALUES}
              spillable={spillable}
              signKeys={signKeys}
              cellMarks={cellMarks}
              onChangeValue={handleChange}
              onCommitValue={handleCommit}
              onRevertValue={onRevertValue}
              onUndo={onUndo}
              onRedo={onRedo}
              selLeft={inSelection(selection, rowIndex + 1) ? selection!.left : -1}
              selRight={inSelection(selection, rowIndex + 1) ? selection!.right : -1}
              onPickCell={onSelect ? pickCell : undefined}
              onSweepCell={onSelect ? sweepCell : undefined}
            />
          ))}
        </tbody>
      </table>

      {/*
        그림(로고·도장)은 칸 안이 아니라 격자 위에 떠 있다. 클릭이 통과하도록
        pointer-events 를 꺼 둬야 그림에 가린 칸도 눌러서 고칠 수 있다.
      */}
      <FormShapeLayer shapes={sheet.shapes ?? []} />
      <FormChartLayer charts={sheet.charts ?? []} />

      {(sheet.images ?? []).map((image, index) =>
        image.unsupported ? (
          <div
            key={index}
            title={`${image.unsupported.toUpperCase()} 그림은 브라우저에서 보이지 않습니다. 엑셀에서 열면 보입니다.`}
            className="pointer-events-none absolute flex select-none items-center justify-center border border-dashed border-slate-300 bg-slate-50/70 p-1 text-center text-[11px] leading-tight text-slate-400"
            style={{ left: image.left, top: image.top, width: image.width, height: image.height }}
          >
            엑셀 그림({image.unsupported.toUpperCase()}) — 엑셀에서만 보입니다
          </div>
        ) : (
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
        ),
      )}
      </div>
      </div>
    </div>
  );
}
