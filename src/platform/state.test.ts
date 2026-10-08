import { describe, expect, it } from 'vitest'
import { demoProject, emptyModel, gateFor, makeProject, applyVersion, restoreVersion, saveDraft, modeFor, summaryFor, snapshotFloor, applyFloorSnapshot } from './state'
import { createSpace, addEquipment, deleteEquipment } from '../lib/edit'
import { storeyFiles } from '../lib/export/storey-export'
import { readOntologyTTL } from '../lib/export/read-ttl'

describe('platform prototype workflow', () => {
  it('automatically branches per floor and gates an empty floor', () => {
    const p=demoProject()
    expect(modeFor(p,p.model.storeys[0].id)).toBe('운영 편집')
    expect(modeFor(p,p.model.storeys[1].id)).toBe('초기 구축')
    expect(gateFor(p.model,p.model.storeys[0].id).pass).toBe(true)
    expect(gateFor(p.model,p.model.storeys[2].id).pass).toBe(false)
  })
  it('blocks duplicate room numbers independently of grade', () => {
    const p=demoProject(), f=p.model.storeys[1]
    f.spaces[1].name=f.spaces[0].name
    expect(gateFor(p.model,f.id).blocking).toContain('중복 방번호: '+f.spaces[0].name)
    expect(()=>applyVersion(p,f.id)).toThrow('생성 기준')
  })
  it('keeps one draft per floor without publishing and detects name changes', () => {
    const p=demoProject(), f=p.model.storeys[1]
    f.spaces[0].longName='Changed';saveDraft(p,f.id)
    f.spaces[0].longName='Changed twice';saveDraft(p,f.id)
    expect(p.drafts[f.id].spaces[0].longName).toBe('Changed twice')
    expect(p.published[f.id]).toBeUndefined()
    expect(summaryFor(p,f.id).join()).toContain('수정 1')
  })
  it('restores into a new version and preserves other floors and older versions', () => {
    const p=demoProject(),f=p.model.storeys[0],other=JSON.stringify(p.model.storeys[1])
    const name=f.spaces[0].longName
    f.spaces[0].longName='Renamed';applyVersion(p,f.id)
    restoreVersion(p,f.id,1)
    expect(p.versions[f.id].map(v=>v.number)).toEqual([3,2,1])
    expect(p.model.storeys[0].spaces[0].longName).toBe(name)
    expect(JSON.stringify(p.model.storeys[1])).toBe(other)
  })
  it('creates a manual room/equipment and exports real shared-ID ontology', () => {
    const m=emptyModel(), f=m.storeys[0]
    createSpace(m,f.id,{name:'101',longName:'회의실',footprint:[[0,0],[8,0],[8,6],[0,6]]})
    expect(gateFor(m,f.id).pass).toBe(true)
    addEquipment(m,f.id,{name:'TEMP',kind:null,position:[2,2,1]})
    expect(gateFor(m,f.id).pass).toBe(true)
    const p=makeProject(m,'manual');applyVersion(p,f.id)
    const files=storeyFiles(m,f.id)!
    const ids=new Set(readOntologyTTL(files.ttl).entities.map(e=>e.key))
    const geo=JSON.parse(files.geojson)
    expect(ids.has(f.spaces[0].id)).toBe(true)
    expect(geo.features.some((x:{id:string})=>x.id===f.spaces[0].id)).toBe(true)
  })
})


it('restores deleted equipment connections without reviving deleted equipment on another floor', () => {
  const p=demoProject(),m=p.model,f=m.storeys[0]
  const [a,b]=f.equipment, other=m.storeys[1].equipment[0]
  m.systems=[{id:'U_test',name:'Test',memberIds:[a.id,b.id,other.id],source:'edit'}]
  m.connections=[{from:a.id,to:b.id,source:'manual',directed:true,tolerance:null}]
  const snapshot=snapshotFloor(m,f.id)
  deleteEquipment(m,a.id);deleteEquipment(m,other.id)
  applyFloorSnapshot(m,snapshot)
  expect(m.storeys[0].equipment.some(e=>e.id===a.id)).toBe(true)
  expect(m.connections).toHaveLength(1)
  expect(m.systems[0].memberIds.sort()).toEqual([a.id,b.id].sort())
  expect(m.storeys[1].equipment.some(e=>e.id===other.id)).toBe(false)
})
