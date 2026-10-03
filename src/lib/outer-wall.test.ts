import { beforeEach, describe, expect, it } from 'vitest'
import {
  addEquipment,
  addOpening,
  baselineOf,
  deleteWall,
  diffBaseline,
  moveEquipment,
  moveWall,
  mountOnWall,
  exteriorOnly,
  onExteriorFace,
  restore,
  setWallExternal,
  setWallHeight,
  setWallLength,
  setWallLoadBearing,
  setWallThickness,
  snapshotEquipment,
  snapshotStoreyElements,
} from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { judgeExternal } from './exterior'
import { equipmentKindOf } from './kinds'
import { modelToGeoJSON } from './export/geojson'
import type { Equipment, Model, Space, Vec2, Wall } from './model'

// 외벽 편집(OE-OBJ-04): 외벽 여부·크기(x 길이·y 두께·z 높이)를 고치고, 외벽에 문·창과 외벽 전용 설비를 놓는다.
// 방 하나(0~6 × 0~4)를 벽 넷이 두른다. 벽 중심선이 방 테두리이고 두께 0.2 — 바깥 면은 y=-0.1, 안쪽 면은 y=0.1 이다.

const rect = (a: Vec2, b: Vec2, t = 0.2): Vec2[] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nx = (-(b[1] - a[1]) / len) * (t / 2)
  const ny = ((b[0] - a[0]) / len) * (t / 2)
  return [[a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]
}
const wall = (id: string, a: Vec2, b: Vec2): Wall => ({ id, name: id, thickness: 0.2, loadBearing: false, height: 3, footprint: [rect(a, b)] })

let model: Model
let louver: Equipment

beforeEach(() => {
  const room: Space = { id: 'room', name: '101', longName: '사무실', footprint: [[0.15, 0.15], [5.85, 0.15], [5.85, 3.85], [0.15, 3.85], [0.15, 0.15]], areaM2: 21, boundedBy: [] }
  model = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's1',
        name: '1F',
        elevation: 0,
        spaces: [room],
        walls: [wall('south', [0, 0], [6, 0]), wall('east', [6, 0], [6, 4]), wall('north', [6, 4], [0, 4]), wall('west', [0, 4], [0, 0])],
        openings: [],
        equipment: [],
      },
    ],
    systems: [],
    connections: [],
    warnings: [],
  }
  louver = addEquipment(model, 's1', { name: '외기 루버', kind: 'outdoor_louver', position: [3, 2, 1.5] })!
})

const storey = () => model.storeys[0]
const wallOf = (id: string) => storey().walls.find((w) => w.id === id)!

