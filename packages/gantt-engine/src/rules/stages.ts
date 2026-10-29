// 기준층 1사이클 (설계 문서 §3). 순서가 곧 규칙이다.
// 기전배관·검측(MEP)은 배근 직후 자동으로 붙는 관문이라 별도 자원 없이 다음 반일 칸을 차지한다.

export const STAGES = [
  "MARK", // 1 먹매김 0.5일
  "GANGFORM", // 2 갱폼인양 0.5일, 타워크레인
  "WALL_REBAR", // 3 벽철근 6h (오전), 철근팀
  "WALL_MEP", // 3' 기전배관·검측 (자동)
  "ALFORM", // 4 알폼 1일 (반일 2칸 연속), 알폼팀
  "TOP_INSULATION", // 4' 단열재 설치 — 최상층에만, 1·2호 세대, 알폼 뒤·슬래브철근 앞 (설계 §8-2). 반일 1칸, 팀 자원 없음(가정)
  "SLAB_REBAR", // 5 슬래브철근 4h, 철근팀
  "SLAB_MEP", // 5' 기전배관·검측 (자동)
  "POUR", // 6 타설 (오전, 그날 전체), 펌프카·레미콘
] as const

export type Stage = (typeof STAGES)[number]

export type Team = "rebar" | "alform" | "gangform" | "pour"

/** 자원을 쓰는 단계 → 팀. 자동 단계(MEP)와 먹매김은 없음. */
export const STAGE_TEAM: Partial<Record<Stage, Team>> = {
  GANGFORM: "gangform",
  WALL_REBAR: "rebar",
  ALFORM: "alform",
  SLAB_REBAR: "rebar",
  POUR: "pour",
}

/** 반일 칸 수. 타설은 오전 1칸에 배정하지만 그날 그 동은 다른 작업을 하지 않는다. */
export const STAGE_SLOTS: Record<Stage, number> = {
  MARK: 1,
  GANGFORM: 1,
  WALL_REBAR: 1,
  WALL_MEP: 1,
  ALFORM: 2,
  TOP_INSULATION: 1,
  SLAB_REBAR: 1,
  SLAB_MEP: 1,
  POUR: 1,
}

export const STAGE_LABEL: Record<Stage, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "벽철근",
  WALL_MEP: "기전·검측(벽)",
  ALFORM: "알폼",
  TOP_INSULATION: "단열재(최상층)",
  SLAB_REBAR: "슬래브철근",
  SLAB_MEP: "기전·검측(슬래브)",
  POUR: "타설",
}

/**
 * 다음 단계. 단열재(최상층)는 그 동이 최상층 사이클일 때만 끼운다.
 * @param isTopFloor 지금 사이클이 최상층인가 (topFloor 를 모르면 false)
 */
export function nextStage(stage: Stage, isTopFloor = false): Stage {
  if (stage === "ALFORM") return isTopFloor ? "TOP_INSULATION" : "SLAB_REBAR"
  const i = STAGES.indexOf(stage)
  return STAGES[(i + 1) % STAGES.length]
}
