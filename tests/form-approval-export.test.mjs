/** 결재 도장을 엑셀에 넣기 — 서명·구분선·이름을 떠 있는 그림·도형으로, 양식(칸)은 그대로. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';
import { buildFilledWorkbook } from '../apps/web/src/features/forms/formExport.ts';
import { columnWidthPx, insertDrawingTag, pngSize, sheetGeometry } from '../apps/web/src/features/forms/approvalExport.ts';
import { findApprovalBoxes } from '../apps/web/src/features/forms/approval.ts';
import { readZipIndex, readZipText } from '../apps/web/src/features/forms/zip.ts';

async function fixture(name) {
  const buffer = await readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** 가로 w · 세로 h 짜리 진짜 PNG(검은 점) */
function png(w, h) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  for (let i = 0; i < raw.length; i++) if (i % (w * 4 + 1) !== 0 && (i % (w * 4 + 1)) % 4 === 0) raw[i] = 255;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

function stampsFor(sheet, caption = '이상영 대리') {
  const [box] = findApprovalBoxes(sheet);
  const byKey = new Map(sheet.cells.map((cell) => [cell.key, cell]));
  const sign = byKey.get(box.slots[0].signKey);
  return {
    stamp: { row: sign.row, col: sign.col, rowSpan: sign.rowSpan, colSpan: sign.colSpan, png: png(120, 40), caption },
    dateKey: box.slots[0].dateKey,
  };
}

test('그림이 이미 있는 시트: 서명 그림 1개와 선·이름 도형이 더해지고, 칸·기존 그림은 그대로', async () => {
  const original = await fixture('6.1 리스크와 기회관리.xlsx');
  const before = await parseFormWorkbook(original);
  const sheet = before.find((s) => s.name === 'QA-6.1-3');
  const { stamp, dateKey } = stampsFor(sheet);

  const { bytes, skippedSheets } = await buildFilledWorkbook(
    original,
    { [sheet.name]: { [dateKey]: '09/17' } },
    { [sheet.name]: [stamp] },
  );
  assert.deepEqual(skippedSheets, []);

  const after = await parseFormWorkbook(bytes);
  const same = after.find((s) => s.name === sheet.name);
  assert.equal(same.images.length, sheet.images.length + 1, '서명 그림 1개 추가');
  assert.equal(same.shapes.length, sheet.shapes.length + 2, '구분선·이름 추가');
  assert.ok(same.shapes.some((shape) => shape.text?.includes('이상영 대리')), '이름 글자');
  assert.equal(same.cells.find((c) => c.key === dateKey).text, '09/17', '날짜');
  // 양식은 그대로 — 합친 칸 수·열 너비
  assert.equal(same.cells.length, sheet.cells.length, '칸(합친 칸 포함) 수 그대로');
  assert.deepEqual(same.colWidths, sheet.colWidths);
  // 다른 시트의 그림은 건드리지 않는다
  const other = before.find((s) => s.name === 'QA-6.1-4');
  assert.equal(after.find((s) => s.name === 'QA-6.1-4').images.length, other.images.length);

  // 서명이 결재칸 안에 있다(그림의 위치가 서명 자리 범위 안)
  const signCell = sheet.cells.find((c) => c.key === box0SignKey(sheet));
  const left = sheet.colWidths.slice(0, signCell.col - 1).reduce((a, b) => a + b, 0);
  const top = sheet.rowHeights.slice(0, signCell.row - 1).reduce((a, b) => a + b, 0);
  const width = sheet.colWidths.slice(signCell.col - 1, signCell.col - 1 + signCell.colSpan).reduce((a, b) => a + b, 0);
  const height = sheet.rowHeights.slice(signCell.row - 1, signCell.row - 1 + signCell.rowSpan).reduce((a, b) => a + b, 0);
  const added = same.images.find((image) => !sheet.images.some((old) => old.left === image.left && old.top === image.top));
  assert.ok(added.left >= left - 2 && added.left + added.width <= left + width + 2, `가로 안: ${added.left}`);
  assert.ok(added.top >= top - 2 && added.top + added.height <= top + height + 2, `세로 안: ${added.top}`);
});

