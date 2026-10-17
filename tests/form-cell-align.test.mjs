/** 칸 맞춤 바꾸기 — 화면 덮어쓰기, 줄 끼우기 따라가기, 엑셀 서식 적기. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { alignKey, allAligned, parseAlign, setAlign, withAlignOverrides } from '../apps/web/src/features/forms/cellAlign.ts';
import { shiftCellKeys } from '../apps/web/src/features/forms/sheetRows.ts';
import { alignCells } from '../apps/web/src/features/forms/sheetMergesExport.ts';

const cell = (key, style = {}) => ({ key, row: Number(key.split(':')[0]), col: Number(key.split(':')[1]), style: { borders: {}, ...style } });

test('고른 칸 맞춤을 바꾸고 화면 서식에 덮는다', () => {
  const cells = [cell('7:11'), cell('7:12', { valign: 'bottom' })];
  const { values, changes } = setAlign({}, cells, { h: 'center' });
  assert.equal(changes.length, 2);
  assert.deepEqual(parseAlign(values[alignKey('7:11')]), { h: 'center' });
  assert.deepEqual(parseAlign(values[alignKey('7:12')]), { h: 'center', v: 'bottom' }, '세로는 원래 것 유지');
  const sheet = withAlignOverrides({ cells, name: 's' }, values);
  assert.equal(sheet.cells[0].style.align, 'center');
  assert.ok(allAligned(sheet.cells, { h: 'center' }));
  // 바꾼 것이 없으면 같은 시트
  const plain = { cells, name: 's' };
  assert.equal(withAlignOverrides(plain, { '7:11': '4' }), plain);
});

test('줄을 끼우면 맞춤도 따라 밀린다', () => {
  const shifted = shiftCellKeys({ '7:11': '4', 'align:7:11': 'center|', 'align:3:2': 'left|' }, 5, 1);
  assert.equal(shifted['8:11'], '4');
  assert.equal(shifted['align:8:11'], 'center|');
  assert.equal(shifted['align:3:2'], 'left|');
});

test('엑셀 서식: 그 칸만 맞춤을 바꾼 새 서식 번호를 준다', () => {
  const styles = '<styleSheet><cellXfs count="2"><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"><alignment horizontal="left" wrapText="1"/></xf></cellXfs></styleSheet>';
  const sheet = '<sheetData><row r="7"><c r="K7" s="0" t="s"><v>1</v></c><c r="L7" s="1"><v>4</v></c></row></sheetData>';
  const out = alignCells(sheet, styles, [{ row: 7, col: 11, h: 'center', v: 'middle' }, { row: 7, col: 12, h: 'right' }]);
  assert.match(out.styles, /<cellXfs count="4">/);
  assert.match(out.styles, /<xf numFmtId="0" fontId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"\/><\/xf>/);
  assert.match(out.styles, /<alignment horizontal="right" wrapText="1"\/>/);
  assert.match(out.sheet, /r="K7" s="2"/);
  assert.match(out.sheet, /r="L7" s="3"/);
});
