/**
 * DXF 원본 텍스트 편집 연산 — 소스 라인 범위 기반.
 *
 * rw-dxf-engine-ts 파서가 각 엔티티의 원본 라인 범위(startLine~endLine, 1-based)를
 * 보존해 주므로, 편집을 "해당 라인 범위만 수정/삭제"로 구현한다.
 * 이렇게 하면 편집하지 않은 나머지 도면 데이터(지원하지 않는 특수 엔티티,
 * 헤더/테이블/블록 정의 포함)가 바이트 단위로 보존된다.
 *
 * ASCII DXF 는 "그룹코드 라인 + 값 라인" 2줄 쌍의 연속이며,
 * 엔티티 범위는 항상 쌍 경계에 정렬된다.
 */

/** 엔티티의 소스 라인 범위 (1-based, 양끝 포함) */
export interface DxfLineRange {
  startLine: number;
  endLine: number;
}

/** 좌표 이동 대상 그룹코드 — X(10~13) / Y(20~23). 공통 2D 엔티티의 모든 정점·중심·정렬점 커버 */
const X_CODES = new Set([10, 11, 12, 13]);
const Y_CODES = new Set([20, 21, 22, 23]);

function splitDxfLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

/** 부동소수 오차 없이 사람이 읽을 수 있는 좌표 문자열로 (소수 8자리 반올림) */
function formatCoord(v: number): string {
  return String(Math.round(v * 1e8) / 1e8);
}

/** 엔티티(들)를 원본에서 제거. 뒤 범위부터 지워 라인 번호 시프트를 피한다. */
export function deleteEntitiesFromDxf(
  text: string,
  ranges: DxfLineRange[]
): string {
  const { lines, eol } = splitDxfLines(text);
  const sorted = [...ranges].sort((a, b) => b.startLine - a.startLine);
  for (const r of sorted) {
    lines.splice(r.startLine - 1, r.endLine - r.startLine + 1);
  }
  return lines.join(eol);
}

/** 엔티티를 (dx, dy) 만큼 평행이동 — 범위 내 X/Y 그룹코드 값만 갱신 */
export function translateEntityInDxf(
  text: string,
  range: DxfLineRange,
  dx: number,
  dy: number
): string {
  const { lines, eol } = splitDxfLines(text);
  // startLine 은 엔티티의 "0" 그룹코드 라인 — 쌍 단위(코드, 값)로 순회
  for (
    let i = range.startLine - 1;
    i < range.endLine && i + 1 < lines.length;
    i += 2
  ) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    const isX = X_CODES.has(code);
    const isY = Y_CODES.has(code);
    if (!isX && !isY) continue;
    const v = Number.parseFloat(lines[i + 1]);
    if (!Number.isFinite(v)) continue;
    lines[i + 1] = formatCoord(isX ? v + dx : v + dy);
  }
  return lines.join(eol);
}
