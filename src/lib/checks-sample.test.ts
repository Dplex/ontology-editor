// 완전성 검사의 고정 샘플(OE-BIM-18 AC3). mep.ifc 1F 를 열었을 때 규칙마다 대상·위반·측정 불가가 몇인지 못 박는다 — 규칙이나
// 판정을 바꿔 숫자가 움직이면 여기서 보인다. 방 없는 파일(설비 판본만 연 것)은 소속 규칙을 잴 수 없다고 말한다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { completenessChecks } from './checks'
import { airServices } from './served'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
/** 규칙 → [대상, 위반, 측정 불가 사유]. */
const table = (m: Model) => Object.fromEntries(completenessChecks(m, airServices(m, m.connections)).map((c) => [c.key, [c.total, c.failed.length, c.skipped ?? null]]))

describe('완전성 검사 고정 샘플 (OE-BIM-18)', () => {
  it('mep.ifc 의 규칙별 대상·위반·측정 불가, 방 없는 파일은 소속 규칙을 잴 수 없다고 한다 [OE-BIM-18#3~]', () => {
    expect(table(read())).toEqual({
      'terminal-source': [2, 1, null],
      'source-terminal': [1, 0, null],
      'terminal-single-source': [1, 0, null],
      'device-space': [5, 1, null],
      'device-connected': [3, 0, null],
      'conduit-ends': [1, 0, null],
      'connection-fluid': [3, 0, null],
      'conduit-path': [1, 1, null],
      // 열원·스프링클러가 없는 파일이라 잴 대상이 없다(화면은 "이 파일에는 검사할 대상이 없습니다").
      'heat-source-user': [0, 0, null],
      'hydronic-user-source': [1, 1, null],
      'sprinkler-fp': [0, 0, null],
    })
    const roomless = read()
    for (const s of roomless.storeys) s.spaces = []
    expect(table(roomless)['device-space'][2]).toBe('방이 없는 파일입니다. 건축 파일을 덧붙이면 검사할 수 있습니다.')
  })
})
