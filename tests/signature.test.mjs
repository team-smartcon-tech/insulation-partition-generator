/** 결재 서명 다듬기 — 흰 바탕은 투명하게, 여백은 잘라낸다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { clearPaper, fitSize, inkBounds } from '../apps/web/src/features/profile/signature.ts';

/** width×height 흰 바탕에 (x,y) 목록만 검은 점 */
function image(width, height, dots = []) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y, gray = 0] of dots) {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  return data;
}

test('흰 바탕은 투명, 검은 선은 그대로, 경계의 회색은 반투명', () => {
  const data = image(3, 1, [[0, 0, 0], [1, 0, 200]]);
  clearPaper(data);
  assert.equal(data[3], 255, '검은 점은 그대로');
  assert.ok(data[7] > 0 && data[7] < 255, '옅은 회색은 반투명');
  assert.equal(data[11], 0, '흰 바탕은 투명');
});

test('잉크가 있는 영역만 찾는다 — 없으면 null', () => {
  const data = image(10, 8, [[2, 3], [7, 5], [4, 6]]);
  clearPaper(data);
  assert.deepEqual(inkBounds(data, 10, 8), { x: 2, y: 3, width: 6, height: 4 });

  const blank = image(5, 5);
  clearPaper(blank);
  assert.equal(inkBounds(blank, 5, 5), null);
});

test('큰 서명은 비율을 지켜 줄이고, 작은 서명은 키우지 않는다', () => {
  assert.deepEqual(fitSize(960, 200), { width: 480, height: 100 });
  assert.deepEqual(fitSize(300, 400), { width: 150, height: 200 });
  assert.deepEqual(fitSize(120, 40), { width: 120, height: 40 });
});
