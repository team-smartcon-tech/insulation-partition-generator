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

test('시트에 붙여넣은 그림을 꺼내 온다', async () => {
  const sheets = await loadSample();
  const daejang = sheets.find((sheet) => sheet.name === 'QA-7.3-2');

  // 이 시트 왼쪽 위에는 로고 그림이 하나 있다(xl/media/image1.png).
  assert.equal(daejang.images.length, 1);

  const logo = daejang.images[0];
  assert.match(logo.src, /^data:image\/png;base64,/, '화면에 바로 붙일 수 있는 주소여야 한다');
  // blob URL 은 새로고침하면 죽어 저장해 둘 수 없다. data: URL 이어야 다시 뜬다.
  assert.ok(logo.src.length > 1000, '그림 내용이 실제로 들어 있어야 한다');
});

test('그림은 격자 왼쪽 위 기준의 픽셀 좌표와 크기를 갖는다', async () => {
  const sheets = await loadSample();
  const logo = sheets.find((sheet) => sheet.name === 'QA-7.3-2').images[0];

  for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Number.isFinite(logo[key]), `${key} 는 숫자여야 한다`);
  }
  assert.ok(logo.width > 0 && logo.height > 0, '크기가 0 이면 화면에서 사라진다');
  // 왼쪽 위 첫 칸에 얹힌 로고라 표 안쪽에 있어야 한다.
  assert.ok(logo.left >= 0 && logo.top >= 0);
  const totalWidth = sheets
    .find((sheet) => sheet.name === 'QA-7.3-2')
    .colWidths.reduce((a, b) => a + b, 0);
  assert.ok(logo.left < totalWidth, '그림이 표 오른쪽 밖으로 나가면 안 된다');
});

test('도형으로만 그린 시트는 그림이 없고 글자도 거의 없다', async () => {
  const sheets = await loadSample();
  const process = sheets.find((sheet) => sheet.name === 'QA-7.3.-1');

  // 순서도가 엑셀 도형(shape)으로 그려져 있다. exceljs 는 도형을 내주지 않으므로
  // 여기서는 비어 있는 게 정상이다 — 화면은 이 상태를 보고 안내를 띄운다.
  assert.equal(process.images.length, 0);
  const withText = process.cells.filter((cell) => cell.text.trim() !== '');
  assert.ok(withText.length <= 3, `글자가 든 칸이 ${withText.length}개 — 안내 조건을 넘었다`);
});

test('그림이 없는 양식도 images 를 빈 배열로 갖는다', async () => {
  const buffer = await readFile(
    fileURLToPath(new URL('../apps/worker/samples/단속점검방문일지양식.xlsx', import.meta.url)),
  );
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const [sheet] = await parseFormWorkbook(data);

  // undefined 면 화면에서 .map 이 터진다. 항상 배열이어야 한다.
  assert.deepEqual(sheet.images, []);
});
