/** 사이트에서 코드표를 만들고 고치는 규칙 — 엑셀 없이 쓰는 길이라 여기서 지킨다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addGroup,
  addItem,
  applyPastedLines,
  createTaxonomy,
  editGroup,
  editItem,
  findItem,
  moveGroup,
  moveItem,
  nextItemCode,
  parsePastedTaxonomy,
  removeGroup,
  removeItem,
  renumberGroup,
} from '../apps/web/src/features/forms/taxonomy.ts';
import { PASTED_FOLDERS } from './form-taxonomy-edit-paste.mjs';

test('새 코드표는 중분류 100 부터, 소분류는 그 아래 번호를 이어 받는다', () => {
  let taxonomy = createTaxonomy('공사관련');
  taxonomy = addGroup(taxonomy, '공통일반');
  taxonomy = addItem(taxonomy, '100', '이해관계자 니즈와 기대');
  taxonomy = addItem(taxonomy, '100', '리스크와 기회관리');
  taxonomy = addGroup(taxonomy, '공정관리');

  assert.deepEqual(taxonomy.groups.map((g) => g.code), ['100', '200']);
  assert.deepEqual(taxonomy.groups[0].items.map((i) => `${i.code} ${i.name}`), [
    '101 이해관계자 니즈와 기대',
    '102 리스크와 기회관리',
  ]);
  assert.equal(nextItemCode(taxonomy.groups[0]), '103');
  assert.equal(nextItemCode(taxonomy.groups[1]), '201', '빈 중분류는 자기 번호 다음부터');
});

test('이름·번호를 고쳐도 아래 소분류가 떨어지지 않고, 겹치는 번호는 막는다', () => {
  let taxonomy = addItem(addGroup(createTaxonomy('공사관련'), '공통일반'), '100', '작업일보');
  taxonomy = editGroup(taxonomy, '100', { code: '300', name: '공사일지' });
  assert.equal(taxonomy.groups[0].name, '공사일지');
  assert.equal(taxonomy.groups[0].items[0].groupCode, '300', '소분류의 소속도 같이 옮겨진다');

  taxonomy = addItem(taxonomy, '300', '회의록');
  const before = JSON.stringify(taxonomy.groups);
  // 301 은 이미 회의록이 쓰고 있다 → 그대로 둔다(조용히 덮어써 두 서류가 한 칸에 겹치지 않게)
  assert.equal(JSON.stringify(editItem(taxonomy, '101', { code: '301' }).groups), before);
  // 아무도 안 쓰는 번호로는 바뀐다
  assert.equal(editItem(taxonomy, '101', { code: '302' }).groups[0].items[0].code, '302');
  assert.equal(editItem(taxonomy, '101', { name: '작업일보(수정)' }).groups[0].items[0].name, '작업일보(수정)');
});

test('지우면 그 칸에 있던 코드를 알려 준다 — 서류는 코드 없는 서류로 내려보내야 한다', () => {
  let taxonomy = addItem(addItem(addGroup(createTaxonomy('공사관련'), '공통일반'), '100', '가'), '100', '나');

  const one = removeItem(taxonomy, '101');
  assert.deepEqual(one.codes, ['101']);
  assert.equal(findItem(one.taxonomy, '101'), undefined);

  const whole = removeGroup(taxonomy, '100');
  assert.deepEqual(whole.codes, ['101', '102']);
  assert.deepEqual(whole.taxonomy.groups, []);
});

test('탐색기에서 복사한 폴더 목록을 붙여넣으면 코드표가 된다', () => {
  const lines = parsePastedTaxonomy(PASTED_FOLDERS);
  assert.deepEqual(
    lines.map((l) => `${l.code} ${l.name}${l.isGroup ? ' (중분류)' : ''}`),
    [
      '100 공통일반 (중분류)',
      '101 이해관계자 니즈와 기대',
      '102 리스크와 기회관리',
      '300 공사일지 (중분류)',
      '301 작업일보',
    ],
  );

  const taxonomy = applyPastedLines(createTaxonomy('공사관련'), lines);
  assert.deepEqual(taxonomy.groups.map((g) => `${g.code} ${g.name} ${g.items.length}`), [
    '100 공통일반 2',
    '300 공사일지 1',
  ]);
});

test('중분류 없이 소분류만 붙여넣어도 100 단위 중분류를 만들어 건다', () => {
  const taxonomy = applyPastedLines(
    createTaxonomy('공사관련'),
    parsePastedTaxonomy('601.검측요청서\n602.타설승인요청서\n802-1. TFT성과보고서'),
  );
  assert.deepEqual(taxonomy.groups.map((g) => g.code), ['600', '800']);
  assert.deepEqual(taxonomy.groups[0].items.map((i) => i.code), ['601', '602']);
  assert.deepEqual(taxonomy.groups[1].items.map((i) => i.code), ['802-1']);
});

test('칸을 끌어다 놓으면 순서만 바뀌고 번호는 그대로다', () => {
  let taxonomy = addGroup(createTaxonomy('공무관련'), '하도급업무');
  for (const name of ['계약서', '기성', '평가', '현장설명서']) taxonomy = addItem(taxonomy, '100', name);
  assert.deepEqual(taxonomy.groups[0].items.map((i) => i.code), ['101', '102', '103', '104']);

  // 마지막(현장설명서)을 두 번째 자리로
  const moved = moveItem(taxonomy, '104', '100', '102');
  assert.deepEqual(moved.groups[0].items.map((i) => `${i.code} ${i.name}`), [
    '101 계약서',
    '104 현장설명서',
    '102 기성',
    '103 평가',
  ]);

  // 번호 정리를 부르면 그때 순서대로 다시 매기고, 바뀐 번호를 알려 준다
  const { taxonomy: tidy, changes } = renumberGroup(moved, '100');
  assert.deepEqual(tidy.groups[0].items.map((i) => `${i.code} ${i.name}`), [
    '101 계약서',
    '102 현장설명서',
    '103 기성',
    '104 평가',
  ]);
  assert.deepEqual(changes, [
    { from: '104', to: '102' },
    { from: '102', to: '103' },
    { from: '103', to: '104' },
  ]);
});

test('칸을 다른 중분류로 옮기고, 중분류끼리도 순서를 바꾼다', () => {
  let taxonomy = addGroup(addGroup(createTaxonomy('공무관련'), '공통일반'), '공사일지');
  taxonomy = addItem(taxonomy, '100', '작업일보');
  taxonomy = addItem(taxonomy, '200', '회의록');

  const moved = moveItem(taxonomy, '101', '200');
  assert.deepEqual(moved.groups[0].items, []);
  assert.deepEqual(moved.groups[1].items.map((i) => `${i.code} ${i.groupCode}`), ['201 200', '101 200']);

  assert.deepEqual(moveGroup(taxonomy, '200', '100').groups.map((g) => g.code), ['200', '100']);
  assert.deepEqual(moveGroup(taxonomy, '100').groups.map((g) => g.code), ['200', '100'], '맨 끝으로');
});
