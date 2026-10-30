// 스마트웍스(DCR) 옵션마감 「동/라인 설정」 → 공정표 동 목록 (2026-10-30, 설정 탭 「스마트웍스에서 불러오기」).
// 스마트웍스에는 라인(호 라인)별 세대 층만 있고 코어 구분이 없다.
// 규칙 (2026-10-30 사용자 확인): **코어 1개 = 세대 2개(라인 2개)** — 1·2호 = 1코어, 3·4호 = 2코어, 5·6호 = 3코어.
// 코어 높이 = 두 세대 중 높은 쪽 (5호 21층·6호 17층이면 그 코어는 21층).
// 한 층 3세대 이하 동은 코어 1개, 5세대 동은 코어 2개(3+2 또는 2+3). 7세대 이상 홀수는 미확인 — 마지막 라인 혼자 1코어.
//   예: 화성남양1차 101동 라인 18,18,21,21,17,16 → 코어 18·21·17

/** 라인별 최고층(라인 순서대로) → 코어별 최상층. linesPerCore 기본 2 */
export function groupLinesToCores(lineTops: number[], linesPerCore = 2): number[] {
  // 5세대 동은 코어 2개 (2026-10-30 사용자 확인). 3+2 / 2+3 중 묶음 안 높이가 더 고른 쪽 — 같으면 3+2
  //   남원주 1차 401동 42,42,42|37,37 → 42·37, 402동 37,37|42,42,42 → 37·42 (직접 입력값과 같음)
  // 한 층 3세대 이하 동은 코어 1개 (2026-10-30 사용자 확인: 남원주 1차 405동 3세대 = 1코어)
  if (lineTops.length > 0 && lineTops.length <= 3) return [Math.max(...lineTops)]
  if (lineTops.length === 5) {
    const spread = (g: number[]) => Math.max(...g) - Math.min(...g)
    const a = [lineTops.slice(0, 3), lineTops.slice(3)]
    const b = [lineTops.slice(0, 2), lineTops.slice(2)]
    const pick = spread(b[0]) + spread(b[1]) < spread(a[0]) + spread(a[1]) ? b : a
    return pick.map((g) => Math.max(...g))
  }
  const cores: number[] = []
  for (let i = 0; i < lineTops.length; i += linesPerCore) cores.push(Math.max(...lineTops.slice(i, i + linesPerCore)))
  return cores
}

/** "501동" → 501, 숫자가 없으면 null */
export function buildingNoOf(name: string): number | null {
  const m = /(\d{2,4})/.exec(name)
  return m ? Number(m[1]) : null
}
