import { describe, expect, it } from 'vitest'
import { dropDuplicateSpaces, mergeModels } from './merge'
import { countOf, polygonArea, type Equipment, type Model, type Space, type Storey, type Vec2 } from './model'

// 건축 파일과 설비 파일을 손으로 만든다. 실제 두 판본이 그렇듯 **층 GUID 가 서로 다르고**
// 이름과 높이만 같다. 건축 쪽에는 방이, 설비 쪽에는 설비가 있다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

const space = (id: string, name: string, footprint: Vec2[]): Space => ({
  id,
  name,
  longName: name,
  footprint,
  areaM2: polygonArea(footprint),
  boundedBy: [],
})

const device = (id: string, position: Equipment['position'], extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
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

const storey = (id: string, name: string, elevation: number, parts: Partial<Storey> = {}): Storey => ({
  id,
  name,
  elevation,
  spaces: [],
  walls: [],
  openings: [],
  equipment: [],
  ...parts,
})

const model = (storeys: Storey[], parts: Partial<Model> = {}): Model => ({
  schema: 'IFC4',
  siteName: '',
  buildingId: 'building',
  buildingName: '',
  storeys,
  systems: [],
  connections: [],
  warnings: [],
  ...parts,
})

/** 거실(0..6) 과 부엌(6..10) 두 칸짜리 1층, 빈 2층. */
function arch(): Model {
  return model(
    [
      storey('arch-L1', 'Level 1', 0, {
        spaces: [space('living', 'A102', rect(0, 0, 6, 5)), space('kitchen', 'A103', rect(6, 0, 10, 5))],
      }),
      storey('arch-L2', 'Level 2', 3.1),
    ],
    { buildingId: 'arch-building', buildingName: 'Duplex' },
  )
}

/** 거실 한가운데 토출구, 부엌 벽면 콘센트, 건물 밖 실외기. 층 GUID 는 건축과 다르다. */
function mep(shift: Vec2 = [0, 0]): Model {
  const at = (x: number, y: number, z: number): [number, number, number] => [x + shift[0], y + shift[1], z]
  return model(
    [
      storey('mep-L1', 'Level 1', 0, {
        equipment: [
          device('diffuser', at(3, 2.5, 2.7)),
          // 벽면(부엌 외곽선 x=10)에 정확히 붙은 콘센트. 점-다각형 판정만으로는 떨어진다.
          device('outlet', at(10, 2, 0.3)),
          device('condenser', at(14, 2, 0)),
        ],
      }),
    ],
    { buildingId: 'mep-building', warnings: ['설비 3대에 용량 파라미터가 없습니다.'] },
  )
}

const find = (m: Model, id: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)!

describe('건축 + 설비 합치기', () => {
  it('층 GUID 가 달라도 이름으로 맞추고, 설비 소속을 건축의 방으로 판정한다', () => {
    const { model: merged, report } = mergeModels(arch(), mep())

    // 설비 파일 혼자서는 방이 없어서 전부 미소속이다. 합쳐야 F11 이 나온다.
    expect(countOf(mep()).unlocatedEquipment).toBe(3)
    expect(merged.storeys.map((s) => s.id)).toEqual(['arch-L1', 'arch-L2'])
    expect(report.storeys).toEqual([{ name: 'Level 1', matchedTo: 'Level 1', by: 'name', elevationDelta: 0 }])

    expect(find(merged, 'diffuser').spaceId).toBe('living')
    expect(find(merged, 'diffuser').spaceSource).toBe('computed')
    // 벽면 콘센트는 외곽선 위에 있다. SNAP 안이라 부엌에 붙는다.
    expect(find(merged, 'outlet').spaceId).toBe('kitchen')
    // 건물 밖 실외기는 억지로 붙이지 않는다.
    expect(find(merged, 'condenser').spaceId).toBe(null)
    expect(report.unlocated).toEqual({ before: 3, after: 1 })
  })

  it('건물 주어는 건축 모델 것을 쓴다', () => {
    const { model: merged } = mergeModels(arch(), mep())
    expect(merged.buildingId).toBe('arch-building')
    expect(merged.buildingName).toBe('Duplex')
  })

  it('입력 모델을 건드리지 않는다', () => {
    const a = arch()
    const b = mep()
    const before = JSON.stringify([a, b])
    mergeModels(a, b)
    expect(JSON.stringify([a, b])).toBe(before)
  })

  it('경고에 어느 파일 이야기인지 이름표를 붙인다', () => {
    const { model: merged } = mergeModels(arch(), mep(), { base: 'Arch.ifc', overlay: 'HVAC.ifc' })
    expect(merged.warnings).toContain('[HVAC.ifc] 설비 3대에 용량 파라미터가 없습니다.')
  })
})

describe('좌표계 확인', () => {
  it('같은 자리면 조용하다', () => {
    const { model: merged, report } = mergeModels(arch(), mep())
    // 실외기는 건물 밖 4m 라 범위(±2m) 밖이다. 셋 중 둘이 안에 든다.
    expect(report.alignment).toEqual({ placed: 3, inside: 2, ratio: 2 / 3 })
    expect(merged.warnings.some((w) => w.includes('좌표계'))).toBe(false)
  })

  it('원점이 어긋나면 경고한다 — 합치기 자체는 성공하고 숫자만 틀리는 경우다', () => {
    // 측량 원점과 프로젝트 원점이 다른 파일. 파싱도 합치기도 오류 없이 끝난다.
    const { model: merged, report } = mergeModels(arch(), mep([1200, -800]))
    expect(report.alignment!.ratio).toBe(0)
    expect(report.unlocated.after).toBe(3)
    expect(merged.warnings.some((w) => w.includes('좌표계') && w.includes('0%'))).toBe(true)
  })

  it('짝 없는 층은 새 층으로 넣고 경고한다', () => {
    const b = mep()
    b.storeys.push(storey('mep-R', 'Penthouse', 9.9, { equipment: [device('fan', [3, 2, 10])] }))
    const { model: merged, report } = mergeModels(arch(), b)
    expect(report.storeys.at(-1)).toEqual({ name: 'Penthouse', matchedTo: null, by: null, elevationDelta: null })
    expect(merged.storeys.map((s) => s.name)).toEqual(['Level 1', 'Level 2', 'Penthouse'])
    expect(merged.warnings.some((w) => w.includes('"Penthouse"'))).toBe(true)
  })

  it('이름이 달라도 높이가 하나만 맞으면 짝짓는다', () => {
    const b = mep()
    b.storeys[0].name = '1F'
    const { report } = mergeModels(arch(), b)
    expect(report.storeys[0]).toMatchObject({ matchedTo: 'Level 1', by: 'elevation' })
  })

  it('이름은 같은데 높이가 다르면 기준점이 다를 수 있다고 알린다', () => {
    const b = mep()
    b.storeys[0].elevation = 0.6
    const { model: merged } = mergeModels(arch(), b)
    expect(merged.warnings.some((w) => w.includes('Level 1 +0.60m'))).toBe(true)
  })
})

describe('물리존이 양쪽에 있을 때', () => {
  it('같은 자리의 방은 한 번만 남기고, BIM 이 말한 소속은 남은 방으로 옮겨 적는다', () => {
    // Revit 설비 판본은 건축 Room 을 베낀 "MEP Space" 를 담고, 설비를 거기에 매단다.
    const b = mep()
    b.storeys[0].spaces = [space('living-mep', 'A102-M', rect(0, 0, 6, 5))]
    find(b, 'diffuser').spaceId = 'living-mep'
    find(b, 'diffuser').spaceSource = 'bim'

    const { model: merged, report } = mergeModels(arch(), b)
    expect(merged.storeys[0].spaces.map((s) => s.id)).toEqual(['living', 'kitchen'])
    expect(report.spaces).toEqual({ dropped: 1, kept: 0, borrowed: 0 })
    // 좌표로 다시 판정하지 않는다. BIM 이 한 말을 방 단위로 옮겨 적을 뿐이다.
    expect(find(merged, 'diffuser')).toMatchObject({ spaceId: 'living', spaceSource: 'bim' })
    expect(report.declaredRemapped).toEqual({ total: 1, remapped: 1 })
  })

  it('기준 모델에 없는 자리를 채우는 방은 받는다', () => {
    // 건축 판본의 복도가 외곽선을 못 낸 경우. 설비 판본의 복도가 그 빈자리를 채운다.
    const b = mep()
    b.storeys[0].spaces = [space('hall-mep', 'H1', rect(10, 0, 13, 5))]
    const { model: merged, report } = mergeModels(arch(), b)
    expect(merged.storeys[0].spaces.map((s) => s.id)).toEqual(['living', 'kitchen', 'hall-mep'])
    expect(report.spaces).toEqual({ dropped: 0, kept: 1, borrowed: 0 })
  })

  it('설비 판본 안에서도 같은 방이 두 번 나오면 하나만 받는다', () => {
    const b = mep()
    b.storeys[0].spaces = [space('hall-mep', 'H1-M', rect(10, 0, 13, 5)), space('hall-copy', 'H1', rect(10, 0, 13, 5))]
    const { model: merged } = mergeModels(arch(), b)
    expect(merged.storeys[0].spaces.map((s) => s.id)).toEqual(['living', 'kitchen', 'hall-mep'])
  })

  it('외곽선이 없는 기준 방은 같은 방 번호의 외곽선을 빌리고 id 는 지킨다', () => {
    const a = arch()
    a.storeys[1].spaces = [space('hall', 'A201', [])]
    const b = mep()
    b.storeys.push(
      storey('mep-L2', 'Level 2', 3.1, {
        spaces: [space('hall-mep', 'A201', rect(0, 0, 3, 2))],
        equipment: [device('light', [1, 1, 5.8])],
      }),
    )
    const { model: merged, report } = mergeModels(a, b)
    expect(merged.storeys[1].spaces).toHaveLength(1)
    expect(merged.storeys[1].spaces[0]).toMatchObject({ id: 'hall', areaM2: 6 })
    expect(report.spaces).toEqual({ dropped: 1, kept: 0, borrowed: 1 })
    expect(find(merged, 'light').spaceId).toBe('hall')
  })

  it('ㄱ 자 방은 넓이 중심이 아니라 안쪽 점으로 같은 자리를 본다', () => {
    // ㄱ 자의 넓이 중심 (2.2, 2.2) 는 방 밖, 오른쪽 위 빈칸에 떨어진다. 그 자리에 다른 방이
    // 있으면 중심으로 비교했을 때 엉뚱한 방과 "같은 자리" 가 된다.
    const L: Vec2[] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6], [0, 0]]
    const a = model([storey('a', 'Level 1', 0, { spaces: [space('corner', 'X', rect(2, 2, 6, 6))] })])
    const b = model([storey('b', 'Level 1', 0, { spaces: [space('ell', 'L', L)] })])
    const { model: merged } = mergeModels(a, b)
    expect(merged.storeys[0].spaces.map((s) => s.id)).toEqual(['corner', 'ell'])
  })
})

