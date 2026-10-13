/**
 * 셀 하나의 내용을 그린다.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, **글자는 어느 칸이든
 * 자유롭게 고칠 수 있게** 한다.
 *
 * 다만 **입력 상자는 지금 고치고 있는 칸에만 만든다.** 편집 중이라고 모든 칸을
 * textarea 로 깔면, 큰 시트(수천 칸)에서 시트를 열 때마다 브라우저가 그만큼의 입력
 * 상자를 만들고 높이를 재느라 몇 초씩 멈춘다. 평소에는 글자만 있는 가벼운 칸으로 두고,
 * 누르거나 Tab 으로 들어온 칸만 입력 상자로 바꾼다 — 보이는 모습은 같다.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { FormCell, FormTextRun } from "./types";

/** 엑셀이 칸 글자 크기를 적지 않았을 때의 크기(pt) — 부분 서식 크기를 칸 크기에 대한 비율로 바꿀 때 쓴다. */
const DEFAULT_FONT_PT = 11;

/**
 * 부분 서식 조각들을 그린다. 크기는 칸 글자 크기에 대한 **비율(em)** 로 준다 — 칸이 넘쳐 글자를
 * 줄일 때(fitToCell) 조각들도 함께 줄어야 한다. 줄 끝 공백은 `displayText` 처럼 걷는다.
 */
function RichRuns({ runs, basePt }: { runs: FormTextRun[]; basePt: number }) {
  return (
    <>
      {runs.map((run, index) => {
        let text = run.text.replace(/[ \t]+\n/g, "\n");
        if (index === runs.length - 1) text = text.replace(/\s+$/, "");
        return (
          <span
            key={index}
            style={{
              fontWeight: run.bold === true ? 700 : run.bold === false ? 400 : undefined,
              fontStyle: run.italic === true ? "italic" : run.italic === false ? "normal" : undefined,
              textDecoration: run.underline ? "underline" : undefined,
              fontSize: run.fontSize ? `${run.fontSize / basePt}em` : undefined,
              color: run.color,
            }}
          >
            {text}
          </span>
        );
      })}
    </>
  );
}

/** 글자를 줄여 맞출 때의 하한. 이보다 작아지면 읽을 수 없어 그냥 넘치게 둔다. */
const MIN_FONT_PX = 7;
/** "축소하여 맞춤" 칸은 엑셀처럼 더 작게도 줄인다 */
const MIN_FREE_FONT_PX = 4;
/** 한 번에 줄이는 폭(px). 작을수록 원본에 가깝지만 재계산이 늘어난다. */
const SHRINK_STEP_PX = 0.5;

/**
 * 엑셀 셀에는 칸을 맞추려고 넣은 공백이 줄 끝에 붙어 있다. 엑셀은 줄 끝 공백을 폭으로
 * 치지 않지만 CSS 는 폭으로 쳐서, 그 공백 때문에 글자가 다음 줄로 밀린다.
 * 줄 끝만 걷어내고 들여쓰기용 앞 공백은 원본대로 남긴다.
 */
export function displayText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/**
 * 줄바꿈을 끈 칸이 가로로 넘치면 글자를 조금씩 줄여 맞춘다(엑셀의 "축소하여 맞춤").
 *
 * 엑셀과 브라우저는 같은 "바탕 11pt" 라도 글자 폭이 미세하게 달라, 원본에서 한 줄에
 * 들어가던 항목이 여기서는 넘칠 수 있다. 넘친 채로 두면 잘리거나 옆 칸을 침범한다.
 *
 * 크기를 지우는 줄(`fontSize = ""`)은 **이미 줄여 놓은 칸에서만** 실행한다. 칸마다
 * 쓰기와 읽기를 번갈아 하면 브라우저가 그때마다 화면 계산을 다시 해(레이아웃 스래싱)
 * 칸 수에 비례해 느려진다. 읽기만 이어지면 계산은 한 번으로 묶인다.
 */
