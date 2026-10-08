import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { exportedContent, fuzzEdits, type FuzzOp } from './edit-fuzz'
import * as E from './edit'
import type { Snapshot } from './edit'
import type { Model } from './model'
import { diffLines, formatFeature } from './replay-geo'
import { buildReplay, diffTtl, planOf, ttlBlocks, type PlanItem, type ReplayMessage, type ReplayStart, type ReplayStep } from './replay'

// 리플레이는 되돌리기 이력을 사본 위에서 거꾸로 갔다가 다시 하기로 앞으로 온다. 그래서 끝 상태가 편집한 모델과 같아야 하고,
// 첫 장면은 연 때와 같아야 하며, 단계마다 낸 평면 변화를 쌓으면 끝 평면이 된다. 편집을 무작위로 섞어(edit-fuzz.ts) 본다.
let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (name: string): Model => {
  const path = fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url))
  const model = importIfc(api, new Uint8Array(readFileSync(path)))
  model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
  model.systems.push({ id: 'sys2', name: '순환수 공급', memberIds: [], source: 'ifc', kind: 'hydronic_supply', fluid: null })
  return model
}

const sig = (plan: Iterable<PlanItem>) => JSON.stringify([...plan].sort((a, b) => (a.key < b.key ? -1 : 1)))


function run(pristine: Model, seed: number, skip: ReadonlySet<FuzzOp> = new Set()) {
  let input: { model: Model; entries: { label: string; time: number; snapshot: Snapshot }[] } | null = null
  let edited = ''
  fuzzEdits(pristine, seed, 25, skip, (m, undo) => {
    // 모델과 스냅숏을 한 번에 복사한다. 워커로 넘기는 postMessage 와 같다.
    input = structuredClone({ model: m, entries: undo.map((snapshot, i) => ({ label: `#${i}`, time: 0, snapshot })) })
    edited = exportedContent(m)
  })
  const messages: ReplayMessage[] = []
  buildReplay(input!, (msg) => messages.push(msg))
  return { input: input!, edited, messages }
}

