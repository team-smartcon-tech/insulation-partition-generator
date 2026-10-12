/** 열어 둔 서류 탭 — 더하기·닫기 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addOpenDoc, closeOpenDoc, MAX_OPEN_DOCS } from '../apps/web/src/features/forms/openDocList.ts';

const doc = (id) => ({ id, title: `서류 ${id}` });

test('연 서류를 뒤에 더한다', () => {
  const one = addOpenDoc([], doc('a'));
  const two = addOpenDoc(one, doc('b'));
  assert.deepEqual(two.map((t) => t.id), ['a', 'b']);
});

test('이미 연 서류는 **자리를 지킨다** — 볼 때마다 순서가 바뀌면 눈이 못 따라간다', () => {
  const list = [doc('a'), doc('b'), doc('c')];
  assert.equal(addOpenDoc(list, doc('a')), list, '목록을 그대로 돌려준다(화면을 헛되이 다시 그리지 않게)');
});

test('너무 많으면 오래된 것부터 닫는다', () => {
  let list = [];
  for (let i = 0; i < MAX_OPEN_DOCS + 3; i++) list = addOpenDoc(list, doc(`id${i}`));
  assert.equal(list.length, MAX_OPEN_DOCS);
  assert.equal(list[0].id, 'id3', '앞(오래된 것)이 잘린다');
  assert.equal(list.at(-1).id, `id${MAX_OPEN_DOCS + 2}`);
});

test('탭을 닫으면 **오른쪽 탭**으로 넘어간다(아크로뱃과 같다)', () => {
  const list = [doc('a'), doc('b'), doc('c')];
  const out = closeOpenDoc(list, 'b');
  assert.deepEqual(out.list.map((t) => t.id), ['a', 'c']);
  assert.equal(out.next.id, 'c');
  assert.equal(out.wasOpen, true);
});

test('맨 끝 탭을 닫으면 왼쪽으로 넘어간다', () => {
  const out = closeOpenDoc([doc('a'), doc('b')], 'b');
  assert.equal(out.next.id, 'a');
});

test('마지막 하나를 닫으면 갈 곳이 없다 — 서류를 닫고 목록만 남긴다', () => {
  const out = closeOpenDoc([doc('a')], 'a');
  assert.deepEqual(out.list, []);
  assert.equal(out.next, null);
});

test('없는 탭을 닫으라고 하면 아무것도 바꾸지 않는다', () => {
  const list = [doc('a')];
  const out = closeOpenDoc(list, 'z');
  assert.equal(out.list, list);
  assert.equal(out.wasOpen, false);
});
