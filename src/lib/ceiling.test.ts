import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { ceilingGuess, ceilingOf, ceilingRange, ceilingZone, checkCeilingZ, emptyEvidence, judgeAll, judgeSurface, outsideAllowed, pickCeiling, setCeiling, setEquipmentSurface } from './ceiling'
import { importIfc } from './ifc/import'
import { baselineOf } from './edit'
import { applyEdits, countEdits, exportEdits } from './edit-file'
import { splitByStorey } from './storey-drafts'
import type { Equipment, Storey } from './model'

// 반자 높이 h_c 와 설치면 판정(OE-EQP-03). 높이는 전부 층 바닥 기준 z 다.

const storey = (over: Partial<Storey> = {}): Storey => ({ id: 's', name: '1F', elevation: 10, spaces: [], walls: [], openings: [], equipment: [], ...over })
const device = (z: number, over: Partial<Equipment> = {}): Equipment => ({
  id: `e${z}`,
  name: 'x',
  ifcClass: 'FlowTerminal',
  role: 'terminal',
  position: [5, 5, 10 + z],
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId: null,
  spaceSource: null,
  ...over,
})

describe('BIM 에서 반자 높이 고르기', () => {
  it('① 반자 속성 → ② 방 높이 → ③ 천장재 순서이고, 값은 가운데 값이다', () => {
    const ev = { finish: [[2.5, 'BaseQuantities.FinishCeilingHeight'], [2.7, 'x'], [2.5, 'x']] as [number, string][], room: [[2.9, 'r']] as [number, string][], covering: [2.6] }
    expect(pickCeiling(ev, 3.5)).toEqual({ height: 2.5, property: 'BaseQuantities.FinishCeilingHeight', count: 3 })
    expect(pickCeiling({ ...ev, finish: [] }, 3.5)).toEqual({ height: 2.9, property: 'r', count: 1 })
    expect(pickCeiling({ ...ev, finish: [], room: [] }, 3.5)).toEqual({ height: 2.6, property: 'IfcCovering(CEILING) 아랫면', count: 1 })
    expect(pickCeiling(emptyEvidence(), 3.5)).toBeUndefined()
  })

  it('윗층 바닥판 아래까지 닿는 방 높이(설비 판본의 MEP Space)는 반자가 아니다 — 천장재로 넘어간다', () => {
    // 병원 HVAC: 층고 4.57m, MEP Space 4.42m
    expect(pickCeiling({ finish: [], room: [[4.42, 'Unbounded Height']], covering: [] }, 4.57)).toBeUndefined()
    expect(pickCeiling({ finish: [], room: [[4.42, 'Unbounded Height']], covering: [2.68] }, 4.57)?.height).toBe(2.68)
    // Duplex 2층: 층고 2.9m, 방 2.6m 는 남는다
    expect(pickCeiling({ finish: [], room: [[2.6, 'Unbounded Height']], covering: [] }, 2.9)?.height).toBe(2.6)
  })

  it('층의 방 대부분이 층고에 닿으면 낮은 방 몇 개로 정하지 않는다(성수 1F)', () => {
    const room = [...Array(60).fill([5, 'depth']), [2.5, 'depth'], [2.5, 'depth']] as [number, string][]
    expect(pickCeiling({ finish: [], room, covering: [3.3] }, 5)).toEqual({ height: 3.3, property: 'IfcCovering(CEILING) 아랫면', count: 1 })
  })

  it('바닥 근처(0.3m 이하) 값은 비운 칸으로 본다 — 0 으로 채우지 않는다', () => {
    expect(pickCeiling({ finish: [], room: [], covering: [-0.05] }, 4)).toBeUndefined()
  })
})

