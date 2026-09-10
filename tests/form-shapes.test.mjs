import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const SAMPLE = fileURLToPath(
  new URL('../apps/worker/samples/103. 조직의 지식관리.xlsx', import.meta.url),
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

const processSheet = async () => (await loadSample()).find((s) => s.name === 'QA-7.3.-1');
const textOf = (shapes) => shapes.map((s) => s.text).filter(Boolean);

test('도형으로 그린 순서도를 상자와 연결선으로 읽어 온다', async () => {
  const sheet = await processSheet();

  // 원본은 도형 8개 + 연결선 6개. 그중 장식용 테두리 한 쌍이 하나로 합쳐져 13개다.
  assert.equal(sheet.shapes.length, 13);
  assert.equal(sheet.shapes.filter((s) => s.kind === 'line').length, 6);
});

test('장식용 테두리 안의 글자 상자는 하나로 합친다', async () => {
  const sheet = await processSheet();

  // 원본에는 "문서" 기호(글자 없음) 안에 둥근 사각형(글자 있음)이 겹쳐 있다.
  // 그대로 옮기면 네모 안에 네모가 되어 지저분하다 — 바깥 윤곽선 + 안쪽 글자로 합친다.
  const documents = sheet.shapes.filter((s) => s.kind === 'document');
  assert.equal(documents.length, 1);
  assert.equal(documents[0].text, '현장 지식관리대장 작성');

  // 안쪽 둥근 사각형은 사라져야 한다.
  assert.equal(sheet.shapes.filter((s) => s.kind === 'roundBox').length, 0);
  // 글자가 두 번 나오면 합치기가 아니라 겹쳐 그린 것이다.
  const sameText = sheet.shapes.filter((s) => s.text === '현장 지식관리대장 작성');
  assert.equal(sameText.length, 1);
});

test('나란히 놓인 상자들은 합쳐지지 않는다', async () => {
  const sheet = await processSheet();

  // 본줄의 상자 6개는 서로 포함 관계가 아니므로 그대로 남아야 한다.
  // 합치기 규칙이 과하게 작동하면 여기서 개수가 줄어든다.
  assert.equal(sheet.shapes.filter((s) => s.kind === 'box' && s.text).length, 6);
});

test('순서도의 글자를 순서대로 다 가져온다', async () => {
  const sheet = await processSheet();
  const labels = textOf(sheet.shapes);

  for (const expected of [
    '필요 지식의 파악',
    '지식/정보 입수',
    '지식별 담당 지정 운영',
    '지식 유지 및 관리',
    '지식의 모니터링',
    '문서화된 정보로 유지',
    '현장 지식관리대장 작성',
  ]) {
    assert.ok(labels.includes(expected), `"${expected}" 이 빠졌다`);
  }
});

test('상자들은 같은 세로줄에 정렬되고 위에서 아래로 흐른다', async () => {
  const sheet = await processSheet();
  const column = sheet.shapes
    .filter((s) => s.kind === 'box' && s.text)
    .sort((a, b) => a.top - b.top);

  // 순서도의 본줄 — 왼쪽 좌표가 거의 같아야 한 줄로 보인다.
  // 원본이 손으로 그려져 1px 안쪽으로 어긋나 있다(170.x 와 171.x). 그건 원본 그대로가
  // 맞으므로 눈에 띄는 어긋남(2px 초과)만 잡는다.
  const lefts = column.map((s) => s.left);
  const spread = Math.max(...lefts) - Math.min(...lefts);
  assert.ok(spread <= 2, `상자들의 왼쪽 좌표가 ${spread.toFixed(1)}px 흩어졌다`);

  assert.equal(column[0].text, '필요 지식의 파악');
  assert.equal(column.at(-1).text, '문서화된 정보로 유지');
});

test('연결선은 화살촉과 색을 갖고, 두께가 0 이 아니다', async () => {
  const sheet = await processSheet();
  const lines = sheet.shapes.filter((s) => s.kind === 'line');

  for (const line of lines) {
    assert.equal(line.arrowEnd, true, '순서도 연결선에는 화살촉이 있다');
    assert.match(line.line, /^#[0-9a-f]{6}$/, '선 색이 있어야 한다');
    assert.ok(line.lineWidth > 0, '두께가 0 이면 화면에서 사라진다');
  }

  // 세로 연결선은 너비가 사실상 0 이다. 너비로만 걸러내면 통째로 사라진다.
  const vertical = lines.filter((line) => line.width < 1);
  assert.ok(vertical.length >= 5, '세로 연결선이 걸러져 사라졌다');
});

test('테마색 보정(lumMod/lumOff)을 반영해 회색 화살표를 검정으로 만들지 않는다', async () => {
  const sheet = await processSheet();
  const line = sheet.shapes.find((s) => s.kind === 'line');

  // "검정, 텍스트 1, 25% 더 밝게" → 진회색. 보정을 무시하면 #000000 이 된다.
  assert.notEqual(line.line, '#000000');
  assert.equal(line.line, '#404040');
});

test('도형이 없는 시트는 shapes 를 빈 배열로 갖는다', async () => {
  const sheets = await loadSample();
  const daejang = sheets.find((s) => s.name === 'QA-7.3-2');

  // undefined 면 화면에서 .map 이 터진다.
  assert.deepEqual(daejang.shapes, []);
  // 이 시트에 있는 건 도형이 아니라 그림(로고)이다 — 둘을 섞어 담으면 두 번 그려진다.
  assert.equal(daejang.images.length, 1);
});

test('그림은 도형 목록에 섞여 들어가지 않는다', async () => {
  const sheets = await loadSample();
  const sample = sheets.find((s) => s.name === '견본');

  // 견본 시트에는 그림 1개와 도형 1개("Sample")가 함께 있다.
  assert.equal(sample.images.length, 1);
  assert.equal(sample.shapes.length, 1);
  assert.equal(sample.shapes[0].text, 'Sample');
});

test('인쇄 영역 밖은 옮기지 않는다', async () => {
  const sheets = await loadSample();
  const daejang = sheets.find((s) => s.name === 'QA-7.3-2');

  // 원본 내용은 49행 × 21열까지 뻗어 있지만, 인쇄 영역은 A1:N29 다.
  // 밖에는 메모용 도형 4개와 번호만 남은 껍데기 줄 20개가 있어 그대로 옮기면 지저분하다.
  assert.equal(daejang.rowCount, 29);
  assert.equal(daejang.colCount, 14);
  assert.equal(daejang.printArea, 'A1:N29', '잘라냈다는 사실을 화면에 알려야 한다');

  // 인쇄 영역 밖에 있던 도형은 따라오지 않는다.
  assert.equal(daejang.shapes.length, 0);
  // 안쪽에 있는 로고는 그대로 남는다.
  assert.equal(daejang.images.length, 1);

  // 잘라낸 뒤에도 각 행의 칸 합이 열 수와 같아야 표가 어긋나지 않는다.
  for (let row = 1; row <= daejang.rowCount; row++) {
    const spanned = daejang.cells
      .filter((c) => c.row <= row && c.row + c.rowSpan - 1 >= row)
      .reduce((sum, c) => sum + c.colSpan, 0);
    assert.equal(spanned, daejang.colCount, `${row}행의 칸 합이 열 수와 다르다`);
  }
});

test('인쇄 영역이 내용보다 넓으면 알리지 않는다', async () => {
  const sheets = await loadSample();

  // QA-7.3.-1 은 인쇄 영역(A1:L46)이 내용 범위와 같아 잘린 것이 없다.
  // 잘리지 않았는데 "인쇄 영역까지만 표시"라고 하면 사용자를 헷갈리게 한다.
  assert.equal(sheets.find((s) => s.name === 'QA-7.3.-1').printArea, undefined);
});
