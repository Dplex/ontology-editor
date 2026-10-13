import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { compareVersions, fingerprints, matchFingerprints, revitElementId, type Fingerprint } from './versions'
import { importIfc } from './ifc/import'
import { baselineOf, moveEquipment, renameSpace } from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { requirementsReport } from './requirements'
import { polygonArea, type Equipment, type Model, type Space, type Storey, type Vec2 } from './model'

// 같은 건물의 두 판본을 손으로 만든다. 실제 재내보내기처럼 GUID 는 일부만 남고, 이름·Revit 요소 ID·위치는 남는다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]
const space = (id: string, name: string, longName: string, footprint: Vec2[]): Space => ({
  id,
  name,
  longName,
  footprint,
  areaM2: polygonArea(footprint),
  boundedBy: [],
})
const device = (id: string, name: string, position: Equipment['position'], extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name,
  ifcClass: 'FlowTerminal',
  role: 'terminal',
  position,
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId: null,
  spaceSource: null,
  ...extra,
})
const storey = (id: string, name: string, parts: Partial<Storey> = {}): Storey => ({
  id,
  name,
  elevation: 0,
  spaces: [],
  walls: [],
  openings: [],
  equipment: [],
  ...parts,
})
const model = (storeys: Storey[]): Model => ({
  schema: 'IFC2X3',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys,
  systems: [],
  connections: [],
  warnings: [],
})

describe('판본 짝짓기', () => {
  it('Revit 요소 ID 는 이름 끝의 숫자다', () => {
    expect(revitElementId('Pipe Types:Mechanical Pipe:557564')).toBe('557564')
    expect(revitElementId('AHU-1')).toBeNull()
    // 짧은 숫자는 요소 ID 가 아니라 이름의 일부일 수 있다.
    expect(revitElementId('Fan:12')).toBeNull()
  })

  it('GUID → Revit 요소 ID → 이름 → 위치 순으로 짓는다', () => {
    const prev = model([
      storey('L1', 'Level 1', {
        spaces: [space('s-kitchen', 'A103', 'Kitchen', rect(0, 0, 4, 4)), space('s-living', 'A102', 'Living', rect(4, 0, 10, 4))],
        equipment: [
          device('e-same', 'Diffuser:600:1001', [1, 1, 2.7]),
          device('e-pipe', 'Pipe Types:Mechanical Pipe:557564', [2, 2, 3]),
          device('e-ahu', 'AHU-1', [5, 2, 3]),
          device('e-anon', '', [8, 3, 2.7]),
        ],
      }),
    ])
    const next = model([
      storey('L1-new', 'Level 1', {
        spaces: [space('s-kitchen-new', 'A103', 'Kitchen', rect(0, 0, 4, 4)), space('s-living-new', 'A102', 'Living', rect(4, 0, 10, 4))],
        equipment: [
          device('e-same', 'Diffuser:600:1001', [1, 1, 2.7]),
          // 같은 요소인데 GUID 와 유형 이름이 바뀌었다(Duplex MEP-2 의 엘보가 이랬다).
          device('e-pipe-new', 'Pipe Types:Standard:557564', [2, 2, 3]),
          device('e-ahu-new', 'AHU-1', [5.5, 2, 3]),
          device('e-anon-new', '', [8.01, 3, 2.7]),
          device('e-added', 'Grille:300:2002', [9, 3, 2.7]),
        ],
      }),
    ])
    const m = matchFingerprints(fingerprints(prev), fingerprints(next))
    expect(m.pairs.get('e-same')).toEqual({ id: 'e-same', by: 'guid' })
    expect(m.pairs.get('e-pipe')).toEqual({ id: 'e-pipe-new', by: 'revitId' })
    expect(m.pairs.get('e-ahu')).toEqual({ id: 'e-ahu-new', by: 'name' })
    expect(m.pairs.get('e-anon')).toEqual({ id: 'e-anon-new', by: 'position' })
    expect(m.pairs.get('s-kitchen')).toEqual({ id: 's-kitchen-new', by: 'name' })
    expect(m.pairs.get('L1')).toEqual({ id: 'L1-new', by: 'name' })
    expect(m.added).toEqual(['e-added'])
    expect(m.removed).toEqual([])
  })

  it('한 열쇠에 둘 이상이 걸리면 그 열쇠로는 짓지 않는다', () => {
    // 같은 번호·이름·자리의 방이 두 번 들어 있다(Duplex MEP-2 가 이렇다). 어느 쪽이 그 방인지 모르면 짓지 않는다.
    const twin = (id: string) => space(id, 'B102', 'Living Room', rect(0, 0, 5, 5))
    const prev = model([storey('L1', 'Level 1', { spaces: [twin('old')] })])
    const next = model([storey('L1', 'Level 1', { spaces: [twin('new-a'), twin('new-b')] })])
    const m = matchFingerprints(fingerprints(prev), fingerprints(next))
    expect(m.pairs.has('old')).toBe(false)
    expect(m.removed).toEqual(['old'])
  })

  it('위치는 무리가 같고 서로가 하나뿐일 때만 짓는다', () => {
    const at = (id: string, x: number, cls = 'FlowTerminal') => device(id, '', [x, 0, 0], { ifcClass: cls })
    const prev = model([storey('L1', '1F', { equipment: [at('a', 0), at('b', 10), at('c', 20, 'FlowSegment')] })])
    const next = model([
      storey('L1', '1F', {
        // b 자리에는 둘이 겹쳐 있다. c 자리에는 클래스가 다른 것만 있다.
        equipment: [at('a2', 0.01), at('b2', 10), at('b3', 10.02), at('c2', 20)],
      }),
    ])
    const m = matchFingerprints(fingerprints(prev), fingerprints(next))
    expect(m.pairs.get('a')).toEqual({ id: 'a2', by: 'position' })
    expect(m.pairs.has('b')).toBe(false)
    expect(m.pairs.has('c')).toBe(false)
  })

  it('지문 없이 id 만 있으면(옛 편집 파일) GUID 로만 찾는다', () => {
    const next = model([storey('L1', '1F', { equipment: [device('x', 'AHU-1', [0, 0, 0])] })])
    const prev = new Map<string, Partial<Fingerprint>>([
      ['x', {}],
      ['gone', {}],
    ])
    const m = matchFingerprints(prev, fingerprints(next))
    expect(m.pairs.get('x')).toEqual({ id: 'x', by: 'guid' })
    expect(m.removed).toEqual(['gone'])
  })
})

