// IDF 에서 읽은 공조존과 담당 관계를 모델에 얹는다(F12).
//
// **층은 높이가 맞는 층을 닻으로 순서대로 맞춘다(place.ts).** IDF 의 층은 이름이 아니라 바닥면 높이다(존 이름에 `1F` 가 붙어
// 있어도 규칙이 아니다 — 맞춘 결과를 대 보는 데만 쓴다). 시뮬레이션 모델은 층고를 다듬어서(성수 3m · BIM 4.3m) 높이만으로는
// 위층이 빠진다. BIM 이 없으면(IDF 만 연 것) 높이마다 층을 세운다.
//
// **평면 좌표계는 겹친 넓이로 맞춘다(place.ts).** IDF 에는 BIM 과 공유하는 기준점이 없어 원점이 다른 일이 흔하다(성수 16.76m ·
// 18.08m). 찾은 값은 `hvac.placement` 에 두고, 사람이 고친 값을 `options.placement` 로 주면 그것을 쓴다.
//
// **물리존과는 겹친 넓이로 잇는다(PRD #12 ②).** 공조존은 물리존과 단위가 다른 시뮬레이션용 존이다. 겹친 방은 몫과 함께 모두
// `overlaps` 에 둔다(N:M, OE-IDF-06). 그중 물리존 바닥의 절반 넘게를 덮는 공조존이 있으면 그 방은 그 공조존의 일부다
// (`brick:hasPart`). 여럿이면 가장 많이 덮는 존이다. 예전에는 안쪽 점 하나로 정했는데, 그러면 두 존에 걸친 방을 알 수 없고
// 방의 10% 만 덮는 존에도 방이 들어갔다. 절반을 못 넘으면 넣지 않고 "걸친 방" 으로 센다 — 어느 존인지 지어내지 않는다.
// 넓이는 polygon.ts 가 직접 잰다(55 가 npm 에 닿지 않아 라이브러리를 들이지 않는다). 자기 교차한 외곽선은 넓이를 잴 수
// 없어 안쪽 점으로 되돌아간다. 좌표계가 다르면 오류 없이 한 방도 안 들어가므로 따로 잰다.
//
// **IDF 설비는 BIM 설비와 이름 → 존 → 층 순으로 잇는다(ADR-0069).** 이름이 하나에만 맞으면 잇는다(판본 짝짓기와 같은 원칙).
// 시뮬레이션 모델의 이름은 대개 BIM 과 무관해서(성수 129개 중 0개) 둘을 더 본다.
//   - 존 설비(FCU·실내기·VAV)는 존 안의 여러 대를 하나로 뭉친 계산 모형이다. 그 존 바닥 안에 같은 종류 BIM 기기가 있으면 그 기기들로
//     푼다(`bimIds`) — 그 기기들이 존을 담당하고, IDF 의 풍량은 존에 남는다(`idfAirflowCMH`).
//   - 공조기·실외기처럼 존을 직접 담당하지 않는 설비는, 담당하는 존이 한 층뿐이고 그 층에 같은 종류 BIM 기기가 하나뿐이면 잇는다.
//     IDF 쪽도 그 층·종류가 하나뿐일 때만이다.
// 못 이은 IDF 설비는 좌표 없이 IDF 출신으로 남는다. 담당 관계(`brick:feeds`)는 IDF 가 말한 것이라 확정 없이 나간다 — 규칙으로
// 추정한 방향과 다르다.

import { interiorPoint, pointInPolygon } from '../mapping'
import { isConduit, polygonArea, type HvacEquipment, type HvacZone, type Model, type Storey, type Vec2 } from '../model'
import { overlapArea, unionRings } from '../polygon'
import { estimatePlacement, matchLevels, placeRing, storeyHint, type IdfPlacement, type LevelPair } from './place'
import type { IdfModel } from './read'

/** IDF 바닥 높이와 BIM 층 높이를 같다고 보는 차(미터). IDF 는 층고를 반올림해 적는 일이 흔하다. */
export const STOREY_TOLERANCE = 0.5