function fitToCell(
  element: HTMLElement | null,
  check: { width: boolean; height: boolean; free?: boolean } = { width: true, height: false },
): void {
  if (!element || (!check.width && !check.height)) return;
  if (element.style.fontSize) element.style.fontSize = "";
  const overflows = () =>
    (check.width && element.scrollWidth > element.clientWidth) ||
    // 세로: 엑셀은 같은 글이 줄 높이 안에 들어가는데(줄 간격이 조금 더 좁다) 여기서는 한 줄이
    // 더 생겨 아랫줄이 잘렸다. 1px 은 반올림 오차로 본다.
    (check.height && element.scrollHeight > element.clientHeight + 1);
  // 넘치지 않으면 원본 크기 그대로 둔다.
  if (!overflows()) return;

  const original = Number.parseFloat(window.getComputedStyle(element).fontSize);
  // 세로로 맞출 때는 원본의 85% 까지만 줄인다 — 많이 넘치는 칸은 엑셀도 잘라 보여 주는 경우라
  // 그대로 잘리게 둔다(70% 까지 줄였더니 7.1-2·8.10-2 칸이 읽을 수 없게 작아졌다).
  // 가로로 맞출 때도 80% 까지만 — 엑셀은 "축소하여 맞춤"이 아니면 줄이지 않고 자른다. 브라우저 글꼴이
  // 조금 넓은 만큼만 메우고 그 너머는 자른다(머리글이 읽을 수 없게 작아졌다, 7.6·8.11·8.12 재점검).
  // "축소하여 맞춤" 칸(free)은 엑셀처럼 끝까지 줄여 다 보인다("ITP-해당코드-공정약호-일련번호", 8.11-4).
  const floor = check.free
    ? MIN_FREE_FONT_PX
    : Math.max(MIN_FONT_PX, original * (check.height ? 0.85 : 0.8));
  let size = original;
  while (overflows() && size > floor) {
    size -= SHRINK_STEP_PX;
    element.style.fontSize = `${size}px`;
  }
}

interface FormCellContentProps {
  cell: FormCell;
  /** false 면 글자만 보여준다(인쇄·검토용). */
  editable: boolean;
  /** 고친 값. 없으면 엑셀 원본 글자를 쓴다. */
  value: string | undefined;
  /**
   * 글자가 이 높이(px)를 넘어도 줄을 늘리지 않는다 — 넘친 만큼은 엑셀처럼 잘린다.
   *
   * 엑셀은 글자가 넘쳐도 줄 높이를 그대로 두는데, 표는 내용에 맞춰 줄을 늘린다. 그러면
   * 칸 테두리로 그린 상자가 아래로 밀리고, 줄 높이로 자리를 잡는 도형(화살표·연결선)과
   * 어긋난다(QA-4.3-2 에서 125px, 사용자 신고). 빈 칸의 자리 잡기용 공백 한 칸도 한 줄
   * 높이(약 22px)를 차지해, 엑셀의 얇은 간격 줄(6~11px)을 모두 22px 로 키웠다.
   * 비어 있으면 줄을 늘려도 된다(사용자가 적은 글은 잘리면 안 된다).
   */
  maxHeight?: number;
  /**
   * 옆 칸이 비어 있어 글자를 넘겨도 되는 칸인가(엑셀과 같은 규칙).
   * 넘길 수 있으면 글자를 줄이지 않는다 — 줄이면 원본보다 훨씬 작아져 읽기 어렵다.
   */
  spill?: boolean;
  /** 넘겨 쓸 수 있는 폭(px, 자기 칸 밖) — 왼쪽·오른쪽. 오른쪽 Infinity 면 끝없이(표 밖 빈 열 위로). */
  spillLeft?: number;
  spillRight?: number;
  /** 엑셀에 적힌 정렬 — 가운데면 칸 가운데를 지키며 양쪽으로, 오른쪽이면 왼쪽으로 넘긴다 */
  spillAlign?: "left" | "center" | "right";
  /** 셀 키를 함께 넘긴다 — 칸마다 새 함수를 만들면 메모가 소용없어진다. */
  onChange: (cellKey: string, value: string) => void;
  /**
   * 한 칸 고치기를 **끝냈을 때**(다른 곳을 누르거나 Tab 으로 나갈 때) 한 번 부른다.
   * 되돌리기(Ctrl+Z)는 글자 한 자씩이 아니라 이 단위로 되돌린다.
   */
  onCommit?: (cellKey: string, before: string | undefined, after: string) => void;
  /** 이 칸에 적던 것을 **들어올 때 값으로** 되돌린다(Ctrl+Z 첫 번째). `undefined` 면 고친 적 없음으로. */
  onRevert?: (cellKey: string, to: string | undefined) => void;
  /** 이 칸에서 되돌릴 것이 없으면 **서류 전체**의 되돌리기·다시하기로 넘긴다. */
  onUndo?: () => void;
  onRedo?: () => void;
}

/** 칸의 빈 곳을 눌렀을 때 그 칸 글자 상자에 보내는 신호 이름 */
export const START_EDIT_EVENT = "form-cell-start-edit";

/** 끝없이 넘길 수 있을 때 잡는 폭(px) — 칸 밖 빈 열 위로 이만큼이면 어떤 글도 다 보인다 */
const OPEN_SPILL_PX = 2000;

