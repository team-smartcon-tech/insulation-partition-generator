import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blankValuesFor,
  findTemplateSheet,
  normalizeValues,
  withCustomSheets,
} from '../apps/web/src/features/forms/formStore.ts';

const sheet = (name) => ({
  name,
  rowCount: 3,
  colCount: 3,
  colWidths: [10, 10, 10],
  rowHeights: [10, 10, 10],
  cells: [],
  images: [],
  shapes: [],
});

// ─── 고친 글자를 시트별로 나눠 담는다 ──────────────────────────

test('시트 구분 없이 저장돼 있던 옛 값은 첫 시트의 것으로 옮긴다', () => {
  const sheets = [sheet('1월'), sheet('2월')];
  const migrated = normalizeValues({ '3:2': '홍길동', '4:2': '공무팀' }, sheets);

  // 옛 저장본은 `셀 키 → 값` 한 덩어리였다. 버리지 않고 첫 시트로 옮긴다.
  assert.deepEqual(migrated, { '1월': { '3:2': '홍길동', '4:2': '공무팀' } });
});

test('이미 시트별로 나뉜 값은 그대로 둔다', () => {
  const values = { '1월': { '3:2': '가' }, '2월': { '3:2': '나' } };
  assert.deepEqual(normalizeValues(values, [sheet('1월'), sheet('2월')]), values);
});

test('같은 자리에 적은 글자가 시트끼리 섞이지 않는다', () => {
  const values = normalizeValues({ '1월': { '3:2': '가' }, '2월': { '3:2': '나' } }, []);

  // 셀 키가 "행:열" 이라 한 덩어리에 담으면 3행 2열 값이 모든 시트에 함께 나타난다.
  // 월별로 장을 나눠 쓰는 양식에서는 지난달 내용이 이번 달에 겹쳐 보이는 것이 된다.
  assert.equal(values['1월']['3:2'], '가');
  assert.equal(values['2월']['3:2'], '나');
});

test('값이 없거나 모양이 이상하면 빈 것으로 본다', () => {
  assert.deepEqual(normalizeValues(undefined, [sheet('1월')]), {});
  assert.deepEqual(normalizeValues(null, [sheet('1월')]), {});
  // 시트를 모르면 옛 값을 어디에 붙일지 정할 수 없다. 억지로 붙이지 않는다.
  assert.deepEqual(normalizeValues({ '3:2': '가' }, []), {});
});

// ─── 사용자가 더한 시트 ────────────────────────────────────────

test('더한 시트는 원본 시트 뒤에 붙고, 원본 격자를 그대로 쓴다', () => {
  const sheets = [sheet('견본'), sheet('2026-06')];
  const result = withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  assert.deepEqual(
    result.map((s) => s.name),
    ['견본', '2026-06', '2026-07'],
  );
  // 격자를 따로 저장하지 않고 원본에서 만들기 때문에, 파서가 좋아지면 함께 새 모양이 된다.
  assert.equal(result[2].colCount, sheets[0].colCount);
  assert.deepEqual(result[2].colWidths, sheets[0].colWidths);
});

test('더한 시트에는 표시가 붙는다', () => {
  const result = withCustomSheets([sheet('견본')], [{ name: '2026-07', source: '견본' }]);

  // 이름 바꾸기·지우기는 더한 시트에만 허용하므로 화면이 구분할 수 있어야 한다.
  assert.equal(result[0].custom, undefined);
  assert.equal(result[1].custom, true);
});

test('복사해 온 원본 시트가 사라졌으면 조용히 건너뛴다', () => {
  // 엑셀을 다시 올려 시트 이름이 바뀌는 경우. 없는 것을 그리려다 화면이 깨지면 안 된다.
  const result = withCustomSheets([sheet('견본')], [{ name: '2026-07', source: '없는시트' }]);
  assert.deepEqual(
    result.map((s) => s.name),
    ['견본'],
  );
});

test('원본 시트 목록은 건드리지 않는다', () => {
  const sheets = [sheet('견본')];
  withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  // 저장소에는 원본 시트만 담긴다. 여기서 원본 배열이 늘어나면 더한 시트가 저장본에 섞인다.
  assert.equal(sheets.length, 1);
});

