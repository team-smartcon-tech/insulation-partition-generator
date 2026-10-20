/** 서식 잇기 — 6.1-3 평가표에서 "유"인 줄을 6.1-4 대응계획서로 옮겨 쓴다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SHEET_LINKS, applySheetLink } from '../apps/web/src/features/forms/formLinks.ts';

const link = SHEET_LINKS.find((item) => item.from === '6.1-3');
// 평가표: A 번호, B 구분, D 발생일, E 리스크, O 등급, Q 대응계획 유무
const row = (r, [no, kind, date, risk, grade, yes]) => ({
  [`${r}:1`]: no, [`${r}:2`]: kind, [`${r}:4`]: date, [`${r}:5`]: risk, [`${r}:15`]: grade, [`${r}:17`]: yes,
});

test('"유"인 줄만 대응계획서 빈 줄에 차례로 옮긴다', () => {
  const source = {
    ...row(7, ['1', '시공-1', '2026-10-01', '주방가구 박리', '1', '유']),
    ...row(8, ['2', '시공-2', '2026-10-02', '외부도장 박리', '1', '무']),
    ...row(9, ['3', '공무-1', '2026-10-03', '방화문 소송', '3', '유']),
  };
  const { values, changed, overflow } = applySheetLink(link, source, {}, 21);
  assert.equal(overflow, 0);
  assert.ok(changed > 0);
  assert.equal(values['8:1'], '1');
  assert.equal(values['8:6'], '주방가구 박리');
  assert.equal(values['8:5'], '1');
  assert.equal(values['9:1'], '3', '"무"인 2번은 건너뛴다');
  assert.equal(values['9:6'], '방화문 소송');
  assert.equal(values['9:4'], '2026-10-03');
});

test('같은 번호 줄은 그 자리를 고치고, 대응계획서에서 적은 조치계획은 지킨다', () => {
  const target = { '8:1': '1', '8:6': '옛 리스크', '8:8': '자재 사전 검토' };
  const source = row(7, ['1', '시공-1', '2026-10-01', '새 리스크', '2', '유']);
  const { values } = applySheetLink(link, source, target, 21);
  assert.equal(values['8:6'], '새 리스크');
  assert.equal(values['8:5'], '2');
  assert.equal(values['8:8'], '자재 사전 검토');
  // 다시 돌려도 바뀌는 것이 없다
  assert.equal(applySheetLink(link, source, values, 21).changed, 0);
});

test('빈 줄이 모자라면 알린다', () => {
  const source = { ...row(7, ['1', 'a', '', 'x', '1', '유']), ...row(8, ['2', 'b', '', 'y', '1', '유']) };
  const { overflow } = applySheetLink(link, source, {}, 8);
  assert.equal(overflow, 1);
});
