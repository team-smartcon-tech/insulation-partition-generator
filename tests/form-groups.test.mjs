import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const SAMPLE = fileURLToPath(
  new URL('../apps/worker/samples/101. 이해관계자니즈와기대2.xlsx', import.meta.url),
);

let cached;
async function loadSample() {
  if (!cached) {
    const buffer = await readFile(SAMPLE);
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    cached = await parseFormWorkbook(data);
  }
  return cached;
}

test('그룹으로 묶인 도형도 풀어서 읽는다', async () => {
  const sheet = (await loadSample()).find((s) => s.name === 'QA-4.2-1');

  // 순서도 첫 상자는 도형 두 개(문서 기호 + 글자 상자)가 그룹으로 묶여 있다.
  // 그룹을 건너뛰면 글자 없는 빈 네모가 되고, 순서도의 시작이 사라진다.
  const first = sheet.shapes.find((s) => s.kind === 'document');
  assert.ok(first, '그룹 안의 문서 기호를 찾지 못했다');
  assert.equal(first.text, '이해관계자 식별 및\n요구사항 파악');
});

test('그룹 안 도형은 그룹이 차지한 자리 안에 놓인다', async () => {
  const sheet = (await loadSample()).find((s) => s.name === 'QA-4.2-1');
  const first = sheet.shapes.find((s) => s.kind === 'document');
  const column = sheet.shapes.filter((s) => s.kind === 'box' && s.text);

  // 그룹 좌표계(chOff/chExt)를 화면 자리로 옮기지 않으면 좌표가 엉뚱한 곳으로 튄다.
  // 순서도 본줄과 같은 세로줄에, 다른 상자들보다 위에 있어야 한다.
  const lefts = column.map((s) => s.left);
  assert.ok(
    Math.abs(first.left - Math.min(...lefts)) <= 3,
    `그룹 도형이 본줄에서 ${Math.abs(first.left - Math.min(...lefts)).toFixed(1)}px 벗어났다`,
  );
  assert.ok(first.top < Math.min(...column.map((s) => s.top)), '순서도의 첫 상자여야 한다');
  assert.ok(first.width > 100 && first.height > 30, `크기가 이상하다: ${first.width}x${first.height}`);
});

test('시트가 여러 개인 통합문서를 전부 읽는다', async () => {
  const sheets = await loadSample();

  assert.equal(sheets.length, 6);
  for (const sheet of sheets) {
    assert.ok(sheet.rowCount > 0 && sheet.colCount > 0, `${sheet.name} 이 비었다`);
    assert.ok(Array.isArray(sheet.images) && Array.isArray(sheet.shapes));
  }
});

test('브라우저가 못 여는 그림(EMF/WMF)은 넣지 않는다', async () => {
  const sheets = await loadSample();

  // 이 통합문서에는 EMF 가 4개 들어 있다(윈도우 전용 형식). 넣으면 깨진 그림이 되고
  // alt 가 비어 있어 화면에서는 아무것도 없는 것처럼 보인다 — 원인 찾기가 어려워진다.
  for (const sheet of sheets) {
    for (const image of sheet.images) {
      assert.doesNotMatch(image.src, /^data:image\/(emf|wmf)/, `${sheet.name} 에 EMF 가 들어갔다`);
    }
  }
});
