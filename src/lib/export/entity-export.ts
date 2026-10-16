// 고른 엔티티 하나가 내보내는 파일의 어디에 어떻게 남나 — TTL 블록·그 엔티티를 가리키는 줄·GeoJSON feature.
//
// 화면의 "내보내면" 칸(components/editor/ExportLines.vue)이 쓴다. 새로 만드는 것이 아니라 내보내기(modelToTTL·modelToGeoJSON)의
// 결과를 받는 쪽 규칙(read-ttl.ts)으로 다시 읽어 엔티티 단위로 나눈 것이라, 칸에 보이는 줄은 [TTL]·[GeoJSON] 단추가 내리는 파일과 같다.
// 받는 쪽(ieum-pipeline ttl.go)이 읽는 술어와 버리는 술어를 여기서 가른다 — 읽는 것은 클래스·rdfs:label·관계 넷뿐이다(read-ttl.ts).
import type { Feature, FeatureCollection } from './geojson'
import { readOntologyTTL, unescapeTurtle, type OntologyEntity } from './read-ttl'

/** 받는 쪽이 읽는 관계 술어. 목적어가 다른 엔티티다. */
export const RELATIONS = ['hasLocation', 'feeds', 'hasPart', 'hasPoint'] as const
export type Relation = (typeof RELATIONS)[number]

export type ExportIndex = {
  /** 받는 쪽이 읽는 주어(키 = 이스케이프를 푼 id = GeoJSON feature id). */
  read: Map<string, OntologyEntity>
  /** 주어 블록은 있지만 받는 쪽이 읽지 않는 것(`fso:` 덕트·배관). */
  unread: Map<string, { cls: string; source: string }>
  /** 목적어 → 그 목적어를 가리키는 (주어, 술어). 받는 쪽이 읽는 블록만 센다 — 버려지는 블록의 관계는 받는 쪽 그래프에 없다. */
  incoming: Map<string, { from: string; predicate: Relation }[]>
  /** feature id → 층 파일 이름과 feature. */
  features: Map<string, { fileName: string; feature: Feature }>
}

export function exportIndex(ttl: string, geo: readonly { fileName: string; collection: FeatureCollection }[]): ExportIndex {
  const reading = readOntologyTTL(ttl)
  const read = new Map(reading.entities.map((e) => [e.key, e]))
  const unread = new Map(reading.unread.map((u) => [u.key, { cls: u.cls, source: u.source }]))
  const incoming = new Map<string, { from: string; predicate: Relation }[]>()
  const push = (to: string, from: string, predicate: Relation) => {
    const list = incoming.get(to)
    if (list) list.push({ from, predicate })
    else incoming.set(to, [{ from, predicate }])
  }
  for (const e of reading.entities) {
    for (const to of e.locations) push(to, e.key, 'hasLocation')
    for (const to of e.feeds) push(to, e.key, 'feeds')
    for (const to of e.parts) push(to, e.key, 'hasPart')
    for (const to of e.points) push(to, e.key, 'hasPoint')
  }
  const features = new Map<string, { fileName: string; feature: Feature }>()
  for (const { fileName, collection } of geo) for (const f of collection.features) features.set(f.id, { fileName, feature: f })
  return { read, unread, incoming, features }
}

/** 주어 블록 하나의 절. 세미콜론으로 나뉘되 문자열 안의 것은 건너뛴다(이름에 `;` 가 들 수 있다). 끝의 마침표는 뗀다. */
export function clauses(source: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted && c === '\\') {
      cur += c + (source[++i] ?? '')
      continue
    }
    if (c === '"') quoted = !quoted
    if (c === ';' && !quoted) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim().replace(/\s*\.$/, ''))
  return out.map((s) => s.replace(/\s+/g, ' ')).filter(Boolean)
}

export type EntityExport = {
  id: string
  /**
   * `read` — TTL 에 나가고 받는 쪽이 읽는다. `unread` — TTL 에 나가지만 받는 쪽이 블록째 버린다(`fso:`).
   * `absent` — TTL 에 없다(벽·문·창·룸·공간 오브젝트처럼 Brick 에 자리가 없는 것은 GeoJSON 에만 있다).
   */
  ttl: 'read' | 'unread' | 'absent'
  /** 접두사 붙은 클래스(`brick:Fan`, `fso:Segment`). */
  cls: string | null
  label: string | null
  /** 이 블록의 관계. 받는 쪽이 읽는다. */
  out: { predicate: Relation; to: string[] }[]
  /** 이 블록의 다른 절(rdfs:label·관계 밖). 받는 쪽은 버린다. 절 원문 그대로. */
  dropped: string[]
  /** 이 엔티티를 가리키는 다른 주어. 술어별로 묶는다. */
  incoming: { predicate: Relation; from: string[] }[]
  /** 블록 원문. 없으면 null. */
  source: string | null
  feature: { fileName: string; feature: Feature } | null
}

const REL_PREFIX = new Map(RELATIONS.map((r) => [`brick:${r}`, r]))

export function entityExport(index: ExportIndex, id: string): EntityExport {
  const e = index.read.get(id)
  const u = e ? undefined : index.unread.get(id)
  const source = e?.source ?? u?.source ?? null
  const dropped: string[] = []
  if (source) {
    // 첫 절은 `ex:X a 클래스` 다. 관계·이름 절은 위 칸이 따로 보이므로, 받는 쪽이 버리는 절만 남긴다.
    for (const c of clauses(source).slice(1)) {
      const pred = c.split(' ')[0]
      if (pred === 'rdfs:label') continue
      if (e && REL_PREFIX.has(pred)) continue
      dropped.push(c)
    }
  }
  const out: EntityExport['out'] = e
    ? ([
        ['hasLocation', e.locations],
        ['feeds', e.feeds],
        ['hasPart', e.parts],
        ['hasPoint', e.points],
      ] as const)
        .filter(([, to]) => to.length > 0)
        .map(([predicate, to]) => ({ predicate, to: [...to] }))
    : []
  const byPred = new Map<Relation, string[]>()
  for (const x of index.incoming.get(id) ?? []) byPred.set(x.predicate, [...(byPred.get(x.predicate) ?? []), x.from])
  const cls = e ? `${e.ns}:${e.cls}` : (u?.cls ?? null)
  const label = e ? e.label || null : u ? labelOf(u.source) : null
  return {
    id,
    ttl: e ? 'read' : u ? 'unread' : 'absent',
    cls,
    label,
    out,
    dropped,
    incoming: RELATIONS.filter((p) => byPred.has(p)).map((predicate) => ({ predicate, from: byPred.get(predicate)! })),
    source,
    feature: index.features.get(id) ?? null,
  }
}

const LABEL = /rdfs:label\s+"((?:[^"\\]|\\.)*)"/
function labelOf(source: string): string | null {
  const m = LABEL.exec(source)
  return m ? unescapeTurtle(m[1]) : null
}

/** 다른 엔티티를 이름으로 보일 때. 받는 쪽이 읽는 주어면 그 rdfs:label, 아니면 GeoJSON 의 name, 그것도 없으면 id. */
export function nameIn(index: ExportIndex, id: string): string {
  const e = index.read.get(id)
  if (e?.label) return e.label
  const u = index.unread.get(id)
  const l = u ? labelOf(u.source) : null
  if (l) return l
  const name = index.features.get(id)?.feature.properties.name
  return typeof name === 'string' && name ? name : id
}
