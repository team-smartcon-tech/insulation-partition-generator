/** 표 중간에 줄 끼우기 — 자리 계산과 글자 따라 움직이기. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baseRowOf,
  insertAt,
  removeInsertedAt,
  rowOrigins,
  shiftCellKeys,
  withInsertedRows,
} from '../apps/web/src/features/forms/sheetRows.ts';

/** 3줄짜리 시트(각 줄에 칸 2개) */
const sheet = {
  name: '표',
  rowCount: 3,
  colCount: 2,
  colWidths: [60, 60],
  rowHeights: [20, 21, 22],
  cells: [1, 2, 3].flatMap((row) =>
    [1, 2].map((col) => ({
      key: `${row}:${col}`,
      row,
      col,
      rowSpan: 1,
      colSpan: 1,
      text: `${row}-${col}`,
      style: {},
    })),
  ),
};

test('끼운 자리는 원본 줄 번호로 기억한다', () => {
  // 2번 줄 앞에 한 줄 → 화면은 4줄, 2번째가 빈 줄
  const inserts = insertAt(3, [], 2);
  assert.deepEqual(inserts, [2]);

  const origins = rowOrigins(3, inserts);
  assert.deepEqual(origins.map((o) => o.base), [1, null, 2, 3]);
  assert.equal(baseRowOf(origins, 2), null, '끼운 줄은 원본이 없다');
  assert.equal(baseRowOf(origins, 3), 2, '밀려난 원본 2번 줄');

  // 같은 자리에 또 넣으면 두 줄이 된다
  assert.deepEqual(insertAt(3, inserts, 2), [2, 2]);
  // 맨 끝에도 넣을 수 있다
  assert.deepEqual(insertAt(3, [], 4), [4]);
});

test('끼운 줄은 바로 위 줄의 서식을 물려받고 내용은 비운다', () => {
  const made = withInsertedRows(sheet, [2]);
  assert.equal(made.rowCount, 4);
  assert.deepEqual(made.rowHeights, [20, 20, 21, 22], '끼운 줄 높이는 위 줄을 따른다');

  const row2 = made.cells.filter((cell) => cell.row === 2);
  assert.equal(row2.length, 2, '칸 수는 본보기 줄과 같다');
  assert.deepEqual(row2.map((cell) => cell.text), ['', ''], '내용은 비어 있다');

  const row3 = made.cells.filter((cell) => cell.row === 3);
  assert.deepEqual(row3.map((cell) => cell.text), ['2-1', '2-2'], '원본 2번 줄이 3번으로 밀린다');
  assert.deepEqual(row3.map((cell) => cell.key), ['3:1', '3:2'], '키도 새 줄 번호로');
});

test('끼운 줄만 뺄 수 있다 — 원본 줄은 지우지 않는다', () => {
  const inserts = [2];
  assert.deepEqual(removeInsertedAt(3, inserts, 2), [], '끼운 줄은 빠진다');
  assert.deepEqual(removeInsertedAt(3, inserts, 3), inserts, '원본 줄(3번 자리)은 그대로');
  assert.deepEqual(removeInsertedAt(3, inserts, 1), inserts, '원본 줄(1번)도 그대로');
});

test('줄이 움직이면 적어 둔 글자도 함께 움직인다', () => {
  const values = { '1:1': '머리글', '2:1': '첫 줄', '3:2': '둘째 줄' };
  // 2번 줄 앞에 한 줄 끼움 → 2번 이후가 한 칸씩 내려간다
  assert.deepEqual(shiftCellKeys(values, 2, 1), {
    '1:1': '머리글',
    '3:1': '첫 줄',
    '4:2': '둘째 줄',
  });
  // 도로 빼면 제자리로
  assert.deepEqual(shiftCellKeys(shiftCellKeys(values, 2, 1), 2, -1), values);
  assert.deepEqual(shiftCellKeys(undefined, 2, 1), {});
});
