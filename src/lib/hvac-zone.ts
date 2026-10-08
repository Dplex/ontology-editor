// 수동 공조존(OE-ZON-01·02, OE-MAN-05, OE-OBJ-13). R1 에서 공조존을 만드는 유일한 길이다 — IDF 로 불러오는 것은 R2(OE-IDF·OE-ZON-03).
//
// 공조존은 HVAC 설비가 담당하는 구역이고 물리존과 따로인 체계(N:M)다. 계통도의 서비스 영역이다(glossary).
// - **담당 물리존은 사람이 정한 것이 1차 기준이다(OE-MAP-02).** 물리존을 골라 만들면 고른 물리존이 그대로 담당이고, 공조존 바닥은 그 물리존들의
//   합집합이다(OE-ZON-01).
// - **한 물리존을 나눌 때는 경계를 그린다(OE-ZON-02).** 그린 경계는 물리존 경계와 무관하고, 겹치는 물리존이 담당이다(물리존 ∩ 공조존, S3).
//   그래서 물리존 하나를 두 공조존으로 나눠 그리면 둘 다 그 물리존을 담당한다. IDF 공조존의 "절반 넘게 덮는 방" 기준(idf/attach.ts)과 다르다.
// - **담당 설비**는 사람이 고른다. TTL 에서 그 설비가 공조존을 `brick:feeds` 하고, 공조존은 담당 물리존을 `brick:hasPart` 한다.
// - 층마다 둔다(`Storey.hvacZones`, 커스텀존과 같다). IDF 공조존(`model.hvac.zones`)은 읽기만 하고 R2 에서 같은 도구로 보정한다.
// 설계 결정은 docs/adr/0026-manual-hvac-zones.md.

import { newId } from './edit'
import { isSelfIntersecting, pointInPolygon } from './mapping'
import { withInferred } from './flow-rules'
import { isAirSource, isAirTerminal } from './served'
import { polygonArea, type Connection, type HvacZone, type Model, type Storey, type Vec2 } from './model'
import { overlapArea, unionRings } from './polygon'

/** 그린 경계가 물리존과 이만큼 넘게 겹쳐야 그 물리존을 담당한다(㎡). 벽 두께 안에서 찍은 점이 이웃 방에 조금 들어가는 것은 세지 않는다. */
export const ZONE_OVERLAP_M2 = 0.05

/** 건물의 공조존 전부. IDF 로 불러온 것(R2)과 사람이 만든 것이다. 읽는 쪽(TTL·GeoJSON·화면)이 이 하나로 본다. */
export function hvacZonesOf(model: Model): HvacZone[] {
  return [...(model.hvac?.zones ?? []), ...model.storeys.flatMap((s) => s.hvacZones ?? [])]
}

/** 사람이 만든 공조존과 그 층. IDF 공조존은 찾지 않는다(고치지 않는다). */
export function findHvacZone(model: Model, id: string): { storey: Storey; zone: HvacZone; index: number } | null {
  for (const storey of model.storeys) {
    const index = (storey.hvacZones ?? []).findIndex((z) => z.id === id)
    if (index >= 0) return { storey, zone: storey.hvacZones![index], index }
  }
  return null
}

const close = (ring: readonly Vec2[]): Vec2[] => {
  const pts = ring.map((p) => [p[0], p[1]] as Vec2)
  const [a, z] = [pts[0], pts[pts.length - 1]]
  return a && z && (a[0] !== z[0] || a[1] !== z[1]) ? [...pts, [a[0], a[1]]] : pts
}

function nextName(model: Model): string {
  const taken = new Set(hvacZonesOf(model).map((z) => z.name))
  let n = model.storeys.reduce((k, s) => k + (s.hvacZones?.length ?? 0), 0) + 1
  while (taken.has(`공조존 ${n}`)) n++
  return `공조존 ${n}`
}

/** 바닥 조각들을 맞닿은(벽 두께 안) 것끼리 합친다. 떨어진 조각은 따로 남는다(GeoJSON MultiPolygon). */
function unionPieces(rings: readonly Vec2[][]): Vec2[][] {
  let pieces = rings.filter((r) => r.length >= 4).map((r) => close(r))
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const u = unionRings(pieces[i], pieces[j])
        if (!u.ok) continue
        pieces = [...pieces.slice(0, i), u.ring, ...pieces.slice(i + 1, j), ...pieces.slice(j + 1)]
        merged = true
        break outer
      }
    }
  }
  return pieces
}

