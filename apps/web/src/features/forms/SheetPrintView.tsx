/**
 * 인쇄용 화면 — 복합기로 뽑을 때만 보이는 시트 한 장.
 *
 * 화면에 보이는 시트를 그대로 인쇄하면 헤더·목록·단추까지 함께 나오고, 화면 배율("가로 맞춤")이
 * 종이 폭과 달라 잘린다. 그래서 **인쇄할 때만** 문서 맨 끝에 시트를 한 번 더 그리고, 나머지는
 * 감춘다. 용지·방향·여백은 엑셀에 적힌 값을 쓰고, 표는 종이 폭에 맞춰 줄인다(`printSheet.ts`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FormSheetView, { type CellMark } from "./FormSheetView";
import {
  excelScale,
  footerMarginMm,
  headerOffsetMm,
  isEmptyHeaderFooter,
  pageRule,
  parseHeaderFooter,
  printableSizePx,
  type HeaderFooterParts,
} from "./printSheet";
import type { FormCellValues, FormSheet } from "./types";

/**
 * 줄 높이를 **엑셀에 적힌 값으로 고정한다.**
 *
 * HTML 표에서 줄 높이는 "최소 높이"라, 글자가 길어 줄바꿈되면 줄이 그만큼 늘어난다. 브라우저의
 * 글꼴 폭이 엑셀과 미세하게 달라 같은 글자도 한 줄 더 접히는 일이 잦고, 그래서 엑셀에서 한 장인
 * 서류가 웹에서는 두 장으로 나갔다(QA-4.2-1: 적힌 합 1057px → 실제 1144px).
 *
 * 엑셀은 줄 높이를 늘리지 않고 **넘치는 글자를 잘라서** 찍는다. 같게 맞추려면 칸 안의 내용을
 * 자리에서 떼어 내(absolute) 줄 높이에 영향을 주지 않게 하고, 넘치면 잘라야 한다.
 * 화면용 시트는 그대로 두고 **인쇄용 사본에만** 건다.
 */
function clampRowsToExcel(table: HTMLTableElement) {
  for (const cell of Array.from(table.querySelectorAll("td"))) {
    // 세로 정렬(가운데·아래)은 칸에 걸려 있는데, 떼어 낸 내용에는 듣지 않는다. 옮겨 준다.
    const valign = window.getComputedStyle(cell).verticalAlign;
    cell.style.position = "relative";
    for (const child of Array.from(cell.children) as HTMLElement[]) {
      // 도장·서명처럼 이미 자리에서 떼어 둔 것은 건드리지 않는다(자리가 어긋난다).
      if (window.getComputedStyle(child).position === "absolute") continue;
      child.style.position = "absolute";
      child.style.inset = "0";
      // 넘치는 글자를 자를지 말지는 **칸이 이미 알고 있다** — 옆 칸이 비어 넘겨 써도 되는 칸은
      // `overflow: visible` 이다(엑셀과 같은 규칙). 여기서 일률적으로 자르면 `ex) 현장코드 -
      // QM-1-AR-001 …` 같은 안내문이 첫 칸에서 잘려 나간다(실제로 그랬다).
      child.style.display = "flex";
      child.style.flexDirection = "column";
      child.style.justifyContent =
        valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
    }
  }
}

/**
 * 머리글·바닥글 한 줄. 엑셀은 왼쪽·가운데·오른쪽 세 자리에 나눠 찍는다.
 * 종이 여백 안쪽에 놓으려고 `position: fixed` 를 쓴다 — 크롬에서는 이것이 **장마다** 찍힌다.
 */
