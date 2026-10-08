// 편집 리플레이(PoC). 되돌리기 이력을 처음부터 다시 틀어 "사람이 BIM 을 어떻게 고쳤나" 를 장면으로 보여 준다.
//
// **모델을 다시 편집하지 않는다.** 이력의 스냅숏(편집 전 상태)을 모델 사본에 거꾸로 되돌려 연 때로 간 다음, 다시 하기와 같은
// 방식(snapshotOf → restore)으로 한 단계씩 앞으로 간다. 그래서 장면의 상태는 되돌리기·다시 하기가 보장하는 상태 그대로다.
// 사본은 모델과 스냅숏을 **한 번에** 복사해야 한다 — 스냅숏이 모델 안의 객체(물리존·설비·연결)를 그대로 들고 있어서, 따로
// 복사하면 사본 위의 restore 가 화면의 모델을 고친다. 워커로 넘기는 postMessage 가 그 한 번의 복사다(replay.worker.ts).
//
// 단계마다 남기는 것은 평면에서 바뀐 것(전·후), 그 층 TTL 에서 바뀐 줄, GeoJSON 쪽 좌표 변화다. "어디에 남느냐" 를 같이 본다.

import { restore, snapshotOf, type Snapshot } from './edit'
import { geoFileNames, type Feature } from './export/geojson'
import { modelToTTL } from './export/ttl'
import { diffGeo, storeyFeatures, type GeoDiff } from './replay-geo'
import { isConduit, type Model, type Vec2 } from './model'

export type ReplayEntry = { label: string; time: number; snapshot: Snapshot }
export type ReplayInput = { model: Model; entries: ReplayEntry[] }

/** 연결의 흐름 방향을 누가 정했나. 평면에 화살표 색으로 갈린다. */
export type LinkDir = 'none' | 'bim' | 'edit' | 'rule' | 'confirmed'

export type PlanItem =
  | { t: 'space'; key: string; storeyId: string; id: string; name: string; ring: Vec2[]; area: number }
  | { t: 'wall'; key: string; storeyId: string; id: string; rings: Vec2[][]; bearing: boolean | null; external: boolean | null }
  | { t: 'opening'; key: string; storeyId: string; id: string; kind: 'door' | 'window'; at: Vec2 | null }
  | {
      t: 'equip'
      key: string
      storeyId: string
      id: string
      name: string
      at: Vec2 | null
      kind: string | null
      conduit: boolean
      spaceId: string | null
      systemId: string | null
    }
  | { t: 'link'; key: string; storeyId: string; a: Vec2; b: Vec2; dir: LinkDir }
  | { t: 'zone'; key: string; storeyId: string; id: string; name: string; ring: Vec2[]; zone: 'custom' | 'room' | 'object' }

export type PlanChange = { key: string; before: PlanItem | null; after: PlanItem | null }

/** TTL 한 블록(주어 하나)에서 바뀐 줄. 끝의 `;`·`.` 는 떼고 견준다 — 줄이 늘면 앞 줄의 `.` 가 `;` 로 바뀌어 가짜 차이가 된다. */
export type TtlChange = { subject: string; added: string[]; removed: string[] }

export type ReplayStep = {
  index: number
  label: string
  time: number
  category: Category
  /** 평면이 바뀐 층. 첫 층에 시점을 맞춘다. */
  storeyIds: string[]
  changes: PlanChange[]
  ttl: TtlChange[]
  ttlCount: { added: number; removed: number }
  /** GeoJSON 쪽(좌표·경계)에서 바뀐 것을 사람 말로. TTL 에는 좌표가 없어서, 방 안에서 옮긴 설비는 여기에만 남는다. */
  geo: string[]
  /** 층 파일(floor-*.geojson)에서 실제로 바뀐 feature 와 그 둘레 평면. GeoJSON 이 그대로인 편집(흐름 방향 등)은 null. */
  geojson: GeoDiff | null
}

