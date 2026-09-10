/**
 * 우미 양식 모음집 — 엑셀 양식을 화면에 "원본 그대로" 그리기 위한 타입.
 *
 * 엑셀 시트를 항목 리스트로 요약하지 않고 격자 그대로 담는다.
 * 병합·행/열 크기·테두리·글꼴을 잃으면 실제 공문서 모양을 재현할 수 없기 때문이다.
 */

export type FormBorderStyle =
  | "thin"
  | "medium"
  | "thick"
  | "dashed"
  | "dotted"
  | "double";

export interface FormBorder {
  style: FormBorderStyle;
  /** #RRGGBB. 엑셀이 테마색만 지정했으면 undefined(=기본 검정 계열) */
  color?: string;
}

export interface FormCellBorders {
  top?: FormBorder;
  right?: FormBorder;
  bottom?: FormBorder;
  left?: FormBorder;
}

export interface FormCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** pt 단위(엑셀 원본 값) */
  fontSize?: number;
  fontFamily?: string;
  /** 글자색 #RRGGBB */
  color?: string;
  /** 배경색 #RRGGBB. 채우기 없으면 undefined */
  background?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  borders: FormCellBorders;
}

export interface FormCell {
  /** 병합 대표 칸의 좌표로 만든 안정적인 키. 고친 글자를 여기에 붙여 저장한다. */
  key: string;
  /** 1부터 시작 */
  row: number;
  /** 1부터 시작 */
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 엑셀 원본 글자. 사용자가 고친 값은 따로 보관하고 이건 그대로 둔다. */
  text: string;
  style: FormCellStyle;
}

/**
 * 시트에 얹힌 그림(로고·도장·캡처).
 *
 * 그림은 칸에 들어가는 게 아니라 격자 **위에 떠 있다**. 그래서 행·열이 아니라
 * 격자 왼쪽 위에서부터의 픽셀 좌표로 잡는다.
 */
export interface FormImage {
  /** data: URL. 저장해 두면 그대로 다시 뜬다(blob URL 은 새로고침하면 죽는다). */
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FormSheet {
  name: string;
  rowCount: number;
  colCount: number;
  /** px. 인덱스 0 = 1열 */
  colWidths: number[];
  /** px. 인덱스 0 = 1행 */
  rowHeights: number[];
  /** 병합에 가려진 칸은 제외하고 대표 칸만 담는다. 행→열 순서 */
  cells: FormCell[];
  /** 격자 위에 떠 있는 그림. 없으면 빈 배열 */
  images: FormImage[];
}

/** 사용자가 고친 글자만 담는다. 셀 키 → 고친 값. 손대지 않은 칸은 여기 없다. */
export type FormValues = Record<string, string>;
