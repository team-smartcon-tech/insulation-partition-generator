/** 복합기 인쇄 — 엑셀의 용지 설정을 그대로 따른다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import {
  excelScale,
  isEmptyHeaderFooter,
  marginsMm,
  pageRule,
  paperLabel,
  paperName,
  parseHeaderFooter,
  printableSizePx,
} from '../apps/web/src/features/forms/printSheet.ts';

test('실제 양식에서 용지 설정을 읽는다 — A4 가로', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const sheet = sheets.find((s) => s.name === 'QA-6.1-3');
  assert.equal(sheet.page.orientation, 'landscape');
  assert.equal(paperName(sheet.page.paperSize), 'A4');
  assert.equal(paperLabel(sheet.page), 'A4 가로');
  assert.match(pageRule(sheet.page), /size: A4 landscape;/);
});

test('용지 번호 → 이름, 모르는 번호는 A4', () => {
  assert.equal(paperName(9), 'A4');
  assert.equal(paperName(8), 'A3');
  assert.equal(paperName(1), 'letter');
  assert.equal(paperName(undefined), 'A4');
  assert.equal(paperName(999), 'A4');
});

test('여백은 엑셀 값(인치)을 mm 로, 없으면 기본 10mm', () => {
  assert.deepEqual(marginsMm(undefined), { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(marginsMm({ margins: { top: 0.5, right: 0.25, bottom: 0.5, left: 0.25 } }), {
    top: 12.7, right: 6.4, bottom: 12.7, left: 6.4,
  });
});

test('배율은 엑셀 [페이지 설정]을 그대로 따른다', () => {
  const a4가로 = { orientation: 'landscape', paperSize: 9 };
  const { width, height } = printableSizePx(a4가로);
  assert.ok(width > 1000 && width < 1100, `인쇄 폭 ${width}px`);
  assert.ok(height > 650 && height < 750, `인쇄 높이 ${height}px`);

  // ① 고정 배율(엑셀에 75%·91% 처럼 적혀 있는 양식) — 넘치든 말든 적힌 대로 쓴다
  assert.equal(excelScale({ ...a4가로, scale: 75 }, { width: 2000, height: 2000 }), 0.75);
  assert.equal(excelScale({ ...a4가로, scale: 91 }, { width: 10, height: 10 }), 0.91);
  assert.equal(excelScale(a4가로, { width: 5000, height: 5000 }), 1, '배율이 없으면 100%');

  // ② 페이지에 맞추기 — 가로 1장, 세로 제한 없음(현장 양식에서 가장 흔하다)
  const 맞춤 = { ...a4가로, fitToPage: true, fitToWidth: 1, fitToHeight: 0, scale: 83 };
  assert.ok(Math.abs(excelScale(맞춤, { width: width * 2, height: height }) - 0.5) < 0.001, '폭만 맞춘다');
  assert.equal(excelScale(맞춤, { width, height: height * 5 }), 1, '세로는 맞추지 않으므로 줄이지 않는다 — 여러 장으로 나간다');
  assert.equal(excelScale(맞춤, { width: 10, height: 10 }), 1, '작은 표를 키우지는 않는다(엑셀과 같다)');

  // ③ 가로·세로 모두 한 장 — 둘 중 더 많이 줄여야 하는 쪽을 따른다
  const 한장 = { ...a4가로, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  assert.ok(Math.abs(excelScale(한장, { width, height: height * 1.25 }) - 0.8) < 0.01);
  assert.ok(Math.abs(excelScale(한장, { width: width * 4, height }) - 0.25) < 0.001);

  // 맞춤이 켜져 있으면 적힌 고정 배율은 쓰지 않는다(엑셀이 그렇게 동작한다)
  assert.notEqual(excelScale(맞춤, { width: width * 2, height }), 0.83);
});

test('실제 양식에서 배율 설정을 읽는다 — 고정 75%, 맞춤은 가로 1장', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const 고정 = sheets.find((s) => s.name === 'QA-6.1-3');
  assert.equal(고정.page.fitToPage, false);
  assert.equal(고정.page.scale, 75);
  assert.equal(excelScale(고정.page, { width: 9999, height: 9999 }), 0.75);

  const 맞춤 = sheets.find((s) => s.name === 'QA-6.1-1');
  assert.equal(맞춤.page.fitToPage, true);
  assert.equal(맞춤.page.fitToHeight, 0, '세로는 제한 없음 — 길어지면 엑셀에서도 여러 장이다');
  assert.equal(excelScale(맞춤.page, { width: 100, height: 99999 }), 1, '세로가 아무리 길어도 줄이지 않는다');
});

/**
 * 아래 숫자는 **엑셀이 직접 말한 값**이다(Excel COM 으로 같은 파일을 열어
 * `Columns(i).Width` · `Rows(i).RowHeight` 합을 pt 로 받아 px 로 환산).
 * 이 값이 어긋나면 인쇄 배율이 달라져 엑셀로 뽑은 종이와 글자 위치가 밀린다.
 */
