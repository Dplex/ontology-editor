import type { Model, Storey, Connection } from '../../../../src/lib/model'
import { countOf, isConduit } from '../../../../src/lib/model'
import { addEquipment, createSpace, exteriorOnly, newId } from '../../../../src/lib/edit'
import { profileOf } from '../../../../src/lib/profile'
import { requirementsReport } from '../../../../src/lib/requirements'
import { completenessChecks } from '../../../../src/lib/checks'
import { airServices } from '../../../../src/lib/served'
import { withInferred } from '../../../../src/lib/flow-rules'
import type { IdfAttachReport } from '../../../../src/lib/idf/attach'

// 층 되돌리기가 설비만 복원하고 연결·계통 소속을 잃지 않도록 incident graph도 같이 보존한다.
export type FloorSnapshot = Storey & { prototypeGraph?: { ids: string[]; connections: Connection[]; members: Record<string,string[]> } }
export function snapshotFloor(model: Model, id: string): FloorSnapshot {
  const floor=model.storeys.find(s=>s.id===id)!
  const ids=new Set(floor.equipment.map(e=>e.id))
  return { ...clone(floor), prototypeGraph: { ids:[...ids],
    connections:clone(model.connections.filter(c=>ids.has(c.from)||ids.has(c.to))),
    members:Object.fromEntries(model.systems.map(s=>[s.id,s.memberIds.filter(e=>ids.has(e))])) } }
}
export function applyFloorSnapshot(model: Model, snapshot: FloorSnapshot) {
  const index=model.storeys.findIndex(s=>s.id===snapshot.id)
  if(index<0)throw new Error('복원할 층이 없습니다.')
  const {prototypeGraph:graph,...floor}=clone(snapshot)
  const touched=new Set([...model.storeys[index].equipment.map(e=>e.id),...(graph?.ids ?? [])])
  model.storeys[index]=floor
  if(!graph)return
  const present=new Set(model.storeys.flatMap(s=>s.equipment.map(e=>e.id)))
  model.connections=[...model.connections.filter(c=>!touched.has(c.from)&&!touched.has(c.to)),
    ...graph.connections.filter(c=>present.has(c.from)&&present.has(c.to))]
  for(const system of model.systems)system.memberIds=[...new Set([
    ...system.memberIds.filter(id=>!touched.has(id)),...(graph.members[system.id]??[]).filter(id=>present.has(id))])]
}
export const STORAGE_KEY = 'ontology-platform-prototype-v1'
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
export type Report = ReturnType<typeof reportFor>
export type Version = { number: number; at: string; author: string; summary: string; floor: FloorSnapshot; report: Report }
/** IDF 검토 상태(OE-IDF-11). 확인하기 전에는 IDF 결과가 내보내기에 나가지 않는다. matchOk 는 사람이 확인한 존↔물리존 매칭이다(OE-IDF-05). */
export type IdfState = { name: string; confirmed: boolean; matchOk: Record<string, string[]>; report?: IdfAttachReport }
/** 시스템 로그 한 줄(OE-COM-04·GEN-05·XPRD-01). 확정 저장(반영·되돌리기)과 복구용 자동 저장·파일 다운로드를 구분해 적는다. */
export type LogEntry = { type: '반영' | '되돌리기' | 'IDF 검토' | '임시 저장' | '파일 다운로드'; at: string; user: string; floor: string; version: number | null; note?: string }
export type Project = {
  id: string; name: string; source: string; model: Model; idf?: IdfState; log?: LogEntry[]
  original: Record<string, FloorSnapshot>; published: Record<string, FloorSnapshot>; drafts: Record<string, FloorSnapshot>
  versions: Record<string, Version[]>
}
export function makeProject(model: Model, source: string): Project {
  return { id: newId(), name: model.buildingName || source, source, model,
    original: Object.fromEntries(model.storeys.map(s => [s.id, snapshotFloor(model,s.id)])),
    published: {}, drafts: {}, versions: {} }
}
export function emptyModel(name = '새 사이트'): Model {
  return { schema: '수동 구축', siteName: name, buildingId: newId(), buildingName: name,
    storeys: [{ id: newId(), name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] }],
    systems: [], connections: [], warnings: [] }
}
export function demoProject(): Project {
  const model = emptyModel('SR 캠퍼스 · 연구동')
  model.schema = '데모 모델'
  model.siteName = 'SR 캠퍼스'
  model.storeys = ['1F', '2F', '3F'].map((name, i) => ({
    id: 'U_DemoFloor' + i, name, elevation: i * 4, spaces: [], walls: [], openings: [], equipment: [],
  }))
  const rooms = [
    { name: '101', title: '회의실 A', x: 0, y: 0, w: 8, h: 6 },
    { name: '102', title: '오픈 오피스', x: 8, y: 0, w: 12, h: 6 },
    { name: '103', title: '회의실 B', x: 20, y: 0, w: 8, h: 6 },
    { name: '104', title: '라운지', x: 0, y: 8, w: 8, h: 7 },
    { name: '105', title: '연구실', x: 8, y: 8, w: 12, h: 7 },
    { name: '106', title: '기계실', x: 20, y: 8, w: 8, h: 7 },
    { name: '107', title: '복도', x: 0, y: 6, w: 28, h: 2 },
  ]
  for (const s of model.storeys.slice(0, 2)) {
    rooms.forEach((r, i) => {
      createSpace(model, s.id, { id: 'U_' + s.name + 'Space' + i, name: String(Number(r.name) + (s.name === '2F' ? 100 : 0)),
        longName: r.title, footprint: [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]] })
      if (i < 6) {
        addEquipment(model, s.id, { id: 'U_' + s.name + 'Device' + i, name: 'FCU-' + s.name + '-' + (i+1),
          kind: 'fcu', position: [r.x+r.w/2,r.y+r.h/2,s.elevation+1.2] })
      }
    })
  }
  const p = makeProject(model, '합성 데모 · 실제 BIM 아님')
  const s = model.storeys[0]
  p.published[s.id] = snapshotFloor(model,s.id)
  p.versions[s.id] = [{ number: 1, at: new Date().toISOString(), author: '데모 초기 데이터',
    summary: '최초 구축 · 물리존 7개 / 설비 ' + s.equipment.length + '대', floor: snapshotFloor(model,s.id), report: reportFor(model, s.id) }]
  return p
}
export function scopedModel(model: Model, id: string): Model {
  const floor = model.storeys.find(s => s.id === id)
  const ids = new Set(floor?.equipment.map(e => e.id))
  return { ...model, storeys: floor ? [floor] : [],
    systems: model.systems.map(s => ({...s, memberIds: s.memberIds.filter(e => ids.has(e))})).filter(s => s.memberIds.length),
    connections: model.connections.filter(c => ids.has(c.from) && ids.has(c.to)) }
}
export function gateFor(model: Model, floorId: string) {
  const m = scopedModel(model, floorId)
  const floor = m.storeys[0]
  const rooms = floor?.spaces ?? []
  const devices = (floor?.equipment ?? []).filter(e => !isConduit(e.role))
  const interior = devices.filter(e => !exteriorOnly(e))
  const ratio = (have: number, total: number) => total ? have / total : 0
  const rows = [
    { label: '물리존 외곽선', have: rooms.filter(r => r.footprint.length >= 4).length, total: rooms.length, threshold: .85 },
    { label: '설비 배치점', have: devices.filter(e => e.position !== null).length, total: devices.length, threshold: .9 },
    { label: '설비 소속', have: interior.filter(e => e.spaceId !== null).length, total: interior.length, threshold: .85 },
  ].map(r => ({ ...r, value: ratio(r.have,r.total), pass: r.total > 0 && ratio(r.have,r.total) >= r.threshold }))
  if(model.schema==='수동 구축') for(const row of rows) if(row.total===0 && row.label!=='물리존 외곽선') row.pass=true
  if(interior.length===0 && devices.length>0) rows[2].pass=true
  const names = rooms.map(r => r.name.trim())
  const duplicates = [...new Set(names.filter((n,i) => names.indexOf(n) !== i))]
  const blocking = [
    ...rows.filter(r => !r.pass).map(r => r.label + ': ' + r.have + '/' + r.total + ' (기준 ' + Math.round(r.threshold*100) + '%)'),
    ...(duplicates.length ? ['중복 방번호: ' + duplicates.join(', ')] : []),
    ...(names.some(n => !n) ? ['빈 방번호가 있습니다.'] : []),
  ]
  // ponytail: D1 미확정. PRD 1.8 C안으로 체험하고 화면·리포트에 제안 기준임을 표시한다.
  return { pass: blocking.length === 0, rows, blocking, policy: 'D1 제안 기준 · 게이트 등급 2 / 목표선 등급 3' }
}
export function reportFor(model: Model, floorId: string) {
  const m = scopedModel(model, floorId)
  const directions = withInferred(m.connections, true)
  return {
    scope: floorId, counts: countOf(m), gate: gateFor(model, floorId), profile: profileOf(m),
    requirements: requirementsReport(m),
    checks: completenessChecks(m, airServices(m,directions),directions),
    excluded: m.storeys.flatMap(s => s.equipment.filter(e => !e.position).map(e => ({id:e.id,name:e.name}))),
    unconfirmed: m.connections.filter(c => c.inferred && !c.inferred.confirmed).length,
    warnings: model.warnings, hvacZones: m.hvac?.zones.filter(z => z.storeyId === floorId).length ?? 0,
    outsideBim: ['BAS 관제점 연결: 미연동', 'DT 등록: 파일 내보내기', 'IDF 존 매칭: 사용자가 확인한 것만 내보내기에 포함(프로토타입)'],
    parser: '내보내기 후 저장소의 DT 수신 규칙 reader로 확인 · 서버 등록 확인 아님',
  }
}
export function modeFor(p: Project, floorId: string) { return p.published[floorId] ? '운영 편집' : '초기 구축' }
export function saveDraft(p: Project, floorId: string) {
  const floor = p.model.storeys.find(s => s.id === floorId)
  if (!floor) throw new Error('선택한 층이 없습니다.')
  p.drafts[floorId] = snapshotFloor(p.model,floorId)
}
export function baselineFor(p: Project, floorId: string) { return p.published[floorId] ?? p.original[floorId] }
export function summaryFor(p: Project, floorId: string) {
  const next = p.model.storeys.find(s => s.id === floorId)!
  const before = baselineFor(p,floorId)
  if (!before) return ['새 층 구축']
  const changes: string[] = []
  for (const [label, a, b] of [
    ['물리존',before.spaces,next.spaces],['설비',before.equipment,next.equipment],
    ['커스텀존',before.customZones ?? [],next.customZones ?? []],
  ] as const) {
    const prev = new Map(a.map(x => [x.id, JSON.stringify(x)]))
    const curr = new Map(b.map(x => [x.id, JSON.stringify(x)]))
    const added = b.filter(x => !prev.has(x.id)).length
    const removed = a.filter(x => !curr.has(x.id)).length
    const edited = b.filter(x => prev.has(x.id) && prev.get(x.id) !== curr.get(x.id)).length
    if (added || removed || edited) changes.push(label + ': 추가 ' + added + ' · 수정 ' + edited + ' · 삭제 ' + removed)
  }
  return changes
}
export function applyVersion(p: Project, floorId: string, summary?: string, now = new Date()) {
  if (!gateFor(p.model,floorId).pass) throw new Error('생성 기준 미달: 검증 결과를 확인하세요.')
  const floor = p.model.storeys.find(s => s.id === floorId)!
  const versions = p.versions[floorId] ?? []
  const version: Version = { number: Math.max(0,...versions.map(v => v.number)) + 1,
    at: now.toISOString(), author: '프로토타입 사용자', summary: summary ?? (summaryFor(p,floorId).join(' / ') || '최초 구축'),
    floor: snapshotFloor(p.model,floorId), report: reportFor(p.model,floorId) }
  p.published[floorId] = snapshotFloor(p.model,floorId)
  delete p.drafts[floorId]
  p.versions[floorId] = [version,...versions].filter(v => now.getTime()-Date.parse(v.at) <= 7*86400000)
  return version
}
export function restoreVersion(p: Project, floorId: string, number: number) {
  const v = p.versions[floorId]?.find(v => v.number === number)
  if (!v || Date.now()-Date.parse(v.at) > 7*86400000) throw new Error('복원 가능한 1주일 이내 버전이 아닙니다.')
  const index = p.model.storeys.findIndex(s => s.id === floorId)
  applyFloorSnapshot(p.model,v.floor)
  return applyVersion(p,floorId,'v' + number + '로 되돌리기')
}

