import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { fuzzEdits } from './edit-fuzz'
import { buildReplay, type ReplayMessage, type ReplayStart, type ReplayStep } from './replay'
import { readableTtl, replayReport } from './replay-report'
import type { Snapshot } from './edit'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
})

function replayOf(seed: number) {
  const path = fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url))
  const pristine = importIfc(api, new Uint8Array(readFileSync(path)))
  let input: { model: Model; entries: { label: string; time: number; snapshot: Snapshot }[] } | null = null
  fuzzEdits(pristine, seed, 20, new Set(), (m, undo) => {
    input = structuredClone({ model: m, entries: undo.map((snapshot, i) => ({ label: `편집 ${i + 1}`, time: 0, snapshot })) })
  })
  const messages: ReplayMessage[] = []
  buildReplay(input!, (x) => messages.push(x))
  return {
    start: messages.find((m): m is { type: 'start'; start: ReplayStart } => m.type === 'start')!.start,
    steps: messages.filter((m): m is { type: 'step'; step: ReplayStep } => m.type === 'step').map((m) => m.step),
  }
}

describe('리플레이 변경 리포트', () => {
  it('장면마다 한 절이 있고, 표의 TTL 합이 머리의 합과 같으며, GUID 대신 이름이 보인다', () => {
    const { start, steps } = replayOf(7)
    expect(steps.length).toBeGreaterThan(3)
    const md = replayReport({ title: 'mep.ifc', start, steps, now: new Date(0) })
    for (const s of steps) expect(md).toContain(`### #${String(s.index + 1).padStart(2, '0')} ${s.category}`)
    const added = steps.reduce((n, s) => n + s.ttlCount.added, 0)
    expect(md).toContain(`편집 ${steps.length}건`)
    expect(md).toContain(`TTL +${added}`)
    // 장면 표 행 수 = 장면 수.
    expect(md.split('\n').filter((l) => /^\| \d{2} \|/.test(l))).toHaveLength(steps.length)
    // AHU-1 의 GUID(0MEP$Equip$AHU1$0000)는 이름으로 바뀐다.
    expect(md).not.toMatch(/ex:0MEP/)
  })

  it('TTL 줄의 ex:<이름 모름> 은 이스케이프만 풀고, 아는 것은 이름으로 바꾼다', () => {
    const names = new Map([['abc', '사무실']])
    expect(readableTtl('ex:abc brick:hasPart ex:x\\$y', names)).toBe('사무실 brick:hasPart ex:x$y')
  })
})