/** 담당 설비로 쓸 수 있는 id 만 남긴다(있는 설비, 겹치지 않게). */
function servedOf(model: Model, ids: readonly string[] | undefined): string[] {
  const known = new Set(model.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  return [...new Set((ids ?? []).filter((id) => known.has(id)))]
}

/**
 * 물리존을 골라 공조존을 만든다(OE-ZON-01). 고른 물리존이 담당이고, 바닥은 그 물리존들의 합집합이다. 한 층의 물리존만 받는다 — 공조존은 층마다
 * 두고(GeoJSON 이 층 파일이다) 여러 층을 하나로 담당하는 설비는 층마다 공조존을 만든다.
 */
export function createZoneFromSpaces(
  model: Model,
  spec: { spaceIds: readonly string[]; name?: string; servedBy?: readonly string[]; id?: string },
): HvacZone | { refused: string } | null {
  const ids = [...new Set(spec.spaceIds)]
  if (ids.length === 0) return { refused: '담당 물리존을 하나 이상 고르세요.' }
  const storeys = new Set(ids.map((id) => model.storeys.find((s) => s.spaces.some((sp) => sp.id === id))?.id ?? null))
  if (storeys.has(null)) return null
  if (storeys.size > 1) return { refused: '한 층의 물리존만 고를 수 있습니다. 층마다 공조존을 만드세요.' }
  const storey = model.storeys.find((s) => s.id === [...storeys][0])!
  if (spec.id && findHvacZone(model, spec.id)) return null
  const spaces = ids.map((id) => storey.spaces.find((s) => s.id === id)!)
  const footprint = unionPieces(spaces.map((s) => s.footprint))
  const zone: HvacZone = {
    id: spec.id ?? newId(),
    name: spec.name?.trim() || nextName(model),
    storeyId: storey.id,
    footprint,
    areaM2: footprint.reduce((a, r) => a + polygonArea(r), 0),
    declaredAreaM2: null,
    spaceIds: ids,
    spaceShares: Object.fromEntries(ids.map((id) => [id, 1])),
    servedBy: servedOf(model, spec.servedBy),
    source: 'edit',
  }
  ;(storey.hvacZones ??= []).push(zone)
  return zone
}

/** 그린 경계와 겹치는 물리존과 그 몫(겹친 넓이 ÷ 방 넓이). */
function overlappedSpaces(storey: Storey, ring: readonly Vec2[]): { ids: string[]; shares: Record<string, number> } {
  const ids: string[] = []
  const shares: Record<string, number> = {}
  for (const sp of storey.spaces) {
    if (sp.footprint.length < 4) continue
    const area = overlapArea(ring, sp.footprint) ?? 0
    if (area <= ZONE_OVERLAP_M2) continue
    ids.push(sp.id)
    shares[sp.id] = sp.areaM2 > 0 ? Math.min(1, area / sp.areaM2) : 0
  }
  return { ids, shares }
}

/** 그린 경계를 닫힌 고리로. 셋 미만·엇갈림·넓이 없음은 막는다. */
function outlineRing(footprint: readonly Vec2[]): Vec2[] | { refused: string } {
  const ring = close(footprint)
  if (ring.length < 4) return { refused: '꼭짓점을 셋 이상 찍어야 합니다.' }
  if (isSelfIntersecting(ring)) return { refused: '변이 서로 엇갈립니다. 꼭짓점을 차례대로 찍으세요.' }
  if (polygonArea(ring) < 0.01) return { refused: '넓이가 너무 작습니다.' }
  return ring
}

/** 경계를 그려 공조존을 만든다(OE-ZON-02). 겹치는 물리존이 담당이다. 변이 엇갈리거나 넓이가 없으면 막는다. */
export function createZoneFromOutline(
  model: Model,
  storeyId: string,
  spec: { footprint: readonly Vec2[]; name?: string; servedBy?: readonly string[]; id?: string },
): HvacZone | { refused: string } | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  if (spec.id && findHvacZone(model, spec.id)) return null
  const ring = outlineRing(spec.footprint)
  if ('refused' in ring) return ring
  const { ids, shares } = overlappedSpaces(storey, ring)
  const zone: HvacZone = {
    id: spec.id ?? newId(),
    name: spec.name?.trim() || nextName(model),
    storeyId: storey.id,
    footprint: [ring],
    areaM2: polygonArea(ring),
    declaredAreaM2: null,
    spaceIds: ids,
    spaceShares: shares,
    servedBy: servedOf(model, spec.servedBy),
    source: 'edit',
    drawn: true,
  }
  ;(storey.hvacZones ??= []).push(zone)
  return zone
}