describe('두 판본 견주기', () => {
  it('추가·삭제·이동·소속 변화·이름 변화를 센다', () => {
    const prev = model([
      storey('L1', '1F', {
        spaces: [space('r1', '101', '사무실', rect(0, 0, 10, 8)), space('r2', '102', '창고', rect(10, 0, 14, 8))],
        equipment: [
          device('fcu', 'FCU:FCU:500001', [2, 2, 2.7], { spaceId: 'r1' }),
          device('grille', 'Grille:300:500002', [12, 2, 2.7], { spaceId: 'r2' }),
          device('old', 'Diffuser:600:500003', [5, 5, 2.7], { spaceId: 'r1' }),
        ],
      }),
    ])
    const next = model([
      storey('L1', '1F', {
        spaces: [space('r1-v2', '101', '사무실', rect(0, 0, 10, 8)), space('r2', '102', '자료실', rect(10, 0, 16, 8))],
        equipment: [
          device('fcu-v2', 'FCU:FCU:500001', [12, 2, 2.7], { spaceId: 'r2' }),
          device('grille', 'Grille:300:500002', [12, 2, 2.7], { spaceId: 'r2' }),
          device('new', 'Diffuser:600:500009', [5, 5, 2.7], { spaceId: 'r1-v2' }),
        ],
      }),
    ])
    const d = compareVersions(prev, next)
    expect(d.spaces.by).toMatchObject({ guid: 1, name: 1 })
    expect(d.spaces.renamed).toEqual([{ id: 'r2', from: '창고', to: '자료실' }])
    expect(d.spaces.reshaped.map((r) => r.id)).toEqual(['r2'])
    expect(d.equipment.by).toMatchObject({ guid: 1, revitId: 1 })
    expect(d.equipment.added.map((e) => e.id)).toEqual(['new'])
    expect(d.equipment.removed.map((e) => e.id)).toEqual(['old'])
    expect(d.equipment.moved.map((e) => e.id)).toEqual(['fcu-v2'])
    // 사무실의 GUID 가 바뀌었어도 짝지은 방으로 견주므로, 제자리인 그릴은 소속이 바뀐 것이 아니다.
    expect(d.equipment.relocated).toEqual([{ id: 'fcu-v2', name: 'FCU:FCU:500001', from: '1F 사무실 (101)', to: '1F 자료실 (102)' }])
  })

  it('원점을 옮겨 다시 낸 판본은 좌표 차이를 맞춘 뒤 위치로 짓고, 옮긴 것으로 세지 않는다 [OE-BIM-19#2]', () => {
    // 이름 있는 설비 넷은 GUID 가 그대로라 좌표 차이(100, 50, 0)를 잴 수 있다. 이름 없는 둘은 위치로만 찾는다.
    const at = (id: string, name: string, x: number, y: number, dx = 0, dy = 0) => device(id, name, [x + dx, y + dy, 2.7])
    const room = (id: string, dx = 0, dy = 0) => space(id, '101', '사무실', rect(dx, dy, 10 + dx, 8 + dy))
    const build = (dx: number, dy: number, suffix: string) =>
      model([
        storey('L1', '1F', {
          spaces: [room(`r${suffix}`, dx, dy)],
          equipment: [
            at('a', 'FCU-1', 1, 1, dx, dy),
            at('b', 'FCU-2', 3, 1, dx, dy),
            at('c', 'FCU-3', 5, 1, dx, dy),
            at('d', 'FCU-4', 7, 1, dx, dy),
            at(`x${suffix}`, '', 2, 6, dx, dy),
            at(`y${suffix}`, '', 8, 6, dx, dy),
          ],
        }),
      ])
    const d = compareVersions(build(0, 0, ''), build(100, 50, '-v2'))
    expect(d.normalized.offset).toEqual([100, 50, 0])
    expect(d.normalized.scale).toBeNull()
    expect(d.equipment.by).toMatchObject({ guid: 4, position: 2 })
    expect(d.equipment.moved).toEqual([])
    expect([d.equipment.added, d.equipment.removed, d.equipment.ambiguous]).toEqual([[], [], []])
    // 물리존도 옮긴 원점으로 맞춰 이름으로 짓고, 넓이는 그대로라 바뀐 것이 아니다.
    expect(d.spaces.by.name).toBe(1)
    expect(d.spaces.reshaped).toEqual([])
  })

  it('길이 단위 선언이 틀린 판본은 층 높이로 잰 배수로 좌표·넓이를 맞춰 견준다 [OE-BIM-19#2]', () => {
    // 이전 판본은 밀리미터를 미터로 적어 1/1000 로 들어왔다(Duplex COBie Design 이 이랬다). 이름 없는 설비는 위치로만 찾는다.
    const levels = (k: number) => [storey('L1', 'Level 1', { elevation: 0 }), storey('L2', 'Level 2', { elevation: 3.1 * k })]
    const prev = model(levels(0.001))
    prev.storeys[0].spaces = [space('r', '101', '사무실', rect(0, 0, 0.01, 0.008))]
    prev.storeys[0].equipment = [device('e', '', [0.002, 0.002, 0.0027])]
    const next = model(levels(1))
    next.storeys[0].spaces = [space('r', '101', '사무실', rect(0, 0, 10, 8))]
    next.storeys[0].equipment = [device('e-v2', '', [2, 2, 2.7])]
    const d = compareVersions(prev, next)
    expect(d.normalized.scale).toBeCloseTo(1000)
    expect(d.equipment.by.position).toBe(1)
    expect(d.equipment.moved).toEqual([])
    expect(d.spaces.reshaped).toEqual([])
  })

  it('이름은 공백·유니코드 조합을 맞춰 견준다 [OE-BIM-19#2]', () => {
    const prev = model([storey('L1', '1F', { equipment: [device('a', '공조기  1 '.normalize('NFD'), [0, 0, 0])] })])
    const next = model([storey('L1', '1F', { equipment: [device('a-v2', '공조기 1', [30, 0, 0])] })])
    const d = compareVersions(prev, next)
    expect(d.equipment.by.name).toBe(1)
  })

  it('후보가 여럿이라 짓지 않은 것은 없어진 것·새것과 따로 "모호" 로 세고, GUID 유지율의 분모에 넣지 않는다 [OE-BIM-19#3]', () => {
    // 같은 번호·이름·자리의 방이 지금 판본에 두 번 들어 있다(Duplex MEP-2 가 이렇다). 사무실은 GUID 그대로다.
    const twin = (id: string) => space(id, 'B102', 'Living Room', rect(0, 0, 5, 5))
    const office = space('office', 'B101', 'Office', rect(10, 0, 15, 5))
    const prev = model([storey('L1', 'Level 1', { spaces: [twin('old'), office] })])
    const next = model([storey('L1', 'Level 1', { spaces: [twin('new-a'), twin('new-b'), office, space('gym', 'B103', 'Gym', rect(20, 0, 25, 5))] })])
    const d = compareVersions(prev, next)
    expect(d.spaces.ambiguous.map((r) => [r.id, r.side])).toEqual([
      ['old', 'prev'],
      ['new-a', 'next'],
      ['new-b', 'next'],
    ])
    expect(d.spaces.ambiguous[1].keys).toContain('name')
    // 미매칭은 정말 후보가 없던 것뿐이다.
    expect(d.spaces.removed).toEqual([])
    expect(d.spaces.added.map((r) => r.id)).toEqual(['gym'])
    // 분모는 짝지은 것(사무실 하나)이다.
    expect(d.spaces.by).toMatchObject({ guid: 1, revitId: 0, name: 0, position: 0 })
  })
})

