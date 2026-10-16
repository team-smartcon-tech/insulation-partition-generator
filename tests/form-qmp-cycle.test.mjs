/** 품질관리계획서 서식의 작성 주기 — 착공일부터 기간마다 썼나를 센다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cycleOf, periodsBetween, sheetDate, periodKeyOf } from '../apps/web/src/features/forms/qmpCycle.ts';
import { qmpStates, qmpTally, sheetCodesOf } from '../apps/web/src/features/forms/qmpPlan.ts';

const day = (y, m, d) => new Date(y, m - 1, d);

test('회사 기본 주기와 현장 설정', () => {
  assert.equal(cycleOf('8.10-4'), 'monthly');
  // 주간·3개월 공정표는 스마트우미 공정 화면에서 쓴다 — 세지 않고 링크만
  assert.equal(cycleOf('8.6-3'), 'external');
  assert.equal(cycleOf('8.6-2'), 'external');
  assert.equal(cycleOf('9.4-2'), 'yearly');
  assert.equal(cycleOf('10.1-2'), 'adhoc');
  assert.equal(cycleOf('5.2-1'), 'once');
  assert.equal(cycleOf('8.10-4', { cycles: { '8.10-4': 'quarterly' } }), 'quarterly');
});

test('기간 나누기 — 착공 기간부터 지금 기간까지', () => {
  const months = periodsBetween('monthly', day(2025, 4, 1), day(2026, 10, 15));
  assert.equal(months.length, 19);
  assert.equal(months[0].key, '2025-04');
  assert.equal(months.at(-1).key, '2026-10');
  assert.deepEqual(periodsBetween('quarterly', day(2025, 4, 1), day(2026, 10, 15)).map((p) => p.key), [
    '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4',
  ]);
  assert.equal(periodsBetween('yearly', day(2025, 4, 1), day(2026, 10, 15)).length, 2);
  // 주는 월요일부터
  assert.equal(periodKeyOf('weekly', day(2026, 10, 15)), '2026-10-12');
  assert.equal(periodsBetween('once', day(2025, 4, 1), day(2026, 10, 15)).length, 0);
});

test('시트 이름에서 달 읽기', () => {
  assert.equal(periodKeyOf('monthly', sheetDate('QA-4.2-2(25.09)')), '2025-09');
  assert.equal(periodKeyOf('monthly', sheetDate('2026-07')), '2026-07');
  assert.equal(periodKeyOf('monthly', sheetDate('2026년 7월')), '2026-07');
  assert.equal(periodKeyOf('weekly', sheetDate('주간 2026-07-15')), '2026-07-13');
  assert.equal(sheetDate('QA-8.10-4'), null);
  assert.equal(sheetDate('견본'), null);
});

test('[시트 추가]로 더한 장은 원본 시트의 서식 번호를 잇는다', () => {
  const codes = sheetCodesOf({ sheetNames: ['QA-8.10-4', '2026-07'], sheetSources: { '2026-07': 'QA-8.10-4' } });
  assert.equal(codes.get('2026-07'), '8.10-4');
  // 견본을 바탕으로 더한 장은 바로 앞 서식 시트의 번호(회사 양식은 서식 뒤에 견본을 둔다)
  const fromSample = sheetCodesOf({
    sheetNames: ['QA-10.1-2', '견본', 'QA-10.1-3', '견본 (2)', '추가1', '추가2'],
    sheetSources: { 추가1: '견본', 추가2: '견본 (2)' },
  });
  assert.equal(fromSample.get('추가1'), '10.1-2');
  assert.equal(fromSample.get('추가2'), '10.1-3');
  assert.equal(fromSample.has('견본'), false, '견본 자체는 서식으로 세지 않는다');
});

test('수시 서식: 견본으로 더한 장마다 건수가 는다', () => {
  const doc = { id: 'd', sheetNames: ['QA-10.1-2', '견본', '1차', '2차'], sheetSources: { '1차': '견본', '2차': '견본' }, workingSheets: ['1차', '2차'] };
  assert.equal(qmpStates([doc], { settings: {} }).get('10.1-2').count, 2);
});

test('월간 서식: 빠진 달을 세고, 지금 달은 아직 안 써도 빠짐이 아니다', () => {
  const doc = {
    id: 'd1',
    sheetNames: ['QA-8.10-4', '2026-08', '2026-09'],
    sheetSources: { '2026-08': 'QA-8.10-4', '2026-09': 'QA-8.10-4' },
    workingSheets: ['QA-8.10-4', '2026-08', '2026-09'],
    uploadedAt: day(2026, 7, 10).getTime(),
  };
  const states = qmpStates([doc], { settings: { startDate: '2026-07-01' }, today: day(2026, 10, 15) });
  const s = states.get('8.10-4');
  assert.equal(s.cycle, 'monthly');
  assert.deepEqual(s.periods.map((p) => p.status), ['done', 'done', 'done', 'none']);
  assert.equal(s.written, 3);
  assert.equal(s.due, 4);
  assert.equal(s.status, 'done', '지난 달이 다 찼으면 초록');

  const gap = qmpStates([{ ...doc, sheetNames: ['QA-8.10-4', '2026-09'], workingSheets: ['QA-8.10-4', '2026-09'] }], {
    settings: { startDate: '2026-07-01' },
    today: day(2026, 10, 15),
  }).get('8.10-4');
  assert.deepEqual(gap.periods.map((p) => p.status), ['done', 'none', 'done', 'none']);
  assert.equal(gap.status, 'doing', '빠진 달이 있으면 노랑');
});

test('수시는 건수, 준공 때는 세지 않고, 적용 제외 절도 세지 않는다', () => {
  const docs = [
    { id: 'a', sheetNames: ['QA-10.1-2', '2'], sheetSources: { 2: 'QA-10.1-2' }, workingSheets: ['QA-10.1-2', '2'] },
  ];
  const states = qmpStates(docs, { settings: { startDate: '2026-01-01', excluded: ['8.3'] }, today: day(2026, 10, 15) });
  assert.equal(states.get('10.1-2').count, 2);
  assert.equal(states.get('8.13-1').notYet, true);
  assert.equal(states.get('8.3-3').excluded, true);
  const all = qmpTally(states, null);
  const plain = qmpTally(qmpStates(docs), null);
  // 8.13 두 장 + 8.3 의 현장 서식(참고 제외) 네 장 + 외부 작성(8.6-2·8.6-3) 두 장이 빠진다
  assert.equal(plain.total - all.total, 8);
});

test('수시 서식: 마지막 기록 뒤 알림 날수를 넘기면 "N일째 기록 없음" — 불 색·%는 그대로', () => {
  const today = day(2026, 10, 15);
  // 발송대장 — 한 장에 줄을 쌓는다. 그 장을 마지막으로 고친 때로 센다(서류 전체 저장 때가 아니라).
  const doc = {
    id: 'l',
    sheetNames: ['QA-7.5-2', 'QA-7.5-3'],
    workingSheets: ['QA-7.5-2', 'QA-7.5-3'],
    sheetEditedAt: { 'QA-7.5-3': day(2026, 9, 1).getTime() },
    updatedAt: day(2026, 10, 14).getTime(),
  };
  const states = qmpStates([doc], { settings: {}, today });
  assert.equal(states.get('7.5-3').quietDays, 44);
  assert.equal(states.get('7.5-3').status, 'done', '알림이 있어도 불은 초록');
  // 고친 때가 없는 장은 서류를 마지막으로 저장한 때로 본다
  assert.equal(states.get('7.5-2').quietDays, undefined);
  // 현장이 알림을 끄거나 늘리면 없다
  assert.equal(qmpStates([doc], { settings: { alertDays: { '7.5-3': 0 } }, today }).get('7.5-3').quietDays, undefined);
  assert.equal(qmpStates([doc], { settings: { alertDays: { '7.5-3': 60 } }, today }).get('7.5-3').quietDays, undefined);
  assert.equal(qmpTally(states, null).done, qmpTally(qmpStates([doc], { settings: { alertDays: { '7.5-3': 0 } }, today }), null).done);
});

test('외부 작성 서식은 세지 않고, 현장 주소가 있으면 링크를 단다', async () => {
  const { externalLinkOf, isWebLink } = await import('../apps/web/src/features/forms/qmpCycle.ts');
  const states = qmpStates([], { settings: { startDate: '2026-01-01' }, today: day(2026, 10, 15) });
  assert.equal(states.get('8.6-3').external, true);
  const withExternal = qmpTally(states, '공사').total;
  const counted = qmpTally(qmpStates([], { settings: { startDate: '2026-01-01', cycles: { '8.6-3': 'weekly', '8.6-2': 'monthly' } }, today: day(2026, 10, 15) }), '공사').total;
  assert.equal(counted - withExternal, 2);
  assert.match(externalLinkOf('8.6-3', undefined, '부산장안(B1)'), /^https:\/\/sw\.smartwoomi\.com\/process\//);
  assert.equal(externalLinkOf('8.6-3', { externalLinks: { '8.6-3': 'https://a.b/c' } }, '부산장안(B1)'), 'https://a.b/c');
  assert.equal(externalLinkOf('8.6-3', undefined, '다른 현장'), undefined);
  assert.equal(isWebLink('sw.smartwoomi.com'), false);
});
