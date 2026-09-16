/** 내려받기 — 올린 원본에 적은 글자를 얹어 주는지, 서식·도형을 잃지 않는지. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { buildFilledWorkbook, filledFileName, patchSheetXml } from '../apps/web/src/features/forms/formExport.ts';

const SAMPLE = fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url));

async function bytes() {
  const buffer = await readFile(SAMPLE);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('적은 글자가 그대로 엑셀에 들어가고, 표와 도형은 원본대로 남는다', async () => {
  const original = await bytes();
  const before = await parseFormWorkbook(original);
  const sheet = before[0];
  // 첫 시트의 아무 칸에나 적어 본다.
  const target = sheet.cells.find((cell) => cell.rowSpan === 1 && cell.colSpan === 1);
  const values = { [sheet.name]: { [target.key]: '적어 넣은 글자' } };

  const { bytes: filled, skippedSheets } = await buildFilledWorkbook(original, values);
  assert.deepEqual(skippedSheets, []);

  const after = await parseFormWorkbook(filled);
  const sameSheet = after.find((s) => s.name === sheet.name);
  const written = sameSheet.cells.find((cell) => cell.key === target.key);
  assert.equal(written.text, '적어 넣은 글자');

  // 양식이 망가지지 않아야 한다 — 시트 수·도형 수·칸 크기가 그대로인지 본다.
  assert.equal(after.length, before.length, '시트 수');
  assert.equal(sameSheet.shapes.length, sheet.shapes.length, '도형 수');
  assert.deepEqual(sameSheet.colWidths, sheet.colWidths, '열 너비');
});

test('앱에서 더한 시트는 엑셀 원본에 없어 담지 못했다고 알려 준다', async () => {
  const { skippedSheets } = await buildFilledWorkbook(await bytes(), {
    '2026-09': { '3:2': '월별 장에 적은 글자' },
  });
  assert.deepEqual(skippedSheets, ['2026-09']);
});

test('내려받는 파일 이름에 (작성본)을 붙인다', () => {
  assert.equal(filledFileName('101. 이해관계자.xlsx'), '101. 이해관계자 (작성본).xlsx');
  assert.equal(filledFileName('점검표'), '점검표 (작성본).xlsx');
});

test('원본에 글자가 없던 칸에도 그대로 들어간다', async () => {
  const original = await bytes();
  const [sheet] = await parseFormWorkbook(original);
  const empty = sheet.cells.find((cell) => cell.text.trim() === '' && cell.rowSpan === 1 && cell.colSpan === 1);

  const { bytes: filled } = await buildFilledWorkbook(original, { [sheet.name]: { [empty.key]: '빈칸에 적음' } });
  const after = await parseFormWorkbook(filled);
  const sameSheet = after.find((s) => s.name === sheet.name);
  assert.equal(sameSheet.cells.find((cell) => cell.key === empty.key).text, '빈칸에 적음');
});

test('칸도 줄도 없던 자리에는 새로 만들어 넣는다', () => {
  // 줄은 있는데 그 칸이 없는 경우 — 열 순서를 지켜 끼워 넣는다.
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" s="3"/><c r="C1"/></row></sheetData></worksheet>';
  const patched = patchSheetXml(xml, { '1:2': '가운데', '1:1': '앞' });
  assert.match(patched, /<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">앞<\/t><\/is><\/c><c r="B1" t="inlineStr">/);

  // 줄 자체가 없으면 줄을 만들어 번호 순서대로 끼운다.
  const added = patchSheetXml(xml, { '3:1': '새 줄' });
  assert.match(added, /<row r="1">[\s\S]*<\/row><row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">새 줄<\/t><\/is><\/c><\/row><\/sheetData>/);

  // 빈 글자는 칸을 비운다(서식은 남긴다).
  assert.match(patchSheetXml(xml, { '1:1': '' }), /<c r="A1" s="3"\/>/);
});
