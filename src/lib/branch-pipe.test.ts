// 층별 분기(OE-ML-13). mep.ifc(1F: AHU-1(1,1,3.2))에 2층(4m)·3층(8m)을 얹고, 2층에 AT-201(5,5,6.7)·AT-202(3,3,6.7)을 둔다.
// 주 배관은 그린 SA 라이저다: AHU-1 → (1,1,6.5) → (5,1,6.5) → AT-201. 첫 구간 "SA 덕트 1" 이 1층 소속의 수직 구간(3.2 → 6.5m)이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { drawPipe } from './manual-pipe'
import { branchPipe, type BranchSpec } from './branch-pipe'
import { baselineOf, restore, snapshotEquipment, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { releaseConnection, snapshotRelease } from './connection-release'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { segmentPath, type Model, type Storey } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const homeOf = (m: Model, id: string) => m.storeys.find((s) => s.equipment.some((e) => e.id === id))!.id
const tower = (): Model => {
  const m = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  const at = equip(m, 'AT-101-01')
  const floor = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [], walls: [], openings: [], equipment: [] })
  const f2 = floor('2F', 4)
  for (const [id, position] of [['AT-201', [5, 5, 6.7]], ['AT-202', [3, 3, 6.7]]] as const)
    f2.equipment.push({ ...structuredClone(at), id, name: id, position: [...position], systemId: null })
  m.storeys.push(f2, floor('3F', 8))
  return m
}
/** 주 배관(라이저)을 그린 모델. */
const withRiser = (m = tower()) => {
  const done = drawPipe(m, { from: equip(m, 'AHU-1').id, to: 'AT-201', via: [[1, 1, 6.5], [5, 1, 6.5]], flowType: 'SA', range: [m.storeys[0].id, '2F'] })
  if ('refused' in done) throw new Error(done.refused)
  return { m, riser: done.segments[0], top: done.fittings[0] }
}
const range = (m: Model) => [m.storeys[0].id, '2F']
/** 라이저의 2층 바닥에서 1m(z 5.0) 자리에서 (3,3) 으로 옆으로 나가 AT-202 로 올라간다. */
const branch = (m: Model, riser: string, over: Partial<BranchSpec> = {}) =>
  branchPipe(m, { segmentId: riser, at: { at: [1, 1], storeyId: '2F', height: 1 }, to: 'AT-202', via: [{ at: [3, 3], storeyId: '2F', height: 1 }], flowType: 'SA', range: range(m), ...over })
/** 화면이 쓰는 되돌리기와 같은 모양: 나눈 구간·그 연결의 이전 상태, 새로 생긴 것은 "없던 상태". */
const undoOf = (m: Model, segId: string) => {
  const before: Snapshot[] = [snapshotEquipment(m, segId)!, ...m.connections.filter((c) => c.from === segId || c.to === segId).map((c) => snapshotRelease(m, c))]
  return (made: { id: string }[], storeyOf: Map<string, string>): Snapshot => ({
    kind: 'many',
    parts: [
      ...made.map((x) => ({ kind: 'equipment-set' as const, equipment: x as never, storeyId: storeyOf.get(x.id)!, index: 0, present: false, connections: [], systems: [] })),
      ...before,
    ],
  })
}