/** 방이 공조존의 일부라고 볼 몫. 방 바닥의 절반 넘게를 덮어야 한다. */
export const ZONE_SHARE = 0.5
/** 두 번째로 많이 덮는 존이 이만큼 넘으면 그 방은 두 존에 걸친 것이다. */
export const STRADDLE_SHARE = 0.1

export type IdfAttachReport = {
  zones: number
  /** 층을 찾은 존. BIM 층이 없으면 세운 층 수를 따로 적는다. */
  zonesOnStoreys: number
  /** 층을 찾은 존 중 높이가 아니라 순서로 맞춘 것. */
  zonesByOrder: number
  /** 이름에 적힌 층(`4F_…`)과 맞춘 층이 다른 존. */
  storeyNameMismatch: string[]
  createdStoreys: number
  /** 물리존이 하나라도 든 공조존 / 공조존에 든 물리존 / 전체 물리존. */
  zonesWithSpaces: number
  spacesInZones: number
  spaces: number
  /** 두 존이 각각 방 바닥의 10% 넘게를 덮는 방. 존 경계가 방을 가로지른다. 몫은 존의 `overlaps` 에 있다. */
  straddling: number
  /** 어느 존도 방 바닥의 절반을 못 덮어 넣지 않은 방(조금이라도 겹친 것만 센다). */
  partial: number
  /** 외곽선이 자기 교차해 넓이를 못 재고 안쪽 점으로 정한 방. */
  byPoint: number
  /** BIM 설비와 이은 IDF 설비(이름·존·층 합). */
  matchedEquipment: number
  byName: number
  /** 존 안의 BIM 기기로 푼 IDF 존 설비, 그렇게 담당을 맡은 BIM 기기. */
  byZone: number
  bimInZones: number
  byStorey: number
  equipment: number
  /** IDF 평면을 놓은 법. BIM 방이 없으면 null. */
  placement: (IdfPlacement & { source: 'auto' | 'edit'; overlap: number | null; before: number | null }) | null
  /** 공조존 바닥 조각의 중심 중 BIM 물리존 범위(±2m) 안에 든 비율. BIM 물리존이 없으면 null. */
  alignment: number | null
}

const sanitize = (name: string) => name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
/** 이름 비교용. 기호·공백·대소문자를 뗀다(`AHU 02` = `AHU-02`). */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** 방과 겹친 것으로 적는 최소 넓이(㎡)와 몫. 벽 두께만큼 삐친 것은 적지 않는다. */
const OVERLAP_MIN_M2 = 0.05
const OVERLAP_MIN_SHARE = 0.1

export type IdfAttachOptions = {
  /** 사람이 정한 평면 놓는 법. 없으면 겹친 넓이로 찾는다. */
  placement?: IdfPlacement
}