describe('층의 반자 높이', () => {
  it('사람이 정한 값이 BIM 값보다 앞서고, BIM 값과 같게 정하면 고친 것이 아니다', () => {
    const s = storey({ ceiling: { height: 2.6, property: 'p', count: 3 } })
    const m = { storeys: [s] } as never
    expect(ceilingOf(s)).toMatchObject({ height: 2.6, source: 'bim' })
    expect(setCeiling(m, 's', 2.7)).toBe(true)
    expect(ceilingOf(s)).toEqual({ height: 2.7, source: 'edit' })
    expect(setCeiling(m, 's', 2.6)).toBe(true)
    expect(s.ceilingSet).toBeUndefined()
    expect(setCeiling(m, 's', 2.6)).toBe(false)
  })

  it('모르면 null 이고, 0 이하는 정하지 않는다', () => {
    const s = storey()
    expect(ceilingOf(s)).toBeNull()
    expect(setCeiling({ storeys: [s] } as never, 's', 0)).toBe(false)
    expect(ceilingOf(s)).toBeNull()
  })

  it('후보(계산)는 반자 부착 종류 중 사전·BIM 으로 종류를 정한 설비의 z 가운데 값이다', () => {
    const s = storey({
      equipment: [
        device(2.7, { kind: 'lighting', kindSource: 'dict' }),
        device(2.8, { kind: 'air_diffuser', kindSource: 'bim' }),
        device(2.7, { kind: 'smoke_detector', kindSource: 'dict' }),
        // 플레넘(VAV)·사람이 고친 종류·종류 출처 없음은 뺀다
        device(3.4, { kind: 'vav', kindSource: 'dict' }),
        device(1.0, { kind: 'lighting', kindSource: 'dict', kindEdited: { from: null } }),
        device(1.2, { kind: 'lighting' }),
      ],
    })
    expect(ceilingGuess(s, 4)).toEqual({ height: 2.7, count: 3 })
    expect(ceilingGuess(storey(), 4)).toBeNull()
  })
})

describe('설치면 판정(z)', () => {
  const wall = { id: 'w', name: '', thickness: 0.2, loadBearing: null, footprint: [[[0, 0], [10, 0], [10, 0.2], [0, 0.2], [0, 0]]] as [number, number][][] }

  it('바닥 0.3 이하 · 천장 h_c−0.3 이상(h_c 초과는 플레넘) · 벽선 0.3 이내 · 그 밖은 미정', () => {
    const s = storey({ ceiling: { height: 2.7, property: 'p', count: 1 }, walls: [wall] })
    expect(judgeSurface(device(0.1), s, 4)).toBe('floor')
    expect(judgeSurface(device(2.5), s, 4)).toBe('ceiling')
    expect(judgeSurface(device(3.2), s, 4)).toBe('plenum')
    expect(judgeSurface(device(1.2), s, 4)).toBeNull()
    expect(judgeSurface({ ...device(1.2), position: [5, 0.4, 11.2] }, s, 4)).toBe('wall')
  })

  it('h_c 를 모르면 천장 판정은 미정이다', () => {
    expect(judgeSurface(device(2.7), storey(), 4)).toBeNull()
  })

  it('설치면 없는 종류(밸브)와 도관은 판정하지 않고, 허용 밖 세기에서도 빠진다', () => {
    const s = storey({ ceiling: { height: 2.7, property: 'p', count: 1 }, equipment: [device(0.1, { kind: 'valve' }), device(0.1, { id: 'd', role: 'segment' }), device(0.1, { id: 'r', kind: 'receptacle' })] })
    expect(judgeSurface(s.equipment[0], s, 4)).toBeNull()
    const rows = judgeAll({ storeys: [s] } as never, () => 4)
    expect(rows.map((r) => r.equipment.id)).toEqual(['r'])
    // 바닥 콘센트(ifc4Mep 23대)는 허용 설치면(벽) 밖이다
    expect(outsideAllowed('receptacle', rows[0].judged)).toBe(true)
    expect(outsideAllowed('lighting', 'plenum')).toBe(false)
    expect(outsideAllowed('heat_recovery', 'floor')).toBe(false)
  })
})

