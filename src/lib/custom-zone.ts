// 커스텀존(OE-OBJ-01, F14). 운영자가 물리존 위에 다각형으로 정하는 운영 단위다(예: 임원석, 사무석, 식당). BIM 에는 없다.
//
// - 층마다 둔다(`Storey.customZones`). 서로 겹쳐도 되고, 물리존과 경계가 맞지 않아도 된다 — 넓은 사무실 한쪽 구석만 덮는
//   "임원석" 같은 것이 흔하다(OE-OBJ-01: "커스텀 존은 서로 겹쳐서 설정할 수 있다").
// - 별명은 여러 개다(2026-10-03 사용자 결정, ADR-0012). 첫 이름(`name`)이 TTL rdfs:label 이고 나머지(`aliases`)는 ex:alias 다.
//   OE-OBJ-01 은 "커스텀 존 당 1개", 용어집·OE-SPC-06 은 "별명 복수" 라 어긋났었다.
// - 매핑은 저장하지 않고 쓸 때 계산한다(exterior.ts·vertical.ts 와 같다). 물리존을 나누거나 옮기거나 설비를 옮기면 다음 내보내기에
//   그대로 들어가서 "커스텀존 수정이 물리존·공조존과 매핑되어 온톨로지에 갱신" 이 따로 할 일 없이 맞는다.
//   - 덮는 물리존: 방 바닥의 절반 넘게를 덮으면(공조존 → 방과 같은 기준, idf/attach.ts). TTL `brick:hasPart`.
//   - 든 설비: 좌표가 다각형 안이면. TTL 에서 설비가 `brick:hasLocation` 을 하나 더 갖는다 — 방 일부만 덮는 존에서도 Agent 가
//     "임원석의 설비·온도" 를 찾게 한다. 받는 쪽(ttl.go)은 hasLocation 을 목록으로 읽는다.
//   - 공조존과는 같은 방을 품는 것으로 이어진다(공조존 hasPart 방). 술어를 늘리지 않는다.
// 설계 결정은 docs/adr/0004-custom-zone-ontology.md.

import { isSelfIntersecting, pointInPolygon } from './mapping'
import { isConduit, polygonArea, type CustomZone, type Model, type Storey, type Vec2 } from './model'

export type { CustomZone }
import { MERGE_GAP, overlapArea, splitRing, unionRings } from './polygon'
import { newId } from './edit'

/** 방 바닥의 이만큼을 넘게 덮어야 그 방을 품는다(공조존과 같다). */
const MIN_COVER = 0.5

const close = (ring: readonly Vec2[]): Vec2[] => {
  const pts = ring.map((p) => [p[0], p[1]] as Vec2)
  const [a, z] = [pts[0], pts[pts.length - 1]]
  return a && z && (a[0] !== z[0] || a[1] !== z[1]) ? [...pts, [a[0], a[1]]] : pts
}

export function findCustomZone(model: Model, id: string): { storey: Storey; zone: CustomZone; index: number } | null {
  for (const storey of model.storeys) {
    const index = (storey.customZones ?? []).findIndex((z) => z.id === id)
    if (index >= 0) return { storey, zone: storey.customZones![index], index }
  }
  return null
}

/** 다각형이 존이 될 수 있나. 안 되면 이유. */
function badRing(ring: readonly Vec2[]): string | null {
  if (ring.length < 4) return '꼭짓점을 셋 이상 찍어야 합니다.'
  if (isSelfIntersecting(ring)) return '변이 서로 엇갈립니다. 꼭짓점을 차례대로 찍으세요.'
  if (polygonArea(ring) < 0.01) return '넓이가 너무 작습니다.'
  return null
}

// --- 이름·별명의 고유성 (OE-SPC-06) ---------------------------------------------------------------
// 이름과 별명은 건물 안에서 모두 고유하다 — 이름끼리, 별명끼리, 이름과 별명 사이 어디서도 같은 값이 두 번 나오지 않는다. 그래서 어떤
// 말이든 가리키는 커스텀존은 많아야 하나다(Agent 가 이름·별명으로 묻는다, OE-SPC-10). 같은 값을 쓰려 하면 막고 쓰는 존을 알린다.

