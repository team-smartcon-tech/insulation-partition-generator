/** 결재칸(작성·검토·승인) 찾기. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { findApprovalBoxes } from '../apps/web/src/features/forms/approval.ts';

async function load(name) {
  const buffer = await readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

test('실제 양식: 리스크 평가표의 작성·검토·승인 칸과 서명·날짜 자리를 찾는다', async () => {
  const sheets = await load('6.1 리스크와 기회관리.xlsx');
  const sheet = sheets.find((s) => s.name === 'QA-6.1-3');
  const boxes = findApprovalBoxes(sheet);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0].slots.map((slot) => slot.label), ['작성', '검토', '승인']);
  assert.deepEqual(boxes[0].slots.map((slot) => [slot.signKey, slot.dateKey]), [['2:13', '4:13'], ['2:15', '4:15'], ['2:17', '4:17']]);

  // 결재칸이 없는 절차 시트는 아무것도 안 찾는다
  const process = sheets.find((s) => s.name === 'QA-6.1-1');
  assert.deepEqual(findApprovalBoxes(process), []);
});

test('실제 양식: 이해관계자 양식 견본에서도 찾는다', async () => {
  const sheets = await load('101. 이해관계자니즈와기대2.xlsx');
  const boxes = findApprovalBoxes(sheets.find((s) => s.name === '견본'));
  assert.deepEqual(boxes.map((box) => box.slots.map((slot) => slot.label)), [['작성', '검토', '승인']]);
});

const cell = (row, col, text, span = 1) => ({ key: `${row}:${col}`, row, col, rowSpan: 1, colSpan: span, text, style: { borders: {} } });
const sheet = (cells) => ({ name: 's', rowCount: 5, colCount: 10, colWidths: [], rowHeights: [], cells, images: [], shapes: [] });

test('표 머리글처럼 아래에 글자가 찬 줄은 결재칸이 아니다', () => {
  const table = sheet([
    cell(1, 1, '공사'), cell(1, 2, '공무'), cell(1, 3, '품질'),
    cell(2, 1, ''), cell(2, 2, ''), cell(2, 3, ''),
  ]);
  assert.deepEqual(findApprovalBoxes(table), [], '부서 이름만 늘어선 줄은 단계 말이 없어 제외');

  const header = sheet([
    cell(1, 1, '작성'), cell(1, 2, '검토'),
    cell(2, 1, '홍길동'), cell(2, 2, '김철수'),
  ]);
  assert.deepEqual(findApprovalBoxes(header), [], '아래가 채워져 있으면 서명 자리가 아니다');

  const apart = sheet([
    cell(1, 1, '작성'), cell(1, 5, '승인'),
    cell(2, 1, ''), cell(2, 5, ''),
  ]);
  assert.deepEqual(findApprovalBoxes(apart), [], '떨어져 있는 칸은 한 묶음이 아니다');
});

test('담당·팀장·소장처럼 직책이 섞인 결재칸, 날짜 줄이 없는 결재칸', () => {
  const box = sheet([
    cell(1, 1, '담 당', 2), cell(1, 3, '팀장', 2), cell(1, 5, '소장', 2),
    cell(2, 1, '', 2), cell(2, 3, '', 2), cell(2, 5, '', 2),
  ]);
  const [found] = findApprovalBoxes(box);
  assert.deepEqual(found.slots.map((slot) => [slot.label, slot.signKey, slot.dateKey]), [
    ['담당', '2:1', undefined], ['팀장', '2:3', undefined], ['소장', '2:5', undefined],
  ]);
});

import { isTemplateSheet } from '../apps/web/src/features/forms/formStore.ts';

test('견본 시트는 결재할 문서가 아니다 — 견본을 복사해 더한 장은 문서다', async () => {
  const sheets = await load('6.1 리스크와 기회관리.xlsx');
  assert.deepEqual(sheets.filter(isTemplateSheet).map((s) => s.name), ['견본', '견본(2)']);
  const copied = { ...sheets.find((s) => s.name === '견본'), name: '26.09', custom: true };
  assert.equal(isTemplateSheet(copied), false);
});
