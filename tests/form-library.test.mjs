/** 배포 양식함(원본)과 현장 서류함(사본)을 나누는 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  latestTemplateIn,
  newerTemplateFor,
  planLegacyForm,
  siteCopyFields,
} from '../apps/web/src/features/forms/library.ts';

const taxonomies = [
  { id: 'q', division: '품질관련', fileName: 'x.xlsx', conflicts: [], groups: [{ code: '700', name: '현장', items: [{ code: '712', name: '현장설명서' }] }] },
];

test('사본은 원본의 칸·이름을 따르고, 적은 내용은 비어 있다', () => {
  const template = { id: 't1', kind: 'template', title: '현장설명서', code: '712', taxonomyId: 'q', uploadedAt: 100 };
  const fields = siteCopyFields(template, 'site-a');
  assert.equal(fields.kind, 'site');
  assert.equal(fields.siteId, 'site-a');
  assert.equal(fields.code, '712');
  assert.equal(fields.templateId, 't1');
  assert.equal(fields.templateUploadedAt, 100);
  assert.deepEqual(fields.values, {});
  assert.deepEqual(fields.customSheets, []);
});

test('같은 칸에 나중에 올라온 원본이 있으면 "새 판 있음"', () => {
  const old = { id: 't1', kind: 'template', code: '712', taxonomyId: 'q', uploadedAt: 100 };
  const doc = { id: 'd1', kind: 'site', siteId: 's', code: '712', taxonomyId: 'q', uploadedAt: 150, templateId: 't1', templateUploadedAt: 100 };

  assert.equal(newerTemplateFor(doc, [old], taxonomies), undefined, '원본이 그대로면 새 판 없음');

  const v2 = { id: 't2', kind: 'template', code: '712', taxonomyId: 'q', uploadedAt: 200 };
  const v3 = { id: 't3', kind: 'template', code: '712', taxonomyId: 'q', uploadedAt: 300 };
  const otherSlot = { id: 't4', kind: 'template', code: '713', taxonomyId: 'q', uploadedAt: 400 };
  assert.equal(newerTemplateFor(doc, [old, v2, v3, otherSlot], taxonomies)?.id, 't3', '가장 최근 판');

  // 새 판으로 다시 만든 사본에는 더 새 판이 없다
  const redone = { ...doc, templateId: 't3', templateUploadedAt: 300 };
  assert.equal(newerTemplateFor(redone, [old, v2, v3], taxonomies), undefined);

  // 먼저 올라온(옛) 원본은 새 판이 아니다
  const fromV2 = { ...doc, templateId: 't2', templateUploadedAt: 200 };
  assert.equal(newerTemplateFor(fromV2, [old, v2], taxonomies), undefined);
});

test('현장 서류함의 빈 칸은 그 칸의 최신 원본으로 작성한다', () => {
  const forms = [
    { id: 't1', kind: 'template', code: '712', taxonomyId: 'q', uploadedAt: 100 },
    { id: 't2', kind: 'template', code: '712', taxonomyId: 'q', uploadedAt: 200 },
    { id: 'd1', kind: 'site', code: '712', taxonomyId: 'q', uploadedAt: 900 },
  ];
  assert.equal(latestTemplateIn('q', '712', forms, taxonomies)?.id, 't2', '현장 서류는 원본이 아니다');
  assert.equal(latestTemplateIn('q', '713', forms, taxonomies), undefined);
});

test('옛 서류 — 적은 게 없으면 배포 양식으로만 간다', () => {
  const form = { id: 'a', code: '712', taxonomyId: 'q', uploadedAt: 1, values: {}, customSheets: [], extraRows: {} };
  const plan = planLegacyForm(form, 'first', () => 'new');
  assert.equal(plan.template.kind, 'template');
  assert.equal(plan.template.id, 'a');
  assert.equal(plan.copy, undefined);
});

test('옛 서류 — 적은 내용은 사라지지 않고 현장 사본으로 옮겨 간다', () => {
  const form = {
    id: 'a', code: '712', taxonomyId: 'q', uploadedAt: 1, siteId: 'busan',
    values: { 시트1: { '3:2': '부산장안' } }, customSheets: [{ name: '2026-07', source: '견본' }], extraRows: { 시트1: 2 },
  };
  const plan = planLegacyForm(form, 'first', () => 'copy-1');

  assert.equal(plan.template.id, 'a');
  assert.equal(plan.template.siteId, undefined, '원본은 어느 현장 것도 아니다');
  assert.deepEqual(plan.template.values, {}, '원본은 깨끗하게');
  assert.deepEqual(plan.template.customSheets, []);

  assert.equal(plan.copy.id, 'copy-1');
  assert.equal(plan.copy.kind, 'site');
  assert.equal(plan.copy.siteId, 'busan', '올렸던 현장으로');
  assert.equal(plan.copy.templateId, 'a');
  assert.deepEqual(plan.copy.values, form.values);
  assert.deepEqual(plan.copy.customSheets, form.customSheets);
  assert.deepEqual(plan.copy.extraRows, form.extraRows);

  // 현장 표시가 없던 서류는 첫 현장으로
  const noSite = planLegacyForm({ ...form, siteId: undefined }, 'first', () => 'copy-2');
  assert.equal(noSite.copy.siteId, 'first');
});
