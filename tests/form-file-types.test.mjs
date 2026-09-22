/** 어떤 파일을 받을지 — 매크로 엑셀(.xlsm)은 받고, 옛 엑셀(.xls)·한글은 안 받는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { editionName, isExcelFile } from '../apps/web/src/features/forms/library.ts';
import { filledFileName } from '../apps/web/src/features/forms/formExport.ts';

test('받는 파일 가리기', () => {
  assert.ok(isExcelFile('101. 이해관계자.xlsx'));
  assert.ok(isExcelFile('검측요청서.XLSX'), '대문자도 같다');
  assert.ok(isExcelFile('6.2 품질목표관리.xlsm'), '매크로가 든 엑셀도 받는다');
  assert.equal(isExcelFile('검측요청서.xls'), false, '옛 형식은 못 읽는다');
  assert.equal(isExcelFile('검측요청서.hwp'), false);
  assert.equal(isExcelFile('검측요청서.hwpx'), false);
  assert.equal(isExcelFile('공지사항.pdf'), false);
  assert.equal(isExcelFile('xlsx'), false, '확장자가 아니라 이름에만 들어간 경우');
});

test('매크로 엑셀(.xlsm)도 그대로 읽힌다', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/매크로 양식.xlsm', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  assert.ok(sheets.length > 0, '시트를 읽어야 한다');
  const sheet = sheets[0];
  assert.ok(sheet.rowCount > 0 && sheet.colWidths.length > 0);
  assert.ok(sheet.cells.some((cell) => cell.text.trim() !== ''), '글자가 들어 있어야 한다');
});

test('내려받는 이름은 원본 확장자를 지킨다', () => {
  // 매크로가 든 파일을 .xlsx 로 내려주면 엑셀이 매크로를 버리거나 경고를 띄운다.
  assert.equal(filledFileName('6.2 품질목표관리.xlsm'), '6.2 품질목표관리 (작성본).xlsm');
  assert.equal(filledFileName('101. 이해관계자.xlsx'), '101. 이해관계자 (작성본).xlsx');
});

test('판 이름 비교에서도 .xlsm 을 확장자로 뗀다', () => {
  assert.equal(editionName('품질목표관리.xlsm'), editionName('품질목표관리.xlsx'));
});
