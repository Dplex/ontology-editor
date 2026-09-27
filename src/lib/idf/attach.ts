// IDF 에서 읽은 공조존과 담당 관계를 모델에 얹는다(F12).
//
// **층은 높이로 맞춘다.** IDF 의 층은 이름이 아니라 바닥면 높이다(존 이름에 `1F` 가 붙어 있어도 규칙이 아니다). BIM 층
// 높이와 가장 가까운 것이 STOREY_TOLERANCE 안이면 그 층이다. BIM 이 없으면(IDF 만 연 것) 높이마다 층을 세운다.
//
// **물리존과는 자리로 잇는다.** 물리존의 안쪽 점이 공조존 바닥 안에 들면 그 방은 그 공조존의 일부다(`brick:hasPart`).
// 넓이 교집합을 재지 않는 것은 다각형 연산 라이브러리를 들이지 않기 때문이고(55 가 npm 에 닿지 않는다), 방 하나가 두
// 공조존에 걸치는 일은 IDF 가 방 단위로 존을 나누는 한 드물다. 좌표계가 다르면 오류 없이 한 방도 안 들어가므로 따로 잰다.
//
// **IDF 설비는 BIM 설비와 이름으로만 잇는다.** 이름이 하나에만 맞을 때만 잇고(판본 짝짓기와 같은 원칙), 못 이은 IDF
// 설비는 좌표 없이 IDF 출신으로 남는다. 담당 관계(`brick:feeds`)는 IDF 가 말한 것이라 확정 없이 나간다 — 규칙으로
// 추정한 방향과 다르다.

import { interiorPoint, pointInPolygon } from '../mapping'
import { isConduit, polygonArea, type HvacEquipment, type HvacZone, type Model, type Storey, type Vec2 } from '../model'
import { unionRings } from '../polygon'
import type { IdfModel } from './read'

/** IDF 바닥 높이와 BIM 층 높이를 같다고 보는 차(미터). IDF 는 층고를 반올림해 적는 일이 흔하다. */
export const STOREY_TOLERANCE = 0.5

export type IdfAttachReport = {
  zones: number
  /** 층을 찾은 존. BIM 층이 없으면 세운 층 수를 따로 적는다. */
  zonesOnStoreys: number
  createdStoreys: number
  /** 물리존이 하나라도 든 공조존 / 공조존에 든 물리존 / 전체 물리존. */
  zonesWithSpaces: number
  spacesInZones: number
  spaces: number
  /** 이름으로 BIM 설비와 이은 IDF 설비. */
  matchedEquipment: number
  equipment: number
  /** 공조존 바닥 조각의 중심 중 BIM 물리존 범위(±2m) 안에 든 비율. BIM 물리존이 없으면 null. */
  alignment: number | null
}

const sanitize = (name: string) => name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
/** 이름 비교용. 기호·공백·대소문자를 뗀다(`AHU 02` = `AHU-02`). */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')

