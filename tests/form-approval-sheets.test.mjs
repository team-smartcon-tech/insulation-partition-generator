/** 홈이 세는 결재 시트 — 작성 중인 장만(과거 기록은 빼고). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { approvalSheetsOf } from '../apps/web/src/features/forms/formStore.ts';

/** 결재칸(작성·검토)이 있는 시트 한 장 */
const boxSheet = (name, extra = {}) => ({
  name,
  rowCount: 3,
  colCount: 4,
  colWidths: [10, 10, 10, 10],
  rowHeights: [10, 10, 10],
  cells: [
    { key: '1:1', row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '작성', style: { borders: {} } },
    { key: '1:2', row: 1, col: 2, rowSpan: 1, colSpan: 1, text: '검토', style: { borders: {} } },
    { key: '2:1', row: 2, col: 1, rowSpan: 1, colSpan: 1, text: '', style: { borders: {} } },
    { key: '2:2', row: 2, col: 2, rowSpan: 1, colSpan: 1, text: '', style: { borders: {} } },
  ],
  images: [],
  shapes: [],
  ...extra,
});

const form = (patch = {}) => ({
  id: 'f', fileName: 'x.xlsx', title: 'x', category: '미분류', favorite: false, kind: 'site', siteId: 's',
  uploadedAt: 1, updatedAt: 1, openedAt: 1, bytes: new ArrayBuffer(0), parserVersion: 1,
  sheets: [boxSheet('QA-4.2-2(25.09)'), boxSheet('QA-4.2-2(25.12)'), boxSheet('견본')],
  values: {}, customSheets: [], extraRows: {}, approvalLines: {}, approvals: {},
  ...patch,
});

test('손대지 않은 과거 시트는 세지 않는다 — 견본도 제외', () => {
  assert.deepEqual(approvalSheetsOf(form()).map((s) => s.sheetName), []);
});

test('글자를 적은 장, 앱에서 더한 장, 결재선·결재가 있는 장만 센다', () => {
  assert.deepEqual(
    approvalSheetsOf(form({ values: { 'QA-4.2-2(25.12)': { '3:1': '적음' } } })).map((s) => s.sheetName),
    ['QA-4.2-2(25.12)'],
  );
  assert.deepEqual(
    approvalSheetsOf(form({ customSheets: [{ name: '26.09', source: 'QA-4.2-2(25.09)' }] })).map((s) => s.sheetName),
    ['26.09'],
  );
  assert.deepEqual(
    approvalSheetsOf(form({ approvalLines: { 'QA-4.2-2(25.09)': { '2:1': { name: '이상영', position: '대리', role: '' } } } })).map((s) => s.sheetName),
    ['QA-4.2-2(25.09)'],
    '결재선을 지정해 둔 장은 글자를 안 적었어도 센다',
  );
  assert.deepEqual(
    approvalSheetsOf(form({ approvals: { 'QA-4.2-2(25.09)': { '2:1': { name: '이상영', position: '', userId: 'u', signature: 'data:', approvedAt: 1 } } } })).map((s) => s.sheetName),
    ['QA-4.2-2(25.09)'],
  );
});

test('배포 원본은 결재를 세지 않는다', () => {
  assert.deepEqual(approvalSheetsOf(form({ kind: 'template', values: { 'QA-4.2-2(25.09)': { '3:1': 'x' } } })), []);
});

test('세는 장에는 결재칸 자리와 서명 그림 뺀 결재 기록이 담긴다', () => {
  const [sheet] = approvalSheetsOf(form({
    values: { 'QA-4.2-2(25.09)': { '3:1': 'x' } },
    approvals: { 'QA-4.2-2(25.09)': { '2:1': { name: '이상영', position: '대리', userId: 'u', signature: 'data:image/png;base64,AAAA', approvedAt: 7 } } },
  }));
  assert.deepEqual(sheet.slots, [{ label: '작성', signKey: '2:1' }, { label: '검토', signKey: '2:2' }]);
  assert.equal('signature' in sheet.approvals['2:1'], false, '서명 그림은 목록에 싣지 않는다');
  assert.equal(sheet.approvals['2:1'].approvedAt, 7);
});
