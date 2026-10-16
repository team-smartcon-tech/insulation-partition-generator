/** 계획서 서류 현황 — 서식 번호 읽기와 신호등 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QMP_SECTIONS,
  lampOf,
  qaCodeOf,
  qmpStates,
  qmpTally,
  sectionOfCode,
  sheetCodesOf,
  hasQmpSheet,
  templateForCode,
  writersOf,
  writesSection,
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

test('집계는 기준 문서(PROCESS 등)를 세지 않고, 부서는 주관·협조 모두 그 부서 몫으로 센다', () => {
  const tracked = (dept) =>
    QMP_SECTIONS.filter((s) => !dept || s.lead === dept || s.help.includes(dept))
      .flatMap((s) => s.forms)
      .filter((f) => !f.reference).length;
  const empty = new Map();
  assert.equal(qmpTally(empty, null).total, tracked(null));
  assert.equal(qmpTally(empty, '공사').total, tracked('공사'));
  // 공사가 주관인 8.1·8.6 열한 장에 협조 절(4.3 프로세스 관리 등)이 더해진다
  assert.ok(qmpTally(empty, '공사').total > 11);
  const s43 = QMP_SECTIONS.find((s) => s.no === '4.3');
  assert.ok(writesSection(s43, '공사') && writesSection(s43, '품질'));
  assert.equal(writesSection(QMP_SECTIONS.find((s) => s.no === '4.2'), '공사'), false);
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

test('배포 양식함 — 서식마다 그 시트가 든 가장 최근 양식, 기준 문서도 센다', async () => {
  const { qmpLibraryStates, hasQmpSheet } = await import('../apps/web/src/features/forms/qmpPlan.ts');
  const states = qmpLibraryStates([
    { id: 'old', sheetNames: ['QA-7.2-1', 'QA-7.2-2'], uploadedAt: 1 },
    { id: 'new', sheetNames: ['QA-7.2-2', '중복'], uploadedAt: 2 },
  ]);
  assert.equal(states.get('7.2-1').docId, 'old');
  assert.equal(states.get('7.2-2').docId, 'new');
  assert.equal(states.get('7.2-3'), undefined);
  // 7.2 는 서식 3장(PROCESS 포함) 중 2장이 올라왔다
  assert.deepEqual(qmpTally(states, null, '7', true).done, 2);
  assert.equal(qmpTally(states, null, '7', false).done, 1, '현장 기준으로는 PROCESS 를 빼고 센다');
  assert.equal(hasQmpSheet({ sheetNames: ['작업일보'] }), false);
  assert.equal(hasQmpSheet({ sheetNames: ['표지', 'QA-8.6-1'] }), true);
});

test('[전체 가져오기] — 빠진 서식이 든 양식만, 이미 만든 양식·기준 문서만 든 양식은 빼고, 계획서 순서로', async () => {
  const { templatesToImport } = await import('../apps/web/src/features/forms/qmpPlan.ts');
  const templates = [
    { id: 't86', sheetNames: ['QA-8.6-1', 'QA-8.6-2'], uploadedAt: 1 },
    { id: 't42', sheetNames: ['QA-4.2-1', 'QA-4.2-2'], uploadedAt: 1 },
    { id: 't52', sheetNames: ['QA-5.2-1', 'QA-5.2-2'], uploadedAt: 1 },
    { id: 'tproc', sheetNames: ['QA-9.3-1'], uploadedAt: 1 },
    { id: 't72', sheetNames: ['QA-7.2-2'], uploadedAt: 1 },
  ];
  const siteDocs = [
    { sheetNames: ['QA-5.2-1', 'QA-5.2-2'], templateId: 'other' },
    { sheetNames: ['작업일보'], templateId: 't72' },
  ];
  assert.deepEqual(templatesToImport(templates, siteDocs), ['t42', 't86']);
});

test('작성 부서 — 장마다 단 부서가 서식 상태에 실린다, 같은 진척이면 부서를 정한 장을 고른다', () => {
  const states = qmpStates([
    { id: 'a', sheetNames: ['QA-4.3-2', 'QA-4.3-3'], workingSheets: ['QA-4.3-2'], sheetDepts: { 'QA-4.3-2': '공사' } },
    // 4.3-3: 앞 서류는 부서 없음, 뒤 서류는 부서만 정하고 아직 안 씀 — 둘 다 빈 불이면 부서 있는 쪽
    { id: 'b', sheetNames: ['QA-4.3-3'], sheetDepts: { 'QA-4.3-3': '품질' } },
    // 엉뚱한 값은 버린다
    { id: 'c', sheetNames: ['QA-4.3-5'], sheetDepts: { 'QA-4.3-5': '환경' } },
  ]);
  assert.equal(states.get('4.3-2').dept, '공사');
  assert.equal(states.get('4.3-2').status, 'done');
  assert.deepEqual([states.get('4.3-3').docId, states.get('4.3-3').dept], ['b', '품질']);
  assert.equal(states.get('4.3-5').dept, undefined);
});

test('작성 부서 고르기 — 그 절의 작성 부서만, 주관이 맨 앞', () => {
  assert.deepEqual(writersOf(sectionOfCode('4.3-3')), ['품질', '공무', '공사']);
  assert.deepEqual(writersOf(sectionOfCode('4.2-2')), ['공무']);
  assert.equal(sectionOfCode('99.9-9'), undefined);
});

test('시트에 QA 번호가 없으면 서류 이름의 절 번호로 — 9.4 경영검토', () => {
  const doc = { title: '9.4 경영검토', fileName: '9.4 경영검토.xlsx', sheetNames: ['경영검토 프로세스', '표지', '1.현장방침', '견본'] };
  const codes = sheetCodesOf(doc);
  assert.equal(codes.get('경영검토 프로세스'), '9.4-1');
  assert.equal(codes.get('표지'), '9.4-2');
  assert.equal(codes.get('1.현장방침'), '9.4-2');
  assert.equal(hasQmpSheet(doc), true);
  assert.equal(qmpStates([{ id: 'x', ...doc, workingSheets: ['표지'] }]).get('9.4-2').status, 'done');
  // 시트에 번호가 하나라도 있으면 그것만 본다
  assert.deepEqual([...sheetCodesOf({ title: '9.4 경영검토', sheetNames: ['QA-9.4-2', '표지'] })], [['QA-9.4-2', '9.4-2']]);
  // 쓰는 서식이 여럿인 절은 어느 것인지 몰라 두지 않는다
  assert.equal(sheetCodesOf({ title: '9.3 내부심사', sheetNames: ['계획서', '점검표'] }).size, 0);
  // 절 번호가 없는 이름
  assert.equal(sheetCodesOf({ title: '회의록', sheetNames: ['Sheet1'] }).size, 0);
});

test('서식 번호에 딸린 시트만 — 서식 시트, 바로 뒤 견본, 더한 장', async () => {
  const { sheetsOfCode } = await import('../apps/web/src/features/forms/qmpPlan.ts');
  const doc = {
    sheetNames: ['QA-10.1-1', 'QA-10.1-2', '견본', 'QA-10.1-3', 'QA-10.1-4', '견본 (2)', 'Sheet1', '2026-07'],
    sheetSources: { '2026-07': '견본 (2)' },
  };
  assert.deepEqual(sheetsOfCode(doc, '10.1-2'), ['QA-10.1-2', '견본']);
  assert.deepEqual(sheetsOfCode(doc, '10.1-4'), ['QA-10.1-4', '견본 (2)', '2026-07']);
  assert.deepEqual(sheetsOfCode(doc, '10.1-3'), ['QA-10.1-3']);
  assert.deepEqual(sheetsOfCode(doc, '9.9-9'), []);
  assert.deepEqual(sheetsOfCode({ sheetNames: ['QA-7.5-4', 'QA-7.5-4(양식)'] }, '7.5-4'), ['QA-7.5-4', 'QA-7.5-4(양식)']);
  // 참고 시트는 바로 앞 서식과 함께, 어느 서식에도 안 딸린 빈 시트는 빠진다
  const docs76 = { sheetNames: ['QA-7.6-4', 'QA-7.6-5', '문서보안기준안(참고)'] };
  assert.deepEqual(sheetsOfCode(docs76, '7.6-5'), ['QA-7.6-5', '문서보안기준안(참고)']);
  assert.deepEqual(sheetsOfCode({ sheetNames: ['QA-6.2-3', '견본 (2)', 'Sheet1'] }, '6.2-3'), ['QA-6.2-3', '견본 (2)']);
});
