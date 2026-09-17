/** 현장 조직과 결재선 — 조직에서 골라 결재칸에 넣고, 현장 기본값으로 기억한다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMember,
  assigneeCaption,
  assigneeOf,
  initialLine,
  lineRecord,
  nextEmptyIndex,
  rememberDefaults,
  removeMember,
  searchMembers,
} from '../apps/web/src/features/forms/approvalLine.ts';

let counter = 0;
const makeId = () => `m${++counter}`;

function org() {
  counter = 0;
  let members = [];
  for (const [name, position, role] of [['조형규', '부장', '현장소장'], ['문홍주', '과장', '공사'], ['윤효환', '과장', '공무'], ['김성훈', '대리', '공무']]) {
    members = addMember(members, { name, position, role }, makeId).members;
  }
  return members;
}

test('조직: 더하기·같은 사람 두 번 안 쌓기·빼기·검색', () => {
  const members = org();
  assert.equal(members.length, 4);

  const again = addMember(members, { name: ' 문홍주 ', position: '과장' }, makeId);
  assert.equal(again.members, members, '이름·직급이 같으면 그대로');
  assert.equal(again.member.id, 'm2');
  assert.equal(addMember(members, { name: '  ' }, makeId).members, members, '빈 이름은 무시');

  assert.deepEqual(searchMembers(members, '공무').map((m) => m.name), ['윤효환', '김성훈']);
  assert.deepEqual(searchMembers(members, '과 장').map((m) => m.name), ['문홍주', '윤효환'], '공백 무시');
  assert.equal(searchMembers(members, '').length, 4);
  assert.deepEqual(removeMember(members, 'm1').map((m) => m.name), ['문홍주', '윤효환', '김성훈']);
});

const slots = [
  { label: '작성', signKey: '2:13' },
  { label: '검토', signKey: '2:15' },
  { label: '검토', signKey: '2:17' },
  { label: '승인', signKey: '2:19' },
];

test('결재선: 기본값을 같은 이름 칸에 순서대로 채우고, 저장한 결재선이 있으면 그것', () => {
  const [so, moon, yoon, kim] = org().map(assigneeOf);
  const defaults = { 작성: [kim], 검토: [moon, yoon], 승인: [so] };

  assert.deepEqual(initialLine(slots, undefined, defaults), [kim, moon, yoon, so]);
  assert.deepEqual(initialLine(slots, undefined, undefined), [undefined, undefined, undefined, undefined]);

  const saved = { '2:13': moon, '2:19': so };
  assert.deepEqual(initialLine(slots, saved, defaults), [moon, undefined, undefined, so], '서류에 정한 것이 먼저');
  assert.deepEqual(lineRecord(slots, [moon, undefined, undefined, so]), saved, '빈칸은 저장하지 않는다');
});

test('결재선: 기본값 기억 — 이번 서류에 없는 칸 이름은 그대로 둔다', () => {
  const [so, moon, , kim] = org().map(assigneeOf);
  const before = { 작성: [moon], 검토: [moon], 승인: [so], 확인: [kim] };
  const twoSlots = [{ label: '작성', signKey: 'a' }, { label: '승인', signKey: 'b' }];

  const after = rememberDefaults(before, twoSlots, [kim, undefined]);
  assert.deepEqual(after.작성, [kim]);
  assert.equal('승인' in after, false, '이번에 비운 칸 이름은 지운다');
  assert.deepEqual(after.검토, [moon], '이번 서류에 없는 칸 이름은 유지');
  assert.deepEqual(after.확인, [kim]);
});

test('다음 빈칸 찾기와 칸에 보일 글자', () => {
  const x = { name: '김성훈', position: '대리', role: '' };
  assert.equal(nextEmptyIndex([x, undefined, undefined], 0), 1);
  assert.equal(nextEmptyIndex([undefined, x, x], 1), 0, '뒤가 다 찼으면 앞에서');
  assert.equal(nextEmptyIndex([x, x], 0), -1);
  assert.equal(assigneeCaption(x), '김성훈 대리');
  assert.equal(assigneeCaption({ name: '외부 감리', position: '', role: '' }), '외부 감리');
});
