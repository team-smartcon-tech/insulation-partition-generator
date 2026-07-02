/**
 * 입면도 생성기 — Output 통합 산출 다운로드(XLSX + DXF ZIP)
 *
 * - 통합 타일/보드 산출서(XLSX): 선택 범위의 규격별 합산 + 동·코어 소계
 * - 부위별/선택 입면 통합 DXF
 * - 둘을 jszip 으로 한 ZIP 에 묶어 다운로드
 */

import * as XLSX from "xlsx";
import JSZip from "jszip";
import type {
  ScopeTree,
  MergedSummary,
  BuildingNode,
} from "./elevationAggregate";

/** MergedSummary → 워크시트 행(AoA) */
function mergedToRows(merged: MergedSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["구분", "가로(mm)", "세로(mm)", "수량(조각)", "면적(㎡)"],
  ];
  for (const t of merged.tallies) {
    rows.push([
      t.remainder ? "절단" : "정척",
      t.w,
      t.h,
      t.count,
      +((t.w * t.h * t.count) / 1_000_000).toFixed(3),
    ]);
  }
  rows.push([
    "합계",
    "",
    "",
    merged.totalCount,
    +merged.totalAreaM2.toFixed(3),
  ]);
  rows.push(["주문 판 수", "", "", merged.orderBoardCount, ""]);
  if (merged.discardedCount > 0) {
    rows.push([
      "버림(폐기)",
      "",
      "",
      merged.discardedCount,
      +merged.discardedAreaM2.toFixed(3),
    ]);
  }
  return rows;
}

/**
 * 통합 산출 XLSX 생성.
 *  - '통합' 시트: 선택 범위 전체 합산
 *  - 동별 시트: 각 동의 합산(+코어 소계)
 */
export function buildQuantityXlsx(
  selectedMerged: MergedSummary,
  buildings: BuildingNode[],
  scopeLabel: string
): Uint8Array {
  const wb = XLSX.utils.book_new();

  // 통합 시트
  const head: (string | number)[][] = [
    [`통합 물량 요약 — ${scopeLabel}`],
    [],
    ...mergedToRows(selectedMerged),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(head),
    "통합"
  );

  // 동별 시트(코어 소계 포함)
  for (const b of buildings) {
    const rows: (string | number)[][] = [[`${b.building}`], []];
    for (const c of b.cores) {
      rows.push([`▸ ${c.core}`]);
      rows.push(...mergedToRows(c.merged));
      rows.push([]);
    }
    rows.push([`${b.building} 합계`]);
    rows.push(...mergedToRows(b.merged));
    const safe = b.building.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "동";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), safe);
  }

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** XLSX + DXF 를 ZIP 한 파일로 다운로드 */
export async function downloadOutputZip(args: {
  base: string;
  xlsx: Uint8Array;
  dxf?: string | null;
}): Promise<void> {
  const zip = new JSZip();
  zip.file(`${args.base}_통합산출서.xlsx`, args.xlsx);
  if (args.dxf) zip.file(`${args.base}_통합.dxf`, args.dxf);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${args.base}_산출.zip`, blob);
}

/** XLSX 단독 다운로드 */
export function downloadXlsx(filename: string, xlsx: Uint8Array): void {
  downloadBlob(
    filename,
    new Blob([xlsx], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}

export type { ScopeTree };
