import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import { addWall, baselineOf, moveEquipment, renameSpace, setFlowDirection, setSystemKind } from './edit'
import { createCustomZone } from './custom-zone'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import type { Model } from './model'
import { clearStoreyDone, markStoreyDone, storeyProgress, storeySignature } from './storey-progress'

// 층 단위 진행(OE-MAN-06). 완료는 그때 층의 지문과 지금 지문을 견줘서 정한다 — 고치면 저절로 풀리고, 되돌리면 돌아온다.

let opened: Model
beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const load = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))
  opened = mergeModels(load('two-rooms.ifc'), load('mep.ifc')).model
}, 60_000)

const states = (m: Model) => storeyProgress(m).map((p) => `${p.name} ${p.state}`)

describe('층 단위 진행 (OE-MAN-06)', () => {
  it('완료한 층을 고치면 "완료 뒤 고침" 이 되고, 되돌리면 다시 완료다. 다른 층 편집은 상관없다', () => {
    const m = structuredClone(opened)
    const [f1, f2] = m.storeys
    expect(states(m)).toEqual(['1F todo', '2F todo'])
    markStoreyDone(m, f1.id, new Date('2026-10-03T10:00:00Z'))
    expect(storeyProgress(m)[0]).toEqual({ id: f1.id, name: '1F', state: 'done', at: '2026-10-03T10:00:00.000Z' })

    // 다른 층의 방 이름을 고쳐도 1F 는 그대로다.
    if (f2.spaces[0]) renameSpace(m, f2.spaces[0].id, '다른 층 이름')
    expect(states(m)[0]).toBe('1F done')

    const device = f1.equipment.find((e) => e.position)!
    const saved = structuredClone(device)
    const from = device.position!
    moveEquipment(m, device.id, [from[0] + 1, from[1], from[2]])
    expect(states(m)[0]).toBe('1F changed')
    // 손으로 제자리에 옮겨도 "사람이 옮긴 좌표" 라는 출처가 남아 완료가 아니다 — 내보낼 GeoJSON 이 다르다.
    moveEquipment(m, device.id, from)
    expect(states(m)[0]).toBe('1F changed')
    // 되돌리기(스냅숏을 그대로 돌려놓기)면 완료로 돌아온다.
    for (const key of Object.keys(device)) if (!(key in saved)) delete (device as Record<string, unknown>)[key]
    Object.assign(device, saved)
    expect(states(m)[0]).toBe('1F done')
  })

  it('그 층 설비가 든 계통을 고쳐도 풀린다 — 그 층 파일의 계통 블록이 바뀐다', () => {
    const m = structuredClone(opened)
    const f1 = m.storeys[0]
    const system = m.systems.find((s) => s.memberIds.some((id) => f1.equipment.some((e) => e.id === id)))!
    markStoreyDone(m, f1.id)
    expect(setSystemKind(m, system.id, system.kind === 'supply_air' ? 'return_air' : 'supply_air')).not.toBeNull()
    expect(states(m)[0]).toBe('1F changed')
  })

  it('지문은 배열 순서·객체 열쇠 순서와 상관없다 — 되돌리기가 같은 값을 다른 순서로 돌려놓아도 같다', () => {
    const m = structuredClone(opened)
    const f1 = m.storeys[0]
    const before = storeySignature(m, f1)
    f1.equipment = [...f1.equipment].reverse().map((e) => Object.fromEntries(Object.entries(e).reverse()) as typeof e)
    f1.spaces = [...f1.spaces].reverse()
    m.connections = [...m.connections].reverse()
    expect(storeySignature(m, f1)).toBe(before)
  })

  it('완료를 지우면 할 일로 돌아가고, 고친 층을 다시 완료하면 지금 지문이 적힌다', () => {
    const m = structuredClone(opened)
    const f1 = m.storeys[0]
    markStoreyDone(m, f1.id)
    const device = f1.equipment.find((e) => e.position)!
    moveEquipment(m, device.id, [device.position![0] + 2, device.position![1], device.position![2]])
    expect(states(m)[0]).toBe('1F changed')
    markStoreyDone(m, f1.id)
    expect(states(m)[0]).toBe('1F done')
    expect(clearStoreyDone(m, f1.id)).toBe(true)
    expect(states(m)[0]).toBe('1F todo')
    expect(clearStoreyDone(m, f1.id)).toBe(false)
  })

  it('편집 파일에 남는다 — 다시 열어 얹으면 완료·완료 뒤 고침·완료한 때가 그대로다', () => {
    const m = structuredClone(opened)
    const base = baselineOf(opened)
    const [f1, f2] = m.storeys
    markStoreyDone(m, f1.id, new Date('2026-10-03T10:00:00Z'))
    markStoreyDone(m, f2.id, new Date('2026-10-03T11:00:00Z'))
    // 2F 에 설비가 없으면 방 이름으로 고친다. 어느 쪽이든 2F 지문이 바뀐다.
    const device = f2.equipment.find((e) => e.position)
    if (device) moveEquipment(m, device.id, [device.position![0] + 1, device.position![1], device.position![2]])
    else renameSpace(m, f2.spaces[0].id, '완료 뒤 고친 이름')
    // 1F 에도 편집이 하나 있다. 완료한 뒤가 아니라 그 전에 한 것으로 치려면 완료를 다시 누른다.
    const d1 = f1.equipment.find((e) => e.position)!
    moveEquipment(m, d1.id, [d1.position![0] + 0.5, d1.position![1], d1.position![2]])
    markStoreyDone(m, f1.id, new Date('2026-10-03T12:00:00Z'))
    expect(states(m)).toEqual(['1F done', '2F changed'])

    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'x.ifc')))
    if (typeof file === 'string') throw new Error(file)
    expect(file.storeysDone).toEqual([
      { id: f1.id, at: '2026-10-03T12:00:00.000Z' },
      { id: f2.id, at: '2026-10-03T11:00:00.000Z', changed: true },
    ])
    const again = structuredClone(opened)
    const result = applyEdits(again, file)
    expect(result.missing.storeys).toBe(0)
    expect(storeyProgress(again)).toEqual(storeyProgress(m))
  })

  it('완료를 하나도 안 했으면 편집 파일에 칸이 없다(예전 파일과 같은 모양)', () => {
    const file = exportEdits(structuredClone(opened), baselineOf(opened), 'x.ifc')
    expect('storeysDone' in file).toBe(false)
  })

  // 지문이 그 층 파일에 나갈 것을 다 보는지 — 설비 말고 연결·커스텀존·벽만 고쳐도 풀린다.
  it('그 층 설비의 연결 방향, 커스텀존, 벽만 고쳐도 풀린다', () => {
    const fresh = () => {
      const m = structuredClone(opened)
      markStoreyDone(m, m.storeys[0].id)
      return m
    }
    let m = fresh()
    const mine = new Set(m.storeys[0].equipment.map((e) => e.id))
    const link = m.connections.find((c) => !c.directed && (mine.has(c.from) || mine.has(c.to)))!
    setFlowDirection(link, link.to)
    expect(states(m)[0]).toBe('1F changed')

    m = fresh()
    expect(createCustomZone(m, m.storeys[0].id, { name: '임원석', footprint: [[2, 1], [4, 1], [4, 3], [2, 3]] })).toHaveProperty('id')
    expect(states(m)[0]).toBe('1F changed')

    m = fresh()
    expect(addWall(m, m.storeys[0].id, [0, -3], [4, -3], 0.2)).toHaveProperty('id')
    expect(states(m)[0]).toBe('1F changed')
  })

  it('편집 파일의 완료한 층을 못 찾으면 못 찾은 층으로 센다', () => {
    const m = structuredClone(opened)
    markStoreyDone(m, m.storeys[0].id)
    const file = parseEditFile(JSON.stringify(exportEdits(m, baselineOf(opened), 'x.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const other = structuredClone(opened)
    other.storeys = other.storeys.filter((s) => s.id !== m.storeys[0].id)
    expect(applyEdits(other, file).missing.storeys).toBe(1)
  })
})