/**
 * 경계를 다시 그린다(OE-ZON-04). 물리존을 골라 만든 존도 이제 그린 존이 되어, 새 경계와 겹치는 물리존이 담당이다.
 * 담당 물리존을 그대로 두면 바닥과 담당이 어긋나 Z-01·Z-02 가 틀린 답을 낸다. 겹치는 물리존이 없으면 막는다.
 */
export function reshapeHvacZone(model: Model, id: string, footprint: readonly Vec2[]): boolean | { refused: string } {
  const found = findHvacZone(model, id)
  if (!found) return false
  const ring = outlineRing(footprint)
  if ('refused' in ring) return ring
  const { ids, shares } = overlappedSpaces(found.storey, ring)
  if (!ids.length) return { refused: '경계와 겹치는 물리존이 없습니다. 담당 물리존 위에 그리세요.' }
  Object.assign(found.zone, { footprint: [ring], areaM2: polygonArea(ring), spaceIds: ids, spaceShares: shares, drawn: true })
  return true
}

/** 사람이 만든 공조존을 지운다. 담당하던 물리존은 다른 공조존이 없으면 담당 없음(Z-01)이 된다. */
export function deleteHvacZone(model: Model, id: string): boolean {
  const found = findHvacZone(model, id)
  if (!found) return false
  found.storey.hvacZones!.splice(found.index, 1)
  if (!found.storey.hvacZones!.length) delete found.storey.hvacZones
  return true
}

/** 담당 설비를 정한다. 없는 설비 id 는 버린다. 바뀌었으면 true. */
export function setZoneServedBy(model: Model, id: string, equipmentIds: readonly string[]): boolean {
  const found = findHvacZone(model, id)
  if (!found) return false
  const next = servedOf(model, equipmentIds)
  if (JSON.stringify(next) === JSON.stringify(found.zone.servedBy ?? [])) return false
  found.zone.servedBy = next
  return true
}

/**
 * 담당 물리존을 고친다(OE-ZON-04). 같은 층의 물리존만 받는다. 물리존을 골라 만든 공조존은 바닥을 새 합집합으로 다시 만들고, 경계를 그린
 * 공조존은 바닥은 두고 담당만 바꾼다 — 그린 경계는 물리존 경계와 무관하다(OE-ZON-02). 하나도 남지 않으면 막는다. 바뀌었으면 true.
 */
export function setZoneSpaces(model: Model, id: string, spaceIds: readonly string[]): boolean | { refused: string } {
  const found = findHvacZone(model, id)
  if (!found) return false
  const ids = [...new Set(spaceIds)].filter((sid) => found.storey.spaces.some((sp) => sp.id === sid))
  if (!ids.length) return { refused: '담당 물리존을 하나 이상 남기세요. 공조존을 없애려면 [지우기] 를 누릅니다.' }
  if (ids.join(' ') === found.zone.spaceIds.join(' ')) return false
  const z = found.zone
  z.spaceIds = ids
  if (z.drawn) {
    const shares: Record<string, number> = {}
    for (const sid of ids) {
      const sp = found.storey.spaces.find((x) => x.id === sid)!
      const area = z.footprint.reduce((a, r) => a + (overlapArea(r, sp.footprint) ?? 0), 0)
      shares[sid] = sp.areaM2 > 0 ? Math.min(1, area / sp.areaM2) : 0
    }
    z.spaceShares = shares
  } else {
    z.footprint = unionPieces(ids.map((sid) => found.storey.spaces.find((x) => x.id === sid)!.footprint))
    z.areaM2 = z.footprint.reduce((a, r) => a + polygonArea(r), 0)
    z.spaceShares = Object.fromEntries(ids.map((sid) => [sid, 1]))
  }
  return true
}

/** 이름을 고친다. 빈 이름은 받지 않는다(TTL rdfs:label 이 빈다). */
export function renameHvacZone(model: Model, id: string, name: string): boolean {
  const found = findHvacZone(model, id)
  const n = name.trim()
  if (!found || !n || n === found.zone.name) return false
  found.zone.name = n
  return true
}

