// 자동 생성 — scripts/build-cold-normals.ts (원본 scripts/cold-normals.data.json). 손으로 고치지 않는다.
// 스마트웍스 날씨 API(기상청 5km 격자 일 최저·최고) 최근 10겨울 10/15~4/15, 날짜별 (최저+최고)/2 평균 → 7일 이동평균 4℃ 이하 기간.
// id = 격자 x*1000+y. start·end = "MM-DD"(연말을 넘는다), 내려가지 않으면 null. dekads = 순 평균 36개(시즌 밖 null).
import type { ColdStation } from "./cold-period.ts"

export const COLD_STATIONS: ColdStation[] = [
  { id: 76122, name: "남원주역세권 1차(AC4) · 남원주역세권 2차(AC5)", lat: 37.3132, lon: 127.9189, ht: 0, winters: "2016/17~2025/26", start: "11-24", end: "03-04", minTemp: -3.9, dekads: [-3.2,-3.2,-3.3,-2.6,0.4,2.1,4.3,6.6,9.3,11,12.5,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,13.9,11.7,9.6,6.7,3.2,0.2,-2.1,-2.7] },
  { id: 101079, name: "부산장안(B1)", lat: 35.3219, lon: 129.2391, ht: 0, winters: "2016/17~2025/26", start: "01-09", end: "01-28", minTemp: 3.7, dekads: [4.5,4.8,4.1,4.4,6.8,7.7,8.9,10.7,12.5,13.7,14.7,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,18.3,16.9,15.5,13.2,10.8,7.6,5.8,4.9] },
]
