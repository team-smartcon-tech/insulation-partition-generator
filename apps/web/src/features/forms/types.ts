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
  /** 왼쪽 위 → 오른쪽 아래 대각선(엑셀 "대각선 테두리"). 일정표의 빗금·머리글 칸 나누기에 쓰인다. */
  diagonalDown?: FormBorder;
  /** 왼쪽 아래 → 오른쪽 위 대각선 */
  diagonalUp?: FormBorder;
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
  /**
   * 들여쓰기 단계(엑셀 "들여쓰기"). 0 이면 없다. 화면에서는 정렬한 쪽에 여백으로 준다.
   * 빠뜨리면 글자가 왼쪽에 붙어, 글자 아래를 가리키는 선(QA-4.3-4)이 엉뚱한 곳을 가리킨다.
   */
  indent?: number;
  /**
   * 글자 방향. "up" 은 아래에서 위로(엑셀 +90°), "down" 은 위에서 아래로(엑셀 -90°),
   * "stacked" 는 글자를 세로로 쌓기(엑셀 "세로 쓰기"). 비스듬한 각도는 다루지 않는다.
   */
  textDirection?: "up" | "down" | "stacked";
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
  /**
   * 엑셀에서 잠긴 칸인가. **시트 보호가 걸린 시트에서만** 뜻이 있다(엑셀과 같은 규칙).
   * 양식을 만든 사람이 "여기는 건드리지 말라"고 정해 둔 자리라 화면에서도 고칠 수 없게 한다.
   */
  locked?: boolean;
  /**
   * 엑셀 수식이 든 칸인가. 표 중간에 줄을 끼울 때 **수식 범위가 어긋날 수 있어** 알리는 데 쓴다
   * (견본 190장 중 6개 파일에만 수식이 있다).
   */
  formula?: boolean;
  /**
   * 한 칸 안에서 글자마다 서식이 다를 때(엑셀 "부분 서식")의 조각들. 이어 붙이면 `text` 와 같다.
   * 빠뜨리면 큰 제목 아래 작은 영어 줄이 제목 크기로 커져 줄이 넘치고, 일부만 빨갛던 글이
   * 검게 보였다(10.1·8.12 등). 서식이 칸 전체에 같으면 없다.
   */
  runs?: FormTextRun[];
  /** 숨긴 열·줄에만 걸친 칸 — 자리(폭·높이 0)만 두고 그리지 않는다. */
  hidden?: boolean;
  style: FormCellStyle;
}

/** 부분 서식 조각. 비어 있는 항목은 칸 서식을 따른다. */
export interface FormTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** pt */
  fontSize?: number;
  /** #RRGGBB */
  color?: string;
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
  /**
   * 브라우저가 못 여는 그림 형식(EMF·WMF — 엑셀 "카메라"로 찍은 그림 등). 이때 `src` 는 비어 있고
   * 화면에는 자리 표시만 한다 — 말없이 빼면 원본에 있던 그림이 왜 없는지 알 수 없다(7.2 카메라).
   */
  unsupported?: "emf" | "wmf";
}

/**
 * 시트에 얹힌 차트(막대·꺾은선). 엑셀이 차트 안에 **저장해 둔 값**(numCache)으로 다시 그린다 —
 * 수식을 다시 계산하지 않으므로 원본 엑셀이 저장될 때의 모습과 같다. 3차원 막대는 평면으로 그린다.
 */
export interface FormChart {
  left: number;
  top: number;
  width: number;
  height: number;
  title?: string;
  /** 세로축 제목 */
  valueTitle?: string;
  /** 세로축 눈금의 표시 형식(엑셀 numFmt, 예: "0.0%") */
  valueFormat?: string;
  /** 세로축 눈금 범위·간격을 엑셀에서 고정해 둔 값(비었으면 값에 맞춰 정한다) */
  valueMin?: number;
  valueMax?: number;
  valueStep?: number;
  categories: string[];
  groups: FormChartGroup[];
}

