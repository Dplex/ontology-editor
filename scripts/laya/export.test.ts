// Laya 학습·평가 재료를 뽑는다. 가진 BIM 을 앱의 임포터로 읽어, 편집 화면 "종류를 모르는 패밀리" 칸이 사람에게
// 보이는 단서(이름·IFC 클래스·계통·이웃·위치)를 패밀리마다 한 줄로 쓴다. 방과 계통도 같은 모양으로 쓴다.
//
//   npx vitest run --config scripts/laya/vitest.config.ts
//
// 결과는 data/laya/*.jsonl (data/ 는 gitignore). 133 으로 옮겨 scripts/laya/train.py 가 읽는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, it } from 'vitest'
import { importIfcWithMeshes } from '../../src/lib/ifc/import'
import { mergeModels } from '../../src/lib/merge'
import { familyKeyOf } from '../../src/lib/edit'
import { clueText, familyClues } from '../../src/lib/family-clues'
import { EQUIPMENT_KINDS, ROOM_KINDS, SYSTEM_KINDS, equipmentKind, roomKind, systemKind } from '../../src/lib/kinds'
import { hiddenSuggestions } from '../../src/lib/kind-suggest'
import { isConduit, type Model } from '../../src/lib/model'

const BUILDINGS: [string, string[]][] = [
  ['clinic', ['Arch', 'Eng-HVAC', 'Eng-MEP', 'Eng-ELE'].map((f) => `data/NBU_MedicalClinic/NBU_MedicalClinic_${f}.ifc`)],
  ['duplex', ['Arch', 'Eng-HVAC', 'Eng-MEP'].map((f) => `data/NBU_Duplex/NBU_Duplex-Apt_${f}.ifc`)],
  ['seongsu', ['data/성수/Factorial_건축.ifc', 'data/성수/Factorial_기계.ifc']],
  ['ifc4mep', ['data/ifc4Mep_IFC4.ifc']],
  ['office_a', ['data/Office_A_20110811.ifc']],
  ['dental', ['data/dental_clinic.ifc']],
  ['c20', ['data/C20-Institute-Var-2.ifc']],
  ['ac20', ['data/AC20-FZK-Haus.ifc']],
]
const OUT = 'data/laya'

type Tally = Map<string, number>
const add = (m: Tally, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const majority = (m: Tally) => ([...m].sort((a, b) => b[1] - a[1])[0] ?? [null])[0]

/**
 * 패밀리마다 한 줄. 단서와 그 글(`state`, 이름을 가린 `stateHidden`)은 화면과 같은 family-clues.ts 로 만든다. 종류를 아는
 * 패밀리도 넣어야 해서 `unknownOnly` 를 끈다. 정답은 종류와 그 출처(사전·BIM), 기준선은 지금 화면의 후보다.
 */
function families(model: Model, building: string) {
  const baseline = hiddenSuggestions(model)
  const clues = familyClues(model, { unknownOnly: false })
  const acc = new Map<string, { declared: Tally; kinds: Tally; sources: Tally; unknown: number }>()
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (isConduit(e.role)) continue
      const key = familyKeyOf(e)
      const a = acc.get(key) ?? { declared: new Map(), kinds: new Map(), sources: new Map(), unknown: 0 }
      if (e.declaredType) add(a.declared, e.declaredType)
      if (equipmentKind(e.kind)) {
        add(a.kinds, e.kind!)
        add(a.sources, e.kindSource ?? 'dict')
      } else a.unknown++
      acc.set(key, a)
    }
  }
  return [...clues.values()].map((c) => {
    const a = acc.get(c.key)!
    return {
      building, ...c, declaredType: majority(a.declared),
      state: clueText(c), stateHidden: clueText(c, true),
      // 화면과 같은 기준: 종류를 모르는 대수가 하나라도 있으면 모르는 패밀리.
      kind: a.unknown === 0 && a.kinds.size ? majority(a.kinds) : null,
      kindSource: a.unknown === 0 && a.sources.size ? majority(a.sources) : null,
      baseline: baseline.get(c.key) ?? null,
    }
  })
}

function rooms(model: Model, building: string) {
  return model.storeys.flatMap((st) =>
    st.spaces.map((sp) => ({
      building, storey: st.name, name: sp.name, longName: sp.longName, omniclass: sp.omniclass ?? null,
      kind: roomKind(sp.kind) ? sp.kind : null, kindSource: sp.kindSource ?? null,
      devices: [...st.equipment.filter((e) => e.spaceId === sp.id && !isConduit(e.role)).reduce((m, e) => add(m, equipmentKind(e.kind)?.label ?? '종류 모름'), new Map() as Tally)]
        .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k} ${c}`).join(' · '),
    })),
  )
}

function systemRows(model: Model, building: string) {
  return model.systems.map((s: any) => ({
    building, name: s.name, objectType: s.objectType ?? null, predefinedType: s.predefinedType ?? null,
    kind: systemKind(s.kind) ? s.kind : null, kindSource: s.kindSource ?? null, fluid: s.fluid ?? null, fluidSource: s.fluidSource ?? null,
  }))
}

describe('Laya 재료 뽑기', () => {
  it('라벨', () => {
    mkdirSync(OUT, { recursive: true })
    const pick = (list: { kind: string; label: string }[]) => Object.fromEntries(list.map((k) => [k.kind, k.label]))
    writeFileSync(`${OUT}/labels.json`, JSON.stringify({ equipment: pick(EQUIPMENT_KINDS), room: pick(ROOM_KINDS), system: pick(SYSTEM_KINDS as any) }, null, 1))
  })
  for (const [building, files] of BUILDINGS) {
    it.skipIf(!files.every(existsSync))(building, async () => {
      const api = new WebIFC.IfcAPI()
      await api.Init()
      let model: Model | null = null
      for (const f of files) {
        const m = importIfcWithMeshes(api, new Uint8Array(readFileSync(f))).model
        model = model ? mergeModels(model, m).model : m
      }
      mkdirSync(OUT, { recursive: true })
      const write = (name: string, rows: unknown[]) => writeFileSync(`${OUT}/${building}.${name}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
      const fam = families(model!, building)
      write('families', fam)
      write('rooms', rooms(model!, building))
      write('systems', systemRows(model!, building))
      console.log(building, 'families', fam.length, 'known', fam.filter((f) => f.kind).length, 'bim', fam.filter((f) => f.kindSource === 'bim').length)
    }, 900_000)
  }
})
