/**
 * 서식 사이 내용 잇기 — 한 서식에 적은 줄을 다음 서식으로 옮겨 쓴다(2026-10-17 사용자 요청).
 *
 * 6.1-3 리스크 및 기회 평가표에서 "대응계획 유무"를 **유**로 적은 줄은 6.1-4 대응계획서에 그대로 올라가야
 * 한다. 번호·구분·발생일·등급·리스크를 손으로 다시 옮겨 적지 않게, 평가표 칸을 고칠 때마다 대응계획서의
 * 같은 번호 줄(없으면 빈 줄)에 채운다. 조치계획·개선결과·담당자처럼 대응계획서에서만 쓰는 칸은 건드리지 않는다.
 * 평가표에서 "유"를 지워도 대응계획서 줄은 지우지 않는다 — 이미 적은 조치계획이 날아가면 안 된다.
 */
import type { FormCellValues } from "./types";

export interface SheetLink {
  /** 옮겨 오는 서식 번호 */
  from: string;
  /** 옮겨 쓰는 서식 번호 */
  to: string;
  /** 이 열이 이 값이면 옮긴다 */
  when: { col: number; match: RegExp };
  /** 자료가 시작하는 줄(머리글 아래) */
  fromRow: number;
  toRow: number;
  /** [옮겨 오는 열, 옮겨 쓰는 열] — 첫 짝이 줄을 맞추는 열쇠(번호) */
  columns: [from: number, to: number][];
  /** 알림에 쓰는 이름 */
  label: string;
}

/** "유" — 엑셀에 흔히 적는 다른 표기도 받는다 */
const YES = /^\s*(유|有|예|있음|o|y|yes)\s*$/i;

export const SHEET_LINKS: SheetLink[] = [
  {
    from: "6.1-3",
    to: "6.1-4",
    // Q열 "대응계획 유무"
    when: { col: 17, match: YES },
    fromRow: 7,
    // 대응계획서는 머리글이 두 줄(6·7행)
    toRow: 8,
    // 번호 A→A, 구분 B→B, 발생일 D→D(발생일자), 리스크 등급 O→E(등급), 리스크 E→F
    columns: [
      [1, 1],
      [2, 2],
      [4, 4],
      [15, 5],
      [5, 6],
    ],
    label: "리스크 및 기회 대응계획서",
  },
];

const key = (row: number, col: number) => `${row}:${col}`;
const text = (values: FormCellValues, row: number, col: number) => (values[key(row, col)] ?? "").trim();

/**
 * 평가표 값으로 대응계획서 값을 맞춘다. 바뀐 것이 없으면 `changed` 가 0 이다.
 * - 같은 번호 줄이 있으면 그 줄을, 없으면 비어 있는 첫 줄을 쓴다(`toLastRow` 까지).
 * - 자리가 모자라면 그만큼 `overflow` 로 알린다(줄을 더하라고).
 */
export function applySheetLink(
  link: SheetLink,
  source: FormCellValues,
  target: FormCellValues,
  toLastRow: number,
): { values: FormCellValues; changed: number; overflow: number } {
  const rows = [
    ...new Set(
      Object.keys(source)
        .map((cellKey) => Number(cellKey.split(":")[0]))
        .filter((row) => Number.isFinite(row) && row >= link.fromRow),
    ),
  ].sort((a, b) => a - b);
  const picked = rows.filter((row) => link.when.match.test(source[key(row, link.when.col)] ?? ""));

  const next: FormCellValues = { ...target };
  const used = new Set<number>();
  let changed = 0;
  let overflow = 0;
  const [keyFrom, keyTo] = link.columns[0];
  const empty = (row: number) => link.columns.every(([, to]) => !text(next, row, to));

  for (const row of picked) {
    const id = text(source, row, keyFrom);
    let at: number | undefined;
    if (id) {
      for (let r = link.toRow; r <= toLastRow; r += 1) {
        if (!used.has(r) && text(next, r, keyTo) === id) {
          at = r;
          break;
        }
      }
    }
    if (at === undefined) {
      for (let r = link.toRow; r <= toLastRow; r += 1) {
        if (!used.has(r) && empty(r)) {
          at = r;
          break;
        }
      }
    }
    if (at === undefined) {
      overflow += 1;
      continue;
    }
    used.add(at);
    for (const [from, to] of link.columns) {
      const value = text(source, row, from);
      if (!value || text(next, at, to) === value) continue;
      next[key(at, to)] = value;
      changed += 1;
    }
  }
  return { values: next, changed, overflow };
}
