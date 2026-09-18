/**
 * 가져오기 / 내보내기 / 초안 저장.
 *
 * 스마트웍스와의 계약은 `smartworks.crane-input` v1 JSON 하나다. 나중에 서버 직결로
 * 바꾸더라도 **같은 모양을 API 응답으로 받으면** 이 파일만 진입점이 바뀌고
 * 화면·엔진은 그대로다 — 그래서 파싱을 여기 한 곳에 가둔다.
 */

import type {
  BuildingFrameProfile,
  CraneInputFile,
  FloorSegment,
  SegmentSource,
  TcRentalPlan,
} from "./types";
import { DEFAULT_PARAMS, mergeParams } from "./engine/constants";
import { emptySegments, floorKey, floorLabel, interpolateSegments } from "./engine/profile";
import { minYmd } from "./engine/dates";

export const CRANE_INPUT_FORMAT = "smartworks.crane-input";
export const CRANE_INPUT_VERSION = 1;

const VALID_SOURCES: SegmentSource[] = [
  "frame_rows",
  "initial_plan",
  "estimated",
  "manual",
  "missing",
];

function normalizeSource(v: unknown): SegmentSource {
  return VALID_SOURCES.includes(v as SegmentSource) ? (v as SegmentSource) : "missing";
}

function normalizeYmd(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

export interface ImportResult {
  plan: TcRentalPlan;
  /** 사용자에게 보여줄 안내 — 추정으로 채운 층 수 등 */
  notes: string[];
}

/**
 * 내보내기 JSON → 계획 문서.
 *
 * 날짜가 빠진 층도 행을 지우지 않고 그대로 들고 와서 보간한다. 행을 버리면 층수가
 * 어긋나 층 번호가 통째로 밀린다.
 */
export function importCraneInput(raw: unknown): ImportResult {
  const file = raw as CraneInputFile;
  if (!file || typeof file !== "object") {
    throw new Error("JSON 파일을 읽을 수 없습니다.");
  }
  if (file.format !== CRANE_INPUT_FORMAT) {
    throw new Error(
      `지원하지 않는 형식입니다. (format: ${String(file.format ?? "없음")}) 스마트웍스에서 내보낸 파일인지 확인해 주세요.`,
    );
  }
  if (Number(file.version) > CRANE_INPUT_VERSION) {
    throw new Error(
      `파일 버전(v${file.version})이 이 도구(v${CRANE_INPUT_VERSION})보다 새롭습니다. 도구를 업데이트해 주세요.`,
    );
  }
  if (!Array.isArray(file.buildings) || file.buildings.length === 0) {
    throw new Error("동 정보가 비어 있습니다.");
  }

  const notes: string[] = [];
  let estimatedFloors = 0;

  const buildings: BuildingFrameProfile[] = file.buildings.map((raw, idx) => {
    const above = Number(raw.aboveFloors) || 0;
    const below = Number(raw.belowFloors) || 0;
    const ph = raw.phFloors == null ? 1 : Number(raw.phFloors) || 0;
    const name = String(raw.buildingName || `동${idx + 1}`).trim();

    // 파일이 준 세그먼트를 층 번호로 색인한 뒤, 표준 층 목록에 얹는다.
    // (파일에 일부 층이 빠져 있어도 층 구성은 belowFloors/aboveFloors 가 결정한다)
    const byFloor = new Map<number, (typeof raw.segments)[number]>();
    for (const s of raw.segments ?? []) {
      if (typeof s?.floor === "number") byFloor.set(s.floor, s);
    }

    const segments: FloorSegment[] = emptySegments(below, above, ph).map((base) => {
      const src = byFloor.get(base.floor);
      if (!src) return base;
      const start = normalizeYmd(src.start);
      const finish = normalizeYmd(src.finish);
      return {
        key: src.key || floorKey(base.floor, above),
        floor: base.floor,
        label: src.label || floorLabel(base.floor, above, ph),
        start,
        finish,
        source: start && finish ? normalizeSource(src.source) : "missing",
      };
    });

    const filled = interpolateSegments(
      segments,
      above,
      DEFAULT_PARAMS,
      normalizeYmd(file.project?.startDate) ?? minYmd(segments.map((s) => s.start)),
    );
    estimatedFloors += filled.filter((s) => s.source === "estimated").length;

    return {
      id: `b-${name}-${idx}`,
      name,
      belowFloors: below,
      aboveFloors: above,
      phFloors: ph,
      householdCount: raw.householdCount ?? null,
      segments: filled,
    };
  });

  if (estimatedFloors > 0) {
    notes.push(`${estimatedFloors}개 층의 일정이 비어 있어 공기산정 표준값으로 추정했습니다.`);
  }
  for (const w of file.warnings ?? []) notes.push(String(w));

  return {
    plan: {
      siteName: file.source?.siteName || "이름 없는 현장",
      sourceLabel:
        file.source?.origin === "initial_plan"
          ? "스마트웍스 초기계획공정표"
          : file.source?.origin === "frame_rows"
            ? "스마트웍스 골구도"
            : "스마트웍스 내보내기",
      buildings,
      units: [],
      assignments: [],
      params: DEFAULT_PARAMS,
      updatedAt: new Date().toISOString(),
    },
    notes,
  };
}

/** 계획 문서를 파일로 저장 (같은 도구로 다시 열 수 있다) */
export function downloadPlanJson(plan: TcRentalPlan) {
  const body = JSON.stringify({ format: "smartdeck.tc-rental-plan", version: 1, plan }, null, 2);
  downloadText(`${plan.siteName}_TC임대기간산정.json`, body, "application/json");
}

/** 저장해 둔 계획 파일 읽기 */
export function readPlanJson(raw: unknown): TcRentalPlan {
  const file = raw as { format?: string; plan?: TcRentalPlan };
  if (file?.format === "smartdeck.tc-rental-plan" && file.plan) {
    // 파라미터가 늘어난 버전과 섞여도 기본값으로 메운다(하위 객체까지)
    return { ...file.plan, params: mergeParams(file.plan.params) };
  }
  throw new Error("이 도구에서 저장한 계획 파일이 아닙니다.");
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([`﻿${text}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 즉시 해제하면 일부 브라우저에서 저장이 취소된다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 초안 저장 ────────────────────────────────────────────────────────────────
// 저장 원천이 아니라 "새로고침으로 날아가는 것"만 막는 안전망이다.
// 계획 문서는 수십 KB 수준이라 localStorage 로 충분하다(단열 Layout 은 DXF 원문 때문에
// IndexedDB 를 쓰지만 여기는 그럴 이유가 없다).

const DRAFT_KEY = "sd-tc-rental-draft";

export function saveDraft(plan: TcRentalPlan) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(plan));
  } catch {
    // 용량 초과·프라이빗 모드 — 초안만 조용히 꺼진다
  }
}

export function loadDraft(): TcRentalPlan | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as TcRentalPlan;
    if (!plan?.buildings) return null;
    return { ...plan, params: mergeParams(plan.params) };
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* noop */
  }
}
