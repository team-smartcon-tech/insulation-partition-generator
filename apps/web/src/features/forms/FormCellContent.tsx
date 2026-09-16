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
import { memo, useLayoutEffect, useRef, useState } from "react";
import type { FormCell } from "./types";

/** 글자를 줄여 맞출 때의 하한. 이보다 작아지면 읽을 수 없어 그냥 넘치게 둔다. */
const MIN_FONT_PX = 7;
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
function fitToCell(element: HTMLElement | null): void {
  if (!element) return;
  if (element.style.fontSize) element.style.fontSize = "";
  // 넘치지 않으면 원본 크기 그대로 둔다.
  if (element.scrollWidth <= element.clientWidth) return;

  let size = Number.parseFloat(window.getComputedStyle(element).fontSize);
  while (element.scrollWidth > element.clientWidth && size > MIN_FONT_PX) {
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
   * 옆 칸이 비어 있어 글자를 넘겨도 되는 칸인가(엑셀과 같은 규칙).
   * 넘길 수 있으면 글자를 줄이지 않는다 — 줄이면 원본보다 훨씬 작아져 읽기 어렵다.
   */
  spill?: boolean;
  /** 셀 키를 함께 넘긴다 — 칸마다 새 함수를 만들면 메모가 소용없어진다. */
  onChange: (cellKey: string, value: string) => void;
  /**
   * 한 칸 고치기를 **끝냈을 때**(다른 곳을 누르거나 Tab 으로 나갈 때) 한 번 부른다.
   * 되돌리기(Ctrl+Z)는 글자 한 자씩이 아니라 이 단위로 되돌린다.
   */
  onCommit?: (cellKey: string, before: string | undefined, after: string) => void;
}

function FormCellContent({ cell, editable, value, spill = false, onChange, onCommit }: FormCellContentProps) {
  /** 지금 이 칸을 고치고 있나. 이때만 입력 상자를 만든다. */
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const readonlyRef = useRef<HTMLSpanElement>(null);
  /** 고치기 시작할 때의 값. 되돌리기에 쓴다(없으면 엑셀 원본 글자 그대로였다는 뜻). */
  const startRef = useRef<string | undefined>(undefined);
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
      if (!wraps && !spill) fitToCell(readonlyRef.current);
      return;
    }
    // 글이 길어지면 칸이 함께 늘어나야 잘리지 않는다. textarea 는 스스로 늘지 않는다.
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    if (!wraps && !spill) fitToCell(element);

    // 옆으로 넘겨 쓰던 칸은 **누를 때도 글자가 다 보여야 한다.** 칸 너비에 맞추면 긴 줄이
    // 잘려 보여서, 어디를 고치는지 모른 채 지우게 된다. 글자 길이만큼 상자를 넓힌다.
    if (spill) {
      element.style.width = "auto";
      const needed = element.scrollWidth + 2;
      element.style.width = `${Math.max(needed, element.parentElement?.clientWidth ?? 0)}px`;
    }
  }, [text, editing, wraps, spill]);

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
        ...(spill ? { overflow: "visible", position: "relative", zIndex: 1 } : {}),
        // 누를 수 있는 자리를 칸 전체로 넓힌다. 글자 높이만큼만 잡으면 줄 높이가 큰 칸에서
        // 아래쪽 빈 곳을 눌러도 아무 일이 없어 "편집이 안 된다"로 보인다.
        ...(editable ? { minHeight: "100%" } : {}),
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
      {text === "" ? " " : text}
    </span>
  );
}

/**
 * 칸은 수천 개다. 한 칸에 글자를 치면 위에서 값이 새로 내려오는데, 메모해 두지 않으면
 * 그때마다 모든 칸이 다시 그려져 타자가 밀린다.
 */
export default memo(FormCellContent);
