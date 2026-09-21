/**
 * 인쇄용 화면 — 복합기로 뽑을 때만 보이는 시트 한 장.
 *
 * 화면에 보이는 시트를 그대로 인쇄하면 헤더·목록·단추까지 함께 나오고, 화면 배율("가로 맞춤")이
 * 종이 폭과 달라 잘린다. 그래서 **인쇄할 때만** 문서 맨 끝에 시트를 한 번 더 그리고, 나머지는
 * 감춘다. 용지·방향·여백은 엑셀에 적힌 값을 쓰고, 표는 종이 폭에 맞춰 줄인다(`printSheet.ts`).
 */
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import FormSheetView, { type CellMark } from "./FormSheetView";
import { fitScale, pageRule } from "./printSheet";
import type { FormCellValues, FormSheet } from "./types";

export default function SheetPrintView({
  sheet,
  values,
  cellMarks,
}: {
  sheet: FormSheet;
  values: FormCellValues;
  cellMarks?: Map<string, CellMark>;
}) {
  /*
   * 배율은 **그려 놓고 실제로 재서** 정한다. 파서가 읽은 줄 높이를 더해 쓰면 모자란다 —
   * 글자가 길어 줄바꿈된 칸은 엑셀에 적힌 높이보다 실제로 더 커지기 때문이다. 그래서 한 장에
   * 들어갈 줄 알았던 서류가 두 장으로 나갔다(QA-4.2-1: 적힌 합 1057px, 실제 1144px).
   */
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    element.style.zoom = "1"; // 잴 때는 원래 크기로 — 줄인 상태로 재면 배율이 겹쳐 곱해진다
    const box = element.getBoundingClientRect();
    element.style.zoom = String(fitScale(box.width, box.height, sheet.page));
  }, [sheet, values]);
  /*
   * 화면에서는 `display: none` 이 아니라 **화면 밖에** 둔다. 감춰 두면 표 높이가 0 으로 재어져
   * 인쇄할 때 내용이 잘려 빈 종이가 나갔다(실제로 그랬다). 자리만 차지하지 않게 absolute 로 뺀다.
   */
  const css = `
@media screen { #sheet-print { position: absolute; left: -20000px; top: 0; } }
@media print {
  /* 브라우저가 주는 바깥 여백·최소 높이가 남으면 빈 장이 한 장 더 나간다. */
  html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #fff !important; }
  body > *:not(#sheet-print) { display: none !important; }
  #sheet-print { position: static; break-after: avoid; page-break-after: avoid; }
  /* 화면용 가로 스크롤 상자가 인쇄에서는 내용을 자른다. */
  #sheet-print div { overflow: visible !important; }
  /* 배경색·테두리색이 빠지면 표가 흰 종이에 선만 남는다. */
  #sheet-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${pageRule(sheet.page)}
}`;

  return createPortal(
    <div id="sheet-print">
      <style>{css}</style>
      {/*
        줄이기는 `zoom` 으로 한다(배율은 바로 위 useLayoutEffect 가 재서 넣는다). 화면에서 쓰는
        transform 은 **보이기만 작아지고 차지하는 자리는 그대로**여서, 종이 한 장에 들어갈 표가
        두 장으로 넘어갔다(빈 둘째 장이 나갔다).
      */}
      <div ref={contentRef}>
        <FormSheetView sheet={sheet} editable={false} values={values} tint={false} cellMarks={cellMarks} scale={1} />
      </div>
    </div>,
    document.body,
  );
}