/** 공조존 목록의 사본. 되돌리기·편집 파일이 쓴다. */
export function copyHvacZones(zones: readonly HvacZone[]): HvacZone[] {
  return zones.map((z) => ({
    ...z,
    footprint: z.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2)),
    spaceIds: [...z.spaceIds],
    ...(z.spaceShares ? { spaceShares: { ...z.spaceShares } } : {}),
    ...(z.servedBy ? { servedBy: [...z.servedBy] } : {}),
  }))
}

/** 설비가 담당하는 공조존(설비 id → 공조존 id). TTL 의 `feeds` 와 화면의 담당 공조존이 쓴다. */
export function zonesServedBy(model: Model): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const z of hvacZonesOf(model)) for (const id of z.servedBy ?? []) out.set(id, [...(out.get(id) ?? []), z.id])
  return out
}

// --- 공조존 검증 (OE-ZON-05) ---------------------------------------------------------------------------
// 경고만 하고 막지 않는다. 6규칙 중 지금 데이터로 잴 수 있는 다섯이다. Z-03(용량)은 설계 풍량·설비 용량 입력값(OE-ZON-06)과 같이 둔다.

/** 실내 쪽 기기. 담당 공조존의 물리존 밖에 있으면 Z-06 이다(시스템에어컨 실내기·FCU). */
const INDOOR_KINDS = new Set(['indoor_unit', 'fcu'])
/** 두 공조존 바닥이 이만큼 넘게 겹치면 같은 영역을 담당한 것이다(㎡). 경계를 그리다 벽 두께만큼 겹치는 것은 세지 않는다. */
export const ZONE_DUPLICATE_M2 = 0.5

export type ZoneCheck = {
  /** OE-ZON-05 의 규칙 번호. `연결` 은 OE-MAP-02 의 연결 기준이다(ZON-05 의 여섯 규칙 밖). */
  rule: 'Z-01' | 'Z-02' | 'Z-04' | 'Z-05' | 'Z-06' | '연결'
  /** 무엇을 검사하나. */
  text: string
  /** 위반한 것. 물리존·공조존·설비 id 와 보일 말. */
  items: { id: string; label: string }[]
}

/**
 * 연결 기준(OE-MAP-02). 공조존마다, 담당 설비에서 흐름 방향을 따라 닿는 말단(디퓨저·그릴)이 놓인 그 층의 물리존이다. 바람이 실제로 오는 방이다.
 *
 * - 방향은 포트·사람이 정한 것·확정한 규칙만 탄다(`withInferred(…, true)`, 내보내기와 같은 방향). 확정 전 규칙 방향으로만 닿는 방은 넣지 않는다(K4·K14).
 * - 공기 원천(공조기·FCU)은 하류(급기)와 상류(환기·배기) 말단을 다 센다. VAV 같은 기기는 하류만 센다. 다른 원천에서는 멈춘다(served.ts 와 같다).
 * - 말단을 담당 설비로 고른 경우는 그 말단 자신이다.
 * - 닿는 말단이 없는 설비(연결·방향 없음)는 이 기준을 쓰지 않는다. 그래서 공조존이 아예 빠질 수 있다.
 */
export function flowSpacesOfZones(model: Model, connections?: readonly Connection[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  // 담당 설비가 있는 공조존이 없으면 연결을 훑지 않는다. 편집마다 불려서, 공조존이 없는 성수에서 연결 전부를 도는 일을 막는다.
  const zones = hvacZonesOf(model).filter((z) => z.servedBy?.length)
  if (!zones.length) return out
  const reach = flowReach(model, connections ?? withInferred(model.connections, true))
  for (const z of zones) {
    const storey = model.storeys.find((s) => s.id === z.storeyId)
    const ids = storey ? reach(z.servedBy!, storey) : []
    if (ids.length) out.set(z.id, ids)
  }
  return out
}

/** 설비 하나에서 확정된 흐름으로 닿는 말단의 물리존(그 설비의 층). 설비 패널에서 공조존을 만들 때 담당 물리존으로 쓴다. */
export function flowSpacesOfEquipment(model: Model, id: string): string[] {
  const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === id))
  return storey ? flowReach(model, withInferred(model.connections, true))([id], storey) : []
}

