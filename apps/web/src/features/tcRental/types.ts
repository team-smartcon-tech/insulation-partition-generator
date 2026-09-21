/**
 * TC 임대계획 — 도메인 타입.
 *
 * 이 도구는 "동별 골조 공정"을 입력으로 받아 "타워크레인·호이스트의 임대 시작/종료일"을 산출한다.
 * 계산에 쓰는 값은 전부 여기서 정의하고, 화면은 이 타입만 읽는다.
 *
 * 날짜는 전부 `YYYY-MM-DD` 문자열(로컬 기준)이다. Date 객체를 상태에 넣지 않는다 —
 * 직렬화(초안 저장·JSON 내보내기)에서 타임존 때문에 하루씩 밀리는 사고를 막기 위함.
 */

/** 세그먼트 날짜의 출처 — 화면에서 실측/추정을 구분해 표시한다 */
export type SegmentSource =
  | "frame_rows" // 스마트웍스 골구도(동·층 계획일)
  | "initial_plan" // 스마트웍스 초기계획공정표
  | "estimated" // 공기산정 엔진 값으로 보간
  | "manual" // 사용자가 직접 입력
  | "missing"; // 원본에 날짜가 없고 아직 보간되지 않음

/** 한 동의 한 층(또는 기초·옥탑) 골조 구간 */
export interface FloorSegment {
  /** 행 식별자 — "F"(기초) | "B2" | "1F" | "PH1" */
  key: string;
  /** 0 = 기초, 음수 = 지하, 양수 = 지상, aboveFloors 초과 = 옥탑(PH) */
  floor: number;
  /** 표시용 라벨 — "기초" "B2" "1F" "옥탑" */
  label: string;
  start: string | null;
  finish: string | null;
  source: SegmentSource;
}

/** 동절기 보양 횟수 — 첨부 공정표 우측 컬럼과 같은 3분류 */
export interface WinterCuring {
  basement: number;
  typical: number;
  rooftop: number;
}

/** 동(棟) 하나의 골조 정형 레코드 = 공정표 한 행 */
/**
 * 층고 기본값 (m) — 동별 구간을 따로 정하지 않았을 때 만들어 주는 세 값.
 * `1층 / 기준층 / 최상층` 3구간이 가장 흔한 모양이라 이것을 기본형으로 둔다.
 */
export interface FloorHeights {
  first: number;
  typical: number;
  top: number;
}

/**
 * 지상 층고 구간 한 칸.
 *
 * 현장마다 층고가 나뉘는 자리가 다르다 — `1층만 높은` 동도 있고 `1~3F 가 같이 높은` 동도
 * 있다. 그래서 "1층·기준층·최상층" 세 칸으로 고정하지 않고 **구간 목록**으로 받는다.
 * 구간은 1층부터 차례로 이어지며, 마지막 구간은 최상층까지다.
 */
export interface HeightBand {
  /** 이 구간의 마지막 지상층. null = 최상층까지 */
  upTo: number | null;
  /** 층고 (m) */
  height: number;
}

export interface BuildingFrameProfile {
  id: string;
  /** "3601동" */
  name: string;
  belowFloors: number;
  aboveFloors: number;
  /** 옥탑 층수 (보통 1) */
  phFloors: number;
  segments: FloorSegment[];
  householdCount?: number | null;
  /**
   * 호이스트 설치 기준층(지상). 이 층 골조가 끝나면 설치에 들어간다.
   * 미지정이면 `RentalParams.hc.anchorFloor` 를 쓴다 — 동마다 층수·공법이 달라
   * 현장에서는 동별로 따로 정하는 일이 흔하다.
   */
  hoistAnchorFloor?: number | null;
  /**
   * 호이스트 해체까지의 여유 개월 — **옥탑 골조완료 시점 기준**.
   * 회사 산정표의 "건설용리프트 해체시기 = 동별 골조완료 + 4개월" 규칙을 동별로 조정한다.
   * 미지정이면 `RentalParams.hc.postFrameMonths` 를 쓴다.
   */
  hoistPostFrameMonths?: number | null;
  /**
   * 지층 높이 (m) — 기초 레벨부터 1층 바닥까지.
   * 동마다 기초 레벨이 달라 **기본값을 둘 수 없는 실측값**이다. 비면 설치높이가 그만큼 짧다.
   */
  hoistBaseHeight?: number | null;
  /**
   * 지상 층고 구간. **설치높이 산정의 원천**이다 —
   *   설치높이 = 지층 + Σ(구간 층수 × 층고) + 연장   (올림)
   * 층수는 이 동의 지상층수에서, 연장은 표준값에서 자동으로 나오므로 입력받지 않는다.
   * 비우면 `RentalParams.hc.floorHeight` 로 `1층 / 기준층 / 최상층` 3구간을 만들어 쓴다.
   */
  hoistHeightBands?: HeightBand[] | null;
  /**
   * 운용 형태 (저속싱글·중속싱글·고속트윈). 비우면 층수로 자동 판정한다 —
   * 회사 입찰기준 개선(안, 23.8.7): **20층 이하 저속싱글 / 21층 이상 중속싱글**.
   * 고속트윈은 층수로 갈리지 않으므로 필요한 동만 사람이 직접 고른다.
   */
  hoistOperation?: string | null;
  /**
   * 동절기 보양 횟수. 자동 산출값을 기본으로 채우되 사용자가 덮어쓸 수 있다
   * (회사 표준이 확정되기 전까지는 사람이 고칠 수 있어야 한다).
   */
  winterCuring?: WinterCuring | null;
}

