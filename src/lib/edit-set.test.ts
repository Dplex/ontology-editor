import { describe, expect, it } from 'vitest'
import {
  applyEditSet,
  countEdits,
  emptyEditSet,
  parseEditFile,
  recordFlow,
  recordFootprint,
  recordName,
  recordPosition,
  recordKind,
  sameSources,
  toEditFile,
} from './edit-set'
import { moveEquipment, renameSpace, setFlowDirection } from './edit'
import type { Connection, Equipment, Model, Space, Vec2 } from './model'

const square = (id: string, name: string, x0: number, x1: number): Space => ({
  id,
  name,
  longName: name,
  footprint: [[x0, 0], [x1, 0], [x1, 10], [x0, 10], [x0, 0]],
  areaM2: (x1 - x0) * 10,
  boundedBy: [],
})
const eq = (id: string, x: number): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind: null,
  role: 'terminal',
  position: [x, 5, 2],
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId: null,
  spaceSource: null,
})
const link = (from: string, to: string, directed = false): Connection => ({ from, to, source: 'port', directed, tolerance: null })

/** 방 둘(A: x 0~10, B: x 10~20), 설비 둘, 방향 없는 연결 하나. */
function model(): Model {
  return {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's',
        name: '1F',
        elevation: 0,
        spaces: [square('A', '사무실', 0, 10), square('B', '회의실', 10, 20)],
        walls: [],
        openings: [],
        equipment: [eq('e1', 5), eq('e2', 15)],
      },
    ],
    systems: [],
    connections: [link('e1', 'e2')],
    warnings: [],
  }
}

/** 사람이 한 편집 셋(설비 이동, 이름, 흐름 방향)을 모델과 편집 세트에 같이 남긴다. */
function edited() {
  const m = model()
  const set = emptyEditSet()
  const e1 = m.storeys[0].equipment[0]
  const before = e1.position
  moveEquipment(m, 'e1', [15, 5, 2])
  recordPosition(set, 'e1', before, [15, 5, 2])
  renameSpace(m, 'A', '대회의실')
  recordName(set, 'A', '사무실', '대회의실')
  setFlowDirection(m.connections[0], 'e2')
  recordFlow(set, m.connections[0])
  return { m, set }
}

describe('편집 세트에 적기', () => {
  it('같은 대상을 여러 번 고치면 처음 BIM 값을 지키고, 제자리로 돌아오면 지운다', () => {
    const set = emptyEditSet()
    recordPosition(set, 'e1', [5, 5, 2], [6, 5, 2])
    recordPosition(set, 'e1', [6, 5, 2], [7, 5, 2])
    expect(set.positions.e1).toEqual({ value: [7, 5, 2], base: [5, 5, 2] })
    recordPosition(set, 'e1', [7, 5, 2], [5, 5, 2])
    expect(set.positions.e1).toBeUndefined()

    const ring: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 0]]
    recordFootprint(set, 'A', ring, [[0, 0], [2, 0], [1, 1], [0, 0]])
    recordFootprint(set, 'A', [[0, 0], [2, 0], [1, 1], [0, 0]], ring)
    expect(countEdits(set)).toBe(0)
  })

  it('종류를 사전 값으로 되돌리면 편집에서 빠진다', () => {
    const set = emptyEditSet()
    recordKind(set, 'e1', null, 'fcu')
    expect(set.kinds.e1).toEqual({ value: 'fcu', base: null })
    recordKind(set, 'e1', 'fcu', null)
    expect(set.kinds.e1).toBeUndefined()
  })
})