describe('편집 리플레이', () => {
  it('끝 상태는 편집한 모델과 같고, 첫 장면은 연 때와 같고, 단계 변화를 쌓으면 끝 평면이 된다 (씨앗 60개)', () => {
    const pristine = read('mep.ifc')
    const opened = sig(planOf(pristine).values())
    const failed: string[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const { input, edited, messages } = run(pristine, seed)
      const error = messages.find((m) => m.type === 'error')
      if (error) {
        failed.push(`seed ${seed} 오류 ${JSON.stringify(error)}`)
        continue
      }
      const start = messages.find((m): m is { type: 'start'; start: ReplayStart } => m.type === 'start')!.start
      const steps = messages.filter((m): m is { type: 'step'; step: ReplayStep } => m.type === 'step').map((m) => m.step)
      if (steps.length !== input.entries.length) failed.push(`seed ${seed} 단계 ${steps.length}/${input.entries.length}`)
      if (sig(start.plan) !== opened) failed.push(`seed ${seed} 첫 장면이 연 때와 다르다`)
      if (exportedContent(input.model) !== edited) failed.push(`seed ${seed} 끝 상태가 편집한 모델과 다르다`)
      const plan = new Map(start.plan.map((p) => [p.key, p]))
      for (const s of steps) for (const c of s.changes) c.after ? plan.set(c.key, c.after) : plan.delete(c.key)
      if (sig(plan.values()) !== sig(planOf(input.model).values())) failed.push(`seed ${seed} 쌓은 평면이 끝 평면과 다르다`)
    }
    expect(failed.slice(0, 3)).toEqual([])
  }, 120_000)

  it('단계마다 카테고리와 바뀐 것이 붙는다 — 설비를 옮기면 그 설비가, 이름을 바꾸면 TTL 의 label 줄이 바뀐다', () => {
    const pristine = read('mep.ifc')
    const { messages } = run(pristine, 7)
    const steps = messages.filter((m): m is { type: 'step'; step: ReplayStep } => m.type === 'step').map((m) => m.step)
    expect(steps.length).toBeGreaterThan(0)
    for (const s of steps) expect(s.category).toBeTruthy()
    // 무언가 바뀐 단계가 대부분이다(되돌리기에 쌓인 것은 실제로 바뀐 편집뿐).
    expect(steps.filter((s) => s.changes.length || s.ttl.length).length).toBeGreaterThan(steps.length / 2)
  }, 60_000)

  it('층의 첫 편집도 TTL 차이가 나온다 — 물리존 이름을 바꾸면 label 줄이 바뀐다', () => {
    const m = read('mep.ifc')
    const room = m.storeys.flatMap((s) => s.spaces)[0]
    const snapshot = E.snapshotSpace(m, room.id)!
    E.renameSpace(m, room.id, `${room.longName} (회의실)`)
    const messages: ReplayMessage[] = []
    buildReplay(structuredClone({ model: m, entries: [{ label: 'rename', time: 0, snapshot }] }), (x) => messages.push(x))
    const step = messages.find((x): x is { type: 'step'; step: ReplayStep } => x.type === 'step')!.step
    expect(step.ttl.flatMap((c) => c.added).some((l) => l.includes('(회의실)'))).toBe(true)
    expect(step.ttl.flatMap((c) => c.removed).some((l) => l.startsWith('rdfs:label'))).toBe(true)
  })

  it('경계를 고친 뒤 되돌렸다 다시 하면, 풀렸던 BIM 소속이 그대로 풀려 있다 (리플레이가 기대는 다시 하기)', () => {
    const m = read('mep.ifc')
    const light = m.storeys.flatMap((s) => s.equipment).find((e) => e.name === 'LIGHT-101-01')!
    const room = m.storeys.flatMap((s) => s.spaces).find((s) => s.id === light.spaceId)!
    expect(light.spaceSource).toBe('bim')
    const before = E.snapshotSpace(m, room.id)!
    E.moveSpaceVertex(m, room.id, 0, [room.footprint[0][0] + 0.25, room.footprint[0][1] + 0.25])
    const edited = { spaceId: light.spaceId, spaceSource: light.spaceSource }
    const after = E.snapshotOf(m, before)!
    E.restore(m, before)
    E.restore(m, after)
    expect({ spaceId: light.spaceId, spaceSource: light.spaceSource }).toEqual(edited)
  })

  const firstStep = (m: Model, snapshot: Snapshot) => {
    const messages: ReplayMessage[] = []
    buildReplay(structuredClone({ model: m, entries: [{ label: 'edit', time: 0, snapshot }] }), (x) => messages.push(x))
    return messages.find((x): x is { type: 'step'; step: ReplayStep } => x.type === 'step')!.step
  }

  it('설비를 옮기면 층 GeoJSON 에서 그 설비 feature 가 맨 앞이고, 좌표 줄이 − 옛 값 + 새 값으로 갈린다', () => {
    const m = read('mep.ifc')
    const ahu = m.storeys.flatMap((s) => s.equipment).find((e) => e.name === 'AHU-1')!
    const snapshot = E.snapshotEquipment(m, ahu.id)!
    const [x, y, z] = ahu.position!
    E.moveEquipment(m, ahu.id, [x + 1, y, z])
    const geo = firstStep(m, snapshot).geojson!
    expect(geo.file).toMatch(/^floor-.+\.geojson$/)
    expect(geo.features[0]).toMatchObject({ id: ahu.id, kind: 'equipment', status: 'changed' })
    const del = geo.features[0].lines.filter((l) => l.kind === 'del').map((l) => l.text)
    const add = geo.features[0].lines.filter((l) => l.kind === 'add').map((l) => l.text)
    expect(del.some((l) => l.includes(`"coordinates": [${x}, ${y}`))).toBe(true)
    expect(add.some((l) => l.includes(`"coordinates": [${x + 1}, ${y}`))).toBe(true)
    expect(geo.features[0].before).toEqual({ type: 'Point', coordinates: [x, y, z] })
    expect(geo.map!.view[0]).toBeLessThan(x)
  })

  it('물리존 꼭짓점을 지우면 그 물리존 feature 의 꼭짓점 줄과 면적 줄이 바뀌고, 평면이 그 둘레를 담는다', () => {
    const m = read('mep.ifc')
    const office = m.storeys.flatMap((s) => s.spaces).find((s) => s.areaM2 > 79 && s.areaM2 < 81)!
    const snapshot = E.snapshotSpace(m, office.id)!
    E.deleteSpaceVertex(m, office.id, 2)
    const geo = firstStep(m, snapshot).geojson!
    const f = geo.features.find((x) => x.id === office.id)!
    expect(f.kind).toBe('space')
    expect(f.lines.some((l) => l.kind === 'del' && l.text.includes('"areaM2": 80'))).toBe(true)
    expect(f.lines.some((l) => l.kind === 'add' && l.text.includes('"areaM2": 40'))).toBe(true)
    expect(f.lines.filter((l) => l.kind === 'del' && /^\s+\[[\d.-]+, [\d.-]+\],$/.test(l.text))).toHaveLength(1)
    // 사무실은 (0,0)~(10,8). 평면이 그 둘레를 다 담는다.
    const [x0, y0, x1, y1] = geo.map!.view
    expect([x0 <= 0, y0 <= 0, x1 >= 10, y1 >= 8]).toEqual([true, true, true, true])
  })

  it('흐름 방향만 바꾼 편집은 GeoJSON 이 그대로다', () => {
    const m = read('mep.ifc')
    const c = m.connections[0]
    const snapshot = E.snapshotFlow(c)
    c.edited = { from: c.to, to: c.from }
    expect(firstStep(m, snapshot).geojson).toBeNull()
  })

  it('JSON 줄 차이는 바뀐 줄 둘레 두 줄만 남기고 접는다', () => {
    const before = formatFeature({ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [1, 2, 0] }, properties: { kind: 'equipment', name: 'A', b: 1, c: 2, d: 3, e: 4 } })
    const after = formatFeature({ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [1.5, 2, 0] }, properties: { kind: 'equipment', name: 'A', b: 1, c: 2, d: 3, e: 5 } })
    const lines = diffLines(before, after)
    expect(lines.map((l) => l.kind)).toEqual(['gap', 'same', 'same', 'del', 'add', 'same', 'same', 'gap', 'same', 'same', 'del', 'add', 'same', 'same'])
    expect(lines[4].text).toBe('    "coordinates": [1.5, 2, 0]')
  })

  it('TTL 차이는 끝의 ; . 를 무시하고 주어별로 갈린다', () => {
    const before = ttlBlocks(['@prefix ex: <x#> .', '', 'ex:A a brick:FCU ;', '    rdfs:label "A" .', '', 'ex:B a brick:Room ;', '    rdfs:label "B" .'].join('\n'))
    const after = ttlBlocks(['ex:A a brick:FCU ;', '    rdfs:label "A" ;', '    brick:hasLocation ex:B .', '', 'ex:B a brick:Room ;', '    rdfs:label "B2" .'].join('\n'))
    expect(diffTtl(before, after)).toEqual([
      { subject: 'ex:A', added: ['brick:hasLocation ex:B'], removed: [] },
      { subject: 'ex:B', added: ['rdfs:label "B2"'], removed: ['rdfs:label "B"'] },
    ])
  })
})