describe('계통과 연결', () => {
  it('같은 이름에서 세운 계통은 두 조각을 하나로 합친다', () => {
    const a = arch()
    a.systems = [{ id: 'system-Hydronic', name: 'Hydronic', memberIds: ['p1'], source: 'property' }]
    const b = mep()
    b.systems = [{ id: 'system-Hydronic', name: 'Hydronic', memberIds: ['p1', 'p2'], source: 'property' }]
    const { model: merged } = mergeModels(a, b)
    expect(merged.systems).toEqual([{ id: 'system-Hydronic', name: 'Hydronic', memberIds: ['p1', 'p2'], source: 'property' }])
  })

  it('같은 연결은 한 번만 남긴다', () => {
    const c = { from: 'x', to: 'y', source: 'geometry' as const, directed: false, tolerance: 0.005 }
    const { model: merged } = mergeModels(model([], { connections: [c] }), model([], { connections: [{ ...c, from: 'y', to: 'x' }] }))
    expect(merged.connections).toHaveLength(1)
  })

  it('두 파일에 같은 GlobalId 가 있으면 기준 모델 것을 남긴다', () => {
    const b = mep()
    b.storeys[0].equipment.push(device('living', [1, 1, 0]))
    const { report } = mergeModels(arch(), b)
    expect(report.duplicateIds).toBe(1)
  })
})

