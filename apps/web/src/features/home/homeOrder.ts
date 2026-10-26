/**
 * 홈 카드 순서 — 관리자가 저장한 카드 키 배열(market_home_order.card_keys)을 기본 정렬 위에 덮는다.
 *
 * - 저장된 키는 그 순서대로 앞에 온다.
 * - 저장 목록에 없는 카드(새로 게시된 도구 등)는 기본 정렬 순서를 유지한 채 뒤에 붙는다.
 * - 섹션 구분은 화면(HomePage)이 나중에 하므로, 여기서는 전체를 한 줄로 정렬하면 섹션 안 순서도 맞는다.
 */

export function applyHomeOrder<T extends { key: string }>(cards: T[], savedKeys: string[]): T[] {
  if (savedKeys.length === 0) return cards;
  const rank = new Map(savedKeys.map((k, i) => [k, i]));
  const tail = savedKeys.length;
  return cards
    .map((card, i) => ({ card, r: rank.get(card.key) ?? tail + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.card);
}

/** 같은 섹션 안에서 from 카드를 to 카드 자리로 옮긴 전체 키 배열 */
export function moveCardKey(
  keys: string[],
  sectionOf: (key: string) => string,
  fromKey: string,
  toKey: string,
): string[] {
  if (fromKey === toKey || sectionOf(fromKey) !== sectionOf(toKey)) return keys;
  const next = keys.filter((k) => k !== fromKey);
  const toIdx = next.indexOf(toKey);
  if (toIdx < 0) return keys;
  // 아래(뒤)로 옮길 때는 대상 뒤에, 위(앞)로 옮길 때는 대상 앞에 놓는다
  const movingDown = keys.indexOf(fromKey) < keys.indexOf(toKey);
  next.splice(movingDown ? toIdx + 1 : toIdx, 0, fromKey);
  return next;
}

/** 같은 섹션의 바로 앞/뒤 카드와 자리 바꾸기 (← / → 버튼, 키보드 대안) */
export function stepCardKey(
  keys: string[],
  sectionOf: (key: string) => string,
  key: string,
  dir: -1 | 1,
): string[] {
  const sec = sectionOf(key);
  const same = keys.filter((k) => sectionOf(k) === sec);
  const pos = same.indexOf(key);
  const neighbor = same[pos + dir];
  if (pos < 0 || !neighbor) return keys;
  return moveCardKey(keys, sectionOf, key, neighbor);
}