describe('층별 분기 (OE-ML-13)', () => {
  it('라이저의 2층 높이 자리에 분기점을 넣어 구간을 둘로 나누고, 거기서 2층 설비까지 잇는다 [OE-ML-13#1] [OE-ML-13#2~]', () => {
    const { m, riser, top } = withRiser()
    const done = branch(m, riser.id)
    if ('refused' in done) throw new Error(done.refused)
    // 분기점은 고른 높이(2층 바닥 + 1m = 5m)이고 그 높이가 든 2층의 이음쇠다.
    expect([done.tee.position, done.tee.role, done.tee.flowType, homeOf(m, done.tee.id), done.reused]).toEqual([[1, 1, 5], 'fitting', 'SA', '2F', false])
    // 앞 구간은 분기점까지 줄고, 뒤 구간이 분기점에서 옛 끝(꺾임 이음쇠)까지 새로 생긴다.
    expect(segmentPath(riser)).toEqual({ path: [[1, 1, 3.2], [1, 1, 5]] })
    expect(segmentPath(done.tail!)).toEqual({ path: [[1, 1, 5], [1, 1, 6.5]] })
    expect(homeOf(m, done.tail!.id)).toBe('2F')
    const linked = (a: string, b: string) => m.connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))
    expect([linked(riser.id, done.tee.id), linked(done.tee.id, done.tail!.id), linked(done.tail!.id, top.id), linked(riser.id, top.id)]).toEqual([true, true, true, false])
    // 옛 연결은 사람이 이은 것이라 지웠다(해제 보정은 BIM 포트 연결만).
    expect(done.replaced).toMatchObject({ released: false })
    // 분기: 분기점 → (3,3,5) → AT-202. 새 연결은 모두 manual 이고 방향이 없다.
    expect(done.segments.map((e) => segmentPath(e))).toEqual([{ path: [[1, 1, 5], [3, 3, 5]] }, { path: [[3, 3, 5], [3, 3, 6.7]] }])
    expect(done.connections.every((c) => c.source === 'manual' && !c.directed)).toBe(true)
    expect(m.connections.filter((c) => c.to === 'AT-202' || c.from === 'AT-202')).toHaveLength(1)
  })

  it('구간 끝 5cm 안이면 새 분기점 없이 끝의 이음쇠를 다시 쓴다 [OE-ML-13#2]', () => {
    const { m, riser, top } = withRiser()
    const count = () => m.storeys.flatMap((s) => s.equipment).length
    const before = count()
    const done = branch(m, riser.id, { at: [1, 1, 6.47] })
    if ('refused' in done) throw new Error(done.refused)
    expect([done.reused, done.tee.id, done.tail]).toEqual([true, top.id, null])
    expect(segmentPath(riser)).toEqual({ path: [[1, 1, 3.2], [1, 1, 6.5]] })
    // 분기 구간 둘과 꺾임 이음쇠 하나만 늘었다.
    expect(count() - before).toBe(3)
  })

  it('끝의 이음쇠가 다른 Flow Type·계통이거나, 해제 보정한 연결 너머이면 다시 쓰지 않고 거절한다 [OE-ML-13#7]', () => {
    const other = withRiser()
    other.top.flowType = 'RA'
    const before = JSON.stringify(other.m)
    expect(branch(other.m, other.riser.id, { at: [1, 1, 6.47] })).toEqual({ refused: '끝의 SA 이음 2은(는) Flow Type·계통이 달라 분기점으로 쓰지 않습니다. 끝에서 떨어진 자리를 고르세요.' })
    expect(JSON.stringify(other.m)).toBe(before)
    // 좌표는 같아도 계통이 다른 이음쇠(공조기 계통)도 쓰지 않는다.
    const sys = withRiser()
    sys.top.systemId = equip(sys.m, 'AHU-1').systemId
    expect(branch(sys.m, sys.riser.id, { at: [1, 1, 6.47] })).toEqual({ refused: '끝의 SA 이음 2은(는) Flow Type·계통이 달라 분기점으로 쓰지 않습니다. 끝에서 떨어진 자리를 고르세요.' })

    // BIM 포트 연결이었다고 치고 사람이 해제 보정했다. 그 끝의 이음쇠는 분기로 되살리지 않는다.
    const { m, riser, top } = withRiser()
    const c = m.connections.find((x) => (x.from === riser.id && x.to === top.id) || (x.to === riser.id && x.from === top.id))!
    c.source = 'port'
    releaseConnection(m, c, '시험')
    const released = JSON.stringify(m.releasedConnections)
    expect(branch(m, riser.id, { at: [1, 1, 6.47] })).toEqual({
      refused: '그 자리는 SA 덕트 1의 끝입니다. 끝에 분기점으로 쓸 이음쇠가 없습니다 — 끝에서 5cm 넘게 떨어진 자리를 고르세요.',
    })
    expect(JSON.stringify(m.releasedConnections)).toBe(released)
  })

  it('구간 위가 아닌 자리, 다른 매체·Flow Type 은 거절하고 모델을 바꾸지 않는다 [OE-ML-13#3~] [OE-ML-13#4~]', () => {
    const { m, riser } = withRiser()
    const before = JSON.stringify(m)
    expect(branch(m, riser.id, { at: [2, 1, 5] })).toEqual({ refused: '분기 자리가 SA 덕트 1 위에 있지 않습니다(1.00m 떨어짐). 구간 위를 찍습니다.' })
    expect(branch(m, riser.id, { flowType: 'CHWS' })).toEqual({ refused: '매체가 다릅니다: SA 덕트 1은(는) 공기 덕트인데 CHWS 는 공기가 아닌 매체입니다. 같은 매체로 분기합니다.' })
    expect(branch(m, riser.id, { flowType: 'RA' })).toEqual({ refused: '주 배관의 Flow Type(SA)과 다릅니다. 분기는 주 배관과 같은 Flow Type 으로 그립니다.' })
    // 분기 자리가 범위 밖이면 막고, 분기 경로가 거절되면(끝이 범위 밖) 넣어 보던 분기점도 걷는다.
    expect(branch(m, riser.id, { range: [m.storeys[0].id] })).toEqual({ refused: '분기 자리의 층(2F)이 보기 범위 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.' })
    expect(branch(m, riser.id, { to: 'AHU-X' })).toEqual({ refused: '시작이나 끝 대상을 찾지 못했습니다.' })
    expect(JSON.stringify(m)).toBe(before)
  })

  it('나눈 끝이 BIM 포트 연결이면 지우지 않고 해제 보정으로 남긴다 [OE-PIP-15#6~]', () => {
    const { m, riser, top } = withRiser()
    const c = m.connections.find((x) => (x.from === riser.id && x.to === top.id) || (x.to === riser.id && x.from === top.id))!
    c.source = 'port'
    const done = branch(m, riser.id)
    if ('refused' in done) throw new Error(done.refused)
    expect(done.replaced).toEqual({ connection: c, released: true })
    expect(m.releasedConnections?.map((r) => [r.connection, r.reason])).toEqual([[c, '분기점 넣기: SA 덕트 1을 SA 분기 6에서 나눔']])
    expect(m.connections).not.toContain(c)
  })

  it('되돌리기 한 번이면 분기 전과 같고, 편집 파일로 새로 연 모델에 얹으면 같은 분기다 [OE-ML-13#6]', () => {
    const { m, riser } = withRiser()
    const base = baselineOf(tower())
    const before = JSON.stringify(m)
    const undo = undoOf(m, riser.id)
    const done = branch(m, riser.id)
    if ('refused' in done) throw new Error(done.refused)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = tower()
    applyEdits(again, file)
    expect(modelToTTL(again)).toBe(modelToTTL(m))
    expect(JSON.stringify(modelToGeoJSON(again))).toBe(JSON.stringify(modelToGeoJSON(m)))
    restore(m, undo([done.tee, done.tail!, ...done.segments, ...done.fittings], done.storeyOf))
    expect(JSON.stringify(m)).toBe(before)
  })
})