describe('외벽 면에 설비 붙이기(OE-OBJ-04 외벽 전용 설비)', () => {
  it('바깥 면을 누르면 바깥 면 위에 놓이고 방 소속이 없다 — 높이는 그대로', () => {
    const done = mountOnWall(model, louver.id, [3, -0.4])
    expect(done && 'wall' in done && done.wall.id).toBe('south')
    expect(louver.position![0]).toBeCloseTo(3)
    expect(louver.position![1]).toBeCloseTo(-0.1)
    expect(louver.position![2]).toBe(1.5)
    expect(louver.wallId).toBe('south')
    expect(louver.spaceId).toBe(null)
  })

  it('안쪽 면을 누르면 안쪽 면에 붙어 그 방에 속한다', () => {
    mountOnWall(model, louver.id, [3, 0.3])
    expect(louver.position![1]).toBeCloseTo(0.1)
    // 안쪽 면(0.1)은 방 외곽선(0.15)에서 5cm — 벽면 여유(SNAP) 안이라 방에 든다.
    expect(louver.spaceId).toBe('room')
  })

  it('벽에서 멀면 붙이지 않고 이유를 돌려준다', () => {
    expect(mountOnWall(model, louver.id, [3, 2])).toEqual({ refused: '벽에서 0.6m 안을 누르세요.' })
    expect(louver.wallId).toBeUndefined()
  })

  it('벽을 옮기면 같이 가고, 되돌리면 같이 돌아온다', () => {
    mountOnWall(model, louver.id, [3, -0.4])
    const before = [...louver.position!]
    const snap = snapshotStoreyElements(model, 's1')!
    expect(moveWall(model, 'south', [0, -1])).toBe(true)
    expect(louver.position![1]).toBeCloseTo(-1.1)
    expect(louver.wallId).toBe('south')
    restore(model, snap)
    expect([...louver.position!]).toEqual(before)
    expect(louver.wallId).toBe('south')
  })

  it('길이·두께를 바꾸면 새 면에 다시 붙는다', () => {
    mountOnWall(model, louver.id, [3, -0.4])
    expect(setWallThickness(model, 'south', 0.4)).toBe(true)
    // 중심선(y=0)을 두고 양쪽으로 펴서 바깥 면이 -0.2 가 됐다.
    expect(louver.position![1]).toBeCloseTo(-0.2)
    expect(louver.spaceId).toBe(null)
    expect(setWallLength(model, 'south', 2)).toBe(true)
    // 가운데(x=3)를 두고 2m 로 줄었다 — 끝(2..4) 안이라 자리는 그대로다.
    expect(louver.position![0]).toBeCloseTo(3)
    expect(louver.wallId).toBe('south')
  })

  it('벽을 지우면 자리에 남고 벽에서만 떨어진다. 설비를 따로 옮겨도 떨어진다', () => {
    mountOnWall(model, louver.id, [3, -0.4])
    deleteWall(model, 'south')
    expect(louver.wallId).toBeUndefined()
    expect(louver.position![1]).toBeCloseTo(-0.1)
    mountOnWall(model, louver.id, [6.4, 2])
    expect(louver.wallId).toBe('east')
    moveEquipment(model, louver.id, [3, 2, 1.5])
    expect(louver.wallId).toBeUndefined()
  })

  it('설비 하나를 붙인 것을 되돌리면 붙기 전 자리·소속으로 돌아온다', () => {
    const snap = snapshotEquipment(model, louver.id)!
    mountOnWall(model, louver.id, [3, -0.4])
    restore(model, snap)
    expect([...louver.position!]).toEqual([3, 2, 1.5])
    expect(louver.wallId).toBeUndefined()
    expect(louver.spaceId).toBe('room')
  })
})