export interface FormChartGroup {
  type: "bar" | "line";
  /** 막대 방향: col = 세로 막대, bar = 가로 막대 */
  direction?: "col" | "bar";
  grouping: "clustered" | "stacked" | "percentStacked" | "standard";
  series: { name: string; color?: string; values: (number | null)[] }[];
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
  | "line"
  /** 윤곽선을 점으로 그리는 도형 — 굵은 화살표·갈매기표·자유형(손으로 그린 선) */
  | "path";

/**
 * 윤곽선 한 줄기. 좌표는 도형 틀에 대한 비율(0~1)이라 틀 크기가 바뀌어도 그대로 쓴다.
 * 뒤집기(flipH/flipV)는 그리는 쪽에서 건다.
 */
export interface FormShapePath {
  segments: { op: "M" | "L" | "C" | "Q" | "Z"; points: number[] }[];
  /** 안을 채우는가(열린 선은 false) */
  fill: boolean;
  /** 선을 긋는가 */
  stroke: boolean;
}

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
  /**
   * 선 끝 모양이 화살촉이 아닐 때(엑셀 "원형"·"다이아몬드"). 없으면 화살촉이다.
   * 빠뜨리면 공정표 막대의 시작 점(●)이 거꾸로 된 화살촉으로 그려져 양쪽 화살표처럼 보였다(8.6 공사관리).
   */
  startCap?: "oval" | "diamond";
  endCap?: "oval" | "diamond";
  /** 도형 안 글자. 줄바꿈은 \n */
  text: string;
  /** 도형 안 글자의 부분 서식 조각(이어 붙이면 `text`). 조각마다 서식이 같으면 없다. */
  textRuns?: FormTextRun[];
  /** 채움색 #RRGGBB. 없으면 투명 */
  fill?: string;
  /** 선·테두리 색 */
  line?: string;
  /** 선 굵기(px) */
  lineWidth: number;
  /** 선 모양. 워터마크·보조선에 점선이 자주 쓰인다. */
  dash?: "solid" | "dashed" | "dotted";
  /** 시계방향 회전(도). 워터마크가 비스듬히 걸려 있는 경우. */
  rotation?: number;
  /**
   * 꺾인 연결선이면 꺾는 자리(틀 너비에 대한 비율). 직선이면 없음.
   * 0.5 = 가운데서 꺾음, 1 = 끝에서 한 번 꺾음, 음수·1 초과 = 틀 밖으로 돌아 나감.
   */
  elbow?: number;
  /** kind 가 "path" 일 때의 윤곽선 */
  paths?: FormShapePath[];
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  /** 글자의 세로 자리. 엑셀 기본은 위쪽이다(순서도 상자는 보통 가운데로 적혀 있다). */
  valign?: "top" | "middle" | "bottom";
  /** 글자 안쪽 여백(px) — 위·오른쪽·아래·왼쪽. 여백이 달라지면 줄 바뀌는 자리가 달라진다. */
  inset?: [number, number, number, number];
  /** 틀 너비에 맞춰 줄을 바꾸지 않는다(짧은 라벨이 틀보다 길게 삐져나오는 경우) */
  noWrap?: boolean;
  /** 세로 글자. vert = 시계방향으로 누움, vert270 = 반시계, eaVert = 글자는 서고 줄만 세로 */
  vertical?: "vert" | "vert270" | "eaVert";
  /**
   * 도형을 돌려도 글자는 돌리지 않는다(엑셀 "텍스트 회전 안 함", bodyPr upright). 이때 글자는 돌린 뒤의
   * 모습(가로·세로가 바뀐 틀) 안에 세로 쓰기만 건다 — 두 번 돌려 글자가 좁은 틀에 쌓였다(8.7 "필요시 문서 개정").
   */
  upright?: boolean;
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
  /** 격자 위에 떠 있는 차트. 옛 저장본에는 없다. */
  charts?: FormChart[];
  /**
   * 엑셀에 지정된 인쇄 영역(`A1:N29`). 이만큼만 옮겼다는 뜻이라 화면에 알려 준다 —
   * 안 그러면 원본에 있던 줄이 왜 없는지 알 방법이 없다. 지정이 없으면 undefined.
   */
  printArea?: string;
  /** 엑셀에 적힌 인쇄 설정(용지·방향·여백) — 복합기로 뽑을 때 그대로 쓴다. */
  page?: FormPageSetup;
  /**
   * 엑셀에서 "시트 보호"가 걸려 있는 시트인가.
   * 이 시트에서는 잠긴 칸(`FormCell.locked`)을 고칠 수 없다 — 엑셀과 같게 맞춘다.
   */
  locked?: boolean;
  /**
   * 사용자가 앱에서 더한 시트(원본 엑셀에는 없다). 월별로 장을 늘려 쓰는 용도.
   * 원본 시트와 구분해야 이름 바꾸기·지우기를 여기에만 허용할 수 있다.
   */
  custom?: boolean;
}

/** 한 시트 안에서 고친 글자. 셀 키 → 값. 손대지 않은 칸은 여기 없다. */
export type FormCellValues = Record<string, string>;

/**
 * 시트 이름 → 그 시트에서 고친 글자.
 *
 * **시트별로 나눠 담아야 한다.** 셀 키가 `행:열` 이라 한 덩어리에 담으면 3행 2열에
 * 적은 글자가 모든 시트의 3행 2열에 함께 나타난다. 월별로 시트를 나눠 쓰는 양식에서는
 * 이게 곧 지난달 내용이 이번 달에 겹쳐 보이는 것이 된다.
 */
export type FormValues = Record<string, FormCellValues>;

/** 엑셀의 인쇄 설정 중 종이에 맞추는 데 필요한 것만 */
export interface FormPageSetup {
  /** 세로/가로 */
  orientation?: "portrait" | "landscape";
  /** 엑셀 용지 번호(9 = A4, 8 = A3 …) */
  paperSize?: number;
  /** 여백(인치) — 엑셀이 주는 단위 그대로 담는다 */
  margins?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * 엑셀 [페이지 설정]의 **확대/축소 배율**(%). `fitToPage` 가 켜져 있으면 엑셀은 이 값을 쓰지 않는다.
   */
  scale?: number;
  /** "페이지에 맞추기"가 켜져 있나 — 켜져 있으면 아래 두 값이 몇 장에 맞출지를 정한다. */
  fitToPage?: boolean;
  /** 가로로 몇 장에 맞출까. `0` 이면 가로는 맞추지 않는다(기본 1). */
  fitToWidth?: number;
  /** 세로로 몇 장에 맞출까. `0` 이면 세로는 맞추지 않는다 — 길면 여러 장으로 나간다(기본 1). */
  fitToHeight?: number;
  /**
   * 엑셀 머리글·바닥글. 엑셀 서식 문자열 그대로 담는다(`&R&"맑은 고딕,굵게"&9QA-4.3-4`).
   * 현장 양식은 거의 모두 바닥글 오른쪽에 **서식 번호**가 들어 있어, 빠지면 종이가 달라 보인다.
   */
  header?: string;
  footer?: string;
  /** 종이 끝에서 머리글·바닥글까지 거리(인치). 엑셀 기본 0.3인치. */
  headerMargin?: number;
  footerMargin?: number;
  /** [페이지 설정] → 페이지 가운데 맞춤(가로·세로). 켜져 있으면 종이 한가운데에 찍는다. */
  horizontalCentered?: boolean;
  verticalCentered?: boolean;
}
