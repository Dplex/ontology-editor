import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { addWall, baselineOf, moveEquipment, renameSpace, renameSystem } from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { inferFlowByRules } from './flow-rules'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { Model } from './model'
import { BUILDING, joinParts, partSig, splitByStorey, type HomeOf } from './storey-drafts'

// 층마다 임시 저장본 하나(OE-COM-08). mep.ifc 1층에 2층을 하나 더 두고, 두 층과 건물(계통)에 편집을 하나씩 한다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const open = (): Model => {
  const model = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
  inferFlowByRules(model)
  return model
}
/** 연 때의 층. 연 모델에서 id 로 찾는다. */
const homeIn = (m: Model): HomeOf => {
  const home = new Map<string, string>()
  for (const s of m.storeys) for (const x of [...s.spaces, ...s.equipment, ...s.walls, ...s.openings]) home.set(x.id, s.id)
  return (id) => home.get(id) ?? null
}
const exported = (m: Model) => ({ ttl: modelToTTL(m), geo: JSON.stringify(modelToGeoJSON(m)) })

function edited() {
  const m = open()
  const base = baselineOf(m)
  const home = homeIn(m)
  const down = m.storeys[0]
  renameSpace(m, down.spaces[0].id, '1층 사무실')
  const ahu = down.equipment.find((e) => e.name === 'AHU-1')!
  moveEquipment(m, ahu.id, [ahu.position![0] + 1, ahu.position![1], ahu.position![2]])
  addWall(m, 'up', [0, 0], [4, 0], 0.2)
  renameSystem(m, m.systems[0].id, '급기 1계통')
  return { m, base, home, file: exportEdits(m, base, 'mep.ifc') }
}

describe('층별 임시 저장본 (OE-COM-08)', () => {
  it('편집 파일을 층 조각과 건물 조각으로 가르고, 층의 것은 연 때의 층으로 간다', () => {
    const { file, home, m } = edited()
    const parts = splitByStorey(file, home)
    expect([...parts.keys()].sort()).toEqual([BUILDING, m.storeys[0].id, 'up'].sort())
    expect(parts.get(m.storeys[0].id)!.spaces).toHaveLength(1)
    expect(parts.get(m.storeys[0].id)!.equipment.map((e) => e.id)).toEqual(file.equipment.map((e) => e.id))
    expect(parts.get('up')!.wallsAdded).toHaveLength(1)
    // 계통 이름은 층이 없다
    expect(parts.get(BUILDING)!.systemNames).toEqual(file.systemNames)
    expect(parts.get('up')!.systemNames).toBeUndefined()
  })

  it('조각을 이어 새로 연 모델에 얹으면 원래 편집 파일과 내보내는 파일이 같다', () => {
    const { file, home, m } = edited()
    const joined = joinParts(splitByStorey(file, home).values(), file)
    const fresh = open()
    applyEdits(fresh, joined)
    expect(exported(fresh)).toEqual(exported(m))
  })

  it('한 층 조각만 얹으면 그 층만 바뀌고 다른 층은 연 때 그대로다', () => {
    const { file, home } = edited()
    const parts = splitByStorey(file, home)
    const fresh = open()
    applyEdits(fresh, joinParts([parts.get('up')!], file))
    expect(fresh.storeys.find((s) => s.id === 'up')!.walls).toHaveLength(1)
    expect(fresh.storeys[0].spaces[0].longName).not.toBe('1층 사무실')
  })

  it('조각 서명은 저장 시각·지문과 상관없고, 편집이 없으면 null 이다', () => {
    const { file, home, m } = edited()
    const a = splitByStorey(file, home).get('up')!
    const b = splitByStorey({ ...file, savedAt: '2099-01-01T00:00:00.000Z', keys: {} }, home).get('up')!
    expect(partSig(a)).toBe(partSig(b))
    expect(partSig(undefined)).toBeNull()
    // 다른 층을 더 고쳐도 이 층의 서명은 그대로다 — 층을 바꿀 때 "이 층에 저장 안 한 편집이 있나" 를 이것으로 본다
    renameSpace(m, m.storeys[0].spaces[0].id, '다시 바꾼 이름')
    const again = splitByStorey(exportEdits(m, baselineOf(open()), 'mep.ifc'), home).get('up')!
    expect(partSig(again)).toBe(partSig(a))
  })
})
