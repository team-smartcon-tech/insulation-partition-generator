/** 끼워 넣은 줄을 엑셀 XML 에 실제로 넣기 — 밀려야 할 것들이 다 밀리나. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  insertRowsIntoSheetXml,
  shiftDrawingRows,
  shiftPrintArea,
  shiftedRow,
} from '../apps/web/src/features/forms/sheetRowsExport.ts';

const sheetXml =
  '<worksheet><dimension ref="A1:C5"/><sheetData>' +
  '<row r="1" ht="20" customHeight="1"><c r="A1" s="3" t="s"><v>0</v></c><c r="B1" s="3"/></row>' +
  '<row r="2"><c r="A2" s="4"><v>10</v></c><c r="B2" s="4"><v>20</v></c></row>' +
  '<row r="5"><c r="A5" s="4"><v>50</v></c></row>' +
  '</sheetData><mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="A2:A5"/></mergeCells></worksheet>';

test('줄 번호가 몇 번으로 밀리나', () => {
  assert.equal(shiftedRow(1, [2]), 1, '끼운 자리 위는 그대로');
  assert.equal(shiftedRow(2, [2]), 3, '끼운 자리 줄은 한 칸 아래로');
  assert.equal(shiftedRow(5, [2, 2]), 7, '두 줄 끼우면 두 칸');
  assert.equal(shiftedRow(5, [2, 9]), 6, '아래쪽에 끼운 것은 셈하지 않는다');
});

test('줄·칸·병합·시트범위가 함께 밀린다', () => {
  const out = insertRowsIntoSheetXml(sheetXml, [2]);

  assert.match(out, /<row r="1"/, '1번 줄은 그대로');
  assert.match(out, /<c r="A1" s="3"/, '1번 줄 칸도 그대로');
  assert.match(out, /<row r="3"><c r="A3" s="4"><v>10<\/v>/, '2번 줄 내용이 3번으로');
  assert.match(out, /<row r="6"><c r="A6" s="4"><v>50<\/v>/, '5번 줄 내용이 6번으로');

  assert.match(out, /<mergeCell ref="A1:C1"\/>/, '끼운 자리 위 병합은 그대로');
  // 병합 **위**에 넣으면 병합이 통째로 밀린다(A2:A5 → A3:A6). 엑셀도 그렇게 한다.
  assert.match(out, /<mergeCell ref="A3:A6"\/>/, '병합 위에 넣으면 통째로 밀린다');
  assert.match(out, /<dimension ref="A1:C6"/, '시트 범위도 늘어난다');
});

test('병합을 **걸치는** 자리에 넣으면 병합이 늘어난다 — 엑셀과 같다', () => {
  const xml = '<sheetData><row r="1"><c r="A1" s="1"/></row><row r="5"><c r="A5"/></row></sheetData>' +
    '<mergeCells><mergeCell ref="A1:A5"/></mergeCells>';
  const out = insertRowsIntoSheetXml(xml, [3]);
  assert.match(out, /<mergeCell ref="A1:A6"\/>/, '시작은 그대로, 끝만 내려가 한 칸 커진다');
});

test('끼운 빈 줄은 위 줄의 서식을 물려받고 내용은 없다', () => {
  const out = insertRowsIntoSheetXml(sheetXml, [2]);
  const made = /<row r="2"[^>]*>(.*?)<\/row>/.exec(out);
  assert.ok(made, '2번 자리에 새 줄이 있어야 한다');
  assert.match(made[0], /ht="20"/, '위 줄 높이를 따른다');
  assert.match(made[1], /<c r="A2" s="3"\/>/, '테두리·글꼴 번호는 물려받고');
  assert.equal(/<v>/.test(made[1]), false, '내용은 비어 있다');
});

test('줄은 번호 순서대로 놓인다 — 엑셀이 그래야 받아들인다', () => {
  const out = insertRowsIntoSheetXml(sheetXml, [2, 2, 5]);
  const rows = [...out.matchAll(/<row\b[^>]*?\br="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), `순서가 어긋났다: ${rows}`);
  assert.deepEqual(rows, [1, 2, 3, 4, 7, 8], '두 줄·한 줄을 끼운 결과');
});

test('그림도 함께 밀린다(그림은 0 부터 센다)', () => {
  const drawing = '<xdr:from><xdr:row>0</xdr:row></xdr:from><xdr:to><xdr:row>4</xdr:row></xdr:to>';
  const out = shiftDrawingRows(drawing, [2]);
  assert.match(out, /<xdr:from><xdr:row>0<\/xdr:row>/, '시트 1번 줄(그림 0)은 그대로');
  assert.match(out, /<xdr:to><xdr:row>5<\/xdr:row>/, '시트 5번 줄(그림 4)은 한 칸 아래로');
});

test('인쇄 영역은 그 시트 것만 늘린다', () => {
  const workbook =
    '<definedNames>' +
    '<definedName name="_xlnm.Print_Area" localSheetId="0">\'첫장\'!$A$1:$L$46</definedName>' +
    '<definedName name="_xlnm.Print_Area" localSheetId="1">\'둘째장\'!$A$1:$M$15</definedName>' +
    '</definedNames>';
  const out = shiftPrintArea(workbook, 0, [2, 2, 2]);
  assert.match(out, /localSheetId="0">'첫장'!\$A\$1:\$L\$49</, '$ 가 붙은 표기도 늘어난다');
  assert.match(out, /localSheetId="1">'둘째장'!\$A\$1:\$M\$15</, '다른 시트는 건드리지 않는다');
});