describe('외벽 여부·크기 고치기(OE-OBJ-04)', () => {
  it('사람이 정한 외벽 여부가 BIM·계산보다 앞서고 출처가 편집이다. 모름으로도 정할 수 있다', () => {
    wallOf('south').external = true
    expect(judgeExternal(storey()).get('south')).toEqual({ external: true, source: 'bim' })
    expect(judgeExternal(storey()).get('north')).toEqual({ external: true, source: 'calc' })
    setWallExternal(model, 'south', false)
    setWallExternal(model, 'north', null)
    expect(judgeExternal(storey()).get('south')).toEqual({ external: false, source: 'edit' })
    expect(judgeExternal(storey()).has('north')).toBe(false)
  })

  it('두께를 바꾸면 중심선을 두고 펴고, 뚫린 문·창의 깊이가 따라간다', () => {
    const door = addOpening(model, 's1', 'door', [3, 0])
    expect(door && 'id' in door).toBe(true)
    expect(setWallThickness(model, 'south', 0.3)).toBe(true)
    const ys = wallOf('south').footprint![0].map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(-0.15)
    expect(Math.max(...ys)).toBeCloseTo(0.15)
    expect(wallOf('south').thickness).toBe(0.3)
    expect(storey().openings[0].depth).toBe(0.3)
  })

  it('모서리를 비스듬히 맞댄 사다리꼴 외벽도 길이·두께를 바꾸고, 끝의 기울기는 남는다', () => {
    // AC20 외벽 8장이 전부 이 모양이다. 바깥 면 0..6, 안쪽 면 0.3..5.7(45° 맞댐), 두께 0.3.
    const w = wallOf('south')
    w.footprint = [[[0, -0.3], [6, -0.3], [5.7, 0], [0.3, 0], [0, -0.3]]]
    w.thickness = 0.3
    expect(setWallThickness(model, 'south', 0.6)).toBe(true)
    const ring = w.footprint![0]
    // 중심선(y=-0.15)에서 양쪽으로 두 배 — 바깥 면 -0.45, 안쪽 면 0.15. 꼭짓점의 길이 방향 자리(0·6·5.7·0.3)는 그대로다.
    expect(ring.map((p) => p.map((v) => Math.round(v * 100) / 100))).toEqual([[0, -0.45], [6, -0.45], [5.7, 0.15], [0.3, 0.15], [0, -0.45]])
    expect(setWallLength(model, 'south', 8)).toBe(true)
    expect(Math.min(...w.footprint![0].map((p) => p[0]))).toBeCloseTo(-1)
    expect(Math.max(...w.footprint![0].map((p) => p[0]))).toBeCloseTo(7)
  })

  it('내력벽은 크기를 못 바꾼다(OE-OBJ-06 잠금). 높이 모름(null)은 둘 수 있다', () => {
    setWallLoadBearing(model, 'east', true)
    expect(setWallThickness(model, 'east', 0.3)).toEqual({ refused: expect.stringContaining('내력벽') })
    expect(setWallHeight(model, 'east', 2.5)).toEqual({ refused: expect.stringContaining('내력벽') })
    expect(setWallHeight(model, 'west', null)).toBe(true)
    expect(wallOf('west').height).toBe(null)
  })

  it('외벽에도 문과 창을 놓는다', () => {
    setWallExternal(model, 'south', true)
    expect(addOpening(model, 's1', 'door', [2, 0])).toMatchObject({ wallId: 'south' })
    expect(addOpening(model, 's1', 'window', [4, 0])).toMatchObject({ wallId: 'south' })
  })

  it('리포트와 편집 파일에 남고, 불러오면 GeoJSON 이 같다', () => {
    const pristine = structuredClone(model)
    const base = baselineOf(model)
    setWallExternal(model, 'north', false)
    setWallThickness(model, 'east', 0.35)
    setWallHeight(model, 'west', 2.4)
    mountOnWall(model, louver.id, [3, -0.4])

    const diff = diffBaseline(model, base)
    expect(diff.wallsChanged.map((c) => [c.id, c.resized, c.external])).toEqual([
      ['east', true, null],
      ['north', false, { from: null, to: false }],
      ['west', true, null],
    ])

    const file = exportEdits(model, base, 'test.ifc')
    // 루버는 연 때 있던 설비라 고친 줄에 붙인 벽과 끝 자리가 적힌다.
    expect(file.equipment).toEqual([expect.objectContaining({ id: louver.id, wall: 'south' })])
    expect(file.walls).toEqual([
      expect.objectContaining({ id: 'east', thickness: 0.35 }),
      { id: 'north', external: false },
      { id: 'west', thickness: 0.2, height: 2.4 },
    ])
    const parsed = parseEditFile(JSON.stringify(file))
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = structuredClone(pristine)
    applyEdits(fresh, parsed)
    expect(JSON.stringify(modelToGeoJSON(fresh))).toBe(JSON.stringify(modelToGeoJSON(model)))
    const geo = modelToGeoJSON(model)[0].collection.features
    expect(geo.find((f) => f.id === louver.id)!.properties).toMatchObject({ wallId: 'south', spaceId: null })
    expect(geo.find((f) => f.id === 'west')!.properties).toMatchObject({ height: 2.4 })
    expect(geo.find((f) => f.id === 'north')!.properties).toMatchObject({ external: false, externalSource: 'edit' })
  })
})

