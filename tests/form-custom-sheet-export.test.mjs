/** 앱에서 더한 장(월별 시트)이 엑셀에 진짜 시트로 들어가는지. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { buildFilledWorkbook } from '../apps/web/src/features/forms/formExport.ts';
import { readZipIndex, readZipText } from '../apps/web/src/features/forms/zip.ts';

async function fixture(name) {
  const buffer = await readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('더한 장이 시트로 들어가고, 적은 글자·원본 서식·그림이 함께 간다', async () => {
  const original = await fixture('6.1 리스크와 기회관리.xlsx');
  const before = await parseFormWorkbook(original);
  const source = before.find((s) => s.name === '견본');

  const { bytes, skippedSheets } = await buildFilledWorkbook(
    original,
    { '26.09': { '7:1': '1', '7:2': '시공-1' } },
    {},
    [{ name: '26.09', source: '견본' }],
  );
  assert.deepEqual(skippedSheets, [], '더한 장을 빼먹지 않는다');

  const after = await parseFormWorkbook(bytes);
  assert.deepEqual(
    after.map((s) => s.name),
    [...before.map((s) => s.name), '26.09'],
    '원본 시트는 그대로, 더한 장은 맨 뒤',
  );
  const added = after.find((s) => s.name === '26.09');
  assert.equal(added.colWidths.length, source.colWidths.length);
  assert.deepEqual(added.colWidths, source.colWidths, '열 너비(서식) 그대로');
  assert.equal(added.cells.find((c) => c.key === '7:2').text, '시공-1', '적은 글자');
  assert.equal(added.images.length, source.images.length, '로고 그림도 함께');
  // 견본 워터마크는 빠진다
  const sampleBefore = source.shapes.filter((shape) => shape.text?.toLowerCase().includes('sample')).length;
  assert.ok(sampleBefore > 0, '원본 견본 시트에는 워터마크가 있다');
  assert.equal(added.shapes.filter((shape) => shape.text?.toLowerCase().includes('sample')).length, 0);
  // 원본 견본 시트는 그대로 둔다
  assert.equal(after.find((s) => s.name === '견본').shapes.length, source.shapes.length);
});

test('워크북·내용 형식에 새 시트가 등록되고, 인쇄 영역도 따라 붙는다', async () => {
  const original = await fixture('6.1 리스크와 기회관리.xlsx');
  const { bytes } = await buildFilledWorkbook(original, {}, {}, [{ name: '26.10', source: '견본' }]);
  const index = readZipIndex(bytes);
  const workbook = await readZipText(bytes, index, 'xl/workbook.xml');
  assert.match(workbook, /<sheet name="26.10" sheetId="\d+" r:id="rId\d+"\/>/);
  const types = await readZipText(bytes, index, '[Content_Types].xml');
  assert.match(types, /PartName="\/xl\/worksheets\/sheet\d+\.xml" ContentType="[^"]*worksheet\+xml"/);
  // 견본 시트(다섯 번째, localSheetId 3)의 인쇄 영역이 새 시트(여섯 번째 = 6)에도
  const areas = [...workbook.matchAll(/localSheetId="(\d+)">([^<]*)</g)].map((m) => [m[1], m[2]]);
  assert.ok(areas.some(([id, area]) => id === '6' && area.includes('26.10')), `새 시트 인쇄 영역: ${JSON.stringify(areas)}`);
});

test('원본에 없는 시트를 복사하려 하면 알려 준다', async () => {
  const original = await fixture('6.1 리스크와 기회관리.xlsx');
  const { skippedSheets } = await buildFilledWorkbook(original, {}, {}, [{ name: '26.11', source: '없는 시트' }]);
  assert.deepEqual(skippedSheets, ['26.11']);
});
