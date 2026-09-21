/** 결재 완료 잠그기와 "결재 뒤 수정됨" 판단. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { changedAfterApproval, contentHash, isFullyApproved } from '../apps/web/src/features/forms/approvalLine.ts';
import { approvalSheetsOf } from '../apps/web/src/features/forms/formStore.ts';
import { approvalOverview } from '../apps/web/src/features/forms/homeStats.ts';

test('내용 지문: 같은 내용이면 같고, 한 글자만 달라도 다르다', () => {
  const a = { '7:1': '1', '7:2': '시공-1' };
  assert.equal(contentHash(a), contentHash({ '7:2': '시공-1', '7:1': '1' }), '칸 순서는 상관없다');
  assert.notEqual(contentHash(a), contentHash({ '7:1': '1', '7:2': '시공-2' }));
  assert.notEqual(contentHash(a), contentHash({ '7:1': '1' }), '칸을 지워도 다르다');
  assert.equal(contentHash(undefined), contentHash({}), '빈 시트끼리는 같다');
});

const slots = [{ label: '작성', signKey: 'a' }, { label: '검토', signKey: 'b' }];
const signed = (hash) => ({ name: '이상영', position: '', userId: 'u', signature: '', approvedAt: 10, contentHash: hash });

test('결재 완료 판정 — 칸이 없으면 완료가 아니다', () => {
  assert.equal(isFullyApproved(slots, { a: signed(), b: signed() }), true);
  assert.equal(isFullyApproved(slots, { a: signed() }), false);
  assert.equal(isFullyApproved([], {}), false);
});

test('결재 뒤 수정됨 — 지문이 없는 옛 결재는 경고하지 않는다', () => {
  const cells = { '7:1': '값' };
  const hash = contentHash(cells);
  assert.equal(changedAfterApproval({ a: signed(hash) }, cells), false);
  assert.equal(changedAfterApproval({ a: signed(hash) }, { '7:1': '바꾼 값' }), true);
  assert.equal(changedAfterApproval({ a: signed(undefined) }, { '7:1': '바꾼 값' }), false, '옛 결재는 모르니 조용히');
  assert.equal(changedAfterApproval({}, cells), false);
});

test('마지막 결재 기준으로 본다 — 앞 결재 뒤 고치고 다시 결재하면 경고가 사라진다', () => {
  const after = { '7:1': '고친 값' };
  const approvals = {
    a: { ...signed(contentHash({ '7:1': '처음' })), approvedAt: 10 },
    b: { ...signed(contentHash(after)), approvedAt: 20 },
  };
  assert.equal(changedAfterApproval(approvals, after), false);
});

// ─── 저장소 요약·홈 ───────────────────────────────────────
const boxSheet = (name) => ({
  name, rowCount: 3, colCount: 4, colWidths: [], rowHeights: [],
  cells: [
    { key: '1:1', row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '작성', style: { borders: {} } },
    { key: '1:2', row: 1, col: 2, rowSpan: 1, colSpan: 1, text: '검토', style: { borders: {} } },
    { key: '2:1', row: 2, col: 1, rowSpan: 1, colSpan: 1, text: '', style: { borders: {} } },
    { key: '2:2', row: 2, col: 2, rowSpan: 1, colSpan: 1, text: '', style: { borders: {} } },
  ],
  images: [], shapes: [],
});
const form = (values, approvals) => ({
  id: 'f', fileName: 'x.xlsx', title: '서류', category: '미분류', favorite: false, kind: 'site', siteId: 's',
  uploadedAt: 1, updatedAt: 1, openedAt: 1, bytes: new ArrayBuffer(0), parserVersion: 1,
  sheets: [boxSheet('9월')], values, customSheets: [], extraRows: {},
  approvalLines: { '9월': { '2:1': { name: '이상영', position: '', role: '' } } },
  approvals: { '9월': approvals },
});

test('목록 요약이 "결재 뒤 수정됨"을 함께 싣는다', () => {
  const cells = { '3:1': '처음 값' };
  const same = approvalSheetsOf(form({ '9월': cells }, { '2:1': signed(contentHash(cells)) }));
  assert.equal(same[0].changed, false);

  const edited = approvalSheetsOf(form({ '9월': { '3:1': '바꾼 값' } }, { '2:1': signed(contentHash(cells)) }));
  assert.equal(edited[0].changed, true);
});

test('홈 알림에 "결재 뒤 수정됨"이 모인다', () => {
  const sheet = {
    sheetName: '9월',
    slots,
    line: { a: { name: '이상영', position: '', role: '' }, b: { name: '문홍주', position: '', role: '' } },
    approvals: { a: { name: '이상영', position: '', userId: 'u', approvedAt: 10 } },
    changed: true,
  };
  const overview = approvalOverview([{ id: 'd', title: '서류', kind: 'site', approvalSheets: [sheet] }], { id: 'u', name: '이상영' }, 100);
  assert.deepEqual(overview.changed.map((i) => i.sheetName), ['9월']);
  assert.deepEqual(overview.changed[0].steps.map((s) => s.status), ['done', 'now']);
});
