import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import {
  LEGACY_TAXONOMY_ID,
  codeFromFileName,
  findItem,
  parseTaxonomySheet,
  placeByFileName,
  taxonomyIdOf,
  upsertTaxonomies,
} from '../apps/web/src/features/forms/taxonomy.ts';

const SAMPLE = fileURLToPath(
  new URL('./fixtures/서류 분류 코드표.xlsx', import.meta.url),
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
  assert.equal(
    taxonomy.groups.reduce((sum, group) => sum + group.items.length, 0),
    65,
  );
  assert.deepEqual(
    taxonomy.groups.map((group) => group.code),
    ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  );
  assert.equal(taxonomy.groups[0].name, '공통/일반');
  // 겹치는 코드 없이 정리된 표다. 겹침 처리 자체는 아래 두 테스트가 맡는다.
  assert.deepEqual(taxonomy.conflicts, []);
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

// ─── 1차 분류(대분류) ──────────────────────────────────────────

const codeTableRows = [
  [1, 1, 'CODE'],
  [1, 2, '분류명'],
  [1, 3, 'CODE'],
  [1, 4, '분류명'],
  [2, 1, '100', 1],
  [2, 2, '공통/일반', 1],
  [2, 3, '101'],
  [2, 4, '이해관계자 니즈와 기대'],
];

test('코드표 시트 이름을 1차 분류 이름으로 쓴다', async () => {
  const taxonomy = await loadTaxonomy();
  // 관리자가 엑셀 시트 이름만 바꾸면 되고, 앱에서 따로 입력할 것이 없다.
  assert.equal(taxonomy.division, '공무관련');

  const named = parseTaxonomySheet({ ...sheetOf(codeTableRows), name: '  안전관련 ' }, '표.xlsx');
  assert.equal(named.division, '안전관련');
});

test('엑셀 기본 시트 이름은 1차 분류로 치지 않는다', () => {
  // "Sheet1" 이 대분류 이름으로 뜨면 이상하다. 비워 두고 화면에서 붙이게 한다.
  for (const name of ['Sheet1', 'sheet', 'Sheet 2', '시트1']) {
    const taxonomy = parseTaxonomySheet({ ...sheetOf(codeTableRows), name }, '표.xlsx');
    assert.equal(taxonomy.division, '', `"${name}" 이 이름으로 잡혔다`);
  }
});

// ─── 코드표 여러 벌(공무관련 · 품질관련) ───────────────────────

const QUALITY = fileURLToPath(
  new URL('./fixtures/품질관련 코드표.xlsx', import.meta.url),
);

async function loadQuality() {
  const buffer = await readFile(QUALITY);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const [sheet] = await parseFormWorkbook(data);
  return parseTaxonomySheet(sheet, '품질관련 코드표.xlsx');
}

const tableOf = (id, division, codes) => ({
  id,
  division,
  fileName: `${division}.xlsx`,
  updatedAt: 0,
  conflicts: [],
  groups: [
    {
      code: '100',
      name: '공통/일반',
      items: codes.map((code) => ({ code, name: `${division} ${code}`, groupCode: '100' })),
    },
  ],
});

test('품질관련 코드표를 읽는다 — 겹쳤던 500 블록은 한 칸씩 밀어 정리돼 있다', async () => {
  const quality = await loadQuality();

  assert.equal(quality.division, '품질관련');
  assert.deepEqual(
    quality.groups.map((group) => `${group.code} ${group.name}`),
    [
      '100 공통/일반',
      '200 교육/훈련',
      '300 계획/절차서',
      '400 부적합 관리',
      '500 품질관리',
      '600 시험관리',
      '700 공장점검',
      '800 시험장비',
      '900 자재',
    ],
  );
  assert.equal(quality.groups.reduce((sum, group) => sum + group.items.length, 0), 59);
  // 사진에는 505·509 가 두 번씩 있고 508 이 없었다. 사용자 확인을 받아 501~511 로 밀었다.
  assert.deepEqual(quality.conflicts, []);
  const 품질관리 = quality.groups.find((group) => group.code === '500');
  assert.deepEqual(
    품질관리.items.map((item) => item.code),
    ['501', '502', '503', '504', '505', '506', '507', '508', '509', '510', '511'],
  );
  assert.equal(findItem(quality, '511').name, '케미칼앙카인발시험');
});

test('같은 1차 분류 이름으로 다시 올리면 내용만 바꾸고 id 는 그대로 둔다', () => {
  const existing = [tableOf('a', '공무관련', ['101']), tableOf('b', '품질관련', ['101'])];
  const incoming = [{ ...tableOf('', '품질관련', ['101', '102']) }];

  let made = 0;
  const result = upsertTaxonomies(existing, incoming, () => `new-${++made}`);

  // id 가 바뀌면 이미 올린 품질 서류들이 떨어져 나간다.
  assert.equal(result.length, 2);
  assert.equal(result[1].id, 'b');
  assert.equal(result[1].groups[0].items.length, 2);
  assert.equal(made, 0, '같은 이름이면 새 id 를 만들지 않는다');
});

test('처음 보는 1차 분류는 새 id 를 받아 뒤에 붙는다', () => {
  const existing = [tableOf('a', '공무관련', ['101'])];
  const result = upsertTaxonomies(existing, [tableOf('', '품질관련', ['101'])], () => 'new-1');

  assert.deepEqual(result.map((t) => [t.id, t.division]), [
    ['a', '공무관련'],
    ['new-1', '품질관련'],
  ]);
});

test('코드표 id 없이 올린 옛 서류는 옛 코드표 소속이다', () => {
  const taxonomies = [tableOf(LEGACY_TAXONOMY_ID, '공무관련', ['101']), tableOf('q', '품질관련', ['101'])];

  assert.equal(taxonomyIdOf({ code: '101' }, taxonomies), LEGACY_TAXONOMY_ID);
  assert.equal(taxonomyIdOf({ code: '101', taxonomyId: 'q' }, taxonomies), 'q');
  assert.equal(taxonomyIdOf({}, taxonomies), undefined, '코드가 없으면 어디에도 안 속한다');
});

test('옛 코드표를 지우면 옛 서류는 다음 코드표로 옮겨 붙지 않는다', () => {
  // "첫 번째 코드표"로 보면 공무 서류가 품질 칸으로 조용히 들어간다.
  const onlyQuality = [tableOf('q', '품질관련', ['101'])];
  assert.equal(taxonomyIdOf({ code: '101' }, onlyQuality), undefined);
  // 지워진 코드표를 가리키는 서류도 떨어진다.
  assert.equal(taxonomyIdOf({ code: '101', taxonomyId: 'gone' }, onlyQuality), undefined);
});

test('파일 이름 번호가 여러 코드표에 겹치면 보고 있는 쪽으로, 모르면 정하지 않는다', () => {
  const taxonomies = [tableOf('g', '공무관련', ['101', '112']), tableOf('q', '품질관련', ['101', '615'])];

  // 한 곳에만 있는 번호는 그곳으로
  assert.deepEqual(placeByFileName('112. 문서목록.xlsx', taxonomies), { taxonomyId: 'g', code: '112' });
  assert.deepEqual(placeByFileName('615. 총괄표.xlsx', taxonomies), { taxonomyId: 'q', code: '615' });
  // 겹치는 번호는 지금 보고 있는 1차 분류로
  assert.deepEqual(placeByFileName('101. 이해관계자.xlsx', taxonomies, 'q'), { taxonomyId: 'q', code: '101' });
  // 어느 쪽인지 모르면 정하지 않는다 — 공무 서류가 품질 칸에 조용히 들어가지 않게
  assert.equal(placeByFileName('101. 이해관계자.xlsx', taxonomies), undefined);
  assert.equal(placeByFileName('999. 없음.xlsx', taxonomies, 'q'), undefined);
});

test('한 칸 더 쪼갠 코드(802-1)도 코드표와 파일 이름에서 읽는다', () => {
  const sheet = sheetOf([
    [1, 1, 'CODE'],
    [1, 2, '분류명'],
    [1, 3, 'CODE'],
    [1, 4, '분류명'],
    [2, 1, '800', 2],
    [2, 2, '문서관리', 2],
    [2, 3, '802-1'],
    [2, 4, 'TFT성과보고서'],
    [3, 3, '802-3'],
    [3, 4, '착공보고서'],
  ]);
  const taxonomy = parseTaxonomySheet(sheet, '공사관련 코드표.xlsx');
  assert.deepEqual(
    taxonomy.groups[0].items.map((item) => item.code),
    ['802-1', '802-3'],
  );
  assert.equal(codeFromFileName('802-1. TFT성과보고서.xlsx', taxonomy), '802-1');
  // 802-2 는 코드표에 없고 802 도 없으니 정하지 않는다
  assert.equal(codeFromFileName('802-2. 착공전 현장조사 보고서.xlsx', taxonomy), undefined);
  // 앞 번호(802)로 줄여 맞추지 않는다 — 802 는 다른 서류(착공보고서)일 수 있다
  const renumbered = [tableOf('c', '공사관련', ['801', '802', '803'])];
  assert.equal(placeByFileName('802-1. TFT성과보고서.xlsx', renumbered), undefined);
});
