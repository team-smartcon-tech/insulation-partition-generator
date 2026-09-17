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
function spillableKeys(sheet: FormSheet): Set<string> {
  // 글자가 있는 칸이 차지하는 자리(행:열)를 모두 표시한다. 병합은 그 범위 전부.
  const filled = new Set<string>();
  for (const cell of sheet.cells) {
    if (cell.text.trim() === "") continue;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (let col = cell.col; col < cell.col + cell.colSpan; col++) filled.add(`${row}:${col}`);
    }
  }

  const keys = new Set<string>();
  for (const cell of sheet.cells) {
    if (cell.style.wrap === true || cell.text.trim() === "") continue;
    const next = cell.col + cell.colSpan;
    // 마지막 열까지 꽉 찼으면 넘길 자리가 없다.
    if (next > sheet.colCount) continue;
    if (!filled.has(`${cell.row}:${next}`)) keys.add(cell.key);
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
  /** 이 시트에서 고친 글자만 담긴다. 셀 키 → 값 */
  values?: FormCellValues;
  onChangeValue?: (cellKey: string, value: string) => void;
  /** 한 칸 고치기를 끝냈을 때. 되돌리기(Ctrl+Z)를 이 단위로 쌓는다. */
  onCommitValue?: (cellKey: string, before: string | undefined, after: string) => void;
  /** 고칠 수 있는 칸에 하늘색을 칠할까. 잠긴 시트에서만 뜻이 있다. */
  tint?: boolean;
  /** 결재 서명 자리 — 파란 점선 테두리로 알린다(`approval.ts` 가 찾는다). */
  signKeys?: Set<string>;
  /** 결재칸에 얹을 것: 서명 자리의 서명 그림·결재자 이름, 날짜 자리의 `09/17` */
  cellMarks?: Map<string, CellMark>;
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
const SheetRow = memo(function SheetRow({
  cells,
  height,
  editable,
  sheetLocked,
  tint,
  values,
  spillable,
  signKeys,
  cellMarks,
  onChangeValue,
  onCommitValue,
}: {
  cells: FormCell[];
  cellMarks: Map<string, CellMark>;
  /** 결재 서명 자리 */
  signKeys: Set<string>;
  height: number | undefined;
  editable: boolean;
  /** 엑셀에서 시트 보호가 걸린 시트인가 — 이때만 "고칠 수 있는 칸"을 칠해 준다. */
  sheetLocked: boolean;
  /** 고칠 수 있는 칸에 하늘색을 칠할까(사용자가 끌 수 있다) */
  tint: boolean;
  /** 옆 칸으로 글자를 넘겨도 되는 칸들의 키 */
  spillable: Set<string>;
  /** 이 줄에서 고친 글자만 담긴다(셀 키 → 값). 줄마다 잘라 넘겨야 메모가 듣는다. */
  values: FormCellValues;
  onChangeValue: (cellKey: string, value: string) => void;
  onCommitValue: (cellKey: string, before: string | undefined, after: string) => void;
}) {
  return (
    <tr style={{ height }}>
      {cells.map((cell) => {
        const canEdit = editable && !cell.locked;
        return (
        <td
          key={cell.key}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
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

              ? { backgroundImage: "linear-gradient(rgba(125, 211, 252, 0.38), rgba(125, 211, 252, 0.38))" }
              : {}),
            // 결재 서명 자리 — 엑셀 테두리를 가리지 않게 안쪽에 점선을 그린다.
            ...(cellMarks.has(cell.key) ? { position: "relative" as const } : {}),
            ...(signKeys.has(cell.key)
              ? {
                  outline: "2px dashed rgba(37, 99, 235, 0.55)",
                  outlineOffset: "-4px",
                  backgroundColor: "rgba(219, 234, 254, 0.35)",
                  position: "relative",
                }
              : {}),
          }}
        >
          <CellMarkLayer mark={cellMarks.get(cell.key)} />
          <FormCellContent
            cell={cell}
            // 엑셀에서 잠긴 칸은 여기서도 못 고친다(시트 보호가 걸린 시트에만 표시가 붙는다).
            editable={canEdit}
            value={values[cell.key]}
            spill={spillable.has(cell.key)}
            onChange={onChangeValue}
            onCommit={onCommitValue}
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
  tint = true,
  signKeys = EMPTY_KEYS,
  cellMarks = EMPTY_MARKS,
  scale = 1,
}: FormSheetViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

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
            <SheetRow
              key={rowIndex}
              cells={cells}
              height={sheet.rowHeights[rowIndex]}
              editable={editable}
              sheetLocked={sheet.locked === true}
              tint={tint}
              values={rowValues[rowIndex] ?? EMPTY_VALUES}
              spillable={spillable}
              signKeys={signKeys}
              cellMarks={cellMarks}
              onChangeValue={handleChange}
              onCommitValue={handleCommit}
            />
          ))}
        </tbody>
      </table>

      {/*
        그림(로고·도장)은 칸 안이 아니라 격자 위에 떠 있다. 클릭이 통과하도록
        pointer-events 를 꺼 둬야 그림에 가린 칸도 눌러서 고칠 수 있다.
      */}
      <FormShapeLayer shapes={sheet.shapes ?? []} />

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
