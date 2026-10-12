import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

// "리스크 및 기회관리 PROCESS" — 마름모(판단)·Yes/No 라벨·되돌아가는 화살표가 있는 순서도.
const SAMPLE = fileURLToPath(
  new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url),
);

let cached;
async function processSheet() {
  if (!cached) {
    const buffer = await readFile(SAMPLE);
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const sheets = await parseFormWorkbook(data);
    cached = sheets.find((sheet) => sheet.name === 'QA-6.1-1');
  }
  return cached;
}

test('테두리를 "없음"으로 둔 글자 상자에는 테두리를 그리지 않는다', async () => {
  const sheet = await processSheet();

  // Yes/No 라벨은 원본에서 <a:ln><a:noFill/> — 테두리 없음을 명시했다.
  // 못 읽고 기본 검정을 넣으면 라벨마다 네모가 생긴다.
  const labels = sheet.shapes.filter((shape) => shape.text === 'Yes' || shape.text === 'No');
  assert.equal(labels.length, 4);
  for (const label of labels) {
    assert.equal(label.line, undefined, `${label.text} 라벨에 테두리가 생겼다`);
  }

  // 테두리를 명시한 순서도 상자는 그대로 테두리가 있다.
  assert.notEqual(sheet.shapes.find((shape) => shape.text === '리스크 파악').line, undefined);
});

test('보이지 않는 공백만 든 마름모에 위에 얹은 글자 상자가 합쳐진다', async () => {
  const sheet = await processSheet();

  // 원본 마름모의 글자는 줄바꿈 없는 공백( ) 한 칸이다. 이걸 "글자가 있다"로 보면
  // 합치기 규칙이 건너뛰어 마름모 위에 네모가 겹쳐 그려진다.
  const diamonds = sheet.shapes.filter((shape) => shape.kind === 'diamond');
  assert.deepEqual(
    diamonds.map((diamond) => diamond.text).sort(),
    ['리스크 검토', '리스크 평가'],
  );
  const overlaid = sheet.shapes.filter(
    (shape) => shape.kind === 'box' && (shape.text === '리스크 평가' || shape.text === '리스크 검토'),
  );
  assert.equal(overlaid.length, 0, '마름모 위에 글자 상자가 따로 남았다');
});

test('90도 돌려 저장된 선은 두 번 돌리지 않는다', async () => {
  const sheet = await processSheet();

  // 원본 가로선 하나가 "세로 틀 + 90도 회전"으로 저장돼 있고, 앵커에는 돌린 뒤 모습(가로 칸)이
  // 적혀 있다. 앵커 칸에 회전을 또 걸면 가로선이 엉뚱한 세로선이 된다.
  const rotated = sheet.shapes.filter(
    (shape) =>
      shape.kind === 'line' &&
      shape.rotation !== undefined &&
      Math.abs(Math.abs(shape.rotation) - 90) < 1,
  );
  assert.ok(rotated.length >= 1, '90도 돌린 선을 찾지 못했다');
  for (const line of rotated) {
    // 저장하는 틀은 "돌리기 전" 모습(세로) — 그리는 쪽이 90도를 한 번 걸어 가로선이 된다.
    assert.ok(line.width < 1 && line.height > 10, `틀이 ${line.width}×${line.height}`);
  }
});

test('되돌아가는 꺾인 연결선의 꺾는 자리를 읽는다', async () => {
  const sheet = await processSheet();

  // "리스크 검토 → No → 리스크 등록"으로 되돌아가는 선. adj1 = -34458813 → 틀 너비의 -344.6배라
  // 상자 밖으로 크게 돌아 나간다. 직선으로 그리면 상자 가장자리에 달라붙는다.
  const elbows = sheet.shapes.filter((shape) => shape.elbow !== undefined);
  assert.equal(elbows.length, 1);
  assert.ok(elbows[0].elbow < -300, `꺾는 자리 ${elbows[0].elbow}`);
  assert.equal(elbows[0].flipH, true);
});

test('직선 연결선에는 꺾는 자리가 붙지 않는다', async () => {
  const sheet = await processSheet();

  // 꺾기 값이 잘못 붙으면 곧은 화살표가 전부 계단 모양이 된다.
  const straight = sheet.shapes.filter((shape) => shape.kind === 'line' && shape.elbow === undefined);
  assert.ok(straight.length >= 5);
});
