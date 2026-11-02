// 한중(寒中) 기간 표 만들기 — 스마트웍스(dcr-app) 날씨 API(`/api/weather/kma`, 기상청 격자 일 최저·최고)로
// 현장 격자마다 최근 10겨울(10/15~4/15)의 날짜별 평균((최저+최고)/2)을 내고, 7일 이동평균이 4℃ 이하인 기간과
// 순(旬)별 평균을 src/climate/kma-cold-normals.ts 로 쓴다. 고른 현장만, 한 번만 돌린다(스마트웍스 기상청 사용량을 쓴다).
//
//   set -a; . apps/worker/.dev.vars; set +a     # DCR_SUPABASE_URL / DCR_SUPABASE_SERVICE_ROLE_KEY (현장 좌표, 읽기 전용)
//   node packages/gantt-engine/scripts/build-cold-normals.ts "남원주역세권 1차" "부산장안" [--winters 10]
//
// 받은 날씨는 OS 임시 폴더(ipg-cold-cache)에 격자별로 남겨 끊겨도 이어 받는다. 계산 결과는 scripts/cold-normals.data.json 에
// 쌓아(현장 추가 때 기존 것 유지) 그 전체로 .ts 를 다시 만든다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEATHER = "https://dcr-app.jogh.workers.dev/api/weather/kma"
const THRESHOLD = 4
const CONCURRENCY = 4
/** 10/15 ~ 4/15 만 받는다 (4℃ 경계가 이 밖에 있는 곳은 없다) */
const SEASON_FROM = "10-15"
const SEASON_TO = "04-15"

const argv = process.argv.slice(2)
const wIdx = argv.indexOf("--winters")
const WINTERS = wIdx >= 0 ? Number(argv[wIdx + 1]) : 10
const names = argv.filter((a, i) => !a.startsWith("--") && !(wIdx >= 0 && i === wIdx + 1))
if (!names.length) {
  console.error('현장 이름을 주세요. 예: node .../build-cold-normals.ts "남원주역세권 1차" "부산장안"')
  process.exit(1)
}
const DCR_URL = process.env.DCR_SUPABASE_URL
const DCR_KEY = process.env.DCR_SUPABASE_SERVICE_ROLE_KEY
if (!DCR_URL || !DCR_KEY) {
  console.error("DCR_SUPABASE_URL / DCR_SUPABASE_SERVICE_ROLE_KEY 가 없습니다 (apps/worker/.dev.vars).")
  process.exit(1)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, "cold-normals.data.json")
const OUT = join(HERE, "..", "src", "climate", "kma-cold-normals.ts")
const CACHE = join(tmpdir(), "ipg-cold-cache")
mkdirSync(CACHE, { recursive: true })

// ─── 위경도 → 기상청 동네예보 격자 (Lambert 정각원추, 5km) ─────────────────────
function toGrid(lat: number, lon: number): { x: number; y: number } {
  const RE = 6371.00877 / 5.0
  const d = Math.PI / 180
  const slat1 = 30 * d, slat2 = 60 * d, olon = 126 * d, olat = 38 * d
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn)
  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + lat * d * 0.5), sn)
  let theta = lon * d - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn
  return { x: Math.floor(ra * Math.sin(theta) + 43 + 0.5), y: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) }
}
const seoul = toGrid(37.5665, 126.978)
if (seoul.x !== 60 || seoul.y !== 127) throw new Error(`격자 변환 확인 실패: 서울 ${seoul.x},${seoul.y} (60,127 이어야 함)`)

// ─── 현장 좌표 (스마트웍스, 읽기 전용) ───────────────────────────────────────
type DcrSite = { id: string; name: string; latitude: number | null; longitude: number | null }
const res = await fetch(`${DCR_URL}/rest/v1/sites?select=id,name,latitude,longitude`, {
  headers: { apikey: DCR_KEY, Authorization: `Bearer ${DCR_KEY}` },
})
if (!res.ok) throw new Error(`스마트웍스 현장 조회 실패 ${res.status}`)
const allSites = (await res.json()) as DcrSite[]
const picked = names.map((n) => {
  const hit = allSites.filter((s) => s.name.includes(n))
  if (hit.length !== 1) throw new Error(`「${n}」 에 맞는 현장이 ${hit.length}곳입니다: ${hit.map((s) => s.name).join(", ")}`)
  const s = hit[0]
  if (s.latitude == null || s.longitude == null) throw new Error(`${s.name}: 스마트웍스에 좌표가 없습니다.`)
  return { ...s, lat: s.latitude, lon: s.longitude, ...toGrid(s.latitude, s.longitude) }
})

