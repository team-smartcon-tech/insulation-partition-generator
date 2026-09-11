import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import {
  codeFromFileName,
  findItem,
  parseTaxonomySheet,
} from '../apps/web/src/features/forms/taxonomy.ts';

const SAMPLE = fileURLToPath(
  new URL('../apps/worker/samples/서류 분류 코드표.xlsx', import.meta.url),
);

let cached;
async function loadTaxonomy() {
  if (!cached) {
    const buffer = await readFile(SAMPLE);
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const [sheet] = await parseFormWorkbook(data);
    cached = parseTaxonomySheet(sheet, '서류 분류 코드표.xlsx');
  }
  return cached;
}

/** 코드표 한 장을 손으로 짜서 파서에 넘긴다. 병합은 rowSpan 으로 표현한다. */
function sheetOf(rows, colCount = 4) {
  const cells = rows.map(([row, col, text, rowSpan = 1]) => ({
    key: `${row}:${col}`,
    row,
    col,
    rowSpan,
    colSpan: 1,
    text,
    style: { borders: {} },
  }));
  return {
    name: '분류코드',
    rowCount: Math.max(...cells.map((c) => c.row + c.rowSpan - 1)),
    colCount,
    colWidths: Array(colCount).fill(80),
    rowHeights: [],
    cells,
    images: [],
    shapes: [],
  };
}

test('코드표 엑셀을 중분류·소분류로 읽는다', async () => {
  const taxonomy = await loadTaxonomy();

  assert.equal(taxonomy.groups.length, 9);
  // 표에는 66줄이 있지만 "305 본사 공지사항"이 두 줄이라 하나로 합쳐져 65개가 된다.
  assert.equal(
    taxonomy.groups.reduce((sum, group) => sum + group.items.length, 0),
    65,
  );
  assert.deepEqual(
    taxonomy.groups.map((group) => group.code),
    ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  );
  assert.equal(taxonomy.groups[0].name, '공통/일반');
  // 305 는 "현장 주요업무 체크리스트"로도 쓰여 이름이 갈린다 — 합치지 않고 알린다.
  assert.deepEqual(taxonomy.conflicts, ['305']);
  assert.equal(taxonomy.groups[0].items[0].name, '이해관계자 니즈와 기대');
});

test('세로로 병합된 중분류가 아래 줄들에 모두 걸린다', async () => {
  const taxonomy = await loadTaxonomy();
  const 대외업무 = taxonomy.groups.find((group) => group.code === '400');

  // 중분류 칸은 한 번만 적히고 아래로 병합돼 있다. 병합을 못 읽으면 첫 줄만 걸린다.
  assert.equal(대외업무.items.length, 8);
  assert.ok(대외업무.items.every((item) => item.groupCode === '400'));
  assert.equal(findItem(taxonomy, '405').name, '단속 · 점검 방문일지');
});

test('파일 이름 앞 숫자로 분류를 정한다', async () => {
  const taxonomy = await loadTaxonomy();

  // 사내 양식 파일은 이미 코드로 시작한다 — 올릴 때 분류를 안 골라도 제자리에 간다.
  assert.equal(codeFromFileName('101. 이해관계자니즈와기대2.xlsx', taxonomy), '101');
  assert.equal(codeFromFileName('405.단속점검방문일지.xlsx', taxonomy), '405');
  // 코드표에 없는 번호는 넘긴다(파일명이 옛 체계일 수 있다).
  assert.equal(codeFromFileName('999. 무언가.xlsx', taxonomy), undefined);
  assert.equal(codeFromFileName('단속점검방문일지양식.xlsx', taxonomy), undefined);
  assert.equal(codeFromFileName('101. 어떤양식.xlsx', null), undefined);
});

