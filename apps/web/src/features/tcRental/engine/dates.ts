/**
 * 날짜 유틸 — 전부 `YYYY-MM-DD` 문자열 in / 문자열 out.
 *
 * Date 를 쓰되 **UTC 정오**로 만들어 다룬다. 자정 기준으로 만들면 KST(+9)에서
 * `toISOString()` 이 하루 전 날짜를 뱉어 공정표가 통째로 하루씩 밀린다.
 */

const MS_DAY = 86_400_000;

/** "YYYY-MM-DD" → UTC 정오 Date. 형식이 아니면 null */
export function parseYmd(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return toYmd(new Date(d.getTime() + days * MS_DAY));
}

/**
 * 개월 더하기 — 말일 보정 포함(1/31 + 1개월 = 2/28).
 * 임대 기준이 "골조완료 + N개월" 이라 일수가 아니라 달로 세야 한다.
 */
export function addMonths(ymd: string, months: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  // 파라미터가 비어 들어오면(옛 저장본 등) NaN 날짜가 되어 막대가 축 끝으로 튄다
  if (!Number.isFinite(months)) return ymd;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return toYmd(target);
}

/** a → b 경과일 (b - a). 같은 날이면 0 */
export function diffDays(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / MS_DAY);
}

/** 양 끝을 포함한 일수 — 임대 기간은 반입일과 반출일을 모두 센다 */
export function inclusiveDays(from: string, to: string): number {
  return diffDays(from, to) + 1;
}

export function minYmd(list: Array<string | null | undefined>): string | null {
  const ok = list.filter((v): v is string => !!v && !!parseYmd(v));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => (a <= b ? a : b));
}

export function maxYmd(list: Array<string | null | undefined>): string | null {
  const ok = list.filter((v): v is string => !!v && !!parseYmd(v));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => (a >= b ? a : b));
}

/** 한국식 표기 "26.11.10" — 표 안에서 자리를 적게 쓴다 */
export function shortYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const d = parseYmd(ymd);
  if (!d) return "—";
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** 오늘 (로컬 날짜 기준) */
export function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

// ── 순(旬) 축 ────────────────────────────────────────────────────────────────
// 첨부 공정표와 같은 눈금: 한 달을 10일/20일/30일 세 칸으로 나눈다.
// 말일이 28·29·31일이어도 세 번째 칸이 그 달의 남은 날을 전부 가진다.

export interface DecadeCell {
  /** 0부터 증가하는 전체 인덱스 */
  index: number;
  year: number;
  /** 1-12 */
  month: number;
  /** 0 = 상순(1~10), 1 = 중순(11~20), 2 = 하순(21~말일) */
  part: 0 | 1 | 2;
  start: string;
  end: string;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

/** 한 날짜가 속한 순의 (년, 월, part) */
function decadeOf(ymd: string): { year: number; month: number; part: 0 | 1 | 2 } | null {
  const d = parseYmd(ymd);
  if (!d) return null;
  const day = d.getUTCDate();
  const part: 0 | 1 | 2 = day <= 10 ? 0 : day <= 20 ? 1 : 2;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, part };
}

/** [from, to] 구간을 덮는 순 칸 목록 */
export function buildDecadeAxis(from: string, to: string): DecadeCell[] {
  const a = decadeOf(from);
  const b = decadeOf(to);
  if (!a || !b) return [];
  const cells: DecadeCell[] = [];
  let { year, month } = a;
  let part = a.part;
  let index = 0;
  // 종료 순을 지날 때까지 한 칸씩 전진 (최대 40년 — 무한루프 방지)
  for (let guard = 0; guard < 40 * 12 * 3; guard += 1) {
    const last = lastDayOfMonth(year, month);
    const startDay = part === 0 ? 1 : part === 1 ? 11 : 21;
    const endDay = part === 0 ? 10 : part === 1 ? 20 : last;
    cells.push({
      index,
      year,
      month,
      part,
      start: `${year}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
      end: `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
    });
    index += 1;
    if (year === b.year && month === b.month && part === b.part) break;
    if (part === 2) {
      part = 0;
      if (month === 12) {
        month = 1;
        year += 1;
      } else {
        month += 1;
      }
    } else {
      part = (part + 1) as 0 | 1 | 2;
    }
  }
  return cells;
}