/**
 * 내보낼 모델. IDF 를 아직 확인하지 않았으면 IDF 결과(공조존·담당 설비)를 빼고(OE-IDF-11 AC2), 확인했으면 담당 설비는 그대로 두고 존↔물리존 매칭은
 * 사람이 확인한 것만 남긴다(OE-IDF-05 AC1·AC2). IDF 를 연 적 없는 프로젝트는 그대로다. 사람이 만든 공조존(Storey.hvacZones)은 늘 나간다.
 */
export function exportModelOf(p: Project): Model {
  const m = p.model
  if (!m.hvac || !p.idf) return m
  if (!p.idf.confirmed) return { ...m, hvac: undefined }
  const ok = p.idf.matchOk
  return { ...m, hvac: { ...m.hvac, zones: m.hvac.zones.map(z => ({ ...z, spaceIds: z.spaceIds.filter(id => ok[z.id]?.includes(id)) })) } }
}

export function addLog(p: Project, type: LogEntry['type'], floorName: string, version: number | null = null, note?: string) {
  ;(p.log ??= []).unshift({ type, at: new Date().toISOString(), user: '구축 담당자', floor: floorName, version, note })
  if (p.log.length > 200) p.log.length = 200
}
/** 확정 저장(버전이 생긴 반영·되돌리기). 알림(GNB)과 배너가 이것만 센다. */
export const isCommitted = (e: LogEntry) => e.type === '반영' || e.type === '되돌리기'
