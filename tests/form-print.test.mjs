/** 복합기 인쇄 — 엑셀의 용지 설정을 그대로 따른다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { fitScale, marginsMm, pageRule, paperLabel, paperName, printableSizePx } from '../apps/web/src/features/forms/printSheet.ts';

test('실제 양식에서 용지 설정을 읽는다 — A4 가로', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const sheet = sheets.find((s) => s.name === 'QA-6.1-3');
  assert.equal(sheet.page.orientation, 'landscape');
  assert.equal(paperName(sheet.page.paperSize), 'A4');
  assert.equal(paperLabel(sheet.page), 'A4 가로');
  assert.match(pageRule(sheet.page), /size: A4 landscape;/);
});

test('용지 번호 → 이름, 모르는 번호는 A4', () => {
  assert.equal(paperName(9), 'A4');
  assert.equal(paperName(8), 'A3');
  assert.equal(paperName(1), 'letter');
  assert.equal(paperName(undefined), 'A4');
  assert.equal(paperName(999), 'A4');
});

test('여백은 엑셀 값(인치)을 mm 로, 없으면 기본 10mm', () => {
  assert.deepEqual(marginsMm(undefined), { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(marginsMm({ margins: { top: 0.5, right: 0.25, bottom: 0.5, left: 0.25 } }), {
    top: 12.7, right: 6.4, bottom: 12.7, left: 6.4,
  });
});

test('표는 종이에 맞춰 줄이기만 한다 — 가로·세로 둘 다 본다', () => {
  const a4Landscape = { orientation: 'landscape', paperSize: 9 };
  const { width, height } = printableSizePx(a4Landscape); // A4 가로에서 표가 들어갈 자리
  assert.ok(width > 1000 && width < 1100, `인쇄 폭 ${width}px`);
  assert.ok(height > 650 && height < 750, `인쇄 높이 ${height}px`);

  assert.equal(fitScale(width, height, a4Landscape), 1, '딱 맞으면 그대로');
  assert.ok(Math.abs(fitScale(width * 2, height, a4Landscape) - 0.5) < 0.001, '가로가 넓으면 절반으로');
  assert.ok(Math.abs(fitScale(width, height * 1.25, a4Landscape) - 0.8) < 0.01, '세로가 조금 넘치면 그만큼 줄인다');
  assert.equal(fitScale(100, 100, a4Landscape), 1, '작아도 키우지 않는다');
  assert.equal(fitScale(0, 0, a4Landscape), 1);

  // 줄을 많이 더한 대장(아주 긴 서류)은 한 장에 욱여넣지 않고 폭만 맞춘다
  assert.equal(fitScale(width, height * 4, a4Landscape), 1, '폭은 맞으니 그대로 두고 여러 장으로');
  assert.ok(Math.abs(fitScale(width * 2, height * 8, a4Landscape) - 0.5) < 0.001, '폭 기준만 적용');

  // 세로로 놓으면 폭이 좁아 더 줄어든다
  assert.ok(printableSizePx({ orientation: 'portrait', paperSize: 9 }).width < width);
});
