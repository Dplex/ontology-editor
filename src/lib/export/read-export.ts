// 내보낸 두 파일(GeoJSON 기하 + Brick TTL 의미)을 다시 읽어 **서로 이어지는지** 본다. 내보낸 파일 뷰어(viewer.html)와
// check:sample 이 쓴다. 두 파일은 id 하나로만 이어진다(geojson.ts·ttl.ts 머리말) — 한쪽에만 있는 id, 가리키는데 없는
// 주어, GeoJSON 의 소속과 TTL 의 hasLocation 이 다른 것을 센다. 읽는 쪽이 이 둘을 같이 쓰므로, 어긋나면 지도에서 누른
// 방이 온톨로지에 없거나 그 반대가 된다.

import type { OntologyEntity, TtlReading } from './read-ttl'

export type ReadFeature = {
  type: 'Feature'
  id: string
  geometry: { type: string; coordinates: unknown } | null
  properties: Record<string, unknown> & { kind?: string; name?: string }
}

export type ExportFloor = {
  fileName: string
  features: ReadFeature[]
  /** RFC 7946 모양 문제. 비면 맞다. */
  problems: string[]
}

/**
 * RFC 7946 의 모양 규칙. 위치는 숫자 2~3개, 고리는 닫히고 네 점 이상, 선은 두 점 이상. Feature 는 geometry(null 가능)·properties 를
 * 갖고 id 는 문자열·숫자다. 좌표계(WGS84)와 고리 방향(바깥 반시계)은 명세가 "SHOULD" 라 보지 않는다 — 건물 로컬 미터를 쓴다
 * (geojson.ts 머리말).
 */
export function geojsonProblems(fc: unknown): string[] {
  const c = fc as { type?: unknown; features?: unknown }
  if (!c || c.type !== 'FeatureCollection' || !Array.isArray(c.features)) return ['FeatureCollection 이 아니다']
  const problems: string[] = []
  const position = (p: unknown) => Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
  const ring = (r: unknown) =>
    Array.isArray(r) && r.length >= 4 && r.every(position) && (r[0] as number[]).every((n, i) => n === (r[r.length - 1] as number[])[i])
  const polygon = (p: unknown) => Array.isArray(p) && p.length >= 1 && p.every(ring)
  const ids = new Set<unknown>()
  for (const f of c.features as { type?: unknown; id?: unknown; geometry?: unknown; properties?: unknown }[]) {
    const where = String(f?.id)
    if (f?.type !== 'Feature') problems.push(`${where}: type ${String(f?.type)}`)
    if (typeof f?.id !== 'string' && typeof f?.id !== 'number') problems.push(`${where}: id 없음`)
    if (ids.has(f?.id)) problems.push(`${where}: id 겹침`)
    ids.add(f?.id)
    if (f?.properties !== null && (typeof f?.properties !== 'object' || Array.isArray(f?.properties))) problems.push(`${where}: properties`)
    const g = f?.geometry as { type: string; coordinates: unknown } | null | undefined
    if (g === undefined) problems.push(`${where}: geometry 없음`)
    if (!g) continue
    const ok =
      g.type === 'Point'
        ? position(g.coordinates)
        : g.type === 'LineString'
          ? Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(position)
          : g.type === 'Polygon'
            ? polygon(g.coordinates)
            : g.type === 'MultiPolygon'
              ? Array.isArray(g.coordinates) && g.coordinates.every(polygon)
              : false
    if (!ok) problems.push(`${where}: ${g.type} 좌표 모양`)
  }
  return problems
}

/** 층 파일 하나를 읽는다. JSON 이 아니면 문제 하나로 돌려준다(뷰어가 멈추지 않게). */
export function readGeoJSON(fileName: string, text: string): ExportFloor {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { fileName, features: [], problems: [`JSON 이 아니다: ${e instanceof Error ? e.message : String(e)}`] }
  }
  const problems = geojsonProblems(parsed)
  const features = Array.isArray((parsed as { features?: unknown })?.features)
    ? ((parsed as { features: ReadFeature[] }).features.map((f) => ({ ...f, id: String(f.id), properties: f.properties ?? {} })) as ReadFeature[])
    : []
  return { fileName, features, problems }
}

/** TTL 에 같은 id 의 주어가 있어야 하는 feature. 벽·문·창은 GeoJSON 에만 있다(Brick 에 건축 부재가 없다). */
const IN_TTL = new Set(['space', 'equipment', 'customZone', 'hvacZone'])

export type ExportCheck = {
  /** GeoJSON 에 있는데 TTL 에 주어가 없는 feature. */
  notInTtl: { id: string; kind: string; fileName: string }[]
  /** 받는 쪽이 읽는 주어가 가리키는데 TTL 어디에도 주어가 없는 것. */
  dangling: { from: string; predicate: 'feeds' | 'hasLocation' | 'hasPart' | 'hasPoint'; to: string }[]
  /** 가리키는 주어가 있지만 받는 쪽이 읽지 않는 것(fso: 덕트·배관). 계통의 hasPart 가 대부분이고, 일부러다(ttl.ts classOf). */
  toUnread: number
  /** GeoJSON 설비의 spaceId 가 TTL 의 hasLocation 에 없다. 지도와 온톨로지가 다른 방을 말한다. */
  locationMismatch: { id: string; geojson: string; ttl: string[] }[]
  /** 문의 connects 가 가리키는 방이 TTL 에 없다. */
  doorLinks: { id: string; to: string }[]
}

export function crossCheck(ttl: TtlReading, floors: readonly ExportFloor[]): ExportCheck {
  const byKey = new Map<string, OntologyEntity>(ttl.entities.map((e) => [e.key, e]))
  const unread = new Set(ttl.unread.map((u) => u.key))
  const known = (id: string) => byKey.has(id) || unread.has(id)

  const notInTtl: ExportCheck['notInTtl'] = []
  const locationMismatch: ExportCheck['locationMismatch'] = []
  const doorLinks: ExportCheck['doorLinks'] = []
  for (const floor of floors) {
    for (const f of floor.features) {
      const kind = String(f.properties.kind ?? '')
      if (IN_TTL.has(kind) && !known(f.id)) notInTtl.push({ id: f.id, kind, fileName: floor.fileName })
      const spaceId = f.properties.spaceId
      const entity = byKey.get(f.id)
      if (kind === 'equipment' && typeof spaceId === 'string' && entity && !entity.locations.includes(spaceId))
        locationMismatch.push({ id: f.id, geojson: spaceId, ttl: entity.locations })
      if (kind === 'door' && Array.isArray(f.properties.connects))
        for (const to of f.properties.connects as string[]) if (!byKey.has(to)) doorLinks.push({ id: f.id, to })
    }
  }

  const dangling: ExportCheck['dangling'] = []
  let toUnread = 0
  for (const e of ttl.entities) {
    for (const [predicate, targets] of [
      ['feeds', e.feeds],
      ['hasLocation', e.locations],
      ['hasPart', e.parts],
      ['hasPoint', e.points],
    ] as const) {
      for (const to of targets) {
        if (byKey.has(to)) continue
        if (unread.has(to)) toUnread++
        else dangling.push({ from: e.key, predicate, to })
      }
    }
  }
  return { notInTtl, dangling, toUnread, locationMismatch, doorLinks }
}
