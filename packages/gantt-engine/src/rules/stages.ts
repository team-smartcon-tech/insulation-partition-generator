// 기준층 1사이클 (설계 문서 §3). 순서가 곧 규칙이다.
// 기전배관·검측(MEP)은 배근 직후 자동으로 붙는 관문이라 별도 자원 없이 다음 반일 칸을 차지한다.

export const STAGES = [
  "MARK", // 1 먹매김 0.5일
  "GANGFORM", // 2 갱폼인양 0.5일, 타워크레인
  "WALL_REBAR", // 3 벽철근 6h (오전), 철근팀
  "WALL_MEP", // 3' 기전배관·검측 (자동)
  "ALFORM", // 4 알폼 1일 (반일 2칸 연속), 알폼팀
  "TOP_INSULATION", // 4' 바닥단열재 — 최상층에만, 알폼 뒤·슬래브철근 앞 (설계 §8-2). 2일(반일 4칸), 팀 자원 없음(가정)
  "SLAB_REBAR", // 5 슬래브철근 4h, 철근팀
  "SLAB_MEP", // 5' 기전배관·검측 (자동)
  "POUR", // 6 타설 (오전, 그날 전체), 펌프카·레미콘
  "CURE", // 7 양생 — 옥탑 순서표에서만 칸을 차지한다. 기준층 동절기 양생은 달력 규칙(먹매김과 같은 날)
  // 지하·저층(재래식 거푸집). 일보 실적 표시용 — 시뮬레이터 사이클에는 들어가지 않는다 (설계 §8-2, 2026-10-30 1안)
  "FORM_WALL", // 벽체 거푸집 설치
  "FORM_SLAB", // 바닥 거푸집 설치
  "SHORING", // 시스템 동바리 (화면 표기 「시스템」). 거푸집 해체는 공정 단계가 아니다 (2026-10-30 사용자 결정)
] as const

/** 지하·저층 전용 단계 (예정 계산 안 함) */
export const UNDERGROUND_STAGES: readonly Stage[] = ["FORM_WALL", "FORM_SLAB", "SHORING"]

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
  TOP_INSULATION: 4,
  SLAB_REBAR: 1,
  SLAB_MEP: 1,
  POUR: 1,
  CURE: 2,
  FORM_WALL: 2,
  FORM_SLAB: 2,
  SHORING: 2,
}

export const STAGE_LABEL: Record<Stage, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "벽철근",
  WALL_MEP: "기전·검측(벽)",
  ALFORM: "알폼",
  TOP_INSULATION: "바닥단열재(최상층)",
  SLAB_REBAR: "슬래브철근",
  SLAB_MEP: "기전·검측(슬래브)",
  POUR: "타설",
  CURE: "양생",
  FORM_WALL: "벽체 거푸집",
  FORM_SLAB: "바닥 거푸집",
  SHORING: "시스템",
}

/**
 * 다음 단계. 단열재(최상층)는 그 동이 최상층 사이클일 때만 끼운다.
 * @param isTopFloor 지금 사이클이 최상층인가 (topFloor 를 모르면 false)
 */
export function nextStage(stage: Stage, isTopFloor = false): Stage {
  if (stage === "ALFORM") return isTopFloor ? "TOP_INSULATION" : "SLAB_REBAR"
  // 기준층 사이클은 타설에서 다시 먹매김으로. 양생(CURE)은 옥탑 순서표에서만 쓴다
  if (stage === "POUR" || stage === "CURE") return "MARK"
  // 지하 단계는 기준층 사이클 밖 — 다음은 기준층 첫 단계로 둔다(예정 계산에서는 이런 동을 빼므로 쓰이지 않는다)
  if ((UNDERGROUND_STAGES as readonly string[]).includes(stage)) return "MARK"
  const i = STAGES.indexOf(stage)
  return STAGES[i + 1]
}

/**
 * 옥탑 1개 층 순서표 (2026-10-30 사용자 기준). 합계 15일. 거푸집 단계는 ALFORM 으로 두되 옥탑은 알폼이 아니라 일반 거푸집(화면 표기 「거푸집」). 일 단위, 작업 가능일(일요일 제외)만 센다.
 * 갱폼은 크레인 운행일에만, 타설은 타설 가능일에만 한다. 팀 용량은 쓰지 않는다(옥탑은 별도 작업조로 본다 — 가정).
 */
export const ROOFTOP_SEQUENCE: readonly { stage: Stage; days: number }[] = [
  { stage: "MARK", days: 1 },
  { stage: "GANGFORM", days: 2 },
  { stage: "WALL_REBAR", days: 2 },
  { stage: "ALFORM", days: 6 },
  { stage: "SLAB_REBAR", days: 2 },
  { stage: "POUR", days: 1 },
  { stage: "CURE", days: 1 },
]