export function attachIdf(model: Model, idf: IdfModel, source: string, options: IdfAttachOptions = {}): { model: Model; report: IdfAttachReport } {
  const m = structuredClone(model)
  const taken = new Set<string>()
  const idOf = (prefix: string, name: string) => {
    let id = `${prefix}${sanitize(name)}`
    for (let n = 2; taken.has(id); n++) id = `${prefix}${sanitize(name)}_${n}`
    taken.add(id)
    return id
  }

  // --- 층 --------------------------------------------------------------------------
  let createdStoreys = 0
  const bimHasStoreys = m.storeys.length > 0
  const lowestOf = (z: IdfModel['zones'][number]) => (z.floors.length ? Math.min(...z.floors.map((f) => f.z)) : null)
  const levels = matchLevels(
    idf.zones.map(lowestOf).filter((z): z is number => z !== null),
    m.storeys,
    STOREY_TOLERANCE,
  )
  const storeyById = new Map(m.storeys.map((s) => [s.id, s]))
  const storeyAt = (z: number): Storey | null => storeyById.get(levels.storeyOf.get(z) ?? '') ?? null
  const byHeight = new Set([...levels.storeyOf].filter(([z, id]) => Math.abs((storeyById.get(id)?.elevation ?? Infinity) - z) <= STOREY_TOLERANCE).map(([z]) => z))

  // 높이가 같은 조각끼리만 합친다. 복층 존의 윗바닥을 아랫바닥과 평면에서 합치면 넓이가 빠진다.
  const piecesOf = (z: IdfModel['zones'][number]) => {
    const byLevel = new Map<number, Vec2[][]>()
    for (const f of z.floors) {
      const key = Math.round(f.z * 10) / 10
      byLevel.set(key, [...(byLevel.get(key) ?? []), f.ring])
    }
    return [...byLevel.values()].flatMap(mergePieces)
  }
  const raw = idf.zones.map((z) => {
    const lowest = lowestOf(z)
    return { z, lowest, storey: lowest === null ? null : storeyAt(lowest), pieces: piecesOf(z) }
  })

  // --- 평면 좌표계 ------------------------------------------------------------------
  // 층마다 존 바닥과 방 바닥의 짝을 모아 겹친 넓이가 가장 큰 놓는 법을 찾는다(place.ts).
  const pairs: LevelPair[] = []
  for (const storey of m.storeys) {
    const zs = raw.filter((r) => r.storey === storey).flatMap((r) => r.pieces)
    if (zs.length && storey.spaces.length) pairs.push({ zones: zs, spaces: storey.spaces.map((sp) => sp.footprint) })
  }
  const estimate = pairs.length ? estimatePlacement(pairs, options.placement) : null
  const placement: IdfAttachReport['placement'] = estimate
    ? { dx: estimate.dx, dy: estimate.dy, rotation: estimate.rotation, source: options.placement ? 'edit' : 'auto', overlap: estimate.overlap, before: estimate.before }
    : options.placement
      ? { ...options.placement, source: 'edit', overlap: null, before: null }
      : null
  const place = placement ?? { dx: 0, dy: 0, rotation: 0 }
  for (const r of raw) r.pieces = r.pieces.map((ring) => placeRing(ring, place))

  const ring = m.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  let alignment: number | null = null
  if (ring.length) {
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...ys) - 2, Math.max(...ys) + 2]
    const centers = raw.flatMap((r) => r.pieces.map((p) => interiorPoint(p)).filter((c): c is Vec2 => !!c))
    if (centers.length) alignment = centers.filter(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1).length / centers.length
  }

  const zones: HvacZone[] = []
  let zonesOnStoreys = 0
  let zonesByOrder = 0
  const storeyNameMismatch: string[] = []
  for (const { z, lowest, pieces } of raw) {
    let storey = lowest === null ? null : storeyAt(lowest)
    if (!storey && lowest !== null && !bimHasStoreys) {
      // IDF 만 연 것. 바닥 높이마다 층을 세운다. 이름은 높이다 — 존 이름의 `1F` 는 규칙이 아니라 지어내지 않는다.
      storey = m.storeys.find((s) => s.id.startsWith('IDF_storey_') && s.elevation === lowest) ?? null
      if (!storey) {
        storey = { id: idOf('IDF_storey_', `${lowest.toFixed(2)}`), name: `IDF 바닥 ${lowest.toFixed(2)}m`, elevation: lowest, spaces: [], walls: [], openings: [], equipment: [] }
        m.storeys.push(storey)
        m.storeys.sort((a, b) => a.elevation - b.elevation)
        createdStoreys++
      }
    }
    if (storey) {
      zonesOnStoreys++
      if (bimHasStoreys && lowest !== null && !byHeight.has(lowest)) zonesByOrder++
      const hint = storeyHint(z.name)
      const named = storeyHint(storey.name)
      if (bimHasStoreys && hint && named && hint !== named) storeyNameMismatch.push(z.name)
    }
    zones.push({
      id: idOf('Z_', z.name),
      name: z.name,
      storeyId: storey?.id ?? null,
      footprint: pieces,
      areaM2: pieces.reduce((n, r) => n + polygonArea(r), 0),
      declaredAreaM2: z.declaredArea,
      spaceIds: [],
    })
  }

  // --- 물리존 ------------------------------------------------------------------------
  let spacesInZones = 0
  let straddling = 0
  let partial = 0
  let byPoint = 0
  for (const storey of m.storeys) {
    const here = zones.filter((zz) => zz.storeyId === storey.id)
    for (const space of storey.spaces) {
      const area = polygonArea(space.footprint)
      if (area <= 0) continue
      const shares: { zone: HvacZone; share: number; m2: number }[] = []
      let measurable = true
      for (const zone of here) {
        let sum = 0
        for (const ring of zone.footprint) {
          const a = overlapArea(space.footprint, ring)
          if (a === null) measurable = false
          else sum += a
        }
        if (sum > 1e-6) shares.push({ zone, share: Math.min(1, sum / area), m2: sum })
      }
      let owner: HvacZone | undefined
      if (measurable) {
        // 겹친 존을 모두 몫과 함께 적는다(N:M). 방이 존보다 커서 존 여럿이 방 하나를 나누는 것(성수 기준층)도 여기 남는다.
        const touching = shares.filter((x) => x.m2 >= OVERLAP_MIN_M2 && (x.share >= OVERLAP_MIN_SHARE || x.m2 / (x.zone.areaM2 || Infinity) >= OVERLAP_MIN_SHARE))
        for (const x of touching) {
          x.zone.overlaps = [...(x.zone.overlaps ?? []), { spaceId: space.id, spaceShare: round3(x.share), zoneShare: round3(Math.min(1, x.m2 / x.zone.areaM2)) }]
        }
        // 많이 덮는 존이 먼저, 같으면 작은 존이다(방 소속과 같은 규칙).
        shares.sort((a, b) => b.share - a.share || a.zone.areaM2 - b.zone.areaM2)
        if (shares.length > 1 && shares[1].share > STRADDLE_SHARE) straddling++
        if (shares[0]?.share > ZONE_SHARE) {
          owner = shares[0].zone
          owner.spaceShares = { ...owner.spaceShares, [space.id]: round3(shares[0].share) }
        } else if (shares.length) partial++
      } else {
        const p = interiorPoint(space.footprint)
        owner = p ? here.filter((zz) => zz.footprint.some((r) => pointInPolygon(p, r))).sort((a, b) => a.areaM2 - b.areaM2)[0] : undefined
        byPoint++
      }
      if (!owner) continue
      owner.spaceIds.push(space.id)
      spacesInZones++
    }
  }

  // --- 설비 -------------------------------------------------------------------------
  const storeyOfDevice = new Map<string, string>()
  for (const st of m.storeys) for (const e of st.equipment) if (!isConduit(e.role)) storeyOfDevice.set(e.id, st.id)
  const devices = m.storeys.flatMap((st) => st.equipment).filter((e) => !isConduit(e.role))
  const used = new Set<string>()
  const byKey = new Map<string, string[]>()
  for (const e of devices) {
    const k = nameKey(e.name)
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), e.id])
  }
  const equipment: HvacEquipment[] = idf.equipment.map((e) => {
    const hits = byKey.get(nameKey(e.name)) ?? []
    const bimId = hits.length === 1 ? hits[0] : null
    if (bimId) used.add(bimId)
    return {
      id: idOf('I_', e.name),
      name: e.name,
      idfClass: e.idfClass,
      kind: e.kind,
      bimId,
      ...(bimId ? { pairedBy: 'name' as const } : {}),
      feeds: [],
      airflowCMH: e.airflow === null ? null : Math.round(e.airflow * 3600 * 10) / 10,
    }
  })
  const zoneByName = new Map(zones.map((z) => [z.name.toLowerCase(), z]))
  const zoneById = new Map(zones.map((z) => [z.id, z]))
  const equipByName = new Map(equipment.map((e) => [e.name.toLowerCase(), e]))
  idf.equipment.forEach((e, i) => {
    equipment[i].feeds = e.feeds.flatMap((f) => {
      const target = f.zone ? zoneByName.get(f.zone.toLowerCase())?.id : f.equipment ? equipByName.get(f.equipment.toLowerCase())?.id : undefined
      return target ? [target] : []
    })
  })
  // 존 설비(말단)는 담당하는 존의 층에 있다고 본다(방은 모른다). 공조기·실외기는 층을 모른다 — 놓인 곳(기계실·옥상)과 담당하는
  // 층은 다르다. 짝짓기에만 "담당하는 층" 을 따로 잰다: 하류가 모두 한 층이면 그 층이다.
  for (const e of equipment) {
    const zoneStoreys = new Set(e.feeds.map((t) => zoneById.get(t)?.storeyId).filter((x): x is string => !!x))
    if (zoneStoreys.size === 1 && e.feeds.every((t) => zoneById.has(t))) e.storeyId = [...zoneStoreys][0]
  }
  const serves = new Map(equipment.filter((e) => e.storeyId).map((e) => [e.id, e.storeyId!]))
  for (let changed = true; changed; ) {
    changed = false
    for (const e of equipment) {
      if (serves.has(e.id) || !e.feeds.length) continue
      const st = e.feeds.map((t) => zoneById.get(t)?.storeyId ?? serves.get(t))
      if (st.some((x) => !x) || new Set(st).size !== 1) continue
      serves.set(e.id, st[0]!)
      changed = true
    }
  }

  // 존 설비 → 존 안의 같은 종류 BIM 기기 여럿.
  const devicesOn = (storeyId: string, kind: string) => devices.filter((d) => d.kind === kind && storeyOfDevice.get(d.id) === storeyId && !used.has(d.id))
  const isZoneUnit = (e: HvacEquipment) => /^(zonehvac|airterminal):/i.test(e.idfClass) && e.feeds.length === 1 && zoneById.has(e.feeds[0])
  for (const e of equipment) {
    if (e.bimId || !e.kind || !isZoneUnit(e)) continue
    const zone = zoneById.get(e.feeds[0])!
    if (!zone.storeyId) continue
    const inside = devicesOn(zone.storeyId, e.kind).filter((d) => d.position && zone.footprint.some((r) => pointInPolygon([d.position![0], d.position![1]], r)))
    if (!inside.length) continue
    e.bimIds = inside.map((d) => d.id)
    e.pairedBy = 'zone'
    for (const d of inside) used.add(d.id)
    if (e.airflowCMH) zone.idfAirflowCMH = Math.round(((zone.idfAirflowCMH ?? 0) + e.airflowCMH) * 10) / 10
  }

  // 공조기·실외기 → 같은 층에 하나뿐인 같은 종류. IDF 쪽도 그 층·종류가 하나뿐일 때만.
  const sources = equipment.filter((e) => !e.bimId && !e.bimIds && e.kind && serves.has(e.id) && !isZoneUnit(e))
  const keyOf = (e: HvacEquipment) => `${serves.get(e.id)}|${e.kind}`
  const idfCount = new Map<string, number>()
  for (const e of sources) idfCount.set(keyOf(e), (idfCount.get(keyOf(e)) ?? 0) + 1)
  for (const e of sources) {
    if (idfCount.get(keyOf(e)) !== 1) continue
    const hits = devicesOn(serves.get(e.id)!, e.kind!)
    if (hits.length !== 1) continue
    e.bimId = hits[0].id
    e.pairedBy = 'storey'
    used.add(hits[0].id)
  }

  m.hvac = { source, zones, equipment, ...(placement ? { placement: { dx: placement.dx, dy: placement.dy, rotation: placement.rotation, source: placement.source, overlap: placement.overlap } } : {}) }
  const report: IdfAttachReport = {
    zones: zones.length,
    zonesOnStoreys,
    zonesByOrder,
    storeyNameMismatch,
    createdStoreys,
    zonesWithSpaces: zones.filter((z) => z.spaceIds.length).length,
    spacesInZones,
    spaces: m.storeys.reduce((n, s) => n + s.spaces.length, 0),
    straddling,
    partial,
    byPoint,
    matchedEquipment: equipment.filter((e) => e.bimId || e.bimIds).length,
    byName: equipment.filter((e) => e.pairedBy === 'name').length,
    byZone: equipment.filter((e) => e.pairedBy === 'zone').length,
    bimInZones: equipment.reduce((n, e) => n + (e.bimIds?.length ?? 0), 0),
    byStorey: equipment.filter((e) => e.pairedBy === 'storey').length,
    equipment: equipment.length,
    alignment,
    placement,
  }
  m.warnings = [...m.warnings, ...idf.warnings.map((w) => `[${source}] ${w}`), ...attachWarnings(report, source)]
  return { model: m, report }
}

