import { describe, expect, it } from 'vitest'
import { allowedSurfaces, canMountOn, MOUNT, surfaceOf } from './mount'
import { equipmentKind, equipmentKindOf } from './kinds'
import { CAPACITY_CHECK_KINDS } from './airflow'

// OE-OBJ-08 설치면. 표는 PRD 가 정한 것이고, 표에 없는 종류는 정하지 않는다.
describe('설치면', () => {
  it('표의 종류는 전부 사전에 있는 종류다(오타로 조용히 빠지지 않게)', () => {
    for (const kind of Object.keys(MOUNT)) expect(equipmentKind(kind), kind).not.toBeNull()
  })

  it('허용 면이 하나면 그 면, 둘 이상이면 모름, 표에 없으면 정하지 않음', () => {
    expect(surfaceOf({ kind: 'air_diffuser' })).toBe('ceiling')
    expect(surfaceOf({ kind: 'ahu' })).toBe('floor')
    expect(surfaceOf({ kind: 'receptacle' })).toBe('wall')
    expect(surfaceOf({ kind: 'camera' })).toBeNull()
    expect(allowedSurfaces('camera')).toEqual(['ceiling', 'wall'])
    expect(allowedSurfaces('heat_recovery')).toBeNull()
    expect(allowedSurfaces(null)).toBeNull()
  })

  it('스프링클러 헤드는 천장 전용이다 (OE-EQP-11 R1) [OE-EQP-11#1]', () => {
    expect(allowedSurfaces('sprinkler')).toEqual(['ceiling'])
    expect(surfaceOf({ kind: 'sprinkler' })).toBe('ceiling')
    expect(canMountOn({ kind: 'sprinkler' }, 'wall')).toBe(false)
  })

  it('공조기·패키지 에어컨(PAC)은 바닥 전용이고, PAC 는 이름으로 읽혀 정격 풍량이 Z-03 입력이 된다 (OE-EQP-09)', () => {
    for (const k of ['ahu', 'pac']) {
      expect(allowedSurfaces(k)).toEqual(['floor'])
      expect(canMountOn({ kind: k }, 'ceiling')).toBe(false)
      expect(canMountOn({ kind: k }, 'wall')).toBe(false)
    }
    for (const name of ['PAC-1', 'PAC 3F-02', '패키지 에어컨 1', '패키지형 에어컨', 'Packaged Air Conditioner']) expect(equipmentKindOf(name, '', '')?.kind, name).toBe('pac')
    // 다른 낱말 속의 pac 는 읽지 않는다.
    for (const name of ['Space Heater', 'IMPACT-1', 'capacitor']) expect(equipmentKindOf(name, '', '')?.kind, name).not.toBe('pac')
    expect(CAPACITY_CHECK_KINDS.has('pac')).toBe(true)
    expect(equipmentKind('pac')?.brick).toBe('brick:PAC')
  })

  it('정하지 않은 종류는 막지 않는다', () => {
    expect(canMountOn({ kind: 'ahu' }, 'ceiling')).toBe(false)
    expect(canMountOn({ kind: 'fcu' }, 'ceiling')).toBe(true)
    expect(canMountOn({ kind: 'heat_recovery' }, 'ceiling')).toBe(true)
    expect(canMountOn({ kind: null }, 'ceiling')).toBe(true)
  })

  it('glossary 설치면 type 표를 따른다 — 분전반 바닥·벽, 감지기 천장·벽, 밸브는 설치면 없음', () => {
    expect(allowedSurfaces('panel')).toEqual(['floor', 'wall'])
    expect(allowedSurfaces('smoke_detector')).toEqual(['ceiling', 'wall'])
    expect(allowedSurfaces('chiller')).toEqual(['floor'])
    expect(allowedSurfaces('valve')).toEqual([])
    expect(surfaceOf({ kind: 'valve' })).toBeNull()
    for (const s of ['ceiling', 'floor', 'wall'] as const) expect(canMountOn({ kind: 'valve' }, s)).toBe(false)
  })
})
