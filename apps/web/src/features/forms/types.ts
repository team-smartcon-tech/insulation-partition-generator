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

/**
 * 도형의 모양. 엑셀에는 수백 가지 도형이 있지만 업무 양식의 순서도에 실제로 쓰이는
 * 것은 몇 가지뿐이다. 모르는 도형은 네모로 떨어뜨린다 — 안 그리는 것보다 낫다.
 */
export type FormShapeKind =
  | "box"
  | "roundBox"
  | "ellipse"
  | "diamond"
  /** 순서도 "문서" 기호 — 아래가 물결인 사각형 */
  | "document"
  | "line";

/** 격자 위에 떠 있는 도형(순서도 상자·화살표 등). 그림과 달리 글자를 품는다. */
export interface FormShape {
  kind: FormShapeKind;
  left: number;
  top: number;
  width: number;
  height: number;
  /** 선일 때 좌상→우하가 아니라 뒤집혀 그려지는지 */
  flipH?: boolean;
  flipV?: boolean;
  /** 선 끝의 화살촉 */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** 도형 안 글자. 줄바꿈은 \n */
  text: string;
  /** 채움색 #RRGGBB. 없으면 투명 */
  fill?: string;
  /** 선·테두리 색 */
  line?: string;
  /** 선 굵기(px) */
  lineWidth: number;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
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
  /** 격자 위에 떠 있는 도형(순서도 등). 없으면 빈 배열 */
  shapes: FormShape[];
  /**
   * 엑셀에 지정된 인쇄 영역(`A1:N29`). 이만큼만 옮겼다는 뜻이라 화면에 알려 준다 —
   * 안 그러면 원본에 있던 줄이 왜 없는지 알 방법이 없다. 지정이 없으면 undefined.
   */
  printArea?: string;
}

/** 사용자가 고친 글자만 담는다. 셀 키 → 고친 값. 손대지 않은 칸은 여기 없다. */
export type FormValues = Record<string, string>;
