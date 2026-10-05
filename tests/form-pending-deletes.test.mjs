/** 못 지운 서류를 기억했다 다시 보내기 — 목록 계산과 "다시 보낼 오류인가" 판단. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addPending, removePending, shouldRetry } from '../apps/web/src/features/forms/pendingDeletes.ts';

test('못 지운 것을 적어 둔다 — 같은 것을 두 번 적지 않는다', () => {
  let list = addPending([], 'a');
  list = addPending(list, 'b');
  assert.deepEqual(list, ['a', 'b']);
  assert.equal(addPending(list, 'a'), list, '이미 있으면 목록을 그대로 둔다(화면이 헛되이 다시 그려지지 않게)');
  assert.deepEqual(addPending(list, ''), list, '빈 번호는 적지 않는다');
});

test('보낸 것은 목록에서 뺀다', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(removePending(list, 'b'), ['a', 'c']);
  assert.equal(removePending(list, 'z'), list, '없는 것을 빼라고 하면 그대로 둔다');
});

test('목록이 한없이 쌓이지 않는다 — 오래된 것부터 버린다', () => {
  let list = [];
  for (let i = 0; i < 205; i++) list = addPending(list, `id-${i}`);
  assert.equal(list.length, 200);
  assert.equal(list[0], 'id-5', '앞(오래된 것)이 잘린다');
  assert.equal(list.at(-1), 'id-204');
});

test('다시 보낼 오류와 아닌 오류를 가른다', () => {
  const offline = new Error('연결 실패');
  offline.name = 'ServerUnavailable';
  assert.equal(shouldRetry(offline), true, '서버에 못 닿은 것은 다시 보낸다');
  assert.equal(shouldRetry(new Error('서버가 거절했습니다(502).')), true, '서버가 내려간 사이의 502 도 다시');
  assert.equal(shouldRetry(new Error('서버가 거절했습니다(503).')), true);

  assert.equal(shouldRetry(new Error('그 서류를 찾지 못했습니다.')), false, '이미 없으면 보낼 필요가 없다');
  assert.equal(shouldRetry(new Error('서버가 거절했습니다(404).')), false);
  assert.equal(shouldRetry(new Error('본사 관리자만 바꿀 수 있습니다.')), false, '권한 문제는 몇 번을 보내도 같다');
  assert.equal(shouldRetry(undefined), false);
});
