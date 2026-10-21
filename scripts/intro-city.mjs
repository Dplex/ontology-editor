// 인트로 앞머리(public/intro/prologue.js)가 날아 들어가는 동네를 OpenStreetMap 에서 받아 public/intro/city/<이름>.json 으로 굽는다.
//
//   node scripts/intro-city.mjs seongsu [--cache=<폴더>]
//
// --cache 를 주면 Overpass 응답을 그 폴더(ways.json·rels.json·minor.json)에 남기고, 있으면 다시 받지 않는다. 숫자 손질만 고쳐 다시 구울 때 쓴다.
//
// 건물 외곽선·높이, 강·공원, 길(큰 길·다리와 골목)만 남기고 좌표는 주인공 건물 가운데를 원점으로 한 미터(x 동쪽, y 북쪽)로 바꾼다.
// 고객사 BIM 이 아니라 공개 지도라 커밋한다. OSM 은 ODbL 이라 화면에 "© OpenStreetMap contributors" 를 적는다(prologue.js).
// 높이가 적힌 건물은 1/6 남짓이다. 나머지는 쓰임새·바닥 넓이로 정하고, 건물 번호로 흔들어 같은 값이 다시 나오게 한다.
// 다시 구울 일은 동네를 넓히거나 OSM 이 크게 바뀌었을 때뿐이다. Overpass 공개 서버가 자주 붐벼서 미러를 차례로 두드린다.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLACES = {
  // 팩토리얼 성수(연무장7길 13, 지상 10층). OSM 에는 옛 이름 "예진상사 물류센터" 로 올라 있다.
  // 남쪽 한강 위에서 출발해 북쪽으로 날아가므로, 강 건너 압구정·청담까지 담는다.
  seongsu: { bbox: [37.518, 127.025, 37.558, 127.078], hero: 564869565, heroName: '팩토리얼 성수', rivers: [152336, 16259781], parks: [17338887, 14528902, 16142677, 2525498] },
}

const MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']

// Node 의 fetch 는 이 PC 에서 밖으로 나가지 못했다(ETIMEDOUT, curl 은 된다). 사내망의 프록시 설정도 curl 쪽에 있으므로 curl 로 받는다.
function overpass(query) {
  for (let round = 0; round < 3; round++) {
    for (const url of MIRRORS) {
      try {
        const text = execFileSync('curl', ['-s', '-m', '180', '-A', 'ontology-editor-intro/0.1', '-H', 'Accept: application/json', '--data-urlencode', `data=${query}`, url], { maxBuffer: 1 << 28 }).toString()
        if (text.trimStart().startsWith('{')) return JSON.parse(text)
        console.warn(`${url}: ${text.slice(0, 80).replace(/\s+/g, ' ')}`)
      } catch (e) {
        console.warn(`${url}: ${e.message}`)
      }
      execFileSync('sleep', [String(3 * (round + 1))])
    }
  }
  throw new Error('Overpass 미러가 모두 응답하지 않습니다. 잠시 뒤 다시 돌립니다.')
}

function cached(file, query) {
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const json = overpass(query)
  if (file) mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, JSON.stringify(json))
  return json
}

const name = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'seongsu'
const cache = process.argv.find((a) => a.startsWith('--cache='))?.slice('--cache='.length)
const P = PLACES[name]
if (!P) throw new Error(`모르는 동네: ${name} (${Object.keys(PLACES).join(', ')})`)
const B = P.bbox.join(',')
// 길 등급. 번호가 화면의 폭·밝기·차 불빛을 정한다(prologue.js 의 ROAD_W). 앞 넷은 큰 길, 뒤 넷은 골목이다.
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary']
const MINOR = ['tertiary', 'residential', 'unclassified', 'living_street']

const ways = cached(cache && join(cache, 'ways.json'), `[out:json][timeout:170][bbox:${B}];(way["building"];way["natural"="water"];way["leisure"="park"];way["highway"~"^(motorway|trunk|primary|secondary)$"];);out geom(${B}) tags;`)
// 골목은 따로 받는다. 큰 길과 한 질의로 묶으면 응답이 커져 공개 서버가 시간을 넘긴다. 밤 장면에서 골목 가로등이 동네의 결을 만든다.
const minor = cached(cache && join(cache, 'minor.json'), `[out:json][timeout:170][bbox:${B}];way["highway"~"^(${MINOR.join('|')})$"];out geom(${B}) tags;`)
const rels = cached(cache && join(cache, 'rels.json'), `[out:json][timeout:170];relation(id:${[...P.rivers, ...P.parks].join(',')});out body geom(${B});`)

