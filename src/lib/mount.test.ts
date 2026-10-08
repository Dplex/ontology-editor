import { describe, expect, it } from 'vitest'
import { allowedSurfaces, canMountOn, MOUNT, surfaceOf } from './mount'
import { equipmentKind } from './kinds'

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
