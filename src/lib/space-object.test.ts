import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  addCustomItem,
  addSpaceObject,
  deleteSpaceObject,
  findSpaceObject,
  LIBRARY,
  libraryOf,
  MODEL_MAX_BYTES,
  moveSpaceObject,
  placeSpaceObject,
  renameSpaceObject,
  resizeSpaceObject,
} from './space-object'
import { baselineOf, restore, snapshotSpaceObjects } from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { BUILDING, splitByStorey } from './storey-drafts'
import type { Model, SpaceObject } from './model'

// 추가 공간 오브젝트(OE-OBJ-09 · OE-SPC-14 · OE-SPC-16 · OE-P3-08). 층 바닥에 서고, 서로 겹치지 않는다.
// 1F(바닥 0m)와 2F(바닥 3m) 두 층이다.

const model = (): Model => ({
  schema: 'IFC4',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys: [
    { id: 's1', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] },
    { id: 's2', name: '2F', elevation: 3, spaces: [], walls: [], openings: [], equipment: [] },
  ],
  systems: [],
  connections: [],
  warnings: [],
})
const made = (r: ReturnType<typeof addSpaceObject>): SpaceObject => {
  if (!r || 'refused' in r) throw new Error(r ? r.refused : 'null')
  return r
}

describe('라이브러리(OE-SPC-16)', () => {
  it('책상 여러 종류·의자·소파·책장·파티션·칠판·화분이 있고, 항목마다 기본 크기와 상자 안에 든 3D 조각이 있다 [OE-SPC-16#1]', () => {
    const names = LIBRARY.map((i) => i.name)
    for (const want of ['책상', '2인 책상', '회의 테이블', '의자', '소파', '책장', '파티션', '칠판', '화분']) expect(names).toContain(want)
    for (const item of LIBRARY) {
      expect(item.size.every((v) => v > 0)).toBe(true)
      expect(item.parts?.length).toBeGreaterThan(0)
      for (const { box } of item.parts!) {
        expect(box.every((v) => v >= 0 && v <= 1)).toBe(true)
        expect(box[3] > box[0] && box[4] > box[1] && box[5] > box[2]).toBe(true)
      }
    }
    expect(new Set(LIBRARY.map((i) => i.key)).size).toBe(LIBRARY.length)
    // 목록 문서(ADR-0016 "내장 항목 n개(…)")가 코드의 라이브러리와 같다
    const adr = readFileSync(fileURLToPath(new URL('../../docs/adr/0016-space-objects-boxes-in-edit-file.md', import.meta.url)), 'utf8')
    const listed = /내장 항목 (\d+)개\(([^)]+)\)/.exec(adr)!
    expect(Number(listed[1])).toBe(LIBRARY.length)
    expect(listed[2].split('·')).toEqual(names)
  })
})

describe('추가 공간 오브젝트 놓기·옮기기·크기(OE-SPC-14)', () => {
  it('항목을 골라 바닥 자리에 기본 크기로 놓고, 이름은 항목 이름에 번호를 붙인다', () => {
    const m = model()
    const desk = made(addSpaceObject(m, 's1', 'desk', [2, 3]))
    expect(desk).toMatchObject({ item: 'desk', at: [2, 3], size: [1.2, 0.7, 0.72], name: '책상 1' })
    expect(made(addSpaceObject(m, 's1', 'desk', [5, 3])).name).toBe('책상 2')
    expect(addSpaceObject(m, 's1', 'nothing', [9, 9])).toBeNull()
  })

  it('다른 오브젝트와 겹치는 자리에는 놓지도 옮기지도 키우지도 못하고 겹친 상대를 돌려주며, 오브젝트는 그대로다 [OE-OBJ-09#1]', () => {
    const m = model()
    const desk = made(addSpaceObject(m, 's1', 'desk', [2, 3]))
    expect(addSpaceObject(m, 's1', 'chair', [2.3, 3.1])).toEqual({ refused: expect.stringContaining('이미 오브젝트가 있는 위치'), blocked: desk.id })
    const chair = made(addSpaceObject(m, 's1', 'chair', [2, 3.6]))
    expect(moveSpaceObject(m, chair.id, [0, -0.3])).toMatchObject({ blocked: desk.id })
    expect(resizeSpaceObject(m, chair.id, [0.5, 0.8, 0.9])).toMatchObject({ blocked: desk.id })
    expect(findSpaceObject(m, chair.id)!.object).toMatchObject({ at: [2, 3.6], size: [0.5, 0.5, 0.9] })
    expect(m.storeys[0].spaceObjects).toHaveLength(2)
  })

  it('변이 맞닿는 자리와 다른 층의 같은 평면 자리는 겹침이 아니다', () => {
    const m = model()
    made(addSpaceObject(m, 's1', 'desk', [2, 3]))
    // 책상 가로 1.2 — 가운데가 1.2 떨어지면 변이 맞닿는다.
    expect(made(addSpaceObject(m, 's1', 'desk', [3.2, 3])).at).toEqual([3.2, 3])
    expect(made(addSpaceObject(m, 's2', 'desk', [2, 3])).at).toEqual([2, 3])
  })

  it('옮기면 자리가, 크기를 바꾸면 가운데를 두고 상자가 바뀐다. 크기는 한 변 0.05~20m 다', () => {
    const m = model()
    const sofa = made(addSpaceObject(m, 's1', 'sofa', [0, 0]))
    expect(placeSpaceObject(m, sofa.id, [4, 1])).toBe(true)
    expect(resizeSpaceObject(m, sofa.id, [2.4, 0.9, 0.8])).toBe(true)
    expect(findSpaceObject(m, sofa.id)!.object).toMatchObject({ at: [4, 1], size: [2.4, 0.9, 0.8] })
    expect(resizeSpaceObject(m, sofa.id, [0, 0.9, 0.8])).toMatchObject({ refused: expect.stringContaining('0.05~20m') })
  })

  it('지우고 이름을 고치며, 되돌리기로 층의 오브젝트가 돌아온다', () => {
    const m = model()
    const plant = made(addSpaceObject(m, 's1', 'plant', [1, 1]))
    expect(renameSpaceObject(m, plant.id, '입구 화분')).toBe(true)
    const snap = snapshotSpaceObjects(m, 's1')!
    expect(deleteSpaceObject(m, plant.id)).toBe(true)
    expect(m.storeys[0].spaceObjects).toBeUndefined()
    restore(m, snap)
    expect(m.storeys[0].spaceObjects).toEqual([{ ...plant, name: '입구 화분' }])
  })
})