/** 이 값을 이름이나 별명으로 쓰는 커스텀존. `exceptId` 존은 뺀다. 없으면 null. */
export function zoneUsing(model: Model, value: string, exceptId?: string): CustomZone | null {
  for (const storey of model.storeys) {
    for (const zone of storey.customZones ?? []) {
      if (zone.id !== exceptId && zoneNames(zone).includes(value)) return zone
    }
  }
  return null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 비어 있는 번호 붙은 이름(OE-SPC-08). `임원석` → `임원석-02`, `임원석-02` → `임원석-03`. 02 부터(이미 번호가 있으면 그 다음부터)
 * 세어 건물 안의 이름·별명에 아직 없는 가장 작은 번호를 쓴다.
 */
export function nextZoneName(model: Model, name: string): string {
  const m = /^(.*)-(\d{2,})$/.exec(name)
  const [base, start] = m ? [m[1], Number(m[2]) + 1] : [name, 2]
  for (let k = start; ; k++) {
    const next = `${base}-${pad2(k)}`
    if (!zoneUsing(model, next)) return next
  }
}

const takenMessage = (model: Model, value: string, owner: CustomZone) =>
  `"${value}" 은(는) 커스텀존 ${owner.name}${owner.name === value ? '의 이름' : '의 별명'}입니다. 이름·별명은 건물 안에서 겹칠 수 없습니다(예: ${nextZoneName(model, value)}).`

/** 커스텀존을 만든다. 이름이 비면 "커스텀존 n"(비어 있는 가장 작은 n). 이름이 다른 존의 이름·별명이면 만들지 않는다. 겹쳐도 막지 않는다. */
export function createCustomZone(
  model: Model,
  storeyId: string,
  spec: { name?: string; footprint: readonly Vec2[]; id?: string },
): CustomZone | { refused: string } | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  const ring = close(spec.footprint)
  const bad = badRing(ring)
  if (bad) return { refused: bad }
  if (spec.id && findCustomZone(model, spec.id)) return null
  let name = spec.name?.trim()
  if (name) {
    const owner = zoneUsing(model, name)
    if (owner) return { refused: takenMessage(model, name, owner) }
  } else {
    let n = model.storeys.reduce((k, s) => k + (s.customZones?.length ?? 0), 0) + 1
    while (zoneUsing(model, `커스텀존 ${n}`)) n++
    name = `커스텀존 ${n}`
  }
  const zone: CustomZone = { id: spec.id ?? newId(), name, footprint: ring }
  ;(storey.customZones ??= []).push(zone)
  return zone
}

/** 이름을 고친다. 빈 이름은 받지 않는다(TTL rdfs:label 이 빈다). 다른 존의 이름·별명이나 이 존의 별명과 같으면 막는다. */
export function renameCustomZone(model: Model, id: string, name: string): boolean | { refused: string } {
  const found = findCustomZone(model, id)
  const next = name.trim()
  if (!found || found.zone.name === next) return false
  if (!next) return { refused: '커스텀존 이름은 비울 수 없습니다.' }
  const owner = zoneUsing(model, next)
  if (owner) return { refused: takenMessage(model, next, owner) }
  found.zone.name = next
  return true
}

/**
 * 더 붙인 별명을 통째로 바꾼다(ADR-0012). 앞뒤 공백을 떼고 빈 것은 뺀다. 같은 별명을 두 번 쓰거나, 이 존의 이름이거나, 다른 존의
 * 이름·별명이면 막고 쓰는 존을 알린다(OE-SPC-06). 바뀌지 않았으면 false.
 */
export function setCustomZoneAliases(model: Model, id: string, aliases: readonly string[]): boolean | { refused: string } {
  const found = findCustomZone(model, id)
  if (!found) return false
  const next = aliases.map((a) => a.trim()).filter(Boolean)
  const twice = next.find((a, i) => next.indexOf(a) !== i)
  if (twice) return { refused: `별명 "${twice}" 을(를) 두 번 적었습니다.` }
  for (const a of next) {
    const owner = a === found.zone.name ? found.zone : zoneUsing(model, a, id)
    if (owner) return { refused: takenMessage(model, a, owner) }
  }
  const was = found.zone.aliases ?? []
  if (next.length === was.length && next.every((a, i) => a === was[i])) return false
  if (next.length) found.zone.aliases = next
  else delete found.zone.aliases
  return true
}

/** 이 존을 부르는 이름 전부(이름 + 더 붙인 별명). 검색이 쓴다. */
export const zoneNames = (zone: CustomZone): string[] => [zone.name, ...(zone.aliases ?? [])]

/** 설비마다 든 커스텀존의 이름·별명 전부(ADR-0012). 설비 검색이 "임원석" 으로 그 존 안의 설비를 찾게 한다. 존에 안 들면 없다. */
export function zoneNamesOfEquipment(model: Model): Map<string, string[]> {
  const byId = new Map(model.storeys.flatMap((s) => (s.customZones ?? []).map((z) => [z.id, zoneNames(z)] as const)))
  const out = new Map<string, string[]>()
  for (const [id, zones] of customZonesOfEquipment(model)) out.set(id, zones.flatMap((z) => byId.get(z) ?? []))
  return out
}

export function deleteCustomZone(model: Model, id: string): boolean {
  const found = findCustomZone(model, id)
  if (!found) return false
  found.storey.customZones!.splice(found.index, 1)
  return true
}