test('열 너비·행 높이를 엑셀이 말하는 값 그대로 읽는다', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  const 합 = (list) => list.reduce((sum, value) => sum + value, 0);

  // 엑셀: 486pt(648px) × 734.5pt(979px). `<cols>` 에 6.75 로 적힌 열이 12개.
  const 세로양식 = sheets.find((s) => s.name === 'QA-6.1-1');
  assert.equal(합(세로양식.colWidths), 648);
  assert.equal(합(세로양식.rowHeights), 979);
  assert.ok(세로양식.colWidths.every((w) => w === 54), '열마다 54px — 여백 5px 를 덧붙이면 59px 가 된다');

  // 엑셀: 1009.5pt(1346px) × 612.5pt(817px)
  const 가로양식 = sheets.find((s) => s.name === 'QA-6.1-3');
  assert.equal(합(가로양식.colWidths), 1346);
  assert.ok(Math.abs(합(가로양식.rowHeights) - 817) <= 1, `행높이 합 ${합(가로양식.rowHeights)}px`);

  // 엑셀 [페이지 설정] → 페이지 가운데 맞춤(가로만 켜져 있다)
  assert.equal(세로양식.page.horizontalCentered, true);
  assert.equal(세로양식.page.verticalCentered, false);
});

test('바닥글을 엑셀 서식 문자열에서 푼다', () => {
  // 실제 양식에 들어 있는 모양: 오른쪽에 굵은 9pt 로 서식 번호
  const 번호 = parseHeaderFooter('&R&"맑은 고딕,굵게"&9QA-4.3-4');
  assert.equal(번호.left.length, 0);
  assert.deepEqual(번호.right, [{ text: 'QA-4.3-4', size: 9, bold: true, italic: undefined, font: '맑은 고딕' }]);

  // 왼쪽 안내문 + 오른쪽 번호
  const 둘 = parseHeaderFooter('&L&10※ 본 양식은 참조용이다.&R&10QA-4.3-5');
  assert.equal(둘.left[0].text, '※ 본 양식은 참조용이다.');
  assert.equal(둘.left[0].size, 10);
  assert.equal(둘.right[0].text, 'QA-4.3-5');

  // 쪽 번호: 한 장이면 채우고, 여러 장이면 비운다(장마다 다른 번호를 찍을 수 없다)
  assert.equal(parseHeaderFooter('&C&P / &N', { pages: 1 }).center.map((r) => r.text).join(''), '1 / 1');
  assert.equal(parseHeaderFooter('&C&P / &N', { pages: 3 }).center.map((r) => r.text).join(''), ' / 3');

  assert.equal(parseHeaderFooter('&C&A', { sheetName: 'QA-6.1-3' }).center[0].text, 'QA-6.1-3');
  assert.equal(parseHeaderFooter('A && B').left[0].text, 'A & B', '&& 는 글자 & 하나');
  assert.equal(parseHeaderFooter('자리를 안 적으면 왼쪽').left.length, 1);
  assert.ok(isEmptyHeaderFooter(parseHeaderFooter(undefined)));
});

test('실제 양식의 바닥글 — 오른쪽에 서식 번호가 들어 있다', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const sheets = await parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const sheet = sheets.find((s) => s.name === 'QA-6.1-3');
  const footer = parseHeaderFooter(sheet.page.footer, { pages: 1 });
  assert.equal(footer.right.at(-1).text, 'QA-6.1-3');
  assert.match(footer.left.at(-1).text, /본 양식은/);
});
