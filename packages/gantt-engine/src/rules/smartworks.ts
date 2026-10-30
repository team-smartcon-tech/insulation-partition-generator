// 스마트웍스(DCR) 옵션마감 「동/라인 설정」 → 공정표 동 목록 (2026-10-30, 설정 탭 「스마트웍스에서 불러오기」).
// 스마트웍스에는 라인(호 라인)별 세대 층만 있고 코어 구분이 없다. 이웃한 라인끼리 최고층이 같으면 한 코어로 묶는다.
//   예: 501동 라인 최고층 35,35,39,39,37,37 → 코어 35·39·37 / 401동 42,42,42,37,37 → 코어 42·37
// 높이가 같은 코어가 이웃해 있으면 하나로 합쳐지지만, 공정 계산은 동 최상층·층별 종료만 쓰므로 영향이 없다.

/** 라인별 최고층(라인 순서대로) → 코어별 최상층 */
export function groupLinesToCores(lineTops: number[]): number[] {
  const cores: number[] = []
  for (const t of lineTops) if (cores.at(-1) !== t) cores.push(t)
  return cores
}

/** "501동" → 501, 숫자가 없으면 null */
export function buildingNoOf(name: string): number | null {
  const m = /(\d{2,4})/.exec(name)
  return m ? Number(m[1]) : null
}
