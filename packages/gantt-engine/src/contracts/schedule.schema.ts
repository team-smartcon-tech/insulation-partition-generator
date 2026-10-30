import { z } from "zod"

// 공정 시뮬레이션 계약. 설정값(설계 문서 §5)과 결과 모양을 화면·서버·엔진이 함께 쓴다.
// 엔진(packages/engine)의 SiteSettings 타입은 이 스키마와 같아야 한다(엔진 쪽에서 컴파일 타임에 대조).

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")

export const halfDayOptionsSchema = z.object({
  alformPMStart: z.boolean(),
  gangformPMAfterMarking: z.boolean(),
  wallRebarPM: z.boolean(),
  slabRebarPM: z.boolean(),
})

/**
 * 지하·저층(재래식 거푸집) 공정 설정 (설계 §8-2, 2026-10-30 2안). 소요는 작업일(일요일 제외) 기준.
 * 기본값은 남원주역세권 2차 2026-02~10 작업일보 실적의 동·층별 공종 작업일수 중앙값 — 현장에서 고친다.
 */
export const undergroundSettingsSchema = z.object({
  durations: z.object({
    wallRebar: z.number().int().min(1).max(60),
    wallMep: z.number().int().min(0).max(60), // W철근과 병행
    formWall: z.number().int().min(1).max(60),
    shoring: z.number().int().min(0).max(60),
    formSlab: z.number().int().min(1).max(60),
    slabRebar: z.number().int().min(1).max(60),
    slabMep: z.number().int().min(0).max(60), // S철근과 병행
  }),
  /** 벽·기둥을 바닥과 따로 먼저 타설(W타설 1일)하는가. 끄면 바닥 타설 때 함께 */
  separateWallPour: z.boolean(),
  /** 지하·저층이 끝나고 기준층 사이클(갱폼)을 시작하기까지 전환 작업일 (갱폼 설치 등, 가정값) */
  transitionDays: z.number().int().min(0).max(60),
})

export const DEFAULT_UNDERGROUND_SETTINGS: z.infer<typeof undergroundSettingsSchema> = {
  durations: { wallRebar: 6, wallMep: 6, formWall: 9, shoring: 4, formSlab: 6, slabRebar: 4, slabMep: 7 },
  separateWallPour: false,
  transitionDays: 10,
}

export const siteSettingsSchema = z.object({
  buildingCount: z.number().int().min(1).max(30),
  rebarTeams: z.number().int().min(1).max(10),
  rebarWallAndSlabSameDay: z.boolean(),
  alformTeams: z.number().int().min(1).max(10),
  gangform: z.object({ per: z.enum(["day", "slot"]), count: z.number().int().min(1).max(10) }),
  pourPerDay: z.number().int().min(1).max(10),
  halfDay: halfDayOptionsSchema,
  noPMOnlyStart: z.object({ rebar: z.boolean(), alform: z.boolean() }),
  /** 지하·저층 공정. 없으면 DEFAULT_UNDERGROUND_SETTINGS */
  underground: undergroundSettingsSchema.optional(),
})

export const calendarConfigSchema = z.object({
  holidays: z.array(isoDateSchema),
  sundayOff: z.boolean().optional(),
  saturdayPourAllowed: z.boolean().optional(),
  winterCuringMonths: z.array(z.number().int().min(1).max(12)).optional(),
})

export const simulateRequestSchema = z.object({
  settings: siteSettingsSchema,
  calendar: calendarConfigSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  /** 이 날짜부터 돌리되 집계는 from~to 만 한다 (사이클이 이미 도는 상태를 만드는 예열). 없으면 from 30일 전. */
  warmupFrom: isoDateSchema.optional(),
})

export const stageSchema = z.enum([
  "MARK",
  "GANGFORM",
  "WALL_REBAR",
  "WALL_MEP",
  "ALFORM",
  "TOP_INSULATION",
  "SLAB_REBAR",
  "SLAB_MEP",
  "POUR",
  "CURE",
  // 지하·저층(재래식 거푸집) — 실적 표시용. 예정 계산(시뮬레이터)은 아직 기준층 사이클만 (설계 §8-2)
  "FORM_WALL",
  "FORM_SLAB",
  "SHORING",
  "POUR_WALL",
  "POUR_COLUMN",
])

export const halfSchema = z.enum(["AM", "PM"])

export const assignmentSchema = z.object({
  date: isoDateSchema,
  half: halfSchema,
  buildingId: z.number().int(),
  stage: stageSchema,
  floor: z.number().int(),
  /** 옥탑 몇 번째 층인가 (1 = PH1). 기준층 사이클이면 없음 */
  roof: z.number().int().min(1).optional(),
})

export const dayInfoSchema = z.object({
  date: isoDateSchema,
  dayOfWeek: z.number().int().min(0).max(6),
  isSunday: z.boolean(),
  isSaturday: z.boolean(),
  isHoliday: z.boolean(),
  workable: z.boolean(),
  pourAllowed: z.boolean(),
  craneAllowed: z.boolean(),
  curingDays: z.union([z.literal(0), z.literal(1)]),
})

const teamIdleSchema = z.object({ fullDays: z.number().int(), halfDays: z.number().int() })

