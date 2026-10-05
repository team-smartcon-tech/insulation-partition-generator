/** 1차 분류 이름에서 "관련" 떼기 — 보이는 자리에서만, 저장된 이름은 그대로. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { divisionLabel } from '../apps/web/src/features/forms/taxonomy.ts';

test('끝의 "관련"을 뗀다', () => {
  assert.equal(divisionLabel('공무관련'), '공무');
  assert.equal(divisionLabel('공사관련'), '공사');
  assert.equal(divisionLabel('품질관련'), '품질');
  assert.equal(divisionLabel('환경관련'), '환경');
  assert.equal(divisionLabel('품질 관련'), '품질', '띄어 써도 뗀다');
});

test('이미 짧은 이름은 그대로 둔다', () => {
  assert.equal(divisionLabel('공무'), '공무');
  assert.equal(divisionLabel('환경'), '환경');
  assert.equal(divisionLabel('안전보건'), '안전보건');
});

test('가운데 있는 "관련"은 건드리지 않는다', () => {
  assert.equal(divisionLabel('관련법규'), '관련법규');
  assert.equal(divisionLabel('공무관련업무'), '공무관련업무', '끝에 올 때만 뗀다');
});

test('떼면 이름이 없어지는 경우는 그대로 둔다', () => {
  assert.equal(divisionLabel('관련'), '관련');
  assert.equal(divisionLabel(''), '');
  assert.equal(divisionLabel(undefined), '');
});
