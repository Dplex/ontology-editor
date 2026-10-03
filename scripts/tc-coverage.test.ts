import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes, UnreadableIfcError } from '../src/lib/ifc/import'
import { mergeModels, type MergeReport } from '../src/lib/merge'
import { isConduit, unplacedOf, type Model } from '../src/lib/model'
import { requirementsReport, REQUIREMENTS, type RequirementState } from '../src/lib/requirements'
import { judgeExternalAll } from '../src/lib/exterior'
import { storeyHeights } from '../src/lib/storey-height'
import { systemlessAir } from '../src/lib/served'
import { verticalLinks } from '../src/lib/vertical'
import { equipmentKind } from '../src/lib/kinds'
import { exteriorOnly } from '../src/lib/edit'
import { compareVersions } from '../src/lib/versions'
import { storeyScaleMismatch } from '../src/lib/unit-check'

// TC 가 대응하는 상황이 BIM 에 다 들어 있는가 — 성수가 없는 PC 에서 "우리 TC 가 다 대응하는 IFC" 를 실증한다.
// 대상은 합성 고층 BIM(scripts/synth-tower.mjs 가 병원을 쌓고 상황을 층 묶음마다 심은 것)과 그 판본들이다. 상황마다 몇 번 나오는지
// 세어 data/합성-성수/커버리지.md 에 쓰고, 0 인 상황은 실패로 낸다 — 그 상황을 생성기에 심어야 한다.
//
// 한 모델에서 같이 낼 수 없는 것(요구사항 줄의 표준·표준 아님, 포트 없는 파일, 좌표계가 어긋난 파일, 구문이 깨진 파일)은 판본
// 파일로 잰다. IFC4 에만 있는 것(IFC4 형식, 분전반 안 보호기)은 IFC2x3 인 병원으로 못 만들어 실제 IFC4 파일(ifc4Mep)로 잰다.
// TC 가 재지 않는 요구사항(R8·R15·R20 — 화면에서 사람이 본다)과 가진 파일·합성 모두에 없는 것(R7 표준: IFC4 + IfcMapConversion)은
// 표에 "해당 없음" 으로 이유와 같이 적고 실패로 치지 않는다.
const DIR = process.env.TC_DIR ?? 'data/합성-성수'
const at = (name: string) => join(DIR, name)
const IFC4 = 'data/ifc4Mep_IFC4.ifc'
// 요구사항 줄의 "표준" 은 깨끗한 파일에서 나온다 — 합성은 병원의 버릇을 다 물려받아 표준이 안 나오는 줄이 있다. 가진 실제 BIM 도 같이 잰다.
const REAL: [string, string[]][] = [
  ['AC20', ['data/AC20-FZK-Haus.ifc']],
  ['ifc4Mep', [IFC4]],
  ['Duplex 건축+HVAC', ['data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc', 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc']],
  ['Duplex MEP', ['data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc']],
  ['병원 건축+HVAC', ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc']],
  ['병원 전기', ['data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-ELE.ifc']],
]
const have = existsSync(at('건축.ifc')) && existsSync(at('기계.ifc'))

type Row = { id: string; what: string; tc: string; where: string; count: number | null; why?: string }
const rows: Row[] = []

let api: WebIFC.IfcAPI
// 앱처럼 형상까지 읽는다 — 외벽 판정·배치점 보정·형상 연결 추정은 형상이 있어야 돈다. 형상은 버린다.
const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
let arch: Model, mech: Model, merged: Model, report: MergeReport
let next: Model, unitWrong: Model, noPorts: Model, shiftedReport: MergeReport, shiftedMerged: Model, ifc4: Model | null
let broken: unknown
let clean: ReturnType<typeof requirementsReport>
const real: [string, ReturnType<typeof requirementsReport>][] = []

beforeAll(async () => {
  if (!have) return
  api = new WebIFC.IfcAPI()
  await api.Init()
  arch = open(at('건축.ifc'))
  mech = open(at('기계.ifc'))
  const done = mergeModels(arch, mech, { base: '건축.ifc', overlay: '기계.ifc' })
  merged = done.model
  report = done.report
  next = open(at('기계-다음판.ifc'))
  unitWrong = open(at('기계-단위틀림.ifc'))
  noPorts = open(at('기계-포트없음.ifc'))
  const shifted = mergeModels(arch, open(at('기계-어긋남.ifc')), { base: '건축.ifc', overlay: '기계-어긋남.ifc' })
  shiftedMerged = shifted.model
  shiftedReport = shifted.report
  ifc4 = existsSync(IFC4) ? open(IFC4) : null
  // 깨끗하게 낸 판본(분류 관계·IfcSystem·표준 용량 이름) — 요구사항 줄의 "표준" 을 합성에서 낸다.
  if (existsSync(at('건축-표준.ifc')) && existsSync(at('기계-표준.ifc'))) {
    const c = mergeModels(open(at('건축-표준.ifc')), open(at('기계-표준.ifc')))
    clean = requirementsReport(c.model, c.report)
  }
  for (const [name, files] of REAL) {
    if (!files.every((f) => existsSync(f))) continue
    const models = files.map(open)
    const m = models.length > 1 ? mergeModels(models[0], models[1]) : { model: models[0], report: null }
    real.push([`${name}(실제)`, requirementsReport(m.model, m.report)])
  }
  try {
    open(at('건축-깨짐.ifc'))
    broken = null
  } catch (e) {
    broken = e
  }
}, 3_600_000)

describe.skipIf(!have)('TC 가 대응하는 상황이 다 들어 있다 (합성 고층 BIM)', () => {
  it('상황마다 센다', () => {
    const devices = (m: Model) => m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    const warn = (m: Model, re: RegExp) => (m.warnings.some((w) => re.test(w)) ? 1 : 0)
    const add = (id: string, what: string, tc: string, where: string, count: number) => rows.push({ id, what, tc, where, count })
    const na = (id: string, what: string, tc: string, why: string) => rows.push({ id, what, tc, where: '—', count: null, why })
    const all = devices(merged)
    const opens = merged.storeys.flatMap((s) => s.openings)
    const walls = merged.storeys.flatMap((s) => s.walls)
    const spaces = merged.storeys.flatMap((s) => s.spaces)
    const ext = judgeExternalAll(merged)
    const M = '건축+기계'

    // 규모(성수: 19층, 설비 3,472, 덕트·배관 15,864, 연결 19,515)
    add('규모-층', '층 19 이상', '성수 불변식·화면 시험', M, merged.storeys.length >= 19 ? merged.storeys.length : 0)
    add('규모-설비', '설비 3,000 이상', '성수 불변식', M, all.length >= 3000 ? all.length : 0)
    add('규모-연결', '연결 15,000 이상', '성수 불변식', M, merged.connections.length >= 15000 ? merged.connections.length : 0)
    // 파일 읽기
    add('구문오류', '구문이 깨진 파일은 이유를 말하며 멈춘다', 'R0 · UnreadableIfcError', '건축-깨짐', broken instanceof UnreadableIfcError ? 1 : 0)
    add('proxy-포트', 'Proxy 설비 — 포트로 받음', 'OE-BIM-13 · R23', '기계', mech.facts?.proxies?.ported ?? 0)
    add('proxy-이름', 'Proxy 설비 — 포트 없이 이름으로 받음', 'OE-BIM-13', '기계', mech.facts?.proxies?.named ?? 0)
    add('proxy-건축부재', 'Proxy — 포트·이름 없어 안 읽음', 'OE-BIM-13', '기계', (mech.facts?.proxies?.total ?? 0) - (mech.facts?.proxies?.ported ?? 0) - (mech.facts?.proxies?.named ?? 0))
    add('공간-사본', '같은 자리 같은 방("공간" 사본)을 걸러냄', 'dropDuplicateSpaces', '건축', warn(arch, /같은 자리에 같은 방이 두 번/))
    add('공간-외곽선없음', '바닥 외곽선 없는 공간', 'R2', M, spaces.filter((s) => s.footprint.length < 3).length)
    add('공간-이름없음', '이름(LongName) 없는 방', 'R3', '건축', arch.storeys.flatMap((s) => s.spaces).filter((s) => !s.longName).length)
    add('공간-경계없음', '공간 경계(IfcRelSpaceBoundary) 없는 방', 'R5', M, warn(merged, /공간 경계\(IfcRelSpaceBoundary\)가 없습니다/))
    add('층-이름없음', '이름 없는 층', 'R1', '건축', arch.storeys.filter((s) => !s.name).length)
    // 설비 자리
    add('미배치', '좌표 없는 설비(미배치 목록)', 'OE-BIM-07 · OE-MAN-04', M, unplacedOf(merged).length)
    add('형상중심', '배치점이 형상에서 떨어져 형상 중심을 씀', 'R11 · anchorToGeometry', M, all.filter((e) => e.positionSource === 'geometry').length)
    add('분전반자리', '좌표 없는 분전반 부품을 분전반 자리에(IFC4 보호기)', 'OE-BIM-07', 'ifc4Mep(실제)', ifc4 ? devices(ifc4).filter((e) => e.positionSource === 'panel').length : 0)
    // 벽·문·창
    add('문창-호스트없음', '어느 벽에 있는지 모르는 문·창', 'R4 · OE-BIM-05', M, opens.filter((o) => !o.wallId).length)
    add('벽-두께모름', '재료가 없어 두께 모르는 벽', 'OE-BIM-04', M, walls.filter((w) => w.thickness === null).length)
    add('벽-내력', '내력벽(잠금)', 'OE-OBJ-06', M, walls.filter((w) => w.loadBearing === true).length)
    add('벽-내력모름', '내력 여부 모르는 벽', 'R22 · OE-OBJ-06', M, walls.filter((w) => w.loadBearing === null).length)
    add('벽-외벽계산', 'IsExternal 없는 벽을 계산으로 외벽 판정', 'OE-EXT-01', M, [...ext.values()].filter((j) => j.source === 'calc').length)
    add('벽-외벽BIM', 'IsExternal 있는 벽', 'OE-EXT-01', M, [...ext.values()].filter((j) => j.source === 'bim').length)
    // 연결·계통
    add('연결-포트', '포트가 말한 연결', 'R17 · OE-BIM-09', '기계', mech.connections.filter((c) => c.source === 'port').length)
    add('연결-방향없음', '포트에 방향이 없는 연결(SOURCEANDSINK)', 'R17', '기계', mech.connections.filter((c) => c.source === 'port' && !c.directed).length)
    add('연결-규칙방향', '방향 없는 연결에 규칙 방향', 'flow-rules', M, merged.connections.filter((c) => c.inferred).length)
    add('연결-형상추정', '포트 없는 파일 — 형상이 맞닿은 곳을 연결로', 'OE-PIP-18 · R15', '기계-포트없음', noPorts.connections.filter((c) => c.source !== 'port').length)
    add('연결-다른층', '층을 넘는 연결', 'OE-UI-12 · OE-ML-19', M, merged.connections.filter((c) => {
      const s = (id: string) => merged.storeys.findIndex((st) => st.equipment.some((e) => e.id === id))
      return s(c.from) !== s(c.to)
    }).length)
    add('계통-속성', 'IfcSystem 대신 System Name 속성으로 묶은 계통', 'R16', '기계', mech.systems.filter((s) => s.source === 'property').length)
    add('계통없는말단', '계통 없는 VAV·토출구', 'OE-EQP-10', M, systemlessAir(merged).length)
    add('용량없음', '용량 없는 기기', 'R21', M, warn(merged, /용량 파라미터가 없습니다/))
    add('수직연결', '층 사이 연결(계단·승강로)', 'OE-ML-19', M, verticalLinks(merged).size)
    // 종류
    add('종류-엘리베이터', '엘리베이터', 'OE-BIM-13', M, all.filter((e) => e.kind === 'elevator').length)
    add('종류-분전반', '분전반(Panelboard 이름)', 'OE-BIM-13', M, all.filter((e) => e.kind === 'panel').length)
    add('종류-외기센서', '외기 센서(외벽 전용)', 'OE-OBJ-04', M, all.filter((e) => exteriorOnly(e)).length)
    add('종류-흐름없음', '흐름 없는 기기(조명·콘센트 등)', 'OE-PIP-18', M, all.filter((e) => { const f = equipmentKind(e.kind)?.flow; return !!f && Object.keys(f).length === 0 }).length)
    add('종류-모름', '종류 모르는 설비', 'R24 · OE-EQP-14', M, all.filter((e) => !e.kind).length)
    // 층
    const heights = storeyHeights(merged.storeys)
    add('층고-BIM', '층고를 BIM 이 적음', 'OE-BIM-02', M, [...heights.values()].filter((h) => h?.source === 'bim').length)
    add('층고-계산', '층고를 바닥 높이 차로 계산', 'OE-BIM-02', M, [...heights.values()].filter((h) => h?.source === 'calc').length)
    add('층고-모름', '층고 모름(맨 위층)', 'OE-BIM-02', M, [...heights.values()].filter((h) => h === null).length)
    add('층고-어긋남', 'BIM 층고와 계산이 1cm 넘게 다름', 'OE-BIM-02', M, [...heights.values()].filter((h) => h?.mismatch).length)
    // 판본·합치기
    const scale = storeyScaleMismatch(mech.storeys, unitWrong.storeys)
    add('단위어긋남', '길이 단위 선언이 실제와 다른 판본(같은 층 높이가 1000배)', 'OE-BIM-11 · R6', '기계-단위틀림', scale ? 1 : 0)
    const rekeyed = compareVersions(mech, next).equipment.rekeyed.length
    add('GUID바뀜', '다음 판본에서 GUID 가 바뀐 설비를 이름·요소 ID 로 다시 찾음', 'OE-BIM-19 · OE-INT-09 S1 · R13', '기계-다음판', rekeyed)
    add('좌표계-맞음', '건축·설비 좌표계가 맞음', 'R12', M, report.alignment && report.alignment.ratio > 0.9 ? 1 : 0)
    add('좌표계-어긋남', '건축·설비 좌표계가 어긋남(설비가 방 범위 밖)', 'R12', '건축+기계-어긋남', shiftedReport.alignment && shiftedReport.alignment.ratio < 0.5 ? 1 : 0)

    // 요구사항 줄마다 표준·표준 아님이 다 나오는가(R0~R24). 상태는 파일 묶음 전체에서 모은다.
    const versions = { name: '기계-다음판', kept: 0, rematched: rekeyed, storeyScale: null }
    const reports: [string, ReturnType<typeof requirementsReport>][] = [
      ['건축', requirementsReport(arch)],
      ['기계', requirementsReport(mech)],
      [M, requirementsReport(merged, report)],
      ['건축+기계-어긋남', requirementsReport(shiftedMerged, shiftedReport)],
      ['기계-단위틀림', requirementsReport(unitWrong, null, { name: '기계', kept: 0, rematched: 0, storeyScale: storeyScaleMismatch(mech.storeys, unitWrong.storeys) })],
      ['기계-포트없음', requirementsReport(noPorts)],
      ['기계-다음판', requirementsReport(next, null, versions)],
      // 같은 판본을 다시 연 것 — GUID 가 그대로다(R13 표준).
      ['기계(같은 판본)', requirementsReport(mech, null, { name: '기계', kept: devices(mech).length, rematched: 0, storeyScale: null })],
      ...(clean ? [['건축-표준+기계-표준', clean] as [string, ReturnType<typeof requirementsReport>]] : []),
      ...real,
    ]
    const UNMEASURED: Record<string, string> = { R19: '공조존은 IDF 임포트(#5, R2 로 밀림)에서 온다', R8: '형상 정확도는 3D 에서 사람이 본다', R15: '형상이 맞닿는지는 3D 연결망에서 사람이 본다', R20: '센서의 측정 대상은 읽지 않는다(BAS 몫)' }
    for (const r of REQUIREMENTS) {
      if (UNMEASURED[r.id]) {
        na(`${r.id}`, `요구사항 ${r.id} ${r.title}`, 'OE-REQ-06', UNMEASURED[r.id])
        continue
      }
      const seen = new Map<RequirementState, string[]>()
      // 구문이 깨진 파일은 보고서까지 안 간다 — 열기에서 멈춘 것이 R0 의 "표준 아님" 이다.
      if (r.id === 'R0' && broken instanceof UnreadableIfcError) seen.set('missing', ['건축-깨짐'])
      for (const [file, rep] of reports) {
        const row = rep.find((x) => x.id === r.id)!
        seen.set(row.state, [...(seen.get(row.state) ?? []), file])
      }
      const std = seen.get('standard') ?? []
      const other = [...seen].filter(([s]) => s !== 'standard' && s !== 'none' && s !== 'unmeasured')
      if (r.id === 'R7' && !std.length) na('R7-표준', '요구사항 R7 — 표준(IfcMapConversion)', 'OE-REQ-06', 'IFC4 + IfcMapConversion 이 가진 파일·합성 어디에도 없다(IFC2x3 에는 그 자리가 없다)')
      else add(`${r.id}-표준`, `요구사항 ${r.id} ${r.title} — 표준`, 'OE-REQ-06 · OE-BIM-17', std.join(', ') || '—', std.length)
      add(`${r.id}-표준아님`, `요구사항 ${r.id} ${r.title} — ${other.map(([s]) => s).join('·') || '표준 아님'}`, 'OE-REQ-06 · OE-BIM-17', other.map(([s, f]) => `${s}: ${f.join(', ')}`).join(' / ') || '—', other.length)
    }

    const ok = rows.filter((r) => r.count !== null && r.count > 0).length
    const measured = rows.filter((r) => r.count !== null).length
    // 합성만으로 나오는가 — 어느 파일 칸에 "(실제)" 가 아닌 파일이 하나라도 있으면 합성에서 나온 것이다.
    const synthOnly = rows.filter((r) => r.count !== null && r.count > 0 && r.where.split(/, | \/ |: /).some((f) => f && f !== '—' && !f.includes('(실제)') && !/^(standard|partial|missing|elsewhere)$/.test(f))).length
    const lines = [
      '# TC 상황 커버리지',
      '',
      `${new Date().toISOString()} · ${DIR} (scripts/synth-tower.mjs) · 대응 ${ok}/${measured}(합성만으로 ${synthOnly}) · 해당 없음 ${rows.length - measured}`,
      '',
      '| 상황 | 무엇 | 재는 TC | 어느 파일 | 수 |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.what} | ${r.tc} | ${r.where} | ${r.count ?? `해당 없음 — ${r.why}`} |`),
    ]
    writeFileSync(at('커버리지.md'), lines.join('\n'))
    console.log(lines.join('\n'))
    expect(rows.filter((r) => r.count === 0).map((r) => r.id)).toEqual([])
  }, 3_600_000)
})