// ---------------------------------------------------------------- 좌표: 주인공 건물 가운데를 원점으로 한 미터
const heroWay = ways.elements.find((e) => e.id === P.hero)
if (!heroWay) throw new Error(`주인공 건물(way ${P.hero})이 범위 안에 없습니다`)
const lat0 = heroWay.geometry.reduce((a, p) => a + p.lat, 0) / heroWay.geometry.length
const lon0 = heroWay.geometry.reduce((a, p) => a + p.lon, 0) / heroWay.geometry.length
const KX = 111320 * Math.cos((lat0 * Math.PI) / 180)
const KY = 110540
const xy = (p) => [(p.lon - lon0) * KX, (p.lat - lat0) * KY]

/** 0.6m 안쪽으로 굽은 점을 덜어 낸다(Douglas–Peucker). */
function simplify(pts, tol = 0.6) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const L = Math.hypot(bx - ax, by - ay) || 1
    let far = -1, d = tol
    for (let i = a + 1; i < b; i++) {
      const di = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L
      if (di > d) (d = di), (far = i)
    }
    if (far > 0) (keep[far] = 1), stack.push([a, far], [far, b])
  }
  return pts.filter((_, i) => keep[i])
}
const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)])
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y }, 0)) / 2
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const rand = (id) => { let h = id >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }

/** 높이: height → 층수 × 3.4m → 쓰임새·바닥 넓이로 정한 값. 마지막 것은 지어낸 값이라 따로 센다. */
let guessed = 0
function heightOf(e, a) {
  const t = e.tags
  const h = num(t.height) || num(t['building:levels']) * 3.4
  if (h) return h
  guessed++
  const r = rand(e.id)
  switch (t.building) {
    case 'apartments': return 30 + r * 25
    case 'house': case 'detached': return 6 + r * 4
    case 'industrial': case 'warehouse': return 8 + r * 6
    default: return a < 120 ? 6 + r * 6 : a < 500 ? 10 + r * 12 : 14 + r * 20
  }
}

const buildings = []
const roads = []
const waters = []
const parks = []
let hero = -1
for (const e of [...ways.elements, ...minor.elements]) {
  const g = e.geometry ?? []
  const t = e.tags ?? {}
  if (t.building) {
    // 범위 밖으로 걸친 건물은 잘린 외곽선이 된다. 버린다.
    if (g.length < 4 || g.some((p) => !p)) continue
    const pts = simplify(g.slice(0, -1).map(xy))
    const a = area(pts)
    if (pts.length < 3 || a < 25) continue
    if (e.id === P.hero) hero = buildings.length
    buildings.push([Math.round(heightOf(e, a) * 2) / 2, ...flat(pts)])
  } else if (t.highway) {
    const k = [...MAJOR, ...MINOR].indexOf(t.highway)
    if (k < 0) continue
    const runs = [[]]
    for (const p of g) p ? runs.at(-1).push(xy(p)) : runs.at(-1).length && runs.push([])
    for (const r of runs) if (r.length > 1) roads.push([k, t.bridge === 'yes' ? 1 : 0, ...flat(simplify(r, 1.5))])
  } else if (t.natural === 'water' || t.leisure === 'park') {
    const pts = g.filter(Boolean).map(xy)
    if (pts.length > 2) (t.natural === 'water' ? waters : parks).push(flat(simplify(pts, 1)))
  }
}
// 강·큰 공원은 범위를 넘는 다각형이라 범위 안 점만 남는다. 범위 밖 구간은 테두리를 따라 이어지므로 남은 점을 차례로 이으면 범위 안 몫이 된다.
for (const e of rels.elements) {
  const out = P.rivers.includes(e.id) ? waters : parks
  for (const m of e.members ?? []) {
    if (m.role !== 'outer') continue
    const pts = (m.geometry ?? []).filter(Boolean).map(xy)
    if (pts.length > 2) out.push(flat(simplify(pts, 1.5)))
  }
}
if (hero < 0) throw new Error('주인공 건물을 거르다 잃었습니다')

const [s, w, n, eLon] = P.bbox
const city = {
  name,
  hero,
  heroName: P.heroName,
  origin: [Math.round(lat0 * 1e6) / 1e6, Math.round(lon0 * 1e6) / 1e6],
  extent: [...xy({ lat: s, lon: w }).map(Math.round), ...xy({ lat: n, lon: eLon }).map(Math.round)],
  attribution: '© OpenStreetMap contributors (ODbL)',
  fetchedAt: ways.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
  buildings,
  waters,
  parks,
  roads,
}
const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'public', 'intro', 'city', `${name}.json`)
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, JSON.stringify(city))
console.log(`${name}: 건물 ${buildings.length}(높이 지어냄 ${guessed}) · 물 ${waters.length} · 공원 ${parks.length} · 길 ${roads.length} → ${file} (${(JSON.stringify(city).length / 1024).toFixed(0)}KB)`)
