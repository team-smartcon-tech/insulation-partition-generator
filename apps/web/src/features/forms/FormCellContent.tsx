/**
 * 셀 하나의 내용을 그린다.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, **글자는 어느 칸이든
 * 자유롭게 고칠 수 있게** 한다. 그래서 편집 중에는 모든 칸이 입력 상자다.
 *
 * 입력 상자는 평소에 보이지 않는다 — 테두리·배경 없이 원본 글자와 똑같이 보이다가
 * 마우스를 올리거나 누를 때만 표시된다. 그래야 "양식을 보는 화면"이 유지된다.
 */
import { useLayoutEffect, useRef } from "react";
import type { FormCell } from "./types";

/**
 * 엑셀 셀에는 칸을 맞추려고 넣은 공백이 줄 끝에 붙어 있다. 엑셀은 줄 끝 공백을 폭으로
 * 치지 않지만 CSS pre-wrap 은 폭으로 쳐서, 그 공백 때문에 글자가 다음 줄로 밀린다.
 * 줄 끝만 걷어내고 들여쓰기용 앞 공백은 원본대로 남긴다.
 */
export function displayText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

interface FormCellContentProps {
  cell: FormCell;
  /** false 면 글자만 보여준다(인쇄·검토용). */
  editable: boolean;
  /** 고친 값. 없으면 엑셀 원본 글자를 쓴다. */
  value: string | undefined;
  onChange: (value: string) => void;
}

export default function FormCellContent({
  cell,
  editable,
  value,
  onChange,
}: FormCellContentProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value ?? displayText(cell.text);

  // 글이 길어지면 칸이 함께 늘어나야 잘리지 않는다. textarea 는 스스로 늘지 않는다.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text, editable]);

  if (!editable) return <>{text}</>;

  return (
    <textarea
      ref={ref}
      value={text}
      onChange={(event) => onChange(event.target.value)}
      rows={1}
      spellCheck={false}
      className="block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 outline-none transition-colors hover:bg-blue-50/70 focus:bg-blue-50 focus:ring-1 focus:ring-blue-400"
      style={{
        // 표의 글꼴·크기·정렬·색을 그대로 물려받아야 원본과 같아 보인다.
        font: "inherit",
        color: "inherit",
        textAlign: "inherit",
        lineHeight: "inherit",
        letterSpacing: "inherit",
        whiteSpace: "pre-wrap",
      }}
    />
  );
}