export type ReplayStart = {
  building: string
  storeys: { id: string; name: string; elevation: number }[]
  plan: PlanItem[]
  total: number
}

export type ReplayMessage =
  | { type: 'start'; start: ReplayStart }
  | { type: 'step'; step: ReplayStep }
  | { type: 'done'; ms: number }
  | { type: 'error'; message: string }

export const CATEGORIES = ['설비 배치', '설비 추가·삭제', '설비 종류', '물리존', '벽·문·창', '연결', '흐름 방향', '계통', '공간 오브젝트'] as const
export type Category = (typeof CATEGORIES)[number]
/** 장면 카드·시간줄·3D 빛기둥이 같이 쓰는 갈래 색. 어두운 극장 바탕에서 읽히는 밝은 색이다. */
export const CATEGORY_COLOR: Record<Category, string> = {
  '설비 배치': '#4fd1ff',
  '설비 추가·삭제': '#5ef2c2',
  '설비 종류': '#b39dff',
  물리존: '#ffd166',
  '벽·문·창': '#f4a261',
  연결: '#7bdff2',
  '흐름 방향': '#ff9f6e',
  계통: '#ef8fd0',
  '공간 오브젝트': '#a3e635',
}

export function categoryOf(s: Snapshot): Category {
  switch (s.kind) {
    case 'equipment':
      return '설비 배치'
    case 'equipment-set':
      return '설비 추가·삭제'
    case 'kinds':
      return '설비 종류'
    case 'space':
    case 'storey-spaces':
      return '물리존'
    case 'storey-elements':
      return '벽·문·창'
    case 'connection':
    case 'release':
      return '연결'
    case 'flow':
    case 'confirm':
    case 'rule-state':
      return '흐름 방향'
    case 'systems':
      return '계통'
    case 'custom-zones':
    case 'rooms':
    case 'space-objects':
      return '공간 오브젝트'
    case 'many':
      return s.parts.length ? categoryOf(s.parts[0]) : '설비 배치'
  }
}

const xy = (p: readonly number[] | null | undefined): Vec2 | null => (p ? [p[0], p[1]] : null)

function linkDir(c: Model['connections'][number]): { from: string; to: string; dir: LinkDir } {
  if (c.directed) return { from: c.from, to: c.to, dir: 'bim' }
  if (c.edited) return { from: c.edited.from, to: c.edited.to, dir: 'edit' }
  if (c.inferred) return { from: c.inferred.from, to: c.inferred.to, dir: c.inferred.confirmed && c.inferred.recheck === undefined ? 'confirmed' : 'rule' }
  return { from: c.from, to: c.to, dir: 'none' }
}

