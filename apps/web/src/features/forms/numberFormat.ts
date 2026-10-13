/**
 * 엑셀 "표시 형식"(numFmt)대로 숫자·날짜를 글자로 바꾼다.
 *
 * 빠뜨리면 100% 가 1, 92% 가 0.917, 58,607,000 이 58607000, "22년 4월" 이 2022-04-20,
 * 0.135 가 0.13499999999999998 로 보였다(회사 양식 33개 점검, 2026-10-13).
 *
 * 회사 양식에 실제로 쓰인 형식만 다룬다 — 백분율, 천 단위 쉼표, 소수 자리, 회계 형식의 "-"(0),
 * 날짜(yyyy·yy·mm·m·dd·d 와 "년""월""일" 같은 글자), 시각(hh:mm). 분수·지수·조건부 서식은 다루지 않고
 * "일반"처럼 보여 준다(틀린 모양보다 원래 숫자가 낫다).
 */

/** 엑셀 "일반" 형식: 유효숫자 10자리까지 — 부동소수 찌꺼기(0.13499999999999998)를 걷는다. */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(10)));
}

/** 따옴표 안·역슬래시 뒤 글자와 [색]·[$-412] 같은 꺾쇠, _x(여백)·*x(채움)를 정리한 조각들 */
interface Token {
  literal?: string;
  code?: string;
}

function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < section.length) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      tokens.push({ literal: section.slice(i + 1, end < 0 ? undefined : end) });
      i = end < 0 ? section.length : end + 1;
    } else if (ch === "\\") {
      tokens.push({ literal: section[i + 1] ?? "" });
      i += 2;
    } else if (ch === "[") {
      // [Red]·[$-412]·[>=100] 등 — 화면 글자에는 안 나온다.
      const end = section.indexOf("]", i);
      i = end < 0 ? section.length : end + 1;
    } else if (ch === "_") {
      // 다음 글자 폭만큼 빈칸. 칸 안 정렬용이라 공백 하나로 둔다.
      tokens.push({ literal: " " });
      i += 2;
    } else if (ch === "*") {
      // 칸을 그 글자로 채움 — 화면에서는 무시한다.
      i += 2;
    } else {
      tokens.push({ code: ch });
      i += 1;
    }
  }
  return tokens;
}

/** 따옴표 밖 코드만 이어 붙인 것(종류를 가리는 데 쓴다) */
const codeOf = (tokens: Token[]) => tokens.map((token) => token.code ?? "").join("");

function splitSections(format: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '"') quoted = !quoted;
    if (ch === "\\" && !quoted) {
      current += ch + (format[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === ";" && !quoted) {
      sections.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  sections.push(current);
  return sections;
}

const isDateCode = (code: string) => /[ymdhs]/i.test(code.replace(/General/gi, ""));

/** 엑셀 날짜 일련번호(1900 기준) → 날짜. 1900-02-29 버그를 따라 60 이후는 하루 당긴다. */
function serialToDate(serial: number): Date {
  const days = serial > 60 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + days * 86400000);
}

function formatDate(date: Date, tokens: Token[]): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  const days = ["일", "월", "화", "수", "목", "금", "토"];

  // 같은 글자를 묶어 하나의 조각으로(yyyy, mm …)
  const parts: { run?: string; literal?: string }[] = [];
  for (const token of tokens) {
    if (token.literal !== undefined) parts.push({ literal: token.literal });
    else if (/[ymdhsaAP]/i.test(token.code!) && parts.at(-1)?.run?.[0]?.toLowerCase() === token.code!.toLowerCase()) {
      parts.at(-1)!.run += token.code!;
    } else if (/[ymdhs]/i.test(token.code!)) parts.push({ run: token.code! });
    else parts.push({ literal: token.code! });
  }

  let out = "";
  parts.forEach((part, index) => {
    if (part.literal !== undefined) {
      out += part.literal;
      return;
    }
    const run = part.run!.toLowerCase();
    const kind = run[0];
    if (kind === "y") out += run.length <= 2 ? pad(y % 100) : String(y);
    else if (kind === "d") {
      if (run.length >= 4) out += `${days[date.getUTCDay()]}요일`;
      else if (run.length === 3) out += days[date.getUTCDay()];
      else out += run.length === 2 ? pad(d) : String(d);
    } else if (kind === "h") out += run.length === 2 ? pad(h) : String(h);
    else if (kind === "s") out += run.length === 2 ? pad(s) : String(s);
    else if (kind === "m") {
      // h 뒤나 s 앞의 m 은 분이다.
      const prev = parts.slice(0, index).reverse().find((p) => p.run)?.run?.[0]?.toLowerCase();
      const next = parts.slice(index + 1).find((p) => p.run)?.run?.[0]?.toLowerCase();
      const minute = prev === "h" || next === "s";
      const n = minute ? mi : mo;
      out += run.length === 2 ? pad(n) : String(n);
    }
  });
  return out;
}

