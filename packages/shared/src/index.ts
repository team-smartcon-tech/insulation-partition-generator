// web(화면)과 worker(서버)가 함께 쓰는 공용 타입.
// 원본(SSX) elevationProjectApi.ts 의 저장 포맷 타입을 이식한 것 — 필드 변경 시
// 저장된 REV(state jsonb)와의 호환(fallback)을 반드시 함께 고려한다.

// ─── 동·타입 매트릭스 (프로젝트 단위 동/타입/세대수) ───
export interface ElevTypeDef {
  id: string;
  name: string;
}

/**
 * 층 그룹 — 층고가 다른 구간. 세대수 입력(ElevUnitCounts)과 같은 축이다.
 *   low = 1~3F(저층부) · roof = 지붕층 · base = 기준층
 */
export type ElevFloorGroup = "low" | "roof" | "base";

/**
 * 층 그룹별 층고(mm). 층고가 다르면 단열재 나누기(행 구성)와 물량도 달라지므로
 * 대표 입면 1개를 그룹 층고로 각각 전개해 물량을 낸다.
 * 미입력(0/undefined) 항목은 상위로 폴백: 동 예외 → 전역 → 입면별 층고.
 */
export interface ElevFloorHeights {
  low?: number;
  roof?: number;
  base?: number;
}

export interface ElevBuildingDef {
  id: string;
  name: string;
  /** 이 동만 층고가 다를 때의 예외값(mm). 미입력 항목은 전역 층고를 따른다. */
  floorHeights?: ElevFloorHeights;
}
export interface ElevUnitCounts {
  /** 1~3F */
  low?: number;
  /** 지붕층 */
  roof?: number;
  /** 기준층 */
  base?: number;
}
/**
 * 동×타입×세대수 매트릭스. 현장식 산출서를 이 매트릭스로 구동한다.
 * 입면은 typeId(+선택적 buildingId)로 태깅되고, (동,타입) 셀 물량 = 그 타입 대표
 * 입면(또는 동 전용 입면) 1세대 물량 × 세대수.
 */
export interface ElevTypeMatrix {
  buildings: ElevBuildingDef[];
  types: ElevTypeDef[];
  /** 배분+세대수. key = `${buildingId}::${typeId}`. 키 존재 = 그 동에 그 타입 배분됨. */
  cells: Record<string, ElevUnitCounts>;
  /** 프로젝트 공통 층 그룹별 층고(mm). 동별 예외는 buildings[].floorHeights. */
  floorHeights?: ElevFloorHeights;
}

/** 복원용 직렬화 상태(schema_ver=1). walls/openings/presets/buildings 는 페이지 타입을 느슨히 담는다. */
export interface ElevState {
  schemaVer: number;
  fileName: string | null;
  boardSpec: { boardLength: number; boardHeight: number; boardThickness: number };
  policy: {
    insulOn: boolean;
    placement: "min-waste" | "constructability";
    optimizeSP: boolean;
    discardWidth: number;
    /** 시공성 우선: 최소 조각 폭(mm) — 미만 자투리는 옆 판과 재분할. 미지정/0=끔(구 REV 호환). */
    constructMinPieceWidth?: number;
    minJointGap: number;
    minPieceWidth: number;
    /** 겹 방향 — true=안쪽(2P 짧게), false=바깥(2P 길게). 미지정 시 안쪽. */
    plyInward?: boolean;
  };
  ui: {
    defaultFloorHeight: number;
    defaultSill: number;
    autoExtract: boolean;
    hiddenLayers: string[];
  };
  presets: unknown[];
  walls: unknown[];
  openings: unknown[];
  /** 동·코어/층 구성 (Phase 4). 없으면 빈 배열. */
  buildings: unknown[];
  /** 동·타입·세대수 매트릭스. 없으면(구 REV) 로드 시 빈 값 또는 레거시 필드에서 마이그레이션. */
  typeMatrix?: ElevTypeMatrix;
}

/** 리비전 표시용 요약(목록/트리 빠른 렌더) */
export interface ElevSummary {
  totalAreaM2?: number;
  orderBoardCount?: number;
  buildingCount?: number;
  coreCount?: number;
  wallCount?: number;
}

// ─── DB row 타입 (elev_projects / elev_revisions) ───
export interface DbElevProject {
  id: string;
  name: string;
  description: string | null;
  latest_rev_no: number;
  latest_rev_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbElevRevisionMeta {
  id: string;
  rev_no: number;
  memo: string | null;
  dxf_name: string | null;
  dxf_size: number | null;
  dxf_path: string | null;
  summary: ElevSummary | null;
  schema_ver: number;
  created_by: string | null;
  created_at: string;
}

export interface DbElevRevisionFull extends DbElevRevisionMeta {
  project_id: string;
  state: ElevState;
  dxf_bucket: string | null;
}