/** 모델 전체의 평면. 열쇠는 종류와 id 이고, 연결은 두 끝이다(같은 두 끝이 또 있으면 순번을 붙인다). */
export function planOf(model: Model): Map<string, PlanItem> {
  const out = new Map<string, PlanItem>()
  const where = new Map<string, { storeyId: string; at: Vec2 | null }>()
  for (const storey of model.storeys) {
    const sid = storey.id
    for (const s of storey.spaces) {
      out.set(`sp:${s.id}`, { t: 'space', key: `sp:${s.id}`, storeyId: sid, id: s.id, name: s.longName || s.name, ring: s.footprint, area: s.areaM2 })
    }
    for (const w of storey.walls) {
      if (!w.footprint?.length) continue
      out.set(`wl:${w.id}`, { t: 'wall', key: `wl:${w.id}`, storeyId: sid, id: w.id, rings: w.footprint, bearing: w.loadBearing, external: w.external ?? null })
    }
    for (const o of storey.openings) {
      out.set(`op:${o.id}`, { t: 'opening', key: `op:${o.id}`, storeyId: sid, id: o.id, kind: o.kind, at: xy(o.position) })
    }
    for (const e of storey.equipment) {
      const at = xy(e.position)
      where.set(e.id, { storeyId: sid, at })
      out.set(`eq:${e.id}`, {
        t: 'equip',
        key: `eq:${e.id}`,
        storeyId: sid,
        id: e.id,
        name: e.name,
        at,
        kind: e.kind ?? null,
        conduit: isConduit(e.role),
        spaceId: e.spaceId,
        systemId: e.systemId ?? null,
      })
    }
    for (const z of storey.customZones ?? []) {
      out.set(`cz:${z.id}`, { t: 'zone', key: `cz:${z.id}`, storeyId: sid, id: z.id, name: z.name, ring: z.footprint, zone: 'custom' })
    }
    for (const r of storey.rooms ?? []) {
      out.set(`rm:${r.id}`, { t: 'zone', key: `rm:${r.id}`, storeyId: sid, id: r.id, name: r.name, ring: r.footprint, zone: 'room' })
    }
    for (const o of storey.spaceObjects ?? []) {
      const [x, y] = o.at
      const [w, d] = [o.size[0] / 2, o.size[1] / 2]
      const ring: Vec2[] = [[x - w, y - d], [x + w, y - d], [x + w, y + d], [x - w, y + d], [x - w, y - d]]
      out.set(`so:${o.id}`, { t: 'zone', key: `so:${o.id}`, storeyId: sid, id: o.id, name: o.name, ring, zone: 'object' })
    }
  }
  const seen = new Map<string, number>()
  for (const c of model.connections) {
    const { from, to, dir } = linkDir(c)
    const a = where.get(from)
    const b = where.get(to)
    if (!a?.at || !b?.at) continue
    const base = `cn:${c.from}>${c.to}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const key = n ? `${base}#${n}` : base
    out.set(key, { t: 'link', key, storeyId: a.storeyId, a: a.at, b: b.at, dir })
  }
  return out
}

/** 값으로 같은가. 평면 항목은 숫자·글자·배열뿐이라 JSON 으로 견준다. */
const same = (a: PlanItem, b: PlanItem) => a === b || JSON.stringify(a) === JSON.stringify(b)

export function diffPlan(before: Map<string, PlanItem>, after: Map<string, PlanItem>): PlanChange[] {
  const out: PlanChange[] = []
  for (const [key, b] of before) {
    const a = after.get(key)
    if (!a) out.push({ key, before: b, after: null })
    else if (!same(a, b)) out.push({ key, before: b, after: a })
  }
  for (const [key, a] of after) if (!before.has(key)) out.push({ key, before: null, after: a })
  return out
}

/** TTL 을 주어별 줄 묶음으로. 접두어 줄은 뺀다. */
export function ttlBlocks(ttl: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let cur: string[] | null = null
  for (const raw of ttl.split('\n')) {
    if (!raw.trim()) {
      cur = null
      continue
    }
    if (raw.startsWith('@prefix')) continue
    const line = raw.trim().replace(/\s*[;.]$/, '')
    if (!/^\s/.test(raw)) {
      const subject = line.split(/\s+/)[0]
      cur = out.get(subject) ?? []
      out.set(subject, cur)
    }
    cur?.push(line)
  }
  return out
}

export function diffTtl(before: Map<string, string[]>, after: Map<string, string[]>): TtlChange[] {
  const out: TtlChange[] = []
  const subjects = new Set([...before.keys(), ...after.keys()])
  for (const subject of subjects) {
    const b = before.get(subject) ?? []
    const a = after.get(subject) ?? []
    const left = new Map<string, number>()
    for (const l of b) left.set(l, (left.get(l) ?? 0) + 1)
    const added: string[] = []
    for (const l of a) {
      const n = left.get(l) ?? 0
      if (n > 0) left.set(l, n - 1)
      else added.push(l)
    }
    const removed = [...left].flatMap(([l, n]) => Array<string>(n).fill(l))
    if (added.length || removed.length) out.push({ subject, added, removed })
  }
  return out
}

