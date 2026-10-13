import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { escapeLocalName } from './export/ttl'
import { EQUIPMENT_KINDS } from './kinds'
import type { Model } from './model'
import { MAX_COMMANDS, parsePlan, previewPlan, resolveEquipment, resolveSpace } from './edit-commands'

// 말로 편집 시키기(ADR-0060). gemini 가 붙인 ```oe-edit 블록을 읽고, 대상을 지금 모델에서 찾는다. 실행은 App.vue(e2e/edit-commands.spec.ts).
let model: Model
beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  model = importIfc(api, new Uint8Array(readFileSync(resolve(__dirname, 'ifc/fixtures/mep.ifc'))))
})

const block = (json: unknown) => `공조기를 더하겠습니다.\n\n\`\`\`oe-edit\n${JSON.stringify(json)}\n\`\`\``

describe('계획 읽기', () => {
  it('블록이 없으면 null, 있으면 명령 — 하나만 줘도 배열로 받는다', () => {
    expect(parsePlan('AHU-1 은 사무실에 있습니다.')).toBeNull()
    expect(parsePlan(block({ do: 'connect', from: 'a', to: 'b' }))).toEqual({ commands: [{ do: 'connect', from: 'a', to: 'b' }] })
  })
  it('모르는 명령·모르는 종류·빠진 칸·너무 많은 명령은 계획 전체를 받지 않는다', () => {
    expect(parsePlan(block([{ do: 'delete', id: 'x' }]))).toMatchObject({ error: expect.stringContaining('add_equipment·connect 만') })
    expect(parsePlan(block([{ do: 'add_equipment', space: 's', kind: 'toaster' }]))).toMatchObject({ error: expect.stringContaining('toaster') })
    expect(parsePlan(block([{ do: 'connect', from: 'a' }]))).toMatchObject({ error: expect.stringContaining('from·to') })
    expect(parsePlan(block(Array.from({ length: MAX_COMMANDS + 1 }, () => ({ do: 'connect', from: 'a', to: 'b' }))))).toMatchObject({ error: expect.stringContaining(`${MAX_COMMANDS}개까지`) })
    expect(parsePlan('```oe-edit\n[{not json\n```')).toEqual({ error: '편집 계획이 JSON 이 아닙니다' })
  })
})

describe('대상 찾기', () => {
  it('설비는 id · TTL 의 ex:id(이스케이프 포함) · 하나뿐인 이름으로 찾는다', () => {
    const ahu = model.storeys.flatMap((s) => s.equipment).find((e) => e.name === 'AHU-1')!
    expect(resolveEquipment(model, ahu.id)).toMatchObject({ id: ahu.id, label: 'AHU-1' })
    expect(resolveEquipment(model, `ex:${escapeLocalName(ahu.id)}`)).toMatchObject({ id: ahu.id })
    expect(resolveEquipment(model, 'AHU-1')).toMatchObject({ id: ahu.id })
    expect(resolveEquipment(model, '없는 설비')).toMatchObject({ error: expect.stringContaining('찾지 못했습니다') })
  })
  it('방은 id·이름으로 찾고, 같은 이름이 여럿이면 고르지 않는다', () => {
    const office = model.storeys.flatMap((s) => s.spaces)[0]
    expect(resolveSpace(model, `ex:${escapeLocalName(office.id)}`)).toMatchObject({ id: office.id })
    expect(resolveSpace(model, office.longName || office.name)).toMatchObject({ id: office.id })
    const twin = structuredClone(model)
    twin.storeys[0].spaces.push({ ...structuredClone(twin.storeys[0].spaces[0]), id: 'TWIN' })
    expect(resolveSpace(twin, office.longName || office.name)).toMatchObject({ error: expect.stringContaining('2개') })
  })
})

describe('미리보기', () => {
  it('앞에서 더할 설비를 뒤의 연결이 이름으로 가리킬 수 있고, 못 찾은 대상은 ok=false', () => {
    const office = model.storeys.flatMap((s) => s.spaces)[0]
    const plan = parsePlan(block([
      { do: 'add_equipment', space: office.id, kind: 'vav', name: 'VAV-9' },
      { do: 'connect', from: 'AHU-1', to: 'VAV-9' },
      { do: 'connect', from: 'AHU-1', to: '없는 설비' },
    ])) as { commands: Parameters<typeof previewPlan>[1] }
    const p = previewPlan(model, plan.commands)
    expect(p.map((x) => x.ok)).toEqual([true, true, false])
    expect(p[0].text).toContain('VAV "VAV-9" 더하기')
    expect(p[1].text).toBe('AHU-1 – VAV-9(새로 더할 설비) 연결')
  })
})

describe('gemini 안내문(scripts/onto-chat.md)', () => {
  it('편집 계획의 종류 목록이 이름 사전의 종류 전부다 — 종류를 더하면 안내문에도 더한다', () => {
    const md = readFileSync(resolve(__dirname, '../../scripts/onto-chat.md'), 'utf8')
    const listed = [...md.slice(md.indexOf('- 종류(`kind`)')).matchAll(/([a-z_]+)\(/g)].map((m) => m[1])
    expect(listed.sort()).toEqual(EQUIPMENT_KINDS.map((k) => k.kind).sort())
  })
})
