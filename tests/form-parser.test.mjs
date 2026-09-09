import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const SAMPLE = fileURLToPath(
  new URL('../apps/worker/samples/단속점검방문일지양식.xlsx', import.meta.url),
);

async function loadSample() {
  const buffer = await readFile(SAMPLE);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const sheets = await parseFormWorkbook(data);
  return sheets[0];
}

const cellAt = (sheet, row, col) => sheet.cells.find((c) => c.row === row && c.col === col);

test('시트 범위는 실제 내용이 있는 곳까지만 잡는다', async () => {
  const sheet = await loadSample();

  assert.equal(sheet.name, '화성비봉');
  assert.equal(sheet.rowCount, 22);
  // H열(8열)에 서식만 남은 빈 껍데기 칸이 있지만 범위를 넓히지 않는다.
  assert.equal(sheet.colCount, 7);
});

test('가로 병합은 colSpan 으로, 세로 병합은 rowSpan 으로 옮겨진다', async () => {
  const sheet = await loadSample();

  // A2:G2 — 제목 줄이 7칸을 가로로 덮는다.
  const title = cellAt(sheet, 2, 1);
  assert.equal(title.colSpan, 7);
  assert.equal(title.rowSpan, 1);
  assert.equal(title.text, '단속∙점검 방문일지');

  // A3:A10 — "① 공사현황" 이 8줄을 세로로 덮는다.
  const section = cellAt(sheet, 3, 1);
  assert.equal(section.rowSpan, 8);
  assert.equal(section.colSpan, 1);
  assert.equal(section.text.trim(), '① 공사현황');

  // A21:G22 — 가로·세로가 함께 걸린 병합.
  const footnote = cellAt(sheet, 21, 1);
  assert.equal(footnote.rowSpan, 2);
  assert.equal(footnote.colSpan, 7);
});

test('병합에 가려진 칸은 표에 다시 나오지 않는다', async () => {
  const sheet = await loadSample();

  // 제목 A2:G2 에 먹힌 B2~G2, 세로 병합 A3:A10 에 먹힌 A4~A10.
  for (const col of [2, 3, 4, 5, 6, 7]) {
    assert.equal(cellAt(sheet, 2, col), undefined, `2행 ${col}열은 병합에 가려져야 한다`);
  }
  for (const row of [4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(cellAt(sheet, row, 1), undefined, `${row}행 1열은 병합에 가려져야 한다`);
  }

  // 가려진 칸을 뺐어도 각 행의 colSpan 합은 전체 열 수와 같아야 표가 어긋나지 않는다.
  for (let row = 1; row <= sheet.rowCount; row++) {
    const spanned = sheet.cells
      .filter((c) => c.row <= row && c.row + c.rowSpan - 1 >= row)
      .reduce((sum, c) => sum + c.colSpan, 0);
    assert.equal(spanned, sheet.colCount, `${row}행의 칸 합이 열 수와 다르다`);
  }
});

test('셀 글자는 원본 그대로 담는다', async () => {
  const sheet = await loadSample();

  assert.equal(cellAt(sheet, 3, 3).text, '부산 장안지구 B1BL 우미린 공동주택 신축공사');
  assert.equal(cellAt(sheet, 3, 2).text, '공 사 명');

  // ③ 방문근거 / ④ 업무 수행내용 / ⑤ 지시사항 — 원본이 비어 있는 세 칸.
  for (const row of [12, 13, 14]) {
    assert.equal(cellAt(sheet, row, 2).text.trim(), '', `${row}행 값칸은 원본이 비어 있다`);
  }
});

test('행·열 크기와 글꼴·정렬·테두리를 함께 가져온다', async () => {
  const sheet = await loadSample();

  assert.equal(sheet.colWidths.length, 7);
  assert.equal(sheet.rowHeights.length, 22);
  assert.ok(sheet.colWidths.every((w) => Number.isFinite(w) && w > 0));

  // 15행(방문자)은 3명이 들어가도록 원본에서 150pt 로 높다 → 다른 행보다 확실히 크다.
  assert.ok(sheet.rowHeights[14] > sheet.rowHeights[2] * 3);

  const title = cellAt(sheet, 2, 1);
  assert.equal(title.style.bold, true);
  assert.equal(title.style.fontSize, 20);
  assert.equal(title.style.align, 'center');

  const label = cellAt(sheet, 3, 2);
  assert.equal(label.style.fontFamily, '바탕');
  assert.equal(label.style.wrap, true);
  assert.equal(label.style.borders.left.style, 'thin');
  assert.equal(label.style.borders.bottom.style, 'thin');
});

test('병합된 칸의 바깥 테두리는 모서리 칸에서 읽는다', async () => {
  const sheet = await loadSample();

  // B11:G11 병합. 오른쪽 선은 대표 칸 B11 이 아니라 맨 오른쪽 G11 에 들어 있다.
  // 대표 칸만 보면 병합 줄의 오른쪽 테두리가 통째로 사라진다.
  const visitPeriod = cellAt(sheet, 11, 2);
  assert.equal(visitPeriod.colSpan, 6);
  assert.equal(visitPeriod.style.borders.right.style, 'thin', '병합 줄의 오른쪽 테두리가 있어야 한다');
  assert.equal(visitPeriod.style.borders.left.style, 'thin');
  assert.equal(visitPeriod.style.borders.top.style, 'thin');

  // A3:A10 세로 병합 — 아래쪽 선은 맨 아래 A10 에 있다.
  const section = cellAt(sheet, 3, 1);
  assert.equal(section.rowSpan, 8);
  assert.equal(section.style.borders.bottom.style, 'thin', '세로 병합의 아래 테두리가 있어야 한다');
});

test('줄바꿈이 든 셀 값은 그대로 보존한다', async () => {
  const sheet = await loadSample();

  // A12 " ③ 방문근거\n     및 목적" — 엑셀 안의 줄바꿈이 화면에서도 유지되어야 한다.
  assert.ok(cellAt(sheet, 12, 1).text.includes('\n'));
});
