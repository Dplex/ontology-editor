import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, createSpace, renameSpace, restore, sameNameSpaces, setSpacesKind, snapshotSpace, type Snapshot } from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { splitByStorey } from './storey-drafts'
import { modelToTTL, escapeLocalName } from './export/ttl'
import type { Model, Space } from './model'

// 방 종류 일괄 수정(OE-SPC-17). two-rooms.ifc 는 1F 회의실(101)·복도(102), 2F 창고(201)다. 복도와 창고의 공간명을 성수처럼 약어
// `S.T` 로 바꿔 두 층에 같은 공간명을 만든다 — 이름 사전은 `S.T` 를 모른다. 창고는 OmniClass 코드로 종류(창고)를 읽고, 복도는 모름이 된다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/two-rooms.ifc', import.meta.url)))))

let model: Model
let base: ReturnType<typeof baselineOf>
beforeEach(() => {
  model = read()
  base = baselineOf(model)
  for (const s of spaces(model).filter((s) => s.name !== '101')) renameSpace(model, s.id, 'S.T')
})
const spaces = (m: Model) => m.storeys.flatMap((s) => s.spaces)
const byNumber = (n: string, m = model): Space => spaces(m).find((s) => s.name === n)!
/** TTL 에서 그 물리존 주어의 클래스. */
const classOf = (ttl: string, id: string) => {
  const head = `ex:${escapeLocalName(id)} a `
  return ttl.split('\n').find((l) => l.startsWith(head))?.slice(head.length).split(/[\s;]/)[0]
}

describe('방 종류 일괄 수정 (OE-SPC-17)', () => {
  it('같은 공간명의 방은 층이 달라도 한 묶음이고, 공간명이 비면 그 방 하나다', () => {
    expect(sameNameSpaces(model, byNumber('102').id).map((s) => s.name).sort()).toEqual(['102', '201'])
    expect(sameNameSpaces(model, byNumber('101').id).map((s) => s.name)).toEqual(['101'])
    renameSpace(model, byNumber('101').id, '  ')
    expect(sameNameSpaces(model, byNumber('101').id)).toHaveLength(1)
  })

  it('같은 공간명의 방을 한 번에 같은 종류로 바꾸고, TTL 의 Brick 클래스가 바뀌며, 되돌리면 한 번에 돌아온다', () => {
    const group = sameNameSpaces(model, byNumber('102').id)
    expect(group.map((s) => s.kind ?? null)).toEqual([null, 'storage'])
    const snap: Snapshot = { kind: 'many', parts: group.map((s) => snapshotSpace(model, s.id)!) }
    expect(setSpacesKind(model, group.map((s) => s.id), 'staircase')).toBe(2)
    for (const s of group) expect(s).toMatchObject({ kind: 'staircase', kindSource: 'edit' })
    const ttl = modelToTTL(model)
    for (const s of group) expect(classOf(ttl, s.id)).toBe('brick:Staircase')
    expect(classOf(ttl, byNumber('101').id)).toBe('brick:Conference_Room')
    restore(model, snap)
    expect(group.map((s) => s.kind ?? null)).toEqual([null, 'storage'])
  })

  it('사람이 정한 종류는 이름을 고쳐도 그대로이고, [이름으로 정하기] 는 이름 사전으로 돌아간다', () => {
    const office = byNumber('101')
    setSpacesKind(model, [office.id], 'storage')
    renameSpace(model, office.id, '회의실 A')
    expect(office).toMatchObject({ kind: 'storage', kindSource: 'edit' })
    expect(setSpacesKind(model, [office.id], undefined)).toBe(1)
    expect(office).toMatchObject({ kind: 'conference', kindSource: 'dict' })
  })

  it('이름 사전이 읽는 값과 같은 종류를 고르면 편집으로 남지 않고, "모름" 으로 정하면 사전이 읽은 것을 지운다', () => {
    const office = byNumber('101')
    expect(setSpacesKind(model, [office.id], 'conference')).toBe(0)
    expect(office.kindSource).toBe('dict')
    expect(setSpacesKind(model, [office.id], null)).toBe(1)
    expect(office).toMatchObject({ kind: null, kindSource: 'edit' })
    expect(classOf(modelToTTL(model), office.id)).toBe('brick:Room')
    // 사전에 없는 종류 이름은 받지 않는다.
    expect(setSpacesKind(model, [office.id], 'no_such_kind')).toBe(0)
  })

  it('편집 파일과 층별 조각을 거쳐도 같은 종류다. 사람이 그린 물리존의 종류도 남는다', () => {
    const group = sameNameSpaces(model, byNumber('102').id)
    setSpacesKind(model, group.map((s) => s.id), 'staircase')
    setSpacesKind(model, [byNumber('101').id], null)
    const made = createSpace(model, model.storeys[0].id, { name: '103', longName: '휴게', footprint: [[20, 0], [24, 0], [24, 4], [20, 4]] })!.created[0]
    setSpacesKind(model, [made], 'storage')
    const file = exportEdits(model, base, 'two-rooms.ifc')
    expect(file.spaces.filter((r) => r.kind !== undefined).map((r) => r.kind).sort()).toEqual([null, 'staircase', 'staircase'].sort())
    expect(file.spacesAdded?.[0].kind).toBe('storage')

    const home = new Map(model.storeys.flatMap((st) => st.spaces.map((sp) => [sp.id, st.id] as const)))
    for (const files of [[file], [...splitByStorey(file, (id) => home.get(id) ?? null).values()]]) {
      const fresh = read()
      for (const f of files) applyEdits(fresh, JSON.parse(JSON.stringify(f)))
      expect(modelToTTL(fresh)).toBe(modelToTTL(model))
      for (const s of spaces(model)) expect(spaces(fresh).find((x) => x.id === s.id)).toMatchObject({ kind: s.kind ?? null, kindSource: s.kindSource })
    }
  })
})
