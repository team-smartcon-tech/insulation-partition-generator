import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeValues,
  withCustomSheets,
} from '../apps/web/src/features/forms/formStore.ts';

const sheet = (name) => ({
  name,
  rowCount: 3,
  colCount: 3,
  colWidths: [10, 10, 10],
  rowHeights: [10, 10, 10],
  cells: [],
  images: [],
  shapes: [],
});

// ─── 고친 글자를 시트별로 나눠 담는다 ──────────────────────────

test('시트 구분 없이 저장돼 있던 옛 값은 첫 시트의 것으로 옮긴다', () => {
  const sheets = [sheet('1월'), sheet('2월')];
  const migrated = normalizeValues({ '3:2': '홍길동', '4:2': '공무팀' }, sheets);

  // 옛 저장본은 `셀 키 → 값` 한 덩어리였다. 버리지 않고 첫 시트로 옮긴다.
  assert.deepEqual(migrated, { '1월': { '3:2': '홍길동', '4:2': '공무팀' } });
});

test('이미 시트별로 나뉜 값은 그대로 둔다', () => {
  const values = { '1월': { '3:2': '가' }, '2월': { '3:2': '나' } };
  assert.deepEqual(normalizeValues(values, [sheet('1월'), sheet('2월')]), values);
});

test('같은 자리에 적은 글자가 시트끼리 섞이지 않는다', () => {
  const values = normalizeValues({ '1월': { '3:2': '가' }, '2월': { '3:2': '나' } }, []);

  // 셀 키가 "행:열" 이라 한 덩어리에 담으면 3행 2열 값이 모든 시트에 함께 나타난다.
  // 월별로 장을 나눠 쓰는 양식에서는 지난달 내용이 이번 달에 겹쳐 보이는 것이 된다.
  assert.equal(values['1월']['3:2'], '가');
  assert.equal(values['2월']['3:2'], '나');
});

test('값이 없거나 모양이 이상하면 빈 것으로 본다', () => {
  assert.deepEqual(normalizeValues(undefined, [sheet('1월')]), {});
  assert.deepEqual(normalizeValues(null, [sheet('1월')]), {});
  // 시트를 모르면 옛 값을 어디에 붙일지 정할 수 없다. 억지로 붙이지 않는다.
  assert.deepEqual(normalizeValues({ '3:2': '가' }, []), {});
});

// ─── 사용자가 더한 시트 ────────────────────────────────────────

test('더한 시트는 원본 시트 뒤에 붙고, 원본 격자를 그대로 쓴다', () => {
  const sheets = [sheet('견본'), sheet('2026-06')];
  const result = withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  assert.deepEqual(
    result.map((s) => s.name),
    ['견본', '2026-06', '2026-07'],
  );
  // 격자를 따로 저장하지 않고 원본에서 만들기 때문에, 파서가 좋아지면 함께 새 모양이 된다.
  assert.equal(result[2].colCount, sheets[0].colCount);
  assert.deepEqual(result[2].colWidths, sheets[0].colWidths);
});

test('더한 시트에는 표시가 붙는다', () => {
  const result = withCustomSheets([sheet('견본')], [{ name: '2026-07', source: '견본' }]);

  // 이름 바꾸기·지우기는 더한 시트에만 허용하므로 화면이 구분할 수 있어야 한다.
  assert.equal(result[0].custom, undefined);
  assert.equal(result[1].custom, true);
});

test('복사해 온 원본 시트가 사라졌으면 조용히 건너뛴다', () => {
  // 엑셀을 다시 올려 시트 이름이 바뀌는 경우. 없는 것을 그리려다 화면이 깨지면 안 된다.
  const result = withCustomSheets([sheet('견본')], [{ name: '2026-07', source: '없는시트' }]);
  assert.deepEqual(
    result.map((s) => s.name),
    ['견본'],
  );
});

test('원본 시트 목록은 건드리지 않는다', () => {
  const sheets = [sheet('견본')];
  withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  // 저장소에는 원본 시트만 담긴다. 여기서 원본 배열이 늘어나면 더한 시트가 저장본에 섞인다.
  assert.equal(sheets.length, 1);
});
