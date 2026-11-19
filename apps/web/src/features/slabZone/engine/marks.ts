/**
 * 슬래브 기호 읽기 — 구조평면도의 글자에서 슬래브 기호만 골라 종류(데크·PC·RC)를 정한다.
 *
 * 기호는 「층 + 종류 + S + 번호」 꼴이다. 예) RS10(지붕 RC) · -1S2A(지하1층 RC) · DS12(데크) · RPS1(지붕 PC).
 * "P 가 들어가면 PC" 처럼 글자만 보면 PC2(PC 기둥)·RPG1(PC 거더)·DW1(벽)까지 걸리므로,
 * 반드시 슬래브 꼴(…S숫자)인지부터 확인한다.
 */

export type SlabKind = "deck" | "pc" | "rc";

export interface MarkRule {
  /** 데크로 읽을 종류 글자 (쉼표로 여러 개). 기본 "D" */
  deck: string;
  /** PC 로 읽을 종류 글자. 기본 "P" */
  pc: string;
}

export const DEFAULT_RULE: MarkRule = { deck: "D", pc: "P" };

export interface ParsedMark {
  kind: SlabKind;
  /** 슬래브 기호가 아니라 PC 거더·보 기호(RPG1 등) — 슬래브 기호가 없는 칸을 PC 로 추정할 때만 쓴다 */
  aux: boolean;
}

const tokens = (s: string): string[] =>
  s
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z]{1,3}$/.test(t));

// 층 표기: -1 · - (지하 줄임) · 1 · B1 · R · Ra · Rh …  글자는 짧은 쪽부터 맞춰 본다
const FLOOR = String.raw`(?:-\d{0,2}|\d{1,2}|B\d{1,2}|[A-Za-z]{1,2}?)`;

/** 보·거더 기호 (RG20 · -1B9C · RPG14C(S) · RWG31 …) — 글자가 놓인 방향이 곧 부재 방향이다 */
const BEAM = new RegExp(`^${FLOOR}??[A-Z]{0,2}[GB]\\d{1,3}[A-Za-z]?(?:\\([A-Za-z]\\))?$`);
export const isBeamMark = (text: string): boolean => text.length >= 2 && text.length <= 12 && BEAM.test(text);

export interface MarkMatcher {
  parse(text: string): ParsedMark | null;
}

export function buildMatcher(rule: MarkRule = DEFAULT_RULE): MarkMatcher {
  const deck = tokens(rule.deck);
  const pc = tokens(rule.pc);
  const types = [...deck, ...pc].sort((a, b) => b.length - a.length);
  const typeAlt = types.length ? `(${types.join("|")})?` : "()";
  // 층 글자는 가능한 한 짧게 잡는다 — "PS1" 을 「층 P + RC」가 아니라 「PC」로 읽기 위해
  const slab = new RegExp(`^${FLOOR}??${typeAlt}S\\d{1,3}[A-Za-z]?$`);
  const girder = pc.length ? new RegExp(`^${FLOOR}??(?:${pc.join("|")})[GB]\\d{1,3}[A-Za-z]?(?:\\([A-Za-z]\\))?$`) : null;

  return {
    parse(raw: string): ParsedMark | null {
      const text = raw.trim();
      if (text.length < 2 || text.length > 10) return null;
      const m = slab.exec(text);
      if (m) {
        const t = m[1];
        if (t && deck.includes(t)) return { kind: "deck", aux: false };
        if (t && pc.includes(t)) return { kind: "pc", aux: false };
        return { kind: "rc", aux: false };
      }
      if (girder?.test(text)) return { kind: "pc", aux: true };
      return null;
    },
  };
}
