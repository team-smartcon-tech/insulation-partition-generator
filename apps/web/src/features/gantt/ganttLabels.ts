/**
 * 공정표 공종 이름·묶음·순서·층 표기 — 간트 화면과 엑셀 저장이 같이 쓴다.
 * 색은 화면(Tailwind 클래스, GanttChart)과 엑셀(GROUP_FILL 헥스)로 나눠 둔다. 두 곳을 같이 고친다.
 */
import type { Stage } from "@ipg/gantt-engine";

export type Group = "cure" | "gangform" | "rebar" | "mep" | "alform" | "insulation" | "pour" | "form" | "shoring";

export const STAGE_GROUP: Record<Stage, Group> = {
  MARK: "cure",
  GANGFORM: "gangform",
  WALL_REBAR: "rebar",
  WALL_MEP: "mep",
  ALFORM: "alform",
  TOP_INSULATION: "insulation",
  SLAB_REBAR: "rebar",
  SLAB_MEP: "mep",
  POUR: "pour",
  CURE: "cure",
  FORM_WALL: "form",
  FORM_SLAB: "form",
  SHORING: "shoring",
  POUR_WALL: "pour",
  POUR_COLUMN: "pour",
};

export const GROUP_LABEL: Record<Group, string> = {
  cure: "양생·먹매김",
  gangform: "갱폼",
  rebar: "W·S철근",
  mep: "W·S기전",
  alform: "알폼",
  insulation: "단열재(최상층)",
  pour: "W·C·S타설",
  form: "W·S거푸집(지하)",
  shoring: "시스템(동바리)",
};

/** 상자 안 세로 글자 (반일 칸이 좁아 짧게). W철근 = 벽철근, S철근 = 슬래브철근 */
export const STAGE_TEXT: Record<Stage, string> = {
  MARK: "먹매김",
  GANGFORM: "갱폼",
  WALL_REBAR: "W철근",
  WALL_MEP: "W기전",
  ALFORM: "알폼",
  TOP_INSULATION: "단열재",
  SLAB_REBAR: "S철근",
  SLAB_MEP: "S기전",
  POUR: "S타설",
  CURE: "양생",
  FORM_WALL: "W거푸집",
  FORM_SLAB: "S거푸집",
  SHORING: "시스템",
  POUR_WALL: "W타설",
  POUR_COLUMN: "C타설",
};


export const STAGE_TITLE: Record<Stage, string> = {
  MARK: "양생·먹매김",
  GANGFORM: "갱폼인양",
  WALL_REBAR: "W철근(벽철근)",
  WALL_MEP: "W기전(벽 기전·검측)",
  ALFORM: "알폼",
  TOP_INSULATION: "바닥단열재(최상층)",
  SLAB_REBAR: "S철근(슬래브철근)",
  SLAB_MEP: "S기전(슬래브 기전·검측)",
  POUR: "S타설(바닥 타설)",
  CURE: "양생",
  FORM_WALL: "W거푸집(벽체 거푸집)",
  FORM_SLAB: "S거푸집(바닥 거푸집)",
  SHORING: "시스템(시스템 동바리)",
  POUR_WALL: "W타설(벽체·합벽 타설)",
  POUR_COLUMN: "C타설(기둥 타설)",
};

export const STAGE_INDEX: Record<Stage, number> = {
  MARK: 0,
  GANGFORM: 1,
  WALL_REBAR: 2,
  WALL_MEP: 3,
  ALFORM: 4,
  TOP_INSULATION: 5,
  SLAB_REBAR: 6,
  SLAB_MEP: 7,
  POUR: 8,
  CURE: 9,
  // 지하·저층 순서: 벽 거푸집 → 벽 철근 → 기전 → 시스템 → 바닥 거푸집 → 바닥 철근 → 기전 → 타설
  FORM_WALL: 1.5,
  SHORING: 4.2,
  POUR_COLUMN: 3.5, // 벽 기전 뒤 기둥·벽 타설(분리 타설)
  POUR_WALL: 3.6,
  FORM_SLAB: 4.5,
};

/** 실적 층 표시: RF 같은 표기 그대로, 지하는 B1F */
export const actualFloorText = (w: { floor: number; floorLabel?: string }) => w.floorLabel ?? (w.floor < 0 ? `B${-w.floor}F` : `${w.floor}F`);

export const isPour = (s: Stage) => s === "POUR" || s === "POUR_WALL" || s === "POUR_COLUMN";

/** 층 표시: 옥탑은 PH1·PH2, 그 외 42F */
export const floorLabel = (a: { floor: number; roof?: number }) => (a.roof ? `PH${a.roof}` : a.floor < 0 ? `B${-a.floor}F` : `${a.floor}F`);

/** 엑셀 칸 배경·테두리 색 (화면 GROUP_STYLE 의 Tailwind 색과 같은 값) */
export const GROUP_FILL: Record<Group, { bg: string; border: string }> = {
  cure: { bg: "F5F5F4", border: "A8A29E" }, // stone-100 / stone-400
  gangform: { bg: "D1FAE5", border: "10B981" }, // emerald
  rebar: { bg: "EDE9FE", border: "8B5CF6" }, // violet
  mep: { bg: "FEF3C7", border: "F59E0B" }, // amber
  alform: { bg: "E0F2FE", border: "0EA5E9" }, // sky
  insulation: { bg: "D9F99D", border: "65A30D" }, // lime-200 / lime-600
  pour: { bg: "FFE4E6", border: "F43F5E" }, // rose
  form: { bg: "E0F2FE", border: "0EA5E9" }, // sky (알폼과 같은 색)
  shoring: { bg: "E2E8F0", border: "64748B" }, // slate
};
