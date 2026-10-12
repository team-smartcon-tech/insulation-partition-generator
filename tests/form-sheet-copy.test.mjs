/** 앱에서 더한 장을 엑셀에 붙일 때의 XML 규칙. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addSheetToWorkbook,
  anchorText,
  copiedSheetXml,
  copyPrintArea,
  isSampleAnchor,
  stripSampleAnchors,
} from '../apps/web/src/features/forms/sheetCopyExport.ts';

const anchor = (text) =>
  `<xdr:twoCellAnchor editAs="oneCell"><xdr:from/><xdr:sp><xdr:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor>`;

test('견본 표시 가려내기 — 워터마크와 "제출 시 삭제" 안내', () => {
  assert.equal(anchorText(anchor('※ 제출시에는 해당 BOX 삭제 후 제출')), '※ 제출시에는 해당 BOX 삭제 후 제출');
  assert.equal(isSampleAnchor(anchor('Sample')), true);
  assert.equal(isSampleAnchor(anchor('※ 제출시에는 해당 BOX 삭제 후 제출')), true);
  assert.equal(isSampleAnchor(anchor('작성 요령: 공종별로 나누어 적는다')), false, '보통 안내는 남긴다');
  assert.equal(isSampleAnchor(anchor('   ')), false);
});

test('그림 판에서 견본 표시만 뺀다 — 나머지 도형·그림은 그대로', () => {
  const logo = '<xdr:twoCellAnchor><xdr:pic><xdr:nvPicPr/></xdr:pic></xdr:twoCellAnchor>';
  const drawing = `<xdr:wsDr>${logo}${anchor('Sample')}${anchor('※ 제출 시 이 박스는 삭제하고 제출')}</xdr:wsDr>`;
  const { xml, removed } = stripSampleAnchors(drawing);
  assert.equal(removed, 2);
  assert.equal(xml, `<xdr:wsDr>${logo}</xdr:wsDr>`);
});

test('복사한 시트: 그림 판은 새 것을 가리키고, 프린터 설정 연결은 뗀다', () => {
  const source = '<worksheet><sheetData/><pageMargins/><pageSetup paperSize="9" scale="75" r:id="rId1"/><headerFooter/><drawing r:id="rId2"/></worksheet>';
  const copied = copiedSheetXml(source, 'rId1');
  assert.match(copied, /<pageSetup paperSize="9" scale="75"\/>/, '인쇄 설정은 남고 연결만 빠진다');
  assert.equal((copied.match(/<drawing /g) ?? []).length, 1);
  assert.match(copied, /<drawing r:id="rId1"\/><\/worksheet>/);

  // 그림이 없던 시트는 그림 판도 안 붙는다
  assert.equal(copiedSheetXml('<worksheet><sheetData/></worksheet>', undefined), '<worksheet><sheetData/></worksheet>');
});

test('복사한 시트는 탭 색을 물려받지 않는다', () => {
  // 견본 시트는 빨간 탭인 경우가 많다 — 복사본까지 빨가면 작성한 장이 견본처럼 보인다.
  const source = '<worksheet><sheetPr><tabColor rgb="FFC00000"/><pageSetUpPr fitToPage="1"/></sheetPr><sheetData/></worksheet>';
  const copied = copiedSheetXml(source, undefined);
  assert.equal(copied.includes('tabColor'), false);
  assert.match(copied, /<pageSetUpPr fitToPage="1"\/>/, '다른 시트 설정은 그대로');
});

test('워크북에 시트를 맨 뒤에 더하고, 인쇄 영역도 따라 붙인다', () => {
  const workbook =
    '<workbook><sheets><sheet name="견본" sheetId="6" r:id="rId1"/><sheet name="QA-1" sheetId="11" r:id="rId2"/></sheets>' +
    '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">\'견본\'!$A$1:$L$49</definedName></definedNames></workbook>';

  const added = addSheetToWorkbook(workbook, '26.09', 'rId9');
  assert.match(added, /<sheet name="26.09" sheetId="12" r:id="rId9"\/><\/sheets>/);

  const withArea = copyPrintArea(added, 0, 2, '26.09');
  assert.match(withArea, /localSheetId="2">'26\.09'!\$A\$1:\$L\$49<\/definedName>/);
  assert.match(withArea, /localSheetId="0">'견본'!\$A\$1:\$L\$49<\/definedName>/, '원본 인쇄 영역은 그대로');

  // 인쇄 영역이 없던 시트를 복사하면 아무것도 더하지 않는다
  assert.equal(copyPrintArea(added, 1, 2, '26.09'), added);
});