function formatNumberSection(value: number, tokens: Token[]): string {
  const code = codeOf(tokens);
  const percent = (code.match(/%/g) ?? []).length;
  let n = value * 100 ** percent;

  // 숫자 자리 표시(0 # ?)가 든 구간만 숫자로 바꾼다. 앞뒤 글자는 그대로.
  const firstDigit = tokens.findIndex((t) => t.code && /[0#?]/.test(t.code));
  if (firstDigit < 0) {
    // 숫자 자리가 없다 — 회계 형식의 0 자리("-")처럼 글자만 나온다.
    return tokens.map((t) => t.literal ?? (t.code === "%" ? "%" : t.code === "@" ? "" : t.code ?? "")).join("");
  }
  let lastDigit = firstDigit;
  tokens.forEach((t, i) => {
    if (t.code && /[0#?.,]/.test(t.code)) lastDigit = Math.max(lastDigit, i);
  });
  const numberCode = tokens.slice(firstDigit, lastDigit + 1).map((t) => t.code ?? "").join("");
  const [intPart, fracPart = ""] = numberCode.split(".");
  // 끝에 붙은 쉼표는 천 단위로 나누기(#,##0,) — 회사 양식엔 없지만 숫자가 1000배로 보이지 않게.
  const trailingCommas = (intPart.match(/,+$/)?.[0].length ?? 0);
  n /= 1000 ** trailingCommas;
  const grouping = intPart.replace(/,+$/, "").includes(",");
  const decimals = (fracPart.match(/[0#?]/g) ?? []).length;
  const minDecimals = (fracPart.match(/0/g) ?? []).length;
  const minInt = (intPart.match(/0/g) ?? []).length;

  let [whole, frac] = Math.abs(n).toFixed(decimals).split(".") as [string, string | undefined];
  // # 자리(선택 자리)는 끝의 0 을 지운다. 0 자리(필수 자리)만큼은 남긴다.
  while (frac !== undefined && frac.length > minDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (frac === "") frac = undefined;
  if (minInt === 0 && whole === "0") whole = "";
  else whole = whole.padStart(minInt, "0");
  if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const number = frac !== undefined ? `${whole}.${frac}` : whole;

  const before = tokens.slice(0, firstDigit).map((t) => t.literal ?? t.code ?? "").join("");
  const after = tokens.slice(lastDigit + 1).map((t) => t.literal ?? t.code ?? "").join("");
  return `${before}${number}${after}`;
}

/**
 * 숫자(또는 날짜) 하나를 표시 형식대로 글자로.
 * 형식이 없거나 "General" 이면 일반 형식. 날짜 값(Date)은 날짜 형식이 없으면 yyyy-mm-dd.
 */
export function formatValue(value: number | Date, format: string | undefined): string {
  const fmt = (format ?? "").trim();
  if (value instanceof Date) {
    if (!fmt || !isDateCode(codeOf(tokenize(splitSections(fmt)[0])))) return value.toISOString().slice(0, 10);
    return formatDate(value, tokenize(splitSections(fmt)[0]));
  }
  if (!fmt || /^general$/i.test(fmt) || fmt === "@") return formatGeneral(value);

  const sections = splitSections(fmt);
  let section = sections[0];
  let abs = false;
  if (value < 0 && sections.length >= 2 && sections[1] !== "") {
    section = sections[1];
    abs = true; // 음수 구간에는 보통 -, ( ) 가 글자로 들어 있다.
  } else if (value === 0 && sections.length >= 3) {
    section = sections[2];
  }
  const tokens = tokenize(section);
  const code = codeOf(tokens);
  if (/general/i.test(code)) return formatGeneral(value);
  if (isDateCode(code)) return formatDate(serialToDate(value), tokens);
  const text = formatNumberSection(abs ? Math.abs(value) : value, tokens);
  return !abs && value < 0 && /\d/.test(text) ? `-${text}` : text;
}
