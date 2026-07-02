// 입면도(단열재 나누기도) — 동·타입 매트릭스 및 저장 상태 타입.
// 원본(SSX) elevationProjectApi.ts 에서 인증/네트워크 코드를 제외한 "타입 선언"만 이식.
// ElevState / ElevSummary 는 저장·불러오기(3단계) 직렬화 포맷이며, 현재는 로컬 참조용으로 보관.

// ─── 동·타입 매트릭스 (프로젝트 단위 동/타입/세대수) ───
export interface ElevTypeDef {
  id: string;
  name: string;
}
export interface ElevBuildingDef {
  id: string;
  name: string;
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
