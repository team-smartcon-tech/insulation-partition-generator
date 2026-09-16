/** 현장(프로젝트)별로 서류를 나누는 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addSite, formsOfSite, renameSite, siteIdOf, summarizeSites } from '../apps/web/src/features/forms/sites.ts';

let counter = 0;
const makeId = () => `s${++counter}`;

test('현장을 만들고 이름을 바꾼다 — 같은 이름은 두 번 만들지 않는다', () => {
  counter = 0;
  const one = addSite([], '부산장안(B1)', makeId);
  assert.deepEqual(one.map((s) => s.name), ['부산장안(B1)']);

  const two = addSite(one, '광주선운', makeId);
  assert.deepEqual(two.map((s) => s.name), ['부산장안(B1)', '광주선운']);

  // 같은 이름·빈 이름은 그대로 둔다(어느 쪽에 올렸는지 알 수 없어진다).
  assert.equal(addSite(two, '광주선운', makeId), two);
  assert.equal(addSite(two, '   ', makeId), two);

  const renamed = renameSite(two, two[1].id, '광주선운(C2)');
  assert.deepEqual(renamed.map((s) => s.name), ['부산장안(B1)', '광주선운(C2)']);
  assert.equal(renameSite(renamed, renamed[1].id, '부산장안(B1)'), renamed, '겹치는 이름으로는 못 바꾼다');
});

test('현장 표시가 없는 옛 서류는 첫 현장 것으로 본다', () => {
  counter = 0;
  const sites = addSite(addSite([], '부산장안', makeId), '광주선운', makeId);

  assert.equal(siteIdOf({}, sites), sites[0].id, '표시가 없으면 첫 현장');
  assert.equal(siteIdOf({ siteId: sites[1].id }, sites), sites[1].id);
  assert.equal(siteIdOf({ siteId: '지워진현장' }, sites), undefined);
});

test('목록은 보고 있는 현장 것만 보여 준다', () => {
  counter = 0;
  const sites = addSite(addSite([], '부산장안', makeId), '광주선운', makeId);
  const forms = [
    { id: 'a' }, // 옛 서류(표시 없음) → 첫 현장
    { id: 'b', siteId: sites[0].id },
    { id: 'c', siteId: sites[1].id },
    { id: 'd', siteId: '지워진현장' },
  ];

  assert.deepEqual(formsOfSite(forms, sites, sites[0].id).map((f) => f.id), ['a', 'b']);
  assert.deepEqual(formsOfSite(forms, sites, sites[1].id).map((f) => f.id), ['c']);
  assert.deepEqual(formsOfSite(forms, sites, undefined).map((f) => f.id), ['a', 'b', 'c', 'd'], '현장을 안 고르면 전부');
});

test('전 현장 보기 — 현장마다 채운 칸 수와 마지막 수정 시각을 센다', () => {
  counter = 0;
  const sites = addSite(addSite([], '부산장안', makeId), '광주선운', makeId);
  const forms = [
    // 같은 칸에 두 장(월별) → 한 칸으로 센다
    { siteId: sites[0].id, code: '101', taxonomyId: 'g', updatedAt: 10 },
    { siteId: sites[0].id, code: '101', taxonomyId: 'g', updatedAt: 30 },
    { siteId: sites[0].id, code: '102', taxonomyId: 'g', updatedAt: 20 },
    // 코드 없는 서류는 따로
    { siteId: sites[0].id, updatedAt: 5 },
    // 현장 표시가 없는 옛 서류 → 첫 현장
    { code: '103', taxonomyId: 'g', updatedAt: 40 },
    { siteId: sites[1].id, code: '101', taxonomyId: 'g', updatedAt: 7 },
  ];

  const [busan, gwangju] = summarizeSites(sites, forms, 87);
  assert.deepEqual(
    { filled: busan.filled, unfiled: busan.unfiled, total: busan.total, updatedAt: busan.updatedAt },
    { filled: 3, unfiled: 1, total: 87, updatedAt: 40 },
  );
  assert.deepEqual(
    { filled: gwangju.filled, unfiled: gwangju.unfiled, updatedAt: gwangju.updatedAt },
    { filled: 1, unfiled: 0, updatedAt: 7 },
  );
});
