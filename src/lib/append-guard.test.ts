import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import type { Model } from './model'
import { duplicateOf, duplicateText, partOf } from './append-guard'

const fixture = (f: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${f}`, import.meta.url))))
let api: WebIFC.IfcAPI
const open = (f: string) => importIfc(api, fixture(f))
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
})

describe('덧붙이기의 같은 건물·같은 분야 (OE-HIST-06)', () => {
  it('벽이 있으면 건축, 없으면 설비다 — 설비 파일에 방(MEP Space)이 있어도 설비다', () => {
    expect(partOf('two-rooms.ifc', open('two-rooms.ifc')).discipline).toBe('architecture')
    const mep = open('mep.ifc')
    expect(mep.storeys.some((s) => s.spaces.length > 0)).toBe(true)
    expect(partOf('mep.ifc', mep).discipline).toBe('mep')
  })

  it('같은 건물의 건축 파일을 또 덧붙이면 막고 [새 프로젝트] 를 안내한다. 같은 건물의 설비는 받는다 [OE-HIST-06#2]', () => {
    const arch = partOf('two-rooms.ifc', open('two-rooms.ifc'))
    // 같은 건물(GlobalId 같음)의 다른 건축 판본.
    const again = partOf('foot.ifc', open('foot.ifc'))
    expect(duplicateOf([arch], again)).toBe(arch)
    expect(duplicateText(again, arch)).toContain('[새 프로젝트]')
    expect(duplicateText(again, arch)).toContain('건축 파일이라 받지 않았습니다')
    expect(duplicateOf([arch], partOf('mep.ifc', open('mep.ifc')))).toBeNull()
  })

  it('GlobalId 가 달라도 같은 자리·같은 층이면 같은 건물이고, 다른 자리면 다른 건물이라 받는다 [OE-HIST-06#2]', () => {
    const arch = partOf('two-rooms.ifc', open('two-rooms.ifc'))
    const copy: Model = { ...open('two-rooms.ifc'), buildingId: 'other-guid' }
    expect(duplicateOf([arch], partOf('copy.ifc', copy))).toBe(arch)
    // 200m 옆의 다른 건물(층 이름이 같아도 자리가 다르다).
    const far = open('two-rooms.ifc')
    far.buildingId = 'far-guid'
    for (const s of far.storeys) for (const sp of s.spaces) sp.footprint = sp.footprint.map(([x, y]) => [x + 200, y])
    expect(duplicateOf([arch], partOf('far.ifc', far))).toBeNull()
  })
})
