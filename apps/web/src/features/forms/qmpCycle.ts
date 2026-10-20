/**
 * 품질관리계획서 서식의 **작성 주기**와 주기별 진척.
 *
 * 서식은 한 번 쓰고 끝나는 것만 있는 게 아니다 — 월간 공정표·보관상태 점검은 매달, 품질목표 운영
 * 현황은 분기마다, 내부심사는 해마다 쓴다(2026-10-15 사용자 요청). 그래서 서식마다 주기를 정하고,
 * 착공일부터 오늘까지 "써야 했던 횟수 중 몇 번 썼나"를 센다.
 *
 * 주기는 **현장마다 다르다** — 현장마다 품질관리계획서를 따로 승인받기 때문이다. 회사 기본값은 부산
 * 장안 계획서(P0453C-PQP-01 개정 2) 각 절 "업무절차"의 문구("매월", "월 1회 이상 순회점검",
 * "매 분기별 모니터링", "연 1회 이상")로 정했고, 현장은 자기 계획서에 맞게 바꾼다(`QmpSiteSettings`).
 */

export type QmpCycle =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "half"
  | "yearly"
  | "once"
  | "completion"
  | "adhoc"
  /**
   * 옛 값 — 처음엔 "외부 작성"을 주기로 두었다. 지금은 주기와 따로(`isExternal`) 두고 결과를 올려 센다.
   * 이미 저장된 설정에 남아 있을 수 있어 읽기만 한다(`cycleOf` 가 기본 주기로 바꿔 읽는다).
   */
  | "external";

/** 주기를 정해 횟수를 세는 것들 */
export const PERIODIC: QmpCycle[] = ["weekly", "monthly", "quarterly", "half", "yearly"];

export const CYCLE_LABEL: Record<QmpCycle, string> = {
  weekly: "주간",
  monthly: "월간",
  quarterly: "분기",
  half: "반기",
  yearly: "연간",
  once: "한 번",
  completion: "준공 때",
  adhoc: "수시",
  external: "외부 작성",
};

/** 설정 창에서 고르는 순서 */
export const CYCLE_ORDER: QmpCycle[] = ["once", "adhoc", "weekly", "monthly", "quarterly", "half", "yearly", "completion"];

/**
 * 회사 기본 주기. 여기 없는 서식(참고 문서 제외)은 "한 번"(현장 초기에 쓰고 바뀔 때 고친다)이다.
 * 근거는 부산 장안 계획서의 절·항 번호.
 */
export const DEFAULT_CYCLES: Record<string, QmpCycle> = {
  // 정해진 주기
  "8.6-3": "weekly", // 8.6.4.4 주간 예정공정표 — 스마트우미 공정 화면에서 작성(외부 작성)
  "8.6-2": "monthly", // 8.6.4.4 월간 예정공정표(3개월 공정표) — 외부 작성
  "8.10-4": "monthly", // 8.10.5.2 월 1회 이상 순회점검
  "8.11-7": "monthly", // 8.11.6.4 매월 품질검사 실적보고서
  "7.2-2": "monthly", // 7.2.5.8 매월초 익월 교정대상 파악
  "6.2-3": "quarterly", // 양식 제목 "품질목표 운영 현황 (1분기)"
  "8.1-2": "quarterly", // 8.1.5.1 매 분기별 모니터링
  "8.11-8": "quarterly", // 8.11.6.4 분기별 기성청구 시
  "4.2-2": "quarterly", // 양식의 "분기별 실시건수" 칸(계획서는 "계획된 주기")
  "7.4-3": "yearly", // 7.4.5.2 연도별 교육훈련 계획표
  "9.1-2": "yearly", // 9.1.5.1 년 1회 이상
  "9.2-1": "yearly", // 9.2.5.2 매년 12월
  "9.3-2": "yearly", // 9.3.5.1 매년 1월
  "9.3-3": "yearly", // 9.3.4.2 연 1회 이상
  "9.3-4": "yearly",
  "9.4-2": "yearly", // 9.4.4.1 연 1회 이상
  "6.3-2": "yearly", // 6.3.5.1 최소 연 1회 모니터링
  // 준공 때
  "8.13-1": "completion",
  "8.13-2": "completion",
  // 일이 생길 때마다(대장·요청서·보고서)
  ...Object.fromEntries(
    [
      "4.3-3", "6.1-3", "6.1-4", "7.1-3", "7.2-3", "7.3-2", "7.4-4", "7.4-5", "7.4-6", "7.5-2", "7.5-3", "7.5-4",
      "7.6-2", "7.6-3", "7.6-4", "8.1-3", "8.2-2", "8.2-3", "8.3-3", "8.3-4", "8.3-5", "8.4-3", "8.4-4", "8.4-5",
      "8.4-6", "8.6-5", "8.6-6", "8.6-7", "8.6-8", "8.7-2", "8.7-3", "8.8-2", "8.9-2", "8.11-3", "8.11-4", "8.11-5",
      "8.11-6", "8.11-9", "8.11-10", "8.12-2", "8.12-3", "8.12-4", "8.12-5", "10.1-2", "10.1-3", "10.1-4", "10.2-2",
    ].map((code) => [code, "adhoc" as QmpCycle]),
  ),
};

