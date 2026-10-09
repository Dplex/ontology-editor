// [임시 — 리플레이 데모] 정식 기능이 아니다. 뺄 때 이 파일과 vitest.sample.config.ts 의 include 한 줄을 지운다.
import { existsSync, readFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../src/lib/ifc/import'
import { mergeModels } from '../src/lib/merge'
import { exportedContent } from '../src/lib/edit-fuzz'
import { demoOn } from '../src/lib/replay-demo-check'

const DUPLEX_ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const DUPLEX_MEP_FULL = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

// 리플레이 데모(replay-demo.ts). 대상을 BIM 모양으로 고르니 손으로 쓴 픽스처(방 하나)에서는 안 보이는 길 — 방이 여럿인 층,
// 내력·외벽으로 잠긴 벽, 관에 끼인 밸브, 두 층 오가기 — 을 실제 BIM 에서 탄다. 편집이 다 들어가고, 그 이력으로 만든 리플레이의
// 끝이 데모를 한 모델과 같고, 다 되돌리면 연 때와 같아야 한다. 벽 외곽선은 형상까지 읽어야 나온다(importIfcWithMeshes).
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_MEP_FULL))('리플레이 데모 (Duplex 건축 + MEP)', () => {
  it('편집이 심기고 리플레이·되돌리기가 맞으며, 두 층을 오간다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const { model } = mergeModels(open(DUPLEX_ARCH), open(DUPLEX_MEP_FULL))
    const pristine = exportedContent(model)
    const r = demoOn(model)!
    console.log(r.storeys, r.labels.length, r.steps.map((s) => `${s.category}: ${s.label}`).join(' | '))
    expect(r.error).toBeUndefined()
    expect(r.steps.map((s) => s.label)).toEqual(r.labels)
    expect(r.replayed).toBe(r.edited)
    expect(r.undone).toBe(pristine)
    expect(new Set(r.storeys).size).toBe(2)
    expect(r.labels.length).toBeGreaterThanOrEqual(20)
  })
})
