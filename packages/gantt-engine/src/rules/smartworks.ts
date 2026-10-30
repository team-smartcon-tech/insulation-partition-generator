// 스마트웍스(DCR) 옵션마감 「동/라인 설정」 → 공정표 동 목록 (2026-10-30, 설정 탭 「스마트웍스에서 불러오기」).
// 스마트웍스에는 라인(호 라인)별 세대 층만 있고 코어 구분이 없다.
// 규칙 (2026-10-30 사용자 확인): **코어 1개 = 세대 2개(라인 2개)** — 1·2호 = 1코어, 3·4호 = 2코어, 5·6호 = 3코어.
// 코어 높이 = 두 세대 중 높은 쪽 (5호 21층·6호 17층이면 그 코어는 21층). 라인 수가 홀수면 마지막 라인 혼자 1코어.
//   예: 화성남양1차 101동 라인 18,18,21,21,17,16 → 코어 18·21·17

/** 라인별 최고층(라인 순서대로) → 코어별 최상층. linesPerCore 기본 2 */
export function groupLinesToCores(lineTops: number[], linesPerCore = 2): number[] {
  const cores: number[] = []
  for (let i = 0; i < lineTops.length; i += linesPerCore) cores.push(Math.max(...lineTops.slice(i, i + linesPerCore)))
  return cores
}

/** "501동" → 501, 숫자가 없으면 null */
export function buildingNoOf(name: string): number | null {
  const m = /(\d{2,4})/.exec(name)
  return m ? Number(m[1]) : null
}