/**
 * 한 존의 바닥 조각을 맞댄 것끼리 합친다. DesignBuilder 는 존 바닥을 직사각형 여럿으로 잘라 내서, 그대로 두면 3D·GeoJSON
 * 에 조각 선이 남는다. 합칠 수 없는 조각(떨어졌거나 겹친)은 따로 둔다 — 멀티폴리곤으로 나간다.
 */
function mergePieces(rings: Vec2[][]): Vec2[][] {
  const out = rings.map((r) => r.map((p) => [p[0], p[1]] as Vec2))
  for (let changed = true; changed && out.length > 1; ) {
    changed = false
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const u = unionRings(out[i], out[j], 0)
        if (!u.ok) continue
        out[i] = u.ring
        out.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  return out
}

function attachWarnings(r: IdfAttachReport, source: string): string[] {
  const out: string[] = []
  if (r.alignment !== null && r.alignment < 0.5) {
    out.push(`[${source}] 공조존 바닥의 ${Math.round(r.alignment * 100)}%만 BIM 물리존 범위 안에 있습니다. IDF 와 BIM 의 좌표계(원점·북쪽)가 다른 것 같습니다.`)
  }
  if (r.placement?.source === 'auto' && (r.placement.dx || r.placement.dy || r.placement.rotation)) {
    const p = r.placement
    out.push(
      `[${source}] IDF 와 BIM 의 원점이 달라 IDF 를 x ${p.dx}m · y ${p.dy}m${p.rotation ? ` · ${p.rotation}°` : ''} 옮겨 놓았습니다(겹친 넓이로 찾음, 기준층 존 넓이의 ${Math.round((p.overlap ?? 0) * 100)}% 가 방과 겹침). 다르면 고쳐 주세요.`,
    )
  }
  if (r.zonesByOrder > 0) {
    out.push(`[${source}] 공조존 ${r.zonesByOrder}개는 바닥 높이가 BIM 층과 달라(층고 차이) 아래 층부터 순서로 층을 맞췄습니다.`)
  }
  if (r.storeyNameMismatch.length) {
    out.push(`[${source}] 공조존 ${r.storeyNameMismatch.length}개는 이름에 적힌 층과 맞춘 층이 다릅니다(${r.storeyNameMismatch.slice(0, 3).join(', ')}${r.storeyNameMismatch.length > 3 ? ' 외' : ''}).`)
  }
  if (r.straddling > 0) {
    out.push(`[${source}] 물리존 ${r.straddling}개는 두 공조존에 걸칩니다(각각 바닥의 ${STRADDLE_SHARE * 100}% 넘게). 겹친 몫을 모두 적고, 절반 넘게 덮는 존이 있으면 그 존에 넣었습니다.`)
  }
  if (r.partial > 0) {
    out.push(`[${source}] 물리존 ${r.partial}개는 어느 공조존도 바닥의 절반을 덮지 않아 공조존에 넣지 않았습니다.`)
  }
  if (r.zones > r.zonesOnStoreys) {
    out.push(`[${source}] 공조존 ${r.zones - r.zonesOnStoreys}개는 바닥 높이가 BIM 층과 ${STOREY_TOLERANCE}m 안에서 맞지 않아 층을 정하지 못했습니다.`)
  }
  return out
}

/** IDF 만 연 것. 빈 모델에 얹어 층을 바닥 높이마다 세운다. */
export function modelFromIdf(idf: IdfModel, source: string): { model: Model; report: IdfAttachReport } {
  const empty: Model = {
    schema: `IDF ${idf.version ?? ''}`.trim(),
    siteName: '',
    buildingId: `B_${sanitize(source)}`,
    buildingName: source,
    storeys: [],
    systems: [],
    connections: [],
    warnings: [],
  }
  return attachIdf(empty, idf, source)
}