function HeaderFooterLine({ parts, className, style }: { parts: HeaderFooterParts; className: string; style: React.CSSProperties }) {
  const cell = (runs: HeaderFooterParts["left"], align: "left" | "center" | "right") => (
    // 엑셀은 바닥글을 **한 줄로** 찍는다(길면 옆자리와 겹칠 뿐 접지 않는다). 세 자리를 똑같이
    // 3등분하면 긴 안내문이 접혀 두 줄이 되고, 그만큼 종이 아래가 달라 보인다.
    <div style={{ flex: align === "center" ? 1 : "0 0 auto", textAlign: align, whiteSpace: "pre" }}>
      {runs.map((run, index) => (
        <span
          key={index}
          style={{
            fontSize: run.size ? `${run.size}pt` : undefined,
            fontWeight: run.bold ? 700 : undefined,
            fontStyle: run.italic ? "italic" : undefined,
            fontFamily: run.font,
          }}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
  return (
    <div className={className} style={{ display: "flex", alignItems: "flex-end", gap: "8px", ...style }}>
      {cell(parts.left, "left")}
      {cell(parts.center, "center")}
      {cell(parts.right, "right")}
    </div>
  );
}

export default function SheetPrintView({
  sheet,
  values,
  cellMarks,
}: {
  sheet: FormSheet;
  values: FormCellValues;
  cellMarks?: Map<string, CellMark>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  /** 몇 장으로 나갈지 — 바닥글의 쪽 번호(`&P`, `&N`)를 채우는 데 쓴다. */
  const [pages, setPages] = useState(1);
  useLayoutEffect(() => {
    const element = contentRef.current;
    const table = element?.querySelector("table");
    if (!element || !table) return;
    element.style.zoom = "1"; // 잴 때는 원래 크기로 — 줄인 상태로 재면 배율이 겹쳐 곱해진다
    clampRowsToExcel(table);
    const box = table.getBoundingClientRect();
    const scale = excelScale(sheet.page, { width: box.width, height: box.height });
    element.style.zoom = String(scale);
    const paper = printableSizePx(sheet.page);
    setPages(Math.max(1, Math.ceil((box.height * scale) / paper.height - 0.01)));
  }, [sheet, values, cellMarks]);

  const header = parseHeaderFooter(sheet.page?.header, { sheetName: sheet.name, pages });
  const footer = parseHeaderFooter(sheet.page?.footer, { sheetName: sheet.name, pages });
  /*
   * 화면에서는 `display: none` 이 아니라 **화면 밖에** 둔다. 감춰 두면 표 높이가 0 으로 재어져
   * 인쇄할 때 내용이 잘려 빈 종이가 나갔다(실제로 그랬다). 자리만 차지하지 않게 absolute 로 뺀다.
   */
  const css = `
@media screen { #sheet-print { position: absolute; left: -20000px; top: 0; } #sheet-print .sheet-print-head, #sheet-print .sheet-print-foot { display: none; } }
@media print {
  /* 브라우저가 주는 바깥 여백·최소 높이가 남으면 빈 장이 한 장 더 나간다. */
  html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #fff !important; }
  body > *:not(#sheet-print) { display: none !important; }
  #sheet-print { position: static; break-after: avoid; page-break-after: avoid; }
  /* 엑셀 [페이지 설정]의 "페이지 가운데 맞춤" — 켜진 양식은 종이 한가운데에 찍힌다. */
  #sheet-print .sheet-print-body { display: flex; ${sheet.page?.horizontalCentered ? "justify-content: center;" : ""} ${sheet.page?.verticalCentered ? `min-height: ${Math.round(printableSizePx(sheet.page).height)}px; align-items: center;` : ""} }
  /* 화면용 가로 스크롤 상자가 인쇄에서는 내용을 자른다. */
  #sheet-print div { overflow: visible !important; }
  /* 엑셀은 줄 가운데를 자르지 않는다 — 넘치면 줄 경계에서 다음 장으로 넘긴다. */
  #sheet-print tr, #sheet-print td { break-inside: avoid; page-break-inside: avoid; }
  /*
   * 머리글·바닥글은 종이 여백 안쪽에 찍힌다(엑셀과 같은 자리). position: fixed 라서 장마다 반복된다.
   * 화면에서는 보일 필요가 없다.
   */
  #sheet-print .sheet-print-head, #sheet-print .sheet-print-foot {
    position: fixed; left: 0; right: 0; color: #000;
    font-family: "Malgun Gothic", "맑은 고딕", sans-serif; font-size: 9pt; line-height: 1.2;
  }
  /* 배경색·테두리색이 빠지면 표가 흰 종이에 선만 남는다. */
  #sheet-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${pageRule(sheet.page, isEmptyHeaderFooter(footer) ? {} : { bottomMm: footerMarginMm(sheet.page) })}
}`;

  return createPortal(
    <div id="sheet-print">
      <style>{css}</style>
      {/*
        줄이기는 `zoom` 으로 한다(배율은 위 useLayoutEffect 가 재서 넣는다). 화면에서 쓰는
        transform 은 **보이기만 작아지고 차지하는 자리는 그대로**여서, 종이 한 장에 들어갈 표가
        두 장으로 넘어갔다(빈 둘째 장이 나갔다).
      */}
      <div className="sheet-print-body">
        <div ref={contentRef}>
          <FormSheetView sheet={sheet} editable={false} values={values} tint={false} cellMarks={cellMarks} scale={1} />
        </div>
      </div>
      {!isEmptyHeaderFooter(header) && (
        <HeaderFooterLine parts={header} className="sheet-print-head" style={{ top: `${headerOffsetMm(sheet.page)}mm` }} />
      )}
      {!isEmptyHeaderFooter(footer) && (
        <HeaderFooterLine parts={footer} className="sheet-print-foot" style={{ bottom: 0 }} />
      )}
    </div>,
    document.body,
  );
}