describe('넣은 3D 모델(OE-P3-08)', () => {
  it('넣은 모델이 라이브러리 항목이 되고 그 종류로 놓인다 [OE-OBJ-09#2]', () => {
    const m = model()
    const item = addCustomItem(m, 'lounge-chair.glb', [0.7, 0.8, 1.05], 'Z2xURg==')
    if ('refused' in item) throw new Error(item.refused)
    expect(item).toMatchObject({ key: expect.stringMatching(/^custom:/), name: 'lounge-chair', size: [0.7, 0.8, 1.05] })
    expect(libraryOf(m).at(-1)).toBe(item)
    expect(made(addSpaceObject(m, 's1', item.key, [1, 1]))).toMatchObject({ item: item.key, name: 'lounge-chair 1', size: [0.7, 0.8, 1.05] })
  })

  it('mm 로 저장된 모델(한 변이 20m 넘음)은 기본 크기를 1m 안으로 줄이고, 형상 없는 파일과 너무 큰 파일은 받지 않는다', () => {
    const m = model()
    const item = addCustomItem(m, 'desk.glb', [1600, 800, 720], 'Z2xURg==')
    expect(item).toMatchObject({ size: [1, 0.5, 0.45] })
    expect(addCustomItem(m, 'empty.glb', [0, 0, 0], 'Z2xURg==')).toMatchObject({ refused: expect.stringContaining('형상') })
    expect(addCustomItem(m, 'huge.glb', [1, 1, 1], 'A'.repeat(Math.ceil((MODEL_MAX_BYTES / 0.75) + 8)))).toMatchObject({ refused: expect.stringContaining('MB') })
  })
})

describe('편집 파일', () => {
  it('놓은 오브젝트와 그것이 쓰는 넣은 모델만 남고, 층 조각·건물 조각으로 갈려 새로 연 모델에 얹힌다', () => {
    const m = model()
    const base = baselineOf(m)
    const used = addCustomItem(m, 'a.glb', [1, 1, 1], 'QUFB')
    addCustomItem(m, 'unused.glb', [1, 1, 1], 'QkJC')
    if ('refused' in used) throw new Error(used.refused)
    const desk = made(addSpaceObject(m, 's1', 'desk', [2, 3]))
    const custom = made(addSpaceObject(m, 's2', used.key, [2, 3]))
    const file = exportEdits(m, base, 'x.ifc')
    expect(file.spaceObjects).toEqual([
      { storeyId: 's1', objects: [desk] },
      { storeyId: 's2', objects: [custom] },
    ])
    expect(file.objectLibrary?.map((i) => i.name)).toEqual(['a'])
    const parts = splitByStorey(file, () => null)
    expect(parts.get('s1')?.spaceObjects).toEqual([file.spaceObjects![0]])
    expect(parts.get(BUILDING)?.objectLibrary).toEqual(file.objectLibrary)
    const fresh = model()
    applyEdits(fresh, file)
    expect(fresh.storeys.map((s) => s.spaceObjects)).toEqual(m.storeys.map((s) => s.spaceObjects))
    expect(fresh.objectLibrary).toEqual(file.objectLibrary)
  })
})