const fmt = (v: number) => v.toFixed(2)
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

function geoLines(changes: PlanChange[]): string[] {
  const out: string[] = []
  for (const { before: b, after: a } of changes) {
    const item = a ?? b!
    if (item.t === 'link' || item.t === 'opening') continue
    if (item.t === 'equip') {
      if (item.conduit) continue
      const pb = b?.t === 'equip' ? b.at : null
      const pa = a?.t === 'equip' ? a.at : null
      if (!b) out.push(`+ ${item.name} 점 (${pa ? `${fmt(pa[0])}, ${fmt(pa[1])}` : '좌표 없음'})`)
      else if (!a) out.push(`− ${item.name} 점`)
      else if (pb && pa && dist(pb, pa) > 1e-6) out.push(`${item.name} (${fmt(pb[0])}, ${fmt(pb[1])}) → (${fmt(pa[0])}, ${fmt(pa[1])}) · ${fmt(dist(pb, pa))} m`)
    } else if (item.t === 'space') {
      const ab = b?.t === 'space' ? b.area : 0
      const aa = a?.t === 'space' ? a.area : 0
      if (!b) out.push(`+ ${item.name} 경계 ${fmt(aa)} m²`)
      else if (!a) out.push(`− ${item.name} 경계`)
      else if (JSON.stringify(b.t === 'space' && b.ring) !== JSON.stringify(a.t === 'space' && a.ring)) out.push(`${item.name} 경계 ${fmt(ab)} → ${fmt(aa)} m²`)
    } else if (item.t === 'wall') {
      if (!b) out.push(`+ 벽 ${item.id.slice(0, 10)}`)
      else if (!a) out.push(`− 벽 ${item.id.slice(0, 10)}`)
      else if (JSON.stringify(b.t === 'wall' && b.rings) !== JSON.stringify(a.t === 'wall' && a.rings)) out.push(`벽 ${item.id.slice(0, 10)} 외곽선`)
    } else if (item.t === 'zone') {
      out.push(`${!b ? '+ ' : !a ? '− ' : ''}${item.name} 외곽선`)
    }
    if (out.length >= 6) break
  }
  return out
}

/**
 * 한 층의 TTL 을 주어별로. 같은 상태(version)의 같은 층은 한 번만 쓴다 — 이어진 편집이 같은 층이면 앞 단계의 "후" 가 다음의
 * "전" 이다. **모델이 그 version 일 때만 부른다**(없는 것을 지금 모델로 채우므로).
 */
function ttlCache(model: Model) {
  const cache = new Map<string, { ttl: Map<string, string[]>; geo: Map<string, Feature> }>()
  const key = (storeyId: string, version: number) => `${version}|${storeyId}`
  const state = (storeyId: string, version: number) => {
    let hit = cache.get(key(storeyId, version))
    if (!hit) cache.set(key(storeyId, version), (hit = { ttl: ttlBlocks(modelToTTL(model, { storeyId })), geo: storeyFeatures(model, storeyId) }))
    return hit
  }
  return {
    has: (storeyId: string, version: number) => cache.has(key(storeyId, version)),
    get: (storeyId: string, version: number) => state(storeyId, version).ttl,
    /** 같은 상태의 층 GeoJSON feature(id → feature). TTL 과 같이 떠 둔다. */
    geo: (storeyId: string, version: number) => state(storeyId, version).geo,
    /** 지난 상태의 것은 다시 안 쓴다. */
    drop(before: number) {
      for (const k of cache.keys()) if (Number(k.split('|')[0]) < before) cache.delete(k)
    },
  }
}

/** TTL 을 함께 보는 층 수. 계통 확정처럼 여러 층을 한꺼번에 바꾸는 편집에서 층마다 TTL 을 쓰면 오래 걸린다. */
const TTL_STOREYS = 3
const TTL_SUBJECTS = 40
const TTL_LINES = 8