export const periodStatsSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  pours: z.number().int(),
  pourGapDays: z.number().int(),
  idle: z.object({ rebar: teamIdleSchema, alform: teamIdleSchema, gangform: teamIdleSchema }),
})

export const simulateResponseSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  days: z.array(dayInfoSchema),
  buildingIds: z.array(z.number().int()),
  assignments: z.array(assignmentSchema),
  stats: periodStatsSchema,
})

/** 2026년 10월 공휴일: 3일(개천절, 토), 5일(대체공휴일, 월), 9일(한글날, 금). 11월은 없음. 실제 운영 달력은 DB 로 간다. */
/** 2026년 4분기 공휴일: 개천절(토), 대체공휴일(월), 한글날(금), 성탄절(금). 11월은 없다. */
export const KR_HOLIDAYS_2026_Q4: string[] = ["2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25"]

/** 설계 문서 §8 굵은 행(반일 옵션 전부 켬, 갱폼 반일 1동, 오후 단독투입 불가). 화면의 기본값. */
export const DEFAULT_SITE_SETTINGS: z.infer<typeof siteSettingsSchema> = {
  buildingCount: 5,
  rebarTeams: 1,
  rebarWallAndSlabSameDay: true,
  alformTeams: 1,
  gangform: { per: "slot", count: 1 },
  pourPerDay: 1,
  halfDay: {
    alformPMStart: true,
    gangformPMAfterMarking: true,
    wallRebarPM: true,
    slabRebarPM: true,
  },
  noPMOnlyStart: { rebar: true, alform: true },
}

export const STAGE_LABEL: Record<z.infer<typeof stageSchema>, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "벽철근",
  WALL_MEP: "기전·검측(벽)",
  ALFORM: "알폼",
  TOP_INSULATION: "바닥단열재(최상층)",
  SLAB_REBAR: "슬래브철근",
  SLAB_MEP: "기전·검측(슬래브)",
  POUR: "S타설(바닥 타설)",
  CURE: "양생",
  FORM_WALL: "벽체 거푸집",
  FORM_SLAB: "바닥 거푸집",
  SHORING: "시스템",
  POUR_WALL: "W타설(벽체·합벽 타설)",
  POUR_COLUMN: "C타설(기둥 타설)",
}

// ── 현장 실적 기반 계획 (작업일보 → 출발 상태 → 예정) ────────────────────────
export const planRequestSchema = z.object({
  siteId: z.string().min(1),
  settings: siteSettingsSchema,
  calendar: calendarConfigSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  /** 이 날짜까지의 일보를 실적으로 본다. 없으면 오늘(KST) */
  upTo: isoDateSchema.optional(),
})

/** 실적 한 칸: 그날 그 동이 한 단계 (일보에는 오전/오후 구분이 없다) */
export const actualWorkSchema = z.object({
  date: isoDateSchema,
  buildingId: z.number().int(),
  stage: stageSchema,
  floor: z.number().int(),
  /** 숫자로 못 나타내는 층 표기 ("RF"). 있으면 화면은 이것을 쓴다 */
  floorLabel: z.string().optional(),
})

export const buildingLabelSchema = z.object({ id: z.number().int(), label: z.string() })

export const planResponseSchema = simulateResponseSchema.extend({
  /** 실적이 있는 마지막 일보 날짜. 예정은 그 다음 날부터. 일보가 없으면 null (그때 assignments 는 예열 시뮬레이션) */
  asOf: isoDateSchema.nullable(),
  buildings: z.array(buildingLabelSchema),
  actual: z.array(actualWorkSchema),
  /** 기간 안에 일보가 있던 날짜들 (본문이 비어 있어도 포함) */
  reportDates: z.array(isoDateSchema),
  /** 예정을 계산하지 않은 동 — 지하·저층 공정 중이라 엔진(기준층 사이클)이 이어서 계산할 수 없다 */
  unplanned: z.array(z.number().int()).default([]),
  /** 지하·저층 순서표(재래식)로 예정을 낸 동 */
  underground: z.array(z.number().int()).default([]),
  /** 이 현장의 첫 작업일보 날짜. 보는 달에 쓸 실적이 없을 때 안내용 (일보가 아예 없으면 null) */
  firstReportDate: isoDateSchema.nullable().default(null),
})

export type PlanRequest = z.infer<typeof planRequestSchema>
export type ActualWork = z.infer<typeof actualWorkSchema>
export type BuildingLabel = z.infer<typeof buildingLabelSchema>
export type PlanResponse = z.infer<typeof planResponseSchema>

export type HalfDayOptions = z.infer<typeof halfDayOptionsSchema>
export type SiteSettings = z.infer<typeof siteSettingsSchema>
export type UndergroundSettings = z.infer<typeof undergroundSettingsSchema>
export type CalendarConfig = z.infer<typeof calendarConfigSchema>
export type SimulateRequest = z.infer<typeof simulateRequestSchema>
export type Stage = z.infer<typeof stageSchema>
export type Half = z.infer<typeof halfSchema>
export type Assignment = z.infer<typeof assignmentSchema>
export type DayInfo = z.infer<typeof dayInfoSchema>
export type PeriodStats = z.infer<typeof periodStatsSchema>
export type SimulateResponse = z.infer<typeof simulateResponseSchema>