const box0SignKey = (sheet) => findApprovalBoxes(sheet)[0].slots[0].signKey;

test('그림 판이 없는 시트: 판을 새로 만들어 붙이고 엑셀이 알아보게 등록한다', async () => {
  const original = await fixture('잠금 양식.xlsx');
  const before = await parseFormWorkbook(original);
  const sheet = before[0];
  const cell = sheet.cells.find((c) => c.rowSpan === 1 && c.colSpan === 1);
  const stamp = { row: cell.row, col: cell.col, rowSpan: 2, colSpan: 2, png: png(60, 30), caption: '김성훈' };

  const { bytes } = await buildFilledWorkbook(original, {}, { [sheet.name]: [stamp] });
  const index = readZipIndex(bytes);
  const types = await readZipText(bytes, index, '[Content_Types].xml');
  assert.match(types, /Extension="png"/);
  assert.match(types, /PartName="\/xl\/drawings\/drawing1\.xml"/);
  const sheetXml = await readZipText(bytes, index, 'xl/worksheets/sheet1.xml');
  assert.match(sheetXml, /<drawing r:id="rId\d+"\/>/);

  const after = await parseFormWorkbook(bytes);
  assert.equal(after[0].images.length, 1);
  assert.equal(after[0].shapes.length, 2);
});

test('도움 함수: 열 너비 변환, PNG 크기, drawing 태그 위치', () => {
  assert.equal(columnWidthPx(9.140625), 64, '파일에 적힌 너비(8.43자 표시)');
  assert.deepEqual(pngSize(png(120, 40)), { width: 120, height: 40 });
  const geometry = sheetGeometry('<sheetFormatPr defaultRowHeight="16.5"/><cols><col min="2" max="3" width="10" customWidth="1"/></cols><row r="2" ht="30" customHeight="1">');
  assert.equal(geometry.rowEmu(2), 30 * 12700);
  assert.equal(geometry.rowEmu(5), 16.5 * 12700);
  assert.equal(geometry.colEmu(3), columnWidthPx(10) * 9525);
  assert.equal(
    insertDrawingTag('<worksheet><pageSetup/><headerFooter/><legacyDrawing r:id="x"/></worksheet>', 'rId9'),
    '<worksheet><pageSetup/><headerFooter/><drawing r:id="rId9"/><legacyDrawing r:id="x"/></worksheet>',
  );
});

test('위치 값은 모두 정수 — 소수가 섞이면 엑셀이 파일을 열지 못한다', async () => {
  const original = await fixture('6.1 리스크와 기회관리.xlsx');
  const sheet = (await parseFormWorkbook(original)).find((s) => s.name === 'QA-6.1-3');
  const { stamp } = stampsFor(sheet);
  // 캔버스에서 나온 서명처럼 나누어떨어지지 않는 크기
  const { bytes } = await buildFilledWorkbook(original, {}, { [sheet.name]: [{ ...stamp, png: png(480, 169) }] });
  const index = readZipIndex(bytes);
  const drawing = await readZipText(bytes, index, 'xl/drawings/drawing3.xml');
  const numbers = [...drawing.matchAll(/<xdr:(?:col|row|colOff|rowOff)>([^<]*)</g)].map((m) => m[1]);
  assert.ok(numbers.length > 0);
  assert.deepEqual(numbers.filter((n) => !/^\d+$/.test(n)), [], '정수가 아닌 값');
  const exts = [...drawing.matchAll(/<a:ext cx="([^"]*)" cy="([^"]*)"/g)].flatMap((m) => [m[1], m[2]]);
  assert.deepEqual(exts.filter((n) => !/^\d+$/.test(n)), []);
});
