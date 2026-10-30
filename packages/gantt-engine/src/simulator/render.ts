// 디버그·검증용 텍스트 간트. 동별 한 줄, 날짜별 "오전/오후" 두 글자.
import { STAGE_LABEL, type Stage } from "../rules/stages.ts"
import type { SimulationResult } from "./simulator.ts"

const SHORT: Record<Stage, string> = {
  MARK: "먹",
  GANGFORM: "갱",
  WALL_REBAR: "벽",
  WALL_MEP: "검",
  ALFORM: "알",
  TOP_INSULATION: "단",
  SLAB_REBAR: "슬",
  SLAB_MEP: "검",
  POUR: "타",
  CURE: "양",
  FORM_WALL: "벽",
  FORM_SLAB: "바",
  SHORING: "동",
  FORM_STRIP: "해",
}

export function renderText(result: SimulationResult): string {
  const dates = [...new Set(result.slots.map((s) => s.date))]
  const header = "동    " + dates.map((d) => d.slice(5).replace("-", "")).join(" ")
  const lines = result.buildings.map((b) => {
    const cells = dates.map((d) => {
      const am = result.assignments.find(
        (a) => a.buildingId === b.id && a.date === d && a.half === "AM",
      )
      const pm = result.assignments.find(
        (a) => a.buildingId === b.id && a.date === d && a.half === "PM",
      )
      return `${am ? SHORT[am.stage] : "·"}${pm ? SHORT[pm.stage] : "·"}  `
    })
    return `${String(b.id).padStart(3)}동 ${cells.join(" ")}`
  })
  const legend = Object.entries(SHORT)
    .map(([k, v]) => `${v}=${STAGE_LABEL[k as Stage]}`)
    .join(", ")
  return [header, ...lines, legend].join("\n")
}