// ─── 새 장은 빈 양식(견본)에서 만든다 ─────────────────────────

const withShapes = (name, shapes) => ({ ...sheet(name), shapes });
const watermark = {
  kind: 'box',
  left: 0,
  top: 0,
  width: 100,
  height: 40,
  text: 'Sample',
  fill: 'rgba(242, 220, 219, 0.75)',
  line: '#953735',
  lineWidth: 2,
  rotation: -18.28,
};
const normalBox = {
  kind: 'box',
  left: 0,
  top: 0,
  width: 100,
  height: 40,
  text: '필요 지식의 파악',
  line: '#000000',
  lineWidth: 1,
};

test('빈 양식 시트를 이름으로 찾는다', () => {
  const sheets = [sheet('QA-4.2-1'), sheet('견본'), sheet('QA-4.2-2 (25.06)')];

  // 직전 시트를 복사하면 지난달 내용이 딸려 온다. 빈 서식용 시트를 먼저 찾는다.
  assert.equal(findTemplateSheet(sheets)?.name, '견본');
  assert.equal(findTemplateSheet([sheet('Sample Form')])?.name, 'Sample Form');
  // 없으면 부르는 쪽이 지금 보는 시트로 대신한다.
  assert.equal(findTemplateSheet([sheet('1월'), sheet('2월')]), undefined);
});

test('사용자가 더한 장은 빈 양식 후보가 아니다', () => {
  const added = { ...sheet('견본 복사'), custom: true };
  // 더한 장은 이미 작성 중인 문서다. 그걸 복사하면 다시 내용이 딸려 온다.
  assert.equal(findTemplateSheet([added]), undefined);
});

test('새 장을 만들 때 견본 워터마크는 지워진다', () => {
  const sheets = [withShapes('견본', [watermark, normalBox])];
  const result = withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  // 남아 있으면 인쇄물에 "Sample" 이 찍힌다.
  assert.deepEqual(
    result[1].shapes.map((s) => s.text),
    ['필요 지식의 파악'],
  );
});

test('원본 견본 시트의 워터마크는 그대로 둔다', () => {
  const sheets = [withShapes('견본', [watermark, normalBox])];
  const result = withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  // 견본은 견본으로 남아야 한다 — 실수로 그대로 쓰지 말라는 표시다.
  assert.equal(result[0].shapes.length, 2);
});

test('비스듬하기만 하거나 반투명하기만 한 도형은 워터마크가 아니다', () => {
  const tilted = { ...normalBox, rotation: -20 };
  const faint = { ...normalBox, fill: 'rgba(0, 0, 0, 0.1)' };
  const sheets = [withShapes('견본', [tilted, faint])];
  const result = withCustomSheets(sheets, [{ name: '2026-07', source: '견본' }]);

  // 기울기만 보면 비스듬한 라벨이, 투명도만 보면 옅은 음영 상자가 함께 지워진다.
  assert.equal(result[1].shapes.length, 2);
});

// ─── 새 장은 내용을 비우고 시작한다 ───────────────────────────

const cellsOf = (entries) =>
  entries.map(([key, text]) => {
    const [row, col] = key.split(':').map(Number);
    return { key, row, col, rowSpan: 1, colSpan: 1, text, style: { borders: {} } };
  });
const formSheet = (name, entries, colCount = 3) => ({
  ...sheet(name),
  colCount,
  cells: cellsOf(entries),
});

test('장마다 달라지는 칸만 비우고 머리글은 남긴다', () => {
  const template = formSheet('견본', [
    ['1:1', '구분'],
    ['2:1', '외부'],
    ['2:2', '발주처'],
  ]);
  const june = formSheet('6월', [
    ['1:1', '구분'],
    ['2:1', '내부'],
    ['2:2', '건축기획팀'],
  ]);

  const blanks = blankValuesFor([template, june], template);
  // 머리글("구분")은 모든 장에서 같아 남고, 값은 장마다 달라 비워진다.
  assert.deepEqual(blanks, { '2:1': '', '2:2': '' });
});