// 실제 임포터를 거친다. mep-v2.ifc 는 mep.ifc 를 다시 내보낸 판본이다(사무실·공조기 GUID 가 바뀌고, 토출구 하나가
// 옮겨지고, 센서가 빠지고, 토출구 하나가 더해졌다).
describe('판본 비교 (mep.ifc → mep-v2.ifc)', () => {
  let api: WebIFC.IfcAPI
  beforeAll(async () => {
    api = new WebIFC.IfcAPI()
    await api.Init()
  }, 60_000)
  const read = (name: string) =>
    importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))
  const named = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

  it('GUID 가 바뀐 것은 이름으로 찾고, 옮김·추가·삭제를 센다', () => {
    const d = compareVersions(read('mep.ifc'), read('mep-v2.ifc'))
    expect(d.spaces.by).toEqual({ guid: 0, revitId: 0, name: 1, position: 0 })
    expect(d.equipment.by).toEqual({ guid: 4, revitId: 0, name: 1, position: 0 })
    expect(d.equipment.added.map((e) => e.name)).toEqual(['AT-101-03'])
    expect(d.equipment.removed.map((e) => e.name)).toEqual(['TEMP-101-01'])
    expect(d.equipment.moved.map((e) => [e.name, e.distance])).toEqual([['AT-101-02', 2]])
    // 사무실 GUID 가 바뀌었어도 짝지은 방으로 견주므로 소속이 바뀐 설비는 없다.
    expect(d.equipment.relocated).toEqual([])
  })

  // OE-BIM-19 "R13 판정 근거". 숫자만이 아니라 어느 것의 GUID 가 바뀌었는지(지금 id·이전 GUID·무엇으로 찾았나)를 든다.
  it('GUID 가 바뀐 것을 하나하나 이전 GUID 와 찾은 열쇠로 든다', () => {
    const prev = read('mep.ifc')
    const next = read('mep-v2.ifc')
    const d = compareVersions(prev, next)
    const office = next.storeys.flatMap((s) => s.spaces)[0]
    const ahu = named(next, 'AHU-1')
    expect(d.spaces.rekeyed).toEqual([{ id: office.id, name: expect.stringContaining('사무실'), prevId: prev.storeys.flatMap((s) => s.spaces)[0].id, by: 'name' }])
    expect(d.equipment.rekeyed).toEqual([{ id: ahu.id, name: 'AHU-1', prevId: named(prev, 'AHU-1').id, by: 'name' }])
    // 개수는 by 와 같다 — 목록이 곧 R13 의 "다른 자리" 몫이다.
    for (const k of [d.spaces, d.equipment]) expect(k.rekeyed.length).toBe(k.by.revitId + k.by.name + k.by.position)
    for (const r of [...d.spaces.rekeyed, ...d.equipment.rekeyed]) expect(r.prevId).not.toBe(r.id)
  })

  it('요구사항 R13 이 GUID 가 남은 것과 다른 열쇠로 찾은 것을 센다', () => {
    const next = read('mep-v2.ifc')
    const d = compareVersions(read('mep.ifc'), next)
    const kept = d.spaces.by.guid + d.equipment.by.guid
    const rematched = d.spaces.by.name + d.equipment.by.name
    const r13 = requirementsReport(next, null, { name: 'mep.ifc', kept, rematched }).find((r) => r.id === 'R13')!
    expect(r13.state).toBe('elsewhere')
    expect(r13.counts).toEqual({ standard: 4, elsewhere: 2, of: 6 })
    // GUID 가 바뀐 것은 내보내기 설정으로 고쳐진다(정본 4.1 "GUID 유지 설정", OE-BIM-17).
    expect(r13.ask).toContain('내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장')
    expect(requirementsReport(next).find((r) => r.id === 'R13')!.state).toBe('unmeasured')
  })

  it('이전 판본에서 저장한 편집이 GUID 가 바뀐 설비·방에도 얹힌다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    renameSpace(a, a.storeys[0].spaces[0].id, '대회의실')
    moveEquipment(a, named(a, 'AHU-1').id, [2, 3, 3.2])
    const file = exportEdits(a, base, 'mep.ifc')

    const b = read('mep-v2.ifc')
    const result = applyEdits(b, file)
    expect(result.missing).toMatchObject({ equipment: 0, spaces: 0 })
    expect(result.rematched).toEqual({ revitId: 0, name: 2, position: 0 })
    expect(b.storeys[0].spaces[0].longName).toBe('대회의실')
    expect(named(b, 'AHU-1').position).toEqual([2, 3, 3.2])
  })
})
