/**
 * 셀 하나의 내용을 그린다 — 읽기만 할 때는 글자, 채울 때는 입력칸.
 *
 * 적는 자리(공백 덩어리)가 있는 셀은 그 자리마다 작은 입력칸을 넣어 원본 구조를 지킨다.
 * 자리가 없는 셀(③④⑤처럼 통째로 빈 칸)은 칸 전체가 하나의 입력 상자가 된다.
 */
import { splitCellText, slotKey } from "./formSlots";
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

const SLOT_INPUT_CLASS =
  "inline-block border-0 border-b border-dashed border-blue-400 bg-blue-50/60 px-1 " +
  "text-inherit outline-none focus:border-solid focus:border-blue-600 focus:bg-blue-50";

interface FormCellContentProps {
  cell: FormCell;
  /** 채워 넣는 중인지. false 면 글자만 보여준다. */
  editable: boolean;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export default function FormCellContent({
  cell,
  editable,
  values,
  onChange,
}: FormCellContentProps) {
  if (!editable || !cell.input) {
    return <>{displayText(cell.text)}</>;
  }

  const lines = splitCellText(displayText(cell.text));
  const hasSlots = lines.some((segments) => segments.some((s) => s.type === "slot"));

  // 적는 자리가 없는 빈 칸은 칸 전체가 입력 상자다.
  if (!hasSlots) {
    const key = slotKey(cell.key, 0);
    return (
      <textarea
        value={values[key] ?? ""}
        onChange={(event) => onChange(key, event.target.value)}
        rows={1}
        className="block h-full w-full resize-none border-0 bg-blue-50/60 p-0 text-inherit outline-none focus:bg-blue-50"
        style={{ fontFamily: "inherit", fontSize: "inherit", minHeight: "1.4em" }}
      />
    );
  }

  return (
    <>
      {lines.map((segments, lineIndex) => (
        <span key={lineIndex} className="block" style={{ minHeight: "1.2em" }}>
          {segments.map((segment, index) => {
            if (segment.type === "text") {
              return <span key={`t${index}`}>{segment.text}</span>;
            }
            const key = slotKey(cell.key, segment.index);
            return (
              <input
                key={`s${segment.index}`}
                type="text"
                value={values[key] ?? ""}
                onChange={(event) => onChange(key, event.target.value)}
                // 원본 공백 수만큼 폭을 준다 — 그래야 칸이 원래 자리에 남는다.
                style={{ width: `${segment.spaces}ch`, fontFamily: "inherit", fontSize: "inherit" }}
                className={SLOT_INPUT_CLASS}
              />
            );
          })}
        </span>
      ))}
    </>
  );
}
