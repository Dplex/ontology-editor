import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { fuzzEdits } from './edit-fuzz'
import { assignEquipment } from './mapping'
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
      if (!r.reloadSame || r.missing || !r.undoSame || !r.redoSame) {
        failed.push(`seed ${seed} 불러오기 ${r.reloadSame ? '같음' : '다름'} · 못 찾음 ${r.missing} · 되돌리기 ${r.undoSame ? '같음' : '다름'} · 다시 하기 ${r.redoSame ? '같음' : '다름'} :: ${r.log.join(' | ')}`)
      }
    }
    expect(failed.slice(0, 3)).toEqual([])
  }, 120_000)
})

describe('계통 이름 규칙 (OE-PIP-09)', () => {
  it('BIM 계통 이름은 사람이 고친 것만 바뀌고, 저장·불러온 뒤에도 같다 (씨앗 200개)', () => {
    // 2026-10-03 사용자 결정으로 BIM 계통도 이름을 고칠 수 있다(renameSystem). 다른 편집(구성원 옮기기·종류·지우기·합치기 …)이
    // 이름을 바꾸면 안 된다. 바뀐 이름은 사람이 준 것(퍼징의 "고친 계통 n")뿐이어야 하고, 편집 파일로 저장·불러와도 같아야 한다.
    const model = read('mep.ifc')
    const bimNames = new Map(model.systems.map((s) => [s.id, s.name]))
    let created = 0
    let renamed = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = fuzzEdits(model, seed, 25)
      for (const m of [r.edited, r.reloaded]) {
        for (const s of m.systems) {
          if (s.source === 'edit') {
            expect(bimNames.has(s.id), `seed ${seed} ${s.id}`).toBe(false)
            expect(s.name).toMatch(/^(새|고친) 계통 \d+$/)
            created++
          } else if (s.name !== bimNames.get(s.id)) {
            expect(s.name, `seed ${seed} ${s.id}`).toMatch(/^고친 계통 \d+$/)
            renamed++
          }
        }
      }
      expect(r.reloaded.systems.map((s) => [s.id, s.name]).sort(), `seed ${seed}`).toEqual(r.edited.systems.map((s) => [s.id, s.name]).sort())
    }
    // 계통 만들기·이름 고치기가 실제로 섞였다 — 검사가 빈손으로 통과한 것이 아니다.
    expect(created).toBeGreaterThan(20)
    expect(renamed).toBeGreaterThan(20)
  }, 120_000)
})

describe('소속은 편집 함수 안에서 다시 계산된다 (OE-MAP-06)', () => {
  it('어떤 편집 뒤에도, 저장·불러온 뒤에도 저장된 소속이 그 자리에서 다시 판정한 소속과 같다 (씨앗 200개)', () => {
    // 호출부가 따로 재계산을 부르지 않아도 맞아야 한다. 다시 판정은 판정 함수 그대로(BIM 명시 소속·사람 지정·외벽 설비 포함)다.
    const model = read('mep.ifc')
    const wrong: string[] = []
    let checked = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = fuzzEdits(model, seed, 25)
      for (const [which, m] of [['edited', r.edited], ['reloaded', r.reloaded]] as const) {
        for (const st of m.storeys)
          for (const e of st.equipment) {
            const again = structuredClone(e)
            assignEquipment(again, st.spaces)
            checked++
            if (again.spaceId !== e.spaceId || again.spaceSource !== e.spaceSource)
              wrong.push(`seed ${seed} ${which} ${e.name}: 저장 ${e.spaceId}/${e.spaceSource} · 다시 ${again.spaceId}/${again.spaceSource} :: ${r.log.join(' | ')}`)
          }
      }
    }
    expect(wrong.slice(0, 3)).toEqual([])
    expect(checked).toBeGreaterThan(1000)
  }, 180_000)
})
