/** 칸 합치기·나누기 — 화면 모형과 엑셀 XML 이 같은 결과를 내나. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMerge,
  emptyMergeEdits,
  makeRange,
  mergedCellsIn,
  shiftMergeEdits,
  splitMerge,
  textCellsIn,
  withMerges,
} from '../apps/web/src/features/forms/sheetMerges.ts';
import { withInsertedRows } from '../apps/web/src/features/forms/sheetRows.ts';
import {
  applyMergesToSheetXml,
  centerMergedAnchors,
  clearCoveredCells,
  parseRef,
  rangeRef,
  readMergeRefs,
} from '../apps/web/src/features/forms/sheetMergesExport.ts';

/** 칸 하나 만들기 — 서식은 테스트에 쓰지 않으니 최소로 둔다. */
const cell = (row, col, text = '', rowSpan = 1, colSpan = 1) => ({
  key: `${row}:${col}`,
  row,
  col,
  rowSpan,
  colSpan,
  text,
  locked: false,
  style: { borders: {} },
});

/** 3줄 × 3칸. B2:C2 는 원본에서 이미 합쳐져 있다. */
const sheet = {
  name: '점검표',
  rowCount: 3,
  colCount: 3,
  colWidths: [64, 64, 64],
  rowHeights: [20, 20, 20],
  cells: [
    cell(1, 1, '제목'), cell(1, 2, '가'), cell(1, 3, '나'),
    cell(2, 1, '항목'), cell(2, 2, '합친칸', 1, 2),
    cell(3, 1, '비고'), cell(3, 2, '다'), cell(3, 3, '라'),
  ],
};

const at = (grid, row, col) => grid.cells.find((c) => c.row === row && c.col === col);

test('끌어서 고른 두 점이 어느 쪽이든 같은 범위가 된다', () => {
  const forward = makeRange({ row: 1, col: 1 }, { row: 3, col: 2 });
  const backward = makeRange({ row: 3, col: 2 }, { row: 1, col: 1 });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward, { top: 1, left: 1, bottom: 3, right: 2 });
});

test('합치면 왼쪽 위 칸이 범위를 차지하고 가려진 칸은 사라진다', () => {
  const edits = addMerge(sheet, emptyMergeEdits(), { top: 1, left: 1, bottom: 2, right: 1 });
  const out = withMerges(sheet, edits);

  const anchor = at(out, 1, 1);
  assert.equal(anchor.rowSpan, 2, '왼쪽 위 칸이 두 줄을 차지한다');
  assert.equal(anchor.text, '제목', '왼쪽 위 글자는 남는다');
  assert.equal(at(out, 2, 1), undefined, '가려진 칸은 격자에서 빠진다');
  assert.equal(out.cells.length, sheet.cells.length - 1);
});

test('합쳐진 칸을 나누면 가려져 있던 칸이 되살아난다', () => {
  const edits = splitMerge(emptyMergeEdits(), { key: '2:2', row: 2, col: 2 });
  const out = withMerges(sheet, edits);

  assert.equal(at(out, 2, 2).colSpan, 1, '한 칸으로 돌아온다');
  assert.equal(at(out, 2, 2).text, '합친칸', '글자는 왼쪽 위에 남는다');
  assert.ok(at(out, 2, 3), '가려져 있던 C2 가 되살아난다');
  assert.equal(at(out, 2, 3).text, '', '되살아난 칸은 비어 있다(엑셀과 같다)');
});

test('내가 합친 것을 다시 나누면 기록이 없어진다 — 기록이 쌓이지 않는다', () => {
  const merged = addMerge(sheet, emptyMergeEdits(), { top: 3, left: 2, bottom: 3, right: 3 });
  const grid = withMerges(sheet, merged);
  const back = splitMerge(merged, at(grid, 3, 2));

  assert.equal(back.add.length, 0, '더한 기록에서 빠진다');
  assert.equal(back.remove.length, 0, '원본 합치기를 푼 것으로 적지 않는다');
  assert.ok(at(withMerges(sheet, back), 3, 3), '원래 모습으로 돌아온다');
});

