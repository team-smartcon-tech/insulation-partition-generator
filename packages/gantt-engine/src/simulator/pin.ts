// 출발 상태 보정 — 예정 첫날 오전·오후 공종 고정 (2026-11-02 사용자: 「공종을 복수로, 오전·오후로」).
//
// 첫날 오전 = am, 오후 = pm 으로 그대로 그리고, 그다음 반일 칸부터 엔진이 이어서 계산한다.
//   - am = 타설이면 그날은 타설로 끝(오후 없음) → 다음 날 한 층 위 먹매김부터. 마지막 타설일 = 그날(양생일 판정).
//   - pm = am 이면 그 공종이 하루(2칸)를 쓴 것. 알폼처럼 2칸이면 끝, 바닥단열재(4칸)면 다음 날 2칸을 더 고정.
//   - pm ≠ am 이면 am 은 오전에 끝난 것으로 보고, pm 은 자기 칸 수만큼(알폼 오후 투입 = 오후 + 다음 날 오전) 고정.
//   - 슬래브 기전으로 끝나면 타설은 다음 날부터(엔진 규칙과 같다).
//   - pm 이 없으면 오전만 고정(오전 공종이 여러 칸이면 그만큼 이어서), 그다음 칸부터 엔진.
// 고정한 칸의 팀 용량은 엔진이 모른다 — 사용자가 정한 값이므로 그대로 둔다.
import { addDays, type IsoDate } from "../calendar/date.ts"
import type { CalendarConfig } from "../calendar/calendar.ts"
import { STAGE_SLOTS, nextStage, type Stage } from "../rules/stages.ts"
import { buildSlots, type Assignment, type BuildingState } from "./simulator.ts"

export type PinnedStart = {
  /** 고정해서 그릴 칸 */
  fixed: Assignment[]
  /** 엔진 출발 상태 (simulate 의 from 과 같은 날짜 기준 칸 번호) */
  state: Pick<BuildingState, "stage" | "readySlot" | "readyDate" | "prevEndSlot" | "floor" | "lastPourDate"> & { done: boolean }
}

export function pinFirstDay(input: {
  calendar: CalendarConfig
  /** 예정 시작일 = simulate 의 from */
  from: IsoDate
  buildingId: number
  floor: number
  topFloor?: number | null
  am: Stage
  /** 없으면 오전만 고정 */
  pm?: Stage | null
  /** 일보의 마지막 타설일 (am 이 타설이 아니면 그대로) */
  lastPourDate: IsoDate | null
}): PinnedStart {
  const slots = buildSlots(input.calendar, input.from, addDays(input.from, 40))
  const at = (i: number, stage: Stage): Assignment => ({ slotIndex: i, date: slots[i].date, half: slots[i].half, buildingId: input.buildingId, stage, floor: input.floor })
  const isTop = input.topFloor != null && input.floor >= input.topFloor
  const slotAt = (date: IsoDate) => {
    const i = slots.findIndex((s) => s.date >= date)
    return i < 0 ? slots.length : i
  }

  // 오전 타설: 그날로 끝, 다음 날 한 층 위 먹매김
  if (input.am === "POUR") {
    const date = slots[0].date
    const readyDate = addDays(date, 1)
    return {
      fixed: [at(0, "POUR")],
      state: {
        stage: "MARK",
        floor: isTop ? input.floor : input.floor + 1,
        done: isTop,
        lastPourDate: date,
        readyDate,
        readySlot: slotAt(readyDate),
        prevEndSlot: 0,
      },
    }
  }

  // 오후를 안 정했으면 오전 공종을 자기 칸 수만큼(알폼 = 오전·오후) 고정하고 끝
  const last: Stage = input.pm ?? input.am
  const fixed: Assignment[] = input.pm ? [at(0, input.am), at(1, input.pm)] : [at(0, input.am)]
  // last 가 더 써야 하는 칸 (같은 공종으로 하루를 채웠으면 2칸, 아니면 1칸을 쓴 것)
  const used = !input.pm ? 1 : input.pm === input.am ? 2 : 1
  const more = Math.max(0, (STAGE_SLOTS[last] ?? 1) - used)
  let end = input.pm ? 1 : 0
  for (let k = 0; k < more; k++) fixed.push(at(++end, last))
  let readySlot = end + 1
  let readyDate = slots[readySlot]?.date ?? addDays(slots[end].date, 1)
  // 슬래브 기전(검측) 다음 타설은 다음 날 (엔진 규칙)
  if (last === "SLAB_MEP") {
    readyDate = addDays(slots[end].date, 1)
    readySlot = slotAt(readyDate)
  }
  return {
    fixed,
    state: {
      stage: nextStage(last, isTop),
      floor: input.floor,
      done: false,
      lastPourDate: input.lastPourDate,
      readyDate,
      readySlot,
      prevEndSlot: end,
    },
  }
}
