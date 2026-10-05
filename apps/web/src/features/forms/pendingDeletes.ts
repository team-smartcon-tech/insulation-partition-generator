/**
 * **지우지 못한 서류를 기억해 둔다.**
 *
 * 서류를 지우면 브라우저에서 지우고 서버에도 "지워라"를 보낸다. 그런데 그때 서버가 꺼져 있거나
 * 인터넷이 끊겨 있으면 그 말이 전달되지 않는다. 브라우저에서는 사라졌는데 **서버에는 그대로
 * 남아**, 본사 점검 화면에 유령 서류가 계속 보인다(실제로 그렇게 됐다 — 사용자 신고:
 * "본사점검에는 왜 2개가 보이지.. 난 1개만 작성했는데").
 *
 * 그래서 실패한 지우기를 적어 두었다가 **서버가 돌아오면 다시 보낸다.** 적어 두는 곳은
 * localStorage — 창을 닫았다 열어도 남아 있어야 한다.
 *
 * 여기 있는 함수들은 **목록을 다루는 계산만** 한다(브라우저가 없는 곳에서도 시험할 수 있게).
 * 실제로 읽고 쓰는 것은 아래 `readPendingDeletes`·`writePendingDeletes` 뿐이다.
 */

const KEY = "ipg-forms:pending-deletes";

/** 한없이 쌓이지 않게 막는다. 이보다 많으면 오래된 것부터 버린다. */
const MAX = 200;

/** 목록에 더한다(중복 없이, 오래된 것이 앞). */
export function addPending(list: string[], id: string): string[] {
  if (!id || list.includes(id)) return list;
  const next = [...list, id];
  return next.length > MAX ? next.slice(next.length - MAX) : next;
}

/** 목록에서 뺀다(보냈거나, 서버에 이미 없거나). */
export function removePending(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : list;
}

/**
 * 이 오류가 **"나중에 다시 보내 볼 만한 것"** 인가.
 *
 * 서버에 닿지 못한 것(`ServerUnavailable`)만 다시 보낸다. 서버가 "그런 서류 없다"(404)고
 * 답했으면 이미 지워진 것이니 **더 보낼 필요가 없고**, "권한 없다"(403)면 몇 번을 보내도 같다.
 */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof Error && error.name === "ServerUnavailable") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  // 서버가 내려간 사이에는 502·503·504 가 온다 — 이것도 "지금은 못 닿는다"로 본다.
  return /\b(50[0234])\b/.test(message);
}

/** 적어 둔 목록을 읽는다. 저장이 막힌 브라우저에서도 터지지 않는다. */
export function readPendingDeletes(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writePendingDeletes(list: string[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만 기억한다.
  }
}
