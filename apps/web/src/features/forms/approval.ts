/**
 * 결재칸 찾기 — 서류 위쪽의 `작성 | 검토 | 승인` 칸을 알아본다.
 *
 * 결재칸은 양식마다 자리가 다르지만(맨 위 오른쪽, 표 아래 …) 모양은 같다:
 *   - **직책·단계 이름이 가로로 붙어 있는 줄**(작성·검토·승인, 담당·팀장·소장 …)
 *   - 그 **바로 아래 빈 칸**(서명 자리)
 *   - 그 아래 `/` 또는 빈 칸이 한 줄 더 있으면 날짜 자리
 *
 * 글자만 보고 찾으면 표 머리글(`공사 | 공무 | 품질`)도 걸린다. 그래서 칸들이 **서로 붙어 있고**
 * 바로 아래가 **비어 있어야**(서명할 자리) 결재칸으로 본다. 적어도 한 칸은 `작성·검토·승인·확인·
 * 담당·결재` 중 하나여야 한다 — 부서 이름만 늘어선 줄은 표일 가능성이 더 크다.
 */
import type { FormCell, FormSheet } from "./types";

/** 결재칸 한 칸(작성·검토·승인 중 하나) */
export interface ApprovalSlot {
  /** 칸 이름(공백 뺀 것): 작성, 검토, 승인 … */
  label: string;
  /** 이름이 적힌 칸 */
  labelKey: string;
  /** 서명 자리 */
  signKey: string;
  /** 날짜 자리(없는 양식도 있다) */
  dateKey?: string;
}

/** 붙어 있는 결재칸 한 묶음 */
export interface ApprovalBox {
  /** 칸 이름이 있는 줄 */
  row: number;
  slots: ApprovalSlot[];
}

/** 결재 단계를 뜻하는 말 — 묶음에 이 중 하나는 있어야 한다. */
const STEP_WORDS = new Set(["작성", "검토", "승인", "확인", "담당", "결재", "기안", "합의", "심사", "협조"]);
/** 직책·부서 — 단계 말과 함께 늘어설 때만 결재칸으로 본다. */
const ROLE_WORDS = new Set([
  "팀장", "소장", "과장", "부장", "차장", "대리", "주임", "사원", "실장", "본부장", "현장소장", "공사", "공무",
  "품질", "안전", "보건", "설비", "전기", "관리", "책임자", "대표", "대표이사", "사장", "이사", "상무", "전무",
]);

const compact = (text: string) => text.replace(/\s+/g, "");
const isLabel = (cell: FormCell) => {
  const text = compact(cell.text);
  return STEP_WORDS.has(text) || ROLE_WORDS.has(text);
};
/** 서명·날짜 자리로 볼 수 있는 칸: 비었거나 `/`·`.`·`년 월 일` 같은 날짜 틀만 있다. */
const isBlankish = (cell: FormCell | undefined) =>
  cell !== undefined && /^[\s/.\-년월일]*$/.test(cell.text);

export function findApprovalBoxes(sheet: FormSheet): ApprovalBox[] {
  // 칸 위치 → 칸. 병합 칸은 왼쪽 위 자리 하나로만 들어 있다.
  const at = new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.col}`, cell] as const));
  const below = (cell: FormCell) => at.get(`${cell.row + cell.rowSpan}:${cell.col}`);

  const byRow = new Map<number, FormCell[]>();
  for (const cell of sheet.cells) {
    if (!isLabel(cell)) continue;
    const list = byRow.get(cell.row) ?? [];
    list.push(cell);
    byRow.set(cell.row, list);
  }

  const boxes: ApprovalBox[] = [];
  for (const [row, labels] of byRow) {
    labels.sort((a, b) => a.col - b.col);
    // 서로 붙은 칸끼리 묶는다(사이에 다른 칸이 끼면 다른 묶음).
    let run: FormCell[] = [];
    const flush = () => {
      const box = toBox(row, run, below);
      if (box) boxes.push(box);
      run = [];
    };
    for (const cell of labels) {
      const last = run[run.length - 1];
      if (last && last.col + last.colSpan !== cell.col) flush();
      run.push(cell);
    }
    flush();
  }
  return boxes.sort((a, b) => a.row - b.row);
}

function toBox(
  row: number,
  run: FormCell[],
  below: (cell: FormCell) => FormCell | undefined,
): ApprovalBox | undefined {
  if (run.length < 2) return undefined;
  if (!run.some((cell) => STEP_WORDS.has(compact(cell.text)))) return undefined;

  const slots: ApprovalSlot[] = [];
  for (const cell of run) {
    const sign = below(cell);
    // 서명 자리는 비어 있어야 한다 — 글자가 차 있으면 표의 머리글과 내용이다.
    if (!sign || sign.text.trim() !== "" || sign.colSpan !== cell.colSpan) return undefined;
    const date = below(sign);
    slots.push({
      label: compact(cell.text),
      labelKey: cell.key,
      signKey: sign.key,
      // 날짜 자리: 서명 칸보다 낮은 줄이고 비었거나 `/` 틀만 있다.
      ...(date && isBlankish(date) && date.colSpan === cell.colSpan && date.rowSpan <= sign.rowSpan
        ? { dateKey: date.key }
        : {}),
    });
  }
  return { row, slots };
}
