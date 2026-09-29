import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../src/lib/ifc/import'
import { mergeModels, type MergeReport } from '../src/lib/merge'
import { featureCoverage, type Coverage } from '../src/lib/coverage'
import { requirementsReport } from '../src/lib/requirements'
import type { Model } from '../src/lib/model'
import { modelToTTL } from '../src/lib/export/ttl'
import { distanceToRing } from '../src/lib/mapping'
import { isConduit } from '../src/lib/model'

// 가진 BIM 마다 DT 온톨로지의 피처를 누가 얼마나 채우는지 재서 data/피처-채움.md 에 쓴다(정본 3.9 의 표).
// 건축·설비가 갈린 건물은 합쳐서 잰다. 실패하지 않는다 — 측정이다. 파일이 없으면 그 건물만 건너뛴다.
const OUT = 'data/피처-채움.md'
const SETS: { name: string; files: string[] }[] = [
  { name: '성수 건축+기계', files: ['data/성수/Factorial_건축.ifc', 'data/성수/Factorial_기계.ifc'] },
  { name: '병원 건축+HVAC', files: ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'] },
  { name: 'Duplex 건축+HVAC', files: ['data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc', 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'] },
  { name: 'Duplex 건축+MEP', files: ['data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc', 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'] },
  { name: 'ifc4Mep(설비만)', files: ['data/ifc4Mep_IFC4.ifc'] },
  { name: 'AC20-FZK-Haus(건축만)', files: ['data/AC20-FZK-Haus.ifc'] },
]

type Result = { name: string; coverage: Coverage[]; ttl: Record<string, number>; unlocated: Record<string, number>; mandatory: { standard: number; partial: number; missing: number; unmeasured: number; elsewhere: number } }
const results: Result[] = []
let api: WebIFC.IfcAPI

beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
  api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
})

afterAll(() => {
  if (!results.length) return
  const keys = results[0].coverage.map((c) => c.key)
  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '—')
  const lines = [
    '# 피처별 채움',
    '',
    `${new Date().toISOString()} · \`npm run check:sample -- scripts/coverage.test.ts\``,
    '',
    '칸은 "자동으로 채운 몫(BIM · 계산 · 사전) / 대상" 이다. 괄호는 그중 BIM 이 직접 말한 몫. BIM 밖 피처는 어디서 오는지를 적는다.',
    '',
    `| 피처 | ${results.map((r) => r.name).join(' | ')} |`,
    `|---|${results.map(() => '---').join('|')}|`,
    ...keys.map((k) => {
      const first = results[0].coverage.find((c) => c.key === k)!
      const cells = results.map((r) => {
        const c = r.coverage.find((x) => x.key === k)!
        if (c.outside) return c.of && c.calc ? `${c.outside}: ${pct(c.calc, c.of)}` : `(${c.outside})`
        if (!c.of) return '—'
        const auto = c.bim + c.calc + c.dict + c.edit
        return `${pct(auto, c.of)} (${pct(c.bim, c.of)})`
      })
      return `| ${k} ${first.feature} | ${cells.join(' | ')} |`
    }),
    '',
    '## 필수 요구(11개)',
    '',
    `| 건물 | 표준 자리 | 다른 자리 | 일부 | 없음 | 잴 수 없음 |`,
    `|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.name} | ${r.mandatory.standard} | ${r.mandatory.elsewhere} | ${r.mandatory.partial} | ${r.mandatory.missing} | ${r.mandatory.unmeasured} |`),
    '',
    '## 온톨로지에 나가는 관계 수(TTL)',
    '',
    '규칙 방향은 확정 전이라 feeds 에 들지 않는다. 방을 못 찾은 기기는 층을 hasLocation 으로 적는다.',
    '',
    `| 건물 | 주어 | hasPart | hasLocation | feeds | hasPoint | label |`,
    `|---|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.name} | ${r.ttl.subjects} | ${r.ttl['brick:hasPart']} | ${r.ttl['brick:hasLocation']} | ${r.ttl['brick:feeds']} | ${r.ttl['brick:hasPoint']} | ${r.ttl['rdfs:label']} |`),
    '',
    '## 방을 못 찾은 기기가 왜 비었나(F11)',
    '',
    `| 건물 | ${Object.keys(results[0].unlocated).join(' | ')} |`,
    `|---|${Object.keys(results[0].unlocated).map(() => '---').join('|')}|`,
    ...results.map((r) => `| ${r.name} | ${Object.values(r.unlocated).join(' | ')} |`),
    '',
    '## 건물별 자세히',
    '',
    ...results.flatMap((r) => [
      `### ${r.name}`,
      '',
      '| 피처 | 대상 | BIM | 계산 | 사전 | 사람 | 비어 있음 | 비고 |',
      '|---|---|---|---|---|---|---|---|',
      ...r.coverage.map((c) => `| ${c.key} ${c.feature} | ${c.of} ${c.unit} | ${c.bim} | ${c.calc} | ${c.dict} | ${c.edit} | ${c.outside ? `(${c.outside})` : c.missing} | ${c.note ?? ''} |`),
      '',
    ]),
  ]
  mkdirSync('data', { recursive: true })
  writeFileSync(OUT, lines.join('\n'))
})

