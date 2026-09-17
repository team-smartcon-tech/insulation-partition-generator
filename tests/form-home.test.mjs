/** 홈 숫자 — 결재 진행현황·내 결재함·멈춘 결재·진척도·전 현장 점검. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { approvalOverview, daysSince, documentProgress, sitesAudit, turnStartedAt } from '../apps/web/src/features/forms/homeStats.ts';
import { stampAssignedAt } from '../apps/web/src/features/forms/approvalLine.ts';

const DAY = 86400000;
const NOW = 100 * DAY;
const slots = [{ label: '작성', signKey: 'a' }, { label: '검토', signKey: 'b' }, { label: '승인', signKey: 'c' }];
const who = (name, position = '', assignedAt = 90 * DAY) => ({ name, position, role: '', assignedAt });
const signed = (name, userId, approvedAt) => ({ name, position: '', userId, approvedAt });
const line = { a: who('이상영', '대리'), b: who('문홍주', '과장'), c: who('조형규', '부장') };
const doc = (id, sheets, extra = {}) => ({ id, title: `서류 ${id}`, kind: 'site', siteId: 's1', approvalSheets: sheets, ...extra });
const sheet = (name, approvals = {}, l = line) => ({ sheetName: name, slots, line: l, approvals });

test('결재 진행현황: 내 차례·올린 결재·완료·사람별 대기', () => {
  const docs = [
    doc('1', [sheet('9월')]), // 내가 작성할 차례
    doc('2', [sheet('9월', { a: signed('이상영', 'me', 95 * DAY) })]), // 내가 올림 → 문홍주 차례
    doc('3', [sheet('9월', { a: signed('이상영', 'me', 91 * DAY), b: signed('문홍주', 'u2', 92 * DAY) })]), // 조형규 차례
    doc('4', [sheet('9월', { a: signed('이상영', 'me', 1), b: signed('문홍주', 'u2', 2), c: signed('조형규', 'u3', 3) })]), // 완료
    doc('5', [sheet('9월', {}, {})]), // 결재선 미지정
    { id: 't', title: '원본', kind: 'template', approvalSheets: [sheet('9월')] }, // 배포 원본은 세지 않는다
  ];
  const overview = approvalOverview(docs, { id: 'me', name: '이상영' }, NOW);
  assert.deepEqual(overview.myTurn.map((i) => i.formId), ['1']);
  assert.deepEqual(overview.requested.map((i) => i.formId), ['3', '2'], '오래 기다린 것부터');
  assert.deepEqual(overview.completed.map((i) => i.formId), ['4']);
  assert.deepEqual(overview.unassigned.map((i) => i.formId), ['5']);
  assert.deepEqual(overview.waitingByPerson.map((p) => [p.name, p.count]), [['문홍주', 1], ['이상영', 1], ['조형규', 1]]);
  assert.equal(overview.inAnyLine, true);
  assert.deepEqual(overview.myTurn[0].steps.map((s) => s.status), ['now', 'wait', 'wait']);
  assert.deepEqual(overview.requested[1].steps.map((s) => s.status), ['done', 'now', 'wait']);
});

test('멈춘 결재: 차례가 온 뒤 3일 넘게 — 앞 칸 결재 시각, 첫 칸은 결재선 정한 시각부터', () => {
  const docs = [
    doc('old', [sheet('9월', { a: signed('이상영', 'me', 95 * DAY) })]), // 5일째 문홍주
    doc('new', [sheet('9월', { a: signed('이상영', 'me', 99 * DAY) })]), // 1일째
    doc('first', [sheet('9월', {}, { a: who('이상영', '대리', 96 * DAY), b: who('문홍주'), c: who('조형규') })]), // 4일째 작성
    doc('unknown', [sheet('9월', {}, { a: { name: '이상영', position: '', role: '' }, b: who('문홍주'), c: who('조형규') })]), // 시각 모름
  ];
  const overview = approvalOverview(docs, { id: 'x', name: '누구' }, NOW);
  assert.deepEqual(overview.stalled.map((i) => i.formId), ['old', 'first']);
  assert.equal(daysSince(overview.stalled[0].since, NOW), 5);
  assert.equal(turnStartedAt(docs[3].approvalSheets[0], 0), undefined, '시각을 모르면 멈춤으로 보지 않는다');
});

test('결재선 정한 시각: 같은 사람이면 처음 시각을 지킨다', () => {
  const before = { a: who('이상영', '대리', 10), b: who('문홍주', '과장', 10) };
  const next = {
    a: { name: '이상영', position: '대리', role: '' },
    b: { name: '윤효환', position: '과장', role: '' },
    c: { name: '조형규', position: '부장', role: '' },
  };
  const stamped = stampAssignedAt(before, next, 99);
  assert.deepEqual([stamped.a.assignedAt, stamped.b.assignedAt, stamped.c.assignedAt], [10, 99, 99]);
});

const taxonomy = {
  id: 'q', division: '품질관련', fileName: 'x', conflicts: [],
  groups: [
    { code: '100', name: '공통', items: [{ code: '101', name: 'a' }, { code: '102', name: 'b' }, { code: '103', name: 'c' }] },
    { code: '200', name: '교육', items: [{ code: '201', name: 'd' }, { code: '202', name: 'e' }] },
  ],
};
const tpl = (code) => ({ id: `t${code}`, title: code, kind: 'template', code, taxonomyId: 'q' });
const made = (code, siteId = 's1') => ({ id: `d${code}${siteId}`, title: code, kind: 'site', siteId, code, taxonomyId: 'q' });

test('서류 진척도: 분모는 배포 양식이 있는 종류, 월별 여러 부는 한 종', () => {
  const docs = [tpl('101'), tpl('102'), tpl('201'), made('101'), made('101'), made('201'), made('102', 's2')];
  const progress = documentProgress([taxonomy], docs, 's1');
  assert.deepEqual([progress.made, progress.deployed, progress.undeployed], [2, 3, 2], '103·202 는 배포 안 됨');
  assert.deepEqual(progress.divisions.map((d) => [d.name, d.made, d.deployed]), [['품질관련', 2, 3]]);
  assert.deepEqual(progress.lowGroups.map((g) => [g.code, g.made, g.deployed]), [['100', 1, 2]], '다 만든 중분류는 빠진다');
});

test('전 현장 점검표: 진척도 낮은 현장이 위, 결재 진행·멈춤·미지정 수', () => {
  const docs = [
    tpl('101'), tpl('102'),
    made('101'), made('102'),
    { ...made('101', 's2'), approvalSheets: [sheet('9월', { a: signed('이상영', 'me', 90 * DAY) })] },
    { ...made('101', 's2'), id: 'x2', approvalSheets: [sheet('9월', {}, {})] },
  ];
  const rows = sitesAudit([{ id: 's1', name: '부산장안' }, { id: 's2', name: '광주선운' }], [taxonomy], docs, NOW);
  assert.deepEqual(rows.map((r) => [r.siteName, r.made, r.deployed, r.inProgress, r.stalled, r.unassigned]), [
    ['광주선운', 1, 2, 1, 1, 1],
    ['부산장안', 2, 2, 0, 0, 0],
  ]);
});