/**
 * 날짜를 순 축 위의 연속 좌표로 바꾼다 (칸 단위, 소수 포함).
 * 막대를 칸 경계에 딱 맞추지 않고 실제 날짜 비율로 그리기 위한 것 —
 * 하루짜리 작업이 열흘 칸을 통째로 칠하는 것을 막는다.
 */
export function ymdToAxisPos(axis: DecadeCell[], ymd: string): number | null {
  const d = parseYmd(ymd);
  if (!d || axis.length === 0) return null;
  for (const cell of axis) {
    const s = parseYmd(cell.start);
    const e = parseYmd(cell.end);
    if (!s || !e) continue;
    if (d.getTime() < s.getTime()) return cell.index; // 축 시작 이전 → 왼쪽 끝
    if (d.getTime() <= e.getTime()) {
      const span = diffDays(cell.start, cell.end) + 1;
      const offset = diffDays(cell.start, ymd);
      return cell.index + offset / span;
    }
  }
  return axis.length; // 축 끝 이후 → 오른쪽 끝
}

/** 해당 순이 동절기(파라미터 구간)에 걸치는가 */
export function isWinterDecade(cell: DecadeCell, from: string, to: string): boolean {
  const key = `${String(cell.month).padStart(2, "0")}-${String(
    cell.part === 0 ? 5 : cell.part === 1 ? 15 : 25,
  ).padStart(2, "0")}`;
  return isWithinMonthDay(key, from, to);
}

/** "MM-DD" 가 [from, to] 안인가. 연말을 넘는 구간(12-01 ~ 02-28)도 처리한다 */
export function isWithinMonthDay(md: string, from: string, to: string): boolean {
  if (from <= to) return md >= from && md <= to;
  return md >= from || md <= to;
}

/** 날짜가 동절기에 속하는가 */
export function isWinterDate(ymd: string, from: string, to: string): boolean {
  const d = parseYmd(ymd);
  if (!d) return false;
  const md = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return isWithinMonthDay(md, from, to);
}

// ── 일(日) 기준 좌표 ──────────────────────────────────────────────────────────
// 순 칸을 모두 같은 픽셀 폭으로 그리면 **같은 기간이 위치에 따라 다른 길이로 보인다**
// (상순·중순은 10일, 하순은 11일까지라 최대 10% 차이). 기준층처럼 층마다 같은 일수를
// 쓰는 구간에서 막대 길이가 들쭉날쭉해 보이는 원인이 이것이다.
// 그래서 좌표는 칸이 아니라 **축 시작일로부터의 경과일**로 잡는다.

/** 축이 덮는 전체 일수 (양 끝 포함) */
export function axisDayCount(axis: DecadeCell[]): number {
  if (axis.length === 0) return 1;
  return Math.max(1, diffDays(axis[0].start, axis[axis.length - 1].end) + 1);
}

/** 한 칸이 가진 일수 (하순은 그 달의 말일에 따라 10~11일) */
export function cellDayCount(cell: DecadeCell): number {
  return Math.max(1, diffDays(cell.start, cell.end) + 1);
}

/** 축 시작일로부터의 경과일. 축 밖은 양 끝으로 잘라 낸다 */
export function dayOffset(axis: DecadeCell[], ymd: string): number {
  if (axis.length === 0) return 0;
  const total = axisDayCount(axis);
  const d = diffDays(axis[0].start, ymd);
  return Math.max(0, Math.min(total, d));
}

/** 축 위에서의 위치를 0~100% 로 */
export function dayPercent(axis: DecadeCell[], ymd: string): number {
  return (dayOffset(axis, ymd) / axisDayCount(axis)) * 100;
}
