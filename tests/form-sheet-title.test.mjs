/** 새 장을 만들 때 제목은 남긴다 — 장마다 제목이 조금 달라도 내용이 아니다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { blankValuesFor, findTemplateSheet, restoreBlankedTitles, titleKeys } from '../apps/web/src/features/forms/formStore.ts';

const SAMPLE = fileURLToPath(new URL('./fixtures/7.3 조직의 지식관리.xlsx', import.meta.url));

async function sheets() {
  const buffer = await readFile(SAMPLE);
  return parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

test('실제 양식: 견본과 작성본의 제목이 달라도 새 장에 제목이 남는다', async () => {
  const all = await sheets();
  const template = findTemplateSheet(all);
  assert.equal(template.name, '견본');
  // 이 파일은 견본 "현장 지식등록 대장", 작성본 "현장 지식관리 대장"으로 제목이 다르다
  assert.deepEqual([...titleKeys(template)], ['1:4']);

  const blanks = blankValuesFor(all, template);
  assert.equal('1:4' in blanks, false, '제목은 비우지 않는다');
});

const cell = (row, col, text, fontSize) => ({
  key: `${row}:${col}`, row, col, rowSpan: 1, colSpan: 1, text, style: { borders: {}, fontSize },
});
const sheet = (name, cells) => ({ name, rowCount: 5, colCount: 3, colWidths: [], rowHeights: [], cells, images: [], shapes: [] });

test('제목은 본문보다 확연히 큰 가장 큰 글씨 — 모두 같은 크기면 제목이 없다', () => {
  const withTitle = sheet('견본', [cell(1, 1, '현장 대장', 22), cell(2, 1, '000 현장', 10), cell(3, 1, '번호', 10), cell(3, 2, '이름', 10)]);
  assert.deepEqual([...titleKeys(withTitle)], ['1:1']);

  const flat = sheet('견본', [cell(1, 1, '현장 대장', 10), cell(2, 1, '000 현장', 10)]);
  assert.equal(titleKeys(flat).size, 0);

  const slightlyBigger = sheet('견본', [cell(1, 1, '현장 대장', 12), cell(2, 1, '000', 10), cell(3, 1, '번호', 10)]);
  assert.equal(titleKeys(slightlyBigger).size, 0, '조금 큰 글씨는 제목으로 보지 않는다');
});

test('제목이 달라도 제목만 남고, 장마다 다른 현장명은 비운다', () => {
  const template = sheet('견본', [cell(1, 1, '현장 지식등록 대장', 22), cell(2, 1, '000 신축공사', 10), cell(3, 1, '번호', 10)]);
  const filled = sheet('7월', [cell(1, 1, '현장 지식관리 대장', 22), cell(2, 1, '부산 장안 B1', 10), cell(3, 1, '번호', 10)]);
  const blanks = blankValuesFor([filled, template], template);
  assert.deepEqual(blanks, { '2:1': '' });
});

test('이미 제목을 비워 만든 장은 열 때 제목이 돌아온다 — 제목에 적어 둔 글자는 그대로', () => {
  const template = sheet('견본', [cell(1, 1, '현장 대장', 22), cell(2, 1, '000 현장', 10), cell(3, 1, '번호', 10)]);
  const custom = [{ name: '26.09', source: '견본' }, { name: '26.10', source: '견본' }];
  const values = {
    '26.09': { '1:1': '', '2:1': '', '4:1': '적은 내용' },
    '26.10': { '1:1': '10월 지식관리 대장' },
  };
  const fixed = restoreBlankedTitles(values, [template], custom);
  assert.deepEqual(fixed['26.09'], { '2:1': '', '4:1': '적은 내용' }, '비운 제목만 걷어낸다');
  assert.deepEqual(fixed['26.10'], values['26.10'], '적어 둔 제목은 그대로');
  assert.equal(restoreBlankedTitles(fixed, [template], custom), fixed, '고칠 게 없으면 같은 객체');
});