describe('외벽 전용 설비 — 외기 센서는 외벽 바깥 면에만 (OE-OBJ-04, 2026-10-03 사용자 결정)', () => {
  let sensor: Equipment
  beforeEach(() => {
    // 방 가운데를 세로로 가르는 칸막이(내벽). 외벽인지는 건물 바깥에 닿는지로 잰다(exterior.ts).
    storey().walls.push(wall('inner', [3, 0.1], [3, 3.9]))
    sensor = addEquipment(model, 's1', { name: '외기 온도 센서', kind: 'outdoor_temperature_sensor', position: [3, 2, 2] })!
  })

  it('이름 사전이 외기 온도·습도 센서를 안다. 온·습도를 같이 말하면 온도다', () => {
    const kind = (name: string) => equipmentKindOf(name, '')?.kind ?? null
    expect(kind('외기 온도 센서')).toBe('outdoor_temperature_sensor')
    expect(kind('외기 온습도 센서 OA-1')).toBe('outdoor_temperature_sensor')
    expect(kind('외기 습도 센서')).toBe('outdoor_humidity_sensor')
    expect(kind('Outside Air Temperature Sensor')).toBe('outdoor_temperature_sensor')
    expect(kind('Outdoor Air Humidity Sensor')).toBe('outdoor_humidity_sensor')
    expect(exteriorOnly(sensor)).toBe(true)
    expect(exteriorOnly(louver)).toBe(false)
  })

  it('외벽 바깥쪽을 누르면 붙고 방 소속이 없다', () => {
    const done = mountOnWall(model, sensor.id, [4, -0.4])
    expect(done && 'wall' in done && done.wall.id).toBe('south')
    expect(sensor.position![1]).toBeCloseTo(-0.1)
    expect(sensor.spaceId).toBe(null)
  })

  it('외벽 안쪽을 누르면 붙이지 않고, 내벽은 붙일 벽 후보가 아니다', () => {
    expect(mountOnWall(model, sensor.id, [1, 0.3])).toEqual({ refused: '외기 센서는 외벽 바깥 면에만 놓습니다. 외벽의 바깥쪽(방이 없는 쪽)을 누르세요.' })
    // 칸막이 바로 옆. 가장 가까운 외벽(남·북)은 0.6m 밖이다.
    expect(mountOnWall(model, sensor.id, [3.3, 2])).toEqual({ refused: '외기 센서는 외벽 바깥 면에만 놓습니다. 외벽에서 0.6m 안의 바깥쪽을 누르세요.' })
    expect(sensor.position).toEqual([3, 2, 2])
    expect(sensor.wallId).toBeUndefined()
    // 보통 설비(루버)는 그대로 안쪽 면·내벽에도 붙는다.
    const inner = mountOnWall(model, louver.id, [3.3, 2])
    expect(inner && 'wall' in inner && inner.wall.id).toBe('inner')
  })

  it('외벽 바깥 면 판정 — 바깥 면을 따라가는 자리는 되고, 벽에서 멀거나 방 안이면 아니다', () => {
    expect(onExteriorFace(storey(), [4, -0.1])).toBe(true)
    expect(onExteriorFace(storey(), [6.1, 2])).toBe(true)
    expect(onExteriorFace(storey(), [4, -1])).toBe(false)
    expect(onExteriorFace(storey(), [3, 2])).toBe(false)
    expect(onExteriorFace(storey(), [1, 0.3])).toBe(false)
  })

  it('내벽으로 정한 벽의 바깥쪽은 외벽 바깥 면이 아니다 — 방 밖이고 벽 곁이어도', () => {
    expect(onExteriorFace(storey(), [4, -0.1])).toBe(true)
    setWallExternal(model, 'south', false)
    expect(onExteriorFace(storey(), [4, -0.1])).toBe(false)
    expect(onExteriorFace(storey(), [6.1, 2])).toBe(true)
  })
})
