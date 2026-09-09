import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countSlots,
  splitCellLine,
  splitCellText,
  slotKey,
} from '../apps/web/src/features/forms/formSlots.ts';

const texts = (segments) => segments.filter((s) => s.type === 'text').map((s) => s.text);
const slots = (segments) => segments.filter((s) => s.type === 'slot');

test('레이블 사이의 공백 덩어리를 적는 자리로 잘라낸다', () => {
  const line = '소속:                  직급:                  성명:                (서명 또는 날인)';
  const segments = splitCellLine(line);

  assert.deepEqual(texts(segments), ['소속:', '직급:', '성명:', '(서명 또는 날인)']);
  assert.equal(slots(segments).length, 3);
  assert.deepEqual(
    slots(segments).map((s) => s.index),
    [0, 1, 2],
  );
});

test('줄 앞 공백은 들여쓰기라 적는 자리로 세지 않는다', () => {
  // A12 " ③ 방문근거\n     및 목적" 의 둘째 줄.
  const segments = splitCellLine('     및 목적');

  assert.equal(slots(segments).length, 0);
  assert.deepEqual(texts(segments), ['     및 목적']);
});

test('줄 끝 공백도 적는 자리가 아니다', () => {
  const segments = splitCellLine('공 사 명      ');

  assert.equal(slots(segments).length, 0);
  assert.deepEqual(texts(segments), ['공 사 명      ']);
});

test('낱개 공백은 띄어쓰기이므로 자르지 않는다', () => {
  const segments = splitCellLine('소속: 우미건설(주) 직급: 부장');

  assert.equal(slots(segments).length, 0);
});

test('여러 줄이면 빈칸 번호가 셀 전체에서 이어진다', () => {
  // 마지막 "성명:" 뒤에도 글자가 있어야 그 앞 공백이 "사이에 낀 공백"이 된다.
  const cell = [
    '소속:      직급:      성명:      (인)',
    '',
    '소속:      직급:      성명:      (인)',
  ].join('\n');

  const lines = splitCellText(cell);
  assert.equal(lines.length, 3);

  const first = slots(lines[0]).map((s) => s.index);
  const third = slots(lines[2]).map((s) => s.index);
  assert.deepEqual(first, [0, 1, 2]);
  // 둘째 줄은 비어 있으므로 번호를 소비하지 않고, 셋째 줄이 3부터 이어간다.
  assert.deepEqual(third, [3, 4, 5]);
  assert.equal(countSlots(cell), 6);
});

test('실제 ⑥ 방문자 칸은 5명 × 3항목 = 15개 자리로 갈린다', () => {
  const row =
    '소속:                  직급:                  성명:                (서명 또는 날인)';
  const cell = Array.from({ length: 5 }, () => row).join('\n\n');

  assert.equal(countSlots(cell), 15);
});

test('빈칸 너비는 원본 공백 수를 따라간다', () => {
  const segments = splitCellLine('가:    나:          다');
  const widths = slots(segments).map((s) => s.spaces);

  assert.equal(widths.length, 2);
  assert.ok(widths[1] > widths[0], '공백이 더 긴 자리가 더 넓어야 한다');
});

test('값 저장 키는 셀과 빈칸 번호를 합쳐 유일하다', () => {
  assert.equal(slotKey('15:2', 0), '15:2#0');
  assert.notEqual(slotKey('15:2', 0), slotKey('15:2', 1));
  assert.notEqual(slotKey('15:2', 0), slotKey('16:2', 0));
});
