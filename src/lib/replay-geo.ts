// 편집 리플레이(PoC)의 GeoJSON 쪽. 한 편집이 층 파일(floor-*.geojson)의 어느 feature 를 어떻게 바꿨는지를 **내보내기와 같은
// 함수(storeyToGeoJSON)로 만든 실제 feature** 로 견준다. 장면 옆에 그 feature 의 JSON 이 어느 줄에서 바뀌는지와, 그 자리의
// 작은 평면(주변 물리존·벽·설비 점)을 띄운다. 숫자는 화면에서 읽히게 소수 셋째 자리까지만 적는다 — 파일에는 원래 값이 그대로 간다.

import { storeyToGeoJSON, type Feature, type Geometry } from './export/geojson'
import type { Model } from './model'
import { verticalLinks } from './vertical'

export type GeoLine = { text: string; kind: 'same' | 'add' | 'del' | 'gap' }
export type GeoFeatureChange = {
  id: string
  name: string
  /** properties.kind (space·equipment·wall·door …). */
  kind: string
  status: 'added' | 'removed' | 'changed'
  lines: GeoLine[]
  before: Geometry | null
  after: Geometry | null
}
/** 작은 평면. 좌표는 IFC 평면(m), view 는 [minX, minY, maxX, maxY]. */
export type GeoMap = {
  view: [number, number, number, number]
  spaces: number[][][]
  walls: number[][][]
  points: number[][]
  /** 주인공 말고도 좌표가 옮겨 간 점 feature(따라온 배관 등)의 [전, 후]. */
  moves: [number[], number[]][]
}
export type GeoDiff = {
  file: string
  storeyId: string
  /** 앞의 것이 주인공이다(설비·물리존 먼저, 따라온 배관은 뒤). */
  features: GeoFeatureChange[]
  count: { changed: number; added: number; removed: number }
  map: GeoMap | null
}

/** 층 하나의 feature 를 id 로. */
export function storeyFeatures(model: Model, storeyId: string): Map<string, Feature> {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return new Map()
  const collection = storeyToGeoJSON(storey, model.hvac?.zones ?? [], verticalLinks(model))
  return new Map(collection.features.map((f) => [f.id, f]))
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000))
const point = (p: number[]) => `[${p.map(num).join(', ')}]`
const value = (v: unknown) => {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)) ?? 'null'
  return s.length > 54 ? `${s.slice(0, 52)}…` : s
}

/** feature 를 사람이 읽는 JSON 줄로. 점 좌표는 한 줄, 다각형은 꼭짓점마다 한 줄이라 바뀐 꼭짓점이 줄로 갈린다. */
export function formatFeature(f: Feature): string[] {
  const out = ['{', '  "type": "Feature",', `  "id": ${value(f.id)},`]
  const g = f.geometry
  if (!g) out.push('  "geometry": null,')
  // 좌표는 따로 한 줄에 둔다. 패널 폭에서 잘리지 않고, 옮긴 설비는 이 줄 하나가 바뀐다.
  else if (g.type === 'Point') out.push('  "geometry": {', '    "type": "Point",', `    "coordinates": ${point(g.coordinates)}`, '  },')
  else {
    out.push('  "geometry": {', `    "type": "${g.type}",`, '    "coordinates": [')
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const polygon of polygons) for (const ring of polygon) {
      out.push('      [')
      for (const p of ring) out.push(`        ${point(p)},`)
      out.push('      ],')
    }
    out.push('    ]', '  },')
  }
  out.push('  "properties": {')
  for (const [k, v] of Object.entries(f.properties)) out.push(`    "${k}": ${value(v)},`)
  out.push('  }', '}')
  return out
}

/** 줄 단위 차이(LCS). 바뀌지 않은 줄이 길게 이어지면 앞뒤 두 줄만 두고 접는다. */
export function diffLines(a: string[], b: string[], context = 2): GeoLine[] {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const raw: GeoLine[] = []
  let i = 0
  let j = 0
  // 같으면 지운 줄을 먼저 둔다(− 다음 +). 같은 자리의 줄이 바뀌었으면 둘이 붙는다.
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ text: a[i++], kind: 'same' })
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) raw.push({ text: a[i++], kind: 'del' })
    else raw.push({ text: b[j++], kind: 'add' })
  }
  while (i < n) raw.push({ text: a[i++], kind: 'del' })
  while (j < m) raw.push({ text: b[j++], kind: 'add' })
  const near = raw.map((_, x) => raw.slice(Math.max(0, x - context), x + context + 1).some((l) => l.kind !== 'same'))
  const out: GeoLine[] = []
  raw.forEach((l, x) => {
    if (l.kind !== 'same' || near[x]) out.push(l)
    else if (out[out.length - 1]?.kind !== 'gap') out.push({ text: '…', kind: 'gap' })
  })
  return out
}

