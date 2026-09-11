/**
 * 서류 분류 코드표 예시 엑셀을 만든다.
 *
 * 사용자가 준 사진(2차 분류 / 3차 분류 표)을 그대로 옮긴 것이다. 앱이 읽어 들일
 * 코드표의 **형식 본보기** 역할도 한다 — 회사 표가 바뀌면 이 모양으로 다시 만들어
 * 올리면 된다.
 *
 * 사용: node scripts/make-taxonomy-sample.mjs [나올파일.xlsx]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const ExcelJS = require('exceljs');

const TAXONOMY = [
  ['100', '공통/일반', [
    ['101', '이해관계자 니즈와 기대'],
    ['102', '리스크 및 기회 평가표'],
    ['103', '리스크 및 기회 대응계획서'],
    ['104', '품질환경방침 및 목표관리'],
    ['105', '회의록'],
    ['106', '개인업무분장표'],
    ['107', '현장 지식관리 대장'],
    ['108', '설계도서 관리대장'],
    ['109', '하도급공사 발주계획'],
    ['110', '정기안전점검'],
    ['111', '안전관리비 사용내역서'],
    ['112', '문서 및 기록 목록표'],
  ]],
  ['200', '경영자책임', [
    ['201', '복무 보안'],
    ['202', '종합 시공계획서'],
    ['203', '조직도 및 직무분석'],
    ['204', '공사분석'],
    ['205', '시정안 수립 / 이행'],
    ['206', '교육 훈련 계획 수립'],
    ['207', '교육 이수 보고서'],
    ['208', '역량/적격성 평가서'],
    ['209', '고객지원'],
  ]],
  ['300', '대본업무', [
    ['301', '기안서 / 실정보고'],
    ['302', '사유서'],
    ['303', '업무 협조전'],
    ['304', '공사 현황 보고서'],
    ['305', '현장 주요업무 체크리스트'],
    ['306', '주간 업무 보고'],
    ['307', '공정별 착안사항'],
    ['308', '주요 현안 공유회의'],
    ['309', '임원 현황 보고'],
    ['310', 'VE 원가절감'],
    // 회사 표에 그대로 있는 모양: "305 본사 공지사항"이 두 줄. 오프라인에서 부수가
    // 많아 두 권으로 보관해 두 줄로 적은 것이라, 앱은 한 칸으로 합쳐 보여준다.
    ['305', '본사 공지사항'],
    ['305', '본사 공지사항'],
  ]],
  ['400', '대외업무', [
    ['401', '대외 공문 접수'],
    ['402', '대외 공문 발송'],
    ['403', '사업계획 승인'],
    ['404', '착공신고 필증'],
    ['405', '단속 · 점검 방문일지'],
    ['406', '대외 지적 사항'],
    ['407', '대외 조치 결과'],
    ['408', '대외 공지 사항'],
  ]],
  ['500', '도급업무', [
    ['501', '도급 계약서'],
    ['502', '도급 기성'],
  ]],
  ['600', '대감업무', [
    ['601', '감리 계약서'],
    ['602', '감리 공문 접수'],
    ['603', '감리 공문 발송'],
    ['604', '기술검토 의견서'],
    ['605', '작업지시서 접수'],
    ['606', '주간 공정 보고서'],
    ['607', '월간 공정 보고서'],
    ['608', '중간보고서'],
    ['609', '하도급 계약 통보서'],
    ['610', '감리 기성'],
  ]],
  ['700', '하도급업무', [
    ['701', '하도급 계약서'],
    ['702', '하도급 계약 관리대장'],
    ['703', '하도급 기성'],
    ['704', '하도급 공문 접수'],
    ['705', '하도급 공문 발송'],
    ['706', '하자 이행 증권'],
    ['707', '하도급 평가'],
    ['708', '하도급 가설건축물 신고필증'],
    ['709', '재하도급 관리대장'],
    ['710', '하도급 대금 연동제 관리대장'],
    ['711', '하도급 전자카드 관리대장'],
  ]],
  ['800', '민원관리', [['801', '민원일지']]],
  ['900', '기타', [['901', '우미글로벌']]],
];

const outPath = process.argv[2] ?? path.join(ROOT, 'apps/worker/samples/서류 분류 코드표.xlsx');

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('분류코드');
sheet.columns = [
  { width: 10 },
  { width: 18 },
  { width: 10 },
  { width: 34 },
];

const thin = { style: 'thin', color: { argb: 'FF000000' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function styleCell(cell, { bold = false, fill = null, align = 'center' } = {}) {
  cell.border = border;
  cell.font = { name: '맑은 고딕', size: 10, bold };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

// 1~2행: 머리글
sheet.mergeCells('A1:B1');
sheet.mergeCells('C1:D1');
sheet.getCell('A1').value = '2차 분류 (중분류)';
sheet.getCell('C1').value = '3차 분류 (소분류)';
for (const ref of ['A1', 'B1', 'C1', 'D1']) styleCell(sheet.getCell(ref), { bold: true, fill: 'FFD9D9D9' });

sheet.getCell('A2').value = 'CODE';
sheet.getCell('B2').value = '분류명';
sheet.getCell('C2').value = 'CODE';
sheet.getCell('D2').value = '분류명';
for (const ref of ['A2', 'B2', 'C2', 'D2']) styleCell(sheet.getCell(ref), { bold: true, fill: 'FFD9D9D9' });

// 3행부터: 중분류는 세로 병합, 소분류는 한 줄씩
let row = 3;
for (const [groupCode, groupName, items] of TAXONOMY) {
  const start = row;
  for (const [code, name] of items) {
    sheet.getCell(row, 3).value = code;
    sheet.getCell(row, 4).value = name;
    styleCell(sheet.getCell(row, 3));
    styleCell(sheet.getCell(row, 4), { align: 'left' });
    row += 1;
  }
  const end = row - 1;
  if (end > start) {
    sheet.mergeCells(start, 1, end, 1);
    sheet.mergeCells(start, 2, end, 2);
  }
  sheet.getCell(start, 1).value = groupCode;
  sheet.getCell(start, 2).value = groupName;
  styleCell(sheet.getCell(start, 1), { bold: true });
  styleCell(sheet.getCell(start, 2), { bold: true });
}

sheet.pageSetup.printArea = `A1:D${row - 1}`;

await workbook.xlsx.writeFile(outPath);
console.log(
  '만든 파일:',
  outPath,
  `(중분류 ${TAXONOMY.length}개, 소분류 ${TAXONOMY.reduce((n, g) => n + g[2].length, 0)}개)`,
);
