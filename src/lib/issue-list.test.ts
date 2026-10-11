// 어긴 요소 목록과 BCF(ADR-0051). 목록의 R 마다 개수는 요구사항 보고서의 "대상 − 표준 자리" 와 같아야 한다 — 한쪽 조건만 고치면
// 결과 리포트(HTML)의 수와 CSV·BCF 의 수가 어긋난다. 실제 BIM(Duplex·병원)은 있을 때만 잰다.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import { requirementsReport } from './requirements'
import { completenessChecks } from './checks'
import { airServices } from './served'
import { issueList, issuesCSV, requirementHits, type IssueItem } from './issue-list'
import { bcfTopics, cameraFor, issuesToBCF } from './export/bcf'
import { crc32, readStoreZip, storeZip } from './zip'
import type { Model } from './model'

const FIX = (f: string) => fileURLToPath(new URL(`./ifc/fixtures/${f}`, import.meta.url))
const DATA = (f: string) => fileURLToPath(new URL(`../../data/${f}`, import.meta.url))
/** 요소로 가를 수 있는 R. 나머지(단위·좌표계·IFC 버전·GUID 유지·층 이름 맞춤)는 파일 하나에 대한 말이라 리포트에만 있다. */
const ELEMENT_R = ['R2', 'R3', 'R4', 'R5', 'R11', 'R14', 'R16', 'R21', 'R22', 'R23', 'R24']

let api: WebIFC.IfcAPI
const open = (f: string) => importIfc(api, new Uint8Array(readFileSync(f)))
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

function sameAsReport(model: Model, merge: Parameters<typeof requirementsReport>[1] = null) {
  const hits = requirementHits(model)
  for (const row of requirementsReport(model, merge)) {
    if (!ELEMENT_R.includes(row.id) || !row.counts) continue
    expect(hits.get(row.id)?.length ?? 0, `${row.id} ${row.title}`).toBe(row.counts.of - row.counts.standard)
  }
}

describe('어긴 요소 목록', () => {
  it('픽스처마다 R 별 요소 수가 요구사항 보고서의 "대상 − 표준" 과 같다', () => {
    for (const f of ['mep.ifc', 'mep-v2.ifc', 'two-rooms.ifc', 'proxy.ifc', 'millimetre.ifc', 'storey-height.ifc', 'foot.ifc']) sameAsReport(open(FIX(f)))
  })

  const duplex = [DATA('NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'), DATA('NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc')]
  const clinic = [DATA('NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'), DATA('NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc')]
  it.skipIf(![...duplex, ...clinic].every(existsSync))('실제 BIM(Duplex·병원 건축+설비)도 같고, Revit 요소 ID 가 이름 끝에서 잡힌다', () => {
    for (const [a, b] of [duplex, clinic]) {
      const m = mergeModels(open(a), open(b))
      sameAsReport(m.model, m.report)
      const items = issueList(m.model, requirementsReport(m.model, m.report), completenessChecks(m.model, airServices(m.model, m.model.connections)))
      const devices = items.filter((i) => i.ifcClass !== 'Space')
      expect(devices.filter((i) => i.revitId).length / devices.length).toBeGreaterThan(0.95)
      expect(items.every((i) => /^[0-9A-Za-z_$]{22}$/.test(i.id))).toBe(true)
    }
  }, 120_000)

  it('사람이 더한 요소는 싣지 않는다(BIM 에 없다)', () => {
    const m = open(FIX('mep.ifc'))
    const room = m.storeys[0].spaces[0]
    m.storeys[0].spaces.push({ ...room, id: 'U_new', name: '', longName: '', footprint: [], boundedBy: [], added: true })
    const hits = [...requirementHits(m).values()].flat()
    expect(hits.some((h) => h.el.v.id === 'U_new')).toBe(false)
  })

  it('완전성 검사의 어긴 요소는 R 을 붙이고 요청은 비운다(요구사항 줄과 고칠 곳이 다르다)', () => {
    const m = open(FIX('mep.ifc'))
    const checks = completenessChecks(m, airServices(m, m.connections))
    const items = issueList(m, requirementsReport(m), checks)
    const fromChecks = items.filter((i) => i.problem.startsWith('이 규칙을 어김'))
    for (const i of fromChecks) {
      expect(i.r).toMatch(/^R\d+$/)
      expect(i.ask).toBe('')
    }
  })
})