// ─── 날씨 받기 ────────────────────────────────────────────────────────────
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const lastWinterEnd = (() => {
  // 지난 4/15 (오늘이 4/15 전이면 작년 4/15)
  const now = new Date()
  const y = now.getUTCMonth() + 1 > 4 || (now.getUTCMonth() + 1 === 4 && now.getUTCDate() > 15) ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return y
})()
const dates: string[] = []
for (let y = lastWinterEnd - WINTERS; y < lastWinterEnd; y++) {
  for (let t = Date.parse(`${y}-${SEASON_FROM}T12:00:00Z`); t <= Date.parse(`${y + 1}-${SEASON_TO}T12:00:00Z`); t += 86_400_000) {
    const d = iso(t)
    if (!d.endsWith("02-29")) dates.push(d)
  }
}

type Day = [tmn: number, tmx: number] | null

async function fetchDay(x: number, y: number, date: string): Promise<Day> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${WEATHER}?gridX=${x}&gridY=${y}&date=${date}`)
      if (r.ok) {
        const j = (await r.json()) as { response?: { body?: { items?: { item?: { category: string; fcstValue: string }[] } } } }
        const items = j.response?.body?.items?.item ?? []
        const v = (c: string) => Number(items.find((i) => i.category === c)?.fcstValue)
        const tmn = v("TMN")
        const tmx = v("TMX")
        return Number.isFinite(tmn) && Number.isFinite(tmx) && tmn > -50 && tmx > -50 ? [tmn, tmx] : null
      }
      if (attempt >= 4) return null
    } catch {
      if (attempt >= 4) return null
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
}

async function gridDays(x: number, y: number): Promise<Record<string, Day>> {
  const file = join(CACHE, `grid_${x}_${y}.json`)
  const got: Record<string, Day> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const todo = dates.filter((d) => !(d in got))
  let done = 0
  const started = Date.now()
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        got[d] = await fetchDay(x, y, d)
        if (++done % 100 === 0 || done === todo.length) {
          writeFileSync(file, JSON.stringify(got))
          const sec = Math.round((Date.now() - started) / 1000)
          console.log(`  격자 ${x},${y}: ${done}/${todo.length} (${sec}s)`)
        }
      }
    }),
  )
  writeFileSync(file, JSON.stringify(got))
  return got
}

// ─── 계산 ──────────────────────────────────────────────────────────────────
const DAYS: string[] = []
for (let t = Date.UTC(2025, 0, 1); DAYS.length < 365; t += 86_400_000) DAYS.push(new Date(t).toISOString().slice(5, 10))
/** 시즌 순서(10/15 → 4/15)의 MM-DD */
const SEASON = [...DAYS.slice(DAYS.indexOf(SEASON_FROM)), ...DAYS.slice(0, DAYS.indexOf(SEASON_TO) + 1)]
const round1 = (v: number) => Math.round(v * 10) / 10
const MIN_YEARS = Math.max(3, Math.ceil(WINTERS * 0.6))

function compute(got: Record<string, Day>) {
  const byDay = new Map<string, number[]>()
  for (const [date, v] of Object.entries(got)) {
    if (!v) continue
    const k = date.slice(5)
    const list = byDay.get(k) ?? []
    list.push((v[0] + v[1]) / 2)
    byDay.set(k, list)
  }
  const mean = SEASON.map((k) => {
    const v = byDay.get(k) ?? []
    return v.length >= MIN_YEARS ? v.reduce((a, b) => a + b, 0) / v.length : NaN
  })
  const missing = mean.filter((v) => Number.isNaN(v)).length
  if (missing > 5) throw new Error(`날짜 ${missing}개가 비었습니다 — 다시 돌리면 빈 날만 받습니다.`)
  // 시즌 안 7일 이동평균 (양 끝은 있는 날만)
  const smooth = mean.map((_, i) => {
    const w = mean.slice(Math.max(0, i - 3), i + 4).filter((v) => !Number.isNaN(v))
    return w.reduce((a, b) => a + b, 0) / w.length
  })
  const first = smooth.findIndex((v) => v <= THRESHOLD)
  const last = smooth.length - 1 - [...smooth].reverse().findIndex((v) => v <= THRESHOLD)
  const start = first >= 0 ? SEASON[first] : null
  const end = first >= 0 ? SEASON[last] : null
  // 순 평균 36개 (시즌 밖이거나 5일 미만이면 null)
  const dekads: (number | null)[] = []
  for (let m = 1; m <= 12; m++) {
    for (const [a, b] of [[1, 10], [11, 20], [21, 31]] as const) {
      const v = SEASON.map((k, i) => [k, mean[i]] as const).filter(
        ([k, x]) => Number(k.slice(0, 2)) === m && Number(k.slice(3)) >= a && Number(k.slice(3)) <= b && !Number.isNaN(x),
      )
      dekads.push(v.length >= 5 ? round1(v.reduce((s, [, x]) => s + x, 0) / v.length) : null)
    }
  }
  return { start, end, minTemp: round1(Math.min(...smooth)), dekads }
}

// ─── 실행 ──────────────────────────────────────────────────────────────────
type Row = {
  id: number
  name: string
  lat: number
  lon: number
  ht: number
  start: string | null
  end: string | null
  minTemp: number
  dekads: (number | null)[]
  winters: string
}
const data: Row[] = existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : []
// 예: 2016/17~2025/26
const winters = `${lastWinterEnd - WINTERS}/${String(lastWinterEnd - WINTERS + 1).slice(2)}~${lastWinterEnd - 1}/${String(lastWinterEnd).slice(2)}`
console.log(`${WINTERS}겨울 (${winters}, ${SEASON_FROM}~${SEASON_TO}) 격자당 ${dates.length}일`)

const grids = new Map<string, typeof picked>()
for (const s of picked) grids.set(`${s.x},${s.y}`, [...(grids.get(`${s.x},${s.y}`) ?? []), s])
for (const [key, sites] of grids) {
  const [x, y] = key.split(",").map(Number)
  console.log(`격자 ${key} — ${sites.map((s) => s.name).join(", ")}`)
  const c = compute(await gridDays(x, y))
  const id = x * 1000 + y
  const row: Row = {
    id,
    name: sites.map((s) => s.name).join(" · "),
    lat: Math.round(sites[0].lat * 1e4) / 1e4,
    lon: Math.round(sites[0].lon * 1e4) / 1e4,
    ht: 0,
    ...c,
    winters,
  }
  const at = data.findIndex((r) => r.id === id)
  if (at >= 0) data[at] = row
  else data.push(row)
  console.log(`  → 4℃ 이하 ${c.start ?? "없음"} ~ ${c.end ?? ""}, 7일 평균 최저 ${c.minTemp}℃`)
}
data.sort((a, b) => a.name.localeCompare(b.name, "ko"))
writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n")

const body = data
  .map(
    (r) =>
      `  { id: ${r.id}, name: ${JSON.stringify(r.name)}, lat: ${r.lat}, lon: ${r.lon}, ht: ${r.ht}, winters: ${JSON.stringify(r.winters)}, ` +
      `start: ${JSON.stringify(r.start)}, end: ${JSON.stringify(r.end)}, minTemp: ${r.minTemp}, dekads: [${r.dekads.map((v) => (v == null ? "null" : v)).join(",")}] },`,
  )
  .join("\n")
writeFileSync(
  OUT,
  `// 자동 생성 — scripts/build-cold-normals.ts (원본 scripts/cold-normals.data.json). 손으로 고치지 않는다.
// 스마트웍스 날씨 API(기상청 5km 격자 일 최저·최고) 최근 ${WINTERS}겨울 10/15~4/15, 날짜별 (최저+최고)/2 평균 → 7일 이동평균 ${THRESHOLD}℃ 이하 기간.
// id = 격자 x*1000+y. start·end = "MM-DD"(연말을 넘는다), 내려가지 않으면 null. dekads = 순 평균 36개(시즌 밖 null).
import type { ColdStation } from "./cold-period.ts"

export const COLD_STATIONS: ColdStation[] = [
${body}
]
`,
)
console.log(`→ ${OUT} (${data.length}곳)`)