test('이미 합쳐진 칸에 겹쳐 합치면 그 합치기를 먼저 푼다', () => {
  const range = { top: 2, left: 1, bottom: 2, right: 3 };
  assert.equal(mergedCellsIn(sheet, range).length, 1, '겹치는 합치기를 찾아낸다');

  const edits = addMerge(sheet, emptyMergeEdits(), range);
  assert.deepEqual(edits.remove, ['2:2'], '원본 합치기를 푼 것으로 적는다');

  const out = withMerges(sheet, edits);
  const anchor = at(out, 2, 1);
  assert.equal(anchor.colSpan, 3, '고른 범위만큼 합쳐진다');
  assert.equal(at(out, 2, 2), undefined);
  assert.equal(at(out, 2, 3), undefined);
});

test('합치면 지워질 글자를 미리 알려 줄 수 있다', () => {
  const losing = textCellsIn(sheet, { top: 1, left: 1, bottom: 1, right: 3 }, undefined);
  assert.deepEqual(losing, ['가', '나'], '왼쪽 위(제목)는 빠진다');

  const typed = textCellsIn(sheet, { top: 1, left: 1, bottom: 1, right: 3 }, { '1:2': '' });
  assert.deepEqual(typed, ['나'], '화면에서 지운 칸은 셈하지 않는다');
});

test('줄을 끼우면 합치기 기록도 따라 밀린다', () => {
  const edits = { add: [{ top: 3, left: 1, bottom: 3, right: 2 }], remove: ['5:1'] };
  const out = shiftMergeEdits(edits, 3, 1);
  assert.deepEqual(out.add[0], { top: 4, left: 1, bottom: 4, right: 2 }, '합친 자리가 한 줄 아래로');
  assert.deepEqual(out.remove, ['6:1'], '푼 자리도 함께 밀린다');

  // 끼운 자리를 **걸치는** 합치기는 밀리지 않고 늘어난다 — 엑셀과 같다.
  const spanning = shiftMergeEdits({ add: [{ top: 2, left: 1, bottom: 5, right: 1 }], remove: [] }, 3, 1);
  assert.deepEqual(spanning.add[0], { top: 2, left: 1, bottom: 6, right: 1 });
});

test('끼워 넣은 줄 안에서만 합쳤다면 그 줄을 뺄 때 합치기도 없어진다', () => {
  // 안 없애면, 빠진 자리로 올라온 **아랫줄**이 대신 합쳐진다.
  const edits = { add: [{ top: 4, left: 1, bottom: 4, right: 3 }], remove: [] };
  const out = shiftMergeEdits(edits, 5, -1); // 4번 줄을 뺀다(자리는 뒤 줄 기준으로 온다)
  assert.deepEqual(out.add, [], '그 줄에만 있던 합치기는 함께 없어진다');

  // 여러 줄에 걸친 합치기는 없애지 않고 줄인다.
  const spanning = shiftMergeEdits({ add: [{ top: 3, left: 1, bottom: 5, right: 3 }], remove: [] }, 5, -1);
  assert.deepEqual(spanning.add[0], { top: 3, left: 1, bottom: 4, right: 3 });
});

test('줄을 끼운 시트에서는 **화면 격자**로 겹침을 따진다 — 원본 격자로 보면 엉뚱한 자리를 푼다', () => {
  // 2번 줄 앞에 한 줄 끼우면, 원본의 B2:C2 병합은 화면에서 3번 줄로 내려가 있다.
  const shown = withMerges(withInsertedRows(sheet, [2]), emptyMergeEdits());
  assert.equal(at(shown, 3, 2).colSpan, 2, '화면에서는 3번 줄에 있다');

  // 화면 좌표(3번 줄)로 합치면, 푸는 자리도 화면 좌표여야 한다.
  const edits = addMerge(shown, emptyMergeEdits(), { top: 3, left: 1, bottom: 3, right: 3 });
  assert.deepEqual(edits.remove, ['3:2'], '화면 자리 그대로 적는다');

  // 원본 격자로 따졌다면 겹치는 것을 못 찾아 **아무것도 풀지 않는다** — 그러면 엑셀이 파일을 거부한다.
  const wrong = addMerge(sheet, emptyMergeEdits(), { top: 3, left: 1, bottom: 3, right: 3 });
  assert.deepEqual(wrong.remove, [], '(잘못된 방식) 겹치는 병합을 놓친다');
});