describe('다시 붙이기', () => {
  it('같은 BIM 을 새로 열면 편집이 전부 그대로 붙는다', () => {
    const { set } = edited()
    const fresh = model()
    const r = applyEditSet(fresh, set)
    expect(r.review).toEqual([])
    expect(r.applied).toBe(3)
    const e1 = fresh.storeys[0].equipment[0]
    expect(e1.position).toEqual([15, 5, 2])
    // 좌표만 옮긴 게 아니라 소속도 다시 판정됐다.
    expect(e1.spaceId).toBe('B')
    expect(fresh.storeys[0].spaces[0].longName).toBe('대회의실')
    expect(fresh.connections[0].edited).toEqual({ from: 'e2', to: 'e1' })
    expect(r.changes.map((c) => c.equipmentId)).toEqual(['e1'])
  })

  it('대상이 사라지면 (ㄱ) 사라짐, BIM 이 스스로 바뀌면 (ㄴ) 이제 BIM 이 말함으로 검토 목록에 남는다', () => {
    const { set } = edited()
    const redelivered = model()
    // 설비 e1 이 사라졌다. 방 A 의 이름은 BIM 이 바꿨다. 연결은 이제 포트가 방향을 말한다.
    redelivered.storeys[0].equipment.splice(0, 1)
    redelivered.storeys[0].spaces[0].longName = '라운지'
    redelivered.connections = [link('e1', 'e2', true)]

    const r = applyEditSet(redelivered, set)
    expect(r.applied).toBe(0)
    const byKind = Object.fromEntries(r.review.map((i) => [i.kind, i.reason]))
    expect(byKind).toEqual({ positions: 'missing', names: 'superseded-by-bim', flows: 'superseded-by-bim' })
    // 말없이 적용되지 않았다.
    expect(redelivered.storeys[0].spaces[0].longName).toBe('라운지')
    expect(redelivered.connections[0].edited).toBeUndefined()
  })

  it('검토 목록에서 되살리면 BIM 값을 덮고 사람 편집을 붙인다', () => {
    const { set } = edited()
    const redelivered = model()
    redelivered.storeys[0].equipment[0].position = [3, 5, 2] // BIM 이 설비를 옮겼다
    const first = applyEditSet(redelivered, set)
    expect(first.review.map((i) => `${i.kind}:${i.reason}`)).toEqual(['positions:superseded-by-bim'])

    const again = applyEditSet(redelivered, set, { kind: 'positions', key: 'e1' })
    expect(again.review).toEqual([])
    expect(redelivered.storeys[0].equipment[0].position).toEqual([15, 5, 2])
  })

  it('사람이 고른 종류를 기기별로 붙이고 출처를 편집으로 남긴다', () => {
    const set = emptyEditSet()
    recordKind(set, 'e2', null, 'air_diffuser')
    const m = model()
    applyEditSet(m, set)
    expect(m.storeys[0].equipment[1]).toMatchObject({ kind: 'air_diffuser', kindSource: 'edit' })
    // 편집하지 않은 기기에는 아무것도 붙지 않는다.
    expect(m.storeys[0].equipment[0].kindSource).toBeUndefined()
  })
})

describe('편집 파일', () => {
  it('내보낸 파일을 읽으면 같은 편집이 나온다', () => {
    const { set } = edited()
    const sources = [{ name: 'a.ifc', size: 10, sha256: 'ab'.repeat(32) }]
    const parsed = parseEditFile(JSON.stringify(toEditFile(set, sources, [])))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.edits).toEqual(set)
    expect(sameSources(parsed.file.sources, sources)).toBe(true)
  })

  it('깨진 파일·다른 파일·모르는 판은 이유를 말하고 거절한다', () => {
    expect(parseEditFile('{ not json')).toEqual({ ok: false, reason: 'JSON 이 아닙니다' })
    expect(parseEditFile('{"format":"geojson"}').ok).toBe(false)
    expect(parseEditFile('{"format":"ontology-editor/edits","version":9,"edits":{}}')).toEqual({
      ok: false,
      reason: '모르는 판입니다(version 9)',
    })
    expect(parseEditFile('{"format":"ontology-editor/edits","version":1,"edits":{"names":[]}}').ok).toBe(false)
  })
})
