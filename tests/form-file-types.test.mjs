/** 어떤 파일을 받을지 — 매크로 엑셀(.xlsm)은 받고, 옛 엑셀(.xls)·한글은 안 받는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import {
  baseFileName,
  editionName,
  isAttachmentFile,
  isExcelFile,
  isUploadableFile,
  fileKind,
  fileSizeText,
} from '../apps/web/src/features/forms/library.ts';
import { filledFileName } from '../apps/web/src/features/forms/formExport.ts';

test('받는 파일 가리기', () => {
  assert.ok(isExcelFile('101. 이해관계자.xlsx'));
  assert.ok(isExcelFile('검측요청서.XLSX'), '대문자도 같다');
  assert.ok(isExcelFile('6.2 품질목표관리.xlsm'), '매크로가 든 엑셀도 받는다');
  assert.equal(isExcelFile('검측요청서.xls'), false, '옛 형식은 못 읽는다');
  assert.equal(isExcelFile('검측요청서.hwp'), false);
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

test('엑셀이 아닌 파일은 모두 첨부로 받는다 — 현장 공유폴더를 대신하려면 아무 파일이나 들어와야 한다', () => {
  assert.equal(isAttachmentFile('601. 검측요청서.hwp'), true);
  assert.equal(isAttachmentFile('01. 공사현황보고.pptx'), true);
  assert.equal(isAttachmentFile('구조도면.dwg'), true);
  assert.equal(isAttachmentFile('현장사진.jpg'), true);
  assert.equal(isAttachmentFile('112. 목록표.xlsx'), false, '엑셀은 열어서 채운다');
  assert.equal(isAttachmentFile('6.2 품질목표.xlsm'), false);

  // 무엇이든 받는다(빈 이름만 뺀다)
  for (const name of ['a.xlsx', 'a.hwp', 'a.pdf', 'a.zip', 'a.dwg', 'a.png', '이름만있는파일']) {
    assert.equal(isUploadableFile(name), true, name);
  }
  assert.equal(isUploadableFile('   '), false);
});

test('파일 종류를 가려 이름표와 안내문에 쓴다', () => {
  assert.deepEqual(fileKind('검측요청서.hwp'), { label: '한글', fillable: true });
  assert.deepEqual(fileKind('보고서.DOCX'), { label: '워드', fillable: true });
  assert.deepEqual(fileKind('공사현황.pptx'), { label: 'PPT', fillable: true });
  assert.deepEqual(fileKind('도면.dwg'), { label: '도면', fillable: false });
  assert.deepEqual(fileKind('자료.zip'), { label: '압축', fillable: false });
  assert.deepEqual(fileKind('공지.pdf'), { label: 'PDF', fillable: false, preview: 'pdf' });
  assert.deepEqual(fileKind('현장사진.JPG'), { label: '사진', fillable: false, preview: 'image' });
  assert.equal(fileKind('처음보는것.abc').label, 'ABC', '모르는 확장자는 그대로 보여 준다');
  assert.equal(fileKind('확장자없음').label, '파일');
});

test('첨부 파일 크기 표기', () => {
  assert.equal(fileSizeText(27), '27B');
  assert.equal(fileSizeText(9876), '9.6KB');
  assert.equal(fileSizeText(3 * 1024 * 1024), '3MB');
  assert.equal(fileSizeText(0), '');
  assert.equal(fileSizeText(undefined), '');
});
