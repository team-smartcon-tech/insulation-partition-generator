// 현장 설정값 (설계 문서 §5) 과 §8 검증용 프리셋. 하드코딩된 현장값을 두지 않고 전부 여기서 받는다.

export type GangformCapacity = {
  /** "day" = 하루 N동, "slot" = 반일 N동 (§5 "반일 단위로 센다") */
  per: "day" | "slot"
  count: number
}

export type HalfDayOptions = {
  /** 알폼 오후 투입 가능 (오후 + 다음날 오전) */
  alformPMStart: boolean
  /** 먹매김 오전 완료 시 같은 날 오후 갱폼인양 */
  gangformPMAfterMarking: boolean
  /** 동절기 양생일(타설 다음 날)에도 먹매김 오전 → 오후 갱폼인양. 없으면 false = 양생일 갱폼 불가 */
  curingDayGangformPM?: boolean
  /** 오후 W철근이면 W기전을 같은 오후 칸에 함께 시공 (없으면 false = W기전은 다음 칸부터, 2026-11-05) */
  wallMepWithPMRebar?: boolean
  /** 없앤 설정 (2026-11-05) — 예전에 저장된 값만 남아 있고 엔진은 읽지 않는다. W철근은 오후 칸도 항상 가능 */
  wallRebarPM?: boolean
  /** 없앤 설정 (2026-11-05) — 예전에 저장된 값만 남아 있고 엔진은 읽지 않는다. 슬래브철근은 알폼 오전 완료 뒤 같은 날 오후 항상 가능 */
  slabRebarPM?: boolean
}

export type SiteSettings = {
  /** 동 수 */
  buildingCount: number
  /** 철근팀 수 (반일 칸당 동시에 처리할 수 있는 동 수) */
  rebarTeams: number
  /** 철근팀이 벽(오전)+슬래브(오후)를 같은 날 병행할 수 있는가. false 면 하루 1작업 */
  rebarWallAndSlabSameDay: boolean
  /** 슬래브철근 우선: 같은 칸에 W철근·S철근이 겹치면 S철근 먼저 (오전에도). 없으면 false = 오전은 W철근 먼저 (2026-11-05) */
  slabRebarFirst?: boolean
  /** 알폼팀 수 */
  alformTeams: number
  gangform: GangformCapacity
  /** 1일 타설 가능 동수 (펌프카·레미콘) */
  pourPerDay: number
  /** (없앰 2026-11-05 — 한중 기간 판정으로 합침. 엔진은 읽지 않는다) 동절기 보온양생 2일 */
  winterCuring2Days?: boolean
  halfDay: HalfDayOptions
  /** 오후 단독 투입 불가 — 그날 오전에 그 팀 작업이 없으면 오후부터 투입 안 함 */
  noPMOnlyStart: { rebar: boolean; alform: boolean }
}

export const ALL_HALF_DAY_ON: HalfDayOptions = {
  alformPMStart: true,
  gangformPMAfterMarking: true,
}

export const ALL_HALF_DAY_OFF: HalfDayOptions = {
  alformPMStart: false,
  gangformPMAfterMarking: false,
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
