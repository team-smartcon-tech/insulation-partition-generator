/**
 * 열어 둔 서류 탭의 목록 규칙(더하기·닫기).
 *
 * 화면(`OpenDocTabs.tsx`)과 떼어 둔 것은 `node:test` 가 `.tsx` 를 읽지 못해서다 — 규칙만 따로 시험한다.
 */

/** 탭 하나 — 서류 번호와 보여 줄 이름만 있으면 된다. */
export interface OpenDoc {
  id: string;
  title: string;
}

/** 너무 많이 쌓이면 탭이 글자만큼 작아진다. 오래된 것부터 닫는다. */
export const MAX_OPEN_DOCS = 8;

/**
 * 연 서류를 목록에 더한다.
 *
 * **이미 있으면 그 자리에 그대로 둔다** — 볼 때마다 맨 뒤로 옮기면 탭이 춤을 춰서 눈이 못 따라간다.
 * 너무 많으면 오래된 것부터 뺀다.
 */
export function addOpenDoc(list: OpenDoc[], doc: OpenDoc): OpenDoc[] {
  if (list.some((item) => item.id === doc.id)) return list;
  const next = [...list, doc];
  return next.length > MAX_OPEN_DOCS ? next.slice(next.length - MAX_OPEN_DOCS) : next;
}

/** 탭을 닫는다. 닫은 것이 지금 보던 것이면 **그 옆 탭**을 알려 준다(아크로뱃과 같다). */
export function closeOpenDoc(
  list: OpenDoc[],
  id: string,
): { list: OpenDoc[]; next: OpenDoc | null; wasOpen: boolean } {
  const at = list.findIndex((item) => item.id === id);
  if (at < 0) return { list, next: null, wasOpen: false };
  const next = list.filter((item) => item.id !== id);
  // 오른쪽 것을 먼저, 없으면 왼쪽 것.
  const neighbour = next[at] ?? next[at - 1] ?? null;
  return { list: next, next: neighbour, wasOpen: true };
}
