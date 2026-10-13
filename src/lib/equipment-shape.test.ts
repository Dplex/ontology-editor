import { describe, expect, it } from 'vitest'
import { addEquipment, baselineOf } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import type { Model } from './model'

// 사람이 더한 설비의 3D 모양(ADR-0059). 복제한 원본(shapeOf)은 편집 파일에 적혀 다시 열어도 같은 원본을 가리킨다.
// 형상을 옮겨 그리는 것은 화면(App.vue 의 syncBorrowedShapes)이 하고 e2e/equipment-shape.spec.ts 가 본다.

const bim = (): Model => ({
  schema: 'IFC4',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys: [{ id: 's1', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] }],
  systems: [],
  connections: [],
  warnings: [],
})

describe('더한 설비의 모양 원본 (ADR-0059)', () => {
  it('복제한 원본은 편집 파일에 적히고 다시 얹으면 같은 원본을 가리킨다. 종류로 빌린 것·배관은 적지 않는다', () => {
    const pristine = bim()
    addEquipment(pristine, 's1', { name: 'FCU-1', kind: 'fcu', position: [1, 1, 2.7], id: 'fcu1' })
    delete pristine.storeys[0].equipment[0].added
    const model = structuredClone(pristine)
    const base = baselineOf(model)
    addEquipment(model, 's1', { name: 'FCU-1 복제', kind: 'fcu', position: [4, 1, 2.7], id: 'U_copy', shapeOf: 'fcu1' })
    addEquipment(model, 's1', { name: '새 설비 2', kind: 'fcu', position: [7, 1, 2.7], id: 'U_new' })
    const segment = addEquipment(model, 's1', {
      name: '배관',
      kind: null,
      position: [9, 1, 2.7],
      id: 'U_pipe',
      shapeOf: 'fcu1',
      conduit: { role: 'segment', ifcClass: 'PipeSegment', flowType: 'HWS', axis: [[0, 0, 0], [1, 0, 0]] },
    })!
    expect(segment.shapeOf).toBeUndefined()
    const file = exportEdits(model, base, 'x.ifc')
    expect(file.equipmentAdded?.map((r) => [r.id, r.shapeOf])).toEqual([['U_copy', 'fcu1'], ['U_new', undefined], ['U_pipe', undefined]])
    const parsed = parseEditFile(JSON.stringify(file))
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = structuredClone(pristine)
    applyEdits(fresh, parsed)
    expect(fresh.storeys[0].equipment.map((e) => [e.id, e.shapeOf])).toEqual([['fcu1', undefined], ['U_copy', 'fcu1'], ['U_new', undefined], ['U_pipe', undefined]])
  })
})
