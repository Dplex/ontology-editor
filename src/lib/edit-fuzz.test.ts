import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { fuzzEdits } from './edit-fuzz'
import type { Model } from './model'

// 편집을 무작위로 섞어도 편집 파일과 되돌리기가 화면과 같은 결과를 낸다(edit-fuzz.ts). 실제 BIM 으로 도는 판은
// check:sample 에 있다.
let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (name: string): Model => {
  const path = fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url))
  const model = importIfc(api, new Uint8Array(readFileSync(path)))
  // 층 옮기기를 해 보려면 층이 둘은 있어야 한다.
  model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
  // 계통 옮기기(E8)를 해 보려면 계통도 둘은 있어야 한다. 유체를 모르는 순환수로 둔다.
  model.systems.push({ id: 'sys2', name: '순환수 공급', memberIds: [], source: 'ifc', kind: 'hydronic_supply', fluid: null })
  return model
}

describe('편집을 무작위로 섞어도', () => {
  it('편집 파일로 저장·불러오면 화면과 같고, 전부 되돌리면 연 때와 같다 (씨앗 200개)', () => {
    const model = read('mep.ifc')
    const failed: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const r = fuzzEdits(model, seed, 25)
      if (!r.reloadSame || r.missing || !r.undoSame) {
        failed.push(`seed ${seed} 불러오기 ${r.reloadSame ? '같음' : '다름'} · 못 찾음 ${r.missing} · 되돌리기 ${r.undoSame ? '같음' : '다름'} :: ${r.log.join(' | ')}`)
      }
    }
    expect(failed.slice(0, 3)).toEqual([])
  }, 120_000)
})
