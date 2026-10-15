/** 순서도 상자 글자 고치기 — 화면에서 고친 글자가 내려받은 엑셀의 도형에 들어가는가. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { applyShapeTextEdits, shapeIdOfKey } from '../apps/web/src/features/forms/shapeTextExport.ts';
import { buildFilledWorkbook } from '../apps/web/src/features/forms/formExport.ts';
import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const DRAWING = `<xdr:wsDr xmlns:xdr="x" xmlns:a="a"><xdr:twoCellAnchor><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="상자"/></xdr:nvSpPr>` +
  `<xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="900" b="1"/><a:t>옛 글자</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor>` +
  `<xdr:twoCellAnchor><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="4" name="다른 상자"/></xdr:nvSpPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>그대로</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`;

test('도형 키 읽기', () => {
  assert.equal(shapeIdOfKey('shape:13'), '13');
  assert.equal(shapeIdOfKey('3:2'), null);
});

test('번호가 맞는 도형 글자만 바꾸고, 첫 문단 서식을 줄마다 쓴다', () => {
  const out = applyShapeTextEdits(DRAWING, { 3: '새 글자\n둘째 줄 <&>' });
  assert.match(out, /<a:pPr algn="ctr"\/><a:r><a:rPr sz="900" b="1"\/><a:t>새 글자<\/a:t><\/a:r><\/a:p>/);
  assert.match(out, /<a:t>둘째 줄 &lt;&amp;&gt;<\/a:t>/);
  assert.match(out, /<a:bodyPr anchor="ctr"\/><a:lstStyle\/>/, '글상자 설정은 그대로');
  assert.match(out, /<a:t>그대로<\/a:t>/, '다른 도형은 손대지 않는다');
  assert.ok(!out.includes('옛 글자'));
});

test('실제 양식: 고친 순서도 상자 글자가 내려받은 엑셀에 들어간다', async () => {
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const sheets = await parseFormWorkbook(data.slice(0));
  const sheet = sheets.find((s) => (s.shapes ?? []).some((shape) => shape.textId));
  assert.ok(sheet, '글자 있는 도형이 있는 시트');
  const shape = sheet.shapes.find((item) => item.textId);
  const { bytes } = await buildFilledWorkbook(data.slice(0), { [sheet.name]: { [`shape:${shape.textId}`]: '고친 상자 글자' } });
  const again = await parseFormWorkbook(bytes);
  const after = again.find((s) => s.name === sheet.name).shapes.find((item) => item.textId === shape.textId);
  assert.equal(after.text, '고친 상자 글자');
});

test('표 중간에 줄을 끼우면 내려받은 엑셀의 도형도 함께 밀린다(그림 판 경로 찾기)', async () => {
  const { readZipIndex, readZipText } = await import('../apps/web/src/features/forms/zip.ts');
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/6.1 리스크와 기회관리.xlsx', import.meta.url)));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const rowsOf = async (bytes) => {
    const index = readZipIndex(bytes);
    const xml = await readZipText(bytes, index, 'xl/drawings/drawing1.xml');
    return [...xml.matchAll(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/g)].map((m) => Number(m[1]));
  };
  const before = await rowsOf(data);
  const { bytes } = await buildFilledWorkbook(data.slice(0), {}, {}, [], { 'QA-6.1-1': [1] });
  const after = await rowsOf(bytes);
  assert.equal(after.length, before.length);
  assert.ok(after.every((row, i) => row === before[i] + 1), '1행 앞에 한 줄 — 모든 도형이 한 줄 아래로');
});
