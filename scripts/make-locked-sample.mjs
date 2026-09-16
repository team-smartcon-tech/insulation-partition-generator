/**
 * "시트 보호 + 셀 잠금" 확인용 예시 엑셀을 만든다.
 *
 * 실제 사내 양식(현장설명서 등)은 표 뼈대를 잠그고 사람이 적을 칸만 풀어 둔다.
 * 그 모양을 그대로 흉내 내, 앱이 잠금을 엑셀과 같게 따르는지 테스트에서 확인한다.
 *
 * 사용: node scripts/make-locked-sample.mjs → tests/fixtures/잠금 양식.xlsx
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const ExcelJS = require('exceljs');

const workbook = new ExcelJS.Workbook();

// 1) 보호가 걸린 시트 — 제목·항목 이름은 잠기고, 적는 칸만 풀려 있다.
const locked = workbook.addWorksheet('보호시트');
locked.getCell('A1').value = '공사명';
locked.getCell('B1').value = '0000 현장';
locked.getCell('A2').value = '위치';
locked.getCell('B2').value = '';
for (const ref of ['B1', 'B2']) locked.getCell(ref).protection = { locked: false };
await locked.protect('', { selectLockedCells: true, selectUnlockedCells: true });

// 2) 보호가 없는 시트 — 모든 칸을 고칠 수 있다.
const open = workbook.addWorksheet('자유시트');
open.getCell('A1').value = '메모';
open.getCell('B1').value = '아무나 고칠 수 있음';

const out = path.join(ROOT, 'tests/fixtures/잠금 양식.xlsx');
await workbook.xlsx.writeFile(out);
console.log(`만든 파일: ${out}`);