/** 현장별 작성 일정 — 서버 `form_sites.qmp_settings` 에 통째로 담는다 */
export interface QmpSiteSettings {
  /** 착공일(YYYY-MM-DD). 주기 서식은 이날부터 센다. 없으면 주기 진척을 세지 않는다. */
  startDate?: string;
  /** 회사 기본값과 다른 주기만 */
  cycles?: Record<string, QmpCycle>;
  /** 이 현장 계획서가 적용 제외한 절(예: "8.3", "8.9") */
  excluded?: string[];
  /**
   * 수시 서식: 마지막 기록 뒤 며칠이 지나면 "N일째 기록 없음" 알림을 띄우나. 기본과 다른 서식만,
   * 0 이면 알림 끔(민원대장처럼 일이 없으면 비는 게 정상인 서식).
   */
  alertDays?: Record<string, number>;
  /** 회사 기본(`DEFAULT_EXTERNAL`)과 다르게 정한 "외부 작성" 여부(서식 번호 → 참/거짓) */
  externalForms?: Record<string, boolean>;
  /** "외부 작성" 서식: 그 시스템에서 이 현장 화면으로 가는 주소(서식 번호 → 주소) */
  externalLinks?: Record<string, string>;
  updatedAt?: number;
  updatedBy?: string;
}

/** 수시 서식 알림 기본 — 한 달 */
export const DEFAULT_ALERT_DAYS = 30;
/** 설정 창에서 고르는 알림 날수(0 = 끔) */
export const ALERT_DAY_CHOICES = [7, 14, 30, 60, 90, 0];

export function alertDaysOf(code: string, settings?: QmpSiteSettings): number {
  return settings?.alertDays?.[code] ?? DEFAULT_ALERT_DAYS;
}

/**
 * 이 현장에서 미리 알고 있는 외부 작성 주소(서식 번호 → 주소) — 설정에 없을 때 쓴다.
 * 부산장안(B1): 사용자가 알려 준 스마트우미 공정 화면. 주소의 cd7603f0… 는 스마트덱 현장 번호다.
 */
const BUSAN_PROCESS =
  "https://sw.smartwoomi.com/process/frame/auto_cd7603f0-ed9e-4b12-a150-90813ce35d9d_%EA%B3%A8%EC%A1%B0_1774230094168";
const KNOWN_EXTERNAL: [RegExp, Record<string, string>][] = [
  [
    /장안/,
    {
      "8.6-2": `${BUSAN_PROCESS}/monthly`, // 3개월 공정표
      "8.6-3": `${BUSAN_PROCESS}/weekly`, // 주간 공정표
    },
  ],
];

/** 외부 작성 서식의 주소 — 현장 설정 → 미리 알고 있는 현장 주소 순. 없으면 undefined */
export function externalLinkOf(code: string, settings: QmpSiteSettings | undefined, siteName: string | undefined): string | undefined {
  return settings?.externalLinks?.[code] || KNOWN_EXTERNAL.find(([re]) => re.test(siteName ?? ""))?.[1][code];
}

/** 주소로 쓸 수 있나(http·https 만) */
export function isWebLink(text: string | undefined): boolean {
  return /^https?:\/\/\S+$/i.test(text?.trim() ?? "");
}

export function cycleOf(code: string, settings?: QmpSiteSettings): QmpCycle {
  const chosen = settings?.cycles?.[code];
  if (chosen && chosen !== "external") return chosen;
  return DEFAULT_CYCLES[code] ?? "once";
}

/**
 * 다른 사내 시스템에서 작성하는 서식(회사 기본). 그 시스템에서 뽑은 결과(PDF)를 [결과 올리기]로 올리면
 * 그 주·그 달이 채워진다(2026-10-17 사용자 결정 — 증빙이 서류함에 남고 본사 점검·심사에 쓴다).
 * - 8.6-2 3개월 공정표, 8.6-3 주간 공정표: 스마트우미 공정 화면
 * - 5.1-2 현장 품질방침 및 목표
 */
export const DEFAULT_EXTERNAL = ["8.6-2", "8.6-3", "5.1-2"];

/** 이 현장에서 외부 작성 서식인가 */
export function isExternal(code: string, settings?: QmpSiteSettings): boolean {
  const chosen = settings?.externalForms?.[code];
  if (chosen !== undefined) return chosen;
  return settings?.cycles?.[code] === "external" || DEFAULT_EXTERNAL.includes(code);
}

// ── 기간 ────────────────────────────────────────────────────────────────────

export interface QmpPeriod {
  key: string;
  label: string;
  /** 기간 첫날(로컬 자정 ms) */
  from: number;
}