/* ── 엑셀 XML 쪽 ── */

const sheetXml =
  '<worksheet><dimension ref="A1:C3"/><sheetData>' +
  '<row r="1"><c r="A1" s="3" t="s"><v>0</v></c><c r="B1" s="3" t="s"><v>1</v></c><c r="C1" s="3"/></row>' +
  '<row r="2"><c r="A2" s="4"/><c r="B2" s="4" t="s"><v>2</v></c><c r="C2" s="4" t="s"><v>9</v></c></row>' +
  '<row r="3"><c r="A3" s="4"/></row>' +
  '</sheetData><mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells>' +
  '<pageMargins left="0.7" right="0.7"/></worksheet>';

test('칸 표기와 범위를 서로 바꾼다', () => {
  assert.equal(rangeRef({ top: 2, left: 2, bottom: 2, right: 4 }), 'B2:D2');
  assert.equal(rangeRef({ top: 1, left: 27, bottom: 1, right: 28 }), 'AA1:AB1');
  assert.deepEqual(parseRef('B2:D3'), { top: 2, left: 2, bottom: 3, right: 4 });
  assert.deepEqual(parseRef('$A$1'), { top: 1, left: 1, bottom: 1, right: 1 }, '$ 가 붙어도 읽는다');
});

test('합치기를 XML 에 더하면 개수까지 맞는다', () => {
  const out = applyMergesToSheetXml(sheetXml, {
    add: [{ top: 3, left: 1, bottom: 3, right: 3 }],
    remove: [],
  });

  assert.deepEqual(readMergeRefs(out), ['B2:C2', 'A3:C3']);
  assert.match(out, /<mergeCells count="2">/, '개수를 고쳐야 엑셀이 복구 창을 띄우지 않는다');
});

test('푼 합치기는 XML 에서 빠지고, 다 빠지면 블록째 없어진다', () => {
  const out = applyMergesToSheetXml(sheetXml, { add: [], remove: ['2:2'] });
  assert.deepEqual(readMergeRefs(out), []);
  assert.doesNotMatch(out, /<mergeCells/, '빈 블록을 남기지 않는다');
  assert.match(out, /<pageMargins/, '뒤따르는 설정은 그대로');
});

test('겹치는 합치기는 XML 에서도 먼저 빠진다 — 겹치면 엑셀이 파일을 거부한다', () => {
  const out = applyMergesToSheetXml(sheetXml, {
    add: [{ top: 2, left: 1, bottom: 2, right: 3 }],
    remove: ['2:2'],
  });
  assert.deepEqual(readMergeRefs(out), ['A2:C2'], 'B2:C2 는 빠지고 새 범위만 남는다');
});

test('합치기 블록이 없던 시트에도 제자리에 만들어 넣는다', () => {
  const bare =
    '<worksheet><sheetData><row r="1"><c r="A1"/></row></sheetData>' +
    '<phoneticPr fontId="1"/><pageMargins left="0.7"/></worksheet>';
  const out = applyMergesToSheetXml(bare, { add: [{ top: 1, left: 1, bottom: 1, right: 2 }], remove: [] });

  assert.match(out, /<mergeCells count="1"><mergeCell ref="A1:B1"\/><\/mergeCells>/);
  // 시트는 태그 순서가 정해져 있다 — mergeCells 는 phoneticPr **앞**에 와야 한다.
  assert.ok(out.indexOf('<mergeCells') < out.indexOf('<phoneticPr'), 'phoneticPr 앞에 들어간다');
  assert.ok(out.indexOf('</sheetData>') < out.indexOf('<mergeCells'), 'sheetData 뒤에 들어간다');
});