test('띄어쓰기만 다른 머리글은 지우지 않는다', () => {
  const template = formSheet('견본', [['1:1', '작성']]);
  const june = formSheet('6월', [['1:1', '작 성']]);

  // 실제 파일에서 이 보정이 없으면 "작성"이 내용으로 분류돼 지워졌다.
  assert.deepEqual(blankValuesFor([template, june], template), {});
});

test('견줄 장이 없으면 아무것도 비우지 않는다', () => {
  const only = formSheet('견본', [['1:1', '구분'], ['2:1', '외부']]);

  // 무엇이 머리글인지 알 방법이 없다. 머리글을 지우는 쪽이 내용을 남기는 쪽보다 나쁘다.
  assert.deepEqual(blankValuesFor([only], only), {});
});

test('열 수가 다른 시트는 같은 양식으로 보지 않는다', () => {
  const template = formSheet('견본', [['1:1', '구분']], 20);
  const other = formSheet('다른양식', [['1:1', '번호']], 8);

  // 생김새가 다른 표끼리 견주면 머리글이 통째로 지워진다.
  assert.deepEqual(blankValuesFor([template, other], template), {});
});

test('사용자가 더한 장은 견줄 대상이 아니다', () => {
  const template = formSheet('견본', [['1:1', '구분']]);
  const added = { ...formSheet('2026-07', [['1:1', '아무거나']]), custom: true };

  // 더한 장은 작성 중이라 내용이 계속 바뀐다. 그걸 기준 삼으면 머리글이 지워진다.
  assert.deepEqual(blankValuesFor([template, added], template), {});
});

test('머리글 줄 아래는, 모든 장에서 값이 같아도 내용으로 본다', () => {
  // 담당부서가 늘 "공무"인 대장. 칸 단위로만 보면 머리글로 잘못 남는다.
  const template = formSheet('견본', [
    ['6:1', '구분'],
    ['6:2', '이해관계자'],
    ['6:3', '담당부서'],
    ['7:1', '외부'],
    ['7:2', '발주처'],
    ['7:3', '공무'],
  ]);
  const june = formSheet('6월', [
    ['6:1', '구분'],
    ['6:2', '이해관계자'],
    ['6:3', '담당부서'],
    ['7:1', '내부'],
    ['7:2', '건축기획팀'],
    ['7:3', '공무'],
  ]);

  const blanks = blankValuesFor([template, june], template);
  assert.deepEqual(Object.keys(blanks).sort(), ['7:1', '7:2', '7:3']);
  // 머리글 줄은 통째로 남는다.
  assert.equal('6:3' in blanks, false);
});

test('머리글 줄 위는 칸 단위로 본다', () => {
  const template = formSheet('견본', [
    ['1:1', '이해관계자의 요구사항 및 관리방안'],
    ['3:1', '0000 신축공사'],
    ['6:1', '구분'],
    ['6:2', '이해관계자'],
    ['6:3', '담당부서'],
    ['7:1', '외부'],
  ]);
  const june = formSheet('6월', [
    ['1:1', '이해관계자의 요구사항 및 관리방안'],
    ['3:1', '부산 장안지구 B-1BL'],
    ['6:1', '구분'],
    ['6:2', '이해관계자'],
    ['6:3', '담당부서'],
    ['7:1', '내부'],
  ]);

  const blanks = blankValuesFor([template, june], template);
  // 제목은 남고 현장명만 비워진다 — 머리글 위쪽을 줄 단위로 지우면 제목이 사라진다.
  assert.equal('1:1' in blanks, false);
  assert.equal('3:1' in blanks, true);
});

test('머리글 줄이 없으면 칸 단위 판정만 쓴다', () => {
  // 라벨과 값이 같은 줄에 있는 양식(공 사 명 | 부산 장안…). 줄 단위로 지우면 라벨이 사라진다.
  const template = formSheet('견본', [
    ['3:1', '공 사 명'],
    ['3:2', '부산 장안지구'],
  ]);
  const other = formSheet('다른장', [
    ['3:1', '공 사 명'],
    ['3:2', '이천중리 2차'],
  ]);

  assert.deepEqual(blankValuesFor([template, other], template), { '3:2': '' });
});
