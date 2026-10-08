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
import { isSelfIntersecting } from './mapping'
import { polygonArea, type HvacZone, type Model, type Storey, type Vec2 } from './model'
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

/** 경계를 그려 공조존을 만든다(OE-ZON-02). 겹치는 물리존이 담당이다. 변이 엇갈리거나 넓이가 없으면 막는다. */
export function createZoneFromOutline(
  model: Model,
  storeyId: string,
  spec: { footprint: readonly Vec2[]; name?: string; servedBy?: readonly string[]; id?: string },
): HvacZone | { refused: string } | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  if (spec.id && findHvacZone(model, spec.id)) return null
  const ring = close(spec.footprint)
  if (ring.length < 4) return { refused: '꼭짓점을 셋 이상 찍어야 합니다.' }
  if (isSelfIntersecting(ring)) return { refused: '변이 서로 엇갈립니다. 꼭짓점을 차례대로 찍으세요.' }
  if (polygonArea(ring) < 0.01) return { refused: '넓이가 너무 작습니다.' }
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
