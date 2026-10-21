// 방별 체크리스트(docs/plans/space-checklist.md, ADR-0070). 방 하나가 온톨로지로 얼마나 찼는지를 항목 아홉으로 센다. **새 판정이 아니다** —
// 이미 계산하거나 내보내는 것(외곽선·이름·종류·소속·흐름·계통·공조존)을 방으로 다시 묶는다. 화면 상태라 아무것도 내보내지 않는다.
//
// 항목마다 채움·빔·해당 없음 셋 중 하나다. 해당 없음은 점수의 분모에서 뺀다 — 공조존이 없는 건물에서 모든 방을 "빔" 으로 세면 점수가
// 다른 항목을 가린다. 급기(7번)는 내보내기와 같은 확정된 방향으로만 채움이다. 규칙 방향으로만 닿으면 빔이고, 화면에서 닿는 원천을 같이 준다.
import { airServices, isAirTerminal, needsSystem, type AirService } from './served'
import { withInferred } from './flow-rules'
import { fluidConnections } from './flow-review'
import { hvacZonesOf } from './hvac-zone'
import { exportedSpaceIds } from './idf/confirm'
import { distanceToRing, pointInPolygon } from './mapping'
import { isConduit, type Equipment, type Model, type Space, type Storey } from './model'

export type CheckState = 'ok' | 'empty' | 'na'
export type SpaceCheckKey = 'outline' | 'label' | 'number' | 'kind' | 'unplaced' | 'terminalSource' | 'supplyTtl' | 'system' | 'zone'
/** 화면의 출처 칩(Src)과 같은 낱말. 출처를 하나로 말할 수 없으면(포트·사람·확정한 규칙이 섞인 방향, 계통) 비운다. */
export type CheckSource = 'bim' | 'calc' | 'dict' | 'edit' | 'idf'

export type SpaceCheckItem = {
  key: SpaceCheckKey
  state: CheckState
  source?: CheckSource
  /** 빔이거나 해당 없음일 때 왜인지 한 줄. */
  note?: string
  /** 이 항목을 비게 한 설비(5·6·8번) 또는 화면에서만 닿는 원천(7번). 화면이 [고치기] 로 고른다. */
  ids?: string[]
}

export type SpaceChecklist = { spaceId: string; items: SpaceCheckItem[]; have: number; of: number }

/** 항목 이름. 화면과 시험이 같이 쓴다. */
export const CHECK_LABELS: Record<SpaceCheckKey, string> = {
  outline: '외곽선',
  label: '공간명',
  number: '방번호',
  kind: '방 종류',
  unplaced: '경계 근처 미소속 기기 없음',
  terminalSource: '말단–원천',
  supplyTtl: '급기가 TTL 에 나감',
  system: '말단·VAV 계통',
  zone: '공조존',
}

/** 공조 대상이 아닌 방 종류(9번 해당 없음). 종류가 빈 방은 공조 대상으로 본다. */
const NON_AIR_KINDS = new Set(['staircase', 'elevator_shaft'])
/** 소속 없는 기기가 이 방 경계에서 이만큼 안이면 이 방 것일 가능성이 크다(m). */
export const NEAR_M = 0.5

/** 건물 전체를 한 번 훑어 둔 것. 층의 방마다 다시 훑지 않는다 — 성수 한 층이 방 백여 개다. */
export type ChecklistContext = {
  /** 화면 방향(규칙 포함)으로 원천에 닿는 말단. */
  reached: ReadonlySet<string>
  /** 화면 방향으로 급기 말단인 것. */
  supplyTerminals: ReadonlySet<string>
  /** 확정된 방향(내보내기와 같다)으로 급기를 받는 방. */
  suppliedTtl: ReadonlySet<string>
  /** 화면 방향으로 급기를 받는 방과 그 원천. */
  suppliedScreen: ReadonlyMap<string, string[]>
  /** 공조존에 든 방과 그 존의 출처. 온톨로지에 나가는 것만이다 — IDF 공조존의 든 방은 사람이 확인해야 나간다(idf/confirm.ts). */
  zoned: ReadonlyMap<string, 'idf' | 'edit'>
  /** IDF 공조존에 들었지만 매칭을 아직 확인하지 않아 나가지 않는 방. */
  unconfirmed: ReadonlySet<string>
  hasZones: boolean
}

