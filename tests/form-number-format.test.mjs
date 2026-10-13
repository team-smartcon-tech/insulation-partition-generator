/** 엑셀 표시 형식 — 회사 양식 33개에서 틀리게 보이던 값들. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatGeneral, formatValue } from '../apps/web/src/features/forms/numberFormat.ts';

test('일반 형식은 부동소수 찌꺼기를 걷는다', () => {
  assert.equal(formatGeneral(0.13499999999999998), '0.135');
  assert.equal(formatGeneral(1.7100000000000002), '1.71');
  assert.equal(formatGeneral(3347), '3347');
  assert.equal(formatValue(1.6666666666666667, 'General'), '1.666666667');
});

test('백분율', () => {
  assert.equal(formatValue(1, '0%'), '100%');
  assert.equal(formatValue(0.9166666, '0%'), '92%');
  assert.equal(formatValue(0.02, '0.00%'), '2.00%');
  assert.equal(formatValue(0.6838235, '0.0%'), '68.4%');
  assert.equal(formatValue(0, '0.00 %'), '0.00 %');
});

test('천 단위 쉼표와 소수 자리', () => {
  assert.equal(formatValue(58607000, '#,##0'), '58,607,000');
  assert.equal(formatValue(23000, '#,##0_ '), '23,000 ');
  assert.equal(formatValue(1.71, '0.00'), '1.71');
  assert.equal(formatValue(1.7, '#,##0.0#'), '1.7');
  assert.equal(formatValue(-1234.5, '#,##0.0'), '-1,234.5');
  assert.equal(formatValue(-1234.5, '#,##0.0;(#,##0.0)'), '(1,234.5)');
});

test('회계 형식 — 0 은 "-"', () => {
  const acct = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-';
  assert.equal(formatValue(0, acct).trim(), '-');
  assert.equal(formatValue(3347, acct).trim(), '3,347');
  assert.equal(formatValue(-5, acct).trim(), '-5');
});

test('날짜 — 한글 글자와 섞인 형식', () => {
  const d = new Date(Date.UTC(2022, 3, 20));
  assert.equal(formatValue(d, 'yy"년" m"월"'), '22년 4월');
  assert.equal(formatValue(d, 'yyyy.mm.dd'), '2022.04.20');
  assert.equal(formatValue(new Date(Date.UTC(2023, 1, 1)), 'mm"월" dd"일"'), '02월 01일');
  assert.equal(formatValue(d, 'yyyy-mm-dd'), '2022-04-20');
  assert.equal(formatValue(d, undefined), '2022-04-20');
  // 날짜 형식이 걸린 일련번호(44671 = 2022-04-20)
  assert.equal(formatValue(44671, 'yyyy.mm.dd'), '2022.04.20');
  assert.equal(formatValue(new Date(Date.UTC(2022, 3, 20, 9, 5)), 'hh:mm'), '09:05');
  assert.equal(formatValue(d, '[$-412]yyyy"년" m"월" d"일"'), '2022년 4월 20일');
});