/** 설비들에서 흐름으로 닿는 말단이 놓인 그 층 물리존을 재는 함수. 연결 색인을 한 번 만들고 설비마다 말단을 기억한다. */
function flowReach(model: Model, connections: readonly Connection[]): (equipmentIds: readonly string[], storey: Storey) => string[] {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const forward = new Map<string, string[]>()
  const backward = new Map<string, string[]>()
  for (const c of connections) {
    if (!c.directed) continue
    forward.set(c.from, [...(forward.get(c.from) ?? []), c.to])
    backward.set(c.to, [...(backward.get(c.to) ?? []), c.from])
  }
  const walk = (start: string, adj: Map<string, string[]>, found: Set<string>) => {
    const seen = new Set([start])
    const queue = [start]
    for (let head = 0; head < queue.length; head++)
      for (const next of adj.get(queue[head]) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        const e = byId.get(next)
        if (isAirTerminal(e)) found.add(next)
        else if (!isAirSource(e)) queue.push(next)
      }
  }
  const terminalsOf = new Map<string, Set<string>>()
  const terminals = (id: string) => {
    let found = terminalsOf.get(id)
    if (found) return found
    found = new Set<string>()
    const e = byId.get(id)
    if (isAirTerminal(e)) found.add(id)
    else {
      walk(id, forward, found)
      if (isAirSource(e)) walk(id, backward, found)
    }
    terminalsOf.set(id, found)
    return found
  }
  return (equipmentIds, storey) => {
    const here = new Set(storey.spaces.map((s) => s.id))
    const ids = new Set<string>()
    for (const id of equipmentIds)
      for (const t of terminals(id)) {
        const sp = byId.get(t)?.spaceId
        if (sp && here.has(sp)) ids.add(sp)
      }
    return [...ids]
  }
}

/**
 * 공조존 검증. 층 하나에 공조존이 하나도 없으면 그 층은 Z-01(공백)을 세지 않는다 — 공조존을 아직 만들지 않은 층의 물리존 전부가 공백으로
 * 뜨면 정작 빠뜨린 방이 보이지 않는다. 그 층들은 `untouched` 로 따로 돌려준다.
 */
export function zoneChecks(model: Model, name: { space: (id: string) => string; equipment: (id: string) => string }): { checks: ZoneCheck[]; untouched: string[] } {
  const zones = hvacZonesOf(model)
  const idfServed = new Set((model.hvac?.equipment ?? []).flatMap((e) => e.feeds))
  const byStorey = new Map<string, HvacZone[]>()
  for (const z of zones) if (z.storeyId) byStorey.set(z.storeyId, [...(byStorey.get(z.storeyId) ?? []), z])
  const untouched = model.storeys.filter((s) => !byStorey.has(s.id) && s.spaces.length).map((s) => s.name)

  const z01: ZoneCheck['items'] = []
  const z02: ZoneCheck['items'] = []
  for (const storey of model.storeys) {
    const here = byStorey.get(storey.id)
    if (!here) continue
    const covered = new Set(here.flatMap((z) => z.spaceIds))
    for (const sp of storey.spaces) if (!covered.has(sp.id)) z01.push({ id: sp.id, label: `${storey.name} ${name.space(sp.id)}` })
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        const area = here[i].footprint.reduce((a, ra) => a + here[j].footprint.reduce((b, rb) => b + (overlapArea(ra, rb) ?? 0), 0), 0)
        if (area > ZONE_DUPLICATE_M2) z02.push({ id: `${here[i].id}|${here[j].id}`, label: `${here[i].name} · ${here[j].name} ${area.toFixed(1)}㎡` })
      }
  }
  const all = model.storeys.flatMap((s) => s.equipment)
  const inside = (z: HvacZone, p: Vec2) => z.footprint.some((r) => pointInPolygon(p, r))
  const z04 = zones.filter((z) => !(z.servedBy?.length || idfServed.has(z.id))).map((z) => ({ id: z.id, label: z.name }))
  // 토출구가 공조존 안에 있나. 경계를 그린 공조존은 바닥 안만 본다 — 물리존 일부만 덮는 존이 그 물리존 반대편 토출구로 통과하면 안 된다.
  // 물리존을 골라 만든 공조존은 담당 물리존에 속한 토출구도 센다(좌표가 벽 두께만큼 밖이어도 소속은 그 방이다).
  const z05 = zones
    .filter((z) => !all.some((e) => isAirTerminal(e) && e.position && (inside(z, [e.position[0], e.position[1]]) || (!z.drawn && !!e.spaceId && z.spaceIds.includes(e.spaceId)))))
    .map((z) => ({ id: z.id, label: z.name }))
  const byId = new Map(all.map((e) => [e.id, e]))
  const z06: ZoneCheck['items'] = []
  for (const z of zones)
    for (const id of z.servedBy ?? []) {
      const e = byId.get(id)
      if (e && INDOOR_KINDS.has(e.kind ?? '') && e.spaceId && !z.spaceIds.includes(e.spaceId))
        z06.push({ id: `${z.id}|${id}`, label: `${name.equipment(id)} — ${name.space(e.spaceId)} 에 있고 ${z.name} 담당` })
    }
  // 연결 기준과 다른 담당(OE-MAP-02). 같은 설비가 여러 공조존을 담당하면 그 공조존들의 담당 물리존을 함께 본다 — 공조기 하나가 두 존에
  // 바람을 보내면, 한 존에 없는 방이 다른 존에 있는 것은 정상이다.
  const flow = flowSpacesOfZones(model)
  const map02: ZoneCheck['items'] = []
  for (const z of zones) {
    const reach = flow.get(z.id)
    if (!reach) continue
    if (!reach.some((id) => z.spaceIds.includes(id))) {
      map02.push({ id: `${z.id}|none`, label: `${z.name} — 담당 물리존에 말단 없음(말단: ${reach.map(name.space).join(', ')})` })
      continue
    }
    const shared = new Set(zones.filter((o) => o.storeyId === z.storeyId && o.servedBy?.some((id) => z.servedBy?.includes(id))).flatMap((o) => o.spaceIds))
    const missing = reach.filter((id) => !shared.has(id))
    if (missing.length) map02.push({ id: `${z.id}|missing`, label: `${z.name} — 담당에서 빠짐: ${missing.map(name.space).join(', ')}` })
  }
  return {
    checks: [
      { rule: 'Z-01', text: '어느 공조존도 담당하지 않는 물리존', items: z01 },
      { rule: 'Z-02', text: '두 공조존이 같은 영역을 담당', items: z02 },
      { rule: 'Z-04', text: '담당 설비가 없는 공조존', items: z04 },
      { rule: 'Z-05', text: '토출구가 하나도 없는 공조존', items: z05 },
      { rule: 'Z-06', text: '실내기가 담당 공조존의 물리존 밖에 있음', items: z06 },
      { rule: '연결', text: '담당 물리존과 담당 설비의 흐름이 닿는 물리존이 다름', items: map02 },
    ],
    untouched,
  }
}