/**
 * 두 점을 지나는 선으로 둘로 나눈다. 넓은 쪽이 원래 존(id·이름·별명)을 이어받고, 좁은 쪽이 새 존이 된다 — 이름은 비어 있는 번호를
 * 붙인 것(`임원석-02`, nextZoneName), 별명은 없다(OE-SPC-08). 선이 경계를 정확히 두 번 지나야 한다(물리존 나누기와 같은 splitRing).
 */
export function splitCustomZone(model: Model, id: string, a: Vec2, b: Vec2, newZoneId?: string): CustomZone | { refused: string } | null {
  const found = findCustomZone(model, id)
  if (!found) return null
  const cut = splitRing(found.zone.footprint, a, b)
  if (!cut.ok) return { refused: cut.reason }
  const [big, small] = [...cut.rings].sort((x, y) => polygonArea(y) - polygonArea(x))
  found.zone.footprint = close(big)
  const piece: CustomZone = { id: newZoneId ?? newId(), name: nextZoneName(model, found.zone.name), footprint: close(small) }
  found.storey.customZones!.splice(found.index + 1, 0, piece)
  return piece
}

/**
 * 같은 층의 두 존을 하나로 합친다. **넓은 쪽이 남는다**(넓이가 같으면 먼저 고른 `keepId`). 남는 존이 id·이름·별명을 그대로 갖고,
 * 없어지는 존의 이름·별명은 남는 존의 별명이 된다(OE-SPC-08). 돌려주는 것은 남은 존이다. 변을 맞대거나(벽 두께 안) 한쪽이 다른
 * 쪽을 품을 때만이다 — 일부만 겹친 두 존은 합친 모양이 고리 하나로 안 닫히는 일이 있어 막는다(물리존 합치기와 같은 unionRings).
 */
export function mergeCustomZones(model: Model, firstId: string, secondId: string): CustomZone | { refused: string } | null {
  const first = findCustomZone(model, firstId)
  const second = findCustomZone(model, secondId)
  if (!first || !second || firstId === secondId) return null
  const [keep, other] = polygonArea(second.zone.footprint) > polygonArea(first.zone.footprint) ? [second, first] : [first, second]
  const otherId = other.zone.id
  if (keep.storey !== other.storey) return { refused: '같은 층의 커스텀존만 합칩니다.' }
  const u = unionRings(keep.zone.footprint, other.zone.footprint, MERGE_GAP)
  if (!u.ok) return { refused: `${u.reason} 커스텀존은 변을 맞댔거나 한쪽이 다른 쪽을 품을 때 합칩니다.` }
  keep.zone.footprint = close(u.ring)
  // 없어지는 존의 이름·별명은 합친 존의 별명으로 남긴다 — 그 이름으로 부르던 사람이 찾을 수 있게(ADR-0012).
  const merged = [...new Set([...(keep.zone.aliases ?? []), ...zoneNames(other.zone)].filter((a) => a !== keep.zone.name))]
  if (merged.length) keep.zone.aliases = merged
  keep.storey.customZones = keep.storey.customZones!.filter((z) => z.id !== otherId)
  return keep.zone
}

/** 존이 품는 물리존 id — 방 바닥의 절반 넘게를 덮는 방. 외곽선 없는 방은 빠진다. */
export function zoneSpaces(storey: Storey, zone: CustomZone): string[] {
  return storey.spaces
    .filter((s) => {
      if (s.footprint.length < 3) return false
      const area = polygonArea(s.footprint)
      const shared = overlapArea(zone.footprint, s.footprint)
      return area > 0 && shared !== null && shared / area > MIN_COVER
    })
    .map((s) => s.id)
}

/**
 * 존 안의 기기 id — 좌표가 다각형 안이면. 덕트·배관은 뺀다(Agent 가 묻는 것은 기기다 — 성수 기계실은 107대 중 88개가 덕트·이음쇠).
 * 좌표 없는 설비도 빠진다(모르는 것을 안에 있다고 하지 않는다). TTL·GeoJSON·패널이 이 목록 하나를 쓴다.
 */
export function zoneEquipment(storey: Storey, zone: CustomZone): string[] {
  return storey.equipment
    .filter((e) => !isConduit(e.role ?? null) && e.position && pointInPolygon([e.position[0], e.position[1]], zone.footprint))
    .map((e) => e.id)
}

/** 설비 id → 그 설비가 든 커스텀존 id 들(겹친 존이면 여럿). TTL 이 hasLocation 을 더할 때 쓴다. */
export function customZonesOfEquipment(model: Model): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const storey of model.storeys) {
    for (const zone of storey.customZones ?? []) {
      for (const id of zoneEquipment(storey, zone)) out.set(id, [...(out.get(id) ?? []), zone.id])
    }
  }
  return out
}