/**
 * 방을 못 찾은 기기(F11 의 빈 몫)가 왜 비었나. 같은 층에서 가장 가까운 방 경계까지의 평면 거리로 가른다 — 경계 바로 밖이면
 * 모델링 오차(완전성 검사의 [방 안으로 옮기기]), 멀면 방이 그려지지 않은 자리(샤프트·옥상·주차장 등)다.
 */
function whyUnlocated(model: Model): Record<string, number> {
  const out: Record<string, number> = { '좌표 없음': 0, '0.3m 안': 0, '0.3~2m': 0, '2m 넘게': 0, '층에 방이 없음': 0 }
  for (const storey of model.storeys) {
    const rings = storey.spaces.map((sp) => sp.footprint).filter((r) => r.length >= 3)
    for (const e of storey.equipment) {
      if (isConduit(e.role) || e.spaceId) continue
      if (!e.position) out['좌표 없음']++
      else if (!rings.length) out['층에 방이 없음']++
      else {
        const d = Math.min(...rings.map((r) => distanceToRing([e.position![0], e.position![1]], r)))
        out[d <= 0.3 ? '0.3m 안' : d <= 2 ? '0.3~2m' : '2m 넘게']++
      }
    }
  }
  return out
}

/** TTL 에 실제로 나가는 관계의 수. 목적어 목록(쉼표)을 하나씩 센다. */
function ttlCounts(ttl: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of ['brick:hasPart', 'brick:hasLocation', 'brick:feeds', 'brick:hasPoint', 'rdfs:label']) {
    const re = new RegExp(`${p}\\s+([^;]*?)\\s*[;.]\\s*$`, 'gm')
    let n = 0
    for (const m of ttl.matchAll(re)) n += p === 'rdfs:label' ? 1 : m[1].split(',').length
    out[p] = n
  }
  out.subjects = (ttl.match(/^ex:\S+ a /gm) ?? []).length
  return out
}

describe('피처별 채움', () => {
  for (const set of SETS) {
    it.skipIf(!set.files.every((f) => existsSync(f)))(set.name, () => {
      // 문·창 자리까지 읽는다. 방-문-방(F15)은 공간 경계가 없으면 문 자리로 짚는다(앱에서는 "읽을 것" 에서 켠다).
      const models = set.files.map((f) => importIfcWithMeshes(api, new Uint8Array(readFileSync(f)), undefined, { openings: true }).model)
      let model: Model = models[0]
      let merge: MergeReport | null = null
      if (models[1]) {
        // 방이 많은 쪽이 기준이다(앱이 합치는 순서와 같다).
        const [base, overlay] = models[0].storeys.flatMap((s) => s.spaces).length >= models[1].storeys.flatMap((s) => s.spaces).length ? [models[0], models[1]] : [models[1], models[0]]
        const r = mergeModels(base, overlay)
        model = r.model
        merge = r.report
      }
      const coverage = featureCoverage(model)
      const req = requirementsReport(model, merge).filter((x) => x.level === '필수')
      const n = (s: string) => req.filter((x) => x.state === s).length
      results.push({ name: set.name, coverage, ttl: ttlCounts(modelToTTL(model)), unlocated: whyUnlocated(model), mandatory: { standard: n('standard'), elsewhere: n('elsewhere'), partial: n('partial'), missing: n('missing'), unmeasured: n('unmeasured') } })
      // 셈이 어긋나지 않았는지만 본다(채운 몫이 대상을 넘지 않는다).
      for (const c of coverage) expect(c.bim + c.calc + c.dict + c.edit, c.key).toBeLessThanOrEqual(c.of + (c.outside ? c.of : 0))
    }, 900_000)
  }
})
