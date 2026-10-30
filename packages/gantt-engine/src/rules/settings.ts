// 현장 설정값 (설계 문서 §5) 과 §8 검증용 프리셋. 하드코딩된 현장값을 두지 않고 전부 여기서 받는다.

export type GangformCapacity = {
  /** "day" = 팀당 하루 N동, "slot" = 반일 N동(예전 값 — 팀당 하루 2N동으로 본다) */
  per: "day" | "slot"
  count: number
}

/**
 * 갱폼 용량 (2026-10-30 사용자: 갱폼팀 수 + 「갱폼인양 N동/일」).
 * 하루 = 팀 수 × 팀당 N동, 반일 = 팀 수 × ⌈N/2⌉ (한 팀이 하루 2동이면 오전 1·오후 1).
 * 예전 「반일 c동」 = 팀당 하루 2c동 → 반일 c·하루 2c 로 예전 결과와 같다.
 */
export function gangformCaps(settings: { gangform: GangformCapacity; gangformTeams?: number }): { perDay: number; perSlot: number; perTeamPerDay: number } {
  const teams = settings.gangformTeams ?? 1
  const n = settings.gangform.per === "slot" ? settings.gangform.count * 2 : settings.gangform.count
  return { perDay: teams * n, perSlot: teams * Math.ceil(n / 2), perTeamPerDay: n }
}

export type HalfDayOptions = {
  /** 알폼 오후 투입 가능 (오후 + 다음날 오전) */
  alformPMStart: boolean
  /** 먹매김 오전 완료 시 같은 날 오후 갱폼인양 */
  gangformPMAfterMarking: boolean
  /** 갱폼 오전 완료 시 오후 벽철근 — 벽철근을 오후 칸에 둘 수 있다 */
  wallRebarPM: boolean
  /** 슬래브철근 오후 가능 (기전·검측이 다음날 오전으로 밀림) */
  slabRebarPM: boolean
}

export type SiteSettings = {
  /** 동 수 */
  buildingCount: number
  /** 철근팀 수 (반일 칸당 동시에 처리할 수 있는 동 수) */
  rebarTeams: number
  /** 철근팀이 벽(오전)+슬래브(오후)를 같은 날 병행할 수 있는가. false 면 하루 1작업 */
  rebarWallAndSlabSameDay: boolean
  /** 알폼팀 수 */
  alformTeams: number
  gangform: GangformCapacity
  /** 갱폼팀 수 (없으면 1) */
  gangformTeams?: number
  /** 1일 타설 가능 동수 (펌프카·레미콘) */
  pourPerDay: number
  halfDay: HalfDayOptions
  /** 오후 단독 투입 불가 — 그날 오전에 그 팀 작업이 없으면 오후부터 투입 안 함 */
  noPMOnlyStart: { rebar: boolean; alform: boolean }
}

export const ALL_HALF_DAY_ON: HalfDayOptions = {
  alformPMStart: true,
  gangformPMAfterMarking: true,
  wallRebarPM: true,
  slabRebarPM: true,
}

export const ALL_HALF_DAY_OFF: HalfDayOptions = {
  alformPMStart: false,
  gangformPMAfterMarking: false,
  wallRebarPM: false,
  slabRebarPM: false,
}

const BASE: SiteSettings = {
  buildingCount: 5,
  rebarTeams: 1,
  rebarWallAndSlabSameDay: true,
  alformTeams: 1,
  gangform: { per: "day", count: 1 },
  pourPerDay: 1,
  halfDay: ALL_HALF_DAY_OFF,
  noPMOnlyStart: { rebar: false, alform: false },
}

/** §8 표의 각 행. 키는 표의 순서. */
export const SCENARIO_2026_10 = {
  /** 철근 2팀 가정(잘못된 가정, 참고용) */
  rebarTwoTeams: {
    ...BASE,
    rebarTeams: 2,
    halfDay: ALL_HALF_DAY_ON,
    gangform: { per: "slot", count: 1 },
  },
  /** 철근 1팀, 벽·슬래브 각 하루 */
  rebarOnePerDay: { ...BASE, rebarWallAndSlabSameDay: false },
  /** 철근 1팀, 벽 오전+슬래브 오후, 반일 옵션 전부 끔 */
  halfDayOff: { ...BASE },
  /** 반일 옵션 전부 켬, 갱폼 하루 1동 */
  halfDayOnGangformPerDay: { ...BASE, halfDay: ALL_HALF_DAY_ON },
  /** 반일 옵션 전부 켬, 갱폼 반일 1동 */
  halfDayOnGangformPerSlot: {
    ...BASE,
    halfDay: ALL_HALF_DAY_ON,
    gangform: { per: "slot", count: 1 },
  },
  /** 위 + 오후 단독투입 불가 */
  halfDayOnNoPMOnlyStart: {
    ...BASE,
    halfDay: ALL_HALF_DAY_ON,
    gangform: { per: "slot", count: 1 },
    noPMOnlyStart: { rebar: true, alform: true },
  },
} as const satisfies Record<string, SiteSettings>
