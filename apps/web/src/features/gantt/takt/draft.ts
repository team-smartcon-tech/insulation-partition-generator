// 택트 인원 탭 입력 상태(문자열) ↔ 엔진 입력(TaktInput). 칸이 비거나 숫자가 아니면 NaN — 엔진 검사가 그 칸 오류를 낸다.
import { DEFAULT_TAKT_INPUT, parseBuildingFloors, type TaktInput, type TaktMode, type TaktTrade } from "@ipg/gantt-engine";

export type TradeDraft = {
  /** React key (저장하지 않음) */
  key: string;
  stage: string;
  name: string;
  unit: string;
  qtyPerUnit: string;
  productivity: string;
  waitDays: string;
  /** 인원 직접 지정 — "" 이면 자동. 고정 일수 공종은 팀 인원 */
  crew: string;
  /** 산정 방식 (2026-10-31): rate = 인원 산정, fixed = 고정 일수 */
  mode: TaktMode;
  /** 고정 일수 공종의 구간당 작업일 */
  fixedDays: string;
};

/** 저장된 공종 — 고정 일수 공종은 물량·생산성이 비어(null) 있을 수 있다 */
type LooseTrade = Omit<TaktTrade, "qtyPerUnit" | "productivity"> & { qtyPerUnit: number | null; productivity: number | null };

export type Draft = {
  unitsPerFloor: string;
  zoneFloors: string;
  taktDays: string;
  /** "20,20,25,15,18" */
  buildingFloors: string;
  /** 골조 구간 층수 소요일 (경고용, 비워도 됨) */
  frameZoneDays: string;
  trades: TradeDraft[];
};

let seq = 0;
export const newKey = () => `t${++seq}`;

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

const str = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(n));

export const tradeDraft = (t: LooseTrade): TradeDraft => ({
  key: newKey(),
  stage: String(t.stage),
  name: t.name,
  unit: t.unit,
  qtyPerUnit: str(t.qtyPerUnit),
  productivity: str(t.productivity),
  waitDays: String(t.waitDays),
  crew: str(t.crew),
  mode: t.mode ?? "rate",
  fixedDays: str(t.fixedDays),
});

export function draftOf(input: Omit<TaktInput, "trades"> & { trades: LooseTrade[] }, frameZoneDays: number | null = null): Draft {
  return {
    unitsPerFloor: String(input.unitsPerFloor),
    zoneFloors: String(input.zoneFloors),
    taktDays: String(input.taktDays),
    buildingFloors: input.buildingFloors.join(","),
    frameZoneDays: frameZoneDays == null ? "" : String(frameZoneDays),
    trades: input.trades.map(tradeDraft),
  };
}

/** 저장된 것이 없는 현장: 예시 기본값. 동별 층수는 설정 탭 동 목록(최상층)이 있으면 그것 */
export const sampleDraft = (buildingFloors?: number[]) =>
  draftOf({ ...DEFAULT_TAKT_INPUT, buildingFloors: buildingFloors?.length ? buildingFloors : DEFAULT_TAKT_INPUT.buildingFloors });

export function inputOf(d: Draft): TaktInput {
  return {
    unitsPerFloor: num(d.unitsPerFloor),
    zoneFloors: num(d.zoneFloors),
    taktDays: num(d.taktDays),
    buildingFloors: parseBuildingFloors(d.buildingFloors) ?? [],
    trades: d.trades.map((t) => ({
      stage: num(t.stage),
      name: t.name,
      unit: t.unit,
      qtyPerUnit: num(t.qtyPerUnit),
      productivity: num(t.productivity),
      waitDays: num(t.waitDays),
      crew: t.crew.trim() === "" ? null : num(t.crew),
      mode: t.mode,
      fixedDays: t.mode === "fixed" ? num(t.fixedDays) : null,
    })),
  };
}

/** 저장된 것과 같은지 비교용 (React key 제외) */
export const draftSig = (d: Draft) => JSON.stringify({ ...d, trades: d.trades.map(({ key: _key, ...t }) => t) });
