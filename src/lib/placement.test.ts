// 미배치 설비를 놓을 높이(OE-EQP-02). mep.ifc 의 디퓨저 AT-101-01·02 는 바닥에서 2.7m 다. 같은 패밀리로 묶이게 둘에 같은 유형 이름을 준다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import type { Model } from './model'
import { familyHeight } from './placement'

let model: Model
beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  model = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
}, 60_000)
const equip = (name: string) => model.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

describe('미배치 설비를 놓을 높이', () => {
  it('같은 패밀리의 높이 가운데 값이고, 같은 패밀리가 없으면 null(바닥에 놓고 알린다) [OE-EQP-02#4]', () => {
    const d = equip('AT-101-02')
    for (const e of [d, equip('AT-101-01')]) e.objectType = 'M_Supply Diffuser:600x600'
    d.position = null
    expect(familyHeight(model, d)).toBeCloseTo(2.7, 6)
    // 패밀리에 놓인 것이 하나도 없으면 높이를 지어내지 않는다.
    const peer = equip('AT-101-01')
    const was = peer.position
    peer.position = null
    expect(familyHeight(model, d)).toBeNull()
    peer.position = was
  })
})