/** 화면이 이미 센 화면 방향 원천(`screen`)이 있으면 넘긴다. 없으면 여기서 센다. 확정 방향은 늘 여기서 센다. */
export function checklistContext(model: Model, screen?: readonly AirService[]): ChecklistContext {
  const shown = screen ?? airServices(model, withInferred(model.connections))
  // 내보내기(ttl.ts)와 같은 연결이다 — 확정된 방향만, 유체가 흐르는 것만.
  const confirmed = airServices(model, fluidConnections(model, withInferred(model.connections, true)))
  const spaceOf = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.spaceId]))
  const reached = new Set<string>()
  const supplyTerminals = new Set<string>()
  const suppliedScreen = new Map<string, string[]>()
  for (const s of shown) {
    for (const t of s.extract) reached.add(t)
    for (const t of s.supply) {
      reached.add(t)
      supplyTerminals.add(t)
      const room = spaceOf.get(t)
      if (room && !suppliedScreen.get(room)?.includes(s.sourceId)) suppliedScreen.set(room, [...(suppliedScreen.get(room) ?? []), s.sourceId])
    }
  }
  const suppliedTtl = new Set(confirmed.flatMap((s) => s.supply.map((t) => spaceOf.get(t)).filter((x): x is string => !!x)))
  const zones = hvacZonesOf(model)
  const zoned = new Map<string, 'idf' | 'edit'>()
  const unconfirmed = new Set<string>()
  for (const z of zones) {
    const out = new Set(exportedSpaceIds(model, z))
    for (const id of z.spaceIds) {
      if (out.has(id)) zoned.set(id, z.source === 'edit' ? 'edit' : 'idf')
      else unconfirmed.add(id)
    }
  }
  return { reached, supplyTerminals, suppliedTtl, suppliedScreen, zoned, unconfirmed, hasZones: zones.length > 0 }
}

const at2 = (e: Equipment) => [e.position![0], e.position![1]] as const

/** 층 안에서 방마다 다시 훑지 않게 한 번 묶어 둔 것. */
type StoreyIndex = { sameNumber: number; inside: readonly Equipment[]; unplaced: readonly Equipment[] }
function indexOf(storey: Storey, space: Space): StoreyIndex {
  return {
    sameNumber: storey.spaces.filter((s) => s.name === space.name).length,
    inside: storey.equipment.filter((e) => e.spaceId === space.id),
    unplaced: storey.equipment.filter((e) => !e.spaceId && e.position && !isConduit(e.role)),
  }
}

