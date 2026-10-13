/** 계획서 서류 현황 — 서식 번호 읽기와 신호등 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QMP_SECTIONS,
  lampOf,
  qaCodeOf,
  qmpStates,
  qmpTally,
  templateForCode,
} from '../apps/web/src/features/forms/qmpPlan.ts';

test('시트 이름에서 서식 번호를 읽는다 — 지난달 장·양식 표시·원본 오타까지', () => {
  assert.equal(qaCodeOf('QA-7.2-2'), '7.2-2');
  assert.equal(qaCodeOf('QA-4.2-2(25.09)'), '4.2-2');
  assert.equal(qaCodeOf('QA-7.5-4(양식)'), '7.5-4');
  assert.equal(qaCodeOf('QA-7.3.-1'), '7.3-1');
  assert.equal(qaCodeOf('QA-8.11-10'), '8.11-10');
  assert.equal(qaCodeOf(' qa_10.1-3 '), '10.1-3');
  assert.equal(qaCodeOf('중복'), null);
  assert.equal(qaCodeOf('Sheet1'), null);
});

const slots = [{ signKey: 'a' }, { signKey: 'b' }];

test('결재가 다 끝나면 초록, 일부만이면 노랑', () => {
  const states = qmpStates([
    {
      id: 'd1',
      sheetNames: ['QA-7.2-2', 'QA-7.2-3'],
      workingSheets: ['QA-7.2-2', 'QA-7.2-3'],
      approvalSheets: [
        { sheetName: 'QA-7.2-2', slots, approvals: { a: { approvedAt: 10 }, b: { approvedAt: 20 } } },
        { sheetName: 'QA-7.2-3', slots, approvals: { a: { approvedAt: 10 } } },
      ],
    },
  ]);
  assert.deepEqual(states.get('7.2-2'), { status: 'done', finishedAt: 20, docId: 'd1', sheetName: 'QA-7.2-2' });
  assert.equal(states.get('7.2-3').status, 'doing');
});

test('결재 뒤에 고쳤으면 다시 노랑', () => {
  const states = qmpStates([
    {
      id: 'd1',
      sheetNames: ['QA-5.2-2'],
      workingSheets: ['QA-5.2-2'],
      approvalSheets: [{ sheetName: 'QA-5.2-2', slots, approvals: { a: { approvedAt: 1 }, b: { approvedAt: 2 } }, changed: true }],
    },
  ]);
  assert.equal(states.get('5.2-2').status, 'doing');
});

test('결재칸이 없는 장은 적었으면 초록, 복사만 해 둔 장은 빈 불', () => {
  const states = qmpStates([{ id: 'd1', sheetNames: ['QA-5.2-1', 'QA-5.2-2'], workingSheets: ['QA-5.2-1'] }]);
  assert.equal(states.get('5.2-1').status, 'done');
  assert.equal(states.get('5.2-2').status, 'none');
  assert.equal(states.get('5.2-2').docId, 'd1', '빈 불이어도 열어 볼 서류는 알려 준다');
});

test('같은 서식이 여러 장이면 가장 진척된 장을 고른다', () => {
  const states = qmpStates([
    { id: 'old', sheetNames: ['QA-4.2-2(25.09)'], workingSheets: [] },
    { id: 'new', sheetNames: ['QA-4.2-2'], workingSheets: ['QA-4.2-2'] },
  ]);
  assert.equal(states.get('4.2-2').status, 'done');
  assert.equal(states.get('4.2-2').docId, 'new');
});

test('[작성하기]는 그 서식 시트가 든 배포 양식 중 가장 최근 것', () => {
  const templates = [
    { id: 't1', sheetNames: ['QA-7.2-1', 'QA-7.2-2'], uploadedAt: 1 },
    { id: 't2', sheetNames: ['QA-7.2-2'], uploadedAt: 5 },
    { id: 't3', sheetNames: ['QA-9.1-2'], uploadedAt: 9 },
  ];
  assert.equal(templateForCode(templates, '7.2-2').id, 't2');
  assert.equal(templateForCode(templates, '8.6-1'), undefined);
});

test('집계는 기준 문서(PROCESS 등)를 세지 않고, 부서는 주관으로 가른다', () => {
  const tracked = (dept) =>
    QMP_SECTIONS.filter((s) => !dept || s.lead === dept).flatMap((s) => s.forms).filter((f) => !f.reference).length;
  const empty = new Map();
  assert.equal(qmpTally(empty, null).total, tracked(null));
  assert.equal(qmpTally(empty, '공사').total, tracked('공사'));
  assert.equal(qmpTally(empty, '공사').total, 11, '8.1 세 장 + 8.6 여덟 장');
  // PROCESS 흐름도 26장 + 작성방법(4.3-4)·평가기준(6.1-2)
  assert.equal(QMP_SECTIONS.flatMap((s) => s.forms).filter((f) => f.reference).length, 28);
});

test('신호등 하나로 줄이기 — 다 끝나야 초록', () => {
  assert.equal(lampOf({ done: 3, doing: 0, total: 3 }), 'done');
  assert.equal(lampOf({ done: 1, doing: 0, total: 3 }), 'doing');
  assert.equal(lampOf({ done: 0, doing: 1, total: 3 }), 'doing');
  assert.equal(lampOf({ done: 0, doing: 0, total: 3 }), 'none');
  assert.equal(lampOf({ done: 0, doing: 0, total: 0 }), 'none');
});

test('서식 번호는 겹치지 않는다', () => {
  const codes = QMP_SECTIONS.flatMap((s) => s.forms.map((f) => f.code));
  assert.equal(new Set(codes).size, codes.length);
  for (const s of QMP_SECTIONS) for (const f of s.forms) assert.ok(f.code.startsWith(`${s.no}-`), f.code);
});
