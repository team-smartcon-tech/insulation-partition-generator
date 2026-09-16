/** 시트 아래에 줄을 더하는 규칙과, 내려받을 때 인쇄 영역이 함께 늘어나는지. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { withExtraRows, textInExtraRows } from '../apps/web/src/features/forms/sheetRows.ts';
import { extendPrintArea, buildFilledWorkbook } from '../apps/web/src/features/forms/formExport.ts';
import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const cell = (row, col, text, style = {}) => ({
  key: `${row}:${col}`,
  row,
  col,
  rowSpan: 1,
  colSpan: 1,
  text,
  style: { borders: { top: { style: 'thin' } }, ...style },
});

const sheet = {
  name: '특이사항',
  rowCount: 2,
  colCount: 2,
  colWidths: [80, 120],
  rowHeights: [20, 24],
  cells: [cell(1, 1, '구분'), cell(1, 2, '내용'), cell(2, 1, '1'), cell(2, 2, '기존 줄')],
  images: [],
  shapes: [],
};

test('더한 줄은 바로 위 줄의 서식을 물려받고 내용만 비어 있다', () => {
  const grown = withExtraRows(sheet, 2);

  assert.equal(grown.rowCount, 4);
  assert.deepEqual(grown.rowHeights, [20, 24, 24, 24], '줄 높이도 마지막 줄을 따른다');
  const added = grown.cells.filter((c) => c.row > sheet.rowCount);
  assert.deepEqual(added.map((c) => c.key), ['3:1', '3:2', '4:1', '4:2']);
  assert.deepEqual(added.map((c) => c.text), ['', '', '', '']);
  assert.equal(added[0].style, sheet.cells[2].style, '테두리·글꼴은 위 줄 그대로');
  // 원본은 건드리지 않는다(저장본을 그대로 두고 그릴 때만 잇는다).
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.cells.length, 4);
});

test('줄을 0개 더하면 원본 그대로다', () => {
  assert.equal(withExtraRows(sheet, 0), sheet);
});

test('더한 줄에 적은 글자 수를 센다', () => {
  const values = { '2:2': '기존 줄 수정', '3:2': '추가 내용', '4:2': '   ' };
  assert.equal(textInExtraRows(values, 2), 1);
  assert.equal(textInExtraRows(undefined, 2), 0);
});

test('인쇄 영역은 적은 줄까지 늘어난다(줄어들지는 않는다)', () => {
  const xml =
    '<workbook><definedNames>' +
    '<definedName name="_xlnm.Print_Area" localSheetId="0">\'특이사항\'!$A$1:$K$33</definedName>' +
    '<definedName name="_xlnm.Print_Area" localSheetId="1">\'다른시트\'!$A$1:$C$9</definedName>' +
    '</definedNames></workbook>';

  const grown = extendPrintArea(xml, new Map([[0, 40]]));
  assert.match(grown, /'특이사항'!\$A\$1:\$K\$40/, '0번 시트는 40줄까지');
  assert.match(grown, /'다른시트'!\$A\$1:\$C\$9/, '건드리지 않은 시트는 그대로');

  // 이미 넉넉하면 그대로 둔다.
  assert.equal(extendPrintArea(xml, new Map([[0, 10]])), xml);
});

test('줄을 더해 적은 내용이 내려받는 파일과 인쇄 영역에 함께 들어간다', async () => {
  const file = fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url));
  const buffer = await readFile(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const [original] = await parseFormWorkbook(data);

  const addedRow = original.rowCount + 2;
  const { bytes } = await buildFilledWorkbook(data, {
    [original.name]: { [`${addedRow}:1`]: '현장에서 더한 줄' },
  });

  const [after] = await parseFormWorkbook(bytes);
  // 인쇄 영역이 함께 늘어나야 파서도 그 줄을 읽는다(인쇄 영역 밖은 잘라내기 때문).
  assert.ok(after.rowCount >= addedRow, `인쇄 영역이 ${addedRow}줄까지 늘어야 한다`);
  assert.equal(after.cells.find((c) => c.key === `${addedRow}:1`).text, '현장에서 더한 줄');
});