// BIM 에서 받은 오브젝트(가구·주변 모델, ADR-0016 "BIM 에서 받는 오브젝트"). 임포트가 `source: 'bim'` 으로 만든다.
describe('BIM 에서 받은 오브젝트', () => {
  const bim = (id: string, at: [number, number], size: [number, number, number], item = 'chair', base?: number): SpaceObject => ({
    id,
    name: id,
    item,
    at,
    size,
    ...(base ? { base } : {}),
    source: 'bim',
  })
  const withBim = (): Model => {
    const m = model()
    m.storeys[0].spaceObjects = [bim('CHAIR', [2, 2], [0.5, 0.5, 0.9]), bim('DESK', [2, 2.2], [1.2, 0.7, 0.72], 'desk'), bim('HILL', [50, 50], [80, 60, 4], 'terrain', -3)]
    return m
  }

  it('이름으로 항목을 고른다 — 성수 10층 인테리어·조경의 이름', async () => {
    const { contextItem, furnitureItem } = await import('./object-names')
    expect(furnitureItem('인테리어_회의실 의자:인테리어_회의실 의자')).toBe('chair')
    expect(furnitureItem('인테리어_회의실 책상:인테리어_사무실_회의책상')).toBe('meeting-table')
    expect(furnitureItem('인테리어_업무시설_책상')).toBe('desk')
    expect(furnitureItem('인테리어_업무시설2_캐비넷')).toBe('cabinet')
    expect(furnitureItem('인테리어_메인거실_대형소파_코너')).toBe('sofa')
    expect(furnitureItem('인테리어_회의실_TV')).toBe('tv')
    expect(furnitureItem('인테리어_복사기')).toBe('office-machine')
    expect(furnitureItem('인테리어_소변기')).toBe('sanitary')
    expect(furnitureItem('알 수 없는 것')).toBe('furniture')
    expect(contextItem('지형 솔리드:보도블럭')).toBe('terrain')
    expect(contextItem('스테이지73:스테이지35')).toBe('stage')
    expect(contextItem('하나은행:하나은행')).toBe('context-building')
  })

  it('BIM 것끼리는 겹쳐도 옮길 수 있고, 사람이 놓는 것은 BIM 것과 겹치면 막는다. 20m 넘는 주변 모델도 크기를 고칠 수 있다', () => {
    const m = withBim()
    // 의자는 책상 밑에 있다(BIM 그대로). 조금 옮겨도 책상과 겹친 채 된다.
    expect(moveSpaceObject(m, 'CHAIR', [0.1, 0])).toBe(true)
    expect(addSpaceObject(m, 's1', 'desk', [2, 2])).toMatchObject({ refused: expect.stringContaining('겹칠 수 없습니다') })
    expect(resizeSpaceObject(m, 'HILL', [90, 60, 4])).toBe(true)
  })

  it('편집 파일은 연 때와 달라진 BIM 오브젝트만 적는다 — 손대지 않으면 0건, 옮김·지움만 남고 다시 열면 같은 자리다', () => {
    const m = withBim()
    const base = baselineOf(m)
    expect(exportEdits(m, base, 'x.ifc').bimObjects).toBeUndefined()
    expect(exportEdits(m, base, 'x.ifc').spaceObjects).toBeUndefined()
    moveSpaceObject(m, 'CHAIR', [1, 0])
    deleteSpaceObject(m, 'DESK')
    const mine = made(addSpaceObject(m, 's1', 'plant', [10, 10]))
    const file = exportEdits(m, base, 'x.ifc')
    expect(file.bimObjects).toEqual([
      { id: 'CHAIR', storeyId: 's1', at: [3, 2] },
      { id: 'DESK', storeyId: 's1', removed: true },
    ])
    // 사람이 놓은 것만 끝 목록으로 남는다.
    expect(file.spaceObjects).toEqual([{ storeyId: 's1', objects: [mine] }])
    expect(splitByStorey(file, () => null).get('s1')?.bimObjects).toEqual(file.bimObjects)
    const fresh = withBim()
    applyEdits(fresh, file)
    expect(fresh.storeys[0].spaceObjects?.map((o) => [o.id, o.at])).toEqual([['CHAIR', [3, 2]], ['HILL', [50, 50]], [mine.id, [10, 10]]])
    // 다시 얹어도 지운 책상이 돌아오지 않는다.
    expect(fresh.storeys[0].spaceObjects?.some((o) => o.id === 'DESK')).toBe(false)
  })
})

describe('합치기', () => {
  it('맞춘 층에도 덧붙인 파일의 오브젝트가 얹힌다 — 전에는 말없이 버려져 10층 인테리어의 가구가 건축 10F 에 붙지 않았다', async () => {
    const { mergeModels } = await import('./merge')
    const arch = model()
    const interior = model()
    interior.buildingId = 'interior'
    interior.storeys[1].spaceObjects = [{ id: 'G1', name: '의자', item: 'chair', at: [1, 1], size: [0.5, 0.5, 0.9], source: 'bim' }]
    const { model: merged } = mergeModels(arch, interior)
    expect(merged.storeys.find((s) => s.name === '2F')?.spaceObjects?.map((o) => o.id)).toEqual(['G1'])
    // 같은 파일을 한 번 더 덧붙여도 두 번 들어가지 않는다.
    const { model: again } = mergeModels(merged, interior)
    expect(again.storeys.find((s) => s.name === '2F')?.spaceObjects?.length).toBe(1)
  })
})