const item = (over: Partial<IssueItem>): IssueItem => ({
  r: 'R4', cls: 'B', rule: '문·창의 개구부 관계', problem: '어느 벽에 있는지가 없다', kind: 'missing', id: '2O2Fr$t4X7Zf8NOew3FLOH', revitId: '123456',
  name: 'Door, "Main"', ifcClass: 'Door', storey: 'Level 1', at: [1, 2, 0], ask: '값을 넣어 달라', ...over,
})

describe('CSV', () => {
  it('엑셀이 UTF-8 로 열고(BOM), 쉼표·따옴표가 든 칸을 감싼다', () => {
    const csv = issuesCSV([item({})])
    expect(csv.startsWith('﻿R,분류,규칙,무엇이 없나,GlobalId,Revit 요소 ID,이름,IFC 클래스,층,X,Y,Z,요청\r\n')).toBe(true)
    expect(csv).toContain('R4,B-부재,문·창의 개구부 관계,어느 벽에 있는지가 없다,2O2Fr$t4X7Zf8NOew3FLOH,123456,"Door, ""Main""",Door,Level 1,1,2,0,값을 넣어 달라\r\n')
  })
})

describe('BCF', () => {
  let n = 0
  const gid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

  it('토픽은 (R · 규칙 · 층)마다 하나이고, 22자 GlobalId 만 고르며, 라벨에 R 과 분류를 단다', () => {
    const items = [item({}), item({ id: '0aaaaaaaaaaaaaaaaaaaaa' }), item({ storey: 'Level 2' }), item({ id: 'U_added_by_person', name: '새 문', revitId: null }), item({ r: 'R22', rule: '내력 여부', cls: 'B', ifcClass: 'Wall' })]
    const topics = bcfTopics(items, gid)
    expect(topics.map((t) => t.title)).toEqual(['R4 B-부재 문·창의 개구부 관계 — Level 1 (3개)', 'R4 B-부재 문·창의 개구부 관계 — Level 2 (1개)', 'R22 B-부재 내력 여부 — Level 1 (1개)'])
    expect(topics[0].guids).toEqual(['2O2Fr$t4X7Zf8NOew3FLOH', '0aaaaaaaaaaaaaaaaaaaaa'])
    expect(topics[0].labels).toEqual(['R4', 'B-부재'])
    expect(topics[0].description).toContain('새 문 — 어느 벽에 있는지가 없다') // 고를 수 없는 것은 설명에 남는다
  })

  it('카메라는 범위를 비스듬히 내려다보고, 위 벡터는 시선에 수직이며 위를 향한다', () => {
    const cam = cameraFor([[0, 0, 0], [10, 4, 3]])!
    const dot = cam.dir[0] * cam.up[0] + cam.dir[1] * cam.up[1] + cam.dir[2] * cam.up[2]
    expect(Math.abs(dot)).toBeLessThan(1e-9)
    expect(cam.up[2]).toBeGreaterThan(0)
    expect(cam.dir[2]).toBeLessThan(0)
    expect(cameraFor([])).toBeNull()
  })

  it('zip 에 bcf.version · project.bcfp · 토픽마다 markup.bcf 와 viewpoint.bcfv 가 들고, XML 특수 문자를 이스케이프한다', () => {
    const zip = issuesToBCF([item({ name: 'A&B <문>' })], { files: ['a.ifc'], project: 'P', date: '2026-10-11T00:00:00Z', newGuid: gid })
    const files = readStoreZip(zip)
    const names = [...files.keys()]
    expect(names[0]).toBe('bcf.version')
    expect(names).toContain('project.bcfp')
    const markup = new TextDecoder().decode(files.get(names.find((x) => x.endsWith('markup.bcf'))!))
    const view = new TextDecoder().decode(files.get(names.find((x) => x.endsWith('viewpoint.bcfv'))!))
    expect(markup).toContain('<Filename>a.ifc</Filename>')
    expect(markup).toContain('A&amp;B &lt;문&gt;')
    expect(markup).toMatch(/<Topic Guid="[^"]+" TopicType="Issue" TopicStatus="Open">/)
    expect(view).toContain('<Component IfcGuid="2O2Fr$t4X7Zf8NOew3FLOH" />')
    expect(view).toContain('<PerspectiveCamera>')
  })
})

describe('zip', () => {
  it('CRC-32 가 표준 값이고, 쓴 것을 그대로 다시 읽는다(한글 이름 포함)', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const zip = storeZip([{ name: '가/나.txt', data: '다라' }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }])
    const back = readStoreZip(zip)
    expect(new TextDecoder().decode(back.get('가/나.txt'))).toBe('다라')
    expect([...back.get('b.bin')!]).toEqual([1, 2, 3])
  })
})