test('합친 범위에서 왼쪽 위 말고는 글자를 지운다 — 서식은 남긴다', () => {
  const out = clearCoveredCells(sheetXml, [{ top: 1, left: 1, bottom: 1, right: 3 }]);

  assert.match(out, /<c r="A1" s="3" t="s"><v>0<\/v><\/c>/, '왼쪽 위는 그대로');
  assert.match(out, /<c r="B1" s="3"\/>/, '가려지는 칸은 비워진다');
  assert.match(out, /<c r="B2" s="4" t="s"><v>2<\/v>/, '범위 밖은 건드리지 않는다');
});

test('손댄 것이 없으면 XML 을 그대로 둔다', () => {
  assert.equal(applyMergesToSheetXml(sheetXml, undefined), sheetXml);
  assert.equal(applyMergesToSheetXml(sheetXml, emptyMergeEdits()), sheetXml);
  assert.equal(withMerges(sheet, emptyMergeEdits()), sheet);
});

test('합치면 화면에서도 글자가 가운데로 간다 — 엑셀의 [병합하고 가운데 맞춤]', () => {
  const edits = addMerge(sheet, emptyMergeEdits(), { top: 1, left: 1, bottom: 1, right: 3 });
  assert.equal(at(withMerges(sheet, edits), 1, 1).style.align, 'center');
  // 나눈 칸은 원래 서식 그대로다(엑셀도 가운데 맞춤을 되돌리지 않는다).
  assert.equal(at(withMerges(sheet, splitMerge(emptyMergeEdits(), { key: '2:2', row: 2, col: 2 })), 2, 2).style.align, undefined);
});

test('내려받은 파일에서도 가운데 맞춤 — 서식을 새로 만들어 그 칸만 바꾼다', () => {
  // 합칠 칸(A2)은 4번 서식을 쓴다. 그 서식을 본떠 "가운데 맞춤만 더한" 서식을 새로 만든다.
  const styles =
    '<styleSheet><cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" xfId="0"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" borderId="2" xfId="0" applyFont="1"/>' +
    '</cellXfs></styleSheet>';
  const out = centerMergedAnchors(sheetXml, styles, [{ top: 2, left: 1, bottom: 2, right: 3 }]);

  assert.match(out.styles, /<cellXfs count="6">/, '서식이 하나 늘어난다');
  assert.match(
    out.styles,
    /borderId="2" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"\/><\/xf>/,
    '원래 서식(글꼴·테두리)은 그대로 두고 가운데만 더한다',
  );
  assert.match(out.styles, /<xf numFmtId="0" fontId="1" borderId="2" xfId="0" applyFont="1"\/>/, '본뜬 서식 자체는 남는다');
  assert.match(out.sheet, /<c r="A2" s="5"\/>/, '합친 칸이 새 서식을 가리킨다');
  assert.match(out.sheet, /<c r="B2" s="4"/, '다른 칸은 건드리지 않는다');

  // 같은 모양이 또 필요하면 **다시 쓴다** — 합칠 때마다 서식이 불어나면 파일이 커진다.
  const again = centerMergedAnchors(out.sheet, out.styles, [{ top: 2, left: 1, bottom: 2, right: 3 }]);
  assert.match(again.styles, /<cellXfs count="6">/, '서식이 더 늘지 않는다');
});

test('맞춤이 이미 있던 서식은 가로만 가운데로 바꾼다 — 세로 맞춤은 지키지 않으면 표가 달라진다', () => {
  const styles = '<styleSheet><cellXfs count="1"><xf fontId="0"><alignment vertical="center" horizontal="left"/></xf></cellXfs></styleSheet>';
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" s="0"/></row></sheetData></worksheet>';
  const out = centerMergedAnchors(xml, styles, [{ top: 1, left: 1, bottom: 1, right: 2 }]);

  const added = out.styles.match(/<xf[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g).at(-1);
  assert.match(added, /vertical="center"/, '세로 맞춤은 그대로 물려받는다');
  assert.match(added, /horizontal="center"/, '가로만 가운데로 바뀐다');
  assert.doesNotMatch(added, /horizontal="left"/);
  // 원래 서식은 **손대지 않는다** — 그 서식을 쓰는 다른 칸들까지 가운데로 가 버린다.
  assert.match(out.styles, /<xf fontId="0"><alignment vertical="center" horizontal="left"\/><\/xf>/);
});
