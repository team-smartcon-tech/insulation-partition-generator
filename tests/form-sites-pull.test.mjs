/** 서버 현장 목록 합치기와 처음 보여 줄 현장 — 다른 사람이 처음 열어도 실제 현장이 보이게. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeServerSites, pickStartSite } from '../apps/web/src/features/forms/sites.ts';

const busan = { id: 'b', name: '부산장안(B1)', createdAt: 1 };
const ours = { id: 'o', name: '우리 현장', createdAt: 2 };

test('처음 여는 사람: 서버 현장을 받아 온다', () => {
  const { list, adopted } = mergeServerSites([], [busan, ours]);
  assert.deepEqual(list.map((s) => s.name), ['부산장안(B1)', '우리 현장']);
  assert.deepEqual(adopted, []);
});

test('같은 이름·다른 번호는 서버 번호로, 브라우저에만 있는 현장은 남긴다', () => {
  const mineOurs = { id: 'local-1', name: '우리 현장', createdAt: 3, qmp: { startDate: '2026-01-01' } };
  const only = { id: 'local-2', name: '새 현장', createdAt: 4 };
  const { list, adopted } = mergeServerSites([mineOurs, only], [busan, ours]);
  assert.deepEqual(adopted, [['local-1', 'o']]);
  assert.deepEqual(list.map((s) => s.id), ['b', 'o', 'local-2']);
  assert.equal(list[1].qmp.startDate, '2026-01-01');
});

test('저절로 만든 빈 "우리 현장" 대신 실제 현장을 먼저 보여 준다', () => {
  assert.equal(pickStartSite([busan, ours], 'o', []), 'b');
  assert.equal(pickStartSite([busan, ours], undefined, []), 'b');
  // 우리 현장에 서류가 있으면 지난번 본 대로
  assert.equal(pickStartSite([busan, ours], 'o', ['o']), 'o');
  assert.equal(pickStartSite([ours], 'o', []), 'o');
});

test('서버에서 본 적 있는 현장이 서버에서 사라지면 뺀다 — 아직 못 올린 현장은 지킨다', () => {
  const first = mergeServerSites([], [busan, ours]).list;
  assert.equal(first.every((s) => s.onServer), true);
  const notYet = { id: 'n', name: '새 현장', createdAt: 5 };
  const { list } = mergeServerSites([...first, notYet], [busan]);
  assert.deepEqual(list.map((s) => s.name), ['부산장안(B1)', '새 현장']);
});

test('작성 일정은 나중에 정한 쪽을 쓴다', () => {
  const older = { ...busan, qmp: { startDate: '2025-01-01', updatedAt: 1 } };
  const newer = { ...busan, qmp: { startDate: '2025-04-01', updatedAt: 2 } };
  assert.equal(mergeServerSites([older], [newer]).list[0].qmp.startDate, '2025-04-01');
  assert.equal(mergeServerSites([newer], [older]).list[0].qmp.startDate, '2025-04-01');
  assert.equal(mergeServerSites([busan], [newer]).list[0].qmp.startDate, '2025-04-01');
  assert.equal(mergeServerSites([newer], [busan]).list[0].qmp.startDate, '2025-04-01');
});
