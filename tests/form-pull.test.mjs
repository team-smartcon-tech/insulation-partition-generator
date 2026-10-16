/** 서버 서류를 브라우저 서류로 — 다른 사람이 처음 열어도 같은 서류가 보이게. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { contentFromServer, formFromServer, pullOrder } from '../apps/web/src/features/forms/formPull.ts';

const row = (over) => ({
  id: 'd1', kind: 'site', site_id: 's1', taxonomy_id: null, code: null, title: '7.5 의사소통관리', file_name: '7.5.xlsx',
  attachment: false, file_size: 1000, content_type: null, sheets: [{ name: 'QA-7.5-3' }], parser_version: 25,
  cell_values: { 'QA-7.5-3': { '5:2': '공문' } }, custom_sheets: [], extra_rows: {}, approval_lines: {}, approvals: {},
  sheet_depts: { 'QA-7.5-3': '공무' }, sheet_edited_at: {}, template_id: 't1', template_uploaded_at: '2026-09-01T00:00:00Z',
  batch_id: null, uploaded_by: null, uploader_name: null, review_status: 'none', reviewer_name: null, reviewed_at: null,
  review_note: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', ...over,
});

test('서버 한 건 → 브라우저 서류: 원본 파일은 열 때 받는다', () => {
  const form = formFromServer(row(), new Map());
  assert.equal(form.remoteBytes, true);
  assert.equal(form.fromServer, true);
  assert.equal(form.bytes.byteLength, 0);
  assert.equal(form.siteId, 's1');
  assert.equal(form.values['QA-7.5-3']['5:2'], '공문');
  assert.equal(form.sheetDepts['QA-7.5-3'], '공무');
  assert.equal(form.parserVersion, 25);
  assert.equal(form.updatedAt, Date.parse('2026-10-10T00:00:00Z'));
});

test('배포 양식의 올라온 때는 현장 사본이 기억하는 때 — "새 판" 잘못 뜨지 않게', () => {
  const template = formFromServer(row({ id: 't1', kind: 'template', site_id: null }), new Map([['t1', Date.parse('2026-09-01T00:00:00Z')]]));
  assert.equal(template.uploadedAt, Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(template.siteId, undefined);
});

test('이미 있는 서류에는 내용만 덮는다(원본·줄 끼우기는 지킨다)', () => {
  const fields = contentFromServer(row());
  assert.equal('bytes' in fields, false);
  assert.equal('rowInserts' in fields, false);
  assert.equal('remoteBytes' in fields, false);
});

test('지금 보는 현장 서류 → 배포 양식 → 다른 현장 순서로 받는다', () => {
  const rows = [row({ id: 'a', site_id: 'other' }), row({ id: 'b', kind: 'template', site_id: null }), row({ id: 'c' })];
  assert.deepEqual(pullOrder(rows, 's1').map((r) => r.id), ['c', 'b', 'a']);
});
