// [임시 — 리플레이 데모] 뺄 때 지울 곳은 lib/replay-demo.ts 맨 위.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { exportedContent } from './edit-fuzz'
import type { Model } from './model'
import { demoStoreys } from './replay-demo'
import { demoOn } from './replay-demo-check'

// 데모 편집은 모양으로 대상을 고르니 BIM 마다 다른 편집이 나온다. 실제로 편집이 심기고(거절만 하다 끝나지 않고), 그 이력으로
// 리플레이를 만들면 장면 수가 맞고 끝 상태가 데모를 한 모델과 같으며, 다 되돌리면 연 때로 가는지 본다.
let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (name: string): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))

describe('편집 리플레이 데모', () => {
  it('mep.ifc 에 편집이 심기고, 리플레이 장면 수가 맞고, 다 되돌리면 연 때다', () => {
    const pristine = read('mep.ifc')
    const r = demoOn(pristine)!
    expect(r.error).toBeUndefined()
    // mep.ifc 는 층 하나·방 하나·벽 없음이다. 그래도 공간 5 · 벽·문·창 4 · 설비(옮김·더하기·잇기·방향·종류·계통) · 천장 · 벽 옮김 · 내력벽이 나온다.
    expect(r.labels.length).toBeGreaterThanOrEqual(18)
    expect(r.steps.map((s) => s.label)).toEqual(r.labels)
    // 장면마다 평면이나 TTL 이 실제로 바뀐다(빈 장면이 없다).
    for (const s of r.steps) expect(s.changes.length + s.ttl.length, s.label).toBeGreaterThan(0)
    expect(r.replayed).toBe(r.edited)
    expect(r.undone).toBe(exportedContent(pristine))
  })

  it('갈래를 고루 거친다 (장면의 갈래)', () => {
    const r = demoOn(read('mep.ifc'))!
    const cats = new Set(r.steps.map((s) => s.category))
    // 흐름 방향 적용은 연결 스냅숏(해제 보정과 같은 것)이라 '연결' 갈래로 잡힌다.
    for (const c of ['물리존', '공간 오브젝트', '벽·문·창', '설비 배치', '설비 추가·삭제', '연결', '설비 종류', '계통']) expect(cats, c).toContain(c)
    expect(r.labels.some((l) => l.startsWith('방향 '))).toBe(true)
  })

  it('two-rooms 처럼 작은 파일에서도 멈추지 않고, 방이 없으면 아무것도 하지 않는다', () => {
    const pristine = read('two-rooms.ifc')
    const r = demoOn(pristine)!
    expect(r.error).toBeUndefined()
    expect(r.undone).toBe(exportedContent(pristine))
    const empty = structuredClone(pristine)
    for (const s of empty.storeys) s.spaces = []
    expect(demoStoreys(empty, { storeyId: null, ceilingIds: new Set(), ceilingHeight: () => null })).toBeNull()
  })

  it('같은 모델에 두 번 심어도 같은 편집을 고른다 (id 만 다르다)', () => {
    const pristine = read('mep.ifc')
    const strip = (ls: string[]) => ls.map((l) => l.replace(/U_\w+/g, 'U_*'))
    expect(strip(demoOn(pristine)!.labels)).toEqual(strip(demoOn(pristine)!.labels))
  })
})