describe('사람이 정한 설치면 (OE-EQP-05)', () => {
  it('미정인 설비에 정한 설치면이 판정보다 앞서고, 지우면 z 판정으로 돌아간다', () => {
    const e = device(1.2, { kind: 'camera' })
    const s = storey({ ceiling: { height: 2.7, property: 'p', count: 1 }, equipment: [e] })
    const m = { storeys: [s] } as never
    expect(judgeSurface(e, s, 4)).toBeNull()
    expect(setEquipmentSurface(m, e.id, 'wall')).toBe(true)
    expect(judgeSurface(e, s, 4)).toBe('wall')
    expect(setEquipmentSurface(m, e.id, 'wall')).toBe(false)
    expect(setEquipmentSurface(m, e.id, null)).toBe(true)
    expect(judgeSurface(e, s, 4)).toBeNull()
  })

  it('허용 설치면 밖으로는 정하지 않는다 — CCTV 는 천장·벽, 바닥은 아니다', () => {
    const e = device(1.2, { kind: 'camera' })
    expect(setEquipmentSurface({ storeys: [storey({ equipment: [e] })] } as never, e.id, 'floor')).toEqual({ refused: '이 종류의 허용 설치면이 아닙니다.' })
    expect(e.surfaceSet).toBeUndefined()
  })
})

describe('천장 설비의 z 구역', () => {
  it('반자 부착은 h_c−0.3 이상, 플레넘은 h_c 초과 층고 미만이다', () => {
    expect(ceilingZone('lighting')).toBe('attached')
    expect(ceilingZone('vav')).toBe('plenum')
    expect(ceilingZone('ahu')).toBeNull()
    expect(ceilingRange('attached', 2.7, 4)).toEqual({ min: 2.4, max: 4, base: 2.7, openMin: false })
    expect(ceilingRange('plenum', 2.7, 4)).toEqual({ min: 2.7, max: 4, base: 2.8, openMin: true })
    expect(ceilingRange('attached', null, 4)).toBeNull()
    expect(checkCeilingZ('attached', 2.5, 2.7, 4)).toBe(true)
    expect(checkCeilingZ('attached', 2.3, 2.7, 4)).toMatch(/0\.3m 안쪽/)
    expect(checkCeilingZ('plenum', 2.7, 2.7, 4)).toMatch(/반자\(2\.70m\) 위/)
    expect(checkCeilingZ('plenum', 4, 2.7, 4)).toMatch(/층고/)
    expect(checkCeilingZ('attached', 2.7, null, 4)).toMatch(/모릅니다/)
  })
})

describe('편집 파일에 남는다', () => {
  let api: WebIFC.IfcAPI
  beforeAll(async () => {
    api = new WebIFC.IfcAPI()
    await api.Init()
  }, 60_000)
  const open = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

  it('정한 반자 높이가 편집 파일을 거쳐 새로 연 모델에 얹히고, 그 층 조각에 든다', () => {
    const m = open()
    const base = baselineOf(m)
    const id = m.storeys[0].id
    setCeiling(m, id, 2.75)
    const file = exportEdits(m, base, 'mep.ifc')
    expect(file.ceilings).toEqual([{ storeyId: id, height: 2.75 }])
    expect(countEdits(file)).toBe(1)
    expect(splitByStorey(file, () => null).get(id)?.ceilings).toEqual(file.ceilings)
    const fresh = open()
    applyEdits(fresh, file)
    expect(ceilingOf(fresh.storeys[0])).toEqual({ height: 2.75, source: 'edit' })
  })

  it('정한 설치면도 편집 파일을 거쳐 새로 연 모델에 얹힌다', () => {
    const m = open()
    const base = baselineOf(m)
    const e = m.storeys[0].equipment.find((x) => x.name === 'AT-101-01')!
    expect(setEquipmentSurface(m, e.id, 'ceiling')).toBe(true)
    const file = exportEdits(m, base, 'mep.ifc')
    expect(file.equipment).toEqual([{ id: e.id, surface: 'ceiling' }])
    const fresh = open()
    applyEdits(fresh, file)
    expect(fresh.storeys[0].equipment.find((x) => x.id === e.id)!.surfaceSet).toBe('ceiling')
  })
})