/** "2025-04-01" → 로컬 날짜. 형식이 틀리면 null */
export function parseDay(text: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text?.trim() ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 그 날짜가 든 기간의 첫날 */
function periodStart(cycle: QmpCycle, date: Date): Date {
  const y = date.getFullYear();
  const m = date.getMonth();
  switch (cycle) {
    case "weekly": {
      // 월요일부터 한 주
      const back = (date.getDay() + 6) % 7;
      return new Date(y, m, date.getDate() - back);
    }
    case "monthly":
      return new Date(y, m, 1);
    case "quarterly":
      return new Date(y, m - (m % 3), 1);
    case "half":
      return new Date(y, m < 6 ? 0 : 6, 1);
    default:
      return new Date(y, 0, 1);
  }
}

function nextStart(cycle: QmpCycle, start: Date): Date {
  const y = start.getFullYear();
  const m = start.getMonth();
  switch (cycle) {
    case "weekly":
      return new Date(y, m, start.getDate() + 7);
    case "monthly":
      return new Date(y, m + 1, 1);
    case "quarterly":
      return new Date(y, m + 3, 1);
    case "half":
      return new Date(y, m + 6, 1);
    default:
      return new Date(y + 1, 0, 1);
  }
}

function describe(cycle: QmpCycle, start: Date): { key: string; label: string } {
  const y = start.getFullYear();
  const m = start.getMonth();
  switch (cycle) {
    case "weekly":
      return { key: `${y}-${pad(m + 1)}-${pad(start.getDate())}`, label: `${m + 1}/${start.getDate()} 주` };
    case "monthly":
      return { key: `${y}-${pad(m + 1)}`, label: `${y}년 ${m + 1}월` };
    case "quarterly":
      return { key: `${y}-Q${m / 3 + 1}`, label: `${y}년 ${m / 3 + 1}분기` };
    case "half":
      return { key: `${y}-H${m < 6 ? 1 : 2}`, label: `${y}년 ${m < 6 ? "상" : "하"}반기` };
    default:
      return { key: `${y}`, label: `${y}년` };
  }
}

/** 그 날짜가 든 기간의 열쇠 */
export function periodKeyOf(cycle: QmpCycle, date: Date): string {
  return describe(cycle, periodStart(cycle, date)).key;
}

/** 착공일이 든 기간부터 오늘이 든 기간까지(오늘 기간 포함) */
export function periodsBetween(cycle: QmpCycle, start: Date, today: Date): QmpPeriod[] {
  if (!PERIODIC.includes(cycle) || start.getTime() > today.getTime()) return [];
  const list: QmpPeriod[] = [];
  const last = periodStart(cycle, today).getTime();
  for (let at = periodStart(cycle, start); at.getTime() <= last && list.length < 600; at = nextStart(cycle, at)) {
    list.push({ ...describe(cycle, at), from: at.getTime() });
  }
  return list;
}

/**
 * 시트 이름에 적힌 때. 월별 장은 이름에 달을 적는다 — `QA-4.2-2(25.09)`, `2026-07`, `26.07`,
 * `2026.7`, `2026년 7월`, 주간 장은 `2026-07-13`. 못 읽으면 null(그때는 만든 날로 본다).
 */
export function sheetDate(sheetName: string): Date | null {
  const name = sheetName.replace(/^QA[\s_-]*\d+\.\d+\.?[\s_-]+\d+/i, " ");
  const full = /(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})(?!\d)/.exec(name);
  if (full) {
    const date = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    if (date.getMonth() === Number(full[2]) - 1) return date;
  }
  const month = /(?:^|[^\d])((?:20)?\d{2})\s*[.\-/년]\s*(\d{1,2})(?:\s*월)?(?!\d)/.exec(name);
  if (month) {
    const year = month[1].length === 2 ? 2000 + Number(month[1]) : Number(month[1]);
    const m = Number(month[2]);
    if (m >= 1 && m <= 12 && year >= 2000 && year < 2100) return new Date(year, m - 1, 1);
  }
  return null;
}

// ── [결과 올리기] 이름 ─────────────────────────────────────────────────────

/**
 * 기간 열쇠 → 이름에 넣을 글자. `sheetDate` 가 날짜(달)를 다시 읽을 수 있게 적는다.
 * 주 "2026-10-12" → "2026-10-12 주", 달 "2026-10", 분기 "2026-Q3" → "2026-07 · 3분기" …
 */
export function periodText(key: string, label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return `${key} 주`;
  if (/^\d{4}-\d{2}$/.test(key)) return key;
  const quarter = /^(\d{4})-Q(\d)$/.exec(key);
  if (quarter) return `${quarter[1]}-${String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, "0")} · ${label}`;
  const half = /^(\d{4})-H(\d)$/.exec(key);
  if (half) return `${half[1]}-${half[2] === "1" ? "01" : "07"} · ${label}`;
  if (/^\d{4}$/.test(key)) return `${key}-01 · ${label}`;
  return label;
}

/** 올릴 서류의 이름 — 서식 번호로 시작해야 그 서식에 붙는다 */
export function resultTitle(code: string, name: string, period?: { key: string; label: string }): string {
  return `QA-${code} ${name}${period ? ` (${periodText(period.key, period.label)})` : ""}`;
}
