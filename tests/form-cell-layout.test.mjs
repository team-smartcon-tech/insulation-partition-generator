/**
 * 칸 들여쓰기·세로 글자를 읽는가.
 *
 * 둘 다 빠뜨리면 회사 양식의 그림이 깨져 보였다(2026-10-13 사용자 신고) —
 * QA-4.3-4 는 들여쓴 글자 아래를 선이 가리키고, QA-4.3-2 는 옆 띠 제목이 세로 글자다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ExcelJS = require('exceljs');

async function parse(build) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('QA-4.3-4');
  build(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return (await parseFormWorkbook(data))[0];
}

const cellAt = (sheet, row, col) => sheet.cells.find((c) => c.row === row && c.col === col);

test('들여쓰기 단계를 읽는다', async () => {
  const sheet = await parse((ws) => {
    ws.getCell('A1').value = '00000 - □□ - □ - □□□';
    ws.getCell('A1').alignment = { horizontal: 'left', indent: 4 };
    ws.getCell('A2').value = '들여쓰기 없음';
  });
  assert.equal(cellAt(sheet, 1, 1).style.indent, 4);
  assert.equal(cellAt(sheet, 2, 1).style.indent, undefined);
});

test('세로 글자 방향을 읽는다 — 위로·아래로·쌓기, 비스듬한 각도는 무시', async () => {
  const sheet = await parse((ws) => {
    ws.getCell('A1').value = '고객 요구사항';
    ws.getCell('A1').alignment = { textRotation: 90 };
    ws.getCell('B1').value = '고객만족도';
    ws.getCell('B1').alignment = { textRotation: -90 };
    ws.getCell('C1').value = '의사소통관리';
    ws.getCell('C1').alignment = { textRotation: 'vertical' };
    ws.getCell('D1').value = '살짝 기울임';
    ws.getCell('D1').alignment = { textRotation: 15 };
  });
  assert.equal(cellAt(sheet, 1, 1).style.textDirection, 'up');
  assert.equal(cellAt(sheet, 1, 2).style.textDirection, 'down');
  assert.equal(cellAt(sheet, 1, 3).style.textDirection, 'stacked');
  assert.equal(cellAt(sheet, 1, 4).style.textDirection, undefined);
});