export type EquipmentKind = "tc" | "hc";

/** 타워크레인 N호기 / 호이스트 N호기 */
export interface EquipmentUnit {
  id: string;
  kind: EquipmentKind;
  /** "N호기" 의 N */
  no: number;
  /** 기종명 (예: "L-160") — 비용 산정 단계에서 단가와 연결된다 */
  model?: string;
}

/** 호기 ↔ 동 배정 (N:M — 한 동에 2대, 한 대가 여러 동 모두 가능) */
export interface Assignment {
  unitId: string;
  buildingId: string;
}

/** 산정 파라미터 — 전부 화면에서 조정 가능하며 기본값의 출처를 주석으로 남긴다 */
export interface RentalParams {
  /** 토요휴무 형식 — 4층 이상 층당 사이클을 결정 */
  saturdayOff: "weekly" | "biweekly" | "none";
  tc: {
    /** 골조 착수 전 가동 개시까지 앞당길 일수 (기초앵커·양생 여유) */
    leadDays: number;
    /** 반입~설치 완료 소요 (네트워크 공정표 표준 40일) */
    installDays: number;
    /** 골조 완료 후 가동 유지 개월 — 회사 산정표 "골조완료 + 1개월(전 동 동일)" */
    postFrameMonths: number;
    /** 해체 소요 (네트워크 공정표 표준 30일) */
    dismantleDays: number;
  };
  hc: {
    /** 설치 앵커 층 — 이 층 골조 완료 후 설치 착수 (네트워크 공정표 표준 4층) */
    anchorFloor: number;
    /** 설치 소요 (네트워크 공정표 표준 20일) */
    installDays: number;
    /** 골조 완료 후 사용 개월 — 회사 산정표 "동별 골조완료 + 4개월" */
    postFrameMonths: number;
    /** 해체 소요 (네트워크 공정표 표준 20일) */
    dismantleDays: number;
    /**
     * 층고 기본값 (m) — 동별 구간을 정하지 않았을 때 `1층 / 기준층 / 최상층` 3구간을 만든다.
     * 지층은 동마다 달라 여기 두지 않는다(동별 실측 입력).
     */
    floorHeight: FloorHeights;
    /** 최상층 위로 올리는 연장 (m) — 동과 무관한 표준값이라 동별 입력을 받지 않는다 */
    extendHeight: number;
    /**
     * 저속싱글로 보는 지상층수 상한. 이 층수 **이하면 저속싱글**, 넘으면 중속싱글이다.
     * 회사 입찰기준 개선(안, 23.8.7) 기준 20층. 기준이 바뀌면 이 값만 고친다.
     */
    lowSpeedMaxFloors: number;
  };
  winter: {
    /** 동절기 시작 "MM-DD" */
    from: string;
    /** 동절기 종료 "MM-DD" */
    to: string;
  };
  /** 이 일수 이상 비면 유휴로 경고 */
  idleWarnDays: number;
  /**
   * 실행기준 기준 산출에 쓰는 표준 사이클 (회사 표준 엑셀). 비어 있으면 표준값을 쓴다.
   * 우리 엔진의 공정표 기반 계산과는 **별개 축**이라 따로 둔다.
   */
  budget?: Partial<import("./engine/budgetStandard").BudgetCycle>;
}

/** 담당 동 사이의 빈 구간 — 장비가 서 있기만 하는 기간 */
export interface IdleGap {
  from: string;
  to: string;
  days: number;
  /** 앞 동 → 뒤 동 (경고 문구용) */
  afterBuilding: string;
  beforeBuilding: string;
}

/** 호기 1대의 임대 구간 산정 결과 */
export interface RentalSpan {
  unitId: string;
  kind: EquipmentKind;
  no: number;
  buildingIds: string[];
  buildingNames: string[];
  /** 반입·설치 착수 */
  mobilizeStart: string;
  /** 가동 개시 */
  activeStart: string;
  /** 가동 종료 = 해체 착수 */
  activeEnd: string;
  /** 해체 완료 = 반출 */
  demobEnd: string;
  /** 반입~반출 전체 일수 */
  rentalDays: number;
  /** 월 단위 환산 (올림) */
  rentalMonths: number;
  idleGaps: IdleGap[];
  /** 산정 불가 사유 (담당 동 없음·날짜 없음 등) */
  problem?: string;
}

/** 프로젝트(현장) 단위 계획 문서 — 초안 저장·JSON 내보내기의 단위 */
export interface TcRentalPlan {
  siteName: string;
  /** 원본 출처 표시용 */
  sourceLabel: string;
  buildings: BuildingFrameProfile[];
  units: EquipmentUnit[];
  assignments: Assignment[];
  params: RentalParams;
  updatedAt: string;
}

/** 스마트웍스 내보내기 JSON (format: "smartworks.crane-input", version 1) */
export interface CraneInputFile {
  format: string;
  version: number;
  exportedAt?: string;
  source?: {
    app?: string;
    siteId?: string;
    siteName?: string;
    origin?: string;
    planRevision?: number;
    buildSha?: string;
  };
  project?: {
    projectType?: string;
    startDate?: string;
    finishDate?: string;
  };
  buildings: Array<{
    buildingName: string;
    belowFloors: number;
    aboveFloors: number;
    phFloors?: number;
    householdCount?: number | null;
    segments: Array<{
      key: string;
      floor: number;
      label?: string;
      start: string | null;
      finish: string | null;
      source?: string;
    }>;
  }>;
  warnings?: string[];
}
