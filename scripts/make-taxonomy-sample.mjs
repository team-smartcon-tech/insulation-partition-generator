/**
 * 서류 분류 코드표 예시 엑셀을 만든다.
 *
 * 사용자가 준 사진(문서 및 기록 목록표)을 그대로 옮긴 것이다. 앱이 읽어 들일 코드표의
 * **형식 본보기** 역할도 한다 — 회사 표가 바뀌면 이 모양으로 다시 만들어 올리면 된다.
 *
 * **시트 이름 = 1차 분류 이름**이다(공무관련 · 품질관련). 앱은 시트 이름으로 코드표를
 * 구분해, 같은 이름으로 다시 올리면 그 코드표만 갈아 끼운다.
 *
 * 사용: node scripts/make-taxonomy-sample.mjs
 *   → apps/worker/samples/서류 분류 코드표.xlsx   (공무관련)
 *   → apps/worker/samples/품질관련 코드표.xlsx     (품질관련)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const ExcelJS = require('exceljs');

const 공무관련 = [
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
    // 회사 표에는 "305 본사 공지사항"이 두 줄 있었다(오프라인에서 부수가 많아 두 권으로
    // 보관). 305 는 위의 "현장 주요업무 체크리스트"가 이미 쓰고 있어, 사용자 확인을 받아
    // 311 한 줄로 정리했다.
    ['311', '본사 공지사항'],
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

// 사용자가 준 "문서 및 기록 목록표"(1차 분류 CODE Q · 품질) 사진을 그대로 옮겼다.
// 500 블록의 번호 겹침(505·509 두 번씩, 508 없음)도 사진 그대로 두었다 — 짐작해서
// 번호를 바꾸지 않고, 앱이 "겹치는 코드"로 알리게 해 사용자 확인을 받는다.
const 품질관련 = [
  ['100', '공통/일반', [
    ['101', '이해관계자니즈와 기대'],
    ['102', '리스크와 기회관리'],
    ['103', '품질환경방침 및 목표관리'],
    ['104', '회의록'],
    ['105', '문서 및 기록 목록표'],
    ['106', '개인 업무 분장표'],
    ['107', '데이터수집및분석보고서'],
    ['108', '품질경영검토 보고서'],
  ]],
  ['200', '교육/훈련', [
    ['201', '교육보고서'],
    ['202', '중점품질관리수행인원적격성평가'],
  ]],
  ['300', '계획/절차서', [
    ['301', '품질관리/시험계획서'],
    ['302', '중점품질관리계획서'],
    ['303', '연간교육훈련계획서'],
    ['304', '연간내부심사계획서'],
    ['305', '품질목표및달성계획서'],
    ['306', '공장점검계획서'],
    ['307', '검사시험계획서(ITP)'],
    ['308', '균열관리계획서'],
    ['309', '콘크리트표면결함관리계획서'],
    ['310', '우중 콘크리트 시공계획서'],
  ]],
  ['400', '부적합 관리', [
    ['401', '부적합 보고서'],
    ['402', '불합격 조치표'],
    ['403', '부적합 시정조치 요구서/보고서'],
    ['404', '지속적 개선항목관리대장'],
  ]],
  ['500', '품질관리', [
    ['501', '내부심사결과보고서'],
    ['502', '품질목표달성현황표'],
    ['503', '자체품질점검보고서'],
    ['504', '콘크리트자율점검보고서'],
    ['505', '품질관리비 사용내역서'],
    ['505', '공인기관성적서'],
    ['506', '철근시험성적서'],
    ['507', '레미콘 자재인수검사성적서'],
    ['509', '공인기관시험의뢰서/성적서'],
    ['509', 'PC부재-공장품질서류'],
    ['510', '케미칼앙카인발시험'],
  ]],
  ['600', '시험관리', [
    ['601', '단열재밀도시험'],
    ['602', '속빈콘크리트블럭시험'],
    ['603', '콘크리트벽돌시험'],
    ['604', '경량기포콘크리트시험'],
    ['605', '온돌마감모르타르시험'],
    ['606', '그라우팅시험'],
    ['607', '물/시멘트시험'],
    ['608', '현장밀도시험'],
    ['609', '스터드볼트용접시험'],
    ['610', '콘크리트시험일지'],
    ['611', '슈미트해머일지'],
    ['612', '구조별콘크리트타설대장'],
    ['613', '품질검사대장'],
    ['614', '품질시험-검사실적보고서'],
    ['615', '품질시험-검사총괄표'],
  ]],
  ['700', '공장점검', [
    ['701', '공장점검보고서'],
    ['702', '레미콘공장점검보고서'],
    ['703', '콘크리트 확인배합'],
  ]],
  ['800', '시험장비', [
    ['801', '검교정측정장비관리대장'],
    ['802', '검교정장비교정성적서'],
    ['803', '검교정측정장비관리대장(협력)'],
    ['804', '검교정장비교정성적서(협력)'],
  ]],
  ['900', '자재', [
    ['901', '자재인수검사체크리스트'],
    ['902', '자재수불부'],
  ]],
];

const TABLES = [
  { sheetName: '공무관련', fileName: '서류 분류 코드표.xlsx', groups: 공무관련 },
  { sheetName: '품질관련', fileName: '품질관련 코드표.xlsx', groups: 품질관련 },
];

const thin = { style: 'thin', color: { argb: 'FF000000' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function styleCell(cell, { bold = false, fill = null, align = 'center' } = {}) {
  cell.border = border;
  cell.font = { name: '맑은 고딕', size: 10, bold };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

async function writeTable({ sheetName, fileName, groups }) {
  const workbook = new ExcelJS.Workbook();
  // 시트 이름이 곧 1차 분류 이름이다. 앱은 이 이름으로 중분류들을 한데 묶는다.
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [{ width: 10 }, { width: 18 }, { width: 10 }, { width: 36 }];

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
  for (const [groupCode, groupName, items] of groups) {
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

  const outPath = path.join(ROOT, 'apps/worker/samples', fileName);
  await workbook.xlsx.writeFile(outPath);
  const itemCount = groups.reduce((n, g) => n + g[2].length, 0);
  console.log(`만든 파일: ${outPath} (${sheetName} · 중분류 ${groups.length}개, 소분류 ${itemCount}줄)`);
}

for (const table of TABLES) await writeTable(table);
