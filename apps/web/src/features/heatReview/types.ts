/**
 * 동절기 열원검토 — 문서 타입.
 *
 * 한 "검토서(HeatProject)" 가 현장 하나의 동절기 급열 계획이다.
 * 그 안에 보양 구역(Zone)이 CJ·세대 타입·코어 단위로 쌓이고, 조건·열원·비용 가정은 검토서 공통이다.
 */

export interface Pt {
  x: number;
  y: number;
}

/** 구역 종류 — 기본 산정 방식과 비용 집계 묶음을 정한다 */
export type ZoneKind = "unit" | "core" | "parking";

/**
 * 산정 방식
 * - enclosure: 양생실 + 상옥공간 정밀식 (한중콘크리트 적용지침, 단위세대 검토서)
 * - simple   : 표면적 × 평균 열관류율 간이식 (주차장 열풍기 산정툴)
 */
export type CalcMethod = "enclosure" | "simple";

export type CountRule = "roundPlus1" | "ceil";

export interface Opening {
  id: string;
  label: string;
  /** 가로 m */
  w: number;
  /** 세로 m */
  h: number;
  count: number;
}

export interface ZoneGeometry {
  /** cad: 도면에서 그림 · manual: 치수 직접 입력 */
  source: "cad" | "manual";
  /** 도면 좌표(도면 단위 그대로). manual 이면 null */
  polygon: Pt[] | null;
  /**
   * polygon 을 그린 도면 — 도면은 구역 종류별로 따로 올린다(단위세대 평면 / 코어 / 지하주차장).
   * 구역 종류를 나중에 바꿔도 그린 도면은 그대로다. 없으면(초기 문서) 주차장 도면.
   */
  sheet?: ZoneKind;
  /** manual 가로×세로 입력값(m). 면적·둘레를 직접 넣었으면 null */
  dims: { l: number; w: number } | null;
  /** 바닥면적 m² */
  area: number;
  /** 둘레 m */
  perimeter: number;
  /**
   * 도면 구역의 둘레를 사용자가 직접 고쳤다 — 도면을 다시 재도(꼭짓점 수정·단위 변경) 이 값은 지킨다.
   * 외곽선 길이 대신 세대 내부 벽까지 넣고 싶을 때 쓴다.
   */
  perimeterLocked?: boolean;
}

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  method: CalcMethod;
  /** 팔레트 인덱스 */
  color: number;
  geometry: ZoneGeometry;
  /** 층고 m */
  height: number;
  openings: Opening[];
  /** 1회 타설에 같은 구역이 몇 개인가 (예: 59형 4세대) */
  qty: number;
  /** 주차장 구역만: 동절기 중 이 구역을 몇 번 보양하는가 */
  repeats: number;
  /** 주차장 구역만: 장비 임대 개월 */
  rentalMonths: number;
  /** 열원별 적용 대수(사용자 지정). 없으면 산정 대수 */
  applied: Record<string, number>;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conditions {
  /** 초기 외기 평균온도 ℃ (a) */
  outdoorTemp: number;
  /** 양생실 목표 양생온도 ℃ (b) */
  cureTemp: number;
  /** 상옥 목표 양생온도 ℃ (c) */
  upperTemp: number;
  /** 상옥공간 층고 m (d') */
  upperHeight: number;
  /** 열손실계수 kcal/m²h℃ — 콘크리트(i) · 개구부 버블시트(j) · 천막지(k) */
  uConcrete: number;
  uOpening: number;
  uTent: number;
  /** 기준 환기횟수 (가) — 내부 / 상옥 */
  ventBaseInner: number;
  ventBaseOuter: number;
  /** 보정계수 (나) 크기 · (다) 이음상태 · (마) 겹침·이음매 */
  fSize: number;
  fJoint: number;
  fOverlap: number;
  /** 보정계수 (라) 평면형상 — 아파트 / 오피스·주차장 */
  fShapeApt: number;
  fShapeOpen: number;
  /** 정밀식 여유율 % */
  enclosureSafety: number;
  /**
   * 정밀식 필요 대수 규칙 — **단위세대**
   * - roundPlus1: 반올림 + 1대 (당사 검토서 엑셀·배치도 기준. 예: 1.92 → 3대)
   * - ceil      : 올림 (손실열량을 넘기는 최소 대수. 예: 1.92 → 2대)
   */
  enclosureCountRule: CountRule;
  /**
   * 정밀식 필요 대수 규칙 — **코어**. 기본은 올림.
   * 코어(계단실·EV홀)는 칸이 나뉘지 않은 한 공간이라 여유 1대를 두지 않는다
   * (현장 배치도: 코어별 열풍기 1개소 · 펠릿 2개소).
   */
  coreCountRule: CountRule;
  /** 간이식: 평균 열관류율 kcal/m²h℃ · 시간당 환기횟수 · 안전율 % */
  simpleU: number;
  simpleAch: number;
  simpleSafety: number;
}

export interface Heater {
  id: string;
  name: string;
  /**
   * 급열량 산정 방식
   * - rated: 정격 열량 × 가열효율 (등유 열풍기)
   * - fuel : kg당 열량 × 1회 투입량 ÷ 연소시간 (펠릿·고체연료)
   */
  mode: "rated" | "fuel";
  ratedKcal: number;
  efficiency: number;
  kcalPerUnit: number;
  /** 1회 투입량 (연료 단위) */
  loadPerFill: number;
  /** 1회 지속(연소)시간 h */
  burnHours: number;
  fuelUnit: string;
  /** 연료 단가 원/단위 */
  fuelPrice: number;
  /** 대당 월 임대료 원 */
  rentalMonthly: number;
  /** 1회 타설(48시간 급열)당 투입 인원 품 */
  laborMandays: number;
  /** 전기식 — 연소가 없어 환기손실을 10%만 본다 */
  electric: boolean;
  /** 구역당 최소 대수 */
  minCount: number;
  color: string;
  note: string;
}

export interface CostSettings {
  /** 급열 시간 h */
  cureHours: number;
  /** 노임단가 원/품 */
  wage: number;
  /** 기준층(세대·코어) 반복: 월 타설 층수 × 동절기 개월 × 동 수 */
  floorsPerMonth: number;
  months: number;
  buildings: number;
}

export interface DrawingMeta {
  fileName: string;
  /** 도면 1단위의 길이 */
  unit: "mm" | "m";
}

export interface HeatProject {
  schemaVer: 1;
  id: string;
  name: string;
  conditions: Conditions;
  heaters: Heater[];
  cost: CostSettings;
  zones: Zone[];
  /**
   * 적용 열원 — 구역 종류별로 따로 정한다 (예: 주차장은 열풍기, 단위세대는 펠릿난로).
   * 값은 heaters 의 id.
   */
  appliedHeaters: Record<ZoneKind, string>;
  /** 종류별 도면. 도면 본체(선분)는 IndexedDB 에 있고 여기는 파일명·단위만 */
  drawings: Record<ZoneKind, DrawingMeta | null>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
  zoneCount: number;
  updatedAt: string;
}