describe('한 파일 안의 같은 방 (dropDuplicateSpaces)', () => {
  const named = (id: string, name: string, longName: string, ring: Vec2[]) => ({ ...space(id, name, ring), longName })

  it('외곽선이 같고 이름이 같은 방을 말하면 하나만 남기고, 소속이 걸린 쪽을 남긴다', () => {
    const m = model([
      storey('L1', 'Level 1', 0, {
        spaces: [named('foyer', 'A101', 'Foyer', rect(0, 0, 4, 4)), named('foyer-m', 'A101-M', 'Foyer MEP Space', rect(0, 0, 4, 4))],
        equipment: [device('outlet', [0, 2, 0.3], { spaceId: 'foyer-m', spaceSource: 'bim' })],
        openings: [{ id: 'door', kind: 'door', name: '', width: null, height: null, wallId: null, passable: true, connects: ['foyer', 'hall'] }],
      }),
    ])
    expect(dropDuplicateSpaces(m)).toBe(1)
    expect(m.storeys[0].spaces.map((s) => s.id)).toEqual(['foyer-m'])
    expect(m.storeys[0].equipment[0].spaceId).toBe('foyer-m')
    // 버린 방을 가리키던 문은 남긴 방을 가리킨다.
    expect(m.storeys[0].openings[0].connects).toEqual(['foyer-m', 'hall'])
  })

  it('이름이 어긋나도 방 번호에 꼬리만 붙었으면 같은 방이다 — Duplex 의 A104 · A104-M', () => {
    const m = model([
      storey('L1', 'Level 1', 0, {
        spaces: [named('bath-m', 'A104-M', 'Bathroom MEP Space', rect(0, 0, 2, 2)), named('bath', 'A104', 'Bathroom 1', rect(0, 0, 2, 2))],
      }),
    ])
    expect(dropDuplicateSpaces(m)).toBe(1)
    // 소속이 걸린 쪽이 없으면 앞의 것을 남긴다.
    expect(m.storeys[0].spaces.map((s) => s.id)).toEqual(['bath-m'])
  })

  it('외곽선이 같아도 이름이 다른 공간은 남긴다 — 병원 HVAC 의 R-Roof 와 R-AT1 Roof', () => {
    const m = model([
      storey('R', 'Roof', 9, { spaces: [named('r1', '3R01', 'R-Roof', rect(0, 0, 40, 40)), named('r2', '3R02', 'R-AT1 Roof', rect(0, 0, 40, 40))] }),
    ])
    expect(dropDuplicateSpaces(m)).toBe(0)
    expect(m.storeys[0].spaces).toHaveLength(2)
  })

  it('큰 방이 작은 방을 품는 것은 겹친 두 방이지 사본이 아니다 — 병원 건축의 대기실과 접수대', () => {
    const m = model([
      storey('L1', 'Level 1', 0, {
        spaces: [named('waiting', '1AC1', 'CENTRAL WAITING', rect(0, 0, 12, 12)), named('reception', '1B01', 'RECEPTION', rect(2, 2, 5, 5))],
      }),
    ])
    expect(dropDuplicateSpaces(m)).toBe(0)
  })

  it('다른 층의 같은 자리·같은 이름은 사본이 아니다', () => {
    const m = model([
      storey('L1', 'Level 1', 0, { spaces: [named('a', 'A', 'Bedroom', rect(0, 0, 4, 4))] }),
      storey('L2', 'Level 2', 3, { spaces: [named('b', 'A', 'Bedroom', rect(0, 0, 4, 4))] }),
    ])
    expect(dropDuplicateSpaces(m)).toBe(0)
  })
})