test('머리글 CODE 위치로 코드 열을 찾는다 — 열 순서를 고정하지 않는다', () => {
  // 회사 표에 앞쪽 여백 열이 하나 붙은 경우.
  const sheet = sheetOf(
    [
      [1, 2, 'CODE'],
      [1, 3, '분류명'],
      [1, 4, 'CODE'],
      [1, 5, '분류명'],
      [2, 2, '100', 2],
      [2, 3, '공통/일반', 2],
      [2, 4, '101'],
      [2, 5, '이해관계자 니즈와 기대'],
      [3, 4, '102'],
      [3, 5, '리스크 및 기회 평가표'],
    ],
    5,
  );

  const taxonomy = parseTaxonomySheet(sheet, '표.xlsx');
  assert.equal(taxonomy.groups.length, 1);
  assert.deepEqual(
    taxonomy.groups[0].items.map((item) => item.code),
    ['101', '102'],
  );
});

test('같은 코드·같은 이름은 한 줄로 합친다', () => {
  // 오프라인에서 부수가 많아 표에 두 줄로 적어 둔 경우. 화면에는 한 칸으로 보여야 한다.
  const sheet = sheetOf([
    [1, 1, 'CODE'],
    [1, 2, '분류명'],
    [1, 3, 'CODE'],
    [1, 4, '분류명'],
    [2, 1, '300', 3],
    [2, 2, '대본업무', 3],
    [2, 3, '305'],
    [2, 4, '본사 공지사항'],
    [3, 3, '305'],
    [3, 4, '본사 공지사항'],
  ]);

  const taxonomy = parseTaxonomySheet(sheet, '표.xlsx');
  assert.equal(taxonomy.groups[0].items.length, 1);
  assert.deepEqual(taxonomy.conflicts, [], '같은 이름끼리는 알릴 것이 없다');
});

test('같은 코드에 다른 이름이면 둘 다 남기고 알린다', () => {
  // 지우면 서류 한 종류가 통째로 사라진다. 표의 실수일 수 있으니 사람이 보게 한다.
  const sheet = sheetOf([
    [1, 1, 'CODE'],
    [1, 2, '분류명'],
    [1, 3, 'CODE'],
    [1, 4, '분류명'],
    [2, 1, '300', 3],
    [2, 2, '대본업무', 3],
    [2, 3, '305'],
    [2, 4, '현장 주요업무 체크리스트'],
    [3, 3, '305'],
    [3, 4, '본사 공지사항'],
  ]);

  const taxonomy = parseTaxonomySheet(sheet, '표.xlsx');
  assert.equal(taxonomy.groups[0].items.length, 2);
  assert.deepEqual(taxonomy.conflicts, ['305']);
});

test('코드표가 아닌 엑셀을 올리면 null 을 돌려준다', () => {
  // 양식 파일을 실수로 코드표 자리에 올리는 일은 반드시 생긴다.
  const sheet = sheetOf([
    [1, 1, '공 사 명'],
    [1, 2, '부산 장안지구'],
  ], 2);
  assert.equal(parseTaxonomySheet(sheet, '양식.xlsx'), null);
});

test('빈 줄과 이름 없는 줄은 건너뛴다', () => {
  // 회사 표에는 빈 줄·소계 줄이 섞인다. 그 줄 하나 때문에 표 전체를 못 쓰면 안 된다.
  const sheet = sheetOf([
    [1, 1, 'CODE'],
    [1, 2, '분류명'],
    [1, 3, 'CODE'],
    [1, 4, '분류명'],
    [2, 1, '100', 3],
    [2, 2, '공통/일반', 3],
    [2, 3, '101'],
    [2, 4, '이해관계자 니즈와 기대'],
    [3, 3, '102'],
    // 102 는 이름이 비어 있다 → 버린다
    [4, 3, '103'],
    [4, 4, '리스크 및 기회 대응계획서'],
  ]);

  const taxonomy = parseTaxonomySheet(sheet, '표.xlsx');
  assert.deepEqual(
    taxonomy.groups[0].items.map((item) => item.code),
    ['101', '103'],
  );
});
