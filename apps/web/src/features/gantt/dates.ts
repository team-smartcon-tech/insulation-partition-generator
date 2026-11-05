// 화면용 날짜 유틸 (YYYY-MM-DD). 엔진의 date.ts 와 같은 규칙(UTC 정오)이지만 화면 쪽 의존을 줄이려 따로 둔다.
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}
export function weekdayEn(date: string): string {
  return WEEKDAY_EN[new Date(Date.parse(date)).getUTCDay()];
}
export function koreanDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일 (${WEEKDAY_KO[new Date(Date.parse(date)).getUTCDay()]})`;
}
/** YYYY-MM → 그 달의 첫날·마지막날 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