/**
 * 넘겨 쓰는 글자 상자의 자리. 이어진 빈 칸까지만 보이고 그 너머(글자 있는 칸)에서 엑셀처럼 자른다.
 * 가운데 정렬은 칸 가운데를 중심으로 양쪽을 똑같이 넓힌 뒤, 넘길 수 없는 쪽만 잘라 낸다.
 */
function spillBox(left: number, right: number, align: "left" | "center" | "right"): CSSProperties {
  const center = align === "center";
  /*
   * 넘친 글자는 누르기를 **통과시킨다** — 엑셀처럼 그 아래 빈 칸을 누르면 빈 칸에 적는다. 막으면
   * 넘친 글자가 덮은 빈 칸은 영영 고칠 수 없었다(QA-4.3-4 분류표 17칸). 제 칸은 칸(td)이 받아서 연다.
   */
  // 넘기는 쪽에 맞춰 글자를 붙인다 — 칸의 정렬(A 열 자동 가운데 등)과 달라도 엑셀이 그리는 쪽을 따른다.
  const pass: CSSProperties = { pointerEvents: "none", textAlign: align };
  if (!center && left === 0 && right === Infinity) return { ...pass, overflow: "visible", position: "relative", zIndex: 1 };
  const r = Number.isFinite(right) ? right : OPEN_SPILL_PX;
  const base: CSSProperties = { ...pass, position: "relative", zIndex: 1, overflow: "hidden" };
  if (!center) return { ...base, marginLeft: -left, width: `calc(100% + ${left + r}px)` };
  const half = Math.max(left, r);
  return {
    ...base,
    marginLeft: -half,
    width: `calc(100% + ${half * 2}px)`,
    clipPath: `inset(0 ${half - r}px 0 ${half - left}px)`,
  };
}

