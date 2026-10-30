// 스마트 공정표 엔진 — 순수 계산 + 화면·서버 공용 계약(zod). 규칙의 1차 소스는 docs/gantt/설계.md
// 계약(contracts)의 타입 이름이 엔진 내부 타입과 같아(CalendarConfig·Stage·Assignment 등) 계약 쪽을 대표로 내보내고,
// 엔진 모듈은 함수·상수와 엔진 전용 타입만 이름을 골라 내보낸다.
export * from "./contracts/index.ts"
export * from "./calendar/date.ts"
export { getDayInfo, isWinterCuring, previousCraneDay } from "./calendar/calendar.ts"
export { ALL_HALF_DAY_ON, ALL_HALF_DAY_OFF, SCENARIO_2026_10 } from "./rules/settings.ts"
export { ROOFTOP_SEQUENCE, UNDERGROUND_STAGES, STAGES, STAGE_TEAM, STAGE_SLOTS, nextStage, type Team } from "./rules/stages.ts"
export {
  simulate,
  buildSlots,
  initialBuildings,
  type Slot,
  type BuildingState,
  type SimulationInput,
  type SimulationResult,
} from "./simulator/simulator.ts"
export { periodStats, type TeamIdle } from "./simulator/stats.ts"
export {
  addWorkdays,
  nextStory,
  planUnderground,
  undergroundSequence,
  undergroundStateFromActual,
  type UgAssignment,
  type UgBuilding,
  type UgResult,
  type UgStep,
} from "./simulator/underground.ts"
export { renderText } from "./simulator/render.ts"
export * from "./daily-report/parse-work-text.ts"
export { isNumberedFormat, parseNumbered } from "./daily-report/parse-numbered.ts"
export { progressFromReports, type Progress } from "./daily-report/progress.ts"
export { buildingNoOf, groupLinesToCoreGroups, groupLinesToCores } from "./rules/smartworks.ts"
export {
  aggregateFinish,
  orderFinishTypes,
  type FinishBuilding,
  type FinishBuildingIn,
  type FinishCell,
  type FinishResult,
  type FinishRoomIn,
  type FinishSeqIn,
  type FinishType,
  type FinishTypeIn,
  type FinishTypeStat,
  type FinishWorkIn,
} from "./finish/aggregate.ts"
export {
  FINISH_TRADES,
  buildFinishGantt,
  finishTradeOf,
  floorRangeText,
  type FinishBar,
  type FinishGantt,
  type FinishGanttBuilding,
  type FinishGanttRow,
  type FinishTrade,
  type FinishTradeKey,
} from "./finish/gantt.ts"
export { DEFAULT_FINISH_PLAN, finishPlanOf, planFinishBuilding, type FinishPlanRow } from "./finish/plan.ts"
export { buildFinishReportBars, parseFinishReport, type FinishReportBar, type FinishReportItem, type FinishReportRow } from "./finish/report.ts"
