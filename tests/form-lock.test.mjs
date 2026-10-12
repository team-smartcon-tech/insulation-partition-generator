/** 엑셀의 "시트 보호 + 셀 잠금"을 화면에서도 같게 따르는지. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFormWorkbook } from '../apps/web/src/features/forms/formParser.ts';

const SAMPLE = fileURLToPath(new URL('./fixtures/잠금 양식.xlsx', import.meta.url));

async function sheets() {
  const buffer = await readFile(SAMPLE);
  return parseFormWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

test('보호가 걸린 시트는 잠긴 칸과 풀린 칸을 구분한다', async () => {
  const [locked] = await sheets();
  assert.equal(locked.name, '보호시트');
  assert.equal(locked.locked, true, '시트 보호가 켜져 있다');

  const at = (key) => locked.cells.find((cell) => cell.key === key);
  // 항목 이름 칸은 잠겨 있다(양식 뼈대라 건드리면 안 된다).
  assert.equal(at('1:1').locked, true);
  assert.equal(at('2:1').locked, true);
  // 적는 칸은 엑셀에서 풀어 두었다 → 화면에서도 고칠 수 있어야 한다.
  assert.equal(at('1:2').locked, undefined);
  assert.equal(at('2:2').locked, undefined);
});

test('보호가 없는 시트는 어느 칸도 잠그지 않는다', async () => {
  const [, open] = await sheets();
  assert.equal(open.name, '자유시트');
  assert.equal(open.locked, undefined);
  assert.deepEqual(
    open.cells.filter((cell) => cell.locked).map((cell) => cell.key),
    [],
    '보호가 없으면 엑셀에서도 전부 고칠 수 있다',
  );
});

test('잠금 설정이 여러 모양으로 적힌 파일도 엑셀과 같게 읽는다', async () => {
  // 같은 파일을 실제 엑셀(Range.Locked)로 확인한 값: A1 잠김 / B1 풀림 / C1 풀림.
  // (C1 은 스타일에 applyProtection="0" 이 붙어 있지만, 엑셀은 그래도 잠금 설정을 따른다.)
  const buffer = await readFile(fileURLToPath(new URL('./fixtures/잠금 변형.xlsx', import.meta.url)));
  const [sheet] = await parseFormWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  assert.equal(sheet.locked, true);
  const at = (key) => sheet.cells.find((cell) => cell.key === key);
  assert.equal(at('1:1').locked, true, 'A1 은 잠김');
  assert.equal(at('1:2').locked, undefined, 'B1 은 풀림');
  assert.equal(at('1:3').locked, undefined, 'C1 도 풀림(엑셀과 같게)');
});
