/** 서버 코드표를 받아 와 들이는 규칙 — 코드표는 회사 공용이라 서버 것이 원본이다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeServerTaxonomies } from '../apps/web/src/features/forms/taxonomy.ts';

const table = (id, division, updatedAt, name = '작업일보', extra = {}) => ({
  id,
  division,
  fileName: `${division}.xlsx`,
  updatedAt,
  conflicts: [],
  groups: [{ code: '300', name: '공사일지', items: [{ code: '301', name, groupCode: '300' }] }],
  ...extra,
});

test('서버가 더 새로우면 서버 것으로 바꾼다 (본사가 고친 코드표가 내려온다)', () => {
  const local = [table('a', '공사관련', 100, '옛 이름')];
  const server = [table('a', '공사관련', 200, '새 이름')];
  const { list, adopted, newerLocal } = mergeServerTaxonomies(local, server);
  assert.equal(list.length, 1);
  assert.equal(list[0].groups[0].items[0].name, '새 이름');
  assert.equal(list[0].fromServer, true);
  assert.deepEqual(adopted, []);
  assert.deepEqual(newerLocal, []);
});

test('내가 더 나중에 고쳤으면 내 것을 남기고 다시 보낸다 (서버가 꺼져 있을 때 고친 것)', () => {
  const local = [table('a', '공사관련', 300, '내가 고침')];
  const server = [table('a', '공사관련', 200, '서버 판')];
  const { list, newerLocal } = mergeServerTaxonomies(local, server);
  assert.equal(list[0].groups[0].items[0].name, '내가 고침');
  assert.equal(newerLocal.length, 1);
  assert.equal(newerLocal[0], list[0]);
});

test('같은 이름인데 번호가 다르면 서버 번호로 맞추고 알린다 (서류도 옮겨야 한다)', () => {
  const local = [table('mine', '품질관련', 100)];
  const server = [table('theirs', '품질관련', 200)];
  const { list, adopted } = mergeServerTaxonomies(local, server);
  assert.equal(list[0].id, 'theirs');
  assert.deepEqual(adopted, [['mine', 'theirs']]);
});

test('서버에서 사라진 코드표: 받아 온 적이 있으면 치우고, 아직 못 보낸 내 것은 남긴다', () => {
  const local = [
    table('a', '공무관련', 100),
    table('gone', '환경관련', 100, '작업일보', { fromServer: true }),
    table('draft', '안전관련', 100),
  ];
  const server = [table('a', '공무관련', 200)];
  const { list } = mergeServerTaxonomies(local, server);
  assert.deepEqual(list.map((t) => t.id), ['a', 'draft']);
});

test('처음 보는 서버 코드표는 그대로 들어오고, 순서는 서버 순서를 따른다', () => {
  const local = [table('b', '품질관련', 100)];
  const server = [table('a', '공무관련', 200), table('b', '품질관련', 200), table('c', '공사관련', 200)];
  const { list } = mergeServerTaxonomies(local, server);
  assert.deepEqual(list.map((t) => t.id), ['a', 'b', 'c']);
});

test('서버가 빈 목록을 주면 아무것도 바꾸지 않는다 (서버 사고로 다 사라지면 안 된다)', () => {
  const local = [table('a', '공사관련', 100, '작업일보', { fromServer: true })];
  const { list } = mergeServerTaxonomies(local, []);
  assert.equal(list, local);
});
