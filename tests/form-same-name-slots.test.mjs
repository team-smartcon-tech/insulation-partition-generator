/** 다른 1차 분류의 같은 서류 칸 찾기(이름으로). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { parseTaxonomySheet, sameNameSlots } from '../apps/web/src/features/forms/taxonomy.ts';

async function taxonomiesOf(files) {
  const result = [];
  for (const file of files) {
    const buffer = await readFile(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)));
    const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    for (const sheet of sheets) {
      const taxonomy = parseTaxonomySheet(sheet, file);
      if (taxonomy) result.push({ ...taxonomy, id: taxonomy.division });
    }
  }
  return result;
}

test('실제 코드표: 번호가 달라도 이름이 같으면 찾는다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  // 공무관련 104 품질환경방침 및 목표관리 = 품질관련 103
  const found = sameNameSlots(taxonomies, { taxonomyId: '공무관련', code: '104' });
  assert.deepEqual(found.map((slot) => `${slot.division} ${slot.code}`), ['품질관련 103']);

  // 띄어쓰기만 다른 것도 같은 서류(공무 106 개인업무분장표 = 품질 106 개인 업무 분장표)
  assert.deepEqual(
    sameNameSlots(taxonomies, { taxonomyId: '공무관련', code: '106' }).map((s) => `${s.division} ${s.code}`),
    ['품질관련 106'],
  );
  // 반대 방향도 같다
  assert.deepEqual(
    sameNameSlots(taxonomies, { taxonomyId: '품질관련', code: '103' }).map((s) => `${s.division} ${s.code}`),
    ['공무관련 104'],
  );
});

test('겹치지 않는 서류·없는 칸은 빈 목록', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  assert.deepEqual(sameNameSlots(taxonomies, { taxonomyId: '공무관련', code: '701' }), []);
  assert.deepEqual(sameNameSlots(taxonomies, { taxonomyId: '공무관련', code: '999' }), []);
  assert.deepEqual(sameNameSlots(taxonomies, { taxonomyId: '없는표', code: '101' }), []);
});

test('세 분류에 같은 서류가 있으면 둘 다 찾는다', () => {
  const make = (id, code, name) => ({
    id, division: id, fileName: `${id}.xlsx`, conflicts: [],
    groups: [{ code: '100', name: '공통', items: [{ code, name, groupCode: '100' }] }],
  });
  const taxonomies = [make('공무', '105', '회의록'), make('품질', '104', '회 의 록'), make('공사', '110', '회의록'), make('안전', '101', '작업일보')];
  assert.deepEqual(
    sameNameSlots(taxonomies, { taxonomyId: '공무', code: '105' }).map((s) => `${s.division} ${s.code}`),
    ['품질 104', '공사 110'],
  );
});
