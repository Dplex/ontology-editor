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

describe('계통 이름 규칙 (OE-PIP-09)', () => {
  it('어떤 편집을 섞어도 BIM 계통 이름은 그대로이고, 사람이 만든 계통만 사람이 준 이름이다 (씨앗 200개)', () => {
    // BIM 계통 이름은 분야별 파일을 합칠 때 맞추는 열쇠다(Revit System Name 이 곧 id, merge.ts). 고치는 길이 하나라도 생기면
    // 나중에 덧붙인 파일의 같은 계통이 따로 놀게 된다. 편집 파일로 저장·불러온 뒤에도 같아야 한다.
    const model = read('mep.ifc')
    const bimNames = new Map(model.systems.map((s) => [s.id, s.name]))
    let created = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = fuzzEdits(model, seed, 25)
      for (const m of [r.edited, r.reloaded]) {
        for (const s of m.systems) {
          if (s.source === 'edit') {
            expect(bimNames.has(s.id), `seed ${seed} ${s.id}`).toBe(false)
            expect(s.name).toMatch(/^새 계통 \d+$/)
            created++
          } else expect(s.name, `seed ${seed} ${s.id}`).toBe(bimNames.get(s.id))
        }
      }
    }
    // 계통 만들기가 실제로 섞였다 — 검사가 빈손으로 통과한 것이 아니다.
    expect(created).toBeGreaterThan(20)
  }, 120_000)
})