/**
 * 이력을 장면으로 만든다. `input.model` 을 **고친다** — 사본이어야 한다(워커가 받은 것). 단계마다 `emit` 으로 바로 내보내
 * 화면이 앞 단계부터 틀 수 있게 한다.
 */
export function buildReplay(input: ReplayInput, emit: (m: ReplayMessage) => void): void {
  const t0 = Date.now()
  const { model, entries } = input
  // 거꾸로: 단계마다 "후" 상태를 떠 두고 "전" 으로 되돌린다. 끝나면 모델은 이력의 첫 편집 전이다.
  const after: (Snapshot | null)[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    after[i] = snapshotOf(model, entries[i].snapshot)
    restore(model, entries[i].snapshot)
  }
  let plan = planOf(model)
  emit({
    type: 'start',
    start: {
      building: model.buildingName,
      storeys: model.storeys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
      plan: [...plan.values()],
      total: entries.length,
    },
  })
  const ttlOf = ttlCache(model)
  const files = geoFileNames(model)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const done = after[i]
    if (done) restore(model, done)
    const next = planOf(model)
    const changes = diffPlan(plan, next)
    plan = next
    const storeyIds = [...new Set(changes.map((c) => (c.after ?? c.before)!.storeyId))]
    // 평면이 그대로인 편집(이름 없는 계통 바꾸기 같은 것)은 첫 층을 본다.
    const ttlStoreys = (storeyIds.length ? storeyIds : model.storeys.slice(0, 1).map((s) => s.id)).slice(0, TTL_STOREYS)
    // 어느 층이 바뀌는지는 편집을 놓은 뒤에야 안다. 앞 단계에서 떠 두지 않은 층의 "전" 은 한 번 되돌려서 뜨고 다시 놓는다
    // (되돌리기·다시 하기와 같은 한 쌍이다).
    const missing = ttlStoreys.filter((sid) => !ttlOf.has(sid, i))
    if (missing.length && done) {
      restore(model, entry.snapshot)
      for (const sid of missing) ttlOf.get(sid, i)
      restore(model, done)
    }
    const ttl: TtlChange[] = []
    for (const sid of ttlStoreys) ttl.push(...diffTtl(ttlOf.get(sid, i), ttlOf.get(sid, i + 1)))
    // GeoJSON: 평면 변화 순서대로 무게를 매겨 고른 설비·물리존이 앞에 오게 한다. 따라온 배관은 뒤로.
    const rank = new Map<string, number>()
    changes.forEach((c, n) => {
      const it = (c.after ?? c.before)!
      if (it.t !== 'link' && !rank.has(it.id)) rank.set(it.id, it.t === 'equip' && it.conduit ? 1000 + n : n)
    })
    let geojson: GeoDiff | null = null
    for (const sid of ttlStoreys) {
      const d = diffGeo(files.get(sid) ?? `${sid}.geojson`, sid, ttlOf.geo(sid, i), ttlOf.geo(sid, i + 1), (id) => rank.get(id) ?? 500)
      if (!d) continue
      if (!geojson) geojson = d
      else for (const k of ['changed', 'added', 'removed'] as const) geojson.count[k] += d.count[k]
    }
    ttlOf.drop(i + 1)
    const ttlCount = ttl.reduce((n, c) => ({ added: n.added + c.added.length, removed: n.removed + c.removed.length }), { added: 0, removed: 0 })
    emit({
      type: 'step',
      step: {
        index: i,
        label: entry.label,
        time: entry.time,
        category: categoryOf(entry.snapshot),
        storeyIds,
        changes,
        ttl: ttl.slice(0, TTL_SUBJECTS).map((c) => ({ subject: c.subject, added: c.added.slice(0, TTL_LINES), removed: c.removed.slice(0, TTL_LINES) })),
        ttlCount,
        geo: geoLines(changes),
        geojson,
      },
    })
  }
  emit({ type: 'done', ms: Date.now() - t0 })
}