export function attachIdf(model: Model, idf: IdfModel, source: string): { model: Model; report: IdfAttachReport } {
  const m = structuredClone(model)
  const taken = new Set<string>()
  const idOf = (prefix: string, name: string) => {
    let id = `${prefix}${sanitize(name)}`
    for (let n = 2; taken.has(id); n++) id = `${prefix}${sanitize(name)}_${n}`
    taken.add(id)
    return id
  }

  // --- 좌표계 ----------------------------------------------------------------------
  const ring = m.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  let alignment: number | null = null
  if (ring.length) {
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...ys) - 2, Math.max(...ys) + 2]
    const centers = idf.zones.flatMap((z) => z.floors.map((f) => interiorPoint(f.ring)).filter((c): c is Vec2 => !!c))
    if (centers.length) alignment = centers.filter(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1).length / centers.length
  }

  // --- 층 --------------------------------------------------------------------------
  let createdStoreys = 0
  const storeyAt = (z: number): Storey | null => {
    let best: Storey | null = null
    for (const s of m.storeys) if (Math.abs(s.elevation - z) <= STOREY_TOLERANCE && (!best || Math.abs(s.elevation - z) < Math.abs(best.elevation - z))) best = s
    return best
  }
  const bimHasStoreys = m.storeys.length > 0

  const zones: HvacZone[] = []
  let zonesOnStoreys = 0
  for (const z of idf.zones) {
    const lowest = z.floors.length ? Math.min(...z.floors.map((f) => f.z)) : null
    let storey = lowest === null ? null : storeyAt(lowest)
    if (!storey && lowest !== null && !bimHasStoreys) {
      // IDF 만 연 것. 바닥 높이마다 층을 세운다. 이름은 높이다 — 존 이름의 `1F` 는 규칙이 아니라 지어내지 않는다.
      storey = { id: idOf('IDF_storey_', `${lowest.toFixed(2)}`), name: `IDF 바닥 ${lowest.toFixed(2)}m`, elevation: lowest, spaces: [], walls: [], openings: [], equipment: [] }
      m.storeys.push(storey)
      m.storeys.sort((a, b) => a.elevation - b.elevation)
      createdStoreys++
    }
    if (storey) zonesOnStoreys++
    // 높이가 같은 조각끼리만 합친다. 복층 존의 윗바닥을 아랫바닥과 평면에서 합치면 넓이가 빠진다.
    const levels = new Map<number, Vec2[][]>()
    for (const f of z.floors) {
      const key = Math.round(f.z * 10) / 10
      levels.set(key, [...(levels.get(key) ?? []), f.ring])
    }
    const pieces = [...levels.values()].flatMap(mergePieces)
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
  for (const storey of m.storeys) {
    const here = zones.filter((zz) => zz.storeyId === storey.id)
    for (const space of storey.spaces) {
      const p = interiorPoint(space.footprint)
      if (!p) continue
      // 바닥 조각이 겹치는 존이 있으면 작은 존이다(방 소속과 같은 규칙).
      const owner = here
        .filter((zz) => zz.footprint.some((r) => pointInPolygon(p, r)))
        .sort((a, b) => a.areaM2 - b.areaM2)[0]
      if (!owner) continue
      owner.spaceIds.push(space.id)
      spacesInZones++
    }
  }

  // --- 설비 -------------------------------------------------------------------------
  const devices = m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
  const byKey = new Map<string, string[]>()
  for (const e of devices) {
    const k = nameKey(e.name)
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), e.id])
  }
  const equipment: HvacEquipment[] = idf.equipment.map((e) => {
    const hits = byKey.get(nameKey(e.name)) ?? []
    return { id: idOf('I_', e.name), name: e.name, idfClass: e.idfClass, kind: e.kind, bimId: hits.length === 1 ? hits[0] : null, feeds: [] }
  })
  const zoneByName = new Map(zones.map((z) => [z.name.toLowerCase(), z]))
  const equipByName = new Map(equipment.map((e) => [e.name.toLowerCase(), e]))
  idf.equipment.forEach((e, i) => {
    equipment[i].feeds = e.feeds.flatMap((f) => {
      const target = f.zone ? zoneByName.get(f.zone.toLowerCase())?.id : f.equipment ? equipByName.get(f.equipment.toLowerCase())?.id : undefined
      return target ? [target] : []
    })
  })
  // 존 설비(말단)는 담당하는 존의 층에 있다고 본다(방은 모른다). 공조기·실외기는 층도 모른다.
  for (const e of equipment) {
    const zoneStoreys = new Set(e.feeds.map((t) => zones.find((z) => z.id === t)?.storeyId).filter((x): x is string => !!x))
    if (zoneStoreys.size === 1) e.storeyId = [...zoneStoreys][0]
  }

  m.hvac = { source, zones, equipment }
  const report: IdfAttachReport = {
    zones: zones.length,
    zonesOnStoreys,
    createdStoreys,
    zonesWithSpaces: zones.filter((z) => z.spaceIds.length).length,
    spacesInZones,
    spaces: m.storeys.reduce((n, s) => n + s.spaces.length, 0),
    matchedEquipment: equipment.filter((e) => e.bimId).length,
    equipment: equipment.length,
    alignment,
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
