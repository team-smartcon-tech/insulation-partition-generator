/**
 * 잠금 판정 시험용 엑셀을 만든다.
 *
 * 엑셀은 칸의 잠금을 **스타일**에 적어 두는데, 같은 스타일에 `applyProtection="0"` 이 붙어
 * 있으면 그 잠금 설정을 **쓰지 않는다**(기본값인 "잠김"으로 본다). 이 차이를 놓치면 실제로는
 * 잠긴 칸을 "고칠 수 있는 칸"으로 잘못 보여 준다 — 사용자 신고가 바로 이 경우였다.
 *
 * 만드는 칸:
 *   A1 = 아무 설정 없음        → 엑셀: 잠김
 *   B1 = locked=0, 설정 적용   → 엑셀: 풀림
 *   C1 = locked=0, 설정 무시   → 엑셀: 잠김  ← 우리가 틀렸던 자리
 *
 * 사용: node scripts/make-lock-variants.mjs → tests/fixtures/잠금 변형.xlsx
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const ExcelJS = require('exceljs');
const zip = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/features/forms/zip.ts')).href);

const out = path.join(ROOT, 'tests/fixtures/잠금 변형.xlsx');

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('보호시트');
sheet.getCell('A1').value = '기본(잠김)';
sheet.getCell('B1').value = '풀린 칸';
sheet.getCell('C1').value = '설정은 풀림이나 무시됨';
sheet.getCell('B1').protection = { locked: false };
// C1 은 B1 과 다른 스타일이어야 한다(스타일이 같으면 한쪽만 고칠 수 없다).
sheet.getCell('C1').protection = { locked: false };
sheet.getCell('C1').font = { italic: true };
await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true });
await workbook.xlsx.writeFile(out);

// C1 이 쓰는 스타일에 applyProtection="0" 을 붙인다(엑셀에서 "설정 무시"에 해당).
const buffer = await readFile(out);
const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const index = zip.readZipIndex(data);
const sheetXml = await zip.readZipText(data, index, 'xl/worksheets/sheet1.xml');
const styleIndex = /<c r="C1"[^>]*\bs="(\d+)"/.exec(sheetXml)?.[1];
if (styleIndex === undefined) throw new Error('C1 의 스타일 번호를 찾지 못했습니다');

const stylesXml = await zip.readZipText(data, index, 'xl/styles.xml');
const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
// 자식(<protection/>)이 있는 xf 는 첫 `/>` 에서 끊으면 안 된다 — 닫는 태그까지 통째로 집는다.
const xfs = cellXfs[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g);
// 이미 붙어 있는 값을 바꾼다. 앞에 또 붙이면 같은 속성이 두 번이라 엑셀이 파일을 못 연다.
const target = xfs[Number(styleIndex)];
xfs[Number(styleIndex)] = target.includes('applyProtection="1"')
  ? target.replace('applyProtection="1"', 'applyProtection="0"')
  : target.replace('<xf ', '<xf applyProtection="0" ');
const patchedStyles = stylesXml.replace(cellXfs[1], xfs.join(''));

const items = zip.readZipItems(data);
const { compressed, raw } = await zip.deflateText(patchedStyles);
const at = items.findIndex((item) => item.name === 'xl/styles.xml');
items[at] = { name: 'xl/styles.xml', method: 8, crc32: zip.crc32(raw), compressed, uncompressedSize: raw.length };
await writeFile(out, Buffer.from(zip.writeZip(items)));

console.log(`만든 파일: ${out} (C1 스타일 ${styleIndex} 에 applyProtection="0")`);