function FormCellContent({
  cell,
  editable,
  value,
  spill = false,
  spillLeft = 0,
  spillRight = 0,
  spillAlign = "left",
  maxHeight,
  onChange,
  onCommit,
  onRevert,
  onUndo,
  onRedo,
}: FormCellContentProps) {
  /** 지금 이 칸을 고치고 있나. 이때만 입력 상자를 만든다. */
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const readonlyRef = useRef<HTMLSpanElement>(null);
  /** 고치기 시작할 때의 값. 되돌리기에 쓴다(없으면 엑셀 원본 글자 그대로였다는 뜻). */
  const startRef = useRef<string | undefined>(undefined);

  // 칸의 빈 곳을 눌렀을 때 표(`FormSheetView`)가 보내는 "고치기 시작" 신호.
  useEffect(() => {
    const element = readonlyRef.current;
    if (!element || !editable || editing) return;
    const start = () => {
      startRef.current = value;
      setEditing(true);
    };
    element.addEventListener(START_EDIT_EVENT, start);
    return () => element.removeEventListener(START_EDIT_EVENT, start);
  }, [editable, editing, value]);
  const text = value ?? displayText(cell.text);
  const wraps = cell.style.wrap === true;

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element) {
      // 스스로 초점을 잡는다. `autoFocus` 만 믿으면, 누른 뒤 브라우저가 초점을 본문으로
      // 되돌리면서 입력 상자가 곧바로 닫혀 **글자를 칠 수 없다**(마우스로 누를 때만 생기는 일).
      element.focus({ preventScroll: true });
      const end = element.value.length;
      element.setSelectionRange(end, end);
    }
    if (!element) {
      // 줄바꿈을 끈 칸은 가로로, 줄 높이가 정해진 칸(원본 글자)은 세로로 넘치면 글자를 줄여 맞춘다.
      fitToCell(readonlyRef.current, {
        width: !wraps && !spill,
        height: maxHeight !== undefined,
        free: cell.style.shrink === true,
      });
      return;
    }
    // 글이 길어지면 칸이 함께 늘어나야 잘리지 않는다. textarea 는 스스로 늘지 않는다.
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    if (!wraps && !spill) fitToCell(element, { width: true, height: false, free: cell.style.shrink === true });

    // 옆으로 넘겨 쓰던 칸은 **누를 때도 글자가 다 보여야 한다.** 칸 너비에 맞추면 긴 줄이
    // 잘려 보여서, 어디를 고치는지 모른 채 지우게 된다. 글자 길이만큼 상자를 넓힌다.
    if (spill) {
      element.style.width = "auto";
      const needed = element.scrollWidth + 2;
      element.style.width = `${Math.max(needed, element.parentElement?.clientWidth ?? 0)}px`;
    }
  }, [text, editing, wraps, spill, maxHeight]);

  if (editable && editing) {
    return (
      <textarea
        ref={ref}
        value={text}
        onChange={(event) => onChange(cell.key, event.target.value)}
        onBlur={(event) => {
          setEditing(false);
          if (event.target.value !== (startRef.current ?? displayText(cell.text))) {
            onCommit?.(cell.key, startRef.current, event.target.value);
          }
        }}
        /*
         * 칸에 글을 치는 중의 Ctrl+Z.
         *
         * 브라우저에 맡기면 **아무 일도 일어나지 않는다.** 입력 상자의 글자를 우리가 들고
         * 있어서(React), 브라우저가 기억하는 되돌리기 기록과 어긋나기 때문이다(사용자 신고).
         * 엑셀처럼 **먼저 이 칸에 적던 것을 통째로 되돌리고**, 더 되돌릴 것이 없으면 서류 전체의
         * 되돌리기로 넘어간다.
         */
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          const key = event.key.toLowerCase();
          if (key !== "z" && key !== "y") return;
          const redo = key === "y" || event.shiftKey;
          event.preventDefault();

          if (!redo && event.currentTarget.value !== (startRef.current ?? displayText(cell.text))) {
            onRevert?.(cell.key, startRef.current);
            return;
          }
          // 이 칸에서 되돌릴 것이 없다 — 입력 상자를 닫고 앞 칸들의 기록으로 넘어간다.
          setEditing(false);
          (redo ? onRedo : onUndo)?.();
        }}
        rows={1}
        spellCheck={false}
        wrap={wraps ? "soft" : "off"}
        className={
          "block w-full resize-none overflow-hidden rounded-sm border-0 bg-blue-50 p-0 outline-none ring-1 ring-blue-400" +
          // 넓힌 상자가 옆 칸을 덮어야 글자가 다 보인다.
          (spill ? " relative z-10" : "")
        }
        style={{
          // 표의 글꼴·크기·정렬·색을 그대로 물려받아야 원본과 같아 보인다.
          font: "inherit",
          color: "inherit",
          textAlign: "inherit",
          lineHeight: "inherit",
          letterSpacing: "inherit",
          whiteSpace: "inherit",
        }}
      />
    );
  }

  // 고치지 않는 동안은 글자만. 편집 가능한 칸은 눌러서(또는 Tab 으로) 들어올 수 있다.
  return (
    <span
      ref={readonlyRef}
      style={{
        // 넘길 수 있는 칸은 옆 칸 위로 글자가 지나가게 둔다(엑셀과 같은 모습).
        ...(spill ? spillBox(spillLeft, spillRight, spillAlign) : {}),
        // 누를 수 있는 자리를 칸 전체로 넓힌다. 글자 높이만큼만 잡으면 줄 높이가 큰 칸에서
        // 아래쪽 빈 곳을 눌러도 아무 일이 없어 "편집이 안 된다"로 보인다.
        ...(editable ? { minHeight: "100%" } : {}),
        ...(maxHeight !== undefined ? { maxHeight } : {}),
      }}
      className={
        (spill ? "block" : "block overflow-hidden") +
        (editable ? " cursor-text rounded-sm hover:bg-blue-50/70 focus:bg-blue-50 focus:outline-none" : "")
      }
      tabIndex={editable ? 0 : undefined}
      role={editable ? "textbox" : undefined}
      onMouseDown={
        editable
          ? (event) => {
              // 브라우저 기본 동작(초점 옮기기)을 막는다. 막지 않으면 이 칸이 입력 상자로
              // 바뀌는 사이에 초점이 본문으로 새어 나가 입력 상자가 바로 닫힌다.
              event.preventDefault();
              startRef.current = value;
              setEditing(true);
            }
          : undefined
      }
      onFocus={
        editable
          ? () => {
              startRef.current = value;
              setEditing(true);
            }
          : undefined
      }
    >
      {/* 빈 칸도 누를 수 있어야 한다 — 글자가 없으면 높이가 0 이 되어 누를 데가 없다. */}
      {value === undefined && cell.runs ? (
        <RichRuns runs={cell.runs} basePt={cell.style.fontSize ?? DEFAULT_FONT_PT} />
      ) : null}
      {value === undefined && cell.runs ? null : text === "" ? " " : text}
    </span>
  );
}

/**
 * 칸은 수천 개다. 한 칸에 글자를 치면 위에서 값이 새로 내려오는데, 메모해 두지 않으면
 * 그때마다 모든 칸이 다시 그려져 타자가 밀린다.
 */
export default memo(FormCellContent);