/** 방 하나. `storey` 는 그 방이 든 층이다. */
export function spaceChecklist(storey: Storey, space: Space, ctx: ChecklistContext, index: StoreyIndex = indexOf(storey, space)): SpaceChecklist {
  const { sameNumber } = index
  const items: SpaceCheckItem[] = []
  const bimOrEdit: CheckSource = space.added ? 'edit' : 'bim'
  const outline = space.footprint.length >= 3
  items.push({ key: 'outline', state: outline ? 'ok' : 'empty', source: outline ? bimOrEdit : undefined, note: outline ? undefined : 'GeoJSON 의 geometry 가 null 로 나갑니다' })
  const label = !!space.longName?.trim()
  items.push({ key: 'label', state: label ? 'ok' : 'empty', source: label ? bimOrEdit : undefined })
  const number = !!space.name?.trim()
  items.push({
    key: 'number',
    state: number && sameNumber === 1 ? 'ok' : 'empty',
    source: number ? bimOrEdit : undefined,
    note: !number ? undefined : sameNumber > 1 ? `같은 층에 방번호 ${space.name} 이 ${sameNumber}개입니다` : undefined,
  })
  items.push({ key: 'kind', state: space.kind ? 'ok' : 'empty', source: space.kind ? (space.kindSource ?? 'dict') : undefined, note: space.kind ? undefined : 'brick:Room 으로 나갑니다' })

  const near = outline
    ? index.unplaced.filter((e) => pointInPolygon(at2(e), space.footprint) || distanceToRing(at2(e), space.footprint) < NEAR_M)
    : []
  items.push({ key: 'unplaced', state: outline ? (near.length ? 'empty' : 'ok') : 'na', source: 'calc', ids: near.length ? near.map((e) => e.id) : undefined, note: near.length ? `소속 없는 기기 ${near.length}대가 이 방 경계에 있습니다` : undefined })

  const inside = index.inside
  const terminals = inside.filter((e) => isAirTerminal(e))
  const lost = terminals.filter((t) => !ctx.reached.has(t.id))
  items.push(
    terminals.length
      ? { key: 'terminalSource', state: lost.length ? 'empty' : 'ok', ids: lost.length ? lost.map((e) => e.id) : undefined, note: lost.length ? `말단 ${lost.length}개가 원천에 닿지 않습니다` : undefined }
      : { key: 'terminalSource', state: 'na', note: '공기 말단이 없습니다' },
  )

  const supply = terminals.some((t) => ctx.supplyTerminals.has(t.id))
  if (!supply) items.push({ key: 'supplyTtl', state: 'na', note: terminals.length ? '급기 말단이 없습니다(환기만)' : '공기 말단이 없습니다' })
  else if (ctx.suppliedTtl.has(space.id)) items.push({ key: 'supplyTtl', state: 'ok' })
  else {
    const shown = ctx.suppliedScreen.get(space.id) ?? []
    items.push({ key: 'supplyTtl', state: 'empty', source: 'dict', ids: shown, note: '규칙 방향으로만 닿습니다 — 확정하면 TTL 에 나갑니다' })
  }

  const needing = inside.filter(needsSystem)
  const loose = needing.filter((e) => !e.systemId)
  items.push(
    needing.length
      ? { key: 'system', state: loose.length ? 'empty' : 'ok', ids: loose.length ? loose.map((e) => e.id) : undefined, note: loose.length ? `계통 없는 VAV·말단 ${loose.length}개` : undefined }
      : { key: 'system', state: 'na', note: 'VAV·말단이 없습니다' },
  )

  const zone = ctx.zoned.get(space.id)
  if (!ctx.hasZones) items.push({ key: 'zone', state: 'na', note: '이 건물에 공조존이 없습니다' })
  else if (NON_AIR_KINDS.has(space.kind ?? '')) items.push({ key: 'zone', state: 'na', note: '공조 대상이 아닌 방입니다' })
  else if (zone) items.push({ key: 'zone', state: 'ok', source: zone })
  else items.push({ key: 'zone', state: 'empty', ...(ctx.unconfirmed.has(space.id) ? { note: 'IDF 공조존 매칭을 확인하기 전이라 온톨로지에 나가지 않습니다' } : {}) })

  const counted = items.filter((x) => x.state !== 'na')
  return { spaceId: space.id, items, have: counted.filter((x) => x.state === 'ok').length, of: counted.length }
}

/** 층의 방 전부. 방번호 겹침은 층 안에서 센다. */
export function storeyChecklists(storey: Storey, ctx: ChecklistContext): Map<string, SpaceChecklist> {
  const count = new Map<string, number>()
  for (const s of storey.spaces) count.set(s.name, (count.get(s.name) ?? 0) + 1)
  const inside = new Map<string, Equipment[]>()
  const unplaced: Equipment[] = []
  for (const e of storey.equipment) {
    if (e.spaceId) {
      const list = inside.get(e.spaceId)
      if (list) list.push(e)
      else inside.set(e.spaceId, [e])
    } else if (e.position && !isConduit(e.role)) unplaced.push(e)
  }
  return new Map(storey.spaces.map((s) => [s.id, spaceChecklist(storey, s, ctx, { sameNumber: count.get(s.name) ?? 1, inside: inside.get(s.id) ?? [], unplaced })]))
}

export const isFull = (c: SpaceChecklist) => c.have === c.of