const ringsOf = (g: Geometry | null): number[][][] =>
  !g ? [] : g.type === 'Point' ? [] : g.type === 'Polygon' ? g.coordinates.slice(0, 1) : g.coordinates.map((p) => p[0])
const pointsOf = (g: Geometry | null): number[][] => (!g ? [] : g.type === 'Point' ? [g.coordinates] : ringsOf(g).flat())
const r2 = (p: number[]) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]

function boxOf(points: number[][]): [number, number, number, number] | null {
  if (!points.length) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}
const meets = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** 바뀐 feature 둘레의 평면. 최소 14m 폭으로, 주변의 물리존·벽·설비 점을 함께. */
function mapAround(after: Map<string, Feature>, main: GeoFeatureChange[], moves: [number[], number[]][], moved: ReadonlySet<string>): GeoMap | null {
  const box = boxOf(main.flatMap((f) => [...pointsOf(f.before), ...pointsOf(f.after)]))
  if (!box) return null
  const cx = (box[0] + box[2]) / 2
  const cy = (box[1] + box[3]) / 2
  // 패널의 평면 칸 모양(가로:세로 ≈ 2.6)에 맞춘다.
  const ASPECT = 2.6
  const half = Math.max(7, (box[2] - box[0]) * 0.65, (box[3] - box[1]) * 0.65 * ASPECT)
  const view: [number, number, number, number] = [cx - half, cy - half / ASPECT, cx + half, cy + half / ASPECT]
  const spaces: number[][][] = []
  const walls: number[][][] = []
  const points: number[][] = []
  const shown = new Set([...main.map((f) => f.id), ...moved])
  for (const f of after.values()) {
    if (shown.has(f.id) || !f.geometry) continue
    const kind = f.properties.kind
    if (f.geometry.type === 'Point') {
      const [x, y] = f.geometry.coordinates
      if (kind === 'equipment' && points.length < 400 && x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3]) points.push(r2([x, y]))
      continue
    }
    const list = kind === 'space' ? spaces : kind === 'wall' ? walls : null
    if (!list || list.length >= 160) continue
    for (const ring of ringsOf(f.geometry)) {
      const b = boxOf(ring)
      if (b && meets(b, view)) list.push(ring.map(r2))
    }
  }
  return { view, spaces, walls, points, moves: moves.map(([a, b]) => [r2(a), r2(b)]) }
}

/**
 * 한 층의 두 상태를 견준다. `rank` 는 id 의 무게(작을수록 앞) — 평면 변화의 순서를 따라 고른 설비·물리존이 앞에, 따라온 배관이
 * 뒤에 온다. JSON 줄은 앞의 셋만 만든다.
 */
export function diffGeo(file: string, storeyId: string, before: Map<string, Feature>, after: Map<string, Feature>, rank: (id: string) => number): GeoDiff | null {
  const ids: string[] = []
  const count = { changed: 0, added: 0, removed: 0 }
  for (const [id, f] of after) {
    const b = before.get(id)
    if (!b) count.added++
    else if (JSON.stringify(b) !== JSON.stringify(f)) count.changed++
    else continue
    ids.push(id)
  }
  for (const id of before.keys()) {
    if (after.has(id)) continue
    count.removed++
    ids.push(id)
  }
  if (!ids.length) return null
  ids.sort((x, y) => rank(x) - rank(y))
  const features = ids.slice(0, 3).map((id): GeoFeatureChange => {
    const b = before.get(id) ?? null
    const a = after.get(id) ?? null
    const f = (a ?? b)!
    return {
      id,
      name: String(f.properties.name ?? id),
      kind: String(f.properties.kind ?? ''),
      status: !b ? 'added' : !a ? 'removed' : 'changed',
      lines: diffLines(b ? formatFeature(b) : [], a ? formatFeature(a) : [], 3).slice(0, 60),
      before: b?.geometry ?? null,
      after: a?.geometry ?? null,
    }
  })
  const moves: [number[], number[]][] = []
  const moved = new Set<string>()
  for (const id of ids.slice(1)) {
    const a = after.get(id)?.geometry
    const b = before.get(id)?.geometry
    if (a?.type !== 'Point' || b?.type !== 'Point' || moves.length >= 60) continue
    moves.push([b.coordinates, a.coordinates])
    moved.add(id)
  }
  return { file, storeyId, features, count, map: mapAround(after, features.slice(0, 1), moves, moved) }
}
