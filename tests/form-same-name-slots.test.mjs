/** 다른 1차 분류의 같은 서류 칸 찾기(이름으로). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { parseTaxonomySheet, sameNameSlots } from '../apps/web/src/features/forms/taxonomy.ts';
import { staleAcrossDivisions } from '../apps/web/src/features/forms/library.ts';

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

/** 배포 양식 한 장(판정에 필요한 것만). */
const 양식 = (id, taxonomyId, code, title, uploadedAt) => ({
  id,
  kind: 'template',
  taxonomyId,
  code,
  title,
  uploadedAt,
});

test('한쪽 분류에만 새 판을 올리면 다른 쪽이 옛 판으로 잡힌다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  const 어제 = Date.UTC(2026, 8, 21);
  const 오늘 = Date.UTC(2026, 8, 22);

  // ① 함께 배포한 직후(몇 ms 차이)는 경고하지 않는다 — 같은 파일을 두 칸에 넣은 것뿐이다
  const 함께 = [
    양식('a', '공무관련', '104', '품질환경방침 및 목표관리.xlsx', 어제),
    양식('b', '품질관련', '103', '품질환경방침 및 목표관리.xlsx', 어제 + 40),
  ];
  assert.deepEqual(staleAcrossDivisions(함께, taxonomies), []);

  // ② 공무관련에만 새 판을 올리면 품질관련이 옛 판이다
  const 한쪽만 = [...함께, 양식('c', '공무관련', '104', '품질환경방침 및 목표관리.xlsx', 오늘)];
  const rows = staleAcrossDivisions(한쪽만, taxonomies);
  assert.equal(rows.length, 1, '한 칸만 잡혀야 한다');
  assert.equal(rows[0].division, '품질관련');
  assert.equal(rows[0].code, '103');
  assert.equal(rows[0].old.id, 'b');
  assert.equal(rows[0].newer.id, 'c');
  assert.equal(rows[0].newerDivision, '공무관련');
  assert.equal(rows[0].newerCode, '104');
});

test('파일 이름 앞에 분류 번호가 붙어 달라도, 칸에 서류가 하나씩이면 찾는다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  const 어제 = Date.UTC(2026, 8, 21);
  const 오늘 = Date.UTC(2026, 8, 22);
  const rows = staleAcrossDivisions(
    [
      양식('a', '품질관련', '103', '103. 품질환경방침 및 목표관리.xlsx', 어제),
      양식('b', '공무관련', '104', '104. 품질환경방침 및 목표관리.xlsx', 오늘),
    ],
    taxonomies,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '103');
  assert.equal(rows[0].newer.id, 'b');
});

test('한 칸에 서류가 여럿이면 같은 이름끼리만 견준다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  const 어제 = Date.UTC(2026, 8, 21);
  const 오늘 = Date.UTC(2026, 8, 22);
  const rows = staleAcrossDivisions(
    [
      // 품질관련 103 칸에 서류 두 가지가 들어 있다
      양식('a', '품질관련', '103', '품질환경방침 및 목표관리.xlsx', 어제),
      양식('b', '품질관련', '103', '환경 세부 지침.xlsx', 어제),
      // 공무관련 104 에는 이름이 아주 다른 서류 하나만 새로 올라왔다 — 짝지을 수 없다
      양식('c', '공무관련', '104', '전혀 다른 서류.xlsx', 오늘),
    ],
    taxonomies,
  );
  assert.deepEqual(rows, [], '이름이 안 맞고 한 칸에 여럿이면 넘겨짚지 않는다');
});

test('배포 묶음 번호가 있으면 시간 차이가 짧아도 제대로 가린다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  const 배포1 = Date.UTC(2026, 8, 21);
  const 배포2 = 배포1 + 1000; // 1초 뒤 — 옛 규칙(60초 관용)이라면 못 잡는다

  const 묶음 = (form, batchId) => ({ ...form, batchId });

  // ① 같은 묶음(한 번에 두 칸으로 배포) — 시각이 달라도 새 판이 아니다
  assert.deepEqual(
    staleAcrossDivisions(
      [
        묶음(양식('a', '공무관련', '104', '품질환경방침 및 목표관리.xlsx', 배포1), 'B1'),
        묶음(양식('b', '품질관련', '103', '품질환경방침 및 목표관리.xlsx', 배포2), 'B1'),
      ],
      taxonomies,
    ),
    [],
  );

  // ② 다른 묶음(따로 올린 것) — 1초 차이여도 새 판으로 잡는다
  const rows = staleAcrossDivisions(
    [
      묶음(양식('a', '품질관련', '103', '품질환경방침 및 목표관리.xlsx', 배포1), 'B1'),
      묶음(양식('b', '공무관련', '104', '품질환경방침 및 목표관리.xlsx', 배포2), 'B2'),
    ],
    taxonomies,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].division, '품질관련');
  assert.equal(rows[0].newer.id, 'b');
});

test('옛 판이 한 곳도 없으면 아무것도 돌려주지 않는다', async () => {
  const taxonomies = await taxonomiesOf(['서류 분류 코드표.xlsx', '품질관련 코드표.xlsx']);
  assert.deepEqual(staleAcrossDivisions([], taxonomies), []);
});