/**
 * 물리존을 나누거나 합치거나 지운 뒤 그 층 공조존의 담당 물리존을 따라 고친다(OE-MAP-02). 나누면 두 조각 모두 원래 공조존의 담당이고, 합치면
 * 남는 방으로 바뀌고, 지우면 빠진다. 물리존을 골라 만든 공조존은 바닥을 다시 합집합으로 만든다. 경계를 그린 공조존은 바닥을 두고 몫만 다시 잰다.
 * 그 층의 물리존 목록이 바뀐 뒤에 부른다(edit.ts 의 splitSpace·absorb·deleteSpace).
 */
export function remapZonesForSpaces(storey: Storey, change: { split?: [string, string]; merged?: [string, string]; removed?: string }): void {
  for (const z of storey.hvacZones ?? []) {
    let ids = [...z.spaceIds]
    if (change.split && ids.includes(change.split[0]) && !ids.includes(change.split[1])) ids.push(change.split[1])
    if (change.merged && ids.includes(change.merged[1])) ids = [...new Set(ids.map((id) => (id === change.merged![1] ? change.merged![0] : id)))]
    if (change.removed) ids = ids.filter((id) => id !== change.removed)
    if (ids.join(' ') === z.spaceIds.join(' ') && !change.merged) continue
    z.spaceIds = ids
    const spaces = ids.map((id) => storey.spaces.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
    if (z.drawn) {
      z.spaceShares = Object.fromEntries(
        spaces.map((sp) => [sp.id, sp.areaM2 > 0 ? Math.min(1, z.footprint.reduce((a, r) => a + (overlapArea(r, sp.footprint) ?? 0), 0) / sp.areaM2) : 0]),
      )
    } else {
      z.footprint = unionPieces(spaces.map((s) => s.footprint))
      z.areaM2 = z.footprint.reduce((a, r) => a + polygonArea(r), 0)
      z.spaceShares = Object.fromEntries(spaces.map((s) => [s.id, 1]))
    }
  }
}
