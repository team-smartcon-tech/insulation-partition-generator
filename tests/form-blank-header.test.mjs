/** 새 장을 만들 때 표 머리글은 남기고 내용만 비운다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { blankValuesFor } from '../apps/web/src/features/forms/formStore.ts';

async function sheetsOf(name) {
  const buffer = await readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}
const rowsOf = (blanks) => [...new Set(Object.keys(blanks).map((key) => Number(key.split(':')[0])))].sort((a, b) => a - b);

test('실제 양식: 머리글 줄은 남고 그 아래 내용만 비운다', async () => {
  for (const file of ['6.1 리스크와 기회관리.xlsx', '7.3 조직의 지식관리.xlsx']) {
    const sheets = await sheetsOf(file);
    const source = sheets.find((sheet) => sheet.name === '견본');
    const blanks = blankValuesFor(sheets, source);
    const rows = rowsOf(blanks);
    assert.equal(rows.includes(6), false, `${file}: 머리글 줄(6행)은 남아야 한다`);
    assert.equal(rows.includes(7), true, `${file}: 내용 줄(7행)은 비워야 한다`);
  }
});

const cell = (row, col, text) => ({ key: `${row}:${col}`, row, col, rowSpan: 1, colSpan: 1, text, style: { borders: {} } });
const sheet = (name, cells) => ({ name, rowCount: 8, colCount: 4, colWidths: [], rowHeights: [], cells, images: [], shapes: [] });

test('결재칸 날짜 자리(/ / /)는 머리글로 보지 않는다', () => {
  // 기호만 있는 줄이 머리글로 잡히면 그 아래 진짜 머리글까지 비워진다(실제로 그랬다).
  const make = (dateA, header3, body) => [
    cell(4, 13, '/'), cell(4, 15, '/'), cell(4, 17, '/'),
    cell(5, 1, dateA),
    cell(6, 1, '번호'), cell(6, 2, '구분'), cell(6, 3, header3), cell(6, 4, '기회'), cell(6, 5, '담당'),
    cell(7, 1, '1'), cell(7, 2, '시공'), cell(7, 3, body), cell(7, 4, '예방'), cell(7, 5, '공무'),
  ];
  const source = sheet('견본', make('2026-01-01', '분석일자', '주방가구 박리'));
  const other = sheet('QA-1', make('2026-02-02', '발생일', '외부도장 박리'));

  const blanks = blankValuesFor([source, other], source);
  assert.equal('6:1' in blanks, false, '머리글은 남는다');
  assert.equal('6:3' in blanks, false, '장마다 조금 다른 머리글(분석일자/발생일)도 머리글');
  assert.equal(blanks['7:3'], '', '내용은 비운다');
  assert.equal(blanks['7:5'], '', '늘 같은 값(담당 공무)이어도 머리글 아래면 내용');
  assert.equal(blanks['5:1'], '', '머리글 위의 장마다 다른 칸(날짜)은 비운다');
});

test('머리글이 하나도 없으면(칸이 셋 미만) 칸 단위로만 비운다', () => {
  const source = sheet('견본', [cell(1, 1, '제목'), cell(2, 1, '현장 A'), cell(3, 1, '내용 A')]);
  const other = sheet('QA-1', [cell(1, 1, '제목'), cell(2, 1, '현장 B'), cell(3, 1, '내용 B')]);
  const blanks = blankValuesFor([source, other], source);
  assert.deepEqual(Object.keys(blanks).sort(), ['2:1', '3:1']);
});
